// Bootstrap for v2: loads the library and presets, restores history from
// IndexedDB, creates the store, the engine client, the bead renderer and the
// profile handles, and mounts the UI into the DOM regions of index.html
// (ARCHITECTURE.md, "UI contracts").

import { createStore } from './store/store.js';
import { openDb } from './store/db.js';
import { normaliseDesign, moveKnot, insertKnot, deleteKnot } from './core/design.js';
import * as printerModule from './core/printer.js';
import { createEngine } from './worker/client.js';
import { BeadRenderer } from './render/beads.js';
import { createProfileHandles } from './render/handles.js';
import { mountSidebar } from './ui/sidebar.js';
import { mountPrintPanel } from './ui/print.js';
import { mountTopbar } from './ui/topbar.js';
import { mountChips } from './ui/chips.js';
import { mountHistory } from './ui/history.js';
import { mountDesigns } from './ui/designs.js';

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

function showFatal(message) {
  const box = $('#webgl-message');
  if (!box) return;
  box.querySelector('h2').textContent = 'Vase Creator could not start';
  box.querySelector('p').textContent = message;
  document.documentElement.classList.add('no-webgl');
}

async function boot() {
  if (document.documentElement.classList.contains('no-webgl')) return;

  const [library, presetsDoc, db] = await Promise.all([
    fetchJson('library/patterns.json'),
    fetchJson('library/presets.json'),
    openDb(),
  ]);
  const presets = presetsDoc.presets || [];
  const [persisted, savedPrinter] = await Promise.all([db.loadHistory(), db.get('settings', 'printer')]);

  // Old steps go through normalise too, so a schema migration applies to them.
  let history = null;
  if (persisted) {
    const steps = persisted.steps
      .map((s) => ({ ...s, design: safeNormalise(s.design) }))
      .filter((s) => s.design);
    if (steps.length) history = { steps, pointer: Math.min(persisted.pointer, steps.length - 1) };
  }
  const first = normaliseDesign(presets[0]);
  const store = createStore({
    design: first,
    history,
    printer: loadPrinter(savedPrinter),
    label: `Opened: ${first.meta?.name || 'preset'}`,
    db,
  });

  // ---------- Engine, renderer, handles ----------

  const canvas = $('#scene');
  const view = $('#view');
  const panel = $('#panel');
  const chips = $('#chips');
  const rightcol = $('#rightcol');
  const designPanel = $('#design-panel');
  const printPanel = $('#print-panel');

  const engine = createEngine({ library });
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
    designs: null,
  };

  // ---------- Previews ----------
  // The engine answers only the newest request. Live previews must win over
  // thumbnail renders (presets, design files), so thumbnails wait until the
  // live preview is idle, and a live request a thumbnail cancelled is re-sent.

  let liveSeq = 0;
  let livePending = 0;
  let idleWaiters = [];
  let shownDesign = null;      // the design object the newest shown result was made from
  let fitPending = true;       // fit the camera when the next result arrives (load, open)
  let firstResult = true;

  function requestPreview() {
    const seq = ++liveSeq;
    const { design, printer } = store.state;
    livePending += 1;
    engine.preview(design, printer)
      .then((result) => {
        if (result) {
          shownDesign = design;
          store.setResult(result);
        } else if (seq === liveSeq) {
          // Superseded by a thumbnail request, not by a newer edit.
          requestPreview();
        }
      })
      .catch((err) => console.error('[preview]', err))
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
  // a moment, take its picture. Never during a drag.

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
        const blob = await renderer.thumbnail();
        if (blob && store.currentStep().id === id) store.setThumb(id, blob);
      } catch (err) {
        console.warn('[thumbnail]', err);
      }
    }, THUMB_SETTLE_MS);
  }

  // Steps made in quick succession move on before their picture is taken.
  // They get one later, newest first and one at a time, but only after a
  // quiet moment: never during a drag, in Prepare print or while the Designs
  // screen renders its own tiles.
  let backfillTimer = 0;
  let backfilling = false;
  function scheduleBackfill() {
    clearTimeout(backfillTimer);
    backfillTimer = setTimeout(backfillThumb, BACKFILL_IDLE_MS);
  }
  async function backfillThumb() {
    if (backfilling) return;
    if (dragging || store.state.view.mode !== 'design' || ctx.designs?.isOpen) { scheduleBackfill(); return; }
    const currentId = store.currentStep().id;
    const step = store.history().slice(0, BACKFILL_STEPS).find((s) => !s.thumb && s.id !== currentId);
    if (!step) return;
    backfilling = true;
    try {
      const blob = await thumbnailFor(step.design);
      if (blob && !step.thumb) store.setThumb(step.id, blob);   // emits 'history', which schedules the next
    } catch (err) {
      console.warn('[thumbnail]', err);
    } finally {
      backfilling = false;
    }
  }

  // ---------- Layout ----------

  function viewportRect() {
    const v = view.getBoundingClientRect();
    const c = chips.getBoundingClientRect();
    const r = rightcol.getBoundingClientRect();
    const gap = 8;
    if (PHONE.matches) {
      // D22: the pot fits in the top 40 %, clear of the chips and the history column.
      const y = Math.max(0, c.bottom - v.top + 4);
      return { x: gap, y, width: Math.max(40, r.left - v.left - gap * 2), height: Math.max(40, v.height - y - gap) };
    }
    const p = panel.getBoundingClientRect();
    const x = p.right - v.left + gap;
    const y = c.bottom - v.top + gap;
    return { x, y, width: Math.max(40, r.left - v.left - gap - x), height: Math.max(40, v.height - y - gap) };
  }

  /** @param {false | 'reset' | 'keep'} fit  refit the camera; 'keep' keeps the orbit angle */
  function layout(fit) {
    renderer.resize();
    renderer.setViewport(viewportRect());
    if (fit) renderer.fitCamera({ keepDirection: fit === 'keep' });
    renderer.requestRender();
  }

  // A layout change (window size, the phone split) refits the pot into its
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
  new ResizeObserver(onResize).observe(view);

  // ---------- Store wiring ----------

  function applyHighlight() {
    const { view: v, result } = store.state;
    const w = v.highlight != null ? result?.warnings?.find((x) => x.id === v.highlight) : null;
    if (w && w.bit) renderer.setHighlight(w.bit, w.severity === 'error' ? 'error' : 'warning');
    else renderer.setHighlight(0, null);
  }

  function applySeam() {
    const v = store.state.view;
    const open = PHONE.matches ? v.phoneTab === 'layers' : (v.openSections || []).includes('layers');
    renderer.setSeamMarker(v.mode === 'design' && open);
  }
  PHONE.addEventListener('change', applySeam);

  let mode = store.state.view.mode;
  function applyMode() {
    const printing = store.state.view.mode === 'print';
    designPanel.hidden = printing;
    printPanel.hidden = !printing;
    panel.setAttribute('aria-label', printing ? 'Prepare print' : 'Design settings');
    handles.setVisible(!printing);
    applySeam();
    if (mode === 'print' && !printing) requestPreview(); // the print panel may have drawn final walls
    mode = store.state.view.mode;
  }

  let printerTimer = 0;
  store.subscribe((state, what) => {
    if (what.has('design') || what.has('printer')) {
      clearTimeout(thumbTimer);
      requestPreview();
      const knots = state.design?.form?.profile?.knots;
      if (state.view.selectedKnot != null && knots && state.view.selectedKnot >= knots.length) {
        store.setView({ selectedKnot: null });
      }
    }
    if (what.has('printer')) {
      renderer.setBed(bedOf(state.printer));
      clearTimeout(printerTimer);
      printerTimer = setTimeout(() => db.put('settings', 'printer', state.printer), PRINTER_SAVE_MS);
    }
    if (what.has('result') && state.result) {
      // In Prepare print the print panel owns what the renderer shows.
      if (state.view.mode === 'design') {
        renderer.setToolpath(state.result);
        handles.update(state.design, state.result.profileLine);
        applyHighlight();
        if (fitPending) {
          fitPending = false;
          layout('reset');
        }
      }
      if (firstResult) {
        firstResult = false;
        // The Designs screen opens on every visit, once there is a pot to show.
        ctx.designs.open();
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
      applySeam();
      handles.setSelected(state.view.selectedKnot);
      if (state.view.mode !== mode) applyMode();
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
      if (i != null && idle) {
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
  mount('sidebar', () => mountSidebar(designPanel, ctx));
  mount('print', () => mountPrintPanel(printPanel, ctx));

  renderer.setBed(bedOf(store.state.printer));
  applyMode();
  layout(false);
  requestPreview();

  // Handy for debugging in the console; not an API.
  window.vc2 = ctx;
}

boot().catch((err) => {
  console.error('[boot]', err);
  showFatal('Something went wrong while loading. Please reload the page.');
});
