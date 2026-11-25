// Pattern section (D35–D48, docs/design/v2-pattern-studio.md §3): the
// bead-scale Pattern, design.pattern, as the parts of the Pattern step:
//   Pattern   the starter drawings at the pot's own bead scale, None, your
//             own, Make (the 2D editor on an empty grid) and Edit (on the
//             drawing on the pot: a starter as a copy, your own in place)
//   Depth     out = +depth, in = −depth, up to half a bead (D38)
//   Density   the node spacing around, as mm or as points per layer, with the
//             readout "96 points per layer · 3.8–6.1 mm" (D40)
//   From / to its own range (D41); the blue bracket on the pot sets it too
//   Fade      Even, Fades up, Fades down, Middle or Diagonal, and an amount (D42)
//   Soften    a blur of 0–2 cells; 0 is crisp (D42)
// One row of a drawing is one layer and one cell one point, so what you see
// in a swatch is what prints.

import { h, slider, numberField, segmented } from '../controls.js';
import { DEPTH_BEADS, SPACING_BEADS } from '../../core/layer-pattern.js';
import { BLEND_OPTIONS } from '../dock-tools.js';
import {
  findLayerEntry, layerMineEntries, pickLayerPattern, drawLayerEntry, readoutOf, densityText, densityLimits, setDensityFace,
  openEditor, editableEntry,
} from '../pattern-actions.js';

const SWATCH = 52;
const PARTS = ['drawing', 'depth', 'density', 'range', 'fade', 'soften'];
const FADE_WHERE = { fadesUp: 'At the top: ', fadesDown: 'At the bottom: ', middle: 'Halfway up: ', diagonal: 'In the band: ' };
const halfBead = (d) => Math.floor(DEPTH_BEADS.max * d.layers.beadWidthMm * 100) / 100;
const fmt = (v, decimals = 2) => String(Math.round(v * 10 ** decimals) / 10 ** decimals);

