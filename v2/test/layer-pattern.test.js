// The Pattern (D35–D43): a bead-scale bitmap, one row per layer, one cell per
// node. Slice 1 of docs/design/v2-pattern-studio.md §11.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDesign, normaliseDesign, setHeight } from '../core/design.js';
import { KIND, MAX_POINTS_PER_LAYER, RAMP_IN_LAYERS, buildToolpath, pointsAround } from '../core/toolpath.js';
import { designChecks } from '../core/checks.js';
import { normalisePrinter } from '../core/printer.js';
import { computePreview } from '../core/engine.js';
import { createProfile } from '../core/profile.js';
import { defaultPatternRange, fadeAt, nodesAround } from '../core/layer-pattern.js';
import { detailWeights } from '../core/surface.js';
import { TILES, cylinder, library, linearDesign, presets, withPattern } from './support/fixtures.js';

const TAU = 2 * Math.PI;
const build = (d, walls = 1) => {
  const design = normaliseDesign(d);
  return { design, tp: buildToolpath(design, library, { walls }) };
};
const warningsOf = (design, tp) => designChecks(tp, design, normalisePrinter(null));

/**
 * The outer wall beads of layer i: their position around (u, from the angle:
 * a circle with no twist), their height and how far they sit off the profile.
 */
function layerPoints(design, tp, i) {
  const profile = createProfile(design.form.profile);
  const out = [];
  for (let p = tp.layerStarts[i]; p < tp.layerStarts[i + 1]; p++) {
    if (tp.kinds[p] !== KIND.outer) continue;
    const x = tp.path[3 * p];
    const y = tp.path[3 * p + 1];
    const z = tp.path[3 * p + 2];
    let u = Math.atan2(y, x) / TAU;
    if (u < 0) u += 1;
    out.push({ u, z, off: Math.hypot(x, y) - profile.at(z) });
  }
  return out;
}

/** Checks a layer against a zigzag of ±depth: exact at every node, straight between. */
function assertZigzag(points, N, depth, label) {
  const nodes = new Set();
  for (const { u, off } of points) {
    const x = u * N;
    const j = Math.round(x);
    if (Math.abs(x - j) < 1e-6) {
      const node = j % N;
      nodes.add(node);
      assert.ok(Math.abs(off - (node % 2 ? -depth : depth)) < 1e-9, `${label}: node ${node} at ${off}`);
    } else {
      const j0 = Math.floor(x);
      const f = x - j0;
      const a = j0 % 2 ? -depth : depth;
      assert.ok(Math.abs(off - (a + f * (-a - a))) < 1e-9, `${label}: between nodes at u ${u}, ${off}`);
    }
  }
  assert.equal(nodes.size, N, `${label}: every node prints`);
}

test('a 2-column in/out tile prints as an exact zigzag at ± depth, node for node', () => {
  const { design, tp } = build(withPattern(cylinder({ height: 30, radius: 30, baseLayers: 2 })));
  const lp = tp.model.pattern;
  // 2π·30 mm round, 3 mm apart, 2 columns: 31 whole repeats.
  assert.equal(lp.repeats, 31);
  assert.equal(lp.nodes, 62);
  assert.ok(Math.abs(lp.spacingMinMm - (TAU * 30) / 62) < 1e-9);
  // From 6 mm to 24 mm: the layers whose middles lie in between.
  assert.deepEqual([lp.first, lp.last], [4, 15]);
  for (let i = lp.first; i <= lp.last; i++) assertZigzag(layerPoints(design, tp, i), 62, 0.75, `layer ${i}`);
  // Outside the range the wall is plain, and the base never has the Pattern.
  for (const i of [0, 1, 2, 3, 16, 19]) {
    // Layer 16 starts with the step back in from the last row.
    for (const { off } of layerPoints(design, tp, i).slice(i === 16 ? 1 : 0)) assert.ok(Math.abs(off) < 1e-9, `layer ${i}: ${off}`);
  }
});

