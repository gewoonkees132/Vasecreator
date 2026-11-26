import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESIGN_SCHEMA, DESIGN_VERSION, LIMITS, MAX_KNOTS, cloneDesign, defaultDesign, deleteKnot, designsEqual,
  insertKnot, looksLikeDesign, moveKnot, normaliseDesign, setDepth, setHeight, setWidth, widestRadius,
} from '../core/design.js';
import { presets } from './support/fixtures.js';

test('the default design is the Classic vase preset, named Design 1', () => {
  const d = defaultDesign();
  assert.equal(d.meta.name, 'Design 1');
  assert.equal(d.schema, DESIGN_SCHEMA);
  assert.equal(d.version, DESIGN_VERSION);
  const preset = normaliseDesign(presets[0]);
  assert.ok(designsEqual(d, preset));
  assert.equal(d.form.profile.cornerMm, 0);
  assert.notEqual(defaultDesign(), defaultDesign());
});

test('normalising a preset keeps it as it is', () => {
  for (const p of presets) {
    const n = normaliseDesign(p);
    assert.ok(designsEqual(n, { ...p, form: { ...p.form, profile: { ...p.form.profile, cornerMm: 0 } } }), p.meta.name);
    assert.deepEqual(n.meta, p.meta);
    assert.ok(designsEqual(normaliseDesign(n), n), 'idempotent');
  }
});

test('normalise fills missing fields and never throws on them', () => {
  const n = normaliseDesign({});
  assert.equal(n.form.height, 170);
  assert.equal(n.form.profile.knots.length, 4);
  assert.equal(n.form.detail.b, null);
  assert.equal(n.base.pattern, 'spiral');
  for (const broken of [{ form: null }, { form: { profile: { knots: 'x' } } }, { layers: { seam: 4 } }, { form: { detail: { a: 7 } } }, { pattern: { drawing: 5 } }, { rules: 'x' }]) {
    assert.doesNotThrow(() => normaliseDesign(broken));
  }
});

test('normalise clamps, sorts and spaces the knots', () => {
  const n = normaliseDesign({
    form: {
      height: 100,
      profile: { interp: 'nope', knots: [{ z: 100, r: 50 }, { z: 0, r: 1 }, { z: 50, r: 60 }, { z: 50.5, r: 61 }, { z: 99.9, r: 40 }] },
      detail: { fromMm: 120, toMm: -5, a: { pattern: 'lib:flutes@1', repeats: 7.6, depthMm: 99 } },
    },
    layers: { beadWidthMm: 3, layerHeightMm: 1.5, seam: { angleDeg: -90 } },
    finish: { walls: 3 },
  });
  assert.deepEqual(n.form.profile.knots.map((k) => k.z), [0, 50, 100]);
  assert.equal(n.form.profile.knots[0].r, 6, 'radius at least two beads');
  assert.equal(n.form.profile.interp, 'catmullRomCentripetal');
  assert.equal(n.layers.seam.angleDeg, 270);
  assert.equal(n.form.detail.a.repeats, 8);
  assert.equal(n.form.detail.a.depthMm, LIMITS.depthMm.max);
  assert.ok(n.form.detail.fromMm >= 0 && n.form.detail.fromMm < n.form.detail.toMm && n.form.detail.toMm <= 100);
  assert.equal(n.finish.walls, 1);
});

test('normalise fills the warning rules and holds them in their limits', () => {
  assert.deepEqual(normaliseDesign({}).rules, { overhangLimitDeg: 45, supportRatio: 0.7, curveRatio: 0.5, layersPerBump: 2 });
  assert.deepEqual(normaliseDesign({ rules: 'x' }).rules, defaultDesign().rules);
  const low = normaliseDesign({ rules: { overhangLimitDeg: 1, supportRatio: 0, curveRatio: 0, layersPerBump: 0 } }).rules;
  assert.deepEqual(low, { overhangLimitDeg: 5, supportRatio: 0.1, curveRatio: 0.1, layersPerBump: 1 });
  const high = normaliseDesign({ rules: { overhangLimitDeg: 90, supportRatio: 3, curveRatio: 9, layersPerBump: 40 } }).rules;
  assert.deepEqual(high, { overhangLimitDeg: 80, supportRatio: 1, curveRatio: 1.5, layersPerBump: 6 });
  // Layers per bump are whole layers; the other rules keep what was set.
  const set = normaliseDesign({ rules: { overhangLimitDeg: 52, supportRatio: 0.35, curveRatio: 0.65, layersPerBump: 2.6 } }).rules;
  assert.deepEqual(set, { overhangLimitDeg: 52, supportRatio: 0.35, curveRatio: 0.65, layersPerBump: 3 });
});

test('the height scales knots that stop short of it', () => {
  const n = normaliseDesign({ form: { height: 200, profile: { knots: [{ z: 0, r: 40 }, { z: 50, r: 60 }, { z: 100, r: 40 }] } } });
  assert.deepEqual(n.form.profile.knots.map((k) => k.z), [0, 100, 200]);
});

test('normalise rejects what is not a design', () => {
  for (const bad of [null, 3, 'design', [], { schema: 'vasecreator/printer' }, { version: 99 }]) {
    assert.throws(() => normaliseDesign(bad), TypeError);
  }
});

