// The floor (core/base-infill.js, docs/design/v2-base-infill.md): every
// infill has to cover it, on every footprint, with and without a hole.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDesign } from '../core/design.js';
import { BASE_PATTERNS, basePairs, wholePairs } from '../core/base-infill.js';
import { KIND, buildToolpath } from '../core/toolpath.js';
import { emitGcode } from '../core/engine.js';
import { defaultPrinter, normalisePrinter } from '../core/printer.js';
import { cylinder, library, presets } from './support/fixtures.js';

const build = (raw, pattern, walls = 1) => {
  const design = normaliseDesign({ ...raw, base: { ...raw.base, pattern } });
  return { design, tp: buildToolpath(design, library, { walls }) };
};

const rectangle = (depthRatio, cornerRounding) => ({ footprint: 'rectangle', depthRatio, cornerRounding });
const shaped = (plan, hole = 0, rest = {}) => {
  const d = cylinder({ baseLayers: 4, radius: 40, ...rest });
  if (plan) d.form.plan = plan;
  d.base.hole.diameter = hole;
  return d;
};
const drape = presets.find((p) => p.form.morph);

const floors = [
  ['a round floor', cylinder({ baseLayers: 4 })],
  ['a round floor with a hole', shaped(null, 20)],
  ['an oval floor with a hole', shaped({ footprint: 'circle', depthRatio: 0.6, cornerRounding: 0 }, 12)],
  ['a rounded rectangle', shaped(rectangle(0.7, 0.3))],
  ['a square with a hole', shaped(rectangle(1, 0), 15)],
  ['two walls', shaped(null, 0, { walls: 2 }), 2],
  ['a twisted rounded rectangle', { ...shaped(rectangle(0.8, 0.2)), form: { ...shaped(rectangle(0.8, 0.2)).form, twist: { degrees: 90 } } }],
  ['a small floor', cylinder({ baseLayers: 4, radius: 8 })],
  ['a hole nearly as wide as the floor', shaped(null, 70)],
  ['a morphed outline', { ...structuredClone(drape), base: { ...drape.base, layers: 4 } }],
];

// The furthest any point of base layer k's floor is from a bead of that
// layer, in bead widths. Half a bead means the beads just meet.
function worstGap(design, tp, k) {
  const w = design.layers.beadWidthMm;
  const first = tp.layerStarts[k];
  const last = tp.layerStarts[k + 1];
  const beads = [];
  const ring = [];
  for (let p = first + 1; p < last; p++) {
    if (tp.kinds[p] !== KIND.none) beads.push([tp.path[3 * p - 3], tp.path[3 * p - 2], tp.path[3 * p], tp.path[3 * p + 1]]);
  }
  for (let p = first; p < last; p++) if (tp.kinds[p] === KIND.outer) ring.push([tp.path[3 * p], tp.path[3 * p + 1]]);
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  let reach = 0;
  for (const [x, y] of ring) reach = Math.max(reach, Math.abs(x), Math.abs(y));
  const hole = design.base.hole.diameter / 2;
  const grid = w / 3;
  let worst = 0;
  for (let x = -reach; x <= reach; x += grid) {
    for (let y = -reach; y <= reach; y += grid) {
      if (!inside(x, y) || (hole > 0 && Math.hypot(x, y) < hole + 0.02 * w)) continue;
      let best = Infinity;
      for (const [x0, y0, x1, y1] of beads) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - x0 - t * dx, y - y0 - t * dy));
      }
      worst = Math.max(worst, best);
    }
  }
  return worst / w;
}

