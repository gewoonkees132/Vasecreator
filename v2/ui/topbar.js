// Top bar actions (design §8.1): undo, redo, Designs and Save design. Print is
// step 5 of the step frame (issue #1), so the bar has no print button. On a
// phone (C11) Designs and Save design move into the menu behind the logo, and
// the bar keeps undo and redo.

const UNDO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const REDO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

/**
 * Mounts the top bar actions and the logo menu.
 * @param {HTMLElement} header  header.topbar (holds #logo-button, #logo-menu, .topbar-actions)
 * @param {{ store, designs: { open(): void, promptSave(): void } }} ctx
 * @returns {{ destroy(): void }}
 */
export function mountTopbar(header, ctx) {
  const { store } = ctx;
  const actions = header.querySelector('.topbar-actions');
  const logo = header.querySelector('#logo-button');
  const menu = header.querySelector('#logo-menu');

  const undo = el('button', {
    type: 'button', class: 'btn btn-icon', html: UNDO_ICON,
    'aria-label': 'Undo', title: `Undo (${isMac ? '⌘' : 'Ctrl+'}Z)`,
    onclick: () => store.undo(),
  });
  const redo = el('button', {
    type: 'button', class: 'btn btn-icon', html: REDO_ICON,
    'aria-label': 'Redo', title: `Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`,
    onclick: () => store.redo(),
  });
  const designsBtn = el('button', {
    type: 'button', class: 'btn designs-btn', text: 'Designs', 'data-desk-only': true,
    onclick: () => ctx.designs.open(),
  });
  const saveBtn = el('button', {
    type: 'button', class: 'btn', text: 'Save design', 'data-desk-only': true,
    onclick: () => ctx.designs.promptSave(),
  });
  actions.replaceChildren(undo, redo, el('span', { class: 'sep', 'aria-hidden': 'true' }), designsBtn, saveBtn);

  // Logo menu: Designs and Save design (the only way to them on a phone), and
  // the credit, which has no room in the phone bar.
  const menuDesigns = el('button', { type: 'button', class: 'menu-item', role: 'menuitem', text: 'Designs' });
  const menuSave = el('button', { type: 'button', class: 'menu-item', role: 'menuitem', text: 'Save design' });
  const credit = el('p', {
    class: 'menu-note',
    html: 'Vase Creator · Created with ♥ by <a href="https://gewoonkees132.github.io/gewoonkees132/" target="_blank" rel="noopener noreferrer">Kees Leemeijer</a>',
  });
  menu.replaceChildren(menuDesigns, menuSave, credit);

  function openMenu() {
    menu.hidden = false;
    logo.setAttribute('aria-expanded', 'true');
    menuDesigns.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  function closeMenu(focusLogo = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    logo.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (focusLogo) logo.focus();
  }
  function outside(e) {
    if (!menu.contains(e.target) && !logo.contains(e.target)) closeMenu();
  }
  logo.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.menu-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  // Tabbing out of the menu closes it.
  menu.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== logo) closeMenu();
  });
  menuDesigns.addEventListener('click', () => { closeMenu(); ctx.designs.open(); });
  menuSave.addEventListener('click', () => { closeMenu(); ctx.designs.promptSave(); });

  function update() {
    const printing = store.state.view.mode === 'print';
    // Undo, redo and saving in Print would change the design under a computed print (C31).
    undo.disabled = printing || !store.canUndo();
    redo.disabled = printing || !store.canRedo();
    saveBtn.disabled = printing;
    menuSave.disabled = printing;
  }

  const unsubscribe = store.subscribe((state, what) => {
    if (what.has('history') || what.has('view') || what.has('design')) update();
  });
  update();

  return {
    destroy() {
      unsubscribe();
      closeMenu();
      actions.replaceChildren();
      menu.replaceChildren();
    },
  };
}
