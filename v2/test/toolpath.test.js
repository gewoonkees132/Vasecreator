import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDesign } from '../core/design.js';
import { KIND, RAMP_IN_LAYERS, buildToolpath, patternFeatures } from '../core/toolpath.js';
import { cylinder, distance, library, presets } from './support/fixtures.js';

const build = (d, walls = 1) => {
  const design = normaliseDesign(d);
  return { design, tp: buildToolpath(design, library, { walls }) };
};

const variants = [
  ...presets.map((p) => [p.meta.name, p]),
  ['plain cylinder', cylinder()],
  ['sleeve', cylinder({ baseLayers: 0 })],
  ['one base layer', cylinder({ baseLayers: 1 })],
  ['four base layers with a hole', { ...cylinder({ baseLayers: 4 }), base: { layers: 4, pattern: 'spiral', spacingRatio: 0.9, outline: true, hole: { diameter: 20 } } }],
  ['two walls', { ...presets[0], finish: { walls: 2, wallSpacingMm: 2.7, innerWall: 'smooth' } }, 2],
  ['two walls following the pattern', { ...presets[2], finish: { walls: 2, wallSpacingMm: 2.7, innerWall: 'followPattern' } }, 2],
];

for (const [name, d, walls = 1] of variants) {
  test(`${name}: layer count, z never decreases, beads never jump`, () => {
    const { design, tp } = build(d, walls);
    const h = design.layers.layerHeightMm;
    const w = design.layers.beadWidthMm;
    const L = Math.round(design.form.height / h);
    assert.equal(tp.layerStarts.length, L + 1);
    assert.equal(tp.layerZ.length, L);
    assert.ok(Math.abs(tp.layerZ[L - 1] - L * h) < 1e-9);
    assert.equal(tp.kinds[0], KIND.none, 'the path starts with no bead');
    for (let p = 0; p < tp.pointCount; p++) {
      for (let a = 0; a < 3; a++) assert.ok(Number.isFinite(tp.path[3 * p + a]));
    }
    for (let p = 1; p < tp.pointCount; p++) {
      assert.ok(tp.path[3 * p + 2] >= tp.path[3 * p - 1] - 1e-12, `z drops at point ${p}`);
      if (tp.kinds[p] !== KIND.none) {
        const d = distance(tp.path, p, p - 1);
        assert.ok(d <= 2 * w, `bead ${p} (kind ${tp.kinds[p]}) jumps ${d.toFixed(2)} mm`);
      }
    }
    for (let k = 0; k < L; k++) {
      for (let p = tp.layerStarts[k]; p < tp.layerStarts[k + 1]; p++) {
        assert.equal(tp.layerOf[p], k);
        const z = tp.path[3 * p + 2];
        assert.ok(z <= tp.layerZ[k] + 1e-9 && z >= tp.layerZ[k] - h - 1e-9);
      }
    }
  });
}

test('wall layers start at their seam one layer down and climb over the ramp', () => {
  const d = cylinder({ height: 30, radius: 40, baseLayers: 2 });
  const { design, tp } = build(d);
  const h = design.layers.layerHeightMm;
  const ramp = design.layers.seam.rampLengthMm;
  for (let i = 2; i < tp.layerZ.length; i++) {
    const first = tp.layerStarts[i];
    const last = tp.layerStarts[i + 1] - 1;
    const zStart = tp.layerZ[i - 1];
    const zTop = tp.layerZ[i];
    // Over the flat base the ramp grows a quarter layer per layer; the rest is a step up.
    const rise = h * Math.min((i - 1) / RAMP_IN_LAYERS, 1);
    // The previous layer ends where this one starts (same point, so it is not repeated).
    assert.ok(Math.abs(tp.path[3 * (first - 1) + 2] - zStart) < 1e-12);
    // Climbs linearly over the ramp length, then stays at the top.
    let along = 0;
    for (let p = first; p <= last; p++) {
      along += Math.hypot(tp.path[3 * p] - tp.path[3 * p - 3], tp.path[3 * p + 1] - tp.path[3 * p - 2]);
      const z = tp.path[3 * p + 2];
      if (along > ramp + 0.5) assert.equal(z, zTop);
      else assert.ok(Math.abs(z - (zTop - rise + (rise * Math.min(along, ramp)) / ramp)) < 0.02, `layer ${i}: z ${z} at ${along} mm`);
    }
    assert.equal(tp.path[3 * last + 2], zTop);
    // The loop is closed: it ends on its seam, above where it started.
    assert.ok(Math.hypot(tp.path[3 * last] - tp.path[3 * (first - 1)], tp.path[3 * last + 1] - tp.path[3 * (first - 1) + 1]) < 1e-9);
  }
});

