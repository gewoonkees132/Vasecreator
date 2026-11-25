// The chips at the top of the view (design §8.5, D21): the warnings chip and,
// to its right, the size chip. Clicking a warning colours its beads (§11).
// Clicking the size chip opens a small card where the outer height, width and
// depth can be typed or dragged (issue #5, ui/size-fit.js).

import { numberField } from './controls.js';
import { LIMITS } from '../core/design.js';
import { depthLocked } from './sections/shape.js';
import { SIZE_AXES, fitOuterSize } from './size-fit.js';

const PHONE = '(max-width: 760px)';
// A preview that never comes (a broken engine) mustn't keep a size edit open.
const RESULT_WAIT_MS = 8000;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

/** Warnings worth listing: everything a check flagged, not the passes. */
function listed(result) {
  return (result?.warnings || []).filter((w) => w && w.severity !== 'ok');
}

/**
 * Formats a size result as "160 × 124 × 124 mm" (height × width × depth).
 * @param {{ heightMm: number, widthMm: number, depthMm: number } | null | undefined} size
 * @returns {string}
 */
export function formatSize(size) {
  if (!size) return '– × – × – mm';
  const r = (v) => (Number.isFinite(v) ? Math.round(v) : '–');
  return `${r(size.heightMm)} × ${r(size.widthMm)} × ${r(size.depthMm)} mm`;
}

// "1 error", "2 warnings" or "1 error · 2 warnings": an error is never called a warning.
function countLabel(warnings) {
  const errors = warnings.filter((w) => w.severity === 'error').length;
  const others = warnings.length - errors;
  const part = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (errors && others) return `${part(errors, 'error')} · ${part(others, 'warning')}`;
  return errors ? part(errors, 'error') : part(others, 'warning');
}

/**
 * Mounts the warnings and size chips.
 *
 * Picking a warning colours its beads (§11) until the warning is closed or
 * fixed. On a phone the card opens over the controls area, never over the pot
 * (D22), and picking a warning closes it so the controls are free to fix the
 * problem; the chip then shows that beads are coloured, and a tap on it stops.
 * @param {HTMLElement} root  div#chips
 * @param {{ store }} ctx
 * @returns {{ destroy(): void }}
 */
