// Slice 2 of the pattern studio (docs/design/v2-pattern-studio.md §11): the
// starter Patterns (D47, §3.8), one tap on the pot, the density readout and
// its two faces (D40), rows that stay rows when the layer height changes,
// and the Fade's Diagonal (D54).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDesign, normaliseDesign, designsEqual } from '../core/design.js';
import { MAX_POINTS_PER_LAYER, buildToolpath } from '../core/toolpath.js';
import { designChecks } from '../core/checks.js';
import { normalisePrinter } from '../core/printer.js';
import { computePreview } from '../core/engine.js';
import { validateRecipe, bitmapValues } from '../core/patterns.js';
import { DEPTH_BEADS, MAX_NODES, SPACING_BEADS, patternReadout } from '../core/layer-pattern.js';
import { createStore } from '../store/store.js';
import { DOCK_TOOLS } from '../ui/dock-tools.js';
import {
  densityLimits, densityText, softenText, findLayerEntry, pickLayerPattern, setDensityFace, setLayerPattern,
} from '../ui/pattern-actions.js';
import { shapeOnly } from '../ui/steps.js';
import { cylinder, library, presets } from './support/fixtures.js';

const printer = normalisePrinter(null);
const STARTERS = library.layerPatterns;
/** The default pot as the app first opens it: the Classic vase as a shape, flutes and all (D52). */
const defaultPot = () => shapeOnly(normaliseDesign(presets[0]));
const warningsOf = (design) => {
  const n = normaliseDesign(design);
  return designChecks(buildToolpath(n, library), n, printer).map((w) => w.id);
};
const withStarter = (design, id) => {
  setLayerPattern(design, findLayerEntry(library, id));
  return normaliseDesign(design);
};

test('the starter library: the eight Patterns of D47, in order, each a valid bitmap', () => {
  assert.deepEqual(STARTERS.map((p) => p.name), ['Knit', 'Rib 1×1', 'Rib 2×2', 'Brick bond', 'Seed', 'Herringbone', 'Basket', 'Diamond']);
  const ids = new Set(STARTERS.map((p) => p.id));
  assert.equal(ids.size, STARTERS.length);
  for (const p of STARTERS) {
    assert.match(p.id, /^lib:[a-z0-9-]+@1$/);
    assert.equal(p.recipe.kind, 'bitmap');
    validateRecipe(p.recipe);
    assert.equal(p.recipe.edges, undefined, 'a Pattern is always crisp (D53)');
    assert.equal(p.defaults, undefined, `${p.name}: every drawing starts at the standard depth and spacing (D61, D64)`);
    assert.ok(typeof p.description === 'string' && p.description.length > 10, p.name);
    assert.ok(!/clay|slicer|material/i.test(`${p.name} ${p.description}`), `${p.name}: plain design words (D7)`);
  }
});

test('no starter cell flips straight from out to in between rows, so a step is at most one depth', () => {
  for (const p of STARTERS) {
    const { columns, rows } = p.recipe;
    const v = bitmapValues(p.recipe);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const step = Math.abs(v[((r + 1) % rows) * columns + c] - v[r * columns + c]);
        assert.ok(step <= 1, `${p.name}: column ${c} flips between rows ${r} and ${(r + 1) % rows}`);
      }
    }
  }
});

test('every starter starts two thirds of a bead deep (D61): fine on a straight wall, and on a leaning one only bead support and the curve speak up', () => {
  assert.deepEqual(warningsOf(defaultPot()), [], 'the default pot warns about nothing on its own');
  assert.equal(DEPTH_BEADS.default, 2 / 3);
  assert.equal(DEPTH_BEADS.max, 2 / 3);
  for (const p of STARTERS) {
    // A straight wall at the standard support rule (70 % of a bead): no row steps more than one depth.
    const can = withStarter(cylinder({ height: 60, radius: 40 }), p.id);
    assert.equal(can.pattern.depthMm, 2, `${p.name}: two thirds of the 3 mm bead`);
    assert.ok(!warningsOf(can).includes('support'), `${p.name} on a straight wall`);
    // On the presets the wall's own lean adds to the step, so bead support (and the curve check) may warn; nothing else does.
    for (const preset of presets) {
      const before = warningsOf(shapeOnly(normaliseDesign(preset)));
      const after = warningsOf(withStarter(shapeOnly(normaliseDesign(preset)), p.id));
      assert.deepEqual(after.filter((id) => id !== 'support' && id !== 'finePattern'), before, `${p.name} on the ${preset.meta.name}`);
    }
  }
  // defaultDesign() is the same pot.
  assert.ok(designsEqual(normaliseDesign(defaultDesign()), { ...defaultPot(), meta: {} }));
});