for (const pattern of BASE_PATTERNS) {
  for (const [name, raw, walls = 1] of floors) {
    test(`${pattern}: ${name} is covered, flat, and printed without a jump`, () => {
      const { design, tp } = build(raw, pattern, walls);
      const w = design.layers.beadWidthMm;
      const h = design.layers.layerHeightMm;
      const nb = design.base.layers;
      const hole = design.base.hole.diameter / 2;
      for (let k = 0; k < nb; k++) {
        // Beads 0.9 of a bead width apart leave nothing further than 0.45
        // from one; where the path turns a sharp corner or a line ends on
        // the lap beside the ring it is a little more.
        const gap = worstGap(design, tp, k);
        assert.ok(gap < 0.56, `layer ${k}: a spot ${gap.toFixed(2)} bead widths from the nearest bead`);
        for (let p = tp.layerStarts[k]; p < tp.layerStarts[k + 1]; p++) {
          assert.equal(tp.path[3 * p + 2], (k + 1) * h, 'flat at the layer top');
          const x = tp.path[3 * p];
          const y = tp.path[3 * p + 1];
          assert.ok(Number.isFinite(x) && Number.isFinite(y));
          if (hole > 0 && tp.kinds[p] !== KIND.outer && tp.kinds[p] !== KIND.inner) {
            assert.ok(Math.hypot(x, y) >= hole + w / 2 - 1e-6, `layer ${k}: a bead runs into the hole`);
          }
          // Clay can't stop: the only moves without it are the short steps up.
          if (p > 0 && tp.kinds[p] === KIND.none) {
            const jump = Math.hypot(x - tp.path[3 * p - 3], y - tp.path[3 * p - 2]);
            assert.ok(jump < 1.5 * w, `layer ${k}: a jump of ${(jump / w).toFixed(2)} bead widths without clay`);
          }
        }
      }
      // The base ends on the ring, and the wall carries on from there.
      const end = tp.layerStarts[nb] - 1;
      assert.equal(tp.kinds[end], KIND.outer);
      assert.ok(Math.hypot(tp.path[3 * end + 3] - tp.path[3 * end], tp.path[3 * end + 4] - tp.path[3 * end + 1]) < 2 * w);
    });
  }
}

test('the infill is a design setting; anything unknown is the spiral', () => {
  const d = cylinder();
  assert.equal(normaliseDesign(d).base.pattern, 'spiral');
  for (const pattern of BASE_PATTERNS) assert.equal(normaliseDesign({ ...d, base: { ...d.base, pattern } }).base.pattern, pattern);
  assert.equal(normaliseDesign({ ...d, base: { ...d.base, pattern: 'sunburst' } }).base.pattern, 'spiral');
  // Rings went with D77: a design saved with them opens as the spiral.
  assert.equal(normaliseDesign({ ...d, base: { ...d.base, pattern: 'rings' } }).base.pattern, 'spiral');
});

test('base layers come in pairs: an odd count is rounded up, and a low pot keeps whole pairs', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 19, 20].map(basePairs), [0, 2, 2, 4, 4, 20, 20]);
  for (const [asked, got] of [[0, 0], [1, 2], [2, 2], [3, 4], [5, 6], [20, 20], [21, 20]]) {
    const d = cylinder();
    d.base.layers = asked;
    assert.equal(normaliseDesign(d).base.layers, got, `${asked} layers`);
  }
  // Four base layers asked of a pot three layers high: two print.
  assert.equal(wholePairs(4, 3), 2);
  assert.equal(wholePairs(4, 1), 0);
  const low = cylinder({ baseLayers: 4, height: 4.5 });
  assert.equal(build(low, 'spiral').tp.layerStarts.length > 2, true);
});

for (const pattern of BASE_PATTERNS) {
  for (const [name, raw, walls = 1] of floors) {
    test(`${pattern}: ${name}: every pair of layers starts and stops at the seam`, () => {
      const { design, tp } = build(raw, pattern, walls);
      const w = design.layers.beadWidthMm;
      const nb = design.base.layers;
      assert.equal(nb % 2, 0);
      const fixed = design.layers.seam.position === 'fixed' && design.form.twist.degrees === 0;
      for (let k = 0; k < nb; k += 2) {
        const first = tp.layerStarts[k];
        const last = tp.layerStarts[k + 2] - 1;
        // In from the ring at the seam, back out onto the ring at the seam.
        assert.equal(tp.kinds[first + 1], KIND.outer, `pair ${k / 2} starts on the ring`);
        assert.equal(tp.kinds[last], KIND.outer, `pair ${k / 2} ends on the ring`);
        const apart = Math.hypot(tp.path[3 * first] - tp.path[3 * last], tp.path[3 * first + 1] - tp.path[3 * last + 1]);
        // A seam that moves with the twist or hides along the wall moves a little from layer to layer.
        assert.ok(apart < (fixed ? 1e-6 : 2 * w), `pair ${k / 2} ends ${apart.toFixed(3)} mm from where it started`);
        // The first layer of the pair ends where the second one starts: a step up, no travel.
        const mid = tp.layerStarts[k + 1];
        const step = Math.hypot(tp.path[3 * mid] - tp.path[3 * mid - 3], tp.path[3 * mid + 1] - tp.path[3 * mid - 2]);
        // A twist turns the floor between the two layers, so its corners move.
        assert.ok(step < (fixed ? w : 1.5 * w), `pair ${k / 2}: ${step.toFixed(2)} mm between its two layers`);
      }
    });
  }
}

