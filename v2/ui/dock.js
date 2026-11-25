// The phone dock (mobile stage M3): the slim strip above the step bar that
// replaces the controls area, so the pot gets the stage. From the top down:
//   the grabber (tap or swipe up: all settings, ui/steps.js's sheet),
//   the adjuster, one control for the chosen tool: the ruler dial
//     (ui/dial.js), option buttons, the swatch carousel or a short hint,
//   the tool row (ui/dock-tools.js), chips with their values, and Next.
// The adjuster keeps one height whatever the tool, so the pot never jumps.
// Every edit goes through the store like the sheet's controls.

import { h } from './controls.js';
import { createDial } from './dial.js';
import { toolsFor, currentTool, toolName, slotInfo } from './dock-tools.js';
import { depthLocked } from './sections/shape.js';
import { PLAIN } from '../core/patterns.js';
import { listPatterns, onPatternsChanged } from '../store/assets.js';
import {
  IMAGE_ACCEPT, findEntry, pickPattern, importImageFile, openEditor, drawEntry, mineEntries, loadImages,
} from './pattern-actions.js';

const SWATCH = 52;
const CHIP_SWATCH = 26;
const MSG_MS = 4500;
const SWIPE_PX = 24;

const LOCK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const UNLOCK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 5.8-1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const SHEET_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * @param {HTMLElement} el  the dock element (ui/steps.js puts it in the panel)
 * @param {object} ctx  main.js's ctx
 * @param {{ openSheet(part?: string): void, next(): void, nextName(stepId: string): string | null }} frame
 * @returns {{ tipSlot: HTMLElement, setActive(on: boolean): void, destroy(): void }}
 */
