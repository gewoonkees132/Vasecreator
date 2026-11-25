// Tests for the 2D editor (pattern studio D45, D46, §6): its grid geometry
// (the tile in the middle, the repeats round it, true proportions, taps in
// the repeats) and what a session starts from and writes into the design
// (ui/pattern-actions.js), for the Pattern and the Detailed morph.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDesign } from '../core/design.js';
import { computePreview } from '../core/engine.js';
import { emptyGrid, gridOf, paintCell, recipeOf, selectionMask, invertCells } from '../core/bitmap.js';
import { gridView, hitCell, cellBox, lineThrough, sameKind, describeSelection } from '../ui/pattern-editor.js';
import {
  EDITOR_MAX, NEW_GRID, OWN_PATTERN_DEFAULTS, editorStart, writeEditorDrawing, editableEntry, detailTileFor,
  targetDrawingId, setLayerPattern, findLayerEntry, mineEntries, layerMineEntries, assetUses,
} from '../ui/pattern-actions.js';
import { drawingDefaults } from '../core/layer-pattern.js';
import { library, presets } from './support/fixtures.js';

const classic = () => normaliseDesign(presets[0]);
const PATTERN = { kind: 'pattern' };
const slotA = { kind: 'detail', slot: 'a' };
const slotB = { kind: 'detail', slot: 'b' };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
/** What the editor does on each edit: the session's drawing into a copy of the design. */
function written(design, start, grid, edges) {
  const d = structuredClone(design);
  writeEditorDrawing(d, start, recipeOf(grid, edges));
  return normaliseDesign(d);
}

// ---------- Geometry ----------

test('the tile sits in the middle at the cells\' true proportions, with the repeats round it', () => {
  // A Pattern cell 3 mm around by 1.5 mm up: twice as wide as tall.
  const v = gridView(400, 300, 8, 8, 0.5);
  close(v.ch / v.cw, 0.5);
  close(v.ox * 2 + v.tw, 400);
  close(v.oy * 2 + v.th, 300);
  assert.ok(v.tw <= 400 * 0.8 + 1e-9 && v.th <= 300 * 0.8 + 1e-9);
  // Some of every neighbouring repeat shows.
  assert.ok(v.c0 < 0 && v.c1 >= 8 && v.r0 < 0 && v.r1 >= 8);
});

test('small tiles stop growing and show more repeats instead', () => {
  const v = gridView(360, 200, 2, 1, 0.5);    // Rib 1×1
  assert.ok(v.cw <= 80 && v.ch <= 56);
  assert.ok(v.c1 - v.c0 + 1 >= 360 / 80);
  const tall = gridView(360, 200, 6, 12, 0.5);  // Diamond
  close(tall.th, 200 * 0.8);
});

test('a tap in a dimmed repeat is the tile\'s own cell', () => {
  const v = gridView(400, 300, 4, 3, 1);
  const inside = cellBox(v, 2, 1);
  assert.deepEqual(hitCell(v, inside.x + inside.w / 2, inside.y + inside.h / 2), { vc: 2, vr: 1, c: 2, r: 1 });
  // Row 0 is the bottom row: the bottom of the tile is the first layer.
  const bottom = cellBox(v, 0, 0);
  assert.ok(bottom.y + bottom.h <= v.oy + v.th + 1e-9 && bottom.y + bottom.h > v.oy + v.th - 1e-9);
  // One repeat to the left and one up.
  const box = cellBox(v, -3, 4);
  assert.deepEqual(hitCell(v, box.x + 1, box.y + 1), { vc: -3, vr: 4, c: 1, r: 1 });
});

test('selection tools make the core selections, and say what they hold', () => {
  assert.deepEqual(lineThrough('row', 2, 5), { kind: 'row', r: 5 });
  assert.deepEqual(lineThrough('column', 2, 5), { kind: 'column', c: 2 });
  assert.deepEqual(lineThrough('diagUp', 2, 5), { kind: 'diagonal', c: 2, r: 5, dir: 1 });
  assert.deepEqual(lineThrough('diagDown', 2, 5), { kind: 'diagonal', c: 2, r: 5, dir: -1 });
  assert.ok(sameKind(lineThrough('diagDown', 0, 0), 'diagDown') && !sameKind(lineThrough('diagUp', 0, 0), 'diagDown'));
  assert.equal(describeSelection(null), 'the whole tile');
  assert.equal(describeSelection({ kind: 'row', r: 0 }), 'row 1');
  assert.equal(describeSelection({ kind: 'rect', c0: 3, r0: 1, c1: 1, r1: 1 }), '3 × 1 cells');
});

