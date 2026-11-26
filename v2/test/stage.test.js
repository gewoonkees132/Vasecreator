// Tests for the mobile stage (docs/design/v2-mobile-stage.md): the ruler
// dial's math, the dock's tools per step and the pattern actions the dock
// and the Pattern section share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDesign, cloneDesign } from '../core/design.js';
import { pxPerStep, dragPosition, snapToStep, wrapNear, wrap } from '../ui/dial.js';
import { DOCK_TOOLS, toolsFor, currentTool, drawingInfo, openGroup } from '../ui/dock-tools.js';
import { findLayerEntry, setLayerPattern } from '../ui/pattern-actions.js';
import { shapeOnly } from '../ui/steps.js';
import { library, presets } from './support/fixtures.js';

const state = (design, view = {}) => ({ design, view: { step: 'shape', tools: {}, sizeLocked: true, ...view } });
const env = { library };
const ids = (list) => list.map((t) => t.id);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// ---------- The dial ----------

test('dial: short ranges get wide ticks, long ranges and angles narrow ones', () => {
  assert.equal(pxPerStep(0, 20, 1), 18);       // base layers
  assert.equal(pxPerStep(0, 8, 0.1), 12);      // pattern depth, 80 steps
  assert.equal(pxPerStep(20, 1000, 1), 8);     // height
  assert.equal(pxPerStep(0, 359, 1, true), 8); // seam angle wraps
});

test('dial: dragging the ticks left brings higher values under the mark', () => {
  assert.equal(dragPosition(170, -80, 8, 1), 180);
  assert.equal(dragPosition(170, 80, 8, 1), 160);
  close(dragPosition(1.5, -24, 12, 0.1), 1.7);
});

test('dial: values land on the grid of whole steps', () => {
  assert.equal(snapToStep(172.4, 1), 172);
  assert.equal(snapToStep(0.30000000000000004, 0.1), 0.3);
  assert.equal(snapToStep(20.2, 1.5), 19.5);   // a tile height in whole 1.5 mm layers
});

test('dial: a wrapped angle takes the short way round', () => {
  assert.equal(wrapNear(5, 350, 360), 365);
  assert.equal(wrapNear(355, 10, 360), -5);
  assert.equal(wrapNear(90, 80, 360), 90);
  assert.equal(wrap(-5, 360), 355);
  assert.equal(wrap(725, 360), 5);
});

// ---------- The tools per step ----------

test('dock: every step but Print has tools; Print is the sheet', () => {
  const s = state(normaliseDesign(presets[0]));
  for (const step of ['shape', 'pattern', 'layers', 'base']) assert.ok(toolsFor(step, s).length > 0, step);
  assert.deepEqual(toolsFor('print', s), []);
});

test('dock: Shape\'s Morph is a plain tool that opens the sheet; the one group is the Pattern\'s Paint (D85)', () => {
  const s = state(normaliseDesign(presets[0]), { tools: { shape: 'morph' } });
  const morph = DOCK_TOOLS.shape.find((t) => t.id === 'morph');
  assert.equal(morph.kind, 'sheet');
  assert.equal(morph.part, 'morph');
  assert.equal(morph.value(s), 'Off');
  assert.equal(currentTool('shape', s).id, 'morph');
  for (const step of Object.keys(DOCK_TOOLS)) {
    assert.deepEqual(ids(DOCK_TOOLS[step].filter((t) => t.kind === 'group' || t.kind === 'patterns')), step === 'pattern' ? ['paint'] : [], step);
    assert.equal(openGroup(step, s), null);
  }
});

test('dock: Corners only for a rectangle', () => {
  const round = normaliseDesign(presets[0]);
  const square = normaliseDesign(presets[2]);
  assert.ok(!ids(toolsFor('shape', state(round))).includes('corners'));
  assert.ok(ids(toolsFor('shape', state(square))).includes('corners'));
});

