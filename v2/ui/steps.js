// The design steps (issue #1, design D28–D33, docs/design/v2-guided-journey.md).
// Five steps in a fixed order, Shape, Pattern, Layers & seam, Base and Print,
// and any of them opens at any time: nothing is locked.
//
// Desktop: the five emblems at the top of the left panel and the current
// step's parts under small headings (Shape's finer parts, the Morph
// among them, behind "More shape options"). Phone (≤ 760 px):
// the same emblems as a bottom bar, and above it a controls area of one fixed
// height with the step's name, a row of part buttons, and only that part's
// controls. The emblems are how you move between steps: there is no Next
// (pattern studio D49).
//
// Mobile stage (docs/design/v2-mobile-stage.md): on a phone the controls area
// is an optional sheet. By default the phone shows the dock (ui/dock.js), a
// tool row with one big control, so the pot gets the stage; the grabber, or a
// tool that needs room, opens the sheet, and its ⌄ or a swipe down closes it
// (remembered as vc2.sheet). Print always shows the sheet.
//
// Every section mounts once, the first time it shows, into a host element
// that never moves. Steps, parts and layouts only show and hide things, so a
// drag or a field being typed in survives all of them. Sections tag their
// control groups with data-part="<part id>" (a space-separated list for an
// element several parts share); a section that is one part needs no tags.
// A section can also say which of its parts apply right now (`applies`):
// a part that doesn't apply isn't shown, on either layout.

import { h } from './controls.js';
import shape from './sections/shape.js';
import curve from './sections/curve.js';
import points from './sections/points.js';
import morph from './sections/morph.js';
import pattern from './sections/pattern.js';
import layers from './sections/layers.js';
import base from './sections/base.js';
import { mountPrintPanel } from './print.js';
import { mountDock } from './dock.js';
import { labelIcon } from './press-label.js';

const PHONE_QUERY = '(max-width: 760px)';
const LS_MORE = 'vc2.moreShape';
const LS_SHEET = 'vc2.sheet';
const SWIPE_PX = 24;

// Inline emblems, drawn in-house (C33): 24 × 24, round 1.8 px strokes.
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const EMBLEMS = {
  // A vase outline.
  shape: svg('<path d="M9.4 3.5h5.2"/><path d="M10.3 3.5v2.2c0 1.9-4.3 3.6-4.3 8.4 0 3.2 1.4 5.5 2.9 6.4h6.2c1.5-.9 2.9-3.2 2.9-6.4 0-4.8-4.3-6.5-4.3-8.4V3.5"/>'),
  // A rounded square with three wavy vertical lines.
  pattern: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8.3 7.2c-1.1 1.6 1.1 3.2 0 4.8s1.1 3.2 0 4.8"/><path d="M12 7.2c-1.1 1.6 1.1 3.2 0 4.8s1.1 3.2 0 4.8"/><path d="M15.7 7.2c-1.1 1.6 1.1 3.2 0 4.8s1.1 3.2 0 4.8"/>'),
  // Three layers, the middle one with a small step: the seam ramp.
  layers: svg('<path d="M4 6.5h16"/><path d="M4 13h7.2l2-2H20"/><path d="M4 18.5h16"/>'),
  // The base spiral seen from an angle: two nested ellipses and a dot.
  base: svg('<ellipse cx="12" cy="12.5" rx="8.5" ry="5"/><ellipse cx="12" cy="12.5" rx="4.4" ry="2.4"/><circle cx="12" cy="12.5" r="1.1" fill="currentColor" stroke="none"/>'),
  // A nozzle above two lines of beads.
  print: svg('<path d="M9 3.5h6v3.4l-2 2.9h-2L9 6.9z"/><path d="M5 15h14"/><path d="M5 19.2h14"/>'),
};
const CHEVRON_DOWN = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Prepare print as the Print step's one section; its four cards are the parts.
const printSection = {
  id: 'print',
  title: 'Print',
  summary: () => 'walls, printer, check and export',
  mount(el, ctx) {
    const panel = mountPrintPanel(el, ctx);
    return { update() {}, destroy: () => panel.destroy() };
  },
};

