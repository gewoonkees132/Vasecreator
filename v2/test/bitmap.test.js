// Tests for the 2D editor's operations on a bitmap tile (core/bitmap.js,
// pattern studio D45, D46, §6): set, invert, rows, columns, diagonals
// across the repeats, shift, mirror, the tile size and the quick fills.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyGrid, gridOf, recipeOf, sameGrid, wrapCell, cellIndex, cellValue, diagonalLength, selectionMask, wholeTile,
  paintCell, setCells, invertCells, shiftRow, shiftColumn, shiftTile, mirrorTile, insertRow, removeRow,
  insertColumn, removeColumn, doubleRows, fillSize, quickFill, lineCells,
} from '../core/bitmap.js';
import { fillBitmap, makeBitmap, validateRecipe } from '../core/patterns.js';

/** A grid from rows written top row first, as they read on screen ('+', '0', '-'). */
function grid(...rowsTopFirst) {
  const rows = rowsTopFirst.length;
  const columns = rowsTopFirst[0].length;
  return gridOf({ kind: 'bitmap', columns, rows, cells: [...rowsTopFirst].reverse().join('') });
}
/** The grid's rows, top row first. */
function rowsOf(g) {
  const cells = recipeOf(g).cells;
  const out = [];
  for (let r = g.rows - 1; r >= 0; r--) out.push(cells.slice(r * g.columns, (r + 1) * g.columns));
  return out;
}
/** A mask's rows, top row first, as '#' and '.'. */
function maskRows(g, mask) {
  const out = [];
  for (let r = g.rows - 1; r >= 0; r--) {
    let s = '';
    for (let c = 0; c < g.columns; c++) s += mask[r * g.columns + c] ? '#' : '.';
    out.push(s);
  }
  return out;
}

// ---------- The grid ----------

test('a grid round-trips through its recipe, edges and all', () => {
  const recipe = { kind: 'bitmap', columns: 3, rows: 2, cells: '+0--+0', edges: 'round' };
  const g = gridOf(recipe);
  assert.deepEqual([...g.cells], [1, 0, -1, -1, 1, 0]);
  assert.deepEqual(recipeOf(g, 'round'), recipe);
  assert.deepEqual(recipeOf(g), { kind: 'bitmap', columns: 3, rows: 2, cells: '+0--+0' });
  validateRecipe(recipeOf(g, 'sharp'));
  assert.equal(recipeOf(emptyGrid(4, 2)).cells, '00000000');
});

test('editing a grid never touches the recipe it came from', () => {
  const recipe = { kind: 'bitmap', columns: 2, rows: 1, cells: '+-' };
  const g = gridOf(recipe);
  paintCell(g, 0, 0, -1);
  invertCells(g, wholeTile(g));
  assert.equal(recipe.cells, '+-');
  assert.deepEqual([...g.cells], [1, -1]);
});

test('every coordinate wraps into the tile, also from the repeats on either side', () => {
  const g = emptyGrid(4, 3);
  assert.deepEqual(wrapCell(g, -1, -1), { c: 3, r: 2 });
  assert.deepEqual(wrapCell(g, 9, 7), { c: 1, r: 1 });
  assert.equal(cellIndex(g, 5, 4), cellIndex(g, 1, 1));
  const p = paintCell(g, -3, 5, 1);    // a cell in a repeat up and to the left
  assert.equal(cellValue(p, 1, 2), 1);
  assert.equal(cellValue(p, 1 + 4, 2 - 3), 1);
});

test('sameGrid compares size and cells', () => {
  assert.ok(sameGrid(grid('+-'), grid('+-')));
  assert.ok(!sameGrid(grid('+-'), grid('-+')));
  assert.ok(!sameGrid(grid('+-'), grid('+', '-')));
});

// ---------- Painting, Set and Invert ----------

test('painting sets one cell and returns the same grid when nothing changes', () => {
  const g = grid('000', '000');
  const p = paintCell(g, 1, 0, -1);
  assert.deepEqual(rowsOf(p), ['000', '0-0']);
  assert.equal(paintCell(p, 1, 0, -1), p);
});

test('Set puts every selected cell in one state', () => {
  const g = grid('+-0', '-0+');
  assert.deepEqual(rowsOf(setCells(g, selectionMask(g, { kind: 'row', r: 1 }), 0)), ['000', '-0+']);
  assert.deepEqual(rowsOf(setCells(g, wholeTile(g), 1)), ['+++', '+++']);
});

test('Invert swaps out and in and leaves flat as it is', () => {
  const g = grid('+-0', '-0+');
  assert.deepEqual(rowsOf(invertCells(g, wholeTile(g))), ['-+0', '+0-']);
  assert.deepEqual(rowsOf(invertCells(g, selectionMask(g, { kind: 'column', c: 0 }))), ['--0', '+0+']);
  const flat = grid('000');
  assert.equal(invertCells(flat, wholeTile(flat)), flat);
});

test('Invert twice gives the drawing back', () => {
  const g = grid('+0-+', '-+00', '0-+-');
  const mask = selectionMask(g, { kind: 'diagonal', c: 1, r: 0, dir: 1 });
  assert.ok(sameGrid(invertCells(invertCells(g, mask), mask), g));
});