// Height of each outer bead (wall or base ring) above the outer bead it sits
// on: the highest outer point of the two layers below within a third of a
// bead width. Beads within a bead width of their layer's start are skipped:
// there the end of the layer below lies beside the bead, not under it.
function outerGaps(tp, w) {
  const gaps = [];
  const L = tp.layerStarts.length - 1;
  for (let k = 1; k < L; k++) {
    const first = tp.layerStarts[k];
    const sx = tp.path[3 * first];
    const sy = tp.path[3 * first + 1];
    for (let p = first; p < tp.layerStarts[k + 1]; p += 3) {
      if (tp.kinds[p] !== KIND.outer) continue;
      const x = tp.path[3 * p];
      const y = tp.path[3 * p + 1];
      if (Math.hypot(x - sx, y - sy) < w) continue;
      let support = -Infinity;
      for (let q = tp.layerStarts[Math.max(k - 2, 0)]; q < first; q++) {
        if (tp.kinds[q] !== KIND.outer) continue;
        if (Math.hypot(tp.path[3 * q] - x, tp.path[3 * q + 1] - y) < w / 3) support = Math.max(support, tp.path[3 * q + 2]);
      }
      if (support > -Infinity) gaps.push({ gap: tp.path[3 * p + 2] - support, layer: k, p });
    }
  }
  return gaps;
}

const gapCases = [
  ['three base layers', cylinder({ baseLayers: 3 })],
  ['a sleeve', cylinder({ baseLayers: 0 })],
  ['the Classic vase (hidden seam moving back)', presets[0]],
  ['a fixed seam on a full twist', twistedFixed(360)],
  ['a fixed seam twisting the other way', twistedFixed(-360)],
];
// A plain cylinder, so the wall below is where the bead is; only the seam moves.
function twistedFixed(degrees) {
  const d = cylinder({ height: 60, radius: 40 });
  d.form.twist.degrees = degrees;
  d.layers.seam = { rampLengthMm: 15, position: 'fixed', angleDeg: 30 };
  return d;
}
for (const [name, d] of gapCases) {
  test(`${name}: every outer bead sits about one layer height on the bead below`, () => {
    const { design, tp } = build(d);
    const h = design.layers.layerHeightMm;
    const gaps = outerGaps(tp, design.layers.beadWidthMm);
    assert.ok(gaps.length > 100);
    for (const { gap, layer, p } of gaps) {
      assert.ok(gap > (1 - 1 / RAMP_IN_LAYERS) * h - 0.05 && gap < 1.25 * h, `layer ${layer}, point ${p}: ${(gap / h).toFixed(2)} h`);
    }
  });
}

test('an outward base layer starts right above where the inward one ended, on an ellipse too', () => {
  const d = structuredClone(presets[0]);
  d.form.plan.depthRatio = 0.6;
  const { design, tp } = build(d);
  for (let k = 1; k < design.base.layers; k++) {
    const first = tp.layerStarts[k];
    if (tp.kinds[first] !== KIND.none) continue; // inward layers start on the ring
    const step = Math.hypot(tp.path[3 * first] - tp.path[3 * first - 3], tp.path[3 * first + 1] - tp.path[3 * first - 2]);
    assert.ok(step < design.layers.beadWidthMm, `layer ${k} starts ${step.toFixed(1)} mm away`);
  }
});

