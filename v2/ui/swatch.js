// Pattern swatches: a drawing shown as it prints, crisp, one cell per point
// around by one layer up (design §9.2), in the same whites and greys as the
// bead preview (D21).

const cache = new Map();
const CACHE_LIMIT = 200;

// The Pattern's three tones (D46): out white, flat a light grey, in a darker
// grey, the bead preview's whites and greys; the gaps between rows are the
// layers.
const TONE = { 1: 252, 0: 212, '-1': 158 };
const LAYER_GAP = 128;

/**
 * Draws a Pattern drawing (a bitmap recipe) crisp, as it prints: one cell per
 * node spacing around by one layer up, at their true proportions, repeated
 * over a square of wall `windowMm` wide, row 0 of the tile at the bottom.
 * Cached by what it draws.
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
