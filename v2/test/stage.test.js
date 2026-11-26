// Tests for the mobile stage (docs/design/v2-mobile-stage.md): the ruler
// dial's math, the dock's tools per step and the pattern actions the dock
// and the Pattern section share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDesign, cloneDesign, snapTileHeight } from '../core/design.js';
import { pxPerStep, dragPosition, snapToStep, wrapNear, wrap } from '../ui/dial.js';
import { DOCK_TOOLS, toolsFor, currentTool, toolName, slotInfo, drawingInfo, morphMode, openGroup } from '../ui/dock-tools.js';
import {
  setSlotPattern, findEntry, snapToLayers, textured, mineEntries, findLayerEntry, setLayerPattern, layerMineEntries,
} from '../ui/pattern-actions.js';
import { shapeOnly } from '../ui/steps.js';
import { library, presets } from './support/fixtures.js';

const state = (design, view = {}) => ({ design, view: { step: 'shape', slot: 'a', tools: {}, sizeLocked: true, ...view } });
const env = { library };
/** The Detailed morph's tools: Shape's Morph tool, opened on its Detailed side (D36). */
const detailed = (design, view = {}) => state(design, { tools: { shape: 'morph' }, morphKind: 'detailed', ...view });
const detailTool = (id) => DOCK_TOOLS.shape.find((t) => t.id === 'morph').tools.detailed.find((t) => t.id === id);
/** A design whose Detailed morph is plain: slot A Plain, no B. */
function plainDetail(d) {
  d.form.detail.a = { pattern: 'plain', depthMm: 0, repeats: 1, tileHeightMm: d.form.detail.a.tileHeightMm };
  d.form.detail.b = null;
  return d;
}
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

test('dock: Corners only for a rectangle', () => {
  const round = normaliseDesign(presets[0]);
  const square = normaliseDesign(presets[2]);
  assert.ok(!ids(toolsFor('shape', state(round))).includes('corners'));
  assert.ok(ids(toolsFor('shape', state(square))).includes('corners'));
});

test('dock: Shape\'s Morph tool opens a row of its own, Large or Detailed (D36)', () => {
  const d = normaliseDesign(presets[0]);   // Classic vase: flutes, no Morph
  assert.equal(DOCK_TOOLS.shape.find((t) => t.id === 'morph').kind, 'group');
  assert.equal(openGroup('shape', state(d)), null);
  // A pot with a Detailed morph and no Morph opens on Detailed; the side picked last wins.
  assert.equal(morphMode(state(d)), 'detailed');
  assert.equal(morphMode(state(d, { morphKind: 'large' })), 'large');
  assert.equal(morphMode(state(plainDetail(normaliseDesign(presets[0])))), 'large');
  assert.deepEqual(ids(toolsFor('shape', state(d, { tools: { shape: 'morph' }, morphKind: 'large' }))), ['morph']);
  assert.equal(currentTool('shape', state(d, { tools: { shape: 'morph' }, morphKind: 'large' })).kind, 'sheet');
  // Back (no tool picked) is the step's own row again.
  assert.equal(currentTool('shape', state(d, { tools: { shape: null } })).id, 'points');
  assert.equal(DOCK_TOOLS.shape.find((t) => t.id === 'morph').value(state(d)), 'Detailed');
});

test('dock: a plain Detailed morph shows only its slots, and its tools grow as swatches are picked (C34)', () => {
  const d = plainDetail(normaliseDesign(presets[0]));
  assert.deepEqual(ids(toolsFor('shape', detailed(d))), ['a', 'b']);
  setSlotPattern(d, 'a', 'lib:ribs@1', findEntry(library, 'lib:ribs@1'));
  assert.deepEqual(ids(toolsFor('shape', detailed(d))), ['a', 'b', 'depth', 'repeats', 'tile', 'from', 'to']);
  setSlotPattern(d, 'b', 'lib:dots@1', findEntry(library, 'lib:dots@1'));
  assert.deepEqual(ids(toolsFor('shape', detailed(d))), ['a', 'b', 'depth', 'repeats', 'tile', 'from', 'to', 'blend', 'amount']);
  // The blend offers Diagonal (D54).
  assert.ok(detailTool('blend').options.some((o) => o.value === 'diagonal'));
});