/**
 * The step list (§6.3). `parts` are in order; `section` names the section a
 * part's controls come from, and `fine` marks Shape's finer parts (behind
 * "More shape options" on desktop, after a divider on a phone).
 */
export const STEP_LIST = [
  {
    id: 'shape', title: 'Shape', short: 'Shape', sections: [shape, curve, points, morph],
    parts: [
      { id: 'size', name: 'Size', section: 'shape' },
      { id: 'footprint', name: 'Footprint', section: 'shape' },
      { id: 'twist', name: 'Twist', section: 'shape' },
      { id: 'curve', name: 'Curve', section: 'curve', fine: true },
      { id: 'points', name: 'Points', section: 'points', fine: true },
      { id: 'morph', name: 'Morph', section: 'morph', fine: true },
    ],
  },
  {
    id: 'pattern', title: 'Pattern', short: 'Pattern', sections: [pattern],
    parts: [
      { id: 'drawing', name: 'Pattern', section: 'pattern' },
      { id: 'depth', name: 'Depth', section: 'pattern' },
      { id: 'density', name: 'Density', section: 'pattern' },
      { id: 'range', name: 'From / to', section: 'pattern' },
      { id: 'fade', name: 'Fade', section: 'pattern' },
      { id: 'soften', name: 'Soften', section: 'pattern' },
    ],
  },
  {
    id: 'layers', title: 'Layers & seam', short: 'Layers', sections: [layers],
    parts: [
      { id: 'seam', name: 'Seam', section: 'layers' },
      { id: 'bead', name: 'Bead', section: 'layers' },
    ],
  },
  {
    id: 'base', title: 'Base', short: 'Base', sections: [base],
    parts: [
      { id: 'base', name: 'Base', section: 'base' },
      { id: 'hole', name: 'Hole', section: 'base' },
    ],
  },
  {
    id: 'print', title: 'Print', short: 'Print', sections: [printSection],
    parts: [
      { id: 'walls', name: 'Walls', section: 'print' },
      { id: 'printer', name: 'Printer', section: 'print' },
      { id: 'check', name: 'Check', section: 'print' },
      { id: 'export', name: 'Export', section: 'print' },
    ],
  },
];

/**
 * The design as a shape: everything but the Pattern. The form keeps its
 * Morph, which shapes it (D36); the layers, base and finish stay. Shape shows
 * the pot this way (D29 as revised by D36), and presets open this way (D30). A new object; the design given is not changed.
 * @param {object} design  a normalised design
 * @returns {object}
 */
export function shapeOnly(design) {
  return { ...design, pattern: null };
}

const tokens = (el) => (el.dataset.part || '').split(/\s+/).filter(Boolean);

function lsGet(name) { try { return localStorage.getItem(name); } catch { return null; } }
function lsSet(name, v) { try { localStorage.setItem(name, v); } catch { /* storage off */ } }

/**
 * Mounts the step frame into the panel and keeps it in step with the store.
 * @param {HTMLElement} panel  aside#panel
 * @param {object} ctx  main.js's ctx (store, library, engine, renderer, …)
 * @returns {{ tipHost: HTMLElement, destroy(): void }} tipHost: where the first-visit tip goes (§7.6)
 */
