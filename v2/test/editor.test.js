// Tests for the 2D editor (pattern studio D45, D46, §6): its grid geometry
// (the tile in the middle, the repeats round it, true proportions, taps in
// the repeats) and what a session starts from and writes into the design
// (ui/pattern-actions.js), for the Pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDesign } from '../core/design.js';
import { computePreview } from '../core/engine.js';
import { emptyGrid, gridOf, paintCell, recipeOf, selectionMask, invertCells, insertColumn, doubleRows, drawingId } from '../core/bitmap.js';
import {
  gridView, hitCell, cellBox, lineThrough, sameKind, describeSelection, zoomAt, pinchTo, panBy, MAX_ZOOM, MIN_CELL,
} from '../ui/pattern-editor.js';
import {
  EDITOR_MAX, NEW_GRID, editorStart, writeEditorDrawing, editableEntry,
  targetDrawingId, setLayerPattern, findLayerEntry, layerMineEntries, assetUses,
} from '../ui/pattern-actions.js';
import { drawingDefaults } from '../core/layer-pattern.js';
import { library, presets } from './support/fixtures.js';

const classic = () => normaliseDesign(presets[0]);
const PATTERN = { kind: 'pattern' };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
/** What the editor does on each edit: the session's drawing into a copy of the design. */
function written(design, start, grid) {
  const d = structuredClone(design);
  writeEditorDrawing(d, start, recipeOf(grid));
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

test('Make your own starts an empty grid; a drawing goes in under its content id', () => {
  const d = classic();
  const s = editorStart(d, library, PATTERN, 'make');
  assert.deepEqual([s.recipe.columns, s.recipe.rows], [NEW_GRID.pattern.columns, NEW_GRID.pattern.rows]);
  assert.equal(s.recipe.cells, '0'.repeat(36));
  assert.equal(s.recipe.edges, undefined);
  assert.equal(s.label, 'Edited pattern');
  assert.equal(s.name, 'My pattern');
  assert.equal(s.replaces, null);
  // The same drawing has the same id in every design; an edit gives a new one (D48, §9).
  const g = paintCell(gridOf(s.recipe), 0, 0, 1);
  const one = written(d, s, g);
  assert.equal(one.pattern.drawing, drawingId(recipeOf(g)));
  assert.match(one.pattern.drawing, /^user:[0-9a-f]{16}$/);
  assert.equal(written(classic(), s, g).pattern.drawing, one.pattern.drawing);
  assert.notEqual(written(d, s, paintCell(g, 1, 0, -1)).pattern.drawing, one.pattern.drawing);
});

test('Edit opens a starter as a copy and your own drawing in place', () => {
  const d = classic();
  setLayerPattern(d, findLayerEntry(library, 'lib:knit@1'));
  const copy = editorStart(d, library, PATTERN, 'edit');
  assert.equal(copy.replaces, null);
  assert.equal(copy.name, 'Knit (mine)');
  assert.equal(copy.recipe.cells, findLayerEntry(library, 'lib:knit@1').recipe.cells);
  assert.deepEqual(copy.opened, { drawing: 'lib:knit@1', cells: copy.recipe.cells });

  const mine = written(d, copy, gridOf(copy.recipe));
  const again = editorStart(mine, library, PATTERN, 'edit');
  assert.equal(again.replaces, mine.pattern.drawing);
  assert.equal(again.name, 'Knit (mine)');
  // Edited in place: the drawing it was goes, the new one takes its name.
  const edited = written(mine, again, paintCell(gridOf(again.recipe), 0, 0, -1));
  assert.notEqual(edited.pattern.drawing, mine.pattern.drawing);
  assert.equal(edited.assets[mine.pattern.drawing], undefined);
  assert.equal(edited.assets[edited.pattern.drawing].name, 'Knit (mine)');
});

test('Edit shows only for a drawing the editor can open', () => {
  const d = classic();
  assert.equal(editableEntry(d, library, PATTERN), null);                 // no Pattern yet
  setLayerPattern(d, findLayerEntry(library, 'lib:knit@1'));              // a starter
  assert.equal(editableEntry(d, library, PATTERN).id, 'lib:knit@1');
  d.pattern.drawing = 'user:gone';                                        // a drawing the design doesn't carry
  assert.equal(editableEntry(d, library, PATTERN), null);
});

test('a drawing of your own counts where it draws: the Pattern, once', () => {
  const d = classic();
  const s = editorStart(d, library, PATTERN, 'make');
  const one = written(d, s, paintCell(gridOf(s.recipe), 0, 0, 1));
  assert.equal(assetUses(one, one.pattern.drawing), 1);
  assert.equal(assetUses(one, 'user:nothing'), 0);
  // So an edit of it is in place: it goes once the edit replaces it.
  assert.equal(editorStart(one, library, PATTERN, 'edit').replaces, one.pattern.drawing);
});

test('a first drawn Pattern starts as deep and dense as the starters, and prints node for node', () => {
  const d = classic();
  const s = editorStart(d, library, PATTERN, 'make');
  let g = gridOf(s.recipe);
  g = paintCell(g, 0, 0, 1);
  g = paintCell(g, 1, 0, -1);
  const out = written(d, s, g);
  const id = drawingId(recipeOf(g));
  const want = drawingDefaults(out);
  assert.equal(out.pattern.drawing, id);
  assert.equal(out.pattern.depthMm, want.depthMm);
  assert.deepEqual(out.pattern.density, want.density);
  assert.equal(out.assets[id].recipe.cells, recipeOf(g).cells);
  assert.equal(targetDrawingId(out, PATTERN), id);
  // It previews, with a readout. At the standard depth and spacing (two thirds
  // of a bead deep, 2 mm apart: D61, D64) only bead support and the curve
  // check have something to say on the default pot.
  const preview = computePreview(out, { library });
  assert.equal(preview.pattern.columns, 6);
  assert.deepEqual(preview.warnings.filter((w) => w.severity !== 'ok' && w.id !== 'support' && w.id !== 'finePattern').map((w) => w.id), []);
});

test('drawing over a Pattern keeps its depth, density, range, Fade and Soften', () => {
  const d = classic();
  setLayerPattern(d, findLayerEntry(library, 'lib:seed@1'));
  d.pattern.fade = { shape: 'fadesUp', amount: 0.5 };
  d.pattern.softenCells = 0.5;
  const before = structuredClone(d.pattern);
  const s = editorStart(d, library, PATTERN, 'edit');
  const g = invertCells(gridOf(s.recipe), selectionMask(gridOf(s.recipe), { kind: 'row', r: 0 }));
  const out = written(d, s, g);
  assert.deepEqual({ ...out.pattern, drawing: before.drawing }, before);
  assert.equal(out.pattern.drawing, drawingId(recipeOf(g)));
});

test('the editor\'s limits (D57): a Pattern up to 24 cells a side', () => {
  assert.deepEqual({ ...EDITOR_MAX }, { pattern: 24 });
  // Growing stops at the cap; the format still holds a larger drawing from a file (D48).
  assert.equal(insertColumn(emptyGrid(24, 4), 0, 0, EDITOR_MAX.pattern).columns, 24);
  assert.equal(doubleRows(emptyGrid(4, 12), EDITOR_MAX.pattern).rows, 24);
  assert.equal(doubleRows(emptyGrid(4, 13), EDITOR_MAX.pattern).rows, 13);
  const d = classic();
  const out = written(d, editorStart(d, library, PATTERN, 'make'), paintCell(emptyGrid(64, 64), 63, 63, 1));
  assert.equal(out.assets[out.pattern.drawing].recipe.cells.length, 64 * 64);
  // Every starter fits, and the tallest still doubles.
  for (const p of library.layerPatterns) {
    assert.ok(p.recipe.columns <= EDITOR_MAX.pattern && p.recipe.rows * 2 <= EDITOR_MAX.pattern, p.id);
  }
});

// ---------- Clickable cells, zoom and pan (D56, D57) ----------

test('cells never get smaller than a finger or a mouse hits easily; the tile then runs past the stage', () => {
  // A 24 × 24 Pattern on a phone's grid (360 × 200), cells twice as wide as tall.
  const v = gridView(360, 200, 24, 24, 0.5, { minCell: MIN_CELL.touch });
  close(v.ch, MIN_CELL.touch);
  close(v.cw, 2 * MIN_CELL.touch);
  assert.ok(v.tw > 360 && v.th > 200);
  assert.ok(v.fitZoom < 1);
  // An empty Pattern (6 × 6) fits whole on a 360 px phone, also at the Classic vase's 3.4 mm spacing.
  const small = gridView(360, 200, NEW_GRID.pattern.columns, NEW_GRID.pattern.rows, 1.5 / 3.4, { minCell: MIN_CELL.touch });
  assert.ok(small.tw <= 360 && small.th <= 200);
  // A tile that fits at a larger size is drawn larger, as before.
  close(gridView(528, 390, 8, 8, 0.5, { minCell: MIN_CELL.mouse }).cw, 528 * 0.8 / 8);
});

test('zooming keeps the cell under the fingers or the pointer where it is', () => {
  const v = gridView(360, 200, 12, 12, 0.5, { minCell: MIN_CELL.touch });
  const p = { x: 250, y: 60 };
  const before = hitCell(v, p.x, p.y);
  const z = zoomAt(v, 2, p.x, p.y);
  close(z.zoom, 2);
  const after = gridView(360, 200, 12, 12, 0.5, { minCell: MIN_CELL.touch, ...z });
  assert.deepEqual(hitCell(after, p.x, p.y), before);
  // In to MAX_ZOOM, out until the whole tile and some repeats fit.
  assert.equal(zoomAt(v, 100, 0, 0).zoom, MAX_ZOOM);
  close(zoomAt(v, 0.01, 0, 0).zoom, v.fitZoom);
  const fits = gridView(360, 200, 12, 12, 0.5, { minCell: MIN_CELL.touch, zoom: v.fitZoom });
  assert.ok(fits.tw <= 360 * 0.8 + 1e-6 && fits.th <= 200 * 0.8 + 1e-6);
});

test('a pinch zooms by the fingers\' spread and moves with their middle', () => {
  const v = gridView(360, 200, 8, 8, 0.5, { minCell: MIN_CELL.touch });
  const mid = { x: 150, y: 100 };
  const cell = hitCell(v, mid.x, mid.y);
  const s = pinchTo(v, 80, mid, 160, { x: 170, y: 110 });
  close(s.zoom, 2);
  const after = gridView(360, 200, 8, 8, 0.5, { minCell: MIN_CELL.touch, ...s });
  // The cell that was under the fingers' middle followed it.
  assert.deepEqual(hitCell(after, 170, 110), cell);
});

test('the grid moves until an edge of the tile reaches the middle of the stage, no further', () => {
  const v = gridView(360, 200, 24, 24, 0.5, { minCell: MIN_CELL.touch });
  const far = panBy(v, 10000, -10000);
  close(far.panX, v.tw / 2);
  close(far.panY, -v.th / 2);
  const moved = gridView(360, 200, 24, 24, 0.5, { minCell: MIN_CELL.touch, ...far });
  close(moved.ox, 180);                    // the tile's left edge at the middle
  close(moved.oy + moved.th, 100);         // its bottom edge at the middle
  // Out-of-range pans passed straight to gridView are held too.
  close(gridView(360, 200, 24, 24, 0.5, { minCell: MIN_CELL.touch, panX: -1e6 }).panX, -v.tw / 2);
});
