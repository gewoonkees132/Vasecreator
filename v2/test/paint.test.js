// The paint (D79–D87, docs/design/v2-paint-brush.md): a black-and-white
// overlay over the whole wall that scales the Pattern, and the brush that
// paints it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactDesign, designsEqual, normaliseDesign, setHeight } from '../core/design.js';
import { buildToolpath } from '../core/toolpath.js';
import { computePreview, WALL_GRID } from '../core/engine.js';
import { createLayerPattern } from '../core/layer-pattern.js';
import { createProfile } from '../core/profile.js';
import { createPlan } from '../core/plan.js';
import {
  BRUSH_DEFAULTS, PAINT_AROUND, PAINT_SIZE, PAINT_UP, band, brushRadii, composite, createStroke, decodePaint,
  emptyTouch, encodePaint, isWhite, maxBrushMm, normalisePaint, paintAt, ramp, segment, shortWay, stamp, whitePaint,
} from '../core/paint.js';
import { TILES, cylinder, library, withPattern } from './support/fixtures.js';

const filled = (value) => new Uint8Array(PAINT_SIZE).fill(value);
const cell = (c, r) => r * PAINT_AROUND + c;

/** The Pattern of a design, as the toolpath builds it. */
function patternOf(d) {
  const design = normaliseDesign(d);
  const h = design.layers.layerHeightMm;
  const layerCount = Math.max(1, Math.round(design.form.height / h));
  return {
    design,
    lp: createLayerPattern(design, library, {
      profile: createProfile(design.form.profile), unitPerimeter: createPlan(design.form.plan).unitPerimeter,
      layerCount, baseLayers: design.base.layers, maxNodes: 1600,
    }),
  };
}
const potWith = (paint, patch = {}) => withPattern(cylinder({ height: 30 }), TILES.zigzag, { paint, ...patch });

test('an overlay survives the design as text, and white is no paint', () => {
  assert.equal(encodePaint(whitePaint()), null);
  assert.equal(encodePaint(null), null);
  const cells = whitePaint();
  for (let i = 0; i < PAINT_SIZE; i++) cells[i] = (i * 37 + (i >> 5)) & 255;
  const back = decodePaint(encodePaint(cells));
  assert.deepEqual(back, cells);
  // Long runs pack small: one black band is a few hundred characters.
  const banded = whitePaint();
  banded.fill(0, cell(0, 40), cell(0, 50));
  const text = encodePaint(banded).cells;
  assert.ok(text.length < 400, `${text.length} characters`);
  assert.deepEqual(decodePaint({ cells: text }), banded);
  // The worst case stays near the raw cells plus base64's third.
  assert.ok(encodePaint(cells).cells.length < PAINT_SIZE * 1.4);
});

test('what does not read as an overlay is no paint', () => {
  for (const bad of [null, 7, 'x', {}, { cells: '' }, { cells: '!!!!' }, { cells: 'AAAA' }, { cells: 'gP8=' }, { cells: 'A'.repeat(PAINT_SIZE * 3) }]) {
    assert.equal(decodePaint(bad), null);
    assert.equal(normalisePaint(bad), null);
  }
  const d = normaliseDesign(potWith(encodePaint(filled(128))));
  assert.equal(typeof d.pattern.paint.cells, 'string');
  assert.equal(normaliseDesign(potWith({ cells: 'nonsense' })).pattern.paint, null);
});

test('a design without paint equals one never painted, and its file leaves the field out', () => {
  const plain = normaliseDesign(potWith(undefined));
  assert.equal(plain.pattern.paint, null);
  assert.equal(Object.hasOwn(compactDesign(plain).pattern, 'paint'), false);
  const painted = normaliseDesign(potWith(encodePaint(filled(0))));
  assert.equal(designsEqual(plain, painted), false);
  painted.pattern.paint = null;
  assert.ok(designsEqual(plain, painted));
});

test('the overlay is read bilinearly, wraps round the pot and holds at the ends', () => {
  const cells = whitePaint();
  cells[cell(0, 0)] = 0;
  assert.equal(paintAt(cells, 0.5 / PAINT_AROUND, 0.5 / PAINT_UP), 0);
  // Half-way to the next column, and the same across the wrap.
  assert.ok(Math.abs(paintAt(cells, 1 / PAINT_AROUND, 0.5 / PAINT_UP) - 0.5) < 1e-9);
  assert.ok(Math.abs(paintAt(cells, 0, 0.5 / PAINT_UP) - 0.5) < 1e-9);
  assert.ok(Math.abs(paintAt(cells, 1, 0.5 / PAINT_UP) - 0.5) < 1e-9);
  assert.equal(paintAt(cells, -1 + 0.5 / PAINT_AROUND, 0), 0);
  assert.equal(paintAt(cells, 0.5, 2), 1);
  assert.equal(paintAt(cells, 0.5 / PAINT_AROUND, -1), 0);
});

