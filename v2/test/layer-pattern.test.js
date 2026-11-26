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
import { defaultPatternRange, fadeAt, nodesAround, patternReadout } from '../core/layer-pattern.js';
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

/**
 * Checks a layer against a zigzag of ±depth: exact at every node, straight
 * between. Points before `fromU` only count as printed: the layer's start,
 * where it changes over from the row below (D60).
 */
function assertZigzag(points, N, depth, label, fromU = 0) {
  const nodes = new Set();
  for (const { u, off } of points) {
    const x = u * N;
    const j = Math.round(x);
    if (Math.abs(x - j) < 1e-6) {
      const node = j % N;
      nodes.add(node);
      if (u < fromU - 1e-9) continue;
      assert.ok(Math.abs(off - (node % 2 ? -depth : depth)) < 1e-9, `${label}: node ${node} at ${off}`);
    } else if (u >= fromU - 1e-9) {
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
  // Crisp, a layer has its nodes and nothing else (D58).
  assert.equal(tp.model.patternPoints, 62);
  // The first layer comes in from the plain wall over the seam ramp: 15 mm, 5 whole cells.
  for (let i = lp.first; i <= lp.last; i++) {
    assertZigzag(layerPoints(design, tp, i), 62, 0.75, `layer ${i}`, i === lp.first ? 5 / 62 : 0);
  }
  // Outside the range the wall is plain, and the base never has the Pattern.
  for (const i of [0, 1, 2, 3, 16, 19]) {
    // Layer 16 leaves the last row over its seam ramp.
    for (const { u, off } of layerPoints(design, tp, i)) {
      if (i === 16 && u < 0.1) continue;
      assert.ok(Math.abs(off) < 1e-9, `layer ${i}: ${off}`);
    }
  }
});

test('the seam never steps sideways: a layer starts on the row below and changes over on the ramp', () => {
  // The knit changes row every layer; the seam is fixed at u = 0, on a node.
  // From above the ramp-in layers, which step up at the seam with no bead.
  // Below the ramp-out layers under the rim (D68), which step up as well.
  const { design, tp } = build(withPattern(cylinder({ height: 30, radius: 30 }), TILES.knit, { fromMm: 12, toMm: 22 }));
  const lp = tp.model.pattern;
  const h = design.layers.layerHeightMm;
  const P = tp.path;
  assert.ok(lp.last + 1 < tp.layerZ.length - RAMP_IN_LAYERS);
  const cells = design.layers.seam.rampPoints;
  assert.ok(cells >= 2, 'the ramp spans several cells');
  for (let i = lp.first; i <= lp.last + 1; i++) {
    const p = tp.layerStarts[i];
    // No bead goes sideways at the seam (it would be up to the 0.75 mm depth): the first move runs along the wall.
    const step = Math.hypot(P[3 * p] - P[3 * p - 3], P[3 * p + 1] - P[3 * p - 2]);
    assert.ok(step > 1, `layer ${i} starts with a step of ${step}`);
    if (i > lp.last) continue;
    // The climb is shared out evenly over the ramp's cells, then the layer runs flat.
    for (let c = 1; c <= cells + 1; c++) {
      const want = i * h + h * Math.min(c / cells, 1);
      assert.ok(Math.abs(P[3 * (p + c - 1) + 2] - want) < 1e-9, `layer ${i}, cell ${c}`);
    }
    // Past the ramp the nodes are the layer's own row.
    for (const { u, off } of layerPoints(design, tp, i)) {
      const j = Math.round(u * lp.nodes) % lp.nodes;
      if (j < cells) continue;
      assert.ok(Math.abs(off - lp.at(i, j / lp.nodes)) < 1e-9, `layer ${i}, node ${j}`);
    }
  }
});

test('Soften adds the same points to every gap, on a smooth curve, and counts them', () => {
  const crisp = build(withPattern(cylinder({ height: 30, radius: 30 }), TILES.knit));
  const soft = build(withPattern(cylinder({ height: 30, radius: 30 }), TILES.knit, { softenCells: 0.5 }));
  const lp = soft.tp.model.pattern;
  assert.equal(crisp.tp.model.pattern.extra, 0);
  assert.equal(lp.nodes, crisp.tp.model.pattern.nodes, 'Soften keeps the nodes');
  // About 3 mm between nodes and a 3 mm bead: a point in between brings it to half a bead.
  assert.ok(lp.extra >= 1);
  assert.equal(soft.tp.model.patternPoints, lp.nodes * (lp.extra + 1));
  for (let i = lp.first + 1; i <= lp.last; i++) {
    assert.equal(soft.tp.layerStarts[i + 1] - soft.tp.layerStarts[i], lp.nodes * (lp.extra + 1), `layer ${i}`);
  }
  // The readout counts them, a layer and over the Pattern's layers.
  const r = patternReadout(soft.design, library);
  assert.equal(r.pointsPerLayer, lp.nodes * (lp.extra + 1));
  assert.equal(r.points, r.pointsPerLayer * (lp.last - lp.first + 1));
  assert.equal(patternReadout(crisp.design, library).pointsPerLayer, lp.nodes);
  // The curve passes through the nodes and runs smoothly in between: halfway
  // between two nodes it leaves the straight line where the wall turns.
  const i = lp.first + 3;
  let bent = 0;
  for (let j = 0; j < lp.nodes; j++) {
    const a = lp.at(i, j / lp.nodes);
    const b = lp.at(i, (j + 1) / lp.nodes);
    const mid = lp.at(i, (j + 0.5) / lp.nodes);
    assert.ok(Math.abs(mid) <= lp.depthMm + 1e-9);
    if (Math.abs(mid - (a + b) / 2) > 1e-4) bent++;
  }
  assert.ok(bent > 0, 'the points in between leave the straight line');
});

test('columns line up on a tapered pot, with the same point count on every layer', () => {
  // From above the base and the ramp-in layers, so only the Pattern shapes the counts.
  const d = withPattern(linearDesign([[0, 25], [45, 45]]), TILES.zigzag, { fromMm: 12, toMm: 39 });
  const { design, tp } = build(d);
  const lp = tp.model.pattern;
  // The spacing is measured on the narrowest layer in the range.
  const narrowest = createProfile(design.form.profile).at((lp.first + 1) * design.layers.layerHeightMm);
  assert.equal(lp.repeats, Math.floor((TAU * narrowest) / (2 * 3)));
  // Crisp, the nodes are the only points, also where the pot is wider (D58).
  const n = tp.model.patternPoints;
  assert.equal(n, lp.nodes);
  const h = design.layers.layerHeightMm;
  assert.ok(lp.first >= design.base.layers + RAMP_IN_LAYERS);
  for (let i = lp.first; i <= lp.last; i++) {
    assert.equal(pointsAround(tp.model, i * h, (i + 1) * h).n, n, `layer ${i}`);
    assert.equal(tp.layerStarts[i + 1] - tp.layerStarts[i], n, `points on layer ${i}`);
    // The first layer comes in from the plain wall over its seam ramp (D60).
    assertZigzag(layerPoints(design, tp, i), lp.nodes, 0.75, `layer ${i}`, i === lp.first ? 0.2 : 0);
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
    // Half a bead here, unless the test sets the rule (the standard is 70 %, D61).
    d.rules = rules ?? { ...d.rules, supportRatio: 0.5 };
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
  d.rules.supportRatio = 0.5;
  const { design, tp } = build(d);
  const w = warningsOf(design, tp).find((x) => x.id === 'support');
  assert.equal(w, undefined, 'exactly half a bead at the start and the stop');
  // A leaning profile adds to the step.
  const cone = withPattern(linearDesign([[0, 30], [30, 31.5]]), flat, { depthMm: 1.5 });
  cone.rules.supportRatio = 0.5;
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
  // Node 30 is across the pot from the seam, clear of the ramp.
  const up = run({ shape: 'fadesUp', amount: 1 });
  assert.ok(Math.abs(up.nodeOff(up.lp.first, 30) - 0.75) < 1e-9, 'full at From');
  assert.ok(Math.abs(up.nodeOff(up.lp.last, 30)) < 1e-9, 'gone at To');
  const down = run({ shape: 'fadesDown', amount: 0.5 });
  assert.ok(Math.abs(down.nodeOff(down.lp.first, 30) - 0.375) < 1e-9, 'half at From');
  assert.ok(Math.abs(down.nodeOff(down.lp.last, 30) - 0.75) < 1e-9, 'full at To');
  const middle = run({ shape: 'middle', amount: 1 });
  assert.ok(Math.abs(middle.nodeOff(middle.lp.first, 30) - 0.75) < 1e-9);
  assert.ok(Math.abs(middle.nodeOff(middle.lp.last, 30) - 0.75) < 1e-9);
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
  // Away from the seam, where the first layer comes in from the plain wall.
  assert.ok(node(30) > 0.05 && node(30) < 0.75, `${node(30)}`);
  assert.ok(Math.abs(node(31) + node(30)) < 1e-6, 'the wrap keeps in and out the same depth');
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

test('every layer in the range starts on the seam column, and the seam moves at most a bead a layer all the way up (D65)', () => {
  for (const preset of presets) {
    for (const position of ['hidden', 'fixed', 'followTwist']) {
      const d = withPattern(structuredClone(preset), TILES.knit, { fromMm: 30, toMm: 90 });
      d.layers.seam.position = position;
      const { design, tp } = build(d);
      const lp = tp.model.pattern;
      const w = design.layers.beadWidthMm;
      const profile = createProfile(design.form.profile);
      const name = `${preset.meta.name}, ${position}`;
      // Hidden takes the knit's quiet column (1), the others the left edge (0).
      const column = position === 'hidden' ? 1 : 0;
      for (let i = lp.first; i <= lp.last; i++) {
        const x = tp.seams[i] * lp.nodes;
        assert.ok(Math.abs(x - Math.round(x)) < 1e-9, `${name}: layer ${i} seam at node ${x}`);
        assert.equal(((Math.round(x) % lp.columns) + lp.columns) % lp.columns, column, `${name}: layer ${i}`);
        assert.equal(tp.seams[i], tp.seams[lp.first], `${name}: layer ${i} keeps the seam's place`);
      }
      for (let i = 1; i < tp.seams.length; i++) {
        let du = tp.seams[i] - tp.seams[i - 1];
        du -= Math.round(du);
        const moved = Math.abs(du) * profile.at((i + 1) * design.layers.layerHeightMm) * tp.model.plan.unitPerimeter;
        // A fixed seam on the twisting pot turns against the twist outside the range, as before.
        if (position === 'fixed' && design.form.twist.degrees !== 0 && !lp.inRange(i) && !lp.inRange(i - 1)) continue;
        assert.ok(moved <= w + 1e-6, `${name}: layer ${i} seam moved ${moved.toFixed(2)} mm`);
      }
    }
  }
});

test('a hidden seam takes the column where the rows change least, a groove before a flat one (D66)', () => {
  // Columns 2 (flat) and 4 (in) never change; the rest do.
  const recipe = { kind: 'bitmap', columns: 5, rows: 3, cells: '+-0+-' + '-+0--' + '++0--' };
  const d = withPattern(cylinder({ height: 30, radius: 30 }), recipe, { fromMm: 9, toMm: 24 });
  d.layers.seam = { rampPoints: 1, position: 'hidden', angleDeg: 0 };
  const { tp } = build(d);
  const lp = tp.model.pattern;
  assert.equal(lp.seamColumn(1), 4);
  for (let i = lp.first; i <= lp.last; i++) assert.equal(Math.round(tp.seams[i] * lp.nodes) % lp.columns, 4, `layer ${i}`);
  // Over a longer ramp the cells after the column count too, less and less.
  assert.equal(TILES.knit.columns, 4);
  const knit = build(withPattern(cylinder({ height: 30, radius: 30 }), TILES.knit)).tp.model.pattern;
  assert.equal(knit.seamColumn(4), 1);
  assert.equal(knit.seamColumn(1), 1);
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
    // The standard 8 mm bead (D62): two thirds of it deep at most (D61), a quarter of it apart at least (D64).
    drawing: 'lib:knit@1', depthMm: (2 / 3) * 8, density: { by: 'spacing', spacingMm: 2, points: 1600 },
    fromMm: 0, toMm: 170, fade: { shape: 'even', amount: 1 }, softenCells: 0, slant: { cells: 0, perFacet: false, toCells: 0 },
  });
  // Missing fields get the defaults: two thirds of a bead deep (D61), 2 mm
  // apart (D64), from 8 mm to 10 mm below the rim.
  const bare = normaliseDesign({ ...d, pattern: { drawing: 'lib:knit@1' } }).pattern;
  assert.deepEqual(bare, {
    drawing: 'lib:knit@1', depthMm: (2 / 3) * 8, density: { by: 'spacing', spacingMm: 2, points: 96 },
    fromMm: 8, toMm: 160, fade: { shape: 'even', amount: 1 }, softenCells: 0, slant: { cells: 0, perFacet: false, toCells: 0 },
  });
  const plain = normaliseDesign(cylinder({ height: 80 }));
  assert.deepEqual(defaultPatternRange(plain), { fromMm: 8, toMm: 70 });
  // The height scales the Pattern's range.
  const tall = normaliseDesign({ ...d, pattern: { drawing: 'lib:knit@1', fromMm: 20, toMm: 100 } });
  setHeight(tall, 340);
  assert.deepEqual([tall.pattern.fromMm, tall.pattern.toMm], [40, 200]);
});

test('the preview reports the density readout', () => {
  const r = computePreview(withPattern(cylinder({ height: 30, radius: 30 })), { library });
  assert.deepEqual(
    { nodes: r.pattern.nodes, repeats: r.pattern.repeats, columns: r.pattern.columns, rows: r.pattern.rows, pointsPerLayer: r.pattern.pointsPerLayer },
    { nodes: 62, repeats: 31, columns: 2, rows: 1, pointsPerLayer: 62 },
  );
  assert.ok(Math.abs(r.pattern.spacingMinMm - r.pattern.spacingMaxMm) < 1e-9, 'a cylinder has one spacing');
  assert.equal(computePreview(cylinder(), { library }).pattern, null);
});

test('the curve check runs node to node, so the points between nodes never make a corner of a node', () => {
  // The knit at a quarter bead on the Classic vase, softened a little: its
  // narrow neck puts the nodes 3.2 mm apart with points between, which
  // measured point to point would read as corners tighter than half a bead.
  const d = withPattern(structuredClone(presets[0]), TILES.knit, { fromMm: 10, toMm: 150, softenCells: 0.3 });
  const { design, tp } = build(d);
  const lp = tp.model.pattern;
  assert.ok(tp.model.patternPoints / lp.nodes >= 2);
  assert.ok(!warningsOf(design, tp).some((w) => w.id === 'finePattern'));
  // Past the ramp-in layers, every layer in the range marks its N nodes (a few more or fewer where the hidden seam moved, at most a bead width).
  for (const i of [lp.first + 6, lp.last]) {
    let count = 0;
    for (let p = tp.layerStarts[i]; p < tp.layerStarts[i + 1]; p++) count += tp.nodes[p];
    const most = Math.ceil(design.layers.beadWidthMm / lp.spacingMinMm);
    assert.ok(Math.abs(count - lp.nodes) <= most, `layer ${i}: ${count}`);
  }
  assert.equal(build(cylinder()).tp.nodes, null);
});