// ---------- Selections ----------

test('a row is one layer across the tile and a column one point up it', () => {
  const g = emptyGrid(4, 3);
  assert.deepEqual(maskRows(g, selectionMask(g, { kind: 'row', r: 0 })), ['....', '....', '####']);
  assert.deepEqual(maskRows(g, selectionMask(g, { kind: 'column', c: 2 })), ['..#.', '..#.', '..#.']);
  // Picked in a repeat: the tile's own row and column.
  assert.deepEqual(selectionMask(g, { kind: 'row', r: -1 }), selectionMask(g, { kind: 'row', r: 2 }));
  assert.deepEqual(selectionMask(g, { kind: 'column', c: 6 }), selectionMask(g, { kind: 'column', c: 2 }));
});

test('a diagonal on a square tile is one line each way', () => {
  const g = emptyGrid(4, 4);
  assert.deepEqual(maskRows(g, selectionMask(g, { kind: 'diagonal', c: 0, r: 0, dir: 1 })), ['...#', '..#.', '.#..', '#...']);
  assert.deepEqual(maskRows(g, selectionMask(g, { kind: 'diagonal', c: 0, r: 3, dir: -1 })), ['#...', '.#..', '..#.', '...#']);
  // Through any cell on it: the same diagonal.
  assert.deepEqual(selectionMask(g, { kind: 'diagonal', c: 2, r: 2, dir: 1 }), selectionMask(g, { kind: 'diagonal', c: 0, r: 0, dir: 1 }));
});

test('a diagonal runs on through the repeats: on a wide tile it wraps round until it closes', () => {
  // 6 × 4: the line climbs one row per column and comes back after lcm(6, 4) = 12 cells.
  const g = emptyGrid(6, 4);
  assert.equal(diagonalLength(6, 4), 12);
  const mask = selectionMask(g, { kind: 'diagonal', c: 0, r: 0, dir: 1 });
  assert.equal(mask.reduce((a, b) => a + b, 0), 12);
  // gcd(6, 4) = 2, so the wrapped line covers every other cell.
  assert.deepEqual(maskRows(g, mask), ['.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.']);
  // Every cell the line passes in the repeats is in the mask, so the line is
  // unbroken however far it runs in the dimmed repeats.
  for (let k = -20; k <= 20; k++) assert.equal(mask[cellIndex(g, k, k)], 1, `cell ${k}, ${k}`);
  // A tile whose sides share no factor: the diagonal visits every cell.
  assert.equal(selectionMask(emptyGrid(3, 2), { kind: 'diagonal', c: 0, r: 0, dir: 1 }).reduce((a, b) => a + b, 0), 6);
});

test('inverting a column or a diagonal picked in a dimmed repeat inverts the tile itself', () => {
  const g = grid('+0+0', '0+0+', '+0+0', '0+0+');
  const fromRepeat = invertCells(g, selectionMask(g, { kind: 'column', c: -3 }));   // column 1, one repeat to the left
  assert.deepEqual(rowsOf(fromRepeat), ['+0+0', '0-0+', '+0+0', '0-0+']);
  // The ↘ diagonal through (1, 1) visits (1, 1), (2, 0), (3, 3) and (0, 2).
  const out = grid('++++', '++++', '++++', '++++');
  const diag = invertCells(out, selectionMask(out, { kind: 'diagonal', c: 5, r: 9, dir: -1 }));   // (1, 1) seen from a repeat
  assert.deepEqual(rowsOf(diag), ['+++-', '-+++', '+-++', '++-+']);
  assert.ok(sameGrid(diag, invertCells(out, selectionMask(out, { kind: 'diagonal', c: 1, r: 1, dir: -1 }))));
});

test('a rectangle may reach into the repeats; past the tile size it covers all of it', () => {
  const g = emptyGrid(4, 3);
  assert.deepEqual(maskRows(g, selectionMask(g, { kind: 'rect', c0: 1, r0: 0, c1: 2, r1: 1 })), ['....', '.##.', '.##.']);
  assert.deepEqual(maskRows(g, selectionMask(g, { kind: 'rect', c0: 3, r0: 2, c1: 4, r1: 2 })), ['#..#', '....', '....']);
  assert.deepEqual(maskRows(g, selectionMask(g, { kind: 'rect', c0: 2, r0: 1, c1: -1, r1: 1 })), ['....', '####', '....']);
  assert.deepEqual(maskRows(g, selectionMask(g, { kind: 'cell', c: -1, r: 3 })), ['....', '....', '...#']);
  assert.equal(selectionMask(g, null).reduce((a, b) => a + b, 0), 0);
});

// ---------- Transforms ----------

test('shifting a row or a column rotates it round', () => {
  const g = grid('+0-0', '++00');
  assert.deepEqual(rowsOf(shiftRow(g, 1, 1)), ['0+0-', '++00']);
  assert.deepEqual(rowsOf(shiftRow(g, 1, -1)), ['0-0+', '++00']);
  assert.deepEqual(rowsOf(shiftColumn(g, 2, 1)), ['+000', '++-0']);
  assert.equal(shiftRow(g, 0, 4), g);
  assert.ok(sameGrid(shiftRow(shiftRow(g, 0, 3), 0, 1), g));
});

