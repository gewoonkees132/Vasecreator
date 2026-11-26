import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findPattern } from '../core/patterns.js';
import { BLEND_SHAPES, detailWeights } from '../core/surface.js';
import { DESIGN_VERSION } from '../core/design.js';
import { createProfile } from '../core/profile.js';
import { measureWall, wallLimits } from './support/printability.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const library = read('../library/patterns.json');
const { presets } = read('../library/presets.json');

test('there are three presets with distinct ids and names', () => {
  assert.equal(presets.length, 3);
  assert.equal(new Set(presets.map((p) => p.meta.id)).size, 3);
  assert.equal(new Set(presets.map((p) => p.meta.name)).size, 3);
});

for (const design of presets) {
  const { form, layers, base, finish } = design;
  const detail = form.detail;

  test(`${design.meta.name} is a well-formed design`, () => {
    assert.equal(design.schema, 'vasecreator/design');
    assert.equal(design.version, DESIGN_VERSION);
    assert.equal(design.units, 'mm');
    assert.match(design.meta.id, /^preset:[a-z-]+@\d+$/);

    const { knots } = form.profile;
    assert.ok(['catmullRomCentripetal', 'monotone', 'linear'].includes(form.profile.interp));
    assert.equal(knots[0].z, 0);
    assert.equal(knots.at(-1).z, form.height);
    for (let i = 1; i < knots.length; i++) {
      assert.ok(knots[i].z - knots[i - 1].z >= layers.layerHeightMm, 'knots at least a layer apart');
    }
    for (const k of knots) assert.ok(k.r >= 2 * layers.beadWidthMm, 'radius at least two beads');
    // The evaluated curve, not just the knots, leaves room for the pattern's own lean
    // and never dips below the minimum radius between knots.
    const curve = createProfile(form.profile);
    let lean = 0;
    for (let z = 0; z + 0.5 <= form.height; z += 0.5) {
      lean = Math.max(lean, (Math.atan(Math.abs(curve.at(z + 0.5) - curve.at(z)) / 0.5) * 180) / Math.PI);
      assert.ok(curve.at(z) >= 2 * layers.beadWidthMm);
    }
    assert.ok(lean <= 35, `the profile curve leans up to ${lean.toFixed(1)}°`);

    assert.ok(['circle', 'rectangle'].includes(form.plan.footprint));
    assert.ok(form.plan.depthRatio > 0 && form.plan.cornerRounding >= 0 && form.plan.cornerRounding <= 1);
    assert.equal(typeof form.twist.degrees, 'number');

    assert.ok(detail.fromMm >= 0 && detail.fromMm < detail.toMm && detail.toMm <= form.height);
    for (const slot of [detail.a, detail.b].filter(Boolean)) {
      findPattern(library, slot.pattern);
      assert.ok(Number.isInteger(slot.repeats) && slot.repeats >= 1);
      assert.ok(slot.depthMm >= 0 && slot.tileHeightMm > 0);
      if (form.plan.footprint === 'rectangle') {
        assert.equal(slot.repeats % 4, 0, 'same pattern on every side of a rectangle');
      }
    }
    assert.ok(BLEND_SHAPES.includes(detail.blend.shape));
    assert.ok(detail.blend.amount >= 0 && detail.blend.amount <= 1);

    assert.ok(['fixed', 'followTwist', 'hidden'].includes(layers.seam.position));
    assert.ok(layers.layerHeightMm >= 0.3 * layers.beadWidthMm && layers.layerHeightMm <= 0.65 * layers.beadWidthMm);
    assert.equal(base.pattern, 'spiral');
    assert.ok(base.hole.diameter === 0 || base.hole.diameter >= 2 * layers.beadWidthMm);
    assert.ok([1, 2].includes(finish.walls));
    assert.ok(['smooth', 'followPattern'].includes(finish.innerWall));
  });

  test(`${design.meta.name} prints within the limits`, () => {
    const slots = [];
    for (const [key, slot] of [['a', detail.a], ['b', detail.b]]) {
      if (!slot) continue;
      slots.push({
        recipe: findPattern(library, slot.pattern).recipe,
        depthMm: slot.depthMm,
        repeats: slot.repeats,
        tileHeightMm: slot.tileHeightMm,
        weightAt: (z) => detailWeights(detail, z, layers.layerHeightMm)[key],
      });
    }
    const { step, curvature } = measureWall(
      { heightMm: form.height, radiusAt: createProfile(form.profile).at, twistDeg: form.twist.degrees, slots },
      layers,
    );
    const limits = wallLimits({ ...layers, ...design.rules });
    assert.ok(step.mm <= limits.stepMm, `step ${step.mm.toFixed(2)} mm per layer at ${step.atMm} mm`);
    assert.ok(curvature.perMm <= limits.curvaturePerMm, `curvature ${curvature.perMm.toFixed(3)} per mm at ${curvature.atMm} mm`);
  });
}

test('blend weights follow the design rules', () => {
  const detail = {
    fromMm: 10, toMm: 110,
    a: { depthMm: 2 }, b: { depthMm: 1 },
    blend: { shape: 'fadesUp', amount: 1 },
  };
  assert.deepEqual(detailWeights(detail, 5, 1.5), { a: 0, b: 0 });
  const mid = detailWeights(detail, 60, 1.5);
  assert.ok(Math.abs(mid.a - 0.5) < 1e-12 && Math.abs(mid.b - 0.5) < 1e-12);
  // The soft start is 3 × the deepest depth (6 mm) here, longer than two layers.
  assert.ok(detailWeights(detail, 15, 1.5).a > 0 && detailWeights(detail, 15, 1.5).a + detailWeights(detail, 15, 1.5).b < 1);
  assert.equal(detailWeights(detail, 16, 1.5).a + detailWeights(detail, 16, 1.5).b, 1);
  const off = detailWeights({ ...detail, b: null }, 60, 1.5);
  assert.deepEqual(off, { a: 1, b: 0 });
  const even = detailWeights({ ...detail, blend: { shape: 'even', amount: 0.5 } }, 60, 1.5);
  assert.deepEqual(even, { a: 0.5, b: 0.5 });
});
