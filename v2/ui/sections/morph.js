// Geometry morph (design §9.6, D23), the Morph part of Shape: a soft greyscale map that
// pushes the whole form in and out before patterns go on top. None, the
// built-in maps (core/morph.js MORPH_MAPS) or your own image, then Softness,
// Strength, Repeats around and Blend. Facets (D69) have their own settings:
// Facets around, Rows, Stagger, Irregularity with Shuffle, Round rim, Edges
// and Blend; their depth follows from the number of faces, so no Strength.

import { h, slider, numberField, toggle } from '../controls.js';
import { limit } from './shape.js';
import { MORPH_MAPS, MORPH_DEFAULTS as CORE_DEFAULTS, evaluateMorphMap, FACETS_MAP, FACETS_DEFAULTS, FACETS_START, FACETS_MIN_AROUND } from '../../core/morph.js';
import * as imageSwatch from '../image-swatch.js';
import { rasterFromRGBA } from '../../core/raster.js';
import { saveImage, loadImage, cachedImage } from '../../store/assets.js';
import { labelIcon } from '../press-label.js';
import { ICONS } from '../icons.js';

// Picking a map from None starts from the core's defaults (design §13), but
// with a 6 mm push instead of 16: at 16 mm most maps tip the presets past 45°
// or into the fine-pattern warning; at 6 mm only the steep-necked Classic vase
// (Lean, Swirl, Blobs) and the Square planter (Blobs) still lean past 45°.
const { map: _defaultMap, ...CORE_REST } = CORE_DEFAULTS;
const MORPH_DEFAULTS = { ...CORE_REST, strengthMm: 6 };

const SWATCH_PX = 52;