test('white paint builds the same toolpath, black the plain wall', () => {
  const none = buildToolpath(normaliseDesign(potWith(null)), library);
  const plainWall = buildToolpath(normaliseDesign(potWith(null, { depthMm: 0 })), library);
  const black = buildToolpath(normaliseDesign(potWith(encodePaint(filled(0)))), library);
  let moved = 0;
  for (let i = 0; i < 3 * none.pointCount; i++) if (Math.abs(none.path[i] - plainWall.path[i]) > 1e-6) moved += 1;
  assert.ok(moved > 0, 'the Pattern moves the wall without paint');
  // Under black paint every wall point lies on the plain wall's radius.
  const { lp } = patternOf(potWith(encodePaint(filled(0))));
  for (let i = lp.first; i <= lp.last; i++) {
    for (let j = 0; j < lp.nodes; j++) assert.equal(Math.abs(lp.at(i, j / lp.nodes)), 0);
  }
  for (let p = 0; p < black.pointCount; p++) {
    if (black.kinds[p] !== 1) continue;
    const r = Math.sqrt(black.path[3 * p] * black.path[3 * p] + black.path[3 * p + 1] * black.path[3 * p + 1]);
    assert.ok(Math.abs(r - 30) < 1e-6, `wall point ${p} at radius ${r}`);
  }
});

test('grey paint scales the displacement, the sit included', () => {
  for (const sits of ['centre', 'inset', 'offset']) {
    const full = patternOf(potWith(null, { sits })).lp;
    const half = patternOf(potWith(encodePaint(filled(102)), { sits })).lp;
    let seen = 0;
    for (let i = full.first; i <= full.last; i++) {
      for (let j = 0; j < full.nodes; j++) {
        const want = full.at(i, j / full.nodes) * (102 / 255);
        assert.ok(Math.abs(half.at(i, j / full.nodes) - want) < 1e-9);
        if (want !== 0) seen += 1;
      }
    }
    assert.ok(seen > 0);
  }
});

test('the painting keeps its place when the density changes and stretches with the height', () => {
  // Black over the lower half of the pot's height, white above.
  const cells = whitePaint();
  cells.fill(0, 0, cell(0, PAINT_UP / 2));
  const paint = encodePaint(cells);
  for (const spacingMm of [3, 1.5, 6]) {
    const { lp, design } = patternOf(potWith(paint, { density: { by: 'spacing', spacingMm, points: 96 }, fromMm: 0, toMm: 30 }));
    const h = design.layers.layerHeightMm;
    for (let i = lp.first; i <= lp.last; i++) {
      const z = (i + 0.5) * h;
      const at = Math.abs(lp.at(i, 0));
      if (z < 14) assert.equal(at, 0, `plain at ${z} mm`);
      if (z > 16) assert.ok(at > 0.7, `full at ${z} mm`);
    }
  }
  const tall = normaliseDesign(potWith(paint, { fromMm: 0, toMm: 30 }));
  setHeight(tall, 60);
  const { lp, design } = patternOf(tall);
  assert.equal(design.pattern.paint.cells, paint.cells);
  const h = design.layers.layerHeightMm;
  for (let i = lp.first; i <= lp.last; i++) {
    const z = (i + 0.5) * h;
    if (z < 28) assert.equal(Math.abs(lp.at(i, 0)), 0);
    if (z > 32) assert.ok(Math.abs(lp.at(i, 0)) > 0.7);
  }
});