test('dock: the Pattern step shows the drawings, and every tool once there is a Pattern', () => {
  const d = normaliseDesign(presets[0]);
  const s = (view) => state(d, { step: 'pattern', ...view });
  assert.deepEqual(ids(toolsFor('pattern', s())), ['drawing']);
  assert.equal(drawingInfo(s(), library).name, 'None');
  setLayerPattern(d, findLayerEntry(library, 'lib:knit@1'));
  assert.deepEqual(ids(toolsFor('pattern', s())), ['drawing', 'depth', 'sits', 'density', 'from', 'to', 'fade', 'paint', 'soften', 'slant']);
  assert.equal(drawingInfo(s(), library).name, 'Knit');
  // The fade's amount once it fades.
  d.pattern.fade.shape = 'diagonal';
  assert.deepEqual(ids(toolsFor('pattern', s())), ['drawing', 'depth', 'sits', 'density', 'from', 'to', 'fade', 'fadeAmount', 'paint', 'soften', 'slant']);
  const density = DOCK_TOOLS.pattern.find((t) => t.id === 'density');
  assert.match(density.dial(s(), env).note, /^\d+ points per layer · \d+\.\d–\d+\.\d mm · [\d,]+ in all$/);
  assert.equal(density.dial(s(), env).label, 'Spacing');
  d.pattern.density.by = 'points';
  const spec = density.dial(s(), env);
  assert.equal(spec.label, 'Points per layer');
  assert.equal(spec.step, 4, 'whole tiles of the 4-column knit');
  assert.equal(spec.value % 4, 0);
});

test('dock: every dial starts inside its own range on every preset', () => {
  for (const preset of presets) {
    for (const drawing of [null, ...library.layerPatterns.map((p) => p.id)]) {
      const d = normaliseDesign(preset);
      if (drawing) setLayerPattern(d, findLayerEntry(library, drawing));
      for (const by of ['spacing', 'points']) {
        if (d.pattern) d.pattern.density.by = by;
        const views = [];
        for (const step of Object.keys(DOCK_TOOLS)) views.push({ step });
        for (const view of views) {
          const s = state(d, view);
          for (const t of toolsFor(view.step, s).filter((x) => x.kind === 'dial')) {
            const spec = t.dial(s, env);
            const name = `${preset.meta.name} ${drawing ?? ''} ${view.step} ${t.id}`;
            assert.ok(spec.step > 0, `${name} step`);
            assert.ok(Number.isFinite(spec.value), `${name} value`);
            if (!spec.wrap) assert.ok(spec.min <= spec.value + 1e-9 && spec.value <= spec.max + 1e-9, `${name}: ${spec.min} ≤ ${spec.value} ≤ ${spec.max}`);
            assert.equal(typeof t.value(s, env), 'string');
          }
        }
      }
    }
  }
});

test('dock: tools edit the design like the sheet does', () => {
  const tool = (step, id) => DOCK_TOOLS[step].find((t) => t.id === id);
  const d = normaliseDesign(presets[0]);
  const s = state(d);

  const h = cloneDesign(d);
  tool('shape', 'height').set(h, 200, s);
  assert.equal(h.form.height, 200);
  assert.equal(h.form.profile.knots.at(-1).z, 200);

  const c = cloneDesign(normaliseDesign(presets[2]));
  tool('shape', 'corners').set(c, 40, s);
  assert.equal(c.form.plan.cornerRounding, 0.4);

  // The Pattern's From and To stay a layer apart; its depth stays under two thirds of a bead (D61).
  const pr = cloneDesign(d);
  setLayerPattern(pr, findLayerEntry(library, 'lib:seed@1'));
  tool('pattern', 'from').set(pr, 1000, s);
  assert.equal(pr.pattern.fromMm, pr.pattern.toMm - pr.layers.layerHeightMm);
  tool('pattern', 'depth').set(pr, 9, s);
  assert.equal(pr.pattern.depthMm, 5.33);

  // The seam angle wraps.
  const a = cloneDesign(d);
  tool('layers', 'angle').set(a, 370, s);
  assert.equal(a.layers.seam.angleDeg, 10);
  tool('layers', 'angle').set(a, -5, s);
  assert.equal(a.layers.seam.angleDeg, 355);

  // Fade amount in per cent.
  setLayerPattern(pr, findLayerEntry(library, 'lib:seed@1'));
  pr.pattern.fade.shape = 'fadesUp';
  tool('pattern', 'fadeAmount').set(pr, 35, s);
  close(pr.pattern.fade.amount, 0.35);
});

test('dock: the hole dial is off without a floor', () => {
  const d = normaliseDesign(presets[2]);
  d.base.layers = 0;
  const spec = DOCK_TOOLS.base.find((t) => t.id === 'hole').dial(state(d));
  assert.equal(spec.disabled, true);
});

test('dock: depth follows width while locked', () => {
  const d = normaliseDesign(presets[0]);
  const depth = DOCK_TOOLS.shape.find((t) => t.id === 'depth');
  assert.equal(depth.dial(state(d)).disabled, true);
  assert.equal(depth.dial(state(d, { sizeLocked: false })).disabled, false);
});