test('one tap puts Knit on the pot, as one history step', () => {
  const store = createStore({ design: defaultPot(), label: 'Opened: Classic vase' });
  const ctx = { store, library };
  assert.equal(pickLayerPattern(ctx, 'lib:knit@1'), true);
  const d = store.state.design;
  assert.equal(d.pattern.drawing, 'lib:knit@1');
  assert.deepEqual(store.history().map((s) => s.label), ['Pattern: Knit', 'Opened: Classic vase']);
  // The standard depth (D61) and spacing (D64): two thirds of the 8 mm bead, 2 mm apart.
  assert.equal(d.pattern.depthMm, 5.33);
  assert.deepEqual(d.pattern.density, { by: 'spacing', spacingMm: 2, points: 96 });
  // From 8 mm to 10 mm below the rim.
  assert.deepEqual([d.pattern.fromMm, d.pattern.toMm], [8, 160]);
  const r = computePreview(d, { library, printer });
  assert.ok(r.pattern && r.pattern.nodes > 0 && r.pattern.columns === 4);
  // Tapping it again changes nothing; None takes it off.
  pickLayerPattern(ctx, 'lib:knit@1');
  assert.equal(store.history().length, 2);
  pickLayerPattern(ctx, null);
  assert.equal(store.state.design.pattern, null);
  assert.equal(pickLayerPattern(ctx, 'lib:nothing@1'), false);
});

test('switching drawings keeps From / To, Fade and Soften and takes the starter\'s depth and density', () => {
  const d = defaultPot();
  setLayerPattern(d, findLayerEntry(library, 'lib:knit@1'));
  Object.assign(d.pattern, { fromMm: 30, toMm: 90, fade: { shape: 'middle', amount: 0.5 }, softenCells: 0.5, depthMm: 1 });
  setLayerPattern(d, findLayerEntry(library, 'lib:rib-1x1@1'));
  assert.deepEqual(
    { ...d.pattern },
    { drawing: 'lib:rib-1x1@1', depthMm: 5.33, density: { by: 'spacing', spacingMm: 2, points: 96 }, fromMm: 30, toMm: 90, fade: { shape: 'middle', amount: 0.5 }, softenCells: 0.5, slant: { cells: 0, perFacet: false, toCells: 0 }, sits: 'centre', paint: null },
  );
});

test('the density readout shows the points per layer and the mm range, the same numbers the preview gives', () => {
  for (const preset of presets) {
    for (const p of STARTERS) {
      const d = withStarter(shapeOnly(normaliseDesign(preset)), p.id);
      const r = patternReadout(d, library);
      const preview = computePreview(d, { library, printer }).pattern;
      for (const k of ['nodes', 'columns', 'rows', 'repeats', 'clamped']) assert.equal(r[k], preview[k], `${preset.meta.name} ${p.name} ${k}`);
      assert.ok(Math.abs(r.spacingMinMm - preview.spacingMinMm) < 1e-9 && Math.abs(r.spacingMaxMm - preview.spacingMaxMm) < 1e-9);
      assert.match(densityText(r), /^\d+ points per layer · \d+\.\d–\d+\.\d mm · [\d,]+ in all$/);
    }
  }
  // The Classic vase: the narrow neck sets the spacing, the belly is widest.
  const knit = patternReadout(withStarter(defaultPot(), 'lib:knit@1'), library);
  assert.equal(densityText(knit), `${knit.nodes} points per layer · ${knit.spacingMinMm.toFixed(1)}–${knit.spacingMaxMm.toFixed(1)} mm · ${(knit.nodes * knit.layers).toLocaleString('en-US')} in all`);
  assert.ok(knit.spacingMinMm >= 2 && knit.spacingMaxMm > 1.5 * knit.spacingMinMm);
  // A cylinder has one spacing; the cap says so.
  const can = withStarter(cylinder({ height: 40, radius: 30 }), 'lib:seed@1');
  assert.match(densityText(patternReadout(can, library)), /^\d+ points per layer · \d+\.\d mm apart · [\d,]+ in all$/);
  // Soften adds points between the cells (D59): the readout names both, the dock's line the points.
  const soft = patternReadout(normaliseDesign({ ...can, pattern: { ...can.pattern, softenCells: 0.5 } }), library);
  assert.ok(soft.extra >= 1);
  assert.equal(densityText(soft).split(' · ')[0], `${soft.nodes} cells, ${soft.pointsPerLayer} points per layer`);
  assert.equal(densityText(soft, { compact: true }).split(' · ')[0], `${soft.pointsPerLayer} points per layer`);
  assert.match(softenText(0.5, soft), /adds \d+ points? between cells: [\d,]+ more points/);
  assert.match(softenText(0, patternReadout(can, library)), /^Crisp/);
  assert.match(densityText({ ...patternReadout(can, library), clamped: true }), / · the most a layer takes$/);
  assert.equal(MAX_NODES, MAX_POINTS_PER_LAYER);
  assert.equal(patternReadout(defaultPot(), library), null);
});