export function mountSteps(panel, ctx) {
  const { store } = ctx;
  const phoneMedia = globalThis.matchMedia ? matchMedia(PHONE_QUERY) : { matches: false, addEventListener() {}, removeEventListener() {} };
  let moreOpen = lsGet(LS_MORE) === '1';
  let sheetOpen = lsGet(LS_SHEET) === 'open';

  // ---- Step tabs: the desktop row and the phone bar are the same element ----
  const tabRow = h('div', { class: 'step-tabs', role: 'tablist', 'aria-label': 'Design steps' });
  // Hidden: aria-describedby still reads hidden elements, and browse mode skips them.
  const descBox = h('div', { hidden: true });
  const tabs = new Map();
  for (const step of STEP_LIST) {
    const desc = h('span', { id: `step-desc-${step.id}` });
    descBox.append(desc);
    const tab = h('button', {
      type: 'button', class: 'step-tab', role: 'tab', id: `step-tab-${step.id}`,
      'aria-controls': `step-page-${step.id}`, 'aria-label': step.title, 'aria-describedby': desc.id,
    });
    tab.insertAdjacentHTML('beforeend', `<span class="step-emblem">${EMBLEMS[step.id]}</span>`);
    tab.append(h('span', { class: 'step-label', text: step.short }));
    // A click or a tap leaves the focus where it is; Enter or Space (a click
    // without a pointer) moves it into the step.
    tab.addEventListener('click', (e) => go(step.id, { focus: e.detail === 0 }));
    tabRow.append(tab);
    tabs.set(step.id, { tab, desc, text: null });
  }
  tabRow.addEventListener('keydown', (e) => {
    const list = [...tabs.values()].map((t) => t.tab);
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = arrowTarget(e.key, i, list);
    if (!next) return;
    e.preventDefault();
    next.focus();
    go(next.id.replace('step-tab-', ''), { focus: false });
  });

  // ---- Phone header: ⌄ (back to the pot) and the step's full name ----
  const headTitle = h('h2', { class: 'step-title' });
  const collapse = labelIcon(h('button', { type: 'button', class: 'icon-btn sheet-collapse', 'aria-expanded': 'true' }), 'Hide all settings');
  collapse.insertAdjacentHTML('beforeend', CHEVRON_DOWN);
  collapse.addEventListener('click', (e) => setSheet(false, { focus: e.detail === 0 }));
  const head = h('div', { class: 'step-head' }, [collapse, headTitle]);
  let headSwipe = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    headSwipe = { id: e.pointerId, y: e.clientY };
  });
  head.addEventListener('pointermove', (e) => {
    if (!headSwipe || headSwipe.id !== e.pointerId) return;
    if (e.clientY - headSwipe.y > SWIPE_PX) {
      headSwipe = null;
      if (canCollapse()) setSheet(false);
    }
  });
  head.addEventListener('pointerup', () => { headSwipe = null; });

  // ---- Phone part row: one group of buttons per step ----
  const partRow = h('div', { class: 'part-tabs', role: 'tablist' });
  const partButtons = new Map();   // `${step}/${part}` → button
  const partGroups = new Map();    // step → group element
  for (const step of STEP_LIST) {
    const group = h('div', { class: 'part-group', hidden: true });
    step.parts.forEach((part, i) => {
      if (part.fine && !step.parts[i - 1]?.fine) group.append(h('span', { class: 'part-divider', 'aria-hidden': 'true' }));
      const b = h('button', {
        type: 'button', class: 'part-tab', role: 'tab', id: `part-tab-${step.id}-${part.id}`,
        'aria-controls': `step-page-${step.id}`, text: part.name,
      });
      b.dataset.part = part.id;
      b.addEventListener('click', () => pickPart(step.id, part.id));
      group.append(b);
      partButtons.set(`${step.id}/${part.id}`, b);
    });
    partRow.append(group);
    partGroups.set(step.id, group);
  }
  partRow.addEventListener('keydown', (e) => {
    const group = partGroups.get(store.state.view.step);
    const list = [...group.querySelectorAll('.part-tab')].filter((b) => !b.hidden);
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = arrowTarget(e.key, i, list);
    if (!next) return;
    e.preventDefault();
    next.focus();
    pickPart(store.state.view.step, next.dataset.part);
  });

  // ---- Pages: one per step, holding its section hosts ----
  /** Per section: its host (never moved), the step it belongs to, its parts and the mounted instance. */
  const entries = [];
  const pages = new Map();
  let moreBox = null;
  let moreToggle = null;
  for (const step of STEP_LIST) {
    const page = h('div', { class: 'step-page', id: `step-page-${step.id}`, role: 'tabpanel', 'aria-labelledby': `step-tab-${step.id}`, tabIndex: -1, hidden: true });
    pages.set(step.id, page);
    const fineBody = h('div', { class: 'more-body', id: `more-body-${step.id}` });
    for (const section of step.sections) {
      const parts = step.parts.filter((p) => p.section === section.id);
      const host = h('div', { class: 'section-body', id: `section-${section.id}` });
      // The host carries all its parts, so it takes no room when none of them shows.
      host.dataset.part = parts.map((p) => p.id).join(' ');
      const entry = { section, step: step.id, parts: parts.map((p) => p.id), host, instance: null, tagged: [host], fine: parts.every((p) => p.fine) };
      const target = entry.fine ? fineBody : page;
      if (parts.length === 1) {
        // A section that is one part: the host is the part, under its heading.
        const heading = h('h3', { class: 'part-heading', text: parts[0].name });
        heading.dataset.part = parts[0].id;
        entry.tagged.push(heading);
        target.append(heading, host);
      } else {
        target.append(host);
      }
      entries.push(entry);
    }
    if (fineBody.children.length) {
      // Desktop: the finer Shape parts sit behind a disclosure, closed by
      // default and remembered in this browser (C27). A phone ignores it.
      moreToggle = h('button', { type: 'button', class: 'more-toggle', 'aria-expanded': 'false', 'aria-controls': fineBody.id });
      moreToggle.insertAdjacentHTML('beforeend', `<span class="more-chevron">${CHEVRON}</span>`);
      moreToggle.append(
        h('span', { class: 'more-title', text: 'More shape options' }),
        h('span', { class: 'more-sub', text: step.parts.filter((p) => p.fine).map((p) => p.name.toLowerCase()).join(' · ') }),
      );
      moreToggle.addEventListener('click', () => {
        moreOpen = !moreOpen;
        lsSet(LS_MORE, moreOpen ? '1' : '0');
        render(store.state);
      });
      moreBox = h('div', { class: 'more-shape' }, [moreToggle, fineBody]);
      page.append(moreBox);
    }
  }

  // The first-visit tip goes at the top of the controls (§7.6).
  const tipHost = h('div', { class: 'step-tip' });
  const scroll = h('div', { class: 'step-scroll' }, [tipHost, ...pages.values()]);

  // ---- The dock (phone, sheet closed) ----
  const dockEl = h('div', { class: 'dock-host' });
  const dock = mountDock(dockEl, ctx, {
    openSheet: (part, { focus = false } = {}) => setSheet(true, { part, focus }),
  });

  panel.classList.add('steps');
  panel.replaceChildren(tabRow, head, partRow, scroll, dockEl, descBox);

  // ---- Behaviour ----

  function go(stepId, { focus = false } = {}) {
    if (store.state.view.step !== stepId) store.setView({ step: stepId });
    if (focus) pages.get(stepId)?.focus({ preventScroll: true });
  }

  // Print is a checklist and downloads: its sheet stays open.
  const canCollapse = () => store.state.view.step !== 'print';

  /** Opens or closes the phone sheet; opening at a part shows that part. */
  function setSheet(open, { part = null, focus = false } = {}) {
    if (part) pickPart(store.state.view.step, part);
    if (sheetOpen !== open) {
      sheetOpen = open;
      lsSet(LS_SHEET, open ? 'open' : 'closed');
      render(store.state);
    }
    if (!focus || layout !== 'phone') return;
    if (open) (part ? partButtons.get(`${store.state.view.step}/${part}`) : collapse)?.focus({ preventScroll: true });
    else dock.grabber.focus({ preventScroll: true });
  }

  function pickPart(stepId, partId) {
    if (store.state.view.parts?.[stepId] === partId) return;
    store.setView({ parts: { ...(store.state.view.parts || {}), [stepId]: partId } });
  }

  function arrowTarget(key, i, list) {
    if (key === 'ArrowRight') return list[(i + 1) % list.length];
    if (key === 'ArrowLeft') return list[(i + list.length - 1) % list.length];
    if (key === 'Home') return list[0];
    if (key === 'End') return list[list.length - 1];
    return null;
  }

  const stepOf = (state) => STEP_LIST.find((s) => s.id === state.view.step) ?? STEP_LIST[0];

  /** The step's parts that apply now (C34): a section's `applies(state)`, else all of them. */
  function applicable(step, state) {
    const out = new Set();
    for (const section of step.sections) {
      const own = step.parts.filter((p) => p.section === section.id).map((p) => p.id);
      let list = own;
      if (typeof section.applies === 'function') {
        try { list = section.applies(state).filter((id) => own.includes(id)); } catch { list = own; }
      }
      for (const id of list) out.add(id);
    }
    return out;
  }

  function ensureMounted(entry) {
    if (entry.instance) return;
    try {
      entry.instance = entry.section.mount(entry.host, ctx);
    } catch (err) {
      console.error(`[steps] ${entry.section.id} failed to mount`, err);
      entry.instance = { update() {}, destroy() {}, broken: true };
      return;
    }
    if (entry.parts.length > 1) tagParts(entry);
  }

  // A section of several parts: read its tags and put each part's heading
  // before the first element that belongs to that part alone.
  function tagParts(entry) {
    const els = [...entry.host.querySelectorAll('[data-part]')];
    const headings = [];
    for (const partId of entry.parts) {
      const anchor = els.find((el) => tokens(el).length === 1 && tokens(el)[0] === partId)
        ?? els.find((el) => tokens(el).includes(partId));
      if (!anchor) continue;
      const part = STEP_LIST.find((s) => s.id === entry.step).parts.find((p) => p.id === partId);
      const heading = h('h3', { class: 'part-heading', text: part.name });
      heading.dataset.part = partId;
      anchor.parentNode.insertBefore(heading, anchor);
      headings.push(heading);
    }
    entry.tagged = [entry.host, ...els, ...headings];
  }

  let layout = null;
  let shownStep = null;
  const shownPart = new Map();
  let summaryTimer = 0;

  function render(state) {
    const phone = layout === 'phone';
    const step = stepOf(state);
    const apply = applicable(step, state);
    const stepParts = step.parts.filter((p) => apply.has(p.id));
    let part = state.view.parts?.[step.id];
    if (!apply.has(part)) part = stepParts[0]?.id;

    // Tabs: the current one is dark, the others light grey; nothing is locked.
    for (const [id, t] of tabs) {
      const on = id === step.id;
      t.tab.setAttribute('aria-selected', String(on));
      t.tab.tabIndex = on ? 0 : -1;
    }
    headTitle.textContent = step.title;

    // Part row (phone): only the parts that apply, the current one marked.
    for (const [id, group] of partGroups) group.hidden = id !== step.id;
    partRow.setAttribute('aria-label', `${step.title} parts`);
    for (const p of step.parts) {
      const b = partButtons.get(`${step.id}/${p.id}`);
      b.hidden = !apply.has(p.id);
      const on = p.id === part;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    // The divider only between shown everyday parts and shown finer ones.
    const fine = (p) => p.fine;
    const divided = stepParts.some((p) => !fine(p)) && stepParts.some(fine);
    for (const d of partGroups.get(step.id).querySelectorAll('.part-divider')) d.hidden = !divided;

    // Pages and the disclosure.
    for (const [id, page] of pages) page.hidden = id !== step.id;
    if (moreBox) {
      moreBox.classList.toggle('is-open', moreOpen);
      moreToggle.setAttribute('aria-expanded', String(moreOpen));
    }

    // Sections: mount what shows, show only the parts that apply (and on a
    // phone only the current part), and update only what is in view; a
    // hidden section catches up the moment it shows.
    for (const entry of entries) {
      if (entry.step !== step.id) continue;
      const inView = phone ? entry.parts.includes(part) : (!entry.fine || moreOpen);
      const fresh = inView && !entry.instance;
      if (inView) ensureMounted(entry);
      for (const el of entry.tagged) {
        const t = tokens(el);
        const on = phone ? t.includes(part) : t.some((x) => apply.has(x));
        if (el.classList.contains('is-part-off') === on) el.classList.toggle('is-part-off', !on);
      }
      if (inView && !fresh) {
        try { entry.instance.update(state); } catch (err) { console.error(`[steps] ${entry.section.id} update failed`, err); }
      }
    }

    // A new step or part starts at the top of its controls.
    if (shownStep !== step.id || (phone && shownPart.get(step.id) !== part)) {
      scroll.scrollTop = 0;
      if (phone && part) keepInView(partButtons.get(`${step.id}/${part}`));
    }
    shownStep = step.id;
    shownPart.set(step.id, part);

    // Phone: the sheet or the dock above the bar (mobile stage M3, M5).
    const sheet = phone && (sheetOpen || step.id === 'print');
    panel.classList.toggle('steps--sheet', sheet);
    panel.classList.toggle('steps--dock', phone && !sheet);
    panel.classList.toggle('steps--print', step.id === 'print');
    collapse.hidden = !canCollapse();
    dock.grabber.setAttribute('aria-expanded', String(sheet));
    dock.setActive(phone && !sheet);
  }

  // The part row scrolls sideways; keep the chosen part in sight.
  function keepInView(b) {
    const row = partRow;
    if (!b || row.scrollWidth <= row.clientWidth) return;
    const left = b.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + b.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = left - (row.clientWidth - b.offsetWidth) / 2;
    }
  }

  // Each step's tab describes it with its section's summary, as the closed
  // cards did ("Shape: 170 × 124 mm · circle · twist 0°"). Not on every
  // frame of a drag: once the edits pause.
  function renderSummaries(state) {
    for (const step of STEP_LIST) {
      let text = '';
      try { text = step.sections[0].summary(state.design, ctx) || ''; } catch { text = ''; }
      const t = tabs.get(step.id);
      if (t.text === text) continue;
      t.text = text;
      t.desc.textContent = text;
      t.tab.title = layout === 'phone' ? '' : `${step.title}: ${text}`;
    }
  }
  const scheduleSummaries = () => {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => renderSummaries(store.state), 250);
  };

  function setLayout() {
    const nextLayout = phoneMedia.matches ? 'phone' : 'desktop';
    if (nextLayout === layout) return;
    layout = nextLayout;
    panel.classList.toggle('steps--phone', layout === 'phone');
    // The first-visit tip sits at the top of the dock on a phone, of the controls on desktop.
    if (layout === 'phone') dock.tipSlot.append(tipHost);
    else scroll.prepend(tipHost);
    for (const t of tabs.values()) t.text = null;
    renderSummaries(store.state);
    render(store.state);
  }

  const onMedia = () => setLayout();
  phoneMedia.addEventListener('change', onMedia);
  setLayout();
  const unsubscribe = store.subscribe((state, what) => {
    if (what.has('design') || what.has('view')) render(state);
    if (what.has('design')) scheduleSummaries();
  });

  return {
    tipHost,
    destroy() {
      unsubscribe();
      clearTimeout(summaryTimer);
      phoneMedia.removeEventListener('change', onMedia);
      for (const entry of entries) entry.instance?.destroy();
      dock.destroy();
      panel.replaceChildren();
      panel.classList.remove('steps', 'steps--phone', 'steps--sheet', 'steps--dock');
    },
  };
}
