import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAIN, evaluatePattern, findPattern, sampleTile, validateRecipe } from '../core/patterns.js';
import { REFERENCE_POT, measureWall, wallLimits } from './support/printability.js';

const library = JSON.parse(readFileSync(new URL('../library/patterns.json', import.meta.url), 'utf8'));

const GRID = 160;

test('the library holds twelve distinct, valid patterns', () => {
  assert.equal(library.schema, 'vasecreator/pattern-library');
  assert.equal(library.patterns.length, 12);
  assert.equal(new Set(library.patterns.map((p) => p.id)).size, 12);
  assert.equal(new Set(library.patterns.map((p) => p.name)).size, 12);
  for (const p of library.patterns) {
    assert.match(p.id, /^lib:[a-z-]+@\d+$/);
    validateRecipe(p.recipe);
    const { depthMm, repeats, tileHeightMm } = p.defaults;
    assert.ok(depthMm > 0 && Number.isInteger(repeats) && repeats >= 1 && tileHeightMm > 0, p.id);
  }
});

for (const p of library.patterns) {
  test(`${p.name} stays inside its declared range`, () => {
    const [lo, hi] = p.range;
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const v = evaluatePattern(p.recipe, i / GRID, j / GRID);
        assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `${v} at (${i / GRID}, ${j / GRID})`);
      }
    }
  });

  test(`${p.name} is seamless and has no steps`, () => {
    // Across the tile edges, around and up.
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      assert.ok(Math.abs(evaluatePattern(p.recipe, 1 - 1e-7, t) - evaluatePattern(p.recipe, 1e-7, t)) < 1e-4, `around, at y ${t}`);
      assert.ok(Math.abs(evaluatePattern(p.recipe, t, 1 - 1e-7) - evaluatePattern(p.recipe, t, 1e-7)) < 1e-4, `up, at x ${t}`);
    }
    // Anywhere inside: neighbouring samples never jump.
    const d = 1 / 600;
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = i / GRID;
        const y = j / GRID;
        const v = evaluatePattern(p.recipe, x, y);
        assert.ok(Math.abs(evaluatePattern(p.recipe, x + d, y) - v) < 0.06, `around at (${x}, ${y})`);
        assert.ok(Math.abs(evaluatePattern(p.recipe, x, y + d) - v) < 0.06, `up at (${x}, ${y})`);
      }
    }
  });

  test(`${p.name} prints within the limits at its starting values`, () => {
    const { radiusMm, beadWidthMm, layerHeightMm, overhangLimitDeg } = REFERENCE_POT;
    const { depthMm, repeats, tileHeightMm } = p.defaults;
    // Pattern alone on a straight wall; it may use 75 % of the overhang limit,
    // leaving the rest for the profile's own lean.
    const { step, curvature } = measureWall(
      {
        heightMm: 2 * tileHeightMm,
        radiusAt: () => radiusMm,
        slots: [{ recipe: p.recipe, depthMm, repeats, tileHeightMm, weightAt: () => 1 }],
      },
      { beadWidthMm, layerHeightMm },
    );
    const limits = wallLimits({ beadWidthMm, layerHeightMm, overhangLimitDeg });
    assert.ok(step.mm <= 0.75 * limits.stepMm, `step ${step.mm.toFixed(2)} mm per layer`);
    assert.ok(curvature.perMm <= limits.curvaturePerMm, `curvature ${curvature.perMm.toFixed(3)} per mm`);
  });
}

test('evaluation is repeatable to the bit', () => {
  for (const p of library.patterns) {
    const a = sampleTile(p.recipe, 33, 29);
    const b = sampleTile(p.recipe, 33, 29);
    assert.deepEqual(a, b, p.id);
  }
});

test('brick motifs shift every other row by half a repeat', () => {
  const recipe = { kind: 'motif', cells: [1, -1, 1], layout: 'brick', edges: 'soft' };
  for (let k = 0; k < 50; k++) {
    const x = k / 50;
    assert.ok(Math.abs(evaluatePattern(recipe, x, 0.25) - evaluatePattern(recipe, x + 0.5, 0.75)) < 1e-12);
  }
});

test('stripes depend only on the position around', () => {
  const recipe = { kind: 'motif', cells: [1, 0, -1], layout: 'stripes', edges: 'round' };
  assert.equal(evaluatePattern(recipe, 0.3, 0.1), evaluatePattern(recipe, 0.3, 0.8));
});

test('plain is always available and flat', () => {
  assert.equal(findPattern(library, 'plain'), PLAIN);
  assert.equal(evaluatePattern(PLAIN.recipe, 0.4, 0.6), 0);
  assert.throws(() => findPattern(library, 'lib:nope@1'), RangeError);
});

test('invalid recipes are rejected', () => {
  assert.throws(() => validateRecipe({ kind: 'shape', shape: 'nope' }), RangeError);
  assert.throws(() => validateRecipe({ kind: 'motif', cells: [1] }), RangeError);
  assert.throws(() => validateRecipe({ kind: 'motif', cells: [1, 2] }), RangeError);
  assert.throws(() => validateRecipe({ kind: 'motif', cells: [1, -1], layout: 'zigzag' }), RangeError);
  assert.throws(() => validateRecipe({ kind: 'motif', cells: [1, -1], edges: 'blurry' }), RangeError);
  assert.throws(() => validateRecipe({ kind: 'image' }), RangeError);
});

test('sampleTile lays rows out from the bottom of the tile', () => {
  const ribs = findPattern(library, 'lib:ribs@1').recipe;
  const grid = sampleTile(ribs, 4, 8);
  assert.equal(grid.length, 32);
  assert.equal(grid[0], evaluatePattern(ribs, 0.125, 0.0625));
  assert.equal(grid[31], evaluatePattern(ribs, 0.875, 0.9375));
});
