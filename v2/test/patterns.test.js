// The Pattern's drawing (core/patterns.js): bitmap recipes, the quick fills
// and what counts as a valid recipe. The analytic shapes and soft grids of
// the Detailed morph went with it (D63).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitmapValues, fillBitmap, makeBitmap, validateRecipe } from '../core/patterns.js';

test('a bitmap reads its cells as numbers, row-major from the bottom row', () => {
  const recipe = { kind: 'bitmap', columns: 3, rows: 2, cells: '+0--0+' };
  assert.deepEqual(Array.from(bitmapValues(recipe)), [1, 0, -1, -1, 0, 1]);
  // Cached per recipe object.
  assert.equal(bitmapValues(recipe), bitmapValues(recipe));
});

test('makeBitmap rounds numbers to out, flat or in', () => {
  assert.deepEqual(makeBitmap(4, 1, [0.9, 0.4, -0.4, -0.9]), { kind: 'bitmap', columns: 4, rows: 1, cells: '+00-' });
});

test('a brick fill shifts every other row by half a repeat', () => {
  const recipe = fillBitmap([1, -1, 1], 'brick');
  validateRecipe(recipe);
  // An odd row doubles its cells, so the half repeat is whole.
  assert.deepEqual([recipe.columns, recipe.rows, recipe.cells], [6, 2, '++--++-++++-']);
  const v = bitmapValues(recipe);
  for (let c = 0; c < 6; c++) assert.equal(v[c], v[6 + ((c + 3) % 6)], `column ${c}`);
  assert.equal(fillBitmap([1, -1], 'brick').cells, '+--+');
});

test('the other fills lay a row out as stripes, a diagonal or a checker', () => {
  assert.deepEqual(fillBitmap([1, 0, -1], 'stripes'), { kind: 'bitmap', columns: 3, rows: 1, cells: '+0-' });
  // Each row one cell further round, so an out cell climbs to the left.
  assert.equal(fillBitmap([1, 0, -1], 'diagonal').cells, '+0-0-+-+0');
  assert.equal(fillBitmap([1, 0, -1], 'checker').cells, '+0--0+');
});

test('invalid recipes are rejected: only a bitmap draws', () => {
  assert.throws(() => validateRecipe(null), TypeError);
  assert.throws(() => validateRecipe({ kind: 'shape', shape: 'flutes' }), RangeError, 'the analytic shapes are gone (D63)');
  assert.throws(() => validateRecipe({ kind: 'plain' }), RangeError);
  assert.throws(() => validateRecipe({ kind: 'motif', cells: [1, -1] }), RangeError, 'the motif kind is gone (D45)');
  assert.throws(() => validateRecipe({ kind: 'bitmap', columns: 2, rows: 1, cells: '+' }), RangeError);
  assert.throws(() => validateRecipe({ kind: 'bitmap', columns: 2, rows: 1, cells: '+x' }), RangeError);
  assert.throws(() => validateRecipe({ kind: 'bitmap', columns: 0, rows: 1, cells: '' }), RangeError);
  assert.throws(() => validateRecipe({ kind: 'bitmap', columns: 65, rows: 1, cells: '+'.repeat(65) }), RangeError);
  assert.doesNotThrow(() => validateRecipe({ kind: 'bitmap', columns: 64, rows: 64, cells: '0'.repeat(4096) }));
  assert.throws(() => validateRecipe({ kind: 'image' }), RangeError);
});
