// The 2D editor's operations on one bitmap tile (D45, D46). Pure: every
// operation takes a grid and returns a new one (or the same object when
// nothing changed), so the editor's own undo is a list of grids.
//
// A grid is { columns, rows, cells: Int8Array }: +1 out, 0 flat, −1 in,
// row-major with row 0 at the bottom, like the `bitmap` recipe it comes
// from (core/patterns.js). The tile repeats both ways, so every coordinate
// wraps: a cell picked in one of the dimmed repeats around the tile is the
// tile's own cell, and a diagonal runs on through the repeats (it visits
// lcm(columns, rows) cells of the tile before it closes).

import { MAX_BITMAP_CELLS, bitmapValues, fillBitmap, makeBitmap } from './patterns.js';
import { hashText } from './raster.js';

/**
 * The id a drawing of your own goes by in design.assets (D48, §9): 'user:'
 * and a hash of what it draws (its size, edges and cells). The same drawing
 * has the same id in every design and in My patterns, and an edit gives a
 * new id, so an id never stands for two drawings.
 * @param {{ columns: number, rows: number, cells: string, edges?: string }} recipe a bitmap
 * @returns {string} 'user:' + 16 hex characters
 */
export function drawingId(recipe) {
  return `user:${hashText(`bitmap:${recipe.columns}x${recipe.rows}:${recipe.edges ?? ''}:${recipe.cells}`)}`;
}

/** The three states a cell can be in: out, flat, in (D38). */
export const CELL_STATES = [1, 0, -1];
export const SELECTION_KINDS = ['cell', 'row', 'column', 'diagonal', 'rect'];

const mod = (a, n) => ((a % n) + n) % n;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** A grid of flat cells. */
export function emptyGrid(columns, rows) {
  return { columns, rows, cells: new Int8Array(columns * rows) };
}

/** A grid from a bitmap recipe (a copy: editing never touches the recipe). */
export function gridOf(recipe) {
  return { columns: recipe.columns, rows: recipe.rows, cells: Int8Array.from(bitmapValues(recipe)) };
}

/** The bitmap recipe a grid stands for, with optional edges (a Detailed morph grid, D53). */
export function recipeOf(grid, edges) {
  return makeBitmap(grid.columns, grid.rows, grid.cells, edges);
}

export function sameGrid(a, b) {
  if (a === b) return true;
  if (!a || !b || a.columns !== b.columns || a.rows !== b.rows) return false;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
  return true;
}

/** The tile cell (column, row) of any cell of the repeated view, wrapped into the tile. */
export function wrapCell(grid, c, r) {
  return { c: mod(c, grid.columns), r: mod(r, grid.rows) };
}

/** Index into grid.cells of any cell of the repeated view. */
export function cellIndex(grid, c, r) {
  return mod(r, grid.rows) * grid.columns + mod(c, grid.columns);
}

export function cellValue(grid, c, r) {
  return grid.cells[cellIndex(grid, c, r)];
}

/** How many tile cells a diagonal visits before it closes: lcm(columns, rows). */
export function diagonalLength(columns, rows) {
  return (columns / gcd(columns, rows)) * rows;
}

/**
 * The tile cells a selection covers, as a mask over grid.cells (1 = in it).
 * Selections:
 *   { kind: 'cell', c, r }
 *   { kind: 'row', r }             one whole row (one layer of a Pattern)
 *   { kind: 'column', c }          one whole column (one point around)
 *   { kind: 'diagonal', c, r, dir }  through (c, r); dir +1 runs up and right (↗), −1 down and right (↘)
 *   { kind: 'rect', c0, r0, c1, r1 } corners in view cells, inclusive; it may reach into the repeats
 * Every coordinate wraps into the tile.
 * @returns {Uint8Array}
 */
