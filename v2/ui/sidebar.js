// The design sidebar (design §8.1, §8.2, §8.6). Desktop: collapsible cards in
// the order you make a pot, a closed card showing a one-line summary, and the
// advanced sections under an "ADVANCED" divider. Phone (≤ 760 px): a tab row,
// with one Advanced tab stacking the advanced sections, over a scrolling area.
//
// Each section is mounted once, the first time it is shown, and then updated
// in place on every store change; its DOM is moved between the desktop card
// and the phone tab panel, never rebuilt, so a drag or a focused field
// survives any store update.

import { h } from './controls.js';
import shape from './sections/shape.js';
import surface from './sections/surface.js';
import layers from './sections/layers.js';
import base from './sections/base.js';
import curve from './sections/curve.js';
import points from './sections/points.js';
import footprint from './sections/footprint.js';

const MAIN = [shape, surface, layers, base];
const ADVANCED = [curve, points, footprint];
const TAB_TITLES = { shape: 'Shape', surface: 'Surface', layers: 'Layers', base: 'Base', advanced: 'Advanced' };
const PHONE_QUERY = '(max-width: 760px)';

const CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Mounts the sidebar into `el` and keeps it in step with the store.
 * @param {HTMLElement} el
 * @param {{ store: object, library: object, presets?: object, engine?: object, renderer?: object, handles?: object }} ctx
 * @returns {{ destroy(): void }}
 */
