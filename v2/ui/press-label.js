// A long press on an icon button shows its name (D49): on a phone, the label
// that a tooltip shows on desktop and a screen reader reads out. The press
// that showed the label doesn't also press the button.

const PRESS_MS = 450;
const MOVE_PX = 10;
const SHOW_MS = 1400;

let bubble = null;
let hideTimer = 0;

function show(btn, text) {
  if (!text) return;
  bubble ??= Object.assign(document.createElement('div'), { className: 'press-label', role: 'tooltip' });
  clearTimeout(hideTimer);
  bubble.textContent = text;
  document.body.append(bubble);
  const r = btn.getBoundingClientRect();
  const w = bubble.offsetWidth;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${Math.max(8, r.top - bubble.offsetHeight - 8)}px`;
}

function hideSoon(ms = SHOW_MS) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bubble?.remove(), ms);
}

/**
 * Shows `label()` (by default the button's aria-label) above the button on a
 * long touch press.
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
  return () => {
    cancel();
    btn.removeEventListener('pointerdown', down);
    btn.removeEventListener('pointermove', move);
    btn.removeEventListener('pointerup', up);
    btn.removeEventListener('pointercancel', up);
    btn.removeEventListener('click', click, true);
    btn.removeEventListener('contextmenu', menu);
  };
}