export function selectionMask(grid, sel) {
  const { columns: C, rows: R } = grid;
  const mask = new Uint8Array(C * R);
  if (!sel) return mask;
  if (sel.kind === 'cell') {
    mask[cellIndex(grid, sel.c, sel.r)] = 1;
  } else if (sel.kind === 'row') {
    const r = mod(sel.r, R);
    mask.fill(1, r * C, (r + 1) * C);
  } else if (sel.kind === 'column') {
    const c = mod(sel.c, C);
    for (let r = 0; r < R; r++) mask[r * C + c] = 1;
  } else if (sel.kind === 'diagonal') {
    const dir = sel.dir < 0 ? -1 : 1;
    const n = diagonalLength(C, R);
    for (let k = 0; k < n; k++) mask[cellIndex(grid, sel.c + k, sel.r + dir * k)] = 1;
  } else if (sel.kind === 'rect') {
    const c0 = Math.min(sel.c0, sel.c1);
    const c1 = Math.max(sel.c0, sel.c1);
    const r0 = Math.min(sel.r0, sel.r1);
    const r1 = Math.max(sel.r0, sel.r1);
    // A rectangle wider or taller than the tile covers all of it that way.
    const cs = c1 - c0 + 1 >= C ? [0, C - 1] : [c0, c1];
    const rs = r1 - r0 + 1 >= R ? [0, R - 1] : [r0, r1];
    for (let r = rs[0]; r <= rs[1]; r++) for (let c = cs[0]; c <= cs[1]; c++) mask[cellIndex(grid, c, r)] = 1;
  }
  return mask;
}

/** A selection that covers the whole tile (Set and Invert with nothing selected). */
export const wholeTile = (grid) => new Uint8Array(grid.columns * grid.rows).fill(1);

function mapCells(grid, mask, fn) {
  let cells = null;
  for (let i = 0; i < grid.cells.length; i++) {
    if (mask && !mask[i]) continue;
    const v = fn(grid.cells[i]);
    if (v === grid.cells[i]) continue;
    cells ??= Int8Array.from(grid.cells);
    cells[i] = v;
  }
  return cells ? { ...grid, cells } : grid;
}

/** Sets one cell (wrapped) to a state. */
export function paintCell(grid, c, r, value) {
  const i = cellIndex(grid, c, r);
  if (grid.cells[i] === value) return grid;
  const cells = Int8Array.from(grid.cells);
  cells[i] = value;
  return { ...grid, cells };
}

/** Sets every cell under the mask to a state (Set, D46). */
export function setCells(grid, mask, value) {
  return mapCells(grid, mask, () => value);
}

/** Swaps out and in under the mask and leaves flat as it is (Invert, §6). */
export function invertCells(grid, mask) {
  return mapCells(grid, mask, (v) => -v || 0);
}

/** Rotates one row around: by +1 moves every cell one column right, the last one wrapping to the front. */
export function shiftRow(grid, r, by) {
  const { columns: C } = grid;
  const row = mod(r, grid.rows);
  const s = mod(by, C);
  if (!s) return grid;
  const cells = Int8Array.from(grid.cells);
  for (let c = 0; c < C; c++) cells[row * C + mod(c + s, C)] = grid.cells[row * C + c];
  return { ...grid, cells };
}

/** Rotates one column: by +1 moves every cell one row up, the top one wrapping to the bottom. */
export function shiftColumn(grid, c, by) {
  const { columns: C, rows: R } = grid;
  const col = mod(c, C);
  const s = mod(by, R);
  if (!s) return grid;
  const cells = Int8Array.from(grid.cells);
  for (let r = 0; r < R; r++) cells[mod(r + s, R) * C + col] = grid.cells[r * C + col];
  return { ...grid, cells };
}

/** Rotates the whole tile: dc columns right, dr rows up. */
export function shiftTile(grid, dc, dr) {
  const { columns: C, rows: R } = grid;
  if (!mod(dc, C) && !mod(dr, R)) return grid;
  const cells = new Int8Array(C * R);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) cells[mod(r + dr, R) * C + mod(c + dc, C)] = grid.cells[r * C + c];
  return { ...grid, cells };
}

/** Mirrors the tile left to right ('leftRight') or top to bottom ('upDown'). */
export function mirrorTile(grid, axis) {
  const { columns: C, rows: R } = grid;
  const cells = new Int8Array(C * R);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const from = axis === 'upDown' ? (R - 1 - r) * C + c : r * C + (C - 1 - c);
      cells[r * C + c] = grid.cells[from];
    }
  }
  const out = { ...grid, cells };
  return sameGrid(out, grid) ? grid : out;
}

/**
 * Inserts a row at index `at` (0 … rows): a copy of row `from`, or flat when
 * `from` is null. Unchanged at `max` rows.
 */