test('columns line up on a tapered pot, with the same point count on every layer', () => {
  // From above the base and the ramp-in layers, so only the Pattern shapes the counts.
  const d = withPattern(linearDesign([[0, 25], [45, 45]]), TILES.zigzag, { fromMm: 12, toMm: 39 });
  const { design, tp } = build(d);
  const lp = tp.model.pattern;
  // The spacing is measured on the narrowest layer in the range.
  const narrowest = createProfile(design.form.profile).at((lp.first + 1) * design.layers.layerHeightMm);
  assert.equal(lp.repeats, Math.floor((TAU * narrowest) / (2 * 3)));
  const n = tp.model.patternPoints;
  assert.equal(n % lp.nodes, 0, 'every gap gets the same number of extra points');
  // Enough points for the widest layer's bead spacing.
  const widest = createProfile(design.form.profile).at((lp.last + 1) * design.layers.layerHeightMm);
  assert.ok(n >= Math.ceil((TAU * widest) / (design.layers.beadWidthMm / 2)));
  const h = design.layers.layerHeightMm;
  assert.ok(lp.first >= design.base.layers + RAMP_IN_LAYERS);
  for (let i = lp.first; i <= lp.last; i++) {
    assert.equal(pointsAround(tp.model, i * h, (i + 1) * h).n, n, `layer ${i}`);
    // The first layer adds one bead: the step out onto the Pattern at its sharp start.
    assert.equal(tp.layerStarts[i + 1] - tp.layerStarts[i], i === lp.first ? n + 1 : n, `points on layer ${i}`);
    assertZigzag(layerPoints(design, tp, i), lp.nodes, 0.75, `layer ${i}`);
  }
  // Below the range the layers follow the bead spacing as before.
  assert.notEqual(pointsAround(tp.model, 2 * h, 3 * h).n, n);
});

test('one row is one layer, also after the layer height changes', () => {
  for (const layerHeightMm of [1.5, 1.2]) {
    const d = withPattern(cylinder({ height: 30, radius: 30 }), TILES.stack, { depthMm: 0.5 });
    d.layers.layerHeightMm = layerHeightMm;
    const { design, tp } = build(d);
    const lp = tp.model.pattern;
    for (let k = 0; k < 6; k++) {
      const i = lp.first + k;
      const first = layerPoints(design, tp, i).find((pt) => Math.abs(pt.u - 0.5) < 1e-6);
      assert.ok(Math.abs(first.off - [0.5, 0, -0.5][k % 3]) < 1e-9, `h ${layerHeightMm}, row ${k}: ${first.off}`);
    }
  }
});

test('bead support warns over half a bead and not at it; the Pattern is exempt from the overhang rule', () => {
  // Rows of out over in: each layer steps 2 × depth off the one below.
  const at = (depthMm, rules) => {
    const d = withPattern(cylinder({ height: 30, radius: 30 }), TILES.rows, { depthMm });
    if (rules) d.rules = rules;
    const { design, tp } = build(d);
    return warningsOf(design, tp).map((w) => w.id);
  };
  // A quarter bead deep: out over in is exactly half a bead.
  assert.deepEqual(at(0.75), []);
  assert.deepEqual(at(0.76), ['support']);
  // Steps of 2.8 mm, far past 45° at 1.5 mm layers: still only bead support.
  assert.deepEqual(at(1.4), ['support']);
  // The rule is a design setting.
  assert.deepEqual(at(0.85, { overhangLimitDeg: 45, supportRatio: 0.6 }), []);
  assert.deepEqual(at(0.95, { overhangLimitDeg: 45, supportRatio: 0.6 }), ['support']);
});