test('a brush press is round on the wall, soft or hard', () => {
  const { ru, rv } = brushRadii(30, 300, 150);
  assert.deepEqual({ ru, rv }, { ru: 0.05, rv: 0.1 });
  const hard = emptyTouch();
  stamp(hard, 0.5, 0.5, ru, rv, 0);
  const at = (t, u, v) => t[cell(Math.floor(u * PAINT_AROUND), Math.floor(v * PAINT_UP))];
  assert.equal(at(hard, 0.5, 0.5), 1);
  assert.equal(at(hard, 0.5 + ru * 0.6, 0.5), 1);
  assert.equal(at(hard, 0.5, 0.5 + rv * 0.6), 1);
  assert.equal(at(hard, 0.5 + ru * 1.4, 0.5), 0);
  assert.equal(at(hard, 0.5, 0.5 + rv * 1.4), 0);
  const soft = emptyTouch();
  stamp(soft, 0.5, 0.5, ru, rv, 1);
  const mid = at(soft, 0.5 + ru * 0.5, 0.5);
  assert.ok(mid > 0.2 && mid < 0.8, `${mid}`);
  // Across the wrap the far side of the brush lands on the other edge.
  const wrap = emptyTouch();
  stamp(wrap, 0, 0.5, ru, rv, 0);
  assert.equal(at(wrap, 0.01, 0.5), 1);
  assert.equal(at(wrap, 0.99, 0.5), 1);
  assert.equal(at(wrap, 0.5, 0.5), 0);
});

test('a dragged brush leaves no gaps and takes the short way round', () => {
  assert.ok(Math.abs(shortWay(0.9, 0.1) - 0.2) < 1e-12);
  assert.ok(Math.abs(shortWay(0.1, 0.9) + 0.2) < 1e-12);
  const radii = () => ({ ru: 0.02, rv: 0.04 });
  const t = emptyTouch();
  segment(t, { u: 0.9, v: 0.2 }, { u: 0.1, v: 0.8 }, radii, 0);
  for (let k = 0; k <= 40; k++) {
    const u = (0.9 + 0.2 * (k / 40)) % 1;
    const v = 0.2 + 0.6 * (k / 40);
    assert.equal(t[cell(Math.min(PAINT_AROUND - 1, Math.floor(u * PAINT_AROUND)), Math.floor(v * PAINT_UP))], 1, `gap at ${k}`);
  }
  // Nothing on the long way round.
  assert.equal(t[cell(PAINT_AROUND / 2, PAINT_UP / 2)], 0);
});

test('Around is a level band, Fade a ramp by height', () => {
  const b = emptyTouch();
  band(b, 0.4, 0.5, 0.05, 0);
  for (let c = 0; c < PAINT_AROUND; c += 17) {
    assert.equal(b[cell(c, Math.floor(0.45 * PAINT_UP))], 1);
    assert.equal(b[cell(c, Math.floor(0.2 * PAINT_UP))], 0);
    assert.equal(b[cell(c, Math.floor(0.7 * PAINT_UP))], 0);
  }
  const up = emptyTouch();
  ramp(up, 0.25, 0.75);
  assert.equal(up[cell(3, 10)], 0);
  assert.ok(Math.abs(up[cell(3, PAINT_UP / 2)] - 0.5) < 0.02);
  assert.equal(up[cell(3, PAINT_UP - 5)], 1);
  const down = emptyTouch();
  ramp(down, 0.75, 0.25);
  assert.equal(down[cell(3, PAINT_UP - 5)], 0);
  assert.equal(down[cell(3, 10)], 1);
  const tap = emptyTouch();
  ramp(tap, 0.5, 0.5);
  assert.ok(tap.every((x) => x === 0));
});

test('a stroke never goes past its Strength, and a weak brush still gets there', () => {
  const touched = emptyTouch().fill(1);
  assert.ok(composite(whitePaint(), touched, 1, false).every((x) => x === 0));
  assert.ok(composite(filled(0), touched, 1, true).every((x) => x === 255));
  assert.equal(composite(whitePaint(), touched, 0.5, false)[0], 127);
  assert.equal(composite(filled(100), touched, 0.5, true)[0], 178);
  // Untouched cells stay.
  assert.ok(isWhite(composite(whitePaint(), emptyTouch(), 1, false)));
  // At the least Strength every stroke moves a cell by a level at least.
  let cells = whitePaint();
  let strokes = 0;
  while (cells[0] > 0 && strokes < 400) { cells = composite(cells, touched, 0.05, false); strokes += 1; }
  assert.equal(cells[0], 0);
  while (cells[0] < 255 && strokes < 800) { cells = composite(cells, touched, 0.05, true); strokes += 1; }
  assert.equal(cells[0], 255);
});