test('the density\'s two faces: switching keeps the pot, and the points face moves in whole tiles', () => {
  for (const preset of presets) {
    for (const p of STARTERS) {
      const d = withStarter(shapeOnly(normaliseDesign(preset)), p.id);
      const r = patternReadout(d, library);
      const lim = densityLimits(d, r);
      assert.equal(lim.points.step, r.columns);
      assert.ok(lim.points.min <= r.nodes && r.nodes <= lim.points.max && lim.points.min % r.columns === 0 && lim.points.max % r.columns === 0);
      setDensityFace(d, 'points', r);
      const byPoints = patternReadout(normaliseDesign(d), library);
      assert.equal(byPoints.nodes, r.nodes, `${preset.meta.name} ${p.name}: to points`);
      setDensityFace(d, 'spacing', byPoints);
      const back = patternReadout(normaliseDesign(d), library);
      assert.equal(back.nodes, r.nodes, `${preset.meta.name} ${p.name}: back to spacing`);
    }
  }
  // The points face keeps its count when the pot grows.
  const d = withStarter(defaultPot(), 'lib:knit@1');
  setDensityFace(d, 'points', patternReadout(d, library));
  const nodes = patternReadout(d, library).nodes;
  DOCK_TOOLS.shape.find((t) => t.id === 'width').set(d, 200);
  assert.equal(patternReadout(normaliseDesign(d), library).nodes, nodes);
});

test('changing the layer height keeps the drawing row for row', () => {
  const tool = DOCK_TOOLS.layers.find((t) => t.id === 'layer');
  const base = withStarter(defaultPot(), 'lib:herringbone@1');
  const { columns, rows } = findLayerEntry(library, 'lib:herringbone@1').recipe;
  const cells = bitmapValues(findLayerEntry(library, 'lib:herringbone@1').recipe);
  for (const h of [1.5, 1.2, 1.0, 1.8]) {
    const d = structuredClone(base);
    tool.set(d, h, null);
    const n = normaliseDesign(d);
    assert.deepEqual(n.pattern, base.pattern, `h ${h}: the Pattern itself is unchanged`);
    const lp = buildToolpath(n, library).model.pattern;
    assert.equal(lp.first, Math.max(n.base.layers, Math.ceil(n.pattern.fromMm / h - 0.5 - 1e-9)));
    // Row k of the drawing on the k-th layer from From, node for node, all the way up.
    for (let i = lp.first; i <= lp.last; i++) {
      const row = (i - lp.first) % rows;
      assert.equal(lp.rowOf(i), row);
      for (let j = 0; j < lp.nodes; j += 7) {
        const want = n.pattern.depthMm * cells[row * columns + (j % columns)];
        assert.ok(Math.abs(lp.at(i, j / lp.nodes) - want) < 1e-12, `h ${h}, layer ${i}, node ${j}`);
      }
    }
  }
});
