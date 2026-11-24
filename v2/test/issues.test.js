// Tests for the scoped GitHub issues: sharp points and per-point corners on
// the profile curve (#6), stepped fields and sliders and the editable size
// chip (#5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile } from '../core/profile.js';
import { normaliseDesign, cloneDesign } from '../core/design.js';
import { computePreview } from '../core/engine.js';
import { stepOnGrid, snapMarks } from '../ui/controls.js';
import { SIZE_AXES, SIZE_TOLERANCE_MM, fitOuterSize } from '../ui/size-fit.js';
import { library, presets } from './support/fixtures.js';

const knots = [
  { z: 0, r: 40 },
  { z: 30, r: 60 },
  { z: 70, r: 35 },
  { z: 90, r: 35 },
  { z: 130, r: 50 },
];

// ---------- #6: sharp points ----------

for (const interp of ['catmullRomCentripetal', 'monotone']) {
  test(`${interp}: a sharp point splits the curve into two curves that meet there`, () => {
    const sharp = knots.map((k, i) => (i === 2 ? { ...k, sharp: true } : { ...k }));
    const curve = createProfile({ interp, tension: 0.5, knots: sharp });
    const below = createProfile({ interp, tension: 0.5, knots: knots.slice(0, 3) });
    const above = createProfile({ interp, tension: 0.5, knots: knots.slice(2).map((k) => ({ ...k, z: k.z - 70 })) });
    for (let z = 0; z <= 130; z += 0.5) {
      const want = z <= 70 ? below.at(z) : above.at(z - 70);
      assert.ok(Math.abs(curve.at(z) - want) < 1e-9, `z ${z}`);
    }
    for (const k of knots) assert.ok(Math.abs(curve.at(k.z) - k.r) < 1e-9, `passes through z ${k.z}`);
  });

  test(`${interp}: the slope jumps at a sharp point and nowhere else`, () => {
    const sharp = knots.map((k, i) => (i === 1 ? { ...k, sharp: true } : { ...k }));
    const curve = createProfile({ interp, tension: 0.5, knots: sharp });
    const slope = (z) => (curve.at(z + 1e-4) - curve.at(z - 1e-4)) / 2e-4;
    const left = (curve.at(30) - curve.at(30 - 1e-4)) / 1e-4;
    const right = (curve.at(30 + 1e-4) - curve.at(30)) / 1e-4;
    assert.ok(Math.abs(left - right) > 0.1, 'a corner at the sharp point');
    assert.ok(Math.abs(slope(70 - 1e-3) - slope(70 + 1e-3)) < 0.01, 'smooth at an ordinary point');
  });
}

test('sharp on an end point, or on an Angular curve, changes nothing', () => {
  const plain = createProfile({ interp: 'catmullRomCentripetal', tension: 0.5, knots });
  const ends = knots.map((k, i) => ({ ...k, sharp: i === 0 || i === knots.length - 1 }));
  const withEnds = createProfile({ interp: 'catmullRomCentripetal', tension: 0.5, knots: ends });
  const angular = createProfile({ interp: 'linear', cornerMm: 6, knots });
  const angularSharp = createProfile({ interp: 'linear', cornerMm: 6, knots: knots.map((k) => ({ ...k, sharp: true })) });
  for (let z = 0; z <= 130; z += 0.5) {
    assert.equal(withEnds.at(z), plain.at(z));
    assert.equal(angularSharp.at(z), angular.at(z));
  }
});

test('every inner point sharp gives straight lines between the points', () => {
  const allSharp = knots.map((k) => ({ ...k, sharp: true }));
  const smooth = createProfile({ interp: 'catmullRomCentripetal', tension: 0.5, knots: allSharp });
  const straight = createProfile({ interp: 'linear', cornerMm: 0, knots });
  for (let z = 0; z <= 130; z += 0.5) assert.ok(Math.abs(smooth.at(z) - straight.at(z)) < 1e-9, `z ${z}`);
});

test('a corner radius on one point rounds only that corner', () => {
  const own = knots.map((k, i) => (i === 2 ? { ...k, corner: 12 } : { ...k }));
  const curve = createProfile({ interp: 'linear', cornerMm: 0, knots: own });
  const sharp = createProfile({ interp: 'linear', cornerMm: 0, knots });
  assert.ok(Math.abs(curve.at(70) - sharp.at(70)) > 0.5, 'rounded at point 3');
  for (const z of [10, 30, 45, 95, 110, 130]) assert.ok(Math.abs(curve.at(z) - sharp.at(z)) < 1e-9, `unchanged at z ${z}`);
});

