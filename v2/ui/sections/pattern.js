// Pattern section (D35–D48, docs/design/v2-pattern-studio.md §3): the
// bead-scale Pattern, design.pattern, as the parts of the Pattern step:
//   Pattern   the starter drawings at the pot's own bead scale, None, My
//             patterns (saved with their settings, D48; × deletes one) and
//             the drawing of your own on the pot, Make (the 2D editor on an
//             empty grid), Edit (on the drawing on the pot: a starter as a
//             copy, your own in place) and Save (to My patterns, named)
//   Depth     out = +depth, in = −depth, up to two thirds of a bead (D38, D61)
//   Density   the node spacing around, as mm or as points per layer, with the
//             readout "96 points per layer · 3.8–6.1 mm" (D40)
//   From / to its own range (D41); the blue bracket on the pot sets it too
//   Fade      Even, Fades up, Fades down, Middle or Diagonal, and an amount (D42)
//   Soften    a blur of 0–2 cells; 0 is crisp (D42)
//   Slant     whole cells a layer the drawing moves by, so stripes lean (D70);
//             with the Facets morph, a slant of its own on each facet (D71)
// One row of a drawing is one layer and one cell one point, so what you see
// in a swatch is what prints.

import { h, slider, numberField, segmented, toggle } from '../controls.js';
import { DEPTH_BEADS, SPACING_BEADS } from '../../core/layer-pattern.js';
import { FACETS_MAP } from '../../core/morph.js';
import { LIMITS } from '../../core/design.js';
import { BLEND_OPTIONS, SITS_OPTIONS, SITS_NOTES, depthReach } from '../dock-tools.js';
import {
  findLayerEntry, layerMineEntries, pickLayerPattern, drawLayerEntry, readoutOf, densityText, softenText, slantText, wholeText, densityLimits, setDensityFace,
  openEditor, editableEntry, savableEntry, saveEntry, pickSavedPattern, targetKey, savedSpacingMm, drawsWith,
} from '../pattern-actions.js';
import { listPatterns, deletePattern, onPatternsChanged } from '../../store/assets.js';
import { createSaveForm, createDeleteConfirm } from '../my-patterns.js';
import { labelIcon } from '../press-label.js';
import { ICONS } from '../icons.js';

