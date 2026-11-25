// Detailed morph section (D35, D36; design §9.2, C7, C8, C16, C18; once the
// Pattern step's "Surface"): the mm-scale relief, design.form.detail, as one
// part of Shape beside Morph. Two slots, the swatch grid that fills the
// selected slot, per-slot settings, and the shared range and blend (Even,
// Fades up, Fades down, Middle, Diagonal). Phase 2 (D24): "My patterns"
// (your own recipes and images) after the library, + Image, and Edit
// swatch… (a stopgap until the 2D editor, D45).

import { numberField, slider, segmented, h } from '../controls.js';
import { drawSwatch, beadGrid } from '../swatch.js';
import { PLAIN } from '../../core/patterns.js';
import { snapTileHeight } from '../../core/design.js';
import { footprintAt, limit } from './shape.js';
import { BLEND_OPTIONS } from '../dock-tools.js';
import { listPatterns, deletePattern, onPatternsChanged } from '../../store/assets.js';
import { printableResolution } from '../../core/raster.js';
import {
  IMAGE_ACCEPT, findEntry, usesAsset, snapToLayers, pickPattern, loadImages,
  importImageFile, openEditor, drawEntry, mineEntries,
} from '../pattern-actions.js';

const SLOT_SUB = { a: 'main swatch', b: 'blends in' };
const BLEND_LABELS = { even: 'even', fadesUp: 'fades up', fadesDown: 'fades down', middle: 'middle', diagonal: 'diagonal' };
const BLEND_WHERE = { fadesUp: 'At the top: ', fadesDown: 'At the bottom: ', middle: 'Halfway up: ', diagonal: 'In the band: ' };
const GRID_SWATCH = 52;
const SLOT_SWATCH = 34;

// "Prints at ≈ 39 × 100 beads per tile".
function resolutionText(slot, perimeterMm, layers) {
  let r = null;
  try { r = printableResolution(slot, perimeterMm, layers); } catch { r = null; }
  if (typeof r === 'string') return r;
  const g = beadGrid(slot, perimeterMm, layers);
  const across = Math.round(r?.around ?? r?.columns ?? r?.[0] ?? g.columns);
  const up = Math.round(r?.rows ?? r?.up ?? r?.[1] ?? g.rows);
  return `Prints at ≈ ${across} × ${up} beads per tile`;
}

