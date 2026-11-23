// Surface section (design §9.2, C7, C8, C16, C18): two pattern slots, the
// swatch grid that fills the selected slot, per-slot settings, and the shared
// range and blend.

import { numberField, slider, segmented, h } from '../controls.js';
import { drawSwatch, beadGrid } from '../swatch.js';
import { PLAIN } from '../../core/patterns.js';
import { LIMITS } from '../../core/design.js';
import { footprintAt, limit } from './shape.js';

const SLOT_SUB = { a: 'main pattern', b: 'blends in' };
const BLEND_LABELS = { even: 'even', fadesUp: 'fades up', middle: 'middle' };
const GRID_SWATCH = 52;
const SLOT_SWATCH = 34;
// Neutral values for a slot made from Plain, where there is nothing to keep.
const PLAIN_SLOT = { depthMm: 0, repeats: 1 };

function findEntry(library, id) {
  if (id === PLAIN.id) return PLAIN;
  return library.patterns.find((p) => p.id === id) ?? null;
}

// 'lib:out-in-out@1' → 'Out in out', for a summary without the library at hand.
function prettyId(id) {
  const s = String(id).replace(/^lib:/, '').replace(/@\d+$/, '').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Whole layers, and never under the core's minimum tile height (the core
// would clamp it on the next load and the design would quietly change).
const TILE_MIN = LIMITS.tileHeightMm?.min ?? 0;
const TILE_MAX = LIMITS.tileHeightMm?.max ?? Infinity;
function snapToLayers(mm, layerHeightMm) {
  let n = Math.max(1, Math.ceil(TILE_MIN / layerHeightMm - 1e-9), Math.round(mm / layerHeightMm));
  n = Math.min(n, Math.max(1, Math.floor(TILE_MAX / layerHeightMm + 1e-9)));
  return Math.round(n * layerHeightMm * 1000) / 1000;
}

const section = {
  id: 'surface',
  title: 'Surface',
  advanced: false,

  summary(design, ctx) {
    const lib = ctx?.library;
    const name = (slot) => (lib && findEntry(lib, slot.pattern)?.name) || prettyId(slot.pattern);
    const s = design.surface;
    if (!s.b) return s.a.pattern === PLAIN.id ? 'plain, no pattern' : `${name(s.a)} · ${s.a.depthMm} mm`;
    return `${name(s.a)} → ${name(s.b)} · ${BLEND_LABELS[s.blend.shape] ?? s.blend.shape}`;
  },

  mount(el, ctx) {
    const { store, library } = ctx;
    const commit = () => store.commit();
    const slotOf = () => (store.state.view.slot === 'b' ? 'b' : 'a');
    const S = () => slotOf().toUpperCase();

    // Slot cards and swap.
    const slotCards = {};
    const makeSlotCard = (s) => {
      const canvas = h('canvas', { class: 'slot-swatch', width: 1, height: 1, 'aria-hidden': 'true' });
      const name = h('span', { class: 'slot-name' });
      const btn = h('button', { type: 'button', class: 'slot-card' }, [
        h('span', { class: 'slot-thumb' }, [canvas, h('span', { class: 'slot-letter', 'aria-hidden': 'true', text: s.toUpperCase() })]),
        h('span', { class: 'slot-text' }, [name, h('span', { class: 'slot-sub', text: SLOT_SUB[s] })]),
      ]);
      btn.addEventListener('click', () => store.setView({ slot: s }));
      slotCards[s] = { btn, canvas, name, drawn: '' };
      return btn;
    };
    const swap = h('button', { type: 'button', class: 'icon-btn swap-btn', 'aria-label': 'Swap A and B', title: 'Swap A and B', text: '⇅' });
    swap.addEventListener('click', () => {
      if (!store.state.design.surface.b) return;
      store.apply('Swap A and B', (d) => {
        const t = d.surface.a;
        d.surface.a = d.surface.b;
        d.surface.b = t;
      });
    });
    const slots = h('div', { class: 'slot-row' }, [makeSlotCard('a'), swap, makeSlotCard('b')]);

    // Swatch grid: None (slot B only), the library, Plain.
    const gridLabel = h('div', { class: 'grid-label', id: `grid-label-${Math.random().toString(36).slice(2, 8)}` });
    const grid = h('div', { class: 'swatch-grid', role: 'group', 'aria-labelledby': gridLabel.id });
    const tiles = [];
    const addTile = (id, name, recipe) => {
      const canvas = recipe ? h('canvas', { class: 'swatch-canvas', width: 1, height: 1, 'aria-hidden': 'true' }) : h('span', { class: 'swatch-none', 'aria-hidden': 'true' });
      const btn = h('button', { type: 'button', class: 'swatch', title: name }, [canvas, h('span', { class: 'swatch-name', text: name })]);
      btn.addEventListener('click', () => pick(id));
      grid.append(btn);
      tiles.push({ id, name, recipe, btn, canvas, drawn: '' });
    };
    addTile(null, 'None', null);
    for (const p of library.patterns) addTile(p.id, p.name, p.recipe);
    addTile(PLAIN.id, PLAIN.name, PLAIN.recipe);

    const pick = (id) => {
      const s = slotOf();
      const entry = id && findEntry(library, id);
      store.apply(`Pattern ${S()}: ${id ? entry.name : 'None'}`, (d) => {
        const surf = d.surface;
        if (!id) {
          surf.b = null;
          return;
        }
        const defaults = entry.defaults ?? PLAIN_SLOT;
        const lh = d.layers.layerHeightMm;
        const cur = surf[s];
        if (!cur) {
          // Pattern rows line up with beads only at whole layers (C7).
          const tile = snapToLayers(defaults.tileHeightMm ?? surf.a.tileHeightMm, lh);
          surf[s] = { pattern: id, depthMm: defaults.depthMm ?? 0, repeats: defaults.repeats ?? 1, tileHeightMm: tile };
          if (s === 'b') surf.blend = { ...surf.blend, shape: 'fadesUp', amount: 1 };
          return;
        }
        // Switching texture keeps depth, repeats and tile height, except from
        // Plain (or a flat slot), which has nothing worth keeping.
        const flat = cur.pattern === PLAIN.id || !(cur.depthMm > 0);
        cur.pattern = id;
        if (flat && entry.defaults) {
          Object.assign(cur, entry.defaults);
          cur.tileHeightMm = snapToLayers(cur.tileHeightMm, lh);
        }
      });
    };

    // Per-slot settings. Each reads the selected slot when it fires.
    const editSlot = (label, fn) => (v) => store.change(`${label} ${S()}`, (d) => {
      const slot = d.surface[slotOf()];
      if (slot) fn(slot, v, d);
    });
    const depthLim = limit(['depthMm', 'surface.depthMm', 'patternDepth'], { min: 0, max: 8, step: 0.1 });
    const depth = slider({
      label: 'Depth', unit: 'mm', ...depthLim, decimals: 1, value: 0,
      onInput: editSlot('Depth', (slot, v) => { slot.depthMm = v; }),
      onCommit: commit,
    });
    const repeats = numberField({
      label: 'Repeats around', unit: '×', ...limit(['repeats', 'surface.repeats'], { min: 1, max: 200 }), step: 1, decimals: 0, value: 1, info: '',
      onInput: editSlot('Repeats', (slot, v) => { slot.repeats = Math.max(1, Math.round(v)); }),
      onCommit: commit,
    });
    const tileHeight = numberField({
      label: 'Tile height', unit: 'mm', ...limit(['tileHeightMm', 'surface.tileHeightMm'], { min: 1, max: 400 }), step: 1.5, decimals: 2, value: 20,
      // Rows of the pattern line up with beads only at whole layers, live and
      // at the end of the gesture (which also puts the snapped value in the field).
      onInput: editSlot('Tile height', (slot, v, d) => { slot.tileHeightMm = snapToLayers(v, d.layers.layerHeightMm); }),
      onCommit: (v) => {
        const lh = store.state.design.layers.layerHeightMm;
        store.change(`Tile height ${S()}`, (d) => {
          const slot = d.surface[slotOf()];
          if (slot) slot.tileHeightMm = snapToLayers(v, lh);
        });
        store.commit();
      },
    });
    const emptyNote = h('p', { class: 'panel-note', text: 'B is off. Pick a pattern above to blend it in.' });
    const plainNote = h('p', { class: 'panel-note', text: 'Plain leaves the surface smooth.' });
    const slotBox = h('div', { class: 'slot-settings' }, [depth.el, repeats.el, tileHeight.el]);

    // Shared range and blend.
    const rangeLim = limit(['fromMm', 'surface.fromMm'], { min: 0, max: 600, step: 1 });
    const from = numberField({
      label: 'From', unit: 'mm', compact: true, ...rangeLim, decimals: 1, value: 0,
      onInput: (v) => store.change('From', (d) => { d.surface.fromMm = Math.min(v, d.surface.toMm - 1); }),
      onCommit: commit,
    });
    const to = numberField({
      label: 'To', unit: 'mm', compact: true, ...rangeLim, decimals: 1, value: 0,
      onInput: (v) => store.change('To', (d) => { d.surface.toMm = Math.max(v, d.surface.fromMm + 1); }),
      onCommit: commit,
    });
    const rangeRow = h('div', { class: 'nf range-row' }, [
      h('span', { class: 'nf-label', text: 'From / to' }),
      h('div', { class: 'range-fields' }, [from.el, h('span', { class: 'range-dash', 'aria-hidden': 'true', text: '–' }), to.el]),
    ]);
    const blend = segmented({
      label: 'Blend',
      options: [{ value: 'even', label: 'Even' }, { value: 'fadesUp', label: 'Fades up' }, { value: 'middle', label: 'Middle' }],
      value: 'fadesUp',
      onChange: (v) => store.apply('Blend', (d) => {
        if (!d.surface.blend) d.surface.blend = { shape: v, amount: 1 };
        d.surface.blend.shape = v;
        // Even at full amount is all B; start at half so the first click shows a mix.
        if (v === 'even' && d.surface.blend.amount === 1) d.surface.blend.amount = 0.5;
      }),
    });
    const amount = slider({
      label: 'Amount', unit: '×', min: 0, max: 1, step: 0.05, decimals: 2, value: 1, info: '',
      onInput: (v) => store.change('Amount', (d) => { d.surface.blend.amount = v; }),
      onCommit: commit,
    });
    const blendBox = h('div', { class: 'blend-settings' }, [blend.el, amount.el]);

    el.append(slots, gridLabel, grid, emptyNote, plainNote, slotBox, rangeRow, blendBox);

    const update = (state) => {
      const d = state.design;
      const surf = d.surface;
      const s = state.view.slot === 'b' ? 'b' : 'a';
      const slot = surf[s];
      const fp = footprintAt(d);
      const layers = d.layers;

      for (const k of ['a', 'b']) {
        const card = slotCards[k];
        const sl = surf[k];
        const entry = sl && findEntry(library, sl.pattern);
        card.name.textContent = sl ? entry?.name ?? sl.pattern : 'None';
        card.btn.setAttribute('aria-pressed', String(k === s));
        card.btn.setAttribute('aria-label', `Slot ${k.toUpperCase()}, ${SLOT_SUB[k]}: ${sl ? entry?.name ?? sl.pattern : 'none'}`);
        card.canvas.hidden = !sl;
        card.btn.classList.toggle('is-none', !sl);
        if (sl && entry) {
          const g = beadGrid(sl, fp.perimeterMm, layers);
          const key = `${sl.pattern}|${Math.round(g.columns)}|${Math.round(g.rows)}`;
          if (key !== card.drawn) {
            drawSwatch(card.canvas, entry.recipe, { id: sl.pattern, size: SLOT_SWATCH, columns: g.columns, rows: g.rows });
            card.drawn = key;
          }
        }
      }
      swap.disabled = !surf.b;

      gridLabel.textContent = `Pattern for ${s.toUpperCase()}`;
      for (const t of tiles) {
        t.btn.hidden = t.id === null && s !== 'b';
        const selected = slot ? t.id === slot.pattern : t.id === null;
        t.btn.setAttribute('aria-pressed', String(selected));
        if (t.recipe) {
          // Each swatch at its own default repeat size, on this pot's bead grid.
          const entry = findEntry(library, t.id);
          const g = beadGrid(entry.defaults ?? { repeats: 12, tileHeightMm: 18 }, fp.perimeterMm, layers);
          const key = `${Math.round(g.columns)}|${Math.round(g.rows)}`;
          if (key !== t.drawn) {
            drawSwatch(t.canvas, t.recipe, { id: t.id, size: GRID_SWATCH, columns: g.columns, rows: g.rows });
            t.drawn = key;
          }
        }
      }

      const isPlain = slot && slot.pattern === PLAIN.id;
      emptyNote.hidden = !!slot;
      plainNote.hidden = !isPlain;
      slotBox.hidden = !slot || isPlain;
      if (slot && !isPlain) {
        depth.set(slot.depthMm);
        repeats.set(slot.repeats);
        const perRepeat = fp.perimeterMm / Math.max(1, slot.repeats);
        let info = `≈ ${Math.round(perRepeat)} mm per repeat`;
        if (d.form.plan.footprint === 'rectangle' && slot.repeats % 4 !== 0) info += ' · a multiple of 4 fits the corners';
        repeats.setInfo(info);
        tileHeight.setLimits({ step: layers.layerHeightMm });
        tileHeight.set(slot.tileHeightMm);
      }

      from.set(surf.fromMm);
      to.set(surf.toMm);
      from.setLimits({ max: d.form.height });
      to.setLimits({ max: d.form.height });

      blendBox.hidden = !surf.b;
      if (surf.b) {
        blend.set(surf.blend.shape);
        amount.set(surf.blend.amount);
        const b = Math.round(surf.blend.amount * 100);
        const where = { fadesUp: 'At the top: ', middle: 'Halfway up: ' }[surf.blend.shape] ?? '';
        amount.setInfo(`${where}A ${100 - b} % · B ${b} %`);
      }
    };
    update(store.state);

    return {
      update,
      destroy() {
        el.replaceChildren();
      },
    };
  },
};

export default section;
export const { id, title, advanced, summary, mount } = section;