test('bead support counts the sharp start and stop of the range and every other term', () => {
  // A single row of out cells starts a full half bead out from the plain layer below.
  const flat = { kind: 'bitmap', columns: 1, rows: 1, cells: '+' };
  const d = withPattern(cylinder({ height: 30, radius: 30 }), flat, { depthMm: 1.5 });
  const { design, tp } = build(d);
  const w = warningsOf(design, tp).find((x) => x.id === 'support');
  assert.equal(w, undefined, 'exactly half a bead at the start and the stop');
  // A leaning profile adds to the step.
  const cone = withPattern(linearDesign([[0, 30], [30, 31.5]]), flat, { depthMm: 1.5 });
  const built = build(cone);
  const warning = warningsOf(built.design, built.tp).find((x) => x.id === 'support');
  assert.ok(warning, 'the start of the range steps out past half a bead on a flaring wall');
  // Heights are layer tops: the first layer in the range ends at 7.5 mm.
  assert.match(warning.message, /^Bead not supported at 8 mm$/);
});

test('Fade runs over From–To and never changes the drawing', () => {
  const run = (fade) => {
    const { design, tp } = build(withPattern(cylinder({ height: 30, radius: 30 }), TILES.zigzag, { fade }));
    const lp = tp.model.pattern;
    const nodeOff = (i, j) => layerPoints(design, tp, i).find((pt) => Math.abs(pt.u * lp.nodes - j) < 1e-6).off;
    return { design, lp, nodeOff };
  };
  const up = run({ shape: 'fadesUp', amount: 1 });
  assert.ok(Math.abs(up.nodeOff(up.lp.first, 2) - 0.75) < 1e-9, 'full at From');
  assert.ok(Math.abs(up.nodeOff(up.lp.last, 2)) < 1e-9, 'gone at To');
  const down = run({ shape: 'fadesDown', amount: 0.5 });
  assert.ok(Math.abs(down.nodeOff(down.lp.first, 2) - 0.375) < 1e-9, 'half at From');
  assert.ok(Math.abs(down.nodeOff(down.lp.last, 2) - 0.75) < 1e-9, 'full at To');
  const middle = run({ shape: 'middle', amount: 1 });
  assert.ok(Math.abs(middle.nodeOff(middle.lp.first, 2) - 0.75) < 1e-9);
  assert.ok(Math.abs(middle.nodeOff(middle.lp.last, 2) - 0.75) < 1e-9);
  // Diagonal: a band without pattern that winds once round over From–To.
  assert.equal(fadeAt({ shape: 'diagonal', amount: 1 }, 0, 0.5), 0);
  assert.equal(fadeAt({ shape: 'diagonal', amount: 1 }, 0.25, 0.25), 0);
  assert.equal(fadeAt({ shape: 'diagonal', amount: 1 }, 0, 0), 1);
  assert.equal(fadeAt({ shape: 'even', amount: 1 }, 0.5, 0.5), 1);
  // The drawing in the design stays in / flat / out.
  assert.equal(up.design.assets['user:tile'].recipe.cells, '+-');
});

test('Soften blurs the cells, wrapping round the tile, and keeps the zigzag symmetric', () => {
  const { design, tp } = build(withPattern(cylinder({ height: 30, radius: 30 }), TILES.zigzag, { softenCells: 0.5 }));
  const lp = tp.model.pattern;
  const pts = layerPoints(design, tp, lp.first);
  const node = (j) => pts.find((pt) => Math.abs(pt.u * lp.nodes - j) < 1e-6).off;
  assert.ok(node(0) > 0.05 && node(0) < 0.75, `${node(0)}`);
  assert.ok(Math.abs(node(1) + node(0)) < 1e-6, 'the wrap keeps in and out the same depth');
  assert.equal(design.assets['user:tile'].recipe.cells, '+-');
});