export function mountDock(el, ctx, frame) {
  const { store, library } = ctx;
  let active = false;
  let saved = [];

  // ---------- Frame ----------

  const tipSlot = h('div', { class: 'dock-tip' });
  const grabber = h('button', { type: 'button', class: 'dock-grabber', 'aria-label': 'Show all settings', 'aria-expanded': 'false', title: 'All settings' }, [
    h('span', { class: 'grabber-pill', 'aria-hidden': 'true' }),
  ]);
  const adjust = h('div', { class: 'dock-adjust', role: 'tabpanel', id: 'dock-adjust' });
  const toolRow = h('div', { class: 'dock-tools', role: 'tablist' });
  const nextLabel = h('span', { text: 'Next' });
  const next = h('button', { type: 'button', class: 'btn btn-primary dock-next' }, [nextLabel, h('span', { 'aria-hidden': 'true', text: ' ›' })]);
  const msg = h('div', { class: 'dock-msg', role: 'status', 'aria-live': 'polite', hidden: true });
  el.classList.add('dock');
  el.setAttribute('aria-label', 'Tools');
  el.replaceChildren(tipSlot, grabber, adjust, h('div', { class: 'dock-row' }, [toolRow, next]), msg);

  next.addEventListener('click', () => frame.next());

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
      store.change(dialLabel(t), (d) => t.set(d, v, store.state));
    },
    onCommit: () => store.commit(),
  });
  const dialLabel = (t) => t.dial(store.state).label;

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
    lock.setAttribute('aria-label', locked ? 'Depth follows width. Unlock it' : 'Lock depth to width');
    lock.title = lock.getAttribute('aria-label');
    lock.innerHTML = locked ? LOCK_ICON : UNLOCK_ICON;
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

  // ---------- The swatch carousel (M9) ----------

  const carousel = h('div', { class: 'dock-carousel', role: 'group' });
  const fileInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'visually-hidden', tabIndex: -1, 'aria-hidden': 'true' });
  let tiles = [];
  let tilesKey = '';
  let carouselSlot = null;

  const swatchTile = (id, name, extraClass = '') => {
    const canvas = h('canvas', { class: 'dock-swatch-canvas', width: 1, height: 1, 'aria-hidden': 'true' });
    const btn = h('button', { type: 'button', class: `dock-swatch ${extraClass}`, title: name, 'aria-pressed': 'false' }, [
      canvas, h('span', { class: 'dock-swatch-name', text: name }),
    ]);
    btn.addEventListener('click', () => pickPattern(ctx, carouselSlot, id, saved));
    return { id, btn, canvas, drawn: '' };
  };
  const actionTile = (cls, glyph, name, label, onClick) => {
    const btn = h('button', { type: 'button', class: `dock-swatch dock-swatch--action ${cls}`, 'aria-label': label, title: label }, [
      h('span', { class: 'dock-swatch-add', 'aria-hidden': 'true', text: glyph }),
      h('span', { class: 'dock-swatch-name', text: name }),
    ]);
    btn.addEventListener('click', onClick);
    return btn;
  };
  const imageTile = actionTile('dock-swatch--image', '+', 'Image', 'Use an image as a pattern', () => {
    loadImages().catch(() => {}); // warm up while the picker is open
    fileInput.value = '';
    fileInput.click();
  });
  const makeTile = actionTile('dock-swatch--make', '✎', 'Make', 'Make your own pattern', () => {
    openEditor(ctx, carouselSlot, { findRecipe: (id) => findEntry(library, id, store.state.design.assets, saved), onSaved: refreshSaved })
      .catch((err) => {
        console.warn('Pattern editor not loaded', err);
        say('The pattern editor didn’t load. Reload the page to try again.');
      });
  });
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
      if (s === 'b') {
        const none = swatchTile(null, 'None', 'dock-swatch--none');
        none.canvas.replaceWith(h('span', { class: 'dock-swatch-none', 'aria-hidden': 'true' }));
        none.canvas = null;
        tiles.push(none);
      }
      for (const p of library.patterns) tiles.push({ ...swatchTile(p.id, p.name), entry: p });
      tiles.push({ ...swatchTile(PLAIN.id, PLAIN.name), entry: PLAIN });
      const mineTiles = mine.map((e) => ({ ...swatchTile(e.id, e.name, 'dock-swatch--mine'), entry: e }));
      if (mineTiles.length) mineTiles[0].btn.classList.add('is-first-mine');
      tiles.push(...mineTiles);
      carousel.replaceChildren(...tiles.map((t) => t.btn), imageTile, makeTile, fileInput);
      carousel.setAttribute('aria-label', `Patterns for ${s.toUpperCase()}`);
    }
    const slot = d.surface[s];
    let selected = null;
    for (const t of tiles) {
      const on = slot ? t.id === slot.pattern : t.id === null;
      t.btn.setAttribute('aria-pressed', String(on));
      if (on) selected = t.btn;
      if (t.canvas && t.entry) drawEntry(t, t.entry, on && t.entry.own ? slot : null, d, SWATCH, () => update(store.state));
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

  function chipFor(t) {
    const name = h('span', { class: 'dock-chip-name' });
    const value = h('span', { class: 'dock-chip-value' });
    const btn = h('button', { type: 'button', class: `dock-chip dock-chip--${t.kind}`, role: 'tab', id: `dock-tool-${t.id}`, 'aria-controls': adjust.id }, [h('span', { class: 'dock-chip-text' }, [name, value])]);
    btn.dataset.tool = t.id;
    let swatch = null;
    if (t.kind === 'patterns') {
      swatch = { canvas: h('canvas', { class: 'dock-chip-swatch', width: 1, height: 1, 'aria-hidden': 'true' }), drawn: '' };
      btn.prepend(swatch.canvas);
    }
    if (t.kind === 'sheet') btn.insertAdjacentHTML('beforeend', `<span class="dock-chip-more" aria-hidden="true">${SHEET_ICON}</span>`);
    btn.addEventListener('click', () => pick(t));
    return { btn, name, value, swatch };
  }

  function pick(t) {
    const step = store.state.view.step;
    const patch = { tools: { ...(store.state.view.tools || {}), [step]: t.id } };
    if (t.kind === 'patterns') patch.slot = t.slot;
    store.setView(patch);
  }

  toolRow.addEventListener('keydown', (e) => {
    const list = [...toolRow.querySelectorAll('.dock-chip')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: list[(i + 1) % list.length], ArrowLeft: list[(i + list.length - 1) % list.length], Home: list[0], End: list[list.length - 1] }[e.key];
    if (!to) return;
    e.preventDefault();
    to.focus();
    to.click();
  });

  // ---------- Render ----------

  function update(state) {
    if (!active) return;
    const step = state.view.step;
    const list = toolsFor(step, state);
    const cur = currentTool(step, state);

    // Rebuild the chips only when the set of tools changed.
    const key = `${step}|${list.map((t) => t.id).join(',')}`;
    if (key !== rowKey) {
      rowKey = key;
      chips = new Map(list.map((t) => [t.id, chipFor(t)]));
      toolRow.replaceChildren(...[...chips.values()].map((c) => c.btn));
      const title = { shape: 'Shape', pattern: 'Pattern', layers: 'Layers & seam', base: 'Base' }[step] ?? '';
      toolRow.setAttribute('aria-label', `${title} tools`);
    }
    for (const t of list) {
      const c = chips.get(t.id);
      const on = t === cur;
      c.btn.setAttribute('aria-selected', String(on));
      c.btn.tabIndex = on ? 0 : -1;
      if (t.kind === 'patterns') {
        const info = slotInfo(state, library, t.slot, saved);
        setText(c.name, t.slot.toUpperCase());
        setText(c.value, info.name);
        c.btn.setAttribute('aria-label', `Pattern ${t.slot.toUpperCase()}: ${info.name}`);
        c.swatch.canvas.classList.toggle('is-none', !info.slot);
        if (info.entry) drawEntry(c.swatch, { ...info.entry, id: info.slot.pattern }, info.slot, state.design, CHIP_SWATCH, () => update(store.state));
        else if (c.swatch.drawn) {
          c.swatch.drawn = '';
          c.swatch.canvas.getContext('2d')?.clearRect(0, 0, c.swatch.canvas.width, c.swatch.canvas.height);
        }
      } else {
        const name = toolName(t, state);
        const value = safeText(() => t.value(state));
        setText(c.name, name);
        setText(c.value, value);
        c.btn.setAttribute('aria-label', `${name}: ${value}`);
      }
    }

    const nextName = frame.nextName(step);
    next.hidden = !nextName;
    if (nextName) next.setAttribute('aria-label', `Next: ${nextName}`);

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
      dial.configure(safeSpec(t, state));
      dial.setExtra(t.lock ? lock : null);
      if (t.lock) syncLock(state);
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
    } else if (t.kind === 'sheet') {
      hintText.textContent = safeText(() => t.hint(state));
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
      dial.set(spec.value);
      dial.setNote(spec.note || '');
      dial.setDisabled(!!spec.disabled);
      if (t.lock) syncLock(state);
    } else if (t.kind === 'options') {
      renderOptions(state);
    } else if (t.kind === 'patterns') {
      const before = carousel.querySelector('[aria-pressed="true"]');
      const selected = renderCarousel(state, t.slot);
      if (selected !== before) keepInView(carousel, selected);
    } else if (t.kind === 'sheet') {
      setText(hintText, safeText(() => t.hint(state)));
    }
  }

  function renderOptions(state) {
    const t = tool;
    const key = t.id;
    if (key !== optKey) {
      optKey = key;
      optRow.setAttribute('aria-label', toolName(t, state));
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
    setText(optNote, t.note ? safeText(() => t.note(state)) : '');
  }

  function safeSpec(t, state) {
    try { return t.dial(state); } catch (err) {
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
