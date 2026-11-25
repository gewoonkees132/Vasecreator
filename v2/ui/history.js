// The right column (design §8.4, D14): the history card with a thumbnail per
// step, newest on top. On a phone it is a narrow column with the three newest
// steps; tapping it opens the full list over the controls area. (The Advanced
// button that sat below it went with issue #1, D33.)

import { relativeTime } from '../store/store.js';
import { labelIcon } from './press-label.js';

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

/**
 * Mounts the history card.
 * @param {HTMLElement} root  div#rightcol
 * @param {{ store }} ctx
 * @returns {{ destroy(): void }}
 */
export function mountHistory(root, ctx) {
  const { store } = ctx;
  const phone = matchMedia(PHONE);

  // Object URLs per step, made once per thumbnail Blob and revoked when the
  // step leaves the history.
  /** @type {Map<string, { blob: Blob, url: string }>} */
  const urls = new Map();
  function thumbUrl(step) {
    if (!step.thumb) return null;
    const have = urls.get(step.id);
    if (have && have.blob === step.thumb) return have.url;
    if (have) URL.revokeObjectURL(have.url);
    const url = URL.createObjectURL(step.thumb);
    urls.set(step.id, { blob: step.thumb, url });
    return url;
  }

  const list = el('ol', { class: 'history-list', 'aria-label': 'Steps, newest first' });
  const more = el('span', { class: 'history-more', 'aria-hidden': 'true', text: 'All ›' });
  const card = el('section', { class: 'history-card', 'aria-labelledby': 'history-title' }, [
    el('h2', { class: 'history-title', id: 'history-title', text: 'History' }),
    list,
    more,
  ]);

  // Full list for the phone, over the controls area and the step bar.
  const overlayList = el('ol', { class: 'history-list', 'aria-label': 'Steps, newest first' });
  const overlayClose = labelIcon(el('button', {
    type: 'button', class: 'icon-close', text: '×',
    onclick: () => closeOverlay(),
  }), 'Close history');
  const overlay = el('div', {
    class: 'history-overlay', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'history-overlay-title', hidden: true,
  }, [
    el('div', { class: 'history-overlay-head' }, [el('h2', { id: 'history-overlay-title', text: 'History', style: 'font-size:16px' }), overlayClose]),
    overlayList,
  ]);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });

  root.replaceChildren(card, overlay);

  function openOverlay() {
    overlay.hidden = false;
    renderInto(overlayList, false);
    overlayClose.focus();
  }
  function closeOverlay() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    card.focus?.();
  }

  // On a phone the whole narrow column is one button that opens the list.
  card.addEventListener('click', (e) => {
    if (!phone.matches) return;
    e.preventDefault();
    e.stopPropagation();
    openOverlay();
  }, true);
  card.addEventListener('keydown', (e) => {
    if (phone.matches && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openOverlay(); }
  });
  function syncPhone() {
    if (phone.matches) {
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', 'History: show all steps');
    } else {
      card.removeAttribute('role');
      card.removeAttribute('tabindex');
      card.removeAttribute('aria-label');
      closeOverlay();
    }
    renderInto(list, phone.matches);
  }
  phone.addEventListener('change', syncPhone);

  function renderInto(target, compact) {
    const steps = store.history();
    const currentId = store.state.historyId;
    const now = Date.now();
    const shown = compact ? steps.slice(0, 3) : steps;
    // Print works on the current design; going back in history happens in the design steps (C31).
    const printing = store.state.view.mode === 'print';
    // Thumbnails and the clock re-render the list; keyboard focus stays put.
    const focusedId = target.contains(document.activeElement) ? document.activeElement.dataset.step : null;
    target.replaceChildren(...shown.map((step) => {
      const url = thumbUrl(step);
      const time = relativeTime(step.time, now);
      const img = url
        ? el('img', { class: 'history-thumb', src: url, alt: '', draggable: 'false' })
        : el('span', { class: 'history-thumb is-empty', 'aria-hidden': 'true' });
      const current = step.id === currentId;
      const item = el('button', {
        type: 'button',
        class: `history-item${current ? ' is-current' : ''}`,
        'data-step': step.id,
        title: `${step.label} · ${time}`,
        'aria-label': `${step.label}, ${time === 'now' ? 'just now' : `${time} ago`}${current ? ', current' : ''}`,
        'aria-current': current ? 'step' : false,
        tabindex: compact ? '-1' : false,
        disabled: printing,
        onclick: () => {
          store.restore(step.id);
          if (target === overlayList) closeOverlay();
        },
      }, [img, el('span', { class: 'history-time', text: time })]);
      return el('li', {}, [item]);
    }));
    if (focusedId) {
      // The same step keeps the focus; if it fell off the end, the current one takes it.
      const next = target.querySelector(`[data-step="${CSS.escape(focusedId)}"]`) || target.querySelector('.history-item.is-current');
      next?.focus({ preventScroll: true });
    }
  }

  function render() {
    renderInto(list, phone.matches);
    if (!overlay.hidden) renderInto(overlayList, false);
    // Drop URLs of steps that fell off the end.
    const live = new Set(store.history().map((s) => s.id));
    for (const [id, { url }] of urls) {
      if (!live.has(id)) { URL.revokeObjectURL(url); urls.delete(id); }
    }
  }

  let lastMode = store.state.view.mode;
  const unsubscribe = store.subscribe((state, what) => {
    if (what.has('history')) render();
    if (what.has('view') && state.view.mode !== lastMode) { lastMode = state.view.mode; render(); }
  });

  // Keep "1 min", "3 min"… honest without re-rendering on every change.
  const timer = setInterval(render, 30000);

  syncPhone();

  return {
    destroy() {
      unsubscribe();
      clearInterval(timer);
      phone.removeEventListener('change', syncPhone);
      for (const { url } of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      root.replaceChildren();
    },
  };
}