const section = {
  id: 'pattern',
  title: 'Pattern',

  summary(design, ctx) {
    const p = design.pattern;
    if (!p) return 'none';
    const entry = findLayerEntry(ctx?.library, p.drawing, design.assets);
    return `${entry?.name ?? 'drawing missing'} · ${fmt(p.depthMm)} mm deep`;
  },

  /** Only the drawings until there is a Pattern; then every part (C34). */
  applies(state) {
    return state.design.pattern ? PARTS : ['drawing'];
  },

  mount(el, ctx) {
    const { store, library } = ctx;
    const commit = () => store.commit();
    const edit = (label, fn) => (v) => store.change(label, (d) => { if (d.pattern) fn(d.pattern, v, d); });

    // ---- Pattern: the starters, None, your own ----
    const grid = h('div', { class: 'swatch-grid', role: 'group', 'aria-label': 'Patterns' });
    const mineLabel = h('div', { class: 'grid-label', id: `pmine-label-${Math.random().toString(36).slice(2, 8)}`, text: 'My patterns' });
    const mineGrid = h('div', { class: 'swatch-grid mine-grid', role: 'group', 'aria-labelledby': mineLabel.id });
    const strip = h('div', { class: 'swatch-strip' }, [grid, mineLabel, mineGrid]);
    const about = h('p', { class: 'panel-note pattern-about' });
    const tile = (id, name, entry) => {
      const canvas = entry
        ? h('canvas', { class: 'swatch-canvas', width: 1, height: 1, 'aria-hidden': 'true' })
        : h('span', { class: 'swatch-none', 'aria-hidden': 'true' });
      const btn = h('button', { type: 'button', class: 'swatch', title: name, 'aria-pressed': 'false' }, [canvas, h('span', { class: 'swatch-name', text: name })]);
      btn.addEventListener('click', () => pickLayerPattern(ctx, id));
      return { id, btn, canvas, entry, drawn: '' };
    };
    const tiles = (library.layerPatterns ?? []).map((p) => tile(p.id, p.name, p));
    tiles.push(tile(null, 'None', null));
    grid.append(...tiles.map((t) => t.btn));
    let mineTiles = [];
    let mineKey = null;

    // Make your own (an empty grid) and Edit (the drawing on the pot), in the 2D editor (§3.8, D46).
    const editorMsg = h('p', { class: 'panel-note image-msg', role: 'alert', hidden: true });
    const actionTile = (glyph, name, label, mode) => {
      const btn = h('button', { type: 'button', class: 'swatch swatch-action', title: label, 'aria-label': label }, [
        h('span', { class: 'swatch-add', 'aria-hidden': 'true', text: glyph }),
        h('span', { class: 'swatch-name', text: name }),
      ]);
      btn.addEventListener('click', () => {
        editorMsg.hidden = true;
        openEditor(ctx, { kind: 'pattern' }, { mode, returnFocus: btn }).catch((err) => {
          console.warn('Editor not loaded', err);
          editorMsg.textContent = 'The editor didn’t load. Reload the page to try again.';
          editorMsg.hidden = false;
        });
      });
      return btn;
    };
    const makeBtn = actionTile('+', 'Make', 'Make your own pattern', 'make');
    const editBtn = actionTile('✎', 'Edit', 'Edit the pattern', 'edit');

    // ---- Depth ----
    const depth = slider({
      label: 'Depth', unit: 'mm', min: 0, max: 1.5, step: 0.01, snap: 0.05, decimals: 2, value: 0, info: '',
      onInput: edit('Pattern depth', (p, v, d) => { p.depthMm = Math.min(Math.max(0, v), halfBead(d)); }),
      onCommit: commit,
    });

    // ---- Density: spacing in mm or points per layer (D40) ----
    const face = segmented({
      label: 'Density as',
      options: [{ value: 'spacing', label: 'Spacing' }, { value: 'points', label: 'Points per layer' }],
      value: 'spacing',
      onChange: (by) => {
        const r = readoutOf(store.state.design, library);
        store.apply('Density', (d) => { if (d.pattern) setDensityFace(d, by, r); });
      },
    });
    const spacing = slider({
      label: 'Spacing', unit: 'mm', min: 1.5, max: 9, step: 0.05, snap: 0.5, decimals: 2, value: 3,
      onInput: edit('Pattern spacing', (p, v) => { p.density.spacingMm = v; }),
      onCommit: commit,
    });
    const points = numberField({
      label: 'Points per layer', unit: '', min: 1, max: 1600, step: 1, decimals: 0, value: 96,
      onInput: edit('Pattern points', (p, v) => {
        const c = readoutOf(store.state.design, library)?.columns ?? 1;
        p.density.points = Math.max(c, Math.round(v / c) * c);
      }),
      onCommit: commit,
    });
    const readout = h('p', { class: 'panel-note density-readout', role: 'status' });
    const densityBox = h('div', { class: 'pattern-density' }, [face.el, spacing.el, points.el, readout]);

    // ---- From / to ----
    const from = numberField({
      label: 'From', unit: 'mm', compact: true, min: 0, max: 1000, step: 0.5, decimals: 1, value: 0,
      onInput: edit('Pattern from', (p, v, d) => { p.fromMm = Math.max(0, Math.min(v, p.toMm - d.layers.layerHeightMm)); }),
      onCommit: commit,
    });
    const to = numberField({
      label: 'To', unit: 'mm', compact: true, min: 0, max: 1000, step: 0.5, decimals: 1, value: 0,
      onInput: edit('Pattern to', (p, v, d) => { p.toMm = Math.min(d.form.height, Math.max(v, p.fromMm + d.layers.layerHeightMm)); }),
      onCommit: commit,
    });
    const rangeRow = h('div', { class: 'nf range-row' }, [
      h('span', { class: 'nf-label', text: 'From / to' }),
      h('div', { class: 'range-fields' }, [from.el, h('span', { class: 'range-dash', 'aria-hidden': 'true', text: '–' }), to.el]),
    ]);
    const rangeNote = h('p', { class: 'panel-note', text: 'Or drag the blue bracket beside the pot. The Pattern starts and stops sharply.' });
    const rangeBox = h('div', {}, [rangeRow, rangeNote]);

    // ---- Fade ----
    const fade = segmented({
      label: 'Fade', options: BLEND_OPTIONS, value: 'even',
      onChange: (v) => store.apply('Fade', (d) => { if (d.pattern) d.pattern.fade.shape = v; }),
    });
    const amount = slider({
      label: 'Amount', unit: '%', min: 0, max: 100, step: 1, snap: 5, decimals: 0, value: 100, info: '',
      onInput: edit('Fade amount', (p, v) => { p.fade.amount = Math.min(1, Math.max(0, v / 100)); }),
      onCommit: commit,
    });
    const fadeNote = h('p', { class: 'panel-note' });
    const fadeBox = h('div', { class: 'blend-settings' }, [fade.el, fadeNote, amount.el]);

    // ---- Soften ----
    const soften = slider({
      label: 'Soften', unit: 'cells', min: 0, max: 2, step: 0.05, snap: 0.25, decimals: 2, value: 0, info: '',
      onInput: edit('Soften', (p, v) => { p.softenCells = Math.min(2, Math.max(0, v)); }),
      onCommit: commit,
    });

    // The Pattern step's parts (ui/steps.js).
    for (const e of [strip, editorMsg, about]) e.dataset.part = 'drawing';
    depth.el.dataset.part = 'depth';
    densityBox.dataset.part = 'density';
    rangeBox.dataset.part = 'range';
    fadeBox.dataset.part = 'fade';
    soften.el.dataset.part = 'soften';
    el.append(strip, editorMsg, about, depth.el, densityBox, rangeBox, fadeBox, soften.el);

    function renderMine(d, current, r) {
      const list = layerMineEntries(library, d);
      const key = list.map((e) => `${e.id}|${e.name}`).join(';');
      if (key !== mineKey) {
        mineKey = key;
        mineTiles = list.map((e) => tile(e.id, e.name, e));
        mineGrid.replaceChildren(...mineTiles.map((t) => t.btn), makeBtn, editBtn);
      }
      const editable = editableEntry(d, library, { kind: 'pattern' });
      editBtn.hidden = !editable;
      if (editable) {
        const label = editable.own ? `Edit ${editable.name}` : `Edit a copy of ${editable.name}`;
        editBtn.setAttribute('aria-label', label);
        editBtn.title = label;
      }
      for (const t of mineTiles) {
        t.btn.setAttribute('aria-pressed', String(t.id === current));
        drawLayerEntry(t, t.entry, d, SWATCH, t.id === current ? r?.spacingMinMm : undefined);
      }
    }

    const update = (state) => {
      const d = state.design;
      const p = d.pattern;
      const current = p?.drawing ?? null;
      const r = readoutOf(d, library);
      for (const t of tiles) {
        t.btn.setAttribute('aria-pressed', String(t.id === current));
        // The one on the pot at its own spacing, the others at their defaults.
        if (t.entry) drawLayerEntry(t, t.entry, d, SWATCH, t.id === current && r ? r.spacingMinMm : undefined);
      }
      renderMine(d, current, r);
      const entry = p ? findLayerEntry(library, p.drawing, d.assets) : null;
      about.textContent = !p
        ? 'Pick a pattern to put it on the pot. Each row prints as one layer and each cell as one point around, so what you see is what prints.'
        : entry ? entry.description || `${entry.name}: your own drawing.` : 'This drawing isn’t available, so the wall prints plain.';
      if (!p) return;

      const w = d.layers.beadWidthMm;
      depth.setLimits({ max: Math.max(halfBead(d), p.depthMm) });
      depth.set(p.depthMm);
      depth.setInfo(p.depthMm > 0 ? `Out +${fmt(p.depthMm)} mm, in −${fmt(p.depthMm)} mm · up to half a bead (${fmt(halfBead(d))} mm)` : 'Flat: the drawing doesn’t print');

      const by = p.density.by;
      face.set(by);
      spacing.el.hidden = by !== 'spacing';
      points.el.hidden = by !== 'points';
      spacing.setLimits({ min: Math.ceil(SPACING_BEADS.min * w * 100) / 100, max: Math.floor(SPACING_BEADS.max * w * 100) / 100 });
      spacing.set(p.density.spacingMm);
      if (r) {
        const lim = densityLimits(d, r);
        points.setLimits({ ...lim.points });
        points.set(r.nodes);
      }
      readout.textContent = r ? densityText(r) : '';

      from.set(p.fromMm);
      to.set(p.toMm);
      from.setLimits({ max: d.form.height });
      to.setLimits({ max: d.form.height });

      fade.set(p.fade.shape);
      const even = p.fade.shape === 'even';
      amount.el.hidden = even;
      amount.set(Math.round(p.fade.amount * 100));
      amount.setInfo(even ? '' : `${FADE_WHERE[p.fade.shape] ?? ''}${100 - Math.round(p.fade.amount * 100)} % of the depth`);
      fadeNote.textContent = {
        even: 'The Pattern prints in full from From to To.',
        fadesUp: 'Full at the bottom, fading towards the top.',
        fadesDown: 'Full at the top, fading towards the bottom.',
        middle: 'Weakest halfway up.',
        diagonal: 'A band without the Pattern winds once round the pot.',
      }[p.fade.shape] ?? '';

      soften.set(p.softenCells);
      soften.setInfo(p.softenCells > 0 ? 'Blurs each point into its neighbours; the drawing stays in, flat or out' : 'Crisp: what you draw is what prints');
    };
    update(store.state);

    return {
      update,
      destroy() {
        for (const c of [depth, spacing, points, from, to, amount, soften]) c.destroy?.();
        el.replaceChildren();
      },
    };
  },
};

export default section;
export const { id, title, summary, applies, mount } = section;