test('normaliseDesign keeps sharp points and drops anything but true', () => {
  const d = normaliseDesign(presets[0]);
  d.form.profile.knots[1].sharp = true;
  d.form.profile.knots[2].sharp = 'yes';
  const n = normaliseDesign(d);
  assert.equal(n.form.profile.knots[1].sharp, true);
  assert.equal('sharp' in n.form.profile.knots[2], false);
  assert.equal('sharp' in n.form.profile.knots[0], false);
});

// ---------- #5: stepping ----------

test('stepOnGrid lands on whole steps, like a native number input', () => {
  assert.equal(stepOnGrid(12.3, 1, 1), 13);
  assert.equal(stepOnGrid(12.3, -1, 1), 12);
  assert.equal(stepOnGrid(12.3, 3, 1), 15);
  assert.equal(stepOnGrid(13, 1, 1), 14);
  assert.equal(stepOnGrid(13, -2, 1), 11);
  assert.equal(stepOnGrid(12.3, 0, 1), 12.3);
  assert.ok(Math.abs(stepOnGrid(0.3, 1, 0.1) - 0.4) < 1e-12, '0.3 / 0.1 counts as on the grid');
  assert.equal(stepOnGrid(4.4, 1, 1.5), 4.5);
  assert.equal(stepOnGrid(-2.5, 1, 1), -2);
});

test('snapMarks covers the range and leaves no gap at the top', () => {
  assert.deepEqual(snapMarks(0, 1, 0.25, 2), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(snapMarks(0, 8, 3, 1), [0, 3, 6, 8]);
  assert.equal(snapMarks(0, 1, 0.05, 2).length, 21);
  assert.deepEqual(snapMarks(0, 100, 1, 0), [], 'too many marks to show');
  assert.deepEqual(snapMarks(0, 1, undefined, 2), []);
});

// ---------- #5: the size chip ----------

// Drives fitOuterSize the way the chip does, with the real engine.
async function fitTo(design, axis, target) {
  const ax = SIZE_AXES[axis];
  const d = cloneDesign(design);
  let passes = 0;
  const result = await fitOuterSize({
    target,
    x: ax.get(d),
    m: null,
    tolerance: ax.tolerance(d),
    apply: (x) => { ax.set(d, x); return ax.get(d); },
    measure: async () => { passes += 1; return computePreview(d, { library }).size[ax.key]; },
  });
  return { d, result, measured: passes };
}

for (const p of presets) {
  const design = normaliseDesign(p);
  const size = computePreview(design, { library }).size;
  for (const [axis, factor] of [['width', 0.7], ['width', 1.3], ['depth', 1.25], ['height', 1.2]]) {
    test(`size chip: ${p.meta?.name} ${axis} × ${factor} lands on the typed number`, async () => {
      const key = SIZE_AXES[axis].key;
      const target = Math.round(size[key] * factor);
      const { d, result } = await fitTo(design, axis, target);
      const got = computePreview(d, { library }).size[key];
      // Height moves in whole layers, so it can only get within half a layer.
      const tolerance = axis === 'height' ? design.layers.layerHeightMm / 2 + 1e-6 : SIZE_TOLERANCE_MM;
      assert.ok(Math.abs(got - target) <= tolerance, `${axis} ${got.toFixed(2)} for ${target} after ${result.passes} passes`);
    });
  }
}

test('size chip: a size past the limits stops at the limit instead of looping', async () => {
  const design = normaliseDesign(presets[0]);
  const { result, measured } = await fitTo(design, 'width', 5000);
  assert.ok(measured <= 6, `measured ${measured} times`);
  assert.ok(result.m < 5000);
});

test('size chip: a cancelled measure stops the fit', async () => {
  const design = normaliseDesign(presets[0]);
  const ax = SIZE_AXES.width;
  const d = cloneDesign(design);
  const result = await fitOuterSize({
    target: 300, x: ax.get(d), m: 100,
    apply: (x) => { ax.set(d, x); return ax.get(d); },
    measure: async () => null,
  });
  assert.equal(result.m, null);
  assert.equal(result.passes, 1);
});