test('density: points per layer is a whole number of tiles; spacing snaps to whole repeats; both clamp at the cap', () => {
  assert.deepEqual(nodesAround({ by: 'points', points: 100, spacingMm: 3 }, 3, 500, 1600), { repeats: 33, nodes: 99, clamped: false });
  assert.deepEqual(nodesAround({ by: 'spacing', points: 0, spacingMm: 3 }, 4, 100, 1600), { repeats: 8, nodes: 32, clamped: false });
  assert.deepEqual(nodesAround({ by: 'spacing', points: 0, spacingMm: 3 }, 4, 5, 1600), { repeats: 1, nodes: 4, clamped: false });
  assert.deepEqual(nodesAround({ by: 'points', points: 1600, spacingMm: 3 }, 7, 0, 1600), { repeats: 228, nodes: 1596, clamped: true });
  // The points face keeps its count when the pot changes size.
  for (const radius of [30, 60]) {
    const d = withPattern(cylinder({ height: 30, radius }), TILES.knit, { density: { by: 'points', spacingMm: 3, points: 96 } });
    const { tp } = build(d);
    assert.equal(tp.model.pattern.nodes, 96);
    assert.ok(tp.model.patternPoints <= MAX_POINTS_PER_LAYER);
  }
});

test('the seam sits on a node in the range, and a hidden seam still moves at most a bead a layer', () => {
  for (const preset of presets) {
    const d = withPattern(structuredClone(preset), TILES.knit, { fromMm: 10, toMm: 90 });
    const { design, tp } = build(d);
    const lp = tp.model.pattern;
    const w = design.layers.beadWidthMm;
    const profile = createProfile(design.form.profile);
    for (let i = lp.first; i <= lp.last; i++) {
      const x = tp.seams[i] * lp.nodes;
      assert.ok(Math.abs(x - Math.round(x)) < 1e-9, `${preset.meta.name}: layer ${i} seam at node ${x}`);
      if (design.layers.seam.position === 'hidden' && i > lp.first) {
        const moved = Math.abs(tp.seams[i] - tp.seams[i - 1]) * profile.at((i + 1) * design.layers.layerHeightMm) * tp.model.plan.unitPerimeter;
        assert.ok(moved <= w + 1e-6, `${preset.meta.name}: layer ${i} seam moved ${moved} mm`);
      }
    }
  }
});

test('a drawing that is missing prints plain and says so', () => {
  const d = withPattern(cylinder(), TILES.zigzag);
  d.pattern.drawing = 'user:gone';
  const { design, tp } = build(d);
  assert.equal(tp.model.pattern, null);
  assert.deepEqual(warningsOf(design, tp).map((w) => w.id), ['missingPattern']);
  // A library drawing resolves from library.layerPatterns.
  const lib = { ...library, layerPatterns: [{ id: 'lib:zigzag@1', name: 'Zigzag', recipe: TILES.zigzag }] };
  d.pattern.drawing = 'lib:zigzag@1';
  const n = normaliseDesign(d);
  assert.equal(buildToolpath(n, lib).model.pattern.nodes, 62);
});

test('normalising a Pattern clamps it to the bead and the pot', () => {
  const d = defaultDesign();
  assert.equal(d.pattern, null);
  assert.equal(normaliseDesign({ ...d, pattern: { drawing: 7 } }).pattern, null);
  assert.equal(normaliseDesign({ ...d, pattern: 'knit' }).pattern, null);
  const n = normaliseDesign({
    ...d,
    pattern: {
      drawing: 'lib:knit@1', depthMm: 9, density: { by: 'lots', spacingMm: 0.1, points: 9000.4 },
      fromMm: 400, toMm: -3, fade: { shape: 'sideways', amount: 3 }, softenCells: -1,
    },
  });
  assert.deepEqual(n.pattern, {
    drawing: 'lib:knit@1', depthMm: 1.5, density: { by: 'spacing', spacingMm: 1.5, points: 1600 },
    fromMm: 0, toMm: 170, fade: { shape: 'even', amount: 1 }, softenCells: 0,
  });
  // Missing fields get the defaults: a quarter bead deep, one bead apart, over
  // the Detailed morph (10–150 mm) inside its 6 mm soft start and end.
  const bare = normaliseDesign({ ...d, pattern: { drawing: 'lib:knit@1' } }).pattern;
  assert.deepEqual(bare, {
    drawing: 'lib:knit@1', depthMm: 0.75, density: { by: 'spacing', spacingMm: 3, points: 96 },
    fromMm: 16, toMm: 144, fade: { shape: 'even', amount: 1 }, softenCells: 0,
  });
  // Without a Detailed morph: from 8 mm to 10 mm below the rim.
  const plain = normaliseDesign(cylinder({ height: 80 }));
  assert.deepEqual(defaultPatternRange(plain), { fromMm: 8, toMm: 70 });
  // A Detailed morph too short to keep inside its soft edges: its own range.
  const short = normaliseDesign(d);
  short.form.detail.fromMm = 60;
  short.form.detail.toMm = 70;
  assert.deepEqual(defaultPatternRange(short), { fromMm: 60, toMm: 70 });
  // The height scales the Pattern's range like the Detailed morph's.
  const tall = normaliseDesign({ ...d, pattern: { drawing: 'lib:knit@1', fromMm: 20, toMm: 100 } });
  setHeight(tall, 340);
  assert.deepEqual([tall.pattern.fromMm, tall.pattern.toMm], [40, 200]);
});