// The Pattern image upload (ui/image-swatch.js) when it offers one; else the
// same steps here: decode, greyscale, store, hand to the engine.
async function importMorphImage(ctx, file) {
  if (typeof imageSwatch.importImage === 'function') return imageSwatch.importImage(ctx, file);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(`${file.name} isn't a PNG, JPEG or WebP image.`);
  const bitmap = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const g = c.getContext('2d');
  g.drawImage(bitmap, 0, 0);
  const raster = rasterFromRGBA(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  const name = String(file.name || 'Image').replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Image';
  const hash = await saveImage(raster, name);
  await ctx.engine.setImage?.(hash, raster);
  return { id: `img:${hash}`, asset: { kind: 'image', name, hash, width: raster.width, height: raster.height }, raster };
}

const fileProblem = (file) => (typeof imageSwatch.fileProblem === 'function' ? imageSwatch.fileProblem(file) : '');
const rasterNow = (hash) => (typeof imageSwatch.cachedRaster === 'function' && imageSwatch.cachedRaster(hash)) || cachedImage(hash);

const greyOf = (value) => Math.round(Math.max(0, Math.min(1, (value + 1) / 2)) * 255);

/** One repeat of the map, from the core's own evaluator (x across, v up: the rim at the top). */
function drawMap(canvas, id) {
  const px = Math.round(SWATCH_PX * Math.min(2, globalThis.devicePixelRatio || 1));
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext('2d');
  if (!g) return;
  const img = g.createImageData(px, px);
  for (let y = 0; y < px; y += 1) {
    const v = 1 - (y + 0.5) / px;
    for (let x = 0; x < px; x += 1) {
      let value = 0;
      try { value = evaluateMorphMap(id, (x + 0.5) / px, v); } catch { value = 0; }
      const c = greyOf(Number.isFinite(value) ? value : 0);
      const i = (y * px + x) * 4;
      img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** An image map: its pixels scaled into the square. */
function drawRaster(canvas, raster) {
  const px = Math.round(SWATCH_PX * Math.min(2, globalThis.devicePixelRatio || 1));
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext('2d');
  if (!g || !raster) return;
  const img = g.createImageData(px, px);
  for (let y = 0; y < px; y += 1) {
    const sy = Math.min(raster.height - 1, Math.floor(((y + 0.5) / px) * raster.height));
    for (let x = 0; x < px; x += 1) {
      const sx = Math.min(raster.width - 1, Math.floor(((x + 0.5) / px) * raster.width));
      const c = raster.data[sy * raster.width + sx];
      const i = (y * px + x) * 4;
      img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function mapName(design, id) {
  if (!id) return 'none';
  const builtIn = MORPH_MAPS.find((m) => m.id === id);
  if (builtIn) return builtIn.name;
  return design.assets?.[id]?.name || 'Image';
}

// A control's visible label (the first label-ish element in it).
function setLabel(root, text) {
  const label = root.querySelector('.nf-label, .sl-label, label');
  if (label && label.textContent !== text) label.textContent = text;
}

const fmtMm = (v) => `${Math.round((Number(v) || 0) * 10) / 10} mm`;

const section = {
  id: 'morph',
  title: 'Geometry morph',

  summary(design) {
    const m = design.form?.morph;
    if (m?.map === FACETS_MAP) return `Facets · ${m.repeats} around, ${m.facets?.rows ?? FACETS_DEFAULTS.rows} rows`;
    return m?.map ? `${mapName(design, m.map)} · ${fmtMm(m.strengthMm)}` : 'none';
  },

  mount(el, ctx) {
    const { store } = ctx;
    const morphOf = (d) => (d.form?.morph?.map ? d.form.morph : null);

    // ---- Map swatches: None, the built-in maps, the image in use, + Image ----
    const grid = h('div', { class: 'swatch-grid', role: 'group', 'aria-label': 'Morph map' });
    const note = h('p', { class: 'field-info', role: 'status' });
    const tiles = [];
    const addTile = (id, name, draw) => {
      const canvas = id ? h('canvas', { class: 'swatch-canvas', width: 1, height: 1, 'aria-hidden': 'true' }) : h('span', { class: 'swatch-none', 'aria-hidden': 'true' });
      const btn = h('button', { type: 'button', class: 'swatch', title: name, 'aria-pressed': 'false' }, [canvas, h('span', { class: 'swatch-name', text: name })]);
      btn.addEventListener('click', () => pick(id, name));
      grid.append(btn);
      const tile = { id, btn, canvas };
      tiles.push(tile);
      if (draw) draw(canvas);
      return tile;
    };
    addTile(null, 'None');
    for (const m of MORPH_MAPS) addTile(m.id, m.name, (c) => drawMap(c, m.id));
    // The design's own image map, shown while it is in use.
    const imageTile = addTile('img:', 'Image');
    imageTile.btn.hidden = true;
    let imageDrawn = '';
    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    // + Image: the image icon where a map would be.
    const addMark = h('span', { class: 'swatch-add', 'aria-hidden': 'true' });
    addMark.innerHTML = ICONS.image;
    const addBtn = labelIcon(h('button', { type: 'button', class: 'swatch swatch-action' }, [
      addMark, h('span', { class: 'swatch-name', text: 'Image' }),
    ]), 'Use your own image as the morph map');
    grid.append(addBtn, fileInput);

    const pick = (id, name) => {
      if (id === 'img:') return;   // the image tile is already the map in use
      store.apply(`Morph: ${id ? name : 'none'}`, (d) => {
        if (!id) { d.form.morph = null; return; }
        const was = morphOf(d);
        if (id === FACETS_MAP) {
          // Facets start from their own layout (D69), not the last map's numbers.
          if (was?.map !== FACETS_MAP) d.form.morph = { ...MORPH_DEFAULTS, ...FACETS_START, map: id, facets: { ...FACETS_DEFAULTS } };
          return;
        }
        const { facets: _f, ...rest } = was || {};
        d.form.morph = { ...MORPH_DEFAULTS, ...(was?.map === FACETS_MAP ? {} : rest), map: id };
      });
    };

    addBtn.addEventListener('click', () => { note.textContent = ''; fileInput.click(); });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      const problem = fileProblem(file);
      if (problem) { note.textContent = problem; return; }
      addBtn.disabled = true;
      note.textContent = 'Reading the image…';
      try {
        const { id, asset } = await importMorphImage(ctx, file);
        store.apply(`Morph: ${asset.name}`, (d) => {
          d.assets = { ...(d.assets || {}), [id]: asset };
          d.form.morph = { ...MORPH_DEFAULTS, ...(morphOf(d) || {}), map: id };
        });
        note.textContent = '';
      } catch (err) {
        note.textContent = err?.message || "That image couldn't be read.";
      } finally {
        addBtn.disabled = false;
      }
    });

    // ---- Settings ----
    const settings = h('div', { class: 'slot-settings' });
    const field = (key, label, make, opts) => make({
      label,
      ...opts,
      onInput: (v) => store.change(label, (d) => { if (morphOf(d)) d.form.morph[key] = v; }),
      onCommit: () => store.commit(),
    });
    const softness = field('softnessMm', 'Softness', slider, { unit: 'mm', ...limit(['softnessMm', 'morphSoftnessMm'], { min: 0, max: 60, step: 0.5 }), decimals: 1, value: MORPH_DEFAULTS.softnessMm, info: 'How soft the map is: a blur in mm' });
    const strength = field('strengthMm', 'Strength', slider, { unit: 'mm', ...limit(['strengthMm', 'morphStrengthMm'], { min: 0, max: 40, step: 0.5 }), decimals: 1, value: MORPH_DEFAULTS.strengthMm, info: 'The largest push, in or out' });
    const repeats = field('repeats', 'Repeats around', numberField, { unit: '×', ...limit(['morphRepeats'], { min: 1, max: 24, step: 1 }), step: 1, decimals: 0, value: MORPH_DEFAULTS.repeats, info: 'Whole repeats, so it meets itself' });
    const blend = field('blend', 'Blend', slider, { ...limit(['morphBlend'], { min: 0, max: 1, step: 0.05 }), decimals: 2, value: MORPH_DEFAULTS.blend, info: 'How much of the morph to use' });
    // Facets (D69): the layout's own settings.
    const facetEdit = (label, fn) => (v) => store.change(label, (d) => { if (d.form.morph?.facets) fn(d.form.morph.facets, v); });
    const rows = numberField({
      label: 'Rows', unit: '', ...limit(['facetRows'], { min: 1, max: 8, step: 1 }), step: 1, decimals: 0, value: FACETS_DEFAULTS.rows,
      info: 'Rows of facets, bottom to rim',
      onInput: facetEdit('Facet rows', (f, v) => { f.rows = Math.round(v); }), onCommit: () => store.commit(),
    });
    const stagger = toggle({
      label: 'Stagger rows', value: FACETS_DEFAULTS.stagger,
      onChange: (v) => store.apply(v ? 'Facets staggered' : 'Facets in line', (d) => { if (d.form.morph?.facets) d.form.morph.facets.stagger = v; }),
    });
    const irregularity = slider({
      label: 'Irregularity', unit: '%', min: 0, max: 100, step: 1, snap: 10, decimals: 0, value: 50,
      info: 'How far each facet moves from a neat grid',
      onInput: facetEdit('Facet irregularity', (f, v) => { f.irregularity = Math.min(1, Math.max(0, v / 100)); }), onCommit: () => store.commit(),
    });
    const shuffle = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Shuffle' });
    shuffle.addEventListener('click', () => store.apply('Facets shuffled', (d) => {
      const f = d.form.morph?.facets;
      if (f) f.seed = (f.seed + 1) % 1000;
    }));
    const shuffleRow = h('div', { class: 'nf' }, [h('span', { class: 'nf-label', text: 'Layout' }), shuffle]);
    const rim = slider({
      label: 'Round rim', unit: 'mm', ...limit(['facetRimMm'], { min: 0, max: 100, step: 0.5 }), snap: 5, decimals: 1, value: FACETS_DEFAULTS.rimMm,
      info: 'A band below the rim that fades back to round',
      onInput: facetEdit('Round rim', (f, v) => { f.rimMm = v; }), onCommit: () => store.commit(),
    });
    const facetBox = h('div', { class: 'slot-settings' }, [rows.el, stagger.el, irregularity.el, shuffleRow, rim.el]);
    settings.append(softness.el, strength.el, repeats.el, facetBox, blend.el);

    el.append(grid, note, settings);

    const update = (state) => {
      const d = state.design;
      const m = morphOf(d);
      const current = m?.map ?? null;
      const isImage = typeof current === 'string' && current.startsWith('img:');
      for (const t of tiles) {
        const on = t === imageTile ? isImage : t.id === current;
        t.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      imageTile.btn.hidden = !isImage;
      if (isImage) {
        const asset = d.assets?.[current];
        const hash = asset?.hash || current.slice(4);
        imageTile.btn.title = asset?.name || 'Image';
        imageTile.btn.querySelector('.swatch-name').textContent = asset?.name || 'Image';
        if (imageDrawn !== hash) {
          imageDrawn = hash;
          const r = rasterNow(hash);
          if (r) drawRaster(imageTile.canvas, r);
          else loadImage(hash).then((raster) => { if (raster && imageDrawn === hash) drawRaster(imageTile.canvas, raster); });
        }
      }
      settings.hidden = !m;
      if (m) {
        const facets = m.map === FACETS_MAP;
        softness.set(m.softnessMm ?? MORPH_DEFAULTS.softnessMm);
        strength.set(m.strengthMm ?? MORPH_DEFAULTS.strengthMm);
        repeats.set(m.repeats ?? MORPH_DEFAULTS.repeats);
        blend.set(m.blend ?? MORPH_DEFAULTS.blend);
        strength.el.hidden = facets;
        facetBox.hidden = !facets;
        setLabel(softness.el, facets ? 'Edges' : 'Softness');
        softness.setInfo(facets ? 'Rounds the edges between facets, in mm' : 'How soft the map is: a blur in mm');
        setLabel(repeats.el, facets ? 'Facets around' : 'Repeats around');
        repeats.setLimits?.({ min: facets ? FACETS_MIN_AROUND : 1 });
        repeats.setInfo?.(facets ? 'Facets in each row; fewer cut deeper' : 'Whole repeats, so it meets itself');
        blend.setInfo(facets ? '1 is flat facets; less is between round and faceted' : 'How much of the morph to use');
        if (facets) {
          const f = { ...FACETS_DEFAULTS, ...(m.facets || {}) };
          rows.set(f.rows);
          stagger.set(f.stagger);
          irregularity.set(Math.round(f.irregularity * 100));
          rim.set(f.rimMm);
        }
      }
    };
    update(store.state);

    return {
      update,
      destroy() {
        for (const c of [softness, strength, repeats, blend, rows, stagger, irregularity, rim]) c.destroy?.();
        el.replaceChildren();
      },
    };
  },
};

export default section;
export const { id, title, summary, mount } = section;