test('shifting the tile moves every row and column together', () => {
  const g = grid('+00', '0-0');
  assert.deepEqual(rowsOf(shiftTile(g, 1, 0)), ['0+0', '00-']);
  assert.deepEqual(rowsOf(shiftTile(g, 0, 1)), ['0-0', '+00']);
  assert.equal(shiftTile(g, 3, 2), g);
});

test('mirroring flips the tile left to right or top to bottom', () => {
  const g = grid('+0-', '00+');
  assert.deepEqual(rowsOf(mirrorTile(g, 'leftRight')), ['-0+', '+00']);
  assert.deepEqual(rowsOf(mirrorTile(g, 'upDown')), ['00+', '+0-']);
  const sym = grid('+0+');
  assert.equal(mirrorTile(sym, 'leftRight'), sym);
});

// ---------- The tile size ----------

test('adding a row copies the current one in above it; removing keeps at least one row', () => {
  const g = grid('+0', '0-');    // row 1 '+0', row 0 '0-'
  assert.deepEqual(rowsOf(insertRow(g, 1, 0)), ['+0', '0-', '0-']);
  assert.deepEqual(rowsOf(insertRow(g, 2, null)), ['00', '+0', '0-']);
  assert.deepEqual(rowsOf(removeRow(g, 1)), ['0-']);
  const one = grid('+-');
  assert.equal(removeRow(one, 0), one);
  assert.equal(insertRow(emptyGrid(2, 4), 0, 0, 4).rows, 4);   // at the most rows
});

test('adding a column copies the current one to its right; removing keeps at least one', () => {
  const g = grid('+0-', '0-+');
  assert.deepEqual(rowsOf(insertColumn(g, 1, 0)), ['++0-', '00-+']);
  assert.deepEqual(rowsOf(insertColumn(g, 3, null)), ['+0-0', '0-+0']);
  assert.deepEqual(rowsOf(removeColumn(g, 1)), ['+-', '0+']);
  const one = grid('+', '-');
  assert.equal(removeColumn(one, 0), one);
  assert.equal(insertColumn(emptyGrid(16, 2), 0, 0, 16).columns, 16);
});

test('Double rows repeats every row in place, so the drawing gets twice as tall', () => {
  const g = grid('+-', '0+');
  const d = doubleRows(g);
  assert.deepEqual(rowsOf(d), ['+-', '+-', '0+', '0+']);
  assert.equal(doubleRows(emptyGrid(2, 40)).rows, 40);      // 80 would pass 64
  assert.equal(doubleRows(emptyGrid(2, 32)).rows, 64);
  assert.equal(doubleRows(emptyGrid(2, 9), 16).rows, 9);
});

// ---------- Quick fills ----------

test('quick fills lay the current row out over a new tile, as fillBitmap does', () => {
  const g = grid('0000', '+-0+');   // row 0 is '+-0+'
  for (const layout of ['stripes', 'diagonal', 'brick', 'checker']) {
    const f = quickFill(g, 0, layout);
    const expected = gridOf(fillBitmap([1, -1, 0, 1], layout));
    assert.ok(sameGrid(f, expected), layout);
    assert.deepEqual({ columns: f.columns, rows: f.rows }, fillSize(4, layout), layout);
  }
  assert.deepEqual(rowsOf(quickFill(g, 0, 'checker')), ['-+0-', '+-0+']);
  assert.deepEqual(rowsOf(quickFill(g, 0, 'diagonal')), ['++-0', '0++-', '-0++', '+-0+']);
});

test('a quick fill that would pass the most cells gives null', () => {
  const odd = makeBitmap(9, 1, [1, -1, 1, -1, 1, -1, 1, -1, 1]);
  assert.deepEqual(fillSize(9, 'brick'), { columns: 18, rows: 2 });
  assert.equal(quickFill(gridOf(odd), 0, 'brick', 16), null);
  assert.equal(quickFill(gridOf(odd), 0, 'brick', 64).columns, 18);
  assert.equal(quickFill(emptyGrid(20, 1), 0, 'diagonal', 16), null);
});

// ---------- Strokes ----------

test('a fast stroke passes every cell between two samples', () => {
  assert.deepEqual(lineCells({ c: 0, r: 0 }, { c: 3, r: 0 }), [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 }]);
  assert.deepEqual(lineCells({ c: 2, r: 2 }, { c: 2, r: 2 }), [{ c: 2, r: 2 }]);
  const diag = lineCells({ c: 0, r: 0 }, { c: -3, r: 3 });
  assert.equal(diag.length, 4);
  assert.deepEqual(diag.at(-1), { c: -3, r: 3 });
  const steep = lineCells({ c: 0, r: 0 }, { c: 2, r: 7 });
  assert.equal(steep.length, 8);
  for (let i = 1; i < steep.length; i++) {
    assert.ok(Math.abs(steep[i].c - steep[i - 1].c) <= 1 && Math.abs(steep[i].r - steep[i - 1].r) <= 1, 'neighbours');
  }
});
