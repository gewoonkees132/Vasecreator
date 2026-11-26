import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_VERSION, normaliseDesign } from '../core/design.js';
import { createProfile } from '../core/profile.js';
import { isMorphMap } from '../core/morph.js';
import { computePreview, computePrint } from '../core/engine.js';
import { normalisePrinter } from '../core/printer.js';
import { shapeOnly } from '../ui/steps.js';
import { library, presets } from './support/fixtures.js';

const printer = normalisePrinter(null);

// The three the owner confirmed on 2026-11-24 (design §8.3, Q10) come first, in
// their order: the app opens on the first, and defaultDesign() is a copy of it.
// The five after them were added on 2026-11-25 (docs/design/v2-presets.md).
const NAMES = ['Classic vase', 'Twisted column', 'Square planter', 'Bud vase', 'Petal bowl', 'Double gourd', 'Oval flask', 'Drape vase'];

test('there are eight presets with distinct ids and names, the confirmed three first', () => {
  assert.deepEqual(presets.map((p) => p.meta.name), NAMES);
  assert.equal(new Set(presets.map((p) => p.meta.id)).size, NAMES.length);
});

for (const design of presets) {
  const { form, layers, base, finish } = design;

  test(`${design.meta.name} has a stable id, a plain one-line description, and is a shape`, () => {
    const slug = design.meta.name.toLowerCase().replace(/ /g, '-');
    assert.equal(design.meta.id, `preset:${slug}@1`);
    const text = design.meta.description;
    assert.ok(typeof text === 'string' && text.length >= 20 && text.length <= 120 && !text.includes('\n'), 'one line');
    assert.ok(text.endsWith('.'));
    assert.ok(!/clay|slicer|material|layer/i.test(text), 'plain design words (D7, D15)');
    // Presets can't carry images or drawings of their own.
    assert.equal(design.assets, undefined);
    if (form.morph) assert.ok(isMorphMap(form.morph.map), 'a built-in morph map');
  });

  test(`${design.meta.name} previews and prints on the generic gantry without a warning`, () => {
    const shape = shapeOnly(normaliseDesign(design));
    assert.deepEqual(computePreview(shape, { library, printer }).warnings, []);
    const print = computePrint(shape, { library, printer });
    assert.deepEqual(print.checks.map((c) => `${c.id} ${c.severity}`), ['bed ok']);
    assert.equal(print.canExport, true);
  });

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