test('a stroke: going over a spot twice changes nothing more, a second stroke does', () => {
  const wall = { before: null, heightMm: 150, perimeterAt: () => 300 };
  const brush = { ...BRUSH_DEFAULTS, sizeMm: 30, soft: 0, strength: 0.4 };
  const s = createStroke(brush, wall);
  s.to(0.5, 0.5);
  const once = s.cells();
  s.to(0.5, 0.5);
  s.to(0.52, 0.5);
  s.to(0.5, 0.5);
  const i = cell(PAINT_AROUND / 2, PAINT_UP / 2);
  assert.equal(s.cells()[i], once[i]);
  assert.equal(once[i], 153);
  const second = createStroke(brush, { ...wall, before: once });
  second.to(0.5, 0.5);
  assert.equal(second.cells()[i], 92);
  // More brings it back.
  const back = createStroke({ ...brush, more: true, strength: 1 }, { ...wall, before: second.cells() });
  back.to(0.5, 0.5);
  assert.equal(back.cells()[i], 255);
});

test('the strokes: Line can be dragged back, Free joins up, lifting breaks it', () => {
  const wall = { before: null, heightMm: 150, perimeterAt: () => 300 };
  const far = cell(Math.floor(0.7 * PAINT_AROUND), PAINT_UP / 2);
  const middle = cell(Math.floor(0.6 * PAINT_AROUND), PAINT_UP / 2);
  const line = createStroke({ ...BRUSH_DEFAULTS, stroke: 'line', soft: 0 }, wall);
  line.to(0.5, 0.5);
  line.to(0.7, 0.5);
  assert.equal(line.cells()[far], 0);
  assert.equal(line.cells()[middle], 0);
  line.to(0.5, 0.5);
  assert.equal(line.cells()[far], 255);
  assert.equal(line.cells()[middle], 255);
  const free = createStroke({ ...BRUSH_DEFAULTS, soft: 0 }, wall);
  free.to(0.5, 0.5);
  free.to(0.7, 0.5);
  assert.equal(free.cells()[middle], 0);
  const lifted = createStroke({ ...BRUSH_DEFAULTS, soft: 0, sizeMm: 10 }, wall);
  lifted.to(0.5, 0.5);
  lifted.lift();
  lifted.to(0.7, 0.5);
  assert.equal(lifted.cells()[middle], 255);
  assert.equal(lifted.cells()[far], 0);
  const fade = createStroke({ ...BRUSH_DEFAULTS, stroke: 'fade' }, wall);
  fade.to(0.3, 0.25);
  fade.to(0.9, 0.75);
  assert.equal(fade.cells()[cell(5, 5)], 255);
  assert.equal(fade.cells()[cell(5, PAINT_UP - 5)], 0);
  const around = createStroke({ ...BRUSH_DEFAULTS, stroke: 'around', soft: 0, sizeMm: 15 }, wall);
  around.to(0.1, 0.5);
  assert.equal(around.cells()[cell(PAINT_AROUND - 3, PAINT_UP / 2)], 0);
  assert.equal(around.cells()[cell(3, 5)], 255);
});

test('the brush is never more than half the pot high', () => {
  assert.equal(maxBrushMm(400), 120);
  assert.equal(maxBrushMm(60), 30);
  assert.equal(maxBrushMm(5), 4);
});

test('the preview carries the plain wall as a grid to paint on', () => {
  const radiusOf = (g, i) => Math.sqrt(g.positions[i] * g.positions[i] + g.positions[i + 1] * g.positions[i + 1]);
  const g = computePreview(cylinder({ height: 30, radius: 30 }), { library }).wallGrid;
  assert.equal(g.around, WALL_GRID.around);
  assert.equal(g.up, WALL_GRID.up);
  assert.equal(g.heightMm, 30);
  assert.equal(g.positions.length, (g.up + 1) * g.around * 3);
  assert.equal(g.reachMm, 1.5);
  for (let i = 0; i < g.positions.length; i += 3) assert.ok(Math.abs(radiusOf(g, i) - 30) < 1e-3);
  assert.equal(g.positions[2], 0);
  assert.equal(g.positions.at(-1), 30);
  // With a Pattern the grid is still the plain wall, and the reach grows by its depth.
  const patterned = computePreview(potWith(null), { library }).wallGrid;
  assert.equal(patterned.reachMm, 1.5 + 0.75);
  for (let i = 0; i < patterned.positions.length; i += 3) assert.ok(Math.abs(radiusOf(patterned, i) - 30) < 1e-3);
});
