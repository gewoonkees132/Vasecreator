import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan } from '../core/plan.js';

const plans = {
  circle: { footprint: 'circle', depthRatio: 1, cornerRounding: 0 },
  ellipse: { footprint: 'circle', depthRatio: 0.6, cornerRounding: 0 },
  'rounded rectangle': { footprint: 'rectangle', depthRatio: 0.75, cornerRounding: 0.3 },
  'sharp rectangle': { footprint: 'rectangle', depthRatio: 1, cornerRounding: 0 },
};

const point = (plan, u, a, b, delta = 0) => {
  const out = new Float64Array(2);
  plan.point(u, a, b, delta, out);
  return [out[0], out[1]];
};

for (const [name, spec] of Object.entries(plans)) {
  const plan = createPlan(spec);
  const a = 50;
  const b = 50 * spec.depthRatio;

  test(`${name}: starts on the +X axis and closes`, () => {
    const [x0, y0] = point(plan, 0, a, b);
    assert.ok(Math.abs(x0 - a) < 1e-9 && Math.abs(y0) < 1e-9);
    const [x1, y1] = point(plan, 1 - 1e-12, a, b);
    assert.ok(Math.hypot(x1 - x0, y1 - y0) < 1e-6);
  });

  test(`${name}: points are evenly spaced by arc length, counter-clockwise`, () => {
    const n = 400;
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(point(plan, i / n, a, b));
    let total = 0;
    const steps = [];
    for (let i = 1; i <= n; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      steps.push(d);
      total += d;
      const cross = pts[i - 1][0] * pts[i][1] - pts[i - 1][1] * pts[i][0];
      assert.ok(cross > 0, 'counter-clockwise');
    }
    const perimeter = plan.perimeter(a, b, 0);
    assert.ok(Math.abs(total - perimeter) / perimeter < 1e-3, `chords ${total} vs perimeter ${perimeter}`);
    const mean = total / n;
    // Chords are shorter than arcs on curved parts, so allow a little.
    for (const d of steps) assert.ok(Math.abs(d - mean) / mean < 0.01, `step ${d} vs mean ${mean}`);
  });

  test(`${name}: uAtAngle finds the point at a polar angle`, () => {
    for (const deg of [0, 30, 90, 135, 200, 300, 359]) {
      const u = plan.uAtAngle((deg * Math.PI) / 180);
      const [x, y] = point(plan, u, a, b);
      let angle = (Math.atan2(y, x) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      assert.ok(Math.abs(angle - deg) < 1e-6, `${deg}° → ${angle}°`);
    }
  });

  test(`${name}: inward offsets shrink the outline by the offset`, () => {
    const delta = 5;
    const [x0] = point(plan, 0, a, b, delta);
    assert.ok(Math.abs(x0 - (a - delta)) < 1e-9);
    assert.ok(plan.perimeter(a, b, delta) < plan.perimeter(a, b, 0));
    assert.ok(plan.perimeter(a, b, -delta) > plan.perimeter(a, b, 0));
  });
}

test('the unit outline scales with the radius', () => {
  const plan = createPlan(plans['rounded rectangle']);
  const unit = new Float64Array(2);
  plan.unitPoint(0.17, unit);
  const [x, y] = point(plan, 0.17, 40, 30);
  assert.ok(Math.abs(unit[0] * 40 - x) < 1e-9 && Math.abs(unit[1] * 40 - y) < 1e-9);
  assert.ok(Math.abs(plan.unitPerimeter * 40 - plan.perimeter(40, 30, 0)) < 1e-9);
});

test('rectangle corners sit at the middle of each rounded corner', () => {
  const plan = createPlan({ footprint: 'rectangle', depthRatio: 1, cornerRounding: 0.5 });
  const angles = plan.cornerUs.map((u) => Math.round((plan.angleAt(u) * 180) / Math.PI));
  assert.deepEqual(angles, [45, 135, 225, 315]);
});
