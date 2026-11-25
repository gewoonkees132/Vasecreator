// The chips at the top of the view (design §8.5, D21): the warnings chip and,
// to its right, the size chip. Clicking a warning colours its beads (§11).
// The warnings card is also the one place for the rules the checks use
// (pattern studio D44): each rule sits under its warning, and the ones
// without a warning wait in a Rules group at the foot (ui/rules.js).
// Clicking the size chip opens a small card where the outer height, width and
// depth can be typed or dragged (issue #5, ui/size-fit.js).

import { numberField } from './controls.js';
import { LIMITS } from '../core/design.js';
import { depthLocked } from './sections/shape.js';
import { SIZE_AXES, fitOuterSize } from './size-fit.js';
import { RULES, cardLayout, ruleLimits, setRule, shownRule } from './rules.js';

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
 * On desktop the card opens over the history column, clear of the pot.
 *
 * The card also sets the rules (D44): each rule's fields sit under its
 * warning, the rest in a Rules group at the foot, so the chip opens the card
 * with no warnings too. Editing a rule is one history step per gesture,
 * colours that rule's beads, and keeps the rule where it is until the card
 * closes. In Print the rules only show (C31).
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
  const none = el('p', { class: 'warn-none', text: 'No warnings', hidden: true });
  const hint = el('p', { class: 'warn-hint' }, [
    el('span', { class: 'label-desk', text: 'Click a warning to show where it is on the pot.' }),
    el('span', { class: 'label-phone', text: 'Tap a warning to show where it is on the pot.' }),
  ]);
  const closeBtn = el('button', {
    type: 'button', class: 'icon-close', 'aria-label': 'Close warnings', text: '×',
    onclick: () => closeCard({ focusChip: true }),
  });

  // The Rules group at the foot: the rules whose warning isn't showing, so
  // every rule can be reached with no warning at all (D44).
  const rulesLabel = el('span', { text: 'Rules' });
  const rulesToggle = el('button', {
    type: 'button', class: 'warn-rules-toggle', 'aria-expanded': 'false', 'aria-controls': 'warn-rules',
    onclick: () => {
      rulesOpen = !rulesOpen;
      rulesPreferred = rulesOpen;
      syncRulesOpen();
    },
  }, [rulesLabel, el('span', { class: 'warn-rules-chevron', 'aria-hidden': 'true' })]);
  const rulesList = el('ul', { class: 'warn-list warn-rules-list', id: 'warn-rules', hidden: true });
  const rulesBox = el('div', { class: 'warn-rules' }, [rulesToggle, rulesList]);
  // C31: in Print the design stays as it was computed, so the rules only show.
  const rulesNote = el('p', { class: 'warn-hint', text: 'Rules change in the design steps, not in Print.', hidden: true });

  const card = el('div', { class: 'warn-card', id: 'warn-card', role: 'region', 'aria-label': 'Warnings', hidden: true }, [
    el('div', { class: 'warn-card-head' }, [el('span', { text: 'Warnings' }), closeBtn]),
    list,
    none,
    hint,
    rulesBox,
    rulesNote,
  ]);

  // One block per rule, made once: a line for its warning (or that it
  // passes) and its fields. Blocks move between the list and the Rules group
  // only while nobody is editing them (ui/rules.js cardLayout).
  let rulesOpen = false;
  let rulesPreferred = false;
  const pinned = new Map();
  const blocks = new Map(RULES.map((rule) => {
    const status = el('div', { class: 'warn-status' });
    const controls = rule.fields.map((field) => numberField({
      label: field.label, unit: field.unit, ...ruleLimits(field), decimals: field.decimals,
      value: shownRule(store.state.design, field), info: field.info,
      onInput: (v) => store.change(field.label, (d) => setRule(d, field, v)),
      onCommit: () => store.commit(),
    }));
    const fields = el('div', { class: 'warn-rule-fields', role: 'group', 'aria-label': `${rule.name} rule` }, controls.map((c) => c.el));
    const li = el('li', { class: 'warn-rule', 'data-rule': rule.id }, [status, fields]);
    // Touching a rule keeps it where it is until the card closes, and shows
    // its beads on the pot, so the colours follow the rule as it changes.
    const hold = () => {
      if (!pinned.has(rule.id)) pinned.set(rule.id, li.parentNode === rulesList ? 'rest' : 'list');
      if (store.state.view.highlight !== rule.warning) store.setView({ highlight: rule.warning });
    };
    fields.addEventListener('pointerdown', hold);
    fields.addEventListener('focusin', hold);
    return [rule.id, { rule, li, status, controls }];
  }));
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

  let lastCount = null;

  // The card opens with or without warnings: with none, it shows the rules.
  function openCard() {
    const fromKeyboard = document.activeElement === chip && chip.matches(':focus-visible');
    closeSize();
    pinned.clear();
    rulesOpen = listed(store.state.result).length === 0 || rulesPreferred;
    renderCard(store.state);
    syncRulesOpen();
    card.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    // Keyboard users land in the list, or on the rules when there's nothing in it.
    if (fromKeyboard) (list.querySelector('button.warn-item') || (rulesBox.hidden ? closeBtn : rulesToggle)).focus();
    syncChip();
  }

  // Closing the card also stops colouring the beads (§11: until it's closed),
  // except on a phone right after a warning was picked.
  function closeCard({ focusChip = false, keepHighlight = false } = {}) {
    if (card.hidden) return;
    const hadFocus = card.contains(document.activeElement);
    // Leaving a rule's field commits what was typed in it (its blur handler).
    if (hadFocus) document.activeElement.blur();
    card.hidden = true;
    pinned.clear();
    chip.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (!keepHighlight && store.state.view.highlight != null) store.setView({ highlight: null });
    if (focusChip || hadFocus) chip.focus({ preventScroll: true });
    syncChip();
  }

  function syncRulesOpen() {
    rulesToggle.setAttribute('aria-expanded', String(rulesOpen));
    rulesList.hidden = !rulesOpen;
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

  function pick(id) {
    const on = store.state.view.highlight !== id;
    store.setView({ highlight: on ? id : null });
    if (on && phone.matches) closeCard({ focusChip: true, keepHighlight: true });
  }

  // A warning's line: a button that colours its beads, plain text when it has
  // no beads to colour (the layer height ratio), or a passing rule's line.
  // The element stays when only its text changes, so focus stays on it.
  function syncItem(holder, warning, okText) {
    const kind = !warning ? 'ok' : warning.bit ? 'button' : 'static';
    let item = holder.firstElementChild;
    if (!item || item.dataset.kind !== kind) {
      const hadFocus = item && item === document.activeElement;
      item = kind === 'button'
        ? el('button', { type: 'button', onclick: (e) => pick(e.currentTarget.dataset.id) })
        : el('div');
      item.dataset.kind = kind;
      item.append(el('span', { class: 'warn-dot', 'aria-hidden': 'true' }), el('span', { class: 'warn-text' }));
      holder.replaceChildren(item);
      if (hadFocus && kind === 'button') item.focus({ preventScroll: true });
    }
    const sev = !warning ? 'is-ok' : warning.severity === 'error' ? 'is-error' : warning.severity === 'info' ? 'is-info' : 'is-warn';
    item.className = `warn-item${kind === 'button' ? '' : ' is-static'} ${sev}`;
    item.dataset.id = warning?.id ?? '';
    item.lastChild.textContent = warning ? (warning.message || warning.id) : okText;
    if (kind === 'button') item.setAttribute('aria-pressed', String(store.state.view.highlight === warning.id));
  }

  // Puts `children` into `parent` in order, moving as little as it can: a
  // rule being edited never leaves the page, so its scrub, its typing and
  // its focus carry on.
  function syncChildren(parent, children) {
    const keep = new Set(children);
    for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
    children.forEach((child, i) => {
      if (parent.children[i] !== child) parent.insertBefore(child, parent.children[i] ?? null);
    });
  }

  const warningItems = new Map();
  function itemLi(warning) {
    let li = warningItems.get(warning.id);
    if (!li) {
      li = el('li');
      warningItems.set(warning.id, li);
    }
    syncItem(li, warning, '');
    return li;
  }

  function blockLi({ rule, warning }) {
    const block = blocks.get(rule.id);
    syncItem(block.status, warning, rule.ok);
    return block.li;
  }

  function renderCard(state) {
    const warnings = listed(state.result);
    const layout = cardLayout(warnings, pinned);
    const listItems = layout.list.map((entry) => (entry.rule ? blockLi(entry) : itemLi(entry.warning)));
    for (const id of [...warningItems.keys()]) {
      if (!warnings.some((w) => w.id === id)) warningItems.delete(id);
    }
    syncChildren(list, listItems);
    syncChildren(rulesList, layout.rest.map(blockLi));
    list.hidden = layout.list.length === 0;
    // A warning a rule brought up in the Rules group still counts.
    none.hidden = layout.list.length > 0 || layout.rest.some((entry) => entry.warning);
    hint.hidden = !layout.list.some((entry) => entry.warning?.bit);
    rulesBox.hidden = layout.rest.length === 0;
    rulesLabel.textContent = layout.list.some((entry) => entry.rule) ? 'Other rules' : 'Rules';
    const designing = state.view.mode === 'design';
    rulesNote.hidden = designing;
    for (const { rule, controls } of blocks.values()) {
      rule.fields.forEach((field, i) => {
        controls[i].set(shownRule(state.design, field));
        controls[i].setDisabled(!designing);
      });
    }
    syncRulesOpen();
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
    let aria = n === 0 ? 'No warnings, show the rules' : `${count}, show list`;
    if (showing) aria = `${count}. Showing on the pot: ${active.message || active.id}. Stop showing`;
    chip.setAttribute('aria-label', aria);
    if (showing) chip.title = 'Stop colouring the beads';
    else if (n === 0) chip.title = 'No warnings. Click to see the rules';
    else chip.removeAttribute('title');
  }

  // A rule being edited keeps its warning's colours on, also while the edit
  // has made the warning go: they come back the moment it shows again.
  const heldHighlight = (id) => !card.hidden && RULES.some((r) => r.warning === id && pinned.has(r.id));

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
      // The problem was fixed: stop colouring beads for a warning that's gone.
      const hl = state.view.highlight;
      if (hl != null && !warnings.some((w) => w.id === hl && w.bit) && !heldHighlight(hl)) store.setView({ highlight: null });
    }
    // The card stays open with no warnings left: its rules are still there.
    if (!card.hidden) renderCard(state);
    syncChip();
  }

  const unsubscribe = store.subscribe((state, what) => {
    if (what.has('result') || what.has('view') || what.has('design')) update(state, what);
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
      for (const { controls } of blocks.values()) controls.forEach((c) => c.destroy());
      root.replaceChildren();
    },
  };
}