test('a sleeve starts flat on the bed', () => {
  const { design, tp } = build(cylinder({ baseLayers: 0 }));
  const h = design.layers.layerHeightMm;
  for (let p = tp.layerStarts[0]; p < tp.layerStarts[1]; p++) assert.equal(tp.path[3 * p + 2], h);
  assert.ok(tp.kinds.every((k) => k !== KIND.base));
});

for (const layers of [1, 2, 3, 4]) {
  test(`${layers} base layers: the last ends at the seam on the ring, and directions alternate`, () => {
    const { design, tp } = build(cylinder({ baseLayers: layers, radius: 35 }));
    const h = design.layers.layerHeightMm;
    const end = tp.layerStarts[layers] - 1;
    assert.equal(tp.kinds[end], KIND.outer);
    assert.equal(tp.path[3 * end + 2], layers * h);
    // The seam of the first wall layer is where the base ended.
    const seam = tp.seamLine;
    assert.ok(Math.hypot(seam[0] - tp.path[3 * end], seam[1] - tp.path[3 * end + 1]) < 1e-6);
    assert.ok(Math.abs(Math.hypot(tp.path[3 * end], tp.path[3 * end + 1]) - 35) < 1e-6, 'on the ring');
    for (let k = 0; k < layers; k++) {
      const first = tp.layerStarts[k];
      const last = tp.layerStarts[k + 1] - 1;
      const outward = (layers - 1 - k) % 2 === 0;
      const r = (p) => Math.hypot(tp.path[3 * p], tp.path[3 * p + 1]);
      if (outward) {
        assert.equal(tp.kinds[first], KIND.none, 'outward layers start at the centre with a step up');
        assert.ok(r(first) < 3, `starts near the centre (${r(first)})`);
        assert.equal(tp.kinds[last], KIND.outer);
      } else {
        assert.ok(Math.abs(r(first) - 35) < 1e-6, 'inward layers start on the ring');
        assert.equal(tp.kinds[last], KIND.base);
        assert.ok(r(last) < 3, `ends near the centre (${r(last)})`);
      }
    }
  });
}

test('a hole stops the base spiral short of the hole', () => {
  const d = cylinder({ baseLayers: 1, radius: 40 });
  d.base.hole.diameter = 20;
  const { design, tp } = build(d);
  const w = design.layers.beadWidthMm;
  let innermost = Infinity;
  for (let p = 0; p < tp.layerStarts[1]; p++) innermost = Math.min(innermost, Math.hypot(tp.path[3 * p], tp.path[3 * p + 1]));
  assert.ok(innermost >= 10 + w / 2 - 1e-6 && innermost < 10 + w / 2 + 3, `innermost bead at ${innermost}`);
});

test('two walls: outer, connector in, inner flat at the top, connector out', () => {
  const d = { ...presets[1], finish: { walls: 2, wallSpacingMm: 2.7, innerWall: 'smooth' } };
  const { design, tp } = build(d, 2);
  const i = 40;
  const first = tp.layerStarts[i];
  const last = tp.layerStarts[i + 1];
  const kinds = Array.from(tp.kinds.subarray(first, last));
  assert.equal(kinds[0], KIND.connector, 'connector out from the inner wall below');
  const inStart = kinds.indexOf(KIND.connector, 1);
  assert.ok(kinds.slice(1, inStart).every((k) => k === KIND.outer));
  assert.ok(kinds.slice(inStart + 1).every((k) => k === KIND.inner));
  for (let p = first + inStart; p < last; p++) assert.equal(tp.path[3 * p + 2], tp.layerZ[i]);
  // Smooth inner wall: the same offset all round, inside the outer wall everywhere.
  const radii = [];
  for (let p = first + inStart + 1; p < last; p++) radii.push(Math.hypot(tp.path[3 * p], tp.path[3 * p + 1]));
  const spread = Math.max(...radii) - Math.min(...radii);
  assert.ok(spread < 0.05, `inner wall radius varies ${spread}`);
  assert.ok(tp.maxGapMm > 2.5 && tp.maxGapMm <= 3 + 1e-9);
  assert.equal(design.finish.walls, 2);
});

