// Icon buttons and their names (D49): a button that does one clear task is an
// icon, and its text is the tooltip on desktop, the label a long press shows
// on a phone and the accessible name. A long press on an icon button shows
// that label; the press that showed it doesn't also press the button.

const PRESS_MS = 450;
const MOVE_PX = 10;
const SHOW_MS = 1400;
const GAP = 8;

let bubble = null;
let hideTimer = 0;

/**
 * Where the label goes: above the button, centred on it and inside the
 * window; below it when there is no room above (the top bar's buttons),
 * so the finger on the button never hides it.
 * @param {{ left: number, top: number, width: number, bottom: number }} anchor  the button's box
 * @param {{ width: number, height: number }} label  the label's size
 * @param {{ width: number }} viewport
 * @returns {{ left: number, top: number, below: boolean }}
 */
export function labelPlacement(anchor, label, viewport) {
  const left = Math.min(Math.max(GAP, anchor.left + anchor.width / 2 - label.width / 2), viewport.width - label.width - GAP);
  const above = anchor.top - label.height - GAP;
  const below = above < GAP;
  return { left: Math.max(GAP, left), top: below ? anchor.bottom + GAP : above, below };
}

function show(btn, text) {
  if (!text) return;
  bubble ??= Object.assign(document.createElement('div'), { className: 'press-label', role: 'tooltip' });
  clearTimeout(hideTimer);
  bubble.textContent = text;
  // A modal dialog sits in the top layer, over anything in the body.
  (btn.closest('dialog[open]') ?? document.body).append(bubble);
  const r = btn.getBoundingClientRect();
  const at = labelPlacement(r, { width: bubble.offsetWidth, height: bubble.offsetHeight }, { width: innerWidth });
  bubble.style.left = `${at.left}px`;
  bubble.style.top = `${at.top}px`;
}

function hideSoon(ms = SHOW_MS) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bubble?.remove(), ms);
}

/**
 * Shows `label()` (by default the button's aria-label) by the button on a
 * long touch press. Marks the button with `data-press-label`.
 * @param {HTMLElement} btn
 * @param {() => string} [label]
 * @returns {() => void} detach
 */
export function attachPressLabel(btn, label = () => btn.getAttribute('aria-label') || btn.title || '') {
  let timer = 0;
  let from = null;
  let swallow = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
    from = null;
  };
  const down = (e) => {
    if (e.pointerType !== 'touch') return;
    cancel();
    swallow = false;
    from = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      timer = 0;
      swallow = true;
      show(btn, label());
    }, PRESS_MS);
  };
  const move = (e) => {
    if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > MOVE_PX) cancel();
  };
  const up = () => {
    cancel();
    if (swallow) hideSoon();
  };
  // Runs before the button's own click handlers (capture at the target).
  const click = (e) => {
    if (!swallow) return;
    swallow = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const menu = (e) => { if (swallow || timer) e.preventDefault(); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointermove', move);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('click', click, true);
  btn.addEventListener('contextmenu', menu);
  btn.dataset.pressLabel = '';
  return () => {
    cancel();
    btn.removeEventListener('pointerdown', down);
    btn.removeEventListener('pointermove', move);
    btn.removeEventListener('pointerup', up);
    btn.removeEventListener('pointercancel', up);
    btn.removeEventListener('click', click, true);
    btn.removeEventListener('contextmenu', menu);
    delete btn.dataset.pressLabel;
  };
}

/**
 * Names an icon button (D49): `label` is its accessible name and what a long
 * press shows, `tip` its tooltip (the label, plus a shortcut where there is
 * one). Call it again when the name changes; the long press is attached once.
 * @param {HTMLElement} btn
 * @param {string} label
 * @param {string} [tip]
 * @returns {HTMLElement} the button
 */
export function labelIcon(btn, label, tip = label) {
  if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
  if (btn.title !== tip) btn.title = tip;
  if (!('pressLabel' in btn.dataset)) attachPressLabel(btn);
  return btn;
}