export function insertRow(grid, at, from = null, max = MAX_BITMAP_CELLS) {
  const { columns: C, rows: R } = grid;
  if (R >= max) return grid;
  const a = Math.min(Math.max(0, at), R);
  const cells = new Int8Array(C * (R + 1));
  cells.set(grid.cells.subarray(0, a * C), 0);
  if (from != null) {
    const f = mod(from, R);
    cells.set(grid.cells.subarray(f * C, (f + 1) * C), a * C);
  }
  cells.set(grid.cells.subarray(a * C), (a + 1) * C);
  return { columns: C, rows: R + 1, cells };
}

/** Removes row r; a tile keeps at least one row. */
export function removeRow(grid, r) {
  const { columns: C, rows: R } = grid;
  if (R <= 1) return grid;
  const row = mod(r, R);
  const cells = new Int8Array(C * (R - 1));
  cells.set(grid.cells.subarray(0, row * C), 0);
  cells.set(grid.cells.subarray((row + 1) * C), row * C);
  return { columns: C, rows: R - 1, cells };
}

/**
 * Inserts a column at index `at` (0 … columns): a copy of column `from`, or
 * flat when `from` is null. Unchanged at `max` columns.
 */
export function insertColumn(grid, at, from = null, max = MAX_BITMAP_CELLS) {
  const { columns: C, rows: R } = grid;
  if (C >= max) return grid;
  const a = Math.min(Math.max(0, at), C);
  const f = from == null ? -1 : mod(from, C);
  const cells = new Int8Array((C + 1) * R);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c <= C; c++) {
      const src = c < a ? c : c === a ? f : c - 1;
      cells[r * (C + 1) + c] = src < 0 ? 0 : grid.cells[r * C + src];
    }
  }
  return { columns: C + 1, rows: R, cells };
}

/** Removes column c; a tile keeps at least one column. */
export function removeColumn(grid, c) {
  const { columns: C, rows: R } = grid;
  if (C <= 1) return grid;
  const col = mod(c, C);
  const cells = new Int8Array((C - 1) * R);
  for (let r = 0; r < R; r++) {
    for (let k = 0, j = 0; k < C; k++) if (k !== col) cells[r * (C - 1) + j++] = grid.cells[r * C + k];
  }
  return { columns: C - 1, rows: R, cells };
}

/**
 * Every row twice, in place (Double rows, §3.2): the drawing gets twice as
 * tall, since a Pattern's rows never scale. Unchanged past `max` rows.
 */
export function doubleRows(grid, max = MAX_BITMAP_CELLS) {
  const { columns: C, rows: R } = grid;
  if (R * 2 > max) return grid;
  const cells = new Int8Array(C * R * 2);
  for (let r = 0; r < R; r++) {
    const row = grid.cells.subarray(r * C, (r + 1) * C);
    cells.set(row, 2 * r * C);
    cells.set(row, (2 * r + 1) * C);
  }
  return { columns: C, rows: R * 2, cells };
}

/** The size a quick fill of a row of n cells makes (core/patterns.js fillBitmap). */
export function fillSize(n, layout) {
  if (layout === 'diagonal') return { columns: n, rows: n };
  if (layout === 'brick') return { columns: n % 2 ? 2 * n : n, rows: 2 };
  if (layout === 'checker') return { columns: n, rows: 2 };
  return { columns: n, rows: 1 };
}

/**
 * A quick fill from row r (D45): stripes, diagonal, brick or checker laid out
 * from that row over a whole new tile. Null when the result would be larger
 * than `max` cells a side.
 */
export function quickFill(grid, r, layout, max = MAX_BITMAP_CELLS) {
  const row = mod(r, grid.rows);
  const size = fillSize(grid.columns, layout);
  if (size.columns > max || size.rows > max) return null;
  return gridOf(fillBitmap(Array.from(grid.cells.subarray(row * grid.columns, (row + 1) * grid.columns)), layout));
}

/**
 * The cells a drag passes through from view cell a to view cell b, both
 * included, so a quick stroke never skips a cell (Bresenham).
 * @returns {{ c: number, r: number }[]}
 */
export function lineCells(a, b) {
  const out = [];
  let c = a.c;
  let r = a.r;
  const dc = Math.abs(b.c - c);
  const dr = -Math.abs(b.r - r);
  const sc = c < b.c ? 1 : -1;
  const sr = r < b.r ? 1 : -1;
  let err = dc + dr;
  for (;;) {
    out.push({ c, r });
    if (c === b.c && r === b.r) break;
    const e2 = 2 * err;
    if (e2 >= dr) { err += dr; c += sc; }
    if (e2 <= dc) { err += dc; r += sr; }
  }
  return out;
}