test('the preview reports the density readout', () => {
  const r = computePreview(withPattern(cylinder({ height: 30, radius: 30 })), { library });
  assert.deepEqual(
    { nodes: r.pattern.nodes, repeats: r.pattern.repeats, columns: r.pattern.columns, rows: r.pattern.rows, pointsPerLayer: r.pattern.pointsPerLayer },
    { nodes: 62, repeats: 31, columns: 2, rows: 1, pointsPerLayer: 186 },
  );
  assert.ok(Math.abs(r.pattern.spacingMinMm - r.pattern.spacingMaxMm) < 1e-9, 'a cylinder has one spacing');
  assert.equal(computePreview(cylinder(), { library }).pattern, null);
});

test('the Detailed morph blend gains Fades down', () => {
  const detail = { fromMm: 10, toMm: 110, a: { depthMm: 2 }, b: { depthMm: 1 }, blend: { shape: 'fadesDown', amount: 1 } };
  const low = detailWeights(detail, 20, 1.5);
  const high = detailWeights(detail, 100, 1.5);
  assert.ok(low.b > 0.9 && high.a > 0.9, 'B at the bottom, A at the top');
  const up = detailWeights({ ...detail, blend: { shape: 'fadesUp', amount: 1 } }, 20, 1.5);
  assert.ok(Math.abs(up.a - low.b) < 1e-12 && Math.abs(up.b - low.a) < 1e-12, 'the mirror of Fades up');
});

test('the curve check runs node to node, so the points between nodes never make a corner of a node', () => {
  // The knit at a quarter bead on the Classic vase: its narrow neck puts the
  // nodes 3.2 mm apart with 4 points between, which measured point to point
  // would read as corners tighter than half a bead.
  const d = withPattern(structuredClone(presets[0]), TILES.knit, { fromMm: 10, toMm: 150 });
  const { design, tp } = build(d);
  const lp = tp.model.pattern;
  assert.ok(tp.model.patternPoints / lp.nodes >= 4);
  assert.ok(!warningsOf(design, tp).some((w) => w.id === 'finePattern'));
  // Every layer in the range marks its N nodes (the seam's node once).
  for (const i of [lp.first + 1, lp.last]) {
    let count = 0;
    for (let p = tp.layerStarts[i]; p < tp.layerStarts[i + 1]; p++) count += tp.nodes[p];
    assert.equal(count, lp.nodes, `layer ${i}`);
  }
  // A Detailed morph finer than the bead is still caught on the Pattern's layers.
  d.form.detail.a = { pattern: 'lib:flutes@1', depthMm: 3, repeats: 40, tileHeightMm: 20 };
  const fine = build(d);
  assert.ok(warningsOf(fine.design, fine.tp).some((w) => w.id === 'finePattern'));
  assert.equal(build(cylinder()).tp.nodes, null);
});