export function mountSidebar(el, ctx) {
  const { store } = ctx;
  const phoneMedia = globalThis.matchMedia ? matchMedia(PHONE_QUERY) : { matches: false, addEventListener() {}, removeEventListener() {} };

  /** Per section: its body host (moved between layouts) and the mounted instance. */
  const entries = new Map();
  for (const section of [...MAIN, ...ADVANCED]) {
    const host = h('div', { class: 'section-body', id: `section-${section.id}` });
    entries.set(section.id, { section, host, instance: null, card: null, header: null, summary: null, summaryText: null });
  }

  const ensureMounted = (entry) => {
    if (!entry.instance) entry.instance = entry.section.mount(entry.host, ctx);
  };

  const openSections = () => (Array.isArray(store.state.view.openSections) ? store.state.view.openSections : ['surface']);
  const summaryOf = (section, design) => {
    try {
      return section.summary(design, ctx);
    } catch {
      return '';
    }
  };

  el.classList.add('sidebar');
  let layout = null; // 'desktop' | 'phone'
  let tabButtons = new Map();
  let tabPanel = null;
  let advancedNodes = [];

  // ---- Desktop: cards -----------------------------------------------------

  const buildCard = (entry) => {
    const { section, host } = entry;
    const titleId = `section-title-${section.id}`;
    // The hidden ": " makes the button read "Shape: 170 × 124 mm · …", not "Shape170 × 124 mm".
    const summaryText = h('span');
    const summary = h('span', { class: 'card-summary' }, [h('span', { class: 'visually-hidden', text: ': ' }), summaryText]);
    const header = h('button', { type: 'button', class: 'card-header', 'aria-controls': host.id, id: titleId }, [
      h('span', { class: 'card-title', text: section.title }),
      summary,
    ]);
    header.insertAdjacentHTML('beforeend', `<span class="card-chevron">${CHEVRON}</span>`);
    header.addEventListener('click', () => {
      const open = new Set(openSections());
      if (open.has(section.id)) open.delete(section.id);
      else open.add(section.id);
      store.setView({ openSections: [...open] });
    });
    host.setAttribute('role', 'region');
    host.setAttribute('aria-labelledby', titleId);
    const card = h('section', { class: 'panel-card section-card' }, [h('h2', { class: 'card-heading' }, [header]), host]);
    Object.assign(entry, { card, header, summary, summaryText });
    return card;
  };

  const buildDesktop = () => {
    const nodes = MAIN.map((s) => buildCard(entries.get(s.id)));
    // A heading, not role=separator: a separator's text isn't read out.
    const divider = h('h2', { class: 'advanced-divider', text: 'Advanced' });
    advancedNodes = [divider, ...ADVANCED.map((s) => buildCard(entries.get(s.id)))];
    el.replaceChildren(...nodes, ...advancedNodes);
  };

  const renderDesktop = (state) => {
    const open = new Set(openSections());
    const advanced = !!state.view.advanced;
    for (const node of advancedNodes) node.hidden = !advanced;
    for (const entry of entries.values()) {
      const isOpen = open.has(entry.section.id) && (!entry.section.advanced || advanced);
      entry.card.classList.toggle('is-open', isOpen);
      entry.header.setAttribute('aria-expanded', String(isOpen));
      entry.host.hidden = !isOpen;
      entry.summary.hidden = isOpen;
      if (!isOpen) {
        const text = summaryOf(entry.section, state.design);
        entry.summaryText.textContent = text;
        entry.summary.title = text;
      }
      if (isOpen) ensureMounted(entry);
    }
  };

  // ---- Phone: tabs --------------------------------------------------------

  const currentTab = (state) => {
    const tab = state.view.phoneTab;
    if (tab === 'advanced') return state.view.advanced ? 'advanced' : 'shape';
    return TAB_TITLES[tab] && tab !== 'advanced' ? tab : 'shape';
  };

  const buildPhone = () => {
    const tabs = h('div', { class: 'phone-tabs', role: 'tablist', 'aria-label': 'Design settings' });
    tabButtons = new Map();
    for (const id of Object.keys(TAB_TITLES)) {
      const b = h('button', { type: 'button', class: 'phone-tab', role: 'tab', id: `tab-${id}`, 'aria-controls': 'phone-tabpanel', text: TAB_TITLES[id] });
      b.addEventListener('click', () => store.setView({ phoneTab: id }));
      tabs.append(b);
      tabButtons.set(id, b);
    }
    tabs.addEventListener('keydown', (e) => {
      const visible = [...tabButtons.values()].filter((b) => !b.hidden);
      const i = visible.indexOf(document.activeElement);
      if (i < 0) return;
      let next = null;
      if (e.key === 'ArrowRight') next = visible[(i + 1) % visible.length];
      else if (e.key === 'ArrowLeft') next = visible[(i + visible.length - 1) % visible.length];
      else if (e.key === 'Home') next = visible[0];
      else if (e.key === 'End') next = visible[visible.length - 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
      next.click();
    });
    tabPanel = h('div', { class: 'phone-tabpanel', id: 'phone-tabpanel', role: 'tabpanel', tabIndex: -1 });
    el.replaceChildren(tabs, tabPanel);
    shownTab = null;
  };

  let shownTab = null;
  const renderPhone = (state) => {
    const tab = currentTab(state);
    tabButtons.get('advanced').hidden = !state.view.advanced;
    for (const [id, b] of tabButtons) {
      b.setAttribute('aria-selected', String(id === tab));
      b.tabIndex = id === tab ? 0 : -1;
    }
    tabPanel.setAttribute('aria-labelledby', `tab-${tab}`);
    if (tab === shownTab) return;
    shownTab = tab;
    // On a narrow screen the tab row scrolls; keep the chosen tab in sight.
    const chosen = tabButtons.get(tab);
    const row = chosen.parentElement;
    if (row.scrollWidth > row.clientWidth) {
      const left = chosen.offsetLeft - row.offsetLeft;
      if (left < row.scrollLeft || left + chosen.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left - (row.clientWidth - chosen.offsetWidth) / 2;
    }
    const show = tab === 'advanced' ? ADVANCED : MAIN.filter((s) => s.id === tab);
    const nodes = show.map((s) => {
      const entry = entries.get(s.id);
      ensureMounted(entry);
      entry.host.hidden = false;
      entry.host.removeAttribute('role');
      entry.host.removeAttribute('aria-labelledby');
      if (tab !== 'advanced') return entry.host;
      return h('section', { class: 'phone-stack' }, [h('h3', { class: 'phone-stack-title', text: s.title }), entry.host]);
    });
    tabPanel.replaceChildren(...nodes);
    tabPanel.scrollTop = 0;
  };

  // ---- Both ---------------------------------------------------------------

  const setLayout = () => {
    const next = phoneMedia.matches ? 'phone' : 'desktop';
    if (next === layout) return;
    layout = next;
    el.classList.toggle('sidebar--phone', layout === 'phone');
    if (layout === 'phone') buildPhone();
    else buildDesktop();
    render(store.state, new Set(['design', 'view']));
  };

  const render = (state, what) => {
    if (layout === 'phone') renderPhone(state);
    else renderDesktop(state);
    if (what.has('design') || what.has('view') || what.has('result')) {
      for (const entry of entries.values()) {
        if (!entry.instance) continue;
        try {
          entry.instance.update(state);
        } catch (err) {
          console.error(`[sidebar] ${entry.section.id} update failed`, err);
        }
      }
    }
  };

  const onMedia = () => setLayout();
  phoneMedia.addEventListener('change', onMedia);
  setLayout();
  const unsubscribe = store.subscribe((state, what) => {
    if (what.has('design') || what.has('view') || what.has('result')) render(state, what);
  });

  return {
    destroy() {
      unsubscribe();
      phoneMedia.removeEventListener('change', onMedia);
      for (const entry of entries.values()) entry.instance?.destroy();
      el.replaceChildren();
      el.classList.remove('sidebar', 'sidebar--phone');
    },
  };
}
