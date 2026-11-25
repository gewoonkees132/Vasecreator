// Pattern swatches: a recipe drawn as the grid the printer will actually lay
// down, one square per bead step around and one layer up (design §9.2), in the
// same whites and greys as the bead preview (D21). Two tiles by two, so the
// seam between repeats shows (or rather, doesn't).

import { sampleTile } from '../core/patterns.js';

const cache = new Map();
const CACHE_LIMIT = 200;
let anon = 0;

// Grey levels for the pattern value: −1 (pulled in) is a mid grey, +1 (pushed
// out) white. A little light from the top left on each step makes it read as
// relief rather than a flat map.
const GREY_IN = 150;
const GREY_OUT = 252;
const LIGHT = 26;

function key(recipe, o) {
  return `${o.id ?? (o.raster ? `raster:${++anon}` : JSON.stringify(recipe))}|${o.size}|${o.columns}|${o.rows}|${o.tiles}|${o.dpr}`;
}

/**
 * Samples a greyscale raster on the bead grid of one tile: each square is the
 * mean of the pixels under it, black = −1 (in), white = +1 (out).
 * @param {{ width: number, height: number, data: Uint8Array }} raster row 0 = top of the image
 * @param {number} columns
 * @param {number} rows
 * @returns {Float64Array} row-major, row 0 at the bottom of the tile (like sampleTile)
 */
export function sampleRaster(raster, columns, rows) {
  const { width: w, height: hgt, data } = raster;
  const out = new Float64Array(columns * rows);
  for (let r = 0; r < rows; r++) {
    // Tile row 0 is the bottom; image row 0 is the top.
    const y0 = Math.floor(((rows - 1 - r) * hgt) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((rows - r) * hgt) / rows));
    for (let c = 0; c < columns; c++) {
      const x0 = Math.floor((c * w) / columns);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / columns));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += data[y * w + x];
      out[r * columns + c] = sum / ((y1 - y0) * (x1 - x0)) / 127.5 - 1;
    }
  }
  return out;
}

function render(recipe, o) {
  const px = Math.max(1, Math.round(o.size * o.dpr));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  const { columns, rows, tiles } = o;
  const tile = o.raster ? sampleRaster(o.raster, columns, rows) : sampleTile(recipe, columns, rows);
  const nx = columns * tiles;
  const ny = rows * tiles;
  const at = (c, r) => tile[(((r % rows) + rows) % rows) * columns + (((c % columns) + columns) % columns)];
  const cw = px / nx;
  const ch = px / ny;
  // Gaps between squares only where squares are big enough to keep them readable.
  const gap = Math.min(cw, ch) >= 5 * o.dpr ? Math.max(1, Math.round(o.dpr * 0.75)) : 0;

  ctx.fillStyle = `rgb(${GREY_IN - 20},${GREY_IN - 20},${GREY_IN - 20})`;
  ctx.fillRect(0, 0, px, px);
  for (let r = 0; r < ny; r++) {
    // Canvas y runs down; tile row 0 is the bottom of the tile.
    const y0 = Math.round(px - (r + 1) * ch);
    const y1 = Math.round(px - r * ch);
    for (let c = 0; c < nx; c++) {
      const v = at(c, r);
      const slope = (v - at(c - 1, r)) * 0.5 + (at(c, r + 1) - v) * -0.5;
      let g = GREY_IN + ((v + 1) / 2) * (GREY_OUT - GREY_IN) + slope * LIGHT;
      g = Math.max(110, Math.min(255, Math.round(g)));
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      const x0 = Math.round(c * cw);
      const x1 = Math.round((c + 1) * cw);
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0 - gap), Math.max(1, y1 - y0 - gap));
    }
  }
  return canvas;
}

/**
 * Draws a pattern swatch into a canvas, sized for its CSS box and the screen's
 * pixel ratio. Rendered swatches are cached by pattern id (or recipe), size and
 * grid, so re-drawing the library grid is cheap.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} recipe pattern recipe (core/patterns.js)
 * @param {object} [opts]
 * @param {string} [opts.id] cache key for the recipe, e.g. 'lib:flutes@1'
 * @param {number} [opts.size=56] CSS px (square)
 * @param {number} [opts.columns=12] squares around per tile (one per bead step)
 * @param {number} [opts.rows=12] squares up per tile (one per layer)
 * @param {number} [opts.tiles=2] tiles across and up
 */
export function drawSwatch(canvas, recipe, opts = {}) {
  paint(canvas, recipe, opts);
}