export function mountChips(root, ctx) {
  const { store } = ctx;
  const phone = matchMedia(PHONE);

  const icon = el('span', { class: 'chip-icon', 'aria-hidden': 'true', text: '⚠' });
  const label = el('span', { class: 'chip-long' });
  // The phone top bar has room for a short label only (mobile stage M2): ✓ or the count.
  const short = el('span', { class: 'chip-short', 'aria-hidden': 'true' });
  const clear = el('span', { class: 'chip-clear', 'aria-hidden': 'true', text: '×', hidden: true });
  const chip = el('button', {
    type: 'button', class: 'chip chip-warnings is-none',
    'aria-expanded': 'false', 'aria-controls': 'warn-card',
    onclick: () => {
      if (!card.hidden) closeCard();
      else if (store.state.view.highlight != null) store.setView({ highlight: null });
      else openCard();
    },
  }, [icon, label, short, clear]);

  const list = el('ul', { class: 'warn-list' });
  const closeBtn = el('button', {
    type: 'button', class: 'icon-close', 'aria-label': 'Close warnings', text: '×',
    onclick: () => closeCard({ focusChip: true }),
  });
  const card = el('div', { class: 'warn-card', id: 'warn-card', role: 'region', 'aria-label': 'Warnings', hidden: true }, [
    el('div', { class: 'warn-card-head' }, [el('span', { text: 'Warnings' }), closeBtn]),
    list,
    el('p', { class: 'warn-hint' }, [
      el('span', { class: 'label-desk', text: 'Click a warning to show where it is on the pot.' }),
      el('span', { class: 'label-phone', text: 'Tap a warning to show where it is on the pot.' }),
    ]),
  ]);
  // The chip's own label changes silently; a polite live region says when
  // the count changes (only then, not on every preview).
  const announce = el('span', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const wrap = el('div', { class: 'chip-wrap' }, [chip, card, announce]);

  // The size chip opens the size card. Not a live region: it changes on every
  // preview during a drag, which would flood a screen reader.
  const sizeText = el('span');
  // The chip's flex gap spaces the unit.
  const sizeUnit = el('span', { class: 'chip-unit', text: 'mm' });
  const sizeChip = el('button', {
    type: 'button', class: 'chip chip-size',
    'aria-expanded': 'false', 'aria-controls': 'size-card',
    onclick: () => (sizeCard.hidden ? openSize() : closeSize({ focusChip: true })),
  }, [sizeText, sizeUnit]);
  const fields = {};
  for (const axis of Object.keys(SIZE_AXES)) {
    const lim = LIMITS[axis] ?? { min: 1, max: 600 };
    fields[axis] = numberField({
      label: SIZE_AXES[axis].name, unit: 'mm', min: lim.min, max: lim.max + 40, step: 1, decimals: 0, value: NaN, info: '',
      onInput: (v) => sizeInput(axis, v),
      onCommit: (v) => sizeCommit(axis, v),
    });
  }
  const sizeClose = el('button', {
    type: 'button', class: 'icon-close', 'aria-label': 'Close size', text: '×',
    onclick: () => closeSize({ focusChip: true }),
  });
  // In Shape the pot, and so the chip, is the bare form (D29); from Pattern on
  // the pattern is in it, so the same pot can read a few mm wider there.
  const sizeHint = el('p', { class: 'warn-hint' });
  const sizeCard = el('div', { class: 'warn-card size-card', id: 'size-card', role: 'region', 'aria-label': 'Outer size', hidden: true }, [
    el('div', { class: 'warn-card-head' }, [el('span', { text: 'Outer size' }), sizeClose]),
    el('div', { class: 'size-fields' }, Object.values(fields).map((f) => f.el)),
    sizeHint,
  ]);
  const sizeWrap = el('div', { class: 'chip-wrap' }, [sizeChip, sizeCard]);
  root.replaceChildren(wrap, sizeWrap);

  let lastKey = '';
  let lastCount = null;

  function openCard() {
    if (listed(store.state.result).length === 0) return;
    const fromKeyboard = document.activeElement === chip && chip.matches(':focus-visible');
    closeSize();
    card.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    // Keyboard users land in the list.
    if (fromKeyboard) (list.querySelector('button.warn-item') || closeBtn).focus();
    syncChip();
  }

  // Closing the card also stops colouring the beads (§11: until it's closed),
  // except on a phone right after a warning was picked.
  function closeCard({ focusChip = false, keepHighlight = false } = {}) {
    if (card.hidden) return;
    const hadFocus = card.contains(document.activeElement);
    card.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (!keepHighlight && store.state.view.highlight != null) store.setView({ highlight: null });
    if (focusChip || hadFocus) chip.focus({ preventScroll: true });
    syncChip();
  }

  function outside(e) {
    // Leave the card open while the user turns the pot to look at the beads.
    if (e.target.closest?.('#scene, #overlay')) return;
    if (!wrap.contains(e.target)) closeCard();
  }

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeCard({ focusChip: true }); }
  });

  // ---------- Size card ----------

  // A finger on the chip mustn't pop up the keyboard; a mouse or the keyboard
  // lands straight in Height, ready to type.
  let sizePointer = '';
  sizeChip.addEventListener('pointerdown', (e) => { sizePointer = e.pointerType; });

  function openSize() {
    if (store.state.view.mode !== 'design') return;
    closeCard();
    sizeCard.hidden = false;
    sizeChip.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outsideSize, true);
    syncSize(store.state, { values: true });
    if (sizePointer !== 'touch' && sizePointer !== 'pen') fields.height.input.focus();
    sizePointer = '';
  }

  function closeSize({ focusChip = false } = {}) {
    if (sizeCard.hidden) return;
    const hadFocus = sizeCard.contains(document.activeElement);
    // Leaving a field commits what was typed in it (its blur handler).
    if (hadFocus) document.activeElement.blur();
    sizeCard.hidden = true;
    sizeChip.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outsideSize, true);
    if (focusChip || hadFocus) sizeChip.focus({ preventScroll: true });
  }

  function outsideSize(e) {
    // Turning the pot to look at the new size keeps the card open.
    if (e.target.closest?.('#scene, #overlay')) return;
    if (!sizeWrap.contains(e.target)) closeSize();
  }

  sizeCard.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSize({ focusChip: true }); }
  });

  // Resolves with the preview made from exactly this design, or null once
  // the design moved on (another edit) or the engine took too long.
  function resultFor(design) {
    return new Promise((resolve) => {
      let unsubscribe = null;
      let timer = 0;
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe?.();
        resolve(result);
      };
      const check = () => {
        if (store.state.design !== design) done(null);
        else if (store.state.result && ctx.resultDesign?.() === design) done(store.state.result);
      };
      check();
      if (settled) return;
      timer = setTimeout(() => done(null), RESULT_WAIT_MS);
      unsubscribe = store.subscribe((state, what) => {
        if (what.has('result') || what.has('design')) check();
      });
    });
  }

  // Live edits (a drag or arrow keys in a field) move the form by the typed
  // number minus what patterns and the bead add, taken from the last preview.
  // Ending the edit then corrects until the measured size matches.
  let sizeGesture = null;
  let fitToken = 0;
  const stepLabel = (axis) => `Outer ${SIZE_AXES[axis].name.toLowerCase()}`;

  function outerOffset(axis) {
    const ax = SIZE_AXES[axis];
    if (!ax.offset) return 0;
    const measured = store.state.result?.size?.[ax.key];
    const source = ctx.resultDesign?.() || store.state.design;
    return Number.isFinite(measured) ? measured - ax.get(source) : 0;
  }

  function sizeInput(axis, v) {
    if (sizeGesture?.axis !== axis) {
      fitToken += 1; // a correction still running for an older edit stops
      sizeGesture = { axis, offset: outerOffset(axis) };
    }
    const ax = SIZE_AXES[axis];
    store.change(stepLabel(axis), (d) => ax.set(d, v - sizeGesture.offset));
  }

  function sizeCommit(axis, target) {
    sizeGesture = null;
    const token = ++fitToken;
    const ax = SIZE_AXES[axis];
    const live = () => token === fitToken;
    fitOuterSize({
      target,
      x: ax.get(store.state.design),
      m: null,
      tolerance: ax.tolerance(store.state.design),
      apply: (x) => {
        if (live()) store.change(stepLabel(axis), (d) => ax.set(d, x));
        return ax.get(store.state.design);
      },
      measure: async () => {
        if (!live()) return null;
        const result = await resultFor(store.state.design);
        return live() ? result?.size?.[ax.key] ?? null : null;
      },
    }).catch((err) => console.warn('[size]', err))
      .finally(() => {
        // One history step for the whole edit; a newer edit commits its own.
        if (live()) store.commit();
      });
  }

  // The fields only take new numbers from a new preview: a design change
  // alone still carries the old measurements, and echoing them into a field
  // mid-edit would undo what was just typed.
  function syncSize(state, { values = false } = {}) {
    const s = state.result?.size;
    const text = formatSize(s);
    // Thin spaces around ×, so the chip fits the phone top bar (M2).
    sizeText.textContent = text.replace(/ mm$/, '').replace(/ × /g, '\u2009×\u2009');
    const printing = state.view.mode !== 'design';
    const plain = !!ctx.resultIsPlain?.();
    const what = plain ? 'Size of the shape, without its pattern' : 'Size';
    sizeChip.setAttribute('aria-label', printing ? `${what} ${text}` : `${what} ${text}. Change size`);
    sizeChip.title = `${what}: height × width × depth${printing ? '' : '. Click to change it'}`;
    sizeChip.classList.toggle('is-static', printing);
    sizeHint.textContent = plain
      ? 'The outside of the shape, without its pattern. Shape scales to match.'
      : 'The finished outside, patterns included. Shape scales to match.';
    if (printing) closeSize();
    if (sizeCard.hidden) return;
    const locked = depthLocked(state);
    for (const [axis, field] of Object.entries(fields)) {
      if (values && s && Number.isFinite(s[SIZE_AXES[axis].key])) field.set(Math.round(s[SIZE_AXES[axis].key]));
      field.setDisabled(axis === 'depth' && locked);
    }
    fields.depth.setInfo(locked ? 'Follows the width. Unlock it under Shape.' : '');
  }

  function pick(w) {
    const on = store.state.view.highlight !== w.id;
    store.setView({ highlight: on ? w.id : null });
    if (on && phone.matches) closeCard({ focusChip: true, keepHighlight: true });
  }

  function renderList(warnings) {
    const highlight = store.state.view.highlight;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    list.replaceChildren(...warnings.map((w) => {
      const sev = w.severity === 'error' ? 'is-error' : w.severity === 'info' ? 'is-info' : 'is-warn';
      const content = [el('span', { class: 'warn-dot', 'aria-hidden': 'true' }), el('span', { text: w.message || w.id })];
      // A warning with no beads to colour (the layer height ratio) is just text.
      const item = w.bit
        ? el('button', {
          type: 'button', class: `warn-item ${sev}`, 'data-id': w.id,
          'aria-pressed': String(highlight === w.id),
          onclick: () => pick(w),
        }, content)
        : el('div', { class: `warn-item is-static ${sev}` }, content);
      return el('li', {}, [item]);
    }));
    // Re-rendering must not drop keyboard focus.
    if (focused) list.querySelector(`[data-id="${CSS.escape(focused)}"]`)?.focus();
  }

  // When beads are coloured the chip says so, and a tap on it stops that.
  function syncChip() {
    const { view, result } = store.state;
    const warnings = listed(result);
    const n = warnings.length;
    const active = view.highlight != null ? warnings.find((w) => w.id === view.highlight) : null;
    const showing = !!active && card.hidden;
    clear.hidden = !showing;
    chip.classList.toggle('is-active', !!active);
    const count = countLabel(warnings);
    let aria = n === 0 ? 'No warnings' : `${count}, show list`;
    if (showing) aria = `${count}. Showing on the pot: ${active.message || active.id}. Stop showing`;
    chip.setAttribute('aria-label', aria);
    if (showing) chip.title = 'Stop colouring the beads';
    else chip.removeAttribute('title');
  }

  function update(state, what) {
    const warnings = listed(state.result);
    if (what.has('result')) {
      const n = warnings.length;
      const errors = warnings.some((w) => w.severity === 'error');
      label.textContent = n === 0 ? 'No warnings' : countLabel(warnings);
      short.textContent = n === 0 ? '✓' : String(n);
      if (state.result && label.textContent !== lastCount) {
        // Not on the first preview: nothing has changed yet.
        if (lastCount != null) announce.textContent = label.textContent;
        lastCount = label.textContent;
      }
      icon.hidden = n === 0;
      chip.classList.remove('is-none', 'is-error', 'is-warn');
      chip.classList.add(n === 0 ? 'is-none' : errors ? 'is-error' : 'is-warn');
      if (n === 0) closeCard();
      // The problem was fixed: stop colouring beads for a warning that's gone.
      const hl = state.view.highlight;
      if (hl != null && !warnings.some((w) => w.id === hl && w.bit)) store.setView({ highlight: null });
    }
    const key = JSON.stringify([warnings.map((w) => [w.id, w.message, w.severity, w.bit]), state.view.highlight]);
    if (key !== lastKey) {
      lastKey = key;
      renderList(warnings);
    }
    syncChip();
  }

  const unsubscribe = store.subscribe((state, what) => {
    if (what.has('result') || what.has('view')) update(state, what);
    if (what.has('result') || what.has('view') || what.has('design')) syncSize(state, { values: what.has('result') });
  });
  update(store.state, new Set(['result']));
  syncSize(store.state);

  return {
    destroy() {
      unsubscribe();
      fitToken += 1;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('pointerdown', outsideSize, true);
      Object.values(fields).forEach((f) => f.destroy());
      root.replaceChildren();
    },
  };
}