// ---------- Pattern actions (shared by the sheet and the carousel) ----------

test('shapeOnly keeps the whole form, the Morph included, and leaves out only the Pattern', () => {
  const d = normaliseDesign(presets[0]);
  setLayerPattern(d, findLayerEntry(library, 'lib:knit@1'));
  d.form.morph = { map: 'lib:lobes@1', softnessMm: 24, strengthMm: 6, repeats: 4, blend: 0.8 };
  const shape = shapeOnly(d);
  assert.equal(shape.pattern, null);
  assert.deepEqual(shape.form, d.form);
  assert.equal(shape.form.morph.map, 'lib:lobes@1');
  assert.equal(d.pattern.drawing, 'lib:knit@1', 'the design given is not changed');
});

// ---------- Paint (D79–D87, docs/design/v2-paint-brush.md) ----------

test('dock: Paint opens a row of brush tools that set the view, never the design', async () => {
  const { brushOf, paintActive, hasPaint, normaliseBrush, wallOf } = await import('../ui/paint.js');
  const d = normaliseDesign(presets[0]);
  const paint = DOCK_TOOLS.pattern.find((t) => t.id === 'paint');
  assert.equal(paint.kind, 'group');
  // Nothing to paint without a Pattern.
  assert.ok(!ids(toolsFor('pattern', state(d, { step: 'pattern' }))).includes('paint'));
  setLayerPattern(d, findLayerEntry(library, 'lib:knit@1'));
  const brush = normaliseBrush(null);
  const s = (view) => state(d, { step: 'pattern', mode: 'design', brush, tools: { pattern: 'paint' }, ...paint.open, ...view });
  assert.deepEqual(paint.open, { paint: true, paintTurn: false });
  assert.deepEqual(paint.close, { paint: false, paintTurn: false });
  assert.ok(paintActive(s()));
  assert.ok(!paintActive(s({ step: 'layers' })));
  assert.ok(!paintActive(s({ editor: 'pattern' })));
  // One row for Paint and for Turn, so the tool picked stays picked.
  const g = openGroup('pattern', s());
  assert.equal(g.mode, 'paint');
  assert.equal(openGroup('pattern', s({ paintTurn: true })).mode, 'turn');
  assert.equal(openGroup('pattern', s({ paintTurn: true })).key, g.key);
  assert.deepEqual(paint.setMode('turn'), { paintTurn: true });
  assert.deepEqual(ids(toolsFor('pattern', s())), ['paintMore', 'paintStroke', 'paintSize', 'paintSoft', 'paintStrength', 'paintReset']);
  // A fade has no brush to size.
  assert.deepEqual(ids(toolsFor('pattern', s({ brush: { ...brush, stroke: 'fade' } }))), ['paintMore', 'paintStroke', 'paintStrength', 'paintReset']);
  const tool = (id) => toolsFor('pattern', s()).find((t) => t.id === id);
  assert.ok(toolsFor('pattern', s()).every((t) => t.view || t.kind === 'action'));
  assert.equal(tool('paintSize').value(s()), '30 mm');
  assert.equal(tool('paintSize').setView(52, s()).brush.sizeMm, 52);
  assert.equal(tool('paintSize').setView(500, s()).brush.sizeMm, 120);
  assert.equal(tool('paintSoft').setView(25, s()).brush.soft, 0.25);
  assert.equal(tool('paintStrength').setView(1, s()).brush.strength, 0.05);
  assert.equal(tool('paintMore').chooseView('more', s()).brush.more, true);
  assert.equal(tool('paintStroke').chooseView('around', s()).brush.stroke, 'around');
  assert.equal(brushOf(s({ brush: { ...brush, stroke: 'line' } })).stroke, 'line');
  // The brush on a short pot is never more than half its height.
  const short = normaliseDesign({ ...d, form: { ...d.form, height: 40 } });
  assert.equal(tool('paintSize').dial(state(short, { step: 'pattern', brush })).max, 20);
  // Reset has something to do only once something is painted.
  assert.equal(tool('paintReset').enabled(s()), false);
  assert.equal(hasPaint(d), false);
  const wall = wallOf(d);
  assert.equal(wall.before, null);
  assert.equal(wall.heightMm, d.form.height);
  assert.ok(wall.perimeterAt(0.5) > 100);
});