// ---------- Starting a session ----------

test('Make your own starts an empty grid under a new id of your own', () => {
  const d = classic();
  const s = editorStart(d, library, PATTERN, 'make');
  assert.match(s.id, /^user:[0-9a-f]{8}$/);
  assert.deepEqual([s.recipe.columns, s.recipe.rows], [NEW_GRID.pattern.columns, NEW_GRID.pattern.rows]);
  assert.equal(s.recipe.cells, '0'.repeat(64));
  assert.equal(s.recipe.edges, undefined);
  assert.equal(s.label, 'Edited pattern');
  const t = editorStart(d, library, slotA, 'make');
  assert.deepEqual([t.recipe.columns, t.recipe.rows, t.recipe.edges], [6, 4, 'soft']);
  assert.equal(t.label, 'Edited Detailed morph A');
  assert.notEqual(s.id, t.id);
});

test('Edit opens a starter as a copy and your own drawing in place', () => {
  const d = classic();
  setLayerPattern(d, findLayerEntry(library, 'lib:knit@1'));
  const copy = editorStart(d, library, PATTERN, 'edit');
  assert.notEqual(copy.id, 'lib:knit@1');
  assert.equal(copy.name, 'Knit (mine)');
  assert.equal(copy.recipe.cells, findLayerEntry(library, 'lib:knit@1').recipe.cells);
  assert.deepEqual(copy.opened, { drawing: 'lib:knit@1', cells: copy.recipe.cells });

  const mine = written(d, copy, gridOf(copy.recipe));
  const again = editorStart(mine, library, PATTERN, 'edit');
  assert.equal(again.id, copy.id);
  assert.equal(again.name, 'Knit (mine)');
});

test('Edit shows only for a drawing the editor can open', () => {
  const d = classic();
  assert.equal(editableEntry(d, library, PATTERN), null);                 // no Pattern yet
  assert.equal(editableEntry(d, library, slotA), null);                   // flutes: an analytic shape
  d.form.detail.a.pattern = 'lib:out-in-out@1';                           // a library bitmap
  assert.equal(editableEntry(d, library, slotA).id, 'lib:out-in-out@1');
  assert.equal(editableEntry(d, library, slotB), null);
});

test('a drawing of your own that two places use is edited as a copy', () => {
  const d = classic();
  const s = editorStart(d, library, slotA, 'make');
  const one = written(d, s, paintCell(gridOf(s.recipe), 0, 0, 1));
  one.form.detail.b = { ...one.form.detail.a };
  assert.equal(assetUses(one, s.id), 2);
  assert.notEqual(editorStart(one, library, slotA, 'edit').id, s.id);
});

// ---------- Writing the drawing ----------

test('a first drawn Pattern starts as deep and dense as the starters, and prints node for node', () => {
  const d = classic();
  const s = editorStart(d, library, PATTERN, 'make');
  let g = gridOf(s.recipe);
  g = paintCell(g, 0, 0, 1);
  g = paintCell(g, 1, 0, -1);
  const out = written(d, s, g);
  const want = drawingDefaults(out, OWN_PATTERN_DEFAULTS);
  assert.equal(out.pattern.drawing, s.id);
  assert.equal(out.pattern.depthMm, want.depthMm);
  assert.deepEqual(out.pattern.density, want.density);
  assert.equal(out.assets[s.id].recipe.cells, recipeOf(g).cells);
  assert.equal(targetDrawingId(out, PATTERN), s.id);
  // It previews, with a readout, and without warnings on the default pot.
  const preview = computePreview(out, { library });
  assert.equal(preview.pattern.columns, 8);
  assert.deepEqual(preview.warnings.filter((w) => w.severity !== 'ok').map((w) => w.id), []);
});

test('drawing over a Pattern keeps its depth, density, range, Fade and Soften', () => {
  const d = classic();
  setLayerPattern(d, findLayerEntry(library, 'lib:seed@1'));
  d.pattern.fade = { shape: 'fadesUp', amount: 0.5 };
  d.pattern.softenCells = 0.5;
  const before = structuredClone(d.pattern);
  const s = editorStart(d, library, PATTERN, 'edit');
  const out = written(d, s, invertCells(gridOf(s.recipe), selectionMask(gridOf(s.recipe), { kind: 'row', r: 0 })));
  assert.deepEqual({ ...out.pattern, drawing: before.drawing }, before);
  assert.equal(out.pattern.drawing, s.id);
});