test('the infills are different paths over the same floor', () => {
  const paths = BASE_PATTERNS.map((pattern) => {
    const { tp } = build(cylinder({ baseLayers: 2 }), pattern);
    return Array.from(tp.path.subarray(0, 3 * tp.layerStarts[2])).map((v) => v.toFixed(3)).join(' ');
  });
  assert.equal(new Set(paths).size, BASE_PATTERNS.length);
});

test('a layer does not lie on the grooves of the one below', () => {
  // The spiral: where the tracks cross the +Y axis, the two layers'
  // crossings are half a spacing apart, not on top of each other.
  for (const pattern of ['spiral']) {
    const { design, tp } = build(cylinder({ baseLayers: 2, radius: 40 }), pattern);
    const step = design.base.spacingRatio * design.layers.beadWidthMm;
    const crossings = (k) => {
      const ys = [];
      for (let p = tp.layerStarts[k] + 1; p < tp.layerStarts[k + 1]; p++) {
        if (tp.kinds[p] !== KIND.base || tp.kinds[p - 1] === KIND.outer) continue;
        const x0 = tp.path[3 * p - 3];
        const x1 = tp.path[3 * p];
        const y0 = tp.path[3 * p - 2];
        const y1 = tp.path[3 * p + 1];
        if ((x0 > 0) !== (x1 > 0) && y0 > 0 && y1 > 0) ys.push(y0 + ((y1 - y0) * (0 - x0)) / (x1 - x0));
      }
      return ys;
    };
    const lower = crossings(0);
    const upper = crossings(1);
    // Half-way out, away from the laps beside the ring and round the middle.
    const mid = upper.filter((y) => y > 12 && y < 28);
    assert.ok(mid.length >= 3, pattern);
    for (const y of mid) {
      const nearest = Math.min(...lower.map((v) => Math.abs(v - y)));
      assert.ok(nearest > 0.3 * step, `${pattern}: a track ${nearest.toFixed(2)} mm from the one below`);
    }
  }
});

test('lines cross the layer below at a right angle', () => {
  const { tp } = build(cylinder({ baseLayers: 2, radius: 40 }), 'lines');
  // The direction of the longest straight bead of each layer.
  const longest = (k) => {
    let best = 0;
    let dir = [1, 0];
    for (let p = tp.layerStarts[k] + 1; p < tp.layerStarts[k + 1]; p++) {
      if (tp.kinds[p] !== KIND.base) continue;
      const dx = tp.path[3 * p] - tp.path[3 * p - 3];
      const dy = tp.path[3 * p + 1] - tp.path[3 * p - 2];
      const l = Math.hypot(dx, dy);
      if (l > best) { best = l; dir = [dx / l, dy / l]; }
    }
    return dir;
  };
  const a = longest(0);
  const b = longest(1);
  assert.ok(Math.abs(a[0] * b[0] + a[1] * b[1]) < 1e-6);
});

test('the base flow adds clay to the base infill only', () => {
  const design = cylinder({ baseLayers: 2 });
  const clay = (baseFlow) => {
    const printer = normalisePrinter({ ...defaultPrinter(), extrusion: { ...defaultPrinter().extrusion, baseFlow } });
    const byType = {};
    let type = '';
    for (const line of emitGcode(design, null, printer, { library }).join('').split('\n')) {
      if (line.startsWith(';TYPE:')) type = line.slice(6);
      const e = line.match(/^G1 .*\bE(-?[\d.]+)/);
      if (e) byType[type] = (byType[type] || 0) + Number(e[1]);
    }
    return byType;
  };
  assert.equal(defaultPrinter().extrusion.baseFlow, 1.1);
  const plain = clay(1);
  const more = clay(1.2);
  assert.ok(Math.abs(more.BASE / plain.BASE - 1.2) < 1e-3);
  assert.ok(Math.abs(more['WALL-OUTER'] - plain['WALL-OUTER']) < 1e-3);
  assert.ok(Math.abs(more.SKIRT - plain.SKIRT) < 1e-3);
});