const SWATCH = 52;
const TARGET = { kind: 'pattern' };
const PARTS = ['drawing', 'depth', 'density', 'range', 'fade', 'soften', 'slant'];
const quarter = (v) => Math.round(v * 4) / 4;
const SLANT = LIMITS.slantCells;
const FADE_WHERE = { fadesUp: 'At the top: ', fadesDown: 'At the bottom: ', middle: 'Halfway up: ', diagonal: 'In the band: ' };
const deepest = (d) => Math.floor(DEPTH_BEADS.max * d.layers.beadWidthMm * 100) / 100;
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
    const tile = (id, name, entry, onPick = () => pickLayerPattern(ctx, id)) => {
      const canvas = entry
        ? h('canvas', { class: 'swatch-canvas', width: 1, height: 1, 'aria-hidden': 'true' })
        : h('span', { class: 'swatch-none', 'aria-hidden': 'true' });
      const btn = h('button', { type: 'button', class: 'swatch', title: name, 'aria-pressed': 'false' }, [canvas, h('span', { class: 'swatch-name', text: name })]);
      btn.addEventListener('click', () => {
        say('');
        onPick();
      });
      return { id, btn, el: btn, canvas, entry, drawn: '' };
    };
    const tiles = (library.layerPatterns ?? []).map((p) => tile(p.id, p.name, p));
    tiles.push(tile(null, 'None', null));
    grid.append(...tiles.map((t) => t.btn));
    let mineTiles = [];
    let mineKey = null;

    // Make your own (an empty grid) and Edit (the drawing on the pot), in the 2D editor (§3.8, D46).
    const editorMsg = h('p', { class: 'panel-note image-msg', role: 'alert', hidden: true });
    const actionTile = (icon, name, label, mode) => {
      const mark = h('span', { class: 'swatch-add', 'aria-hidden': 'true' });
      mark.innerHTML = ICONS[icon];
      const btn = labelIcon(h('button', { type: 'button', class: 'swatch swatch-action' }, [mark, h('span', { class: 'swatch-name', text: name })]), label);
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
    const makeBtn = actionTile('make', 'Make', 'Make your own pattern', 'make');
    const editBtn = actionTile('edit', 'Edit', 'Edit the pattern', 'edit');

    // ---- My patterns (D48): Save with a name, apply in one tap, × deletes ----
    let saved = [];
    const refreshSaved = () =>
      Promise.resolve(listPatterns('pattern'))
        .then((list) => {
          saved = Array.isArray(list) ? list : [];
          update(store.state);
        })
        .catch((err) => console.warn('My patterns not loaded', err));
    const mineMsg = h('p', { class: 'panel-note image-msg', role: 'status', hidden: true });
    const say = (text) => {
      mineMsg.textContent = text;
      mineMsg.hidden = !text;
    };
    const saveMark = h('span', { class: 'swatch-add', 'aria-hidden': 'true' });
    saveMark.innerHTML = ICONS.keep;
    const saveBtn = labelIcon(h('button', { type: 'button', class: 'swatch swatch-action' }, [saveMark, h('span', { class: 'swatch-name', text: 'Save' })]), 'Save the pattern to My patterns');
    const saveForm = createSaveForm({
      kind: 'pattern',
      build: () => savableEntry(store.state.design, library, TARGET),
      save: (entry, name, list) => saveEntry(ctx, TARGET, entry, name, list),
      onClose: (result) => {
        if (result) say(result.replaced ? `Updated “${result.entry.name}” in My patterns.` : `Saved “${result.entry.name}” to My patterns.`);
        if (saveBtn.isConnected && !saveBtn.hidden) saveBtn.focus({ preventScroll: true });
      },
    });
    saveBtn.addEventListener('click', () => {
      confirm.close();
      say('');
      saveForm.open();
    });
    const confirm = createDeleteConfirm({
      onDelete: async ({ entry }) => {
        try {
          await deletePattern(entry.id);
        } catch (err) {
          console.warn('Pattern not deleted', err);
          say('That pattern couldn’t be deleted. Try again.');
          return;
        }
        const used = drawsWith(store.state.design, library, entry);
        await refreshSaved();
        say(used ? `“${entry.name}” is no longer in My patterns. This design keeps its own copy.` : `Deleted “${entry.name}” from My patterns.`);
        makeBtn.focus({ preventScroll: true });
      },
    });
    const askDelete = (entry, from) => {
      saveForm.close();
      say('');
      const used = drawsWith(store.state.design, library, entry);
      confirm.ask(entry, from, `Delete “${entry.name}” from My patterns?${used ? ' This design keeps its own copy, so the pot doesn’t change.' : ''}`);
    };

    // ---- Depth ----
    const depth = slider({
      label: 'Depth', unit: 'mm', min: 0, max: 1.5, step: 0.01, snap: 0.05, decimals: 2, value: 0, info: '',
      onInput: edit('Pattern depth', (p, v, d) => { p.depthMm = Math.min(Math.max(0, v), deepest(d)); }),
      onCommit: commit,
    });

    // ---- Sits: the plain wall on the Pattern's middle, outside or inside (D78) ----
    const sits = segmented({
      label: 'Sits', options: SITS_OPTIONS, value: 'centre',
      onChange: (v) => store.apply('Pattern sits', (d) => { if (d.pattern) d.pattern.sits = v; }),
    });
    const sitsNote = h('p', { class: 'panel-note' });
    const sitsBox = h('div', { class: 'slot-settings' }, [sits.el, sitsNote]);

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
    // The whole pot's points, from the preview once it is of this design (D58).
    const potPoints = h('p', { class: 'panel-note density-readout density-pot' });
    const densityBox = h('div', { class: 'pattern-density' }, [face.el, spacing.el, points.el, readout, potPoints]);
    const showPotPoints = (state) => {
      const known = !!state.design.pattern && !!state.result && ctx.resultDesign?.() === state.design && !ctx.resultIsPlain?.();
      potPoints.textContent = known ? `The whole pot: ${wholeText(state.result.pointCount)} points` : '';
      potPoints.hidden = !known;
    };
    const offResult = store.subscribe((state, what) => { if (what.has('result') || what.has('design')) showPotPoints(state); });

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

    // ---- Slant (D70, D71) ----
    const slant = slider({
      label: 'Slant', unit: 'cells', min: SLANT.min, max: SLANT.max, step: 0.25, snap: 1, decimals: 2, value: 0, info: '',
      onInput: edit('Slant', (p, v) => { p.slant.cells = quarter(Math.min(SLANT.max, Math.max(SLANT.min, v))); }),
      onCommit: commit,
    });
    const perFacet = toggle({
      label: 'Different on each facet', value: false,
      onChange: (v) => store.apply(v ? 'Slant on each facet' : 'Slant even', (d) => { if (d.pattern) d.pattern.slant.perFacet = v; }),
    });
    const slantTo = slider({
      label: 'To', unit: 'cells', min: SLANT.min, max: SLANT.max, step: 0.25, snap: 1, decimals: 2, value: 0, info: '',
      onInput: edit('Slant to', (p, v) => { p.slant.toCells = quarter(Math.min(SLANT.max, Math.max(SLANT.min, v))); }),
      onCommit: commit,
    });
    const slantNote = h('p', { class: 'panel-note' });
    const slantBox = h('div', { class: 'slot-settings' }, [slant.el, perFacet.el, slantTo.el, slantNote]);

    // The Pattern step's parts (ui/steps.js).
    for (const e of [strip, saveForm.el, confirm.el, mineMsg, editorMsg, about]) e.dataset.part = 'drawing';
    depth.el.dataset.part = 'depth';
    sitsBox.dataset.part = 'depth';
    densityBox.dataset.part = 'density';
    rangeBox.dataset.part = 'range';
    fadeBox.dataset.part = 'fade';
    soften.el.dataset.part = 'soften';
    slantBox.dataset.part = 'slant';
    el.append(strip, saveForm.el, confirm.el, mineMsg, editorMsg, about, depth.el, sitsBox, densityBox, rangeBox, fadeBox, soften.el, slantBox);

    // A saved Pattern: its tile applies it in one tap (D48), and × on its corner deletes it.
    function mineTile(e) {
      if (!e.saved) return tile(e.id, e.name, e);
      const t = tile(e.id, e.name, e, () => pickSavedPattern(ctx, e.saved));
      const del = labelIcon(h('button', { type: 'button', class: 'swatch-del' }, [
        h('span', { class: 'swatch-del-dot', 'aria-hidden': 'true', text: '×' }),
      ]), `Delete ${e.name} from My patterns`);
      del.addEventListener('click', () => askDelete(e.saved, del));
      t.el = h('div', { class: 'swatch-item' }, [t.btn, del]);
      return t;
    }

    function renderMine(d, current, r) {
      const list = layerMineEntries(library, d, saved);
      // A replaced entry keeps its id and name; its time rebuilds the tile, so a tap applies what was saved last.
      const key = list.map((e) => `${e.id}|${e.name}|${e.saved?.updated ?? 0}`).join(';');
      if (key !== mineKey) {
        mineKey = key;
        mineTiles = list.map(mineTile);
        mineGrid.replaceChildren(...mineTiles.map((t) => t.el), makeBtn, editBtn, saveBtn);
        if (confirm.pending && !saved.some((e) => e.id === confirm.pending.entry.id)) confirm.close();
      }
      const editable = editableEntry(d, library, TARGET);
      editBtn.hidden = !editable;
      saveBtn.hidden = !editable;
      if (editable) {
        labelIcon(editBtn, editable.own ? `Edit ${editable.name}` : `Edit a copy of ${editable.name}`);
      }
      const onKey = targetKey(d, library, TARGET);
      for (const t of mineTiles) {
        const on = t.entry.saved ? t.entry.key === onKey : t.id === current;
        t.btn.setAttribute('aria-pressed', String(on));
        drawLayerEntry(t, t.entry, d, SWATCH, on ? r?.spacingMinMm : t.entry.saved ? savedSpacingMm(d, t.entry.saved) : undefined);
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
      depth.setLimits({ max: Math.max(deepest(d), p.depthMm) });
      depth.set(p.depthMm);
      depth.setInfo(p.depthMm > 0 ? `${depthReach(p)} · up to ⅔ of a bead (${fmt(deepest(d))} mm)` : 'Flat: the drawing doesn’t print');

      sits.set(p.sits);
      sitsNote.textContent = SITS_NOTES[p.sits] ?? '';

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
      showPotPoints(state);

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
      soften.setInfo(softenText(p.softenCells, r));

      const facets = d.form.morph?.map === FACETS_MAP;
      const each = facets && p.slant.perFacet;
      slant.set(p.slant.cells);
      perFacet.el.hidden = !facets;
      perFacet.set(p.slant.perFacet);
      slantTo.el.hidden = !each;
      slantTo.set(p.slant.toCells);
      slant.setInfo(each ? 'From' : slantText(d, r));
      slantNote.textContent = each
        ? `${slantText(d, r, { perFacet: true })}. Within a facet the lines run on; at its edges they turn.`
        : facets ? 'Moves the drawing along a little every layer, so stripes lean. With Facets, each facet can lean its own way.' : 'Moves the drawing along a little every layer, so stripes lean.';
    };
    update(store.state);
    refreshSaved();
    const offPatterns = onPatternsChanged(refreshSaved);

    return {
      update,
      destroy() {
        offPatterns?.();
        offResult?.();
        for (const c of [depth, spacing, points, from, to, amount, soften, slant, perFacet, slantTo]) c.destroy?.();
        el.replaceChildren();
      },
    };
  },
};

export default section;
export const { id, title, summary, applies, mount } = section;