/**
 * Draws an image pattern the same way: the raster averaged onto the bead grid,
 * in the same greys as a recipe swatch.
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number, data: Uint8Array }} raster
 * @param {object} [opts] as drawSwatch; pass `id` ('img:<hash>') so the cache can tell images apart
 */
export function drawRasterSwatch(canvas, raster, opts = {}) {
  paint(canvas, null, { ...opts, raster });
}

function paint(canvas, recipe, opts) {
  const o = {
    raster: opts.raster,
    id: opts.id,
    size: opts.size ?? 56,
    columns: Math.max(1, Math.min(64, Math.round(opts.columns ?? 12))),
    rows: Math.max(1, Math.min(64, Math.round(opts.rows ?? 12))),
    tiles: opts.tiles ?? 2,
    dpr: Math.min(3, globalThis.devicePixelRatio || 1),
  };
  const k = key(recipe, o);
  let img = cache.get(k);
  if (!img) {
    img = render(recipe, o);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(k, img);
  }
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.width = `${o.size}px`;
  canvas.style.height = `${o.size}px`;
  canvas.getContext('2d').drawImage(img, 0, 0);
}

// The Pattern's three tones (D46): out white, flat a light grey, in a darker
// grey, the bead preview's whites and greys; the gaps between rows are the
// layers.
const TONE = { 1: 252, 0: 212, '-1': 158 };
const LAYER_GAP = 128;

/**
 * Draws a Pattern drawing (a bitmap recipe) crisp, as it prints: one cell per
 * node spacing around by one layer up, at their true proportions, repeated
 * over a square of wall `windowMm` wide, row 0 of the tile at the bottom.
 * Cached like drawSwatch.
 * @param {HTMLCanvasElement} canvas
 * @param {{ columns: number, rows: number, cells: string }} recipe
 * @param {{ id?: string, size?: number, cellWidthMm: number, cellHeightMm: number, windowMm: number }} opts
 */
export function drawBitmapSwatch(canvas, recipe, opts) {
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const size = opts.size ?? 56;
  const across = opts.windowMm / Math.max(opts.cellWidthMm, 1e-6);
  const up = opts.windowMm / Math.max(opts.cellHeightMm, 1e-6);
  const k = `bitmap|${opts.id ?? `${recipe.columns}x${recipe.rows}:${recipe.cells}`}|${size}|${across.toFixed(3)}|${up.toFixed(3)}|${dpr}`;
  let img = cache.get(k);
  if (!img) {
    const px = Math.max(1, Math.round(size * dpr));
    img = document.createElement('canvas');
    img.width = px;
    img.height = px;
    const g = img.getContext('2d');
    const cw = px / across;
    const ch = px / up;
    const gap = ch >= 4 ? Math.max(1, Math.round(dpr * 0.5)) : 0;
    g.fillStyle = `rgb(${LAYER_GAP},${LAYER_GAP},${LAYER_GAP})`;
    g.fillRect(0, 0, px, px);
    const { columns, rows, cells } = recipe;
    for (let r = 0; r < Math.ceil(up); r++) {
      // Canvas y runs down; row 0 is the bottom of the wall.
      const y1 = Math.round(px - r * ch);
      const y0 = Math.round(px - (r + 1) * ch);
      const row = r % rows;
      for (let c = 0; c < Math.ceil(across); c++) {
        const ch0 = cells[row * columns + (c % columns)];
        const t = TONE[ch0 === '+' ? 1 : ch0 === '-' ? '-1' : 0];
        g.fillStyle = `rgb(${t},${t},${t})`;
        const x0 = Math.round(c * cw);
        const x1 = Math.round((c + 1) * cw);
        g.fillRect(x0, Math.max(0, y0), Math.max(1, x1 - x0), Math.max(1, y1 - Math.max(0, y0) - gap));
      }
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(k, img);
  }
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.getContext('2d').drawImage(img, 0, 0);
}

/**
 * Bead-scale grid for one tile of a slot: squares around = repeat width ÷ bead
 * width, squares up = tile height ÷ layer height.
 * @param {{ repeats: number, tileHeightMm: number }} slot
 * @param {number} perimeterMm perimeter at the widest point
 * @param {{ beadWidthMm: number, layerHeightMm: number }} layers
 */
export function beadGrid(slot, perimeterMm, layers) {
  return {
    columns: perimeterMm / Math.max(1, slot.repeats) / layers.beadWidthMm,
    rows: slot.tileHeightMm / layers.layerHeightMm,
  };
}
