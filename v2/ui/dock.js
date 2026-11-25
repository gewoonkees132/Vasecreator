// The phone dock (mobile stage M3): the slim strip above the step bar that
// replaces the controls area, so the pot gets the stage. From the top down:
//   the grabber (tap or swipe up: all settings, ui/steps.js's sheet),
//   the adjuster, one control for the chosen tool: the ruler dial
//     (ui/dial.js), option buttons, a swatch carousel or a short hint,
//   the tool row (ui/dock-tools.js), chips with their values, the whole
//     width of the screen: there is no Next, the step emblems below move
//     between steps (pattern studio D49).
// A group tool (Shape's Morph, D36) opens a row of its own: a back button
// that stays put at the left, then the group's toggle (Large · Detailed) and
// its tools, which scroll.
// The adjuster keeps one height whatever the tool, so the pot never jumps.
// Every edit goes through the store like the sheet's controls. Buttons that
// do one task are icons, named by ui/press-label.js labelIcon.

import { h } from './controls.js';
import { createDial } from './dial.js';
import { labelIcon } from './press-label.js';
import { ICONS } from './icons.js';
import { toolsFor, currentTool, toolName, slotInfo, drawingInfo, openGroup } from './dock-tools.js';
import { depthLocked } from './sections/shape.js';
import { PLAIN } from '../core/patterns.js';
import { listPatterns, onPatternsChanged } from '../store/assets.js';
import {
  IMAGE_ACCEPT, pickPattern, importImageFile, openEditor, drawEntry, mineEntries, loadImages,
  pickLayerPattern, layerMineEntries, drawLayerEntry, readoutOf, setDensityFace, editableEntry,
} from './pattern-actions.js';

const SWATCH = 52;
const CHIP_SWATCH = 26;
const MSG_MS = 4500;
const SWIPE_PX = 24;

const LOCK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const UNLOCK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 5.8-1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const SHEET_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BACK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * @param {HTMLElement} el  the dock element (ui/steps.js puts it in the panel)
 * @param {object} ctx  main.js's ctx
 * @param {{ openSheet(part?: string, opts?: { focus?: boolean }): void }} frame
 * @returns {{ tipSlot: HTMLElement, grabber: HTMLElement, setActive(on: boolean): void, destroy(): void }}
 */