test('dock: the slot tools follow the chosen slot; a picked tool stays while it applies', () => {
  const d = normaliseDesign(presets[0]);
  assert.equal(currentTool('shape', detailed(d, { slot: 'b' })).id, 'b');
  assert.equal(currentTool('shape', detailed(d, { slot: 'a', tools: { shape: 'morph', 'shape.morph.detailed': 'b' } })).id, 'a');
  assert.equal(currentTool('shape', detailed(d, { tools: { shape: 'morph', 'shape.morph.detailed': 'repeats' } })).id, 'repeats');
  // Depth no longer applies on a plain slot: back to the first tool.
  const plain = plainDetail(normaliseDesign(presets[0]));
  assert.equal(currentTool('shape', detailed(plain, { tools: { shape: 'morph', 'shape.morph.detailed': 'depth' } })).id, 'a');
  assert.equal(currentTool('shape', state(d)).id, 'points');
});

test('dock: per-slot tools say which slot they edit once B is in use', () => {
  const d = normaliseDesign(presets[0]);   // Classic vase: A flutes, B plain
  const depth = detailTool('depth');
  assert.equal(toolName(depth, state(d, { slot: 'a' })), 'Depth A');
  d.form.detail.b = null;
  assert.equal(toolName(depth, state(d, { slot: 'a' })), 'Depth');
});

