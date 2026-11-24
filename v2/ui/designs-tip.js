// The first-visit tip (issue #2). The app opens straight into the designer,
// so this short note at the top of the controls points at Designs in the top
// bar, where the presets and saved designs are, and the Designs button (on a
// phone: the logo, whose menu holds Designs) gets a ring. It sits in the
// panel, never over the pot (D22).
//
// It shows until the visitor opens Designs, by any route, or closes the tip,
// and then stays away in this browser. It never comes back on its own.

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
 * Mounts the tip at the top of the panel, before the design panel.
 * @param {HTMLElement} panel  aside#panel
 * @param {{ store, designs: { open(): void } }} ctx
 * @returns {{ destroy(): void } | null} null when the tip was already done in this browser
 */
export function mountDesignsTip(panel, ctx) {
  const { store } = ctx;
  if (lsGet(LS_TIP) === 'done') return null;

  const tip = el('div', { class: 'designs-tip', role: 'note', 'aria-label': 'Tip' }, [
    el('p', { class: 'designs-tip-text' }, [
      el('span', { class: 'label-desk', text: 'Want a head start? Pick a preset or one of your saved designs under Designs in the top bar.' }),
      el('span', { class: 'label-phone', text: 'Want a head start? Presets and saved designs are in the menu behind the logo.' }),
    ]),
    el('div', { class: 'designs-tip-actions' }, [
      el('button', { type: 'button', class: 'btn', text: 'Show designs', onclick: () => ctx.designs?.open() }),
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Got it', onclick: () => done({ focus: true }) }),
    ]),
  ]);
  panel.insertBefore(tip, panel.querySelector('#design-panel'));
  const root = document.documentElement;

  let finished = false;
  function done({ focus = false } = {}) {
    if (finished) return;
    finished = true;
    lsSet(LS_TIP, 'done');
    const hadFocus = tip.contains(document.activeElement);
    tip.remove();
    root.classList.remove(HINT_CLASS);
    unsubscribe();
    // Keep keyboard users in the panel, not dropped at the top of the page.
    if (focus || hadFocus) panel.querySelector('#design-panel button, #design-panel input')?.focus({ preventScroll: true });
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
