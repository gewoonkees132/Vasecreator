// Tests for the mobile stage (docs/design/v2-mobile-stage.md): the ruler
// dial's math, the dock's tools per step and the pattern actions the dock
// and the Pattern section share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDesign, cloneDesign, snapTileHeight } from '../core/design.js';
import { pxPerStep, dragPosition, snapToStep, wrapNear, wrap } from '../ui/dial.js';
import { DOCK_TOOLS, toolsFor, currentTool, toolName, slotInfo } from '../ui/dock-tools.js';
import { setSlotPattern, findEntry, snapToLayers, textured, mineEntries } from '../ui/pattern-actions.js';
import { shapeOnly } from '../ui/steps.js';
import { library, presets } from './support/fixtures.js';

const state = (design, view = {}) => ({ design, view: { step: 'shape', slot: 'a', tools: {}, sizeLocked: true, ...view } });
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

test('dock: a new (plain) design shows only the slots in Pattern, and the tools grow as patterns are picked (C34)', () => {
  const d = shapeOnly(normaliseDesign(presets[0]));
  assert.deepEqual(ids(toolsFor('pattern', state(d, { step: 'pattern' }))), ['a', 'b']);
  setSlotPattern(d, 'a', 'lib:ribs@1', findEntry(library, 'lib:ribs@1'));
  assert.deepEqual(ids(toolsFor('pattern', state(d, { step: 'pattern' }))), ['a', 'b', 'depth', 'repeats', 'tile', 'from', 'to']);
  setSlotPattern(d, 'b', 'lib:dots@1', findEntry(library, 'lib:dots@1'));
  assert.deepEqual(ids(toolsFor('pattern', state(d, { step: 'pattern' }))), ['a', 'b', 'depth', 'repeats', 'tile', 'from', 'to', 'blend', 'amount']);
});

test('dock: the slot tools follow the chosen slot; a picked tool stays while it applies', () => {
  const d = normaliseDesign(presets[0]);
  assert.equal(currentTool('pattern', state(d, { step: 'pattern', slot: 'b' })).id, 'b');
  assert.equal(currentTool('pattern', state(d, { step: 'pattern', slot: 'a', tools: { pattern: 'b' } })).id, 'a');
  assert.equal(currentTool('pattern', state(d, { step: 'pattern', tools: { pattern: 'repeats' } })).id, 'repeats');
  // Depth no longer applies on a plain slot: back to the first tool.
  const plain = shapeOnly(d);
  assert.equal(currentTool('pattern', state(plain, { step: 'pattern', tools: { pattern: 'depth' } })).id, 'a');
  assert.equal(currentTool('shape', state(d)).id, 'points');
});

test('dock: per-slot tools say which slot they edit once B is in use', () => {
  const d = normaliseDesign(presets[0]);   // Classic vase: A flutes, B plain
  const depth = DOCK_TOOLS.pattern.find((t) => t.id === 'depth');
  assert.equal(toolName(depth, state(d, { slot: 'a' })), 'Depth A');
  d.form.detail.b = null;
  assert.equal(toolName(depth, state(d, { slot: 'a' })), 'Depth');
});

test('dock: every dial starts inside its own range on every preset', () => {
  for (const preset of presets) {
    const d = normaliseDesign(preset);
    for (const step of Object.keys(DOCK_TOOLS)) {
      for (const slot of ['a', 'b']) {
        const s = state(d, { step, slot });
        for (const t of toolsFor(step, s).filter((x) => x.kind === 'dial')) {
          const spec = t.dial(s);
          assert.ok(spec.step > 0, `${preset.meta.name} ${t.id} step`);
          assert.ok(Number.isFinite(spec.value), `${preset.meta.name} ${t.id} value`);
          if (!spec.wrap) assert.ok(spec.min <= spec.value + 1e-9 && spec.value <= spec.max + 1e-9, `${preset.meta.name} ${t.id}: ${spec.min} ≤ ${spec.value} ≤ ${spec.max}`);
          assert.equal(typeof t.value(s), 'string');
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
  tool('pattern', 'tile').set(t, 20.2, state(t, { slot: 'a' }));
  assert.equal(t.form.detail.a.tileHeightMm, snapTileHeight(20.2, t.layers.layerHeightMm));

  // From stays under To and To above From.
  const r = cloneDesign(d);
  tool('pattern', 'from').set(r, 1000, s);
  assert.equal(r.form.detail.fromMm, r.form.detail.toMm - 1);
  tool('pattern', 'to').set(r, 0, s);
  assert.equal(r.form.detail.toMm, r.form.detail.fromMm + 1);

  // The seam angle wraps.
  const a = cloneDesign(d);
  tool('layers', 'angle').set(a, 370, s);
  assert.equal(a.layers.seam.angleDeg, 10);
  tool('layers', 'angle').set(a, -5, s);
  assert.equal(a.layers.seam.angleDeg, 355);

  // Blend amount in per cent.
  const b = cloneDesign(d);
  tool('pattern', 'amount').set(b, 35, s);
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
  const d = shapeOnly(normaliseDesign(presets[0]));
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

test('patterns: snapToLayers rounds to whole layers and respects the core minimum', () => {
  assert.equal(snapToLayers(20, 1.5), 19.5);
  assert.ok(snapToLayers(0.1, 1.5) >= 1.5);
});