test('dock: the Pattern step shows the drawings, and every tool once there is a Pattern', () => {
  const d = normaliseDesign(presets[0]);
  const s = (view) => state(d, { step: 'pattern', ...view });
  assert.deepEqual(ids(toolsFor('pattern', s())), ['drawing']);
  assert.equal(drawingInfo(s(), library).name, 'None');
  setLayerPattern(d, findLayerEntry(library, 'lib:knit@1'));
  assert.deepEqual(ids(toolsFor('pattern', s())), ['drawing', 'depth', 'density', 'from', 'to', 'fade', 'soften']);
  assert.equal(drawingInfo(s(), library).name, 'Knit');
  // The fade's amount once it fades.
  d.pattern.fade.shape = 'diagonal';
  assert.deepEqual(ids(toolsFor('pattern', s())), ['drawing', 'depth', 'density', 'from', 'to', 'fade', 'fadeAmount', 'soften']);
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
        for (const step of Object.keys(DOCK_TOOLS)) for (const slot of ['a', 'b']) views.push({ step, slot });
        for (const morphKind of ['large', 'detailed']) for (const slot of ['a', 'b']) views.push({ step: 'shape', slot, morphKind, tools: { shape: 'morph' } });
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

  // Tile heights snap to whole layers (C7).
  const t = cloneDesign(d);
  detailTool('tile').set(t, 20.2, state(t, { slot: 'a' }));
  assert.equal(t.form.detail.a.tileHeightMm, snapTileHeight(20.2, t.layers.layerHeightMm));

  // From stays under To and To above From.
  const r = cloneDesign(d);
  detailTool('from').set(r, 1000, s);
  assert.equal(r.form.detail.fromMm, r.form.detail.toMm - 1);
  detailTool('to').set(r, 0, s);
  assert.equal(r.form.detail.toMm, r.form.detail.fromMm + 1);

  // The Pattern's From and To stay a layer apart; its depth stays under half a bead.
  const pr = cloneDesign(d);
  setLayerPattern(pr, findLayerEntry(library, 'lib:seed@1'));
  tool('pattern', 'from').set(pr, 1000, s);
  assert.equal(pr.pattern.fromMm, pr.pattern.toMm - pr.layers.layerHeightMm);
  tool('pattern', 'depth').set(pr, 9, s);
  assert.equal(pr.pattern.depthMm, 1.5);

  // The seam angle wraps.
  const a = cloneDesign(d);
  tool('layers', 'angle').set(a, 370, s);
  assert.equal(a.layers.seam.angleDeg, 10);
  tool('layers', 'angle').set(a, -5, s);
  assert.equal(a.layers.seam.angleDeg, 355);

  // Blend amount in per cent.
  const b = cloneDesign(d);
  detailTool('amount').set(b, 35, s);
  close(b.form.detail.blend.amount, 0.35);
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

test('dock: slot chips name their pattern, or None', () => {
  const d = normaliseDesign(presets[1]);   // Twisted column: A pleats, no B
  assert.equal(slotInfo(state(d), library, 'a').name, 'Pleats');
  assert.equal(slotInfo(state(d), library, 'b').name, 'None');
});

// ---------- Pattern actions (shared by the sheet and the carousel) ----------

test('patterns: a library pattern on a plain slot gets its own defaults, in whole layers', () => {
  const d = plainDetail(normaliseDesign(presets[0]));
  const entry = findEntry(library, 'lib:diamonds@1');
  setSlotPattern(d, 'a', entry.id, entry);
  assert.equal(d.form.detail.a.pattern, 'lib:diamonds@1');
  assert.equal(d.form.detail.a.depthMm, entry.defaults.depthMm);
  assert.equal(d.form.detail.a.repeats, entry.defaults.repeats);
  const layers = d.form.detail.a.tileHeightMm / d.layers.layerHeightMm;
  close(layers, Math.round(layers));
});

test('patterns: switching texture keeps depth and repeats; None clears slot B', () => {
  const d = normaliseDesign(presets[1]);
  d.form.detail.a.depthMm = 3.3;
  d.form.detail.a.repeats = 7;
  setSlotPattern(d, 'a', 'lib:ribs@1', findEntry(library, 'lib:ribs@1'));
  assert.equal(d.form.detail.a.depthMm, 3.3);
  assert.equal(d.form.detail.a.repeats, 7);
  setSlotPattern(d, 'b', 'lib:dots@1', findEntry(library, 'lib:dots@1'));
  assert.equal(d.form.detail.blend.shape, 'fadesUp');
  assert.ok(textured(d.form.detail.b));
  setSlotPattern(d, 'b', null, null);
  assert.equal(d.form.detail.b, null);
});

test('patterns: your own recipe travels inside the design', () => {
  const d = normaliseDesign(presets[0]);
  const own = { id: 'user:abcd1234', name: 'Mine', recipe: library.patterns[0].recipe };
  setSlotPattern(d, 'a', own.id, own);
  assert.equal(d.assets[own.id].kind, 'recipe');
  assert.deepEqual(mineEntries(library, d, []).map((e) => e.id), [own.id]);
});

test('patterns: a drawing only the Pattern uses stays out of the Detailed morph\'s own swatches', () => {
  const d = normaliseDesign(presets[0]);
  const own = { id: 'user:feed0001', name: 'Mine', recipe: { kind: 'bitmap', columns: 2, rows: 1, cells: '+-' }, own: true };
  setLayerPattern(d, own);
  assert.deepEqual(mineEntries(library, d, []), []);
  assert.deepEqual(layerMineEntries(library, d).map((e) => e.id), [own.id]);
  // Once a slot uses it too, it is the Detailed morph's as well.
  setSlotPattern(d, 'a', own.id, findEntry(library, own.id, d.assets));
  assert.deepEqual(mineEntries(library, d, []).map((e) => e.id), [own.id]);
});

test('shapeOnly keeps the whole form, the Detailed morph included, and leaves out only the Pattern (D52)', () => {
  const d = normaliseDesign(presets[0]);
  setLayerPattern(d, findLayerEntry(library, 'lib:knit@1'));
  d.form.morph = { map: 'lib:lobes@1', softnessMm: 24, strengthMm: 6, repeats: 4, blend: 0.8 };
  const shape = shapeOnly(d);
  assert.equal(shape.pattern, null);
  assert.deepEqual(shape.form, d.form);
  assert.equal(shape.form.detail.a.pattern, 'lib:flutes@1');
  assert.equal(d.pattern.drawing, 'lib:knit@1', 'the design given is not changed');
});

test('patterns: snapToLayers rounds to whole layers and respects the core minimum', () => {
  assert.equal(snapToLayers(20, 1.5), 19.5);
  assert.ok(snapToLayers(0.1, 1.5) >= 1.5);
});