test('a Pattern drawing you replace goes, so it never shows among the Detailed morph\'s swatches', () => {
  const d = classic();
  const s = editorStart(d, library, PATTERN, 'make');
  const mine = written(d, s, paintCell(gridOf(s.recipe), 0, 0, 1));
  assert.deepEqual(layerMineEntries(library, mine).map((e) => e.id), [s.id]);
  assert.ok(!mineEntries(library, mine, []).some((e) => e.id === s.id));
  // Picking a starter takes it off, and nothing else draws with it, so it goes.
  setLayerPattern(mine, findLayerEntry(library, 'lib:knit@1'));
  assert.equal(mine.assets?.[s.id], undefined);
  assert.ok(!mineEntries(library, mine, []).some((e) => e.id === s.id));
  // A drawing of your own the Detailed morph also uses stays.
  const both = written(d, s, paintCell(gridOf(s.recipe), 0, 0, 1));
  both.form.detail.a.pattern = s.id;
  setLayerPattern(both, null);
  assert.ok(both.assets[s.id]);
});

test('a Detailed morph grid on a textured slot keeps its repeats, tile height and depth', () => {
  const d = classic();
  const slot = d.form.detail.a;
  const s = editorStart(d, library, slotA, 'make');
  assert.deepEqual(s.base, { columns: 6, rows: 4, repeats: slot.repeats, tileHeightMm: slot.tileHeightMm });
  const out = written(d, s, paintCell(gridOf(s.recipe), 2, 1, 1), 'round');
  const a = out.form.detail.a;
  assert.deepEqual([a.pattern, a.repeats, a.tileHeightMm, a.depthMm], [s.id, slot.repeats, slot.tileHeightMm, slot.depthMm]);
  assert.equal(out.assets[s.id].recipe.edges, 'round');
  assert.equal(out.assets[s.id].recipe.cells.length, 24);
});

test('a Detailed morph grid keeps its cells their size when the tile grows', () => {
  const base = { columns: 6, rows: 4, repeats: 20, tileHeightMm: 19.5 };
  assert.deepEqual(detailTileFor(base, 6, 4, 1.5), { repeats: 20, tileHeightMm: 19.5 });
  // One row taller: one cell height (4.875 mm) more, in whole layers.
  assert.deepEqual(detailTileFor(base, 6, 5, 1.5), { repeats: 20, tileHeightMm: 24 });
  assert.deepEqual(detailTileFor(base, 6, 8, 1.5), { repeats: 20, tileHeightMm: 39 });
  // Two columns wider: the wall of two more cells, so fewer repeats fit around.
  assert.deepEqual(detailTileFor(base, 8, 4, 1.5), { repeats: 15, tileHeightMm: 19.5 });
  assert.equal(detailTileFor({ ...base, repeats: 1 }, 16, 4, 1.5).repeats, 1);
});

test('a grid on an empty slot B brings in B with your own defaults and a blend', () => {
  const d = classic();
  d.form.detail.b = null;
  const s = editorStart(d, library, slotB, 'make');
  assert.deepEqual([s.base.repeats, s.base.tileHeightMm], [8, 19.5]);
  const out = written(d, s, paintCell(gridOf(s.recipe), 0, 0, -1), 'soft');
  assert.equal(out.form.detail.b.pattern, s.id);
  assert.equal(out.form.detail.b.depthMm, 1.5);
  assert.equal(out.form.detail.blend.shape, 'fadesUp');
  // The Detailed morph's own swatches list it; the Pattern's don't.
  assert.ok(mineEntries(library, out, []).some((e) => e.id === s.id));
  assert.deepEqual(layerMineEntries(library, out), []);
});

test('the editor\'s limits: a Pattern up to 64 cells a side, a Detailed morph grid up to 16', () => {
  assert.deepEqual({ ...EDITOR_MAX }, { pattern: 64, detail: 16 });
  const big = emptyGrid(64, 64);
  const d = classic();
  const out = written(d, editorStart(d, library, PATTERN, 'make'), paintCell(big, 63, 63, 1));
  assert.equal(out.assets[out.pattern.drawing].recipe.cells.length, 64 * 64);
});
