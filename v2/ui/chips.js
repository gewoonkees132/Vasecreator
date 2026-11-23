// The chips at the top of the view (design §8.5, D21): the warnings chip and,
// to its right, the size chip. Clicking a warning colours its beads (§11).

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
 * @param {HTMLElement} root  div#chips
 * @param {{ store }} ctx
 * @returns {{ destroy(): void }}
 */
export function mountChips(root, ctx) {
  const { store } = ctx;

  const icon = el('span', { class: 'chip-icon', 'aria-hidden': 'true', text: '⚠' });
  const label = el('span');
  const chip = el('button', {
    type: 'button', class: 'chip chip-warnings is-none',
    'aria-expanded': 'false', 'aria-controls': 'warn-card',
    onclick: () => (card.hidden ? openCard() : closeCard()),
  }, [icon, label]);

  const list = el('ul', { class: 'warn-list' });
  const closeBtn = el('button', {
    type: 'button', class: 'icon-close', 'aria-label': 'Close warnings', text: '×',
    onclick: () => closeCard(true),
  });
  const card = el('div', { class: 'warn-card', id: 'warn-card', role: 'region', 'aria-label': 'Warnings', hidden: true }, [
    el('div', { class: 'warn-card-head' }, [el('span', { text: 'Warnings' }), closeBtn]),
    list,
    el('p', { class: 'warn-hint', text: 'Click a warning to show where it is on the pot.' }),
  ]);
  const wrap = el('div', { class: 'chip-wrap' }, [chip, card]);
  const size = el('span', { class: 'chip chip-size', role: 'status', 'aria-label': 'Size: height × width × depth' });
  root.replaceChildren(wrap, size);

  let lastKey = '';

  function openCard() {
    if (listed(store.state.result).length === 0) return;
    card.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
  }

  // Closing the card also stops colouring the beads (§11: until it's closed).
  function closeCard(focusChip = false) {
    if (card.hidden) return;
    card.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (store.state.view.highlight != null) store.setView({ highlight: null });
    if (focusChip) chip.focus();
  }

  function outside(e) {
    // Leave the card open while the user turns the pot to look at the beads.
    if (e.target.closest?.('#scene, #overlay')) return;
    if (!wrap.contains(e.target)) closeCard();
  }

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeCard(true); }
  });

  function renderList(warnings) {
    const highlight = store.state.view.highlight;
    list.replaceChildren(...warnings.map((w) => {
      const sev = w.severity === 'error' ? 'is-error' : w.severity === 'info' ? 'is-info' : 'is-warn';
      const item = el('button', {
        type: 'button', class: `warn-item ${sev}`,
        'aria-pressed': String(highlight === w.id),
        onclick: () => store.setView({ highlight: store.state.view.highlight === w.id ? null : w.id }),
      }, [el('span', { class: 'warn-dot', 'aria-hidden': 'true' }), el('span', { text: w.message || w.id })]);
      return el('li', {}, [item]);
    }));
  }

  function update(state, what) {
    const warnings = listed(state.result);
    if (what.has('result')) {
      const n = warnings.length;
      const errors = warnings.some((w) => w.severity === 'error');
      label.textContent = n === 0 ? 'No warnings' : `${n} warning${n === 1 ? '' : 's'}`;
      icon.hidden = n === 0;
      chip.className = `chip chip-warnings ${n === 0 ? 'is-none' : errors ? 'is-error' : 'is-warn'}`;
      chip.setAttribute('aria-label', n === 0 ? 'No warnings' : `${n} warning${n === 1 ? '' : 's'}, show list`);
      chip.disabled = false;
      size.textContent = formatSize(state.result?.size);
      if (n === 0) closeCard();
      // The problem was fixed: stop colouring beads for a warning that's gone.
      const hl = state.view.highlight;
      if (hl != null && !warnings.some((w) => w.id === hl)) store.setView({ highlight: null });
    }
    const key = JSON.stringify([warnings.map((w) => [w.id, w.message, w.severity]), state.view.highlight]);
    if (key !== lastKey) {
      lastKey = key;
      renderList(warnings);
    }
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
