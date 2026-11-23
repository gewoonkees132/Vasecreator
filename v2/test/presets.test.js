import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findPattern } from '../core/patterns.js';
import { BLEND_SHAPES, surfaceWeights } from '../core/surface.js';
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
  const { form, surface, layers, base, finish } = design;

  test(`${design.meta.name} is a well-formed design`, () => {
    assert.equal(design.schema, 'vasecreator/design');
    assert.equal(design.version, 2);
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

    assert.ok(surface.fromMm >= 0 && surface.fromMm < surface.toMm && surface.toMm <= form.height);
    for (const slot of [surface.a, surface.b].filter(Boolean)) {
      findPattern(library, slot.pattern);
      assert.ok(Number.isInteger(slot.repeats) && slot.repeats >= 1);
      assert.ok(slot.depthMm >= 0 && slot.tileHeightMm > 0);
      if (form.plan.footprint === 'rectangle') {
        assert.equal(slot.repeats % 4, 0, 'same pattern on every side of a rectangle');
      }
    }
    assert.ok(BLEND_SHAPES.includes(surface.blend.shape));
    assert.ok(surface.blend.amount >= 0 && surface.blend.amount <= 1);

    assert.ok(['fixed', 'followTwist', 'hidden'].includes(layers.seam.position));
    assert.ok(layers.layerHeightMm >= 0.3 * layers.beadWidthMm && layers.layerHeightMm <= 0.6 * layers.beadWidthMm);
    assert.equal(base.pattern, 'spiral');
    assert.ok(base.hole.diameter === 0 || base.hole.diameter >= 2 * layers.beadWidthMm);
    assert.ok([1, 2].includes(finish.walls));
    assert.ok(['smooth', 'followPattern'].includes(finish.innerWall));
  });

  test(`${design.meta.name} prints within the limits`, () => {
    const slots = [];
    for (const [key, slot] of [['a', surface.a], ['b', surface.b]]) {
      if (!slot) continue;
      slots.push({
        recipe: findPattern(library, slot.pattern).recipe,
        depthMm: slot.depthMm,
        repeats: slot.repeats,
        tileHeightMm: slot.tileHeightMm,
        weightAt: (z) => surfaceWeights(surface, z, layers.layerHeightMm)[key],
      });
    }
    const { step, curvature } = measureWall(
      { heightMm: form.height, radiusAt: createProfile(form.profile).at, twistDeg: form.twist.degrees, slots },
      layers,
    );
    const limits = wallLimits(layers);
    assert.ok(step.mm <= limits.stepMm, `step ${step.mm.toFixed(2)} mm per layer at ${step.atMm} mm`);
    assert.ok(curvature.perMm <= limits.curvaturePerMm, `curvature ${curvature.perMm.toFixed(3)} per mm at ${curvature.atMm} mm`);
  });
}

test('blend weights follow the design rules', () => {
  const surface = {
    fromMm: 10, toMm: 110,
    a: { depthMm: 2 }, b: { depthMm: 1 },
    blend: { shape: 'fadesUp', amount: 1 },
  };
  assert.deepEqual(surfaceWeights(surface, 5, 1.5), { a: 0, b: 0 });
  const mid = surfaceWeights(surface, 60, 1.5);
  assert.ok(Math.abs(mid.a - 0.5) < 1e-12 && Math.abs(mid.b - 0.5) < 1e-12);
  // The soft start is 3 × the deepest depth (6 mm) here, longer than two layers.
  assert.ok(surfaceWeights(surface, 15, 1.5).a > 0 && surfaceWeights(surface, 15, 1.5).a + surfaceWeights(surface, 15, 1.5).b < 1);
  assert.equal(surfaceWeights(surface, 16, 1.5).a + surfaceWeights(surface, 16, 1.5).b, 1);
  const off = surfaceWeights({ ...surface, b: null }, 60, 1.5);
  assert.deepEqual(off, { a: 1, b: 0 });
  const even = surfaceWeights({ ...surface, blend: { shape: 'even', amount: 0.5 } }, 60, 1.5);
  assert.deepEqual(even, { a: 0.5, b: 0.5 });
});
