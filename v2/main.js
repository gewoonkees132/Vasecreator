// Bootstrap for v2: loads the library and presets, restores history from
// IndexedDB, creates the store, the engine client, the bead renderer and the
// profile handles, and mounts the UI into the DOM regions of index.html
// (ARCHITECTURE.md, "UI contracts").

import { createStore } from './store/store.js';
import { openDb } from './store/db.js';
import { useDb, loadImage, imageHashes, onImageSaved } from './store/assets.js';
import { normaliseDesign, moveKnot, insertKnot, deleteKnot } from './core/design.js';
import * as printerModule from './core/printer.js';
import { createEngine } from './worker/client.js';
import { BeadRenderer } from './render/beads.js';
import { createProfileHandles } from './render/handles.js';
import { createGizmos } from './render/gizmos.js';
import { mountSteps, shapeOnly } from './ui/steps.js';
import { mountTopbar } from './ui/topbar.js';
import { mountChips } from './ui/chips.js';
import { mountHistory } from './ui/history.js';
import { mountDesigns } from './ui/designs.js';
import { mountDesignsTip } from './ui/designs-tip.js';

const PHONE = matchMedia('(max-width: 760px)');
const THUMB_SETTLE_MS = 600;
const BACKFILL_IDLE_MS = 1500;
const BACKFILL_STEPS = 40;
const PRINTER_SAVE_MS = 500;

const $ = (sel) => document.querySelector(sel);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function safeNormalise(design) {
  try { return normaliseDesign(design); } catch { return null; }
}

// The printer profile module owns its normaliser; tolerate either name.
function loadPrinter(saved) {
  const base = printerModule.defaultPrinter();
  if (!saved) return base;
  const normalise = printerModule.normalisePrinter || printerModule.normalise;
  try {
    return typeof normalise === 'function' ? normalise(saved) : { ...base, ...saved };
  } catch {
    return base;
  }
}

// The bed the renderer outlines, read from whichever shape the profile uses.
function bedOf(printer) {
  const m = printer?.machine;
  const bed = printer?.bed;
  const width = m?.bedWidthMm ?? bed?.widthMm;
  const depth = m?.bedDepthMm ?? bed?.depthMm;
  return Number.isFinite(width) && Number.isFinite(depth) ? { widthMm: width, depthMm: depth } : null;
}

// Same comparison as the store: meta (name, id) is not part of the design.
function designKey(design) {
  if (!design) return '';
  const { meta, ...rest } = design;
  return JSON.stringify(rest);
}

/**
 * The engine client, plus: before a design goes to the worker, every image it
 * references is sent once with setImage (read from IndexedDB). A design that
 * needs no new image goes straight through, so previews don't wait; one that
 * does waits for the read, and a newer preview asked for meanwhile still
 * wins (the waiting one then resolves null, like any superseded preview).
 */
function withImages(engine) {
  const sent = new Set();      // hashes the worker has
  const missing = new Set();   // not in this browser; tried again once an image is saved
  const loading = new Map();   // hash → Promise<void>
  let previewSeq = 0;
  onImageSaved(() => missing.clear());

  const send = (hash) => {
    if (!loading.has(hash)) {
      loading.set(hash, (async () => {
        try {
          const raster = await loadImage(hash);
          if (!raster) { missing.add(hash); return; }
          await engine.setImage(hash, raster);
          sent.add(hash);
        } catch (err) {
          console.warn('[images]', hash, err);
        } finally {
          loading.delete(hash);
        }
      })());
    }
    return loading.get(hash);
  };
  /** null when the worker has everything the design needs, else a promise. */
  const ensure = (design) => {
    const todo = imageHashes(design).filter((h) => !sent.has(h) && !missing.has(h));
    return todo.length ? Promise.all(todo.map(send)) : null;
  };

  return {
    ...engine,
    preview(design, printer) {
      const seq = ++previewSeq;
      const wait = ensure(design);
      if (!wait) return engine.preview(design, printer);
      return wait.then(() => (seq === previewSeq ? engine.preview(design, printer) : null));
    },
    print(design, printer) {
      const wait = ensure(design);
      return wait ? wait.then(() => engine.print(design, printer)) : engine.print(design, printer);
    },
    gcode(design, printer, onProgress) {
      const wait = ensure(design);
      return wait ? wait.then(() => engine.gcode(design, printer, onProgress)) : engine.gcode(design, printer, onProgress);
    },
    cad(design, format) {
      const wait = ensure(design);
      return wait ? wait.then(() => engine.cad(design, format)) : engine.cad(design, format);
    },
    /** For uploads: the worker gets the image now, and it isn't sent again. */
    async setImage(hash, raster) {
      await engine.setImage(hash, raster);
      sent.add(hash);
      missing.delete(hash);
    },
    dispose: () => engine.dispose(),
  };
}