test('looksLikeDesign tells a design file from other JSON', () => {
  assert.equal(looksLikeDesign(defaultDesign()), true);
  for (const p of presets) assert.equal(looksLikeDesign(p), true);
  assert.equal(looksLikeDesign({ form: { height: 120 } }), true);  // an older file without a schema
  for (const bad of [null, 3, 'design', [], {}, { hello: 1 }, { schema: 'vasecreator/printer', form: {} }, { form: 3 }]) {
    assert.equal(looksLikeDesign(bad), false);
  }
});

test('designsEqual ignores meta', () => {
  const a = defaultDesign();
  const b = cloneDesign(a);
  b.meta.name = 'Other';
  assert.ok(designsEqual(a, b));
  b.form.twist.degrees = 5;
  assert.ok(!designsEqual(a, b));
});

test('LIMITS give min, max and step for every edited field', () => {
  for (const key of ['height', 'width', 'depth', 'depthRatio', 'cornerRounding', 'twist', 'knotZ', 'knotR', 'tension', 'cornerMm',
    'depthMm', 'repeats', 'tileHeightMm', 'fromMm', 'toMm', 'amount', 'beadWidthMm', 'layerHeightMm', 'overhangLimitDeg',
    'rampLengthMm', 'angleDeg', 'baseLayers', 'spacingRatio', 'holeDiameter', 'wallSpacingMm',
    'patternDepthMm', 'spacingMm', 'points', 'softenCells', 'supportRatio', 'curveRatio', 'layersPerBump']) {
    const l = LIMITS[key];
    assert.ok(l && l.min < l.max && l.step > 0, key);
  }
});

test('moveKnot keeps the profile rules', () => {
  const d = defaultDesign();
  const h = d.layers.layerHeightMm;
  moveKnot(d, 0, { z: 30, r: 50 });
  assert.equal(d.form.profile.knots[0].z, 0, 'the bottom stays at 0');
  assert.equal(d.form.profile.knots[0].r, 50);
  moveKnot(d, 1, { z: 500 });
  assert.equal(d.form.profile.knots[1].z, 128 - h, 'cannot pass the next point');
  moveKnot(d, 1, { z: -5, r: 1 });
  assert.equal(d.form.profile.knots[1].z, h);
  assert.equal(d.form.profile.knots[1].r, 2 * d.layers.beadWidthMm, 'radius stays at two beads');
  moveKnot(d, 3, { z: 140 });
  assert.equal(d.form.height, 140, 'the top point sets the height');
  assert.ok(d.form.detail.toMm <= 140);
  moveKnot(d, 3, { z: 0 });
  assert.equal(d.form.profile.knots[3].z, 128 + h);
});

test('insertKnot and deleteKnot', () => {
  const d = defaultDesign();
  const i = insertKnot(d, { z: 100 });
  assert.equal(i, 2);
  assert.equal(d.form.profile.knots[2].z, 100);
  assert.ok(Math.abs(d.form.profile.knots[2].r - 40) < 10, 'takes the curve radius');
  assert.equal(insertKnot(d, { z: 100.5 }), 3, 'moved clear of its neighbour');
  assert.equal(d.form.profile.knots[3].z, 100 + d.layers.layerHeightMm);
  for (let z = 10; d.form.profile.knots.length < MAX_KNOTS; z += 12) assert.ok(insertKnot(d, { z }) > 0);
  assert.equal(insertKnot(d, { z: 150 }), -1, 'twelve at most');
  assert.equal(deleteKnot(d, 0), false);
  assert.equal(deleteKnot(d, d.form.profile.knots.length - 1), false);
  assert.equal(deleteKnot(d, 1), true);
  const two = normaliseDesign({ form: { height: 100, profile: { knots: [{ z: 0, r: 40 }, { z: 100, r: 40 }] } } });
  assert.equal(deleteKnot(two, 1), false);
});

test('setHeight and setWidth scale in proportion', () => {
  const d = defaultDesign();
  // A 3 mm bead, so half the width stays clear of the two-bead minimum radius.
  d.layers.beadWidthMm = 3;
  setHeight(d, 85);
  assert.deepEqual(d.form.profile.knots.map((k) => k.z), [0, 27.5, 64, 85]);
  assert.equal(d.form.height, 85);
  assert.equal(d.form.detail.fromMm, 5);
  assert.equal(d.form.detail.toMm, 75);
  const w0 = widestRadius(d);
  setWidth(d, w0);
  assert.ok(Math.abs(widestRadius(d) - w0 / 2) < 1e-9);
  assert.ok(Math.abs(d.form.profile.knots[1].r - 31) < 0.5);
  setDepth(d, w0 / 2);
  assert.ok(Math.abs(d.form.plan.depthRatio - 0.5) < 1e-9);
});

test('setHeight stops before knots crowd closer than a layer', () => {
  const d = normaliseDesign({ form: { height: 100, profile: { knots: [{ z: 0, r: 40 }, { z: 3, r: 40 }, { z: 100, r: 40 }] } } });
  setHeight(d, 20);
  const ks = d.form.profile.knots;
  assert.ok(ks[1].z - ks[0].z >= d.layers.layerHeightMm - 1e-9);
});

test('widestRadius uses the curve, not just the knots', () => {
  const d = defaultDesign();
  assert.ok(widestRadius(d) >= 62);
  assert.ok(widestRadius(d) < 64);
});
