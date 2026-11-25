// The first-visit tip (issue #2, §7.6 of the journey design). The app opens
// straight into the designer, on Shape, so this short note at the top of the
// controls points at Designs in the top bar, where the shapes and saved
// designs are, and the Designs button (on a phone: the logo, whose menu
// holds Designs) gets a ring. It sits in the controls, never over the pot.
//
// Desktop: a small card between the step row and the first part, with Show
// designs and Got it. Phone: the controls area is too small for that card, so
// it is one line with a × that does what Got it does (C36); it scrolls with
// the part's controls.
//
// It shows until the visitor opens Designs, by any route, or closes the tip,
// and then stays away in this browser. It never comes back on its own. It
// hides in Print.

import { labelIcon } from './press-label.js';

const LS_TIP = 'vc2.designsTip';
const HINT_CLASS = 'designs-hinted';

function lsGet(name) { try { return localStorage.getItem(name); } catch { return null; } }
function lsSet(name, v) { try { localStorage.setItem(name, v); } catch { /* storage off */ } }

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

/**
 * Mounts the tip into the step frame's tip slot (ui/steps.js `tipHost`).
 * @param {HTMLElement} host  where the tip goes: the top of the controls
 * @param {{ store, designs: { open(): void } }} ctx
 * @returns {{ destroy(): void } | null} null when the tip was already done in this browser
 */
export function mountDesignsTip(host, ctx) {
  const { store } = ctx;
  if (lsGet(LS_TIP) === 'done') return null;

  const tip = el('div', { class: 'designs-tip', role: 'note', 'aria-label': 'Tip' }, [
    el('p', { class: 'designs-tip-text' }, [
      el('span', { class: 'label-desk', text: 'Want a head start? Pick a shape or one of your saved designs under Designs in the top bar.' }),
      el('span', { class: 'label-phone', text: 'Want a head start? Shapes and saved designs are in the menu behind the logo.' }),
    ]),
    el('div', { class: 'designs-tip-actions', 'data-desk-only': true }, [
      el('button', { type: 'button', class: 'btn', text: 'Show designs', onclick: () => ctx.designs?.open() }),
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Got it', onclick: () => done({ focus: true }) }),
    ]),
    labelIcon(el('button', {
      type: 'button', class: 'icon-close designs-tip-close', 'data-phone-only': true,
      text: '×', onclick: () => done({ focus: true }),
    }), 'Close the tip'),
  ]);
  host.prepend(tip);
  const root = document.documentElement;
  const panel = host.closest('#panel') || host.parentElement;

  let finished = false;
  function done({ focus = false } = {}) {
    if (finished) return;
    finished = true;
    lsSet(LS_TIP, 'done');
    const hadFocus = tip.contains(document.activeElement);
    tip.remove();
    root.classList.remove(HINT_CLASS);
    unsubscribe();
    // Keep keyboard users in the controls, not dropped at the top of the page.
    if (focus || hadFocus) {
      const page = panel?.querySelector('.step-page:not([hidden])');
      page?.querySelector('button:not([disabled]), input:not([disabled])')?.focus({ preventScroll: true });
    }
  }

  const sync = (state) => {
    if (state.view.designsOpen) { done(); return; }
    const designing = state.view.mode === 'design';
    tip.hidden = !designing;
    root.classList.toggle(HINT_CLASS, designing);
  };
  const unsubscribe = store.subscribe((state, what) => { if (what.has('view')) sync(state); });
  sync(store.state);

  return { destroy: () => { if (!finished) { tip.remove(); root.classList.remove(HINT_CLASS); unsubscribe(); } } };
}
