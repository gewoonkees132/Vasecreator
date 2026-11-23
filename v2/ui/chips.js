// The chips at the top of the view (design §8.5, D21): the warnings chip and,
// to its right, the size chip. Clicking a warning colours its beads (§11).

const PHONE = '(max-width: 760px)';

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
  const label = el('span');
  const clear = el('span', { class: 'chip-clear', 'aria-hidden': 'true', text: '×', hidden: true });
  const chip = el('button', {
    type: 'button', class: 'chip chip-warnings is-none',
    'aria-expanded': 'false', 'aria-controls': 'warn-card',
    onclick: () => {
      if (!card.hidden) closeCard();
      else if (store.state.view.highlight != null) store.setView({ highlight: null });
      else openCard();
    },
  }, [icon, label, clear]);

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
  const wrap = el('div', { class: 'chip-wrap' }, [chip, card]);
  const size = el('span', { class: 'chip chip-size', role: 'status', 'aria-label': 'Size: height × width × depth' });
  root.replaceChildren(wrap, size);

  let lastKey = '';

  function openCard() {
    if (listed(store.state.result).length === 0) return;
    const fromKeyboard = document.activeElement === chip && chip.matches(':focus-visible');
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
    const count = `${n} warning${n === 1 ? '' : 's'}`;
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
      label.textContent = n === 0 ? 'No warnings' : `${n} warning${n === 1 ? '' : 's'}`;
      icon.hidden = n === 0;
      chip.classList.remove('is-none', 'is-error', 'is-warn');
      chip.classList.add(n === 0 ? 'is-none' : errors ? 'is-error' : 'is-warn');
      size.textContent = formatSize(state.result?.size);
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
  });
  update(store.state, new Set(['result']));

  return {
    destroy() {
      unsubscribe();
      document.removeEventListener('pointerdown', outside, true);
      root.replaceChildren();
    },
  };
}