// 'lib:out-in-out@1' → 'Out in out', for a summary without the library at hand.
function prettyId(id) {
  const s = String(id).replace(/^lib:/, '').replace(/@\d+$/, '').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const section = {
  id: 'detail',
  title: 'Detailed morph',

  summary(design, ctx) {
    const lib = ctx?.library;
    const name = (slot) => (lib && findEntry(lib, slot.pattern, design.assets)?.name) || prettyId(slot.pattern);
    const s = design.form.detail;
    if (!s.b) return s.a.pattern === PLAIN.id ? 'plain' : `${name(s.a)} · ${s.a.depthMm} mm`;
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
      if (!store.state.design.form.detail.b) return;
      store.apply('Swap A and B', (d) => {
        const t = d.form.detail.a;
        d.form.detail.a = d.form.detail.b;
        d.form.detail.b = t;
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

    const entryOf = (id, d = store.state.design) => findEntry(library, id, d.assets, saved);
    const pick = (id) => pickPattern(ctx, slotOf(), id, saved);
    // An image swatch draws once its pixels are in.
    const redraw = () => update(store.state);

    // My patterns: saved in this browser, plus your own assets in this design.
    let saved = [];
    const refreshSaved = () =>
      Promise.resolve(listPatterns())
        .then((list) => {
          saved = Array.isArray(list) ? list : [];
          update(store.state);
        })
        .catch((err) => console.warn('My patterns not loaded', err));
    const mineLabel = h('div', { class: 'grid-label', id: `mine-label-${Math.random().toString(36).slice(2, 8)}`, text: 'My patterns' });
    const mineGrid = h('div', { class: 'swatch-grid mine-grid', role: 'group', 'aria-labelledby': mineLabel.id });
    let mineTiles = [];
    let mineKey = null;
    const fileInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'visually-hidden image-file', tabIndex: -1, 'aria-hidden': 'true' });
    const imageBtn = h('button', { type: 'button', class: 'swatch swatch-action', title: 'Use an image as a swatch', 'aria-label': 'Add an image as a swatch' }, [
      h('span', { class: 'swatch-add', 'aria-hidden': 'true', text: '+' }),
      h('span', { class: 'swatch-name', text: 'Image' }),
    ]);
    const editBtn = h('button', { type: 'button', class: 'btn edit-pattern-btn', text: 'Edit swatch…' });
    const imageMsg = h('p', { class: 'panel-note image-msg', role: 'alert', hidden: true });
    const actions = h('div', { class: 'pattern-actions' }, [editBtn]);

    // Deleting one of My patterns, after a confirmation under the grid. The
    // design keeps its own copy when it uses the pattern, so the pot never
    // changes; an unused copy goes too, so the swatch leaves the grid.
    const confirmText = h('p', { class: 'mine-confirm-text', id: `mine-confirm-${Math.random().toString(36).slice(2, 8)}` });
    const confirmCancel = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
    const confirmDelete = h('button', { type: 'button', class: 'btn btn-danger', text: 'Delete' });
    const confirmBox = h('div', { class: 'mine-confirm', role: 'group', 'aria-labelledby': confirmText.id, hidden: true }, [
      confirmText,
      h('div', { class: 'mine-confirm-actions' }, [confirmCancel, confirmDelete]),
    ]);
    let pendingDelete = null;
    const closeConfirm = (refocus) => {
      const p = pendingDelete;
      pendingDelete = null;
      confirmBox.hidden = true;
      if (refocus && p?.from?.isConnected) p.from.focus();
    };
    const askDelete = (entry, from) => {
      showImageMsg('');
      pendingDelete = { id: entry.id, name: entry.name, from };
      const used = usesAsset(store.state.design, entry.id);
      confirmText.textContent = `Delete “${entry.name}” from My patterns?${used ? ' This design keeps its own copy, so the pot doesn’t change.' : ''}`;
      confirmBox.hidden = false;
      confirmCancel.focus();
    };
    confirmCancel.addEventListener('click', () => closeConfirm(true));
    confirmBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeConfirm(true);
      }
    });
    confirmDelete.addEventListener('click', async () => {
      const p = pendingDelete;
      if (!p) return;
      closeConfirm(false);
      try {
        await deletePattern(p.id);
      } catch (err) {
        console.warn('Pattern not deleted', err);
        showImageMsg('That pattern couldn’t be deleted. Try again.');
        return;
      }
      const d = store.state.design;
      const used = usesAsset(d, p.id);
      if (!used && d.assets?.[p.id]) store.apply(`Delete pattern ${p.name}`, (dd) => { delete dd.assets[p.id]; });
      await refreshSaved();
      showImageMsg(used ? `“${p.name}” is no longer in My patterns. This design keeps its own copy.` : '');
      imageBtn.focus();
    });

    const showImageMsg = (text) => {
      imageMsg.textContent = text;
      imageMsg.hidden = !text;
    };
    imageBtn.addEventListener('click', () => {
      showImageMsg('');
      loadImages().catch(() => {}); // warm up while the picker is open
      fileInput.value = '';
      fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const s = slotOf();
      imageBtn.disabled = true;
      imageBtn.setAttribute('aria-busy', 'true');
      showImageMsg('Reading the image…');
      try {
        await importImageFile(ctx, file, s);
        showImageMsg('');
      } catch (err) {
        // Plain Errors carry a message for the person; anything else is unexpected.
        const plain = err?.constructor === Error && err.message;
        if (!plain) console.warn('Image not used', err);
        showImageMsg(plain ? err.message : 'That image couldn’t be used. Try a PNG, JPEG or WebP file.');
      } finally {
        imageBtn.disabled = false;
        imageBtn.removeAttribute('aria-busy');
      }
    });
    editBtn.addEventListener('click', () => {
      showImageMsg('');
      openEditor(ctx, slotOf(), { findRecipe: (id) => entryOf(id), onSaved: refreshSaved })
        .catch((err) => {
          console.warn('Pattern editor not loaded', err);
          showImageMsg('The pattern editor didn’t load. Reload the page to try again.');
        });
    });

    const renderMine = (d, fp, layers, slot) => {
      const list = mineEntries(library, d, saved);
      const savedIds = new Set(saved.map((p) => p.id));
      const key = list.map((e) => `${e.id}|${e.name}|${savedIds.has(e.id) ? 1 : 0}`).join(';');
      if (key !== mineKey) {
        mineKey = key;
        mineTiles = list.map((e) => {
          const canvas = h('canvas', { class: 'swatch-canvas', width: 1, height: 1, 'aria-hidden': 'true' });
          const btn = h('button', { type: 'button', class: 'swatch', title: e.name }, [canvas, h('span', { class: 'swatch-name', text: e.name })]);
          btn.addEventListener('click', () => pick(e.id));
          // Saved in this browser: a corner button deletes it (after a confirmation).
          if (!savedIds.has(e.id)) return { id: e.id, el: btn, btn, canvas, drawn: '' };
          const del = h('button', { type: 'button', class: 'swatch-del', title: 'Delete from My patterns', 'aria-label': `Delete ${e.name} from My patterns` }, [
            h('span', { class: 'swatch-del-dot', 'aria-hidden': 'true', text: '×' }),
          ]);
          del.addEventListener('click', () => askDelete(e, del));
          return { id: e.id, el: h('div', { class: 'swatch-item' }, [btn, del]), btn, canvas, drawn: '' };
        });
        mineGrid.replaceChildren(...mineTiles.map((t) => t.el), imageBtn);
        if (pendingDelete && !savedIds.has(pendingDelete.id)) closeConfirm(false);
      }
      for (const t of mineTiles) {
        const e = list.find((x) => x.id === t.id);
        const on = !!slot && slot.pattern === t.id;
        t.btn.setAttribute('aria-pressed', String(on));
        drawEntry(t, e, on ? slot : null, d, GRID_SWATCH, redraw);
      }
    };

    // Per-slot settings. Each reads the selected slot when it fires.
    const editSlot = (label, fn) => (v) => store.change(`${label} ${S()}`, (d) => {
      const slot = d.form.detail[slotOf()];
      if (slot) fn(slot, v, d);
    });
    const depthLim = limit(['depthMm', 'surface.depthMm', 'patternDepth'], { min: 0, max: 8, step: 0.1 });
    const depth = slider({
      label: 'Depth', unit: 'mm', ...depthLim, snap: 0.5, decimals: 1, value: 0,
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
          const slot = d.form.detail[slotOf()];
          if (slot) slot.tileHeightMm = snapToLayers(v, lh);
        });
        store.commit();
      },
    });
    const emptyNote = h('p', { class: 'panel-note', text: 'B is off. Pick a swatch above to blend it in.' });
    const plainNote = h('p', { class: 'panel-note', text: 'Plain leaves the surface smooth.' });
    const resNote = h('p', { class: 'panel-note res-note', hidden: true });
    const slotBox = h('div', { class: 'slot-settings' }, [depth.el, repeats.el, tileHeight.el, resNote]);

    // Shared range and blend.
    const rangeLim = limit(['fromMm', 'surface.fromMm'], { min: 0, max: 600, step: 1 });
    const from = numberField({
      label: 'From', unit: 'mm', compact: true, ...rangeLim, decimals: 1, value: 0,
      onInput: (v) => store.change('From', (d) => { d.form.detail.fromMm = Math.min(v, d.form.detail.toMm - 1); }),
      onCommit: commit,
    });
    const to = numberField({
      label: 'To', unit: 'mm', compact: true, ...rangeLim, decimals: 1, value: 0,
      onInput: (v) => store.change('To', (d) => { d.form.detail.toMm = Math.max(v, d.form.detail.fromMm + 1); }),
      onCommit: commit,
    });
    const rangeRow = h('div', { class: 'nf range-row' }, [
      h('span', { class: 'nf-label', text: 'From / to' }),
      h('div', { class: 'range-fields' }, [from.el, h('span', { class: 'range-dash', 'aria-hidden': 'true', text: '–' }), to.el]),
    ]);
    const blend = segmented({
      label: 'Blend',
      options: BLEND_OPTIONS,
      value: 'fadesUp',
      onChange: (v) => store.apply('Blend', (d) => {
        if (!d.form.detail.blend) d.form.detail.blend = { shape: v, amount: 1 };
        d.form.detail.blend.shape = v;
        // Even at full amount is all B; start at half so the first click shows a mix.
        if (v === 'even' && d.form.detail.blend.amount === 1) d.form.detail.blend.amount = 0.5;
      }),
    });
    const amount = slider({
      label: 'Amount', unit: '×', min: 0, max: 1, step: 0.01, snap: 0.05, decimals: 2, value: 1, info: '',
      onInput: (v) => store.change('Amount', (d) => { d.form.detail.blend.amount = v; }),
      onCommit: commit,
    });
    const blendBox = h('div', { class: 'blend-settings' }, [blend.el, amount.el]);

    // The library and My patterns share one strip: on desktop it stacks as two
    // grids, on a phone it is one row that scrolls sideways (C35).
    const strip = h('div', { class: 'swatch-strip' }, [grid, mineLabel, mineGrid]);

    el.append(slots, gridLabel, strip, confirmBox, fileInput, imageMsg, actions, emptyNote, plainNote, slotBox, rangeRow, blendBox);

    const update = (state) => {
      const d = state.design;
      const surf = d.form.detail;
      const s = state.view.slot === 'b' ? 'b' : 'a';
      const slot = surf[s];
      const fp = footprintAt(d);
      const layers = d.layers;

      for (const k of ['a', 'b']) {
        const card = slotCards[k];
        const sl = surf[k];
        const entry = sl && findEntry(library, sl.pattern, d.assets, saved);
        card.name.textContent = sl ? entry?.name ?? sl.pattern : 'None';
        card.btn.setAttribute('aria-pressed', String(k === s));
        card.btn.setAttribute('aria-label', `Slot ${k.toUpperCase()}, ${SLOT_SUB[k]}: ${sl ? entry?.name ?? sl.pattern : 'none'}`);
        card.canvas.hidden = !sl;
        card.btn.classList.toggle('is-none', !sl);
        if (sl && entry) drawEntry(card, { ...entry, id: sl.pattern }, sl, d, SLOT_SWATCH, redraw);
      }
      swap.disabled = !surf.b;

      gridLabel.textContent = `Swatch for ${s.toUpperCase()}`;
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

      renderMine(d, fp, layers, slot);
      editBtn.setAttribute('aria-label', `Edit swatch ${s.toUpperCase()}`);

      const isPlain = slot && slot.pattern === PLAIN.id;
      const isImage = !!slot && d.assets?.[slot.pattern]?.kind === 'image';
      resNote.hidden = !isImage;
      if (isImage) resNote.textContent = resolutionText(slot, fp.perimeterMm, layers);
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
        // Show the height that prints: the core snaps it to whole layers (C7).
        tileHeight.set(snapTileHeight(slot.tileHeightMm, layers.layerHeightMm));
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
        amount.setInfo(`${BLEND_WHERE[surf.blend.shape] ?? ''}A ${100 - b} % · B ${b} %`);
      }
    };
    update(store.state);
    refreshSaved();
    const offPatterns = onPatternsChanged(refreshSaved);

    return {
      update,
      destroy() {
        offPatterns?.();
        el.replaceChildren();
      },
    };
  },
};

export default section;
export const { id, title, summary, mount } = section;