export function mountDock(el, ctx, frame) {
  const { store, library } = ctx;
  /** What the tools read besides the state (ui/dock-tools.js). */
  const env = { library };
  let active = false;
  let saved = [];

  // ---------- Frame ----------

  const tipSlot = h('div', { class: 'dock-tip' });
  const grabber = labelIcon(h('button', { type: 'button', class: 'dock-grabber', 'aria-expanded': 'false' }, [
    h('span', { class: 'grabber-pill', 'aria-hidden': 'true' }),
  ]), 'Show all settings');
  const adjust = h('div', { class: 'dock-adjust', role: 'tabpanel', id: 'dock-adjust' });
  // The row scrolls sideways: an open group's toggle, then the chips (the tabs).
  const lead = h('div', { class: 'dock-lead', hidden: true });
  const back = h('button', { type: 'button', class: 'dock-back', hidden: true });
  const tabs = h('div', { class: 'dock-tablist', role: 'tablist' });
  const toolRow = h('div', { class: 'dock-tools' }, [lead, tabs]);
  const msg = h('div', { class: 'dock-msg', role: 'status', 'aria-live': 'polite', hidden: true });
  el.classList.add('dock');
  el.setAttribute('aria-label', 'Tools');
  el.replaceChildren(tipSlot, grabber, adjust, h('div', { class: 'dock-row' }, [back, toolRow]), msg);

  // Tap the grabber, or swipe it up, for all settings.
  let swipe = null;
  grabber.addEventListener('pointerdown', (e) => { swipe = { id: e.pointerId, y: e.clientY, done: false }; });
  grabber.addEventListener('pointermove', (e) => {
    if (!swipe || swipe.id !== e.pointerId || swipe.done) return;
    if (swipe.y - e.clientY > SWIPE_PX) {
      swipe.done = true;
      frame.openSheet();
    }
  });
  grabber.addEventListener('pointerup', () => { if (!swipe?.done) swipe = null; });
  // A click after a swipe that already opened the sheet does nothing more.
  // Focus moves into the sheet only from the keyboard (detail 0).
  grabber.addEventListener('click', (e) => {
    const swiped = swipe?.done;
    swipe = null;
    if (!swiped) frame.openSheet(undefined, { focus: e.detail === 0 });
  });

  let msgTimer = 0;
  function say(text) {
    clearTimeout(msgTimer);
    msg.textContent = text;
    msg.hidden = !text;
    if (text) msgTimer = setTimeout(() => { msg.hidden = true; }, MSG_MS);
  }

  // ---------- Adjusters ----------

  let tool = null;          // the tool the adjuster shows
  let shownStep = null;

  const dial = createDial({
    onInput: (v) => {
      const t = tool;
      if (t?.kind !== 'dial') return;
      store.change(dialLabel(t), (d) => t.set(d, v, store.state, env));
    },
    onCommit: () => store.commit(),
  });
  const dialLabel = (t) => t.dial(store.state, env).label;

  // The depth lock sits left of the value (Depth only).
  const lock = h('button', { type: 'button', class: 'icon-btn lock-btn dock-lock' });
  lock.addEventListener('click', () => {
    if (depthLocked(store.state)) {
      store.setView({ sizeLocked: false });
    } else {
      if ((store.state.design.form.plan.depthRatio ?? 1) !== 1) store.apply('Depth', (d) => { d.form.plan.depthRatio = 1; });
      store.setView({ sizeLocked: true });
    }
  });
  function syncLock(state) {
    const locked = depthLocked(state);
    if (lock.getAttribute('aria-pressed') === String(locked)) return;
    lock.setAttribute('aria-pressed', String(locked));
    labelIcon(lock, locked ? 'Depth follows width. Unlock it' : 'Lock depth to width');
    lock.innerHTML = locked ? LOCK_ICON : UNLOCK_ICON;
  }

  // The density's two faces (D40) sit left of the value: spacing in mm or points per layer.
  const faceButtons = [['spacing', 'mm', 'Set the spacing in mm'], ['points', 'pts', 'Set the points per layer']].map(([by, text, label]) => {
    const b = h('button', { type: 'button', class: 'dock-face-btn', text, 'aria-label': label, title: label, 'aria-pressed': 'false' });
    b.dataset.by = by;
    b.addEventListener('click', () => {
      const d = store.state.design;
      if (!d.pattern || d.pattern.density.by === by) return;
      const r = readoutOf(d, library);
      store.apply('Density', (dd) => setDensityFace(dd, by, r));
    });
    return b;
  });
  const face = h('span', { class: 'dock-face', role: 'group', 'aria-label': 'Density as' }, faceButtons);
  function syncFace(state) {
    const by = state.design.pattern?.density.by ?? 'spacing';
    for (const b of faceButtons) b.setAttribute('aria-pressed', String(b.dataset.by === by));
  }

  // Options: big buttons and a note.
  const optRow = h('div', { class: 'dock-options', role: 'group' });
  const optNote = h('p', { class: 'dock-note' });
  const optBox = h('div', { class: 'dock-optbox' }, [optRow, optNote]);
  let optKey = '';

  // A hint and a button that opens the sheet.
  const hintText = h('p', { class: 'dock-hint-text' });
  const hintBtnLabel = h('span');
  const hintBtn = h('button', { type: 'button', class: 'btn dock-hint-btn' }, [hintBtnLabel]);
  hintBtn.insertAdjacentHTML('beforeend', SHEET_ICON);
  hintBtn.addEventListener('click', (e) => { if (tool?.part) frame.openSheet(tool.part, { focus: e.detail === 0 }); });
  const hintBox = h('div', { class: 'dock-hint' }, [hintText, hintBtn]);

  // ---------- The Detailed morph's swatch carousel (M9) ----------

  const carousel = h('div', { class: 'dock-carousel', role: 'group' });
  const fileInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'visually-hidden', tabIndex: -1, 'aria-hidden': 'true' });
  let tiles = [];
  let tilesKey = '';
  let carouselSlot = null;

  const swatchTile = (id, name, extraClass = '', onPick = () => pickPattern(ctx, carouselSlot, id, saved)) => {
    const canvas = h('canvas', { class: 'dock-swatch-canvas', width: 1, height: 1, 'aria-hidden': 'true' });
    const btn = h('button', { type: 'button', class: `dock-swatch ${extraClass}`, title: name, 'aria-pressed': 'false' }, [
      canvas, h('span', { class: 'dock-swatch-name', text: name }),
    ]);
    btn.addEventListener('click', onPick);
    return { id, btn, canvas, drawn: '' };
  };
  const noneTile = (onPick) => {
    const none = swatchTile(null, 'None', 'dock-swatch--none', onPick);
    none.canvas.replaceWith(h('span', { class: 'dock-swatch-none', 'aria-hidden': 'true' }));
    none.canvas = null;
    return none;
  };
  // A tile that does something rather than pick a swatch: an icon where the
  // swatch would be, and a short name under it like every tile in the row.
  const actionTile = (cls, icon, name, label, onClick) => {
    const mark = h('span', { class: 'dock-swatch-add', 'aria-hidden': 'true' });
    mark.innerHTML = ICONS[icon];
    const btn = labelIcon(h('button', { type: 'button', class: `dock-swatch dock-swatch--action ${cls}` }, [
      mark, h('span', { class: 'dock-swatch-name', text: name }),
    ]), label);
    btn.addEventListener('click', onClick);
    return btn;
  };
  const imageTile = actionTile('dock-swatch--image', 'image', 'Image', 'Use an image as a swatch', () => {
    loadImages().catch(() => {}); // warm up while the picker is open
    fileInput.value = '';
    fileInput.click();
  });
  // The 2D editor (D45, D46): Make starts an empty grid, Edit the drawing in use.
  const edit = (target, mode, from) => {
    openEditor(ctx, target, { mode, saved, returnFocus: from }).catch((err) => {
      console.warn('Editor not loaded', err);
      say('The editor didn’t load. Reload the page to try again.');
    });
  };
  const makeTile = actionTile('dock-swatch--make', 'make', 'Make', 'Make your own swatch', () => edit({ kind: 'detail', slot: carouselSlot }, 'make', makeTile));
  const editTile = actionTile('dock-swatch--edit', 'edit', 'Edit', 'Edit the swatch', () => edit({ kind: 'detail', slot: carouselSlot }, 'edit', editTile));
  const makeDrawingTile = actionTile('dock-swatch--make', 'make', 'Make', 'Make your own pattern', () => edit({ kind: 'pattern' }, 'make', makeDrawingTile));
  const editDrawingTile = actionTile('dock-swatch--edit', 'edit', 'Edit', 'Edit the pattern', () => edit({ kind: 'pattern' }, 'edit', editDrawingTile));
  /** Shows an Edit tile only when the target holds a drawing, named for what it edits. */
  function syncEditTile(tileEl, target, d) {
    const e = editableEntry(d, library, target, saved);
    tileEl.hidden = !e;
    if (!e) return;
    labelIcon(tileEl, e.own || String(e.id).startsWith('user:') ? `Edit ${e.name}` : `Edit a copy of ${e.name}`);
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    imageTile.disabled = true;
    say('Reading the image…');
    try {
      await importImageFile(ctx, file, carouselSlot);
      say('');
    } catch (err) {
      const plain = err?.constructor === Error && err.message;
      if (!plain) console.warn('Image not used', err);
      say(plain ? err.message : 'That image couldn’t be used. Try a PNG, JPEG or WebP file.');
    } finally {
      imageTile.disabled = false;
    }
  });

  function renderCarousel(state, s) {
    const d = state.design;
    const mine = mineEntries(library, d, saved);
    const key = `${s}|${mine.map((e) => `${e.id}|${e.name}`).join(';')}`;
    if (key !== tilesKey) {
      tilesKey = key;
      tiles = [];
      if (s === 'b') tiles.push(noneTile(() => pickPattern(ctx, carouselSlot, null, saved)));
      for (const p of library.patterns) tiles.push({ ...swatchTile(p.id, p.name), entry: p });
      tiles.push({ ...swatchTile(PLAIN.id, PLAIN.name), entry: PLAIN });
      const mineTiles = mine.map((e) => ({ ...swatchTile(e.id, e.name, 'dock-swatch--mine'), entry: e }));
      if (mineTiles.length) mineTiles[0].btn.classList.add('is-first-mine');
      tiles.push(...mineTiles);
      carousel.replaceChildren(...tiles.map((t) => t.btn), imageTile, makeTile, editTile, fileInput);
      carousel.setAttribute('aria-label', `Detailed morph swatches for ${s.toUpperCase()}`);
    }
    const slot = d.form.detail[s];
    syncEditTile(editTile, { kind: 'detail', slot: s }, d);
    let selected = null;
    for (const t of tiles) {
      const on = slot ? t.id === slot.pattern : t.id === null;
      t.btn.setAttribute('aria-pressed', String(on));
      if (on) selected = t.btn;
      if (t.canvas && t.entry) drawEntry(t, t.entry, on && t.entry.own ? slot : null, d, SWATCH, () => update(store.state));
    }
    return selected;
  }

  // ---------- The Pattern's carousel (§3.8): the starters, None, your own ----------

  const drawings = h('div', { class: 'dock-carousel dock-carousel--drawings', role: 'group', 'aria-label': 'Patterns' });
  let drawingTiles = [];
  let drawingsKey = '';

  function renderDrawings(state) {
    const d = state.design;
    const mine = layerMineEntries(library, d);
    const key = mine.map((e) => `${e.id}|${e.name}`).join(';');
    if (key !== drawingsKey || !drawingTiles.length) {
      drawingsKey = key;
      drawingTiles = [];
      for (const p of library.layerPatterns ?? []) {
        drawingTiles.push({ ...swatchTile(p.id, p.name, '', () => pickLayerPattern(ctx, p.id)), entry: p });
      }
      drawingTiles.push(noneTile(() => pickLayerPattern(ctx, null)));
      const mineTiles = mine.map((e) => ({ ...swatchTile(e.id, e.name, 'dock-swatch--mine', () => pickLayerPattern(ctx, e.id)), entry: e }));
      if (mineTiles.length) mineTiles[0].btn.classList.add('is-first-mine');
      drawingTiles.push(...mineTiles);
      drawings.replaceChildren(...drawingTiles.map((t) => t.btn), makeDrawingTile, editDrawingTile);
    }
    syncEditTile(editDrawingTile, { kind: 'pattern' }, d);
    const current = d.pattern?.drawing ?? null;
    const r = readoutOf(d, library);
    let selected = null;
    for (const t of drawingTiles) {
      const on = t.id === current;
      t.btn.setAttribute('aria-pressed', String(on));
      if (on) selected = t.btn;
      // The one on the pot at its own spacing, the others at their defaults.
      if (t.canvas && t.entry) drawLayerEntry(t, t.entry, d, SWATCH, on && r ? r.spacingMinMm : undefined);
    }
    return selected;
  }

  function keepInView(row, b) {
    if (!b || row.scrollWidth <= row.clientWidth) return;
    const left = b.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + b.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = Math.max(0, left - (row.clientWidth - b.offsetWidth) / 2);
    }
  }

  const refreshSaved = () =>
    Promise.resolve(listPatterns())
      .then((list) => {
        saved = Array.isArray(list) ? list : [];
        if (active) update(store.state);
      })
      .catch((err) => console.warn('My patterns not loaded', err));
  refreshSaved();
  const offPatterns = onPatternsChanged(refreshSaved);

  // ---------- The tool row ----------

  let chips = new Map();   // tool id → { btn, name, value, swatch }
  let rowKey = '';

  // An open group: back to the step's tools (an icon, D49), and the group's toggle.
  back.innerHTML = BACK_ICON;
  back.addEventListener('click', () => {
    const step = store.state.view.step;
    store.setView({ tools: { ...(store.state.view.tools || {}), [step]: null } });
  });
  const modes = h('div', { class: 'dock-modes', role: 'group' });
  lead.append(modes);
  let modesKey = '';

  function renderLead(g, state) {
    lead.hidden = back.hidden = !g;
    if (!g) return;
    const t = g.tool;
    labelIcon(back, `Back to the ${t.back} tools`);
    if (modesKey !== t.id) {
      modesKey = t.id;
      modes.setAttribute('aria-label', t.modesLabel || toolName(t, state));
      modes.replaceChildren(...t.modes.map((m) => {
        const b = h('button', { type: 'button', class: 'dock-mode', text: m.label, 'aria-pressed': 'false' });
        b.dataset.mode = m.value;
        b.addEventListener('click', () => store.setView(t.setMode(m.value)));
        return b;
      }));
    }
    for (const b of modes.children) b.setAttribute('aria-pressed', String(b.dataset.mode === g.mode));
  }

  function chipFor(t) {
    const name = h('span', { class: 'dock-chip-name' });
    const value = h('span', { class: 'dock-chip-value' });
    const btn = h('button', { type: 'button', class: `dock-chip dock-chip--${t.kind}`, role: 'tab', id: `dock-tool-${t.id}`, 'aria-controls': adjust.id }, [h('span', { class: 'dock-chip-text' }, [name, value])]);
    btn.dataset.tool = t.id;
    let swatch = null;
    if (t.kind === 'patterns' || t.kind === 'drawings') {
      swatch = { canvas: h('canvas', { class: 'dock-chip-swatch', width: 1, height: 1, 'aria-hidden': 'true' }), drawn: '' };
      btn.prepend(swatch.canvas);
    }
    if (t.kind === 'sheet' || t.kind === 'group') btn.insertAdjacentHTML('beforeend', `<span class="dock-chip-more${t.kind === 'group' ? ' dock-chip-more--group' : ''}" aria-hidden="true">${SHEET_ICON}</span>`);
    btn.addEventListener('click', () => pick(t));
    return { btn, name, value, swatch };
  }

  function pick(t) {
    const step = store.state.view.step;
    const g = openGroup(step, store.state);
    const patch = { tools: { ...(store.state.view.tools || {}), [g ? g.key : step]: t.id } };
    if (t.kind === 'patterns') patch.slot = t.slot;
    store.setView(patch);
  }

  tabs.addEventListener('keydown', (e) => {
    const list = [...tabs.querySelectorAll('.dock-chip')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: list[(i + 1) % list.length], ArrowLeft: list[(i + list.length - 1) % list.length], Home: list[0], End: list[list.length - 1] }[e.key];
    if (!to) return;
    e.preventDefault();
    to.focus();
    to.click();
  });

  function clearSwatch(sw) {
    if (!sw.drawn) return;
    sw.drawn = '';
    sw.canvas.getContext('2d')?.clearRect(0, 0, sw.canvas.width, sw.canvas.height);
  }

  // ---------- Render ----------

  function update(state) {
    if (!active) return;
    const step = state.view.step;
    const g = openGroup(step, state);
    const list = toolsFor(step, state);
    const cur = currentTool(step, state);

    // Rebuild the chips only when the set of tools changed.
    const key = `${step}|${g ? g.key : ''}|${list.map((t) => t.id).join(',')}`;
    if (key !== rowKey) {
      const groupChanged = rowKey.split('|')[1] !== (g ? g.key : '');
      rowKey = key;
      chips = new Map(list.map((t) => [t.id, chipFor(t)]));
      tabs.replaceChildren(...[...chips.values()].map((c) => c.btn));
      const title = g ? toolName(g.tool, state) : ({ shape: 'Shape', pattern: 'Pattern', layers: 'Layers & seam', base: 'Base' }[step] ?? '');
      tabs.setAttribute('aria-label', `${title} tools`);
      if (groupChanged) toolRow.scrollLeft = 0;
    }
    renderLead(g, state);
    for (const t of list) {
      const c = chips.get(t.id);
      const on = t === cur;
      c.btn.setAttribute('aria-selected', String(on));
      c.btn.tabIndex = on ? 0 : -1;
      if (t.kind === 'patterns') {
        const info = slotInfo(state, library, t.slot, saved);
        setText(c.name, t.slot.toUpperCase());
        setText(c.value, info.name);
        c.btn.setAttribute('aria-label', `Detailed morph ${t.slot.toUpperCase()}: ${info.name}`);
        c.swatch.canvas.classList.toggle('is-none', !info.slot);
        if (info.entry) drawEntry(c.swatch, { ...info.entry, id: info.slot.pattern }, info.slot, state.design, CHIP_SWATCH, () => update(store.state));
        else clearSwatch(c.swatch);
      } else if (t.kind === 'drawings') {
        const info = drawingInfo(state, library);
        setText(c.name, toolName(t, state));
        setText(c.value, info.name);
        c.btn.setAttribute('aria-label', `Pattern: ${info.name}`);
        c.swatch.canvas.classList.toggle('is-none', !info.entry);
        if (info.entry) drawLayerEntry(c.swatch, info.entry, state.design, CHIP_SWATCH, readoutOf(state.design, library)?.spacingMinMm);
        else clearSwatch(c.swatch);
      } else {
        const name = toolName(t, state);
        const value = safeText(() => t.value(state, env));
        setText(c.name, name);
        setText(c.value, value);
        c.btn.setAttribute('aria-label', `${name}: ${value}`);
      }
    }

    // The adjuster: switch only when the tool (or its slot) changed.
    const fresh = cur !== tool || step !== shownStep || (cur?.kind === 'patterns' && cur.slot !== carouselSlot);
    tool = cur;
    if (fresh) {
      shownStep = step;
      showAdjuster(state);
      keepInView(toolRow, chips.get(cur?.id)?.btn);
    } else {
      refreshAdjuster(state);
    }
  }

  function showAdjuster(state) {
    const t = tool;
    carouselSlot = null;
    if (!t) { adjust.replaceChildren(); return; }
    if (t.kind === 'dial') {
      const spec = safeSpec(t, state);
      dial.configure(spec);
      configuredLabel = spec.label;
      dial.setExtra(t.lock ? lock : t.face ? face : null);
      if (t.lock) syncLock(state);
      if (t.face) syncFace(state);
      adjust.replaceChildren(dial.el);
    } else if (t.kind === 'options') {
      optKey = '';
      renderOptions(state);
      adjust.replaceChildren(optBox);
    } else if (t.kind === 'patterns') {
      carouselSlot = t.slot;
      const selected = renderCarousel(state, t.slot);
      adjust.replaceChildren(carousel);
      requestAnimationFrame(() => keepInView(carousel, selected));
    } else if (t.kind === 'drawings') {
      const selected = renderDrawings(state);
      adjust.replaceChildren(drawings);
      requestAnimationFrame(() => keepInView(drawings, selected));
    } else if (t.kind === 'sheet') {
      hintText.textContent = safeText(() => t.hint(state, env));
      hintBtnLabel.textContent = t.action || 'Open';
      adjust.replaceChildren(hintBox);
    }
    adjust.setAttribute('aria-labelledby', chips.get(t.id)?.btn.id || '');
  }

  function refreshAdjuster(state) {
    const t = tool;
    if (!t) return;
    if (t.kind === 'dial') {
      const spec = safeSpec(t, state);
      // The density's face changes the dial's whole scale, not just its value.
      if (t.face && spec.label !== configuredLabel) {
        dial.configure(spec);
        configuredLabel = spec.label;
      } else {
        dial.set(spec.value);
        dial.setNote(spec.note || '');
        dial.setDisabled(!!spec.disabled);
      }
      if (t.lock) syncLock(state);
      if (t.face) syncFace(state);
    } else if (t.kind === 'options') {
      renderOptions(state);
    } else if (t.kind === 'patterns') {
      const before = carousel.querySelector('[aria-pressed="true"]');
      const selected = renderCarousel(state, t.slot);
      if (selected !== before) keepInView(carousel, selected);
    } else if (t.kind === 'drawings') {
      const before = drawings.querySelector('[aria-pressed="true"]');
      const selected = renderDrawings(state);
      if (selected !== before) keepInView(drawings, selected);
    } else if (t.kind === 'sheet') {
      setText(hintText, safeText(() => t.hint(state, env)));
    }
  }

  function renderOptions(state) {
    const t = tool;
    const key = t.id;
    if (key !== optKey) {
      optKey = key;
      optRow.setAttribute('aria-label', toolName(t, state));
      // Five words don't fit a phone's width at full size.
      optRow.classList.toggle('dock-options--many', t.options.length > 4);
      optRow.replaceChildren(...t.options.map((o) => {
        const b = h('button', { type: 'button', class: 'dock-opt', text: o.label, 'aria-pressed': 'false' });
        b.dataset.value = o.value;
        b.addEventListener('click', () => {
          if (t.current(store.state) === o.value) return;
          store.apply(t.label ? t.label(o.value) : toolName(t, store.state), (d) => t.choose(d, o.value));
        });
        return b;
      }));
    }
    const current = t.current(state);
    for (const b of optRow.children) b.setAttribute('aria-pressed', String(b.dataset.value === current));
    setText(optNote, t.note ? safeText(() => t.note(state, env)) : '');
  }

  // The label of the dial as last configured: the density's face changes it.
  let configuredLabel = '';
  function safeSpec(t, state) {
    try { return t.dial(state, env); } catch (err) {
      console.error(`[dock] ${t.id}`, err);
      return { label: toolName(t, state), min: 0, max: 1, step: 1, value: 0, disabled: true };
    }
  }

  const unsubscribe = store.subscribe((state, what) => {
    if (what.has('design') || what.has('view')) update(state);
  });

  return {
    tipSlot,
    grabber,
    setActive(on) {
      if (active === !!on) return;
      active = !!on;
      if (active) {
        tool = null;
        update(store.state);
      }
    },
    destroy() {
      unsubscribe();
      offPatterns?.();
      clearTimeout(msgTimer);
      dial.destroy();
      el.replaceChildren();
    },
  };
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function safeText(fn) {
  try { return String(fn() ?? ''); } catch { return ''; }
}
