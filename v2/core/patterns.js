// The Pattern's drawing: a bitmap recipe (D45, D48).
//
//   { "kind": "bitmap", "columns": 6, "rows": 2, "cells": "++--++-++++-" }
//
// A bitmap is a grid of in / flat / out cells. `cells` holds one character
// per cell: '+' out, '0' flat, '-' in. It is row-major with row 0 at the
// bottom of the tile, so the first row printed is the first row written. The
// Pattern (core/layer-pattern.js) reads the cells crisp, node for node.
//
// The analytic shapes, the soft grids and the images of the Detailed morph
// went with it (D63).

/** The most cells a bitmap has across or up (D48). */
export const MAX_BITMAP_CELLS = 64;
const CELL_VALUES = { '+': 1, 0: 0, '-': -1 };
/** Quick fills that lay one row of cells out over a whole tile (D45). */
export const FILL_LAYOUTS = ['stripes', 'diagonal', 'brick', 'checker'];

const parsed = new WeakMap();

/**
 * A bitmap's cells as numbers (+1, 0 or −1), row-major from the bottom row.
 * Cached per recipe object, so evaluating a tile never parses it again.
 * @param {{ columns: number, rows: number, cells: string }} recipe
 * @returns {Int8Array}
 */
export function bitmapValues(recipe) {
  let values = parsed.get(recipe);
  if (!values) {
    values = new Int8Array(recipe.columns * recipe.rows);
    for (let i = 0; i < values.length; i++) values[i] = CELL_VALUES[recipe.cells[i]] ?? 0;
    parsed.set(recipe, values);
  }
  return values;
}

/**
 * A bitmap recipe from numbers: over ½ is out, under −½ in, the rest flat.
 * @param {number} columns
 * @param {number} rows
 * @param {ArrayLike<number>} values row-major, bottom row first
 * @returns {{ kind: 'bitmap', columns: number, rows: number, cells: string }}
 */
export function makeBitmap(columns, rows, values) {
  let cells = '';
  for (let i = 0; i < columns * rows; i++) cells += values[i] > 0.5 ? '+' : values[i] < -0.5 ? '-' : '0';
  return { kind: 'bitmap', columns, rows, cells };
}

/**
 * One row of cells laid out over a whole tile, the quick fills (D45):
 * stripes (the row alone), diagonal (each row one cell further round), brick
 * (every other row half a row round; an odd row doubles its cells so the
 * half is whole) or checker (every other row inverted).
 * @param {number[]} row values from −1 to 1
 * @param {'stripes' | 'diagonal' | 'brick' | 'checker'} layout
 */
export function fillBitmap(row, layout) {
  const n = row.length;
  if (layout === 'diagonal') {
    const values = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) values.push(row[(c + r) % n]);
    return makeBitmap(n, n, values);
  }
  if (layout === 'brick') {
    const wide = n % 2 ? row.flatMap((v) => [v, v]) : row;
    const m = wide.length;
    return makeBitmap(m, 2, [...wide, ...wide.map((_, c) => wide[(c + m / 2) % m])]);
  }
  if (layout === 'checker') return makeBitmap(n, 2, [...row, ...row.map((v) => -v)]);
  return makeBitmap(n, 1, row);
}

/**
 * Throws if a recipe isn't a bitmap that can be drawn.
 * @param {object} recipe
 */
export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') throw new TypeError('Pattern recipe must be an object');
  if (recipe.kind !== 'bitmap') throw new RangeError(`Unknown pattern kind: ${recipe.kind}`);
  const { columns, rows, cells } = recipe;
  const size = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_BITMAP_CELLS;
  if (!size(columns) || !size(rows)) throw new RangeError(`A bitmap has 1 to ${MAX_BITMAP_CELLS} cells a side`);
  if (typeof cells !== 'string' || cells.length !== columns * rows || /[^+0-]/.test(cells)) {
    throw new RangeError('Bitmap cells must be one of + 0 - per cell');
  }
}