function showFatal(message) {
  const box = $('#webgl-message');
  if (!box) return;
  box.querySelector('h2').textContent = 'Vase Creator could not start';
  box.querySelector('p').textContent = message;
  document.documentElement.classList.add('no-webgl');
}

async function boot() {
  if (document.documentElement.classList.contains('no-webgl')) return;

  const [layerDoc, presetsDoc, db] = await Promise.all([
    fetchJson('library/layer-patterns.json'),
    fetchJson('library/presets.json'),
    openDb(),
  ]);
  // One library for the engine and the UI: the starter Patterns
  // (layerPatterns, core/layer-pattern.js).
  const library = { layerPatterns: layerDoc.patterns || [] };
  useDb(db);
  const presets = presetsDoc.presets || [];
  const [persisted, savedPrinter] = await Promise.all([db.loadHistory(), db.get('settings', 'printer')]);

  // Old steps go through normalise too, so a schema migration applies to them.
  // A step that can't be read is dropped; the pointer follows its step, not its index.
  // loadHistory puts the pointer on the newest step: "Last design" is the
  // newest step any tab made (design §8.4).
  let history = null;
  if (persisted) {
    const pointerId = persisted.steps[persisted.pointer]?.id;
    const steps = persisted.steps
      .map((s) => ({ ...s, design: safeNormalise(s.design) }))
      .filter((s) => s.design);
    const pointer = steps.findIndex((s) => s.id === pointerId);
    if (steps.length) history = { steps, pointer: pointer >= 0 ? pointer : steps.length - 1 };
  }
  // Tabs tell each other about new steps, so each history column shows them all.
  let channel = null;
  try {
    if (db.persistent && typeof BroadcastChannel === 'function') channel = new BroadcastChannel('vc2-history');
  } catch { /* not supported */ }
  // A first visit opens Classic vase as a shape, like any preset (D30, C29):
  // no Pattern yet.
  const first = shapeOnly(normaliseDesign(presets[0]));
  const store = createStore({
    design: first,
    history,
    printer: loadPrinter(savedPrinter),
    label: `Opened: ${first.meta?.name || 'preset'}`,
    db,
    channel,
    normalise: safeNormalise,
  });

  // ---------- Engine, renderer, handles ----------

  const canvas = $('#scene');
  const view = $('#view');
  const panel = $('#panel');
  const chips = $('#chips');
  const rightcol = $('#rightcol');

  const engine = withImages(createEngine({ library }));
  const renderer = new BeadRenderer(canvas);

  let dragging = false;
  function removeKnot(index) {
    let removed = false;
    store.apply('Remove point', (d) => { removed = deleteKnot(d, index); });
    if (removed) store.setView({ selectedKnot: null });
  }
  const handles = createProfileHandles(renderer, $('#overlay'), {
    onDrag(index, value) {
      dragging = true;
      store.change('Move point', (d) => { moveKnot(d, index, value); });
    },
    onCommit() {
      dragging = false;
      store.commit();
    },
    onAdd(value) {
      let index = -1;
      store.apply('Add point', (d) => { index = insertKnot(d, value); });
      store.setView({ selectedKnot: index >= 0 ? index : store.state.view.selectedKnot });
    },
    onRemove: removeKnot,
    onSelect(index) {
      store.setView({ selectedKnot: index });
    },
  });

  // Handles on the pot (mobile stage M7, M8): where the Pattern runs in
  // Pattern (D41), the seam grip in Layers & seam. One history step per drag.
  const gizmos = createGizmos(renderer, $('#overlay'), {
    onRange(target, which, z) {
      dragging = true;
      store.change(`Pattern ${which}`, (d) => {
        const range = d.pattern;
        if (!range) return;
        const lh = d.layers.layerHeightMm;
        if (which === 'from') range.fromMm = Math.max(0, Math.min(z, range.toMm - lh));
        else range.toMm = Math.min(d.form.height, Math.max(z, range.fromMm + lh));
      });
    },
    onSeam(angle) {
      dragging = true;
      store.change('Seam angle', (d) => { d.layers.seam.angleDeg = angle; });
    },
    onCommit() {
      dragging = false;
      store.commit();
    },
  });

  const ctx = {
    store,
    library,
    presets,
    engine,
    renderer,
    handles,
    db,
    thumbnailFor,
    /** Fit the camera once the next preview arrives (after opening a design). */
    requestFit() { fitPending = true; },
    /**
     * The store's design object store.state.result was computed from (the
     * size chip matches them up). In Shape the result is of its plain copy,
     * but this is still the store's object.
     */
    resultDesign: () => shownDesign,
    /** Whether store.state.result is of the shape copy (Shape, D29, D36): no Pattern in it. */
    resultIsPlain: () => shownPlain,
    designs: null,
    /** The open 2D editor's own undo and redo (ui/pattern-editor.js), or null; the top bar uses it. */
    editorHistory: null,
  };

  // ---------- Previews ----------
  // The engine answers only the newest request. Live previews must win over
  // thumbnail renders (presets, design files), so thumbnails wait until the
  // live preview is idle, and a live request a thumbnail cancelled is re-sent.

  // In Shape the pot is shown as a shape (D29, D36): the engine gets a copy of
  // the design without its Pattern (with its Morph), and
  // that copy also drives the size chip and the warnings there. From Pattern
  // on, the design goes as it is.

  let liveSeq = 0;
  let livePending = 0;
  let idleWaiters = [];
  let shownDesign = null;      // the store's design object the newest shown result was made from
  let shownPlain = false;      // that result is of its plain copy
  let requestedPlain = null;   // the newest request is of a plain copy
  let fitPending = true;       // fit the camera when the next result arrives (load, open)
  const wantsPlain = () => store.state.view.step === 'shape';

  function requestPreview() {
    const seq = ++liveSeq;
    const { design, printer } = store.state;
    const plain = wantsPlain();
    requestedPlain = plain;
    livePending += 1;
    engine.preview(plain ? shapeOnly(design) : design, printer)
      .then((result) => {
        // A newer request of the other kind (a step change) is on its way: skip this one.
        if (result && plain !== wantsPlain() && seq !== liveSeq) return;
        if (result) {
          shownDesign = design;
          shownPlain = plain;
          store.setResult(result);
        } else if (seq === liveSeq) {
          // Superseded by a thumbnail request, not by a newer edit.
          requestPreview();
        }
      })
      .catch((err) => {
        console.error('[preview]', err);
        // A dead worker answers nothing again; say so instead of freezing the pot.
        if (err?.engineBroken) showFatal('The 3D preview stopped working. Reload the page to continue; your design and its history are kept.');
      })
      .finally(() => {
        livePending -= 1;
        if (livePending === 0) {
          const waiters = idleWaiters;
          idleWaiters = [];
          waiters.forEach((fn) => fn());
        }
      });
  }

  function whenLiveIdle() {
    return livePending === 0 ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve));
  }

  /** A white bead thumbnail of any design, without disturbing the live view. */
  async function thumbnailFor(design) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await whenLiveIdle();
      const result = await engine.preview(design, store.state.printer);
      if (result) return renderer.thumbnail(result);
    }
    return null;
  }

  // ---------- History thumbnails ----------
  // Once the preview of a committed step is on screen and nothing changed for
  // a moment, take its picture. Never during a drag, never in Print. History
  // always shows the finished pot (C32): while the pot on screen is plain
  // (Shape), the picture comes from a separate full preview instead, which
  // waits until the live preview is idle.

  let thumbTimer = 0;
  function scheduleStepThumb() {
    clearTimeout(thumbTimer);
    if (dragging || store.state.view.mode !== 'design') return;
    const step = store.currentStep();
    if (step.thumb) return;
    const id = step.id;
    thumbTimer = setTimeout(async () => {
      const now = store.currentStep();
      if (dragging || now.id !== id || now.thumb || store.state.view.mode !== 'design') return;
      if (shownDesign !== store.state.design || designKey(store.state.design) !== designKey(now.design)) return;
      try {
        if (shownPlain) {
          const blob = await thumbnailFor(now.design);
          const step = store.history().find((s) => s.id === id);
          if (blob && step && !step.thumb) store.setThumb(id, blob);
          return;
        }
        const blob = await renderer.thumbnail();
        if (blob && store.currentStep().id === id) store.setThumb(id, blob);
      } catch (err) {
        console.warn('[thumbnail]', err);
      }
    }, THUMB_SETTLE_MS);
  }

  // Steps made in quick succession move on before their picture is taken.
  // They get one later, newest first and one at a time, but only after a
  // quiet moment: never during a drag, in Print or while the Designs
  // screen renders its own tiles.
  let backfillTimer = 0;
  let backfilling = false;
  const thumbFailed = new Set();
  function scheduleBackfill() {
    clearTimeout(backfillTimer);
    backfillTimer = setTimeout(backfillThumb, BACKFILL_IDLE_MS);
  }
  async function backfillThumb() {
    if (backfilling) return;
    if (dragging || store.state.view.mode !== 'design' || ctx.designs?.isOpen) { scheduleBackfill(); return; }
    const currentId = store.currentStep().id;
    const step = store.history().slice(0, BACKFILL_STEPS).find((s) => !s.thumb && s.id !== currentId && !thumbFailed.has(s.id));
    if (!step) return;
    backfilling = true;
    try {
      const blob = await thumbnailFor(step.design);
      if (blob && !step.thumb) store.setThumb(step.id, blob);   // emits 'history', which schedules the next
    } catch (err) {
      console.warn('[thumbnail]', err);
      // A step whose preview fails must not hold up the ones behind it.
      thumbFailed.add(step.id);
      scheduleBackfill();
    } finally {
      backfilling = false;
    }
  }

  // ---------- Layout ----------

  // The 2D editor (ui/pattern-editor.js) stands in for the step frame while
  // it is open: the pot fits beside it (desktop) or above it (phone).
  const editorEl = $('#editor');
  const chrome = () => (document.documentElement.classList.contains('is-editing') && editorEl ? editorEl : panel);

  function viewportRect() {
    const v = view.getBoundingClientRect();
    const c = chips.getBoundingClientRect();
    const r = rightcol.getBoundingClientRect();
    const gap = 8;
    if (PHONE.matches) {
      // The stage (mobile stage M1): the canvas fills the window and the pot
      // fits between the top bar (and the chips, wherever they sit) and the
      // dock or sheet, clear of the history column. Nothing covers it (D22).
      const bar = $('header.topbar').getBoundingClientRect();
      const p = chrome().getBoundingClientRect();
      const y = Math.max(0, Math.max(bar.bottom, c.bottom) - v.top + gap);
      const bottom = Math.min(v.height, p.top - v.top) - gap;
      return { x: gap, y, width: Math.max(40, r.left - v.left - gap * 2), height: Math.max(40, bottom - y) };
    }
    const p = chrome().getBoundingClientRect();
    const x = p.right - v.left + gap;
    const y = c.bottom - v.top + gap;
    return { x, y, width: Math.max(40, r.left - v.left - gap - x), height: Math.max(40, v.height - y - gap) };
  }

  /** @param {false | 'reset' | 'keep'} fit  refit the camera; 'keep' keeps the orbit angle */
  function layout(fit) {
    // The warnings, size and history lists open over the dock or sheet on a
    // phone, never over the pot (D22): they get the height below the stage.
    if (PHONE.matches) {
      document.documentElement.style.setProperty('--bottom-chrome', `${Math.round(Math.max(120, innerHeight - chrome().getBoundingClientRect().top))}px`);
    }
    renderer.resize();
    renderer.setViewport(viewportRect());
    if (fit) renderer.fitCamera({ keepDirection: fit === 'keep' });
    renderer.requestRender();
  }

  // A layout change (window size, the phone layout) refits the pot into its
  // region, keeping the angle the user turned it to.
  let resizeFrame = 0;
  let resizeFitTimer = 0;
  function onResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => layout(false));
    clearTimeout(resizeFitTimer);
    resizeFitTimer = setTimeout(() => layout('keep'), 200);
  }
  addEventListener('resize', onResize);
  PHONE.addEventListener('change', onResize);
  // On a phone the dock and the sheet change height (a sheet opened, the tip
  // closed): the pot refits into the stage that is left.
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(view);
  resizeObserver.observe(panel);
  if (editorEl) resizeObserver.observe(editorEl);

  // ---------- Store wiring ----------

  // Only when it changes: setHighlight redraws the whole pot, and view changes
  // (a point picked on touch-down, a step or a part) mustn't cost a frame.
  let shownHighlight = null;
  function applyHighlight() {
    const { view: v, result } = store.state;
    const w = v.highlight != null ? result?.warnings?.find((x) => x.id === v.highlight) : null;
    const key = w && w.bit ? `${w.bit}|${w.severity}` : '';
    if (key === shownHighlight) return;
    shownHighlight = key;
    if (w && w.bit) renderer.setHighlight(w.bit, w.severity === 'error' ? 'error' : 'warning');
    else renderer.setHighlight(0, null);
  }

  // Each step shows only its own aids on the pot (§7.2): the drag points in
  // Shape, the seam line in Layers & seam (C13), the bed and the final walls
  // in Print. Switching steps never moves the camera and never adds a history
  // step; it costs at most one preview, when the pot turns plain or full.
  let shownStep = null;
  let shownEditor = false;
  function applyStep() {
    const { step, selectedKnot } = store.state.view;
    const was = shownStep;
    shownStep = step;
    handles.setVisible(step === 'shape' && !store.state.view.editor);
    applyGizmos();
    renderer.setSeamMarker(step === 'layers');
    renderer.setBed(step === 'print' ? bedOf(store.state.printer) : null);
    if (was == null) return;
    if (was === 'print' && step !== 'print') {
      // Print may have drawn final walls: no step thumbnail of those, and
      // the centreline preview comes back.
      shownDesign = null;
      requestPreview();
    } else if (requestedPlain !== null && requestedPlain !== wantsPlain()) {
      requestPreview();
    }
    // Delete must not remove a point you can't see.
    if (was === 'shape' && step !== 'shape' && selectedKnot != null) store.setView({ selectedKnot: null });
  }

  // The handles on the pot for this step (M7, M8): the Pattern's range in
  // Pattern once there is one, the seam grip in Layers & seam; none in Print. While the 2D
  // editor is open the pot is a live view only: no handles, so nothing but
  // the editor's session lands in history meanwhile (D46).
  function applyGizmos() {
    const { view: v, design } = store.state;
    let mode = null;
    if (v.editor) mode = null;
    else if (v.mode === 'design' && v.step === 'layers') mode = 'seam';
    else if (v.mode === 'design' && v.step === 'pattern' && design.pattern) mode = 'pattern';
    gizmos.setMode(mode);
    if (mode) gizmos.update(design, store.state.result);
  }

  let printerTimer = 0;
  function savePrinter() {
    printerTimer = 0;
    db.put('settings', 'printer', store.state.printer);
  }
  // A printer edit made just before the tab closes must not be lost.
  const flushPrinter = () => { if (printerTimer) { clearTimeout(printerTimer); savePrinter(); } };
  addEventListener('pagehide', flushPrinter);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPrinter(); });

  // The app opens straight into the designer (issue #2): a first visit on the
  // first preset, a later one on the last design. A one-time tip points at
  // Designs in the top bar (ui/designs-tip.js); the screen never opens by itself.
  store.subscribe((state, what) => {
    if (what.has('design')) applyGizmos();
    if (what.has('design') || what.has('printer')) {
      clearTimeout(thumbTimer);
      requestPreview();
      const knots = state.design?.form?.profile?.knots;
      if (state.view.selectedKnot != null && knots && state.view.selectedKnot >= knots.length) {
        store.setView({ selectedKnot: null });
      }
    }
    if (what.has('printer')) {
      if (state.view.step === 'print') renderer.setBed(bedOf(state.printer));
      clearTimeout(printerTimer);
      printerTimer = setTimeout(savePrinter, PRINTER_SAVE_MS);
    }
    if (what.has('result') && state.result) {
      // In Print the print panel owns what the renderer shows.
      if (state.view.mode === 'design') {
        renderer.setToolpath(state.result);
        gizmos.update(state.design, state.result);
        handles.update(state.design, state.result.profileLine);
        applyHighlight();
        if (fitPending) {
          fitPending = false;
          layout('reset');
        }
      }
      scheduleStepThumb();
      scheduleBackfill();
    }
    if (what.has('history')) {
      scheduleStepThumb();
      scheduleBackfill();
    }
    if (what.has('view')) {
      applyHighlight();
      handles.setSelected(state.view.selectedKnot);
      if (state.view.step !== shownStep) applyStep();
      else if (!!state.view.editor !== shownEditor) {
        handles.setVisible(state.view.step === 'shape' && !state.view.editor);
        applyGizmos();
      }
      shownEditor = !!state.view.editor;
    }
  });

  // ---------- Keyboard ----------

  addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    if (document.querySelector('dialog[open]') || store.state.view.mode !== 'design') return;
    // Delete removes the selected point, also after a click on the pot took
    // the focus off its handle (the focused handle handles the key itself).
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = store.state.view.selectedKnot;
      const idle = !document.activeElement || document.activeElement === document.body;
      if (i != null && idle && store.state.view.step === 'shape') {
        e.preventDefault();
        removeKnot(i);
      }
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    } else if ((key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.shiftKey)) {
      e.preventDefault();
      store.redo();
    }
  });

  // ---------- UI ----------

  const lastDesign = history
    ? { design: structuredClone(store.state.design), savedId: store.state.savedId, thumb: store.currentStep().thumb }
    : null;
  ctx.designs = mountDesigns($('#designs'), ctx, { lastDesign });

  // A section that fails to mount must not take the whole app down.
  const mount = (name, fn) => {
    try { return fn(); } catch (err) { console.error(`[${name}] failed to mount`, err); return null; }
  };
  mount('topbar', () => mountTopbar($('header.topbar'), ctx));
  mount('chips', () => mountChips(chips, ctx));
  mount('history', () => mountHistory(rightcol, ctx));
  const steps = mount('steps', () => mountSteps(panel, ctx));
  mount('designs-tip', () => mountDesignsTip(steps?.tipHost ?? panel, ctx));

  applyStep();
  layout(false);
  requestPreview();

  // Handy for debugging in the console; not an API.
  window.vc2 = ctx;
}

boot().catch((err) => {
  console.error('[boot]', err);
  showFatal('Something went wrong while loading. Please reload the page.');
});
