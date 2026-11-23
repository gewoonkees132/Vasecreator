import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, profileLine } from '../core/profile.js';
import { presets } from './support/fixtures.js';

const knots = [
  { z: 0, r: 40 },
  { z: 30, r: 60 },
  { z: 70, r: 35 },
  { z: 90, r: 35 },
  { z: 130, r: 50 },
];

for (const interp of ['catmullRomCentripetal', 'monotone', 'linear']) {
  test(`${interp} passes through every knot`, () => {
    const curve = createProfile({ interp, tension: 0.5, cornerMm: 0, knots });
    for (const k of knots) assert.ok(Math.abs(curve.at(k.z) - k.r) < 1e-9, `${interp} at z ${k.z}`);
  });

  test(`${interp} is continuous`, () => {
    const curve = createProfile({ interp, tension: 0.5, cornerMm: 8, knots });
    for (let z = 0; z < 130; z += 0.01) {
      assert.ok(Math.abs(curve.at(z + 0.01) - curve.at(z)) < 0.05, `jump at z ${z.toFixed(2)}`);
    }
  });
}

test('the curve clamps outside its height', () => {
  const curve = createProfile({ interp: 'catmullRomCentripetal', tension: 0.5, knots });
  assert.equal(curve.at(-5), curve.at(0));
  assert.equal(curve.at(500), curve.at(130));
});

test('two smooth knots make a straight line', () => {
  const curve = createProfile({ interp: 'catmullRomCentripetal', tension: 0.5, knots: [{ z: 0, r: 40 }, { z: 100, r: 60 }] });
  for (let z = 0; z <= 100; z += 5) assert.ok(Math.abs(curve.at(z) - (40 + z / 5)) < 1e-9);
});

test('tension 0 flattens the curve at interior knots', () => {
  const curve = createProfile({ interp: 'catmullRomCentripetal', tension: 0, knots });
  const right = (curve.at(30.0001) - curve.at(30)) / 0.0001;
  const left = (curve.at(30) - curve.at(29.9999)) / 0.0001;
  assert.ok(Math.abs(right) < 1e-3 && Math.abs(left) < 1e-3);
});

test('the angular corner is a tangent-continuous circular arc', () => {
  const corner = 10;
  const p = { interp: 'linear', tension: 0.5, cornerMm: corner, knots: [{ z: 0, r: 40 }, { z: 50, r: 70 }, { z: 100, r: 40 }] };
  const curve = createProfile(p);
  // The corner is cut: the curve passes inside the knot.
  assert.ok(curve.at(50) < 70 - 1);
  // Slope never jumps: first differences change smoothly through the fillet.
  const dz = 0.001;
  let previous = (curve.at(dz) - curve.at(0)) / dz;
  for (let z = dz; z < 100 - dz; z += dz) {
    const slope = (curve.at(z + dz) - curve.at(z)) / dz;
    assert.ok(Math.abs(slope - previous) < 0.01, `slope jumps at z ${z.toFixed(3)}`);
    previous = slope;
  }
  // Away from the corner the segments are exact straight lines.
  assert.ok(Math.abs(curve.at(10) - 46) < 1e-9);
  assert.ok(Math.abs(curve.at(90) - 46) < 1e-9);
  // Curvature inside the fillet matches the radius: fit a circle to three points.
  const [z0, z1, z2] = [49, 50, 51];
  const a = [z0, curve.at(z0)];
  const b = [z1, curve.at(z1)];
  const c = [z2, curve.at(z2)];
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  assert.ok(Math.abs((ab * bc * ca) / (2 * area2) - corner) < 0.01);
});

test("a knot's own corner overrides the profile corner, and big corners stay inside half a segment", () => {
  const base = { interp: 'linear', tension: 0.5, cornerMm: 0, knots: [{ z: 0, r: 40 }, { z: 20, r: 60, corner: 500 }, { z: 40, r: 40 }] };
  const curve = createProfile(base);
  // The tangent points are clamped to the middle of each segment.
  assert.ok(Math.abs(curve.at(10) - 50) < 1e-6);
  assert.ok(Math.abs(curve.at(30) - 50) < 1e-6);
  assert.ok(curve.at(20) < 60 - 1);
  const sharp = createProfile({ ...base, knots: base.knots.map(({ corner, ...k }) => k) });
  assert.equal(sharp.at(20), 60);
});

test('monotone never overshoots its knots', () => {
  const steps = [{ z: 0, r: 40 }, { z: 20, r: 40 }, { z: 25, r: 80 }, { z: 60, r: 80 }, { z: 61.5, r: 50 }, { z: 100, r: 52 }];
  const curve = createProfile({ interp: 'monotone', tension: 0.5, knots: steps });
  for (let i = 0; i < steps.length - 1; i++) {
    const lo = Math.min(steps[i].r, steps[i + 1].r);
    const hi = Math.max(steps[i].r, steps[i + 1].r);
    for (let z = steps[i].z; z <= steps[i + 1].z; z += 0.05) {
      const r = curve.at(z);
      assert.ok(r >= lo - 1e-9 && r <= hi + 1e-9, `r ${r} outside [${lo}, ${hi}] at z ${z}`);
    }
  }
});

test('profileLine has a pair about every millimetre and one at every knot', () => {
  const profile = presets[0].form.profile;
  const line = profileLine(profile);
  assert.ok(line instanceof Float32Array);
  const zs = [];
  for (let i = 1; i < line.length; i += 2) zs.push(line[i]);
  assert.equal(zs[0], 0);
  assert.equal(zs.at(-1), 170);
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i] > zs[i - 1] && zs[i] - zs[i - 1] <= 1 + 1e-6);
  for (const k of profile.knots) assert.ok(zs.includes(k.z), `knot at ${k.z}`);
  assert.ok(Math.abs(line[0] - 42) < 1e-5);
});
