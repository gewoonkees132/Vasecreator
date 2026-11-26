import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESIGN_VERSION } from '../core/design.js';
import { createProfile } from '../core/profile.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const { presets } = read('../library/presets.json');

test('there are three presets with distinct ids and names', () => {
  assert.equal(presets.length, 3);
  assert.equal(new Set(presets.map((p) => p.meta.id)).size, 3);
  assert.equal(new Set(presets.map((p) => p.meta.name)).size, 3);
});

for (const design of presets) {
  const { form, layers, base, finish } = design;

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

    // A preset is a plain shape: no Detailed morph (D63) and no Pattern (D30).
    assert.equal(form.detail, undefined);
    assert.equal(design.pattern, undefined);

    assert.ok(['fixed', 'followTwist', 'hidden'].includes(layers.seam.position));
    assert.ok(layers.layerHeightMm >= 0.3 * layers.beadWidthMm && layers.layerHeightMm <= 0.65 * layers.beadWidthMm);
    assert.equal(base.pattern, 'spiral');
    assert.ok(base.hole.diameter === 0 || base.hole.diameter >= 2 * layers.beadWidthMm);
    assert.ok([1, 2].includes(finish.walls));
    assert.ok(['smooth', 'followPattern'].includes(finish.innerWall));
  });

}