test('the seam follows the chosen rule', () => {
  const twisted = (position) => {
    const d = cylinder({ height: 60, radius: 40 });
    d.form.twist.degrees = 90;
    d.layers.seam = { rampLengthMm: 15, position, angleDeg: 90 };
    return build(d).tp;
  };
  const angle = (tp, i) => (Math.atan2(tp.seamLine[3 * i + 1], tp.seamLine[3 * i]) * 180) / Math.PI;
  const fixed = twisted('fixed');
  for (let i = 0; i < fixed.seamLine.length / 3; i++) assert.ok(Math.abs(angle(fixed, i) - 90) < 1e-6);
  const follow = twisted('followTwist');
  const n = follow.seamLine.length / 3;
  assert.ok(angle(follow, n - 1) - angle(follow, 0) > 80, 'turns with the twist');
});

test('a hidden seam sits in a flute groove', () => {
  const { design, tp } = build(presets[0]);
  const i = 30; // well inside the fluted belly
  const x = tp.seamLine[3 * i];
  const y = tp.seamLine[3 * i + 1];
  const z = tp.seamLine[3 * i + 2];
  const repeats = design.surface.a.repeats;
  const u = Math.atan2(y, x) / (2 * Math.PI);
  // Flutes are cos(2π·repeats·u): a groove is where that is −1.
  assert.ok(Math.cos(2 * Math.PI * repeats * u) < -0.99, `seam at u ${u}, z ${z}`);
});

test('a hidden seam on a rectangle sits in a corner', () => {
  const { tp } = build(presets[2]);
  for (let i = 0; i < tp.seamLine.length / 3; i++) {
    const a = (Math.atan2(tp.seamLine[3 * i + 1], tp.seamLine[3 * i]) * 180) / Math.PI;
    assert.ok(Math.abs(a - 45) < 0.5, `seam angle ${a}`);
  }
});

test('a typical pot is about 30 k points', () => {
  const { tp } = build(presets[0]);
  assert.ok(tp.pointCount > 15000 && tp.pointCount < 45000, `${tp.pointCount} points`);
});

test('patterns follow the twist', () => {
  // Same pattern, with and without twist: the radius at a given outline
  // position u is the same; only the angle moves.
  const plainTwist = (deg) => {
    const d = structuredClone(presets[1]);
    d.form.twist.degrees = deg;
    d.layers.seam.position = 'followTwist';
    return build(d).tp;
  };
  const a = plainTwist(0);
  const b = plainTwist(60);
  assert.equal(a.pointCount, b.pointCount);
  for (let p = 0; p < a.pointCount; p += 97) {
    const ra = Math.hypot(a.path[3 * p], a.path[3 * p + 1]);
    const rb = Math.hypot(b.path[3 * p], b.path[3 * p + 1]);
    assert.ok(Math.abs(ra - rb) < 1e-9);
  }
});

test('pattern features drive the points per layer', () => {
  assert.deepEqual(patternFeatures({ kind: 'shape', shape: 'flutes' }), { around: 1, up: 0 });
  assert.deepEqual(patternFeatures({ kind: 'motif', cells: [1, -1, 1], layout: 'brick' }), { around: 3, up: 2 });
  const d = cylinder({ radius: 30, height: 30 });
  d.surface.a = { pattern: 'lib:flutes@1', depthMm: 0.5, repeats: 60, tileHeightMm: 20 };
  const { tp } = build(d);
  const i = 15;
  assert.ok(tp.layerStarts[i + 1] - tp.layerStarts[i] >= 8 * 60);
});
