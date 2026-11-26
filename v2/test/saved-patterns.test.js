// Tests for My patterns (pattern studio D48, §3.9, §9): content ids for
// drawings, the entry a Save writes, normalising what comes back from
// storage, what applying an entry does to a design (presets included), the
// two kinds kept apart, and the name Save offers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDesign, designsEqual, compactDesign } from '../core/design.js';
import { computePreview } from '../core/engine.js';
import { drawingId, gridOf, paintCell, recipeOf } from '../core/bitmap.js';
import { defaultPatternRange, DEPTH_BEADS, SPACING_BEADS } from '../core/layer-pattern.js';
import { normaliseSavedPattern, listPatterns, savePattern, deletePattern, useDb, SAVED_NAMES } from '../store/assets.js';
import {
  savableEntry, applyPatternEntry, applyDetailEntry, drawingKey, targetKey, layerMineEntries, mineEntries,
  entryNamed, suggestName, nameDrawing, drawsWith, unusedCopies, patternSettings, savedSpacingMm,
  setLayerPattern, findLayerEntry, editorStart, writeEditorDrawing, snapToLayers,
} from '../ui/pattern-actions.js';
import { shapeOnly } from '../ui/steps.js';
import { library, presets } from './support/fixtures.js';

const PATTERN = { kind: 'pattern' };
const slotA = { kind: 'detail', slot: 'a' };
const slotB = { kind: 'detail', slot: 'b' };
const classic = () => normaliseDesign(presets[0]);
const ZIGZAG = { kind: 'bitmap', columns: 4, rows: 2, cells: '+0-0' + '0+0-' };
const GRID = { kind: 'bitmap', columns: 4, rows: 3, cells: '+0-0' + '0000' + '-0+0', edges: 'round' };

/** A design with a Pattern of your own, drawn in the editor and set up past its defaults. */
function withOwnPattern() {
  const d = classic();
  const start = editorStart(d, library, PATTERN, 'make');
  writeEditorDrawing(d, start, ZIGZAG);
  d.pattern.depthMm = 0.5;
  d.pattern.density = { by: 'points', spacingMm: 3.1, points: 120 };
  d.pattern.fade = { shape: 'middle', amount: 0.6 };
  d.pattern.softenCells = 0.75;
  d.pattern.fromMm = 30;
  d.pattern.toMm = 90;
  return normaliseDesign(d);
}

/** A design whose slot A holds a grid of your own with its own repeats and tile height. */
function withOwnSwatch() {
  const d = classic();
  const start = editorStart(d, library, slotA, 'make');
  writeEditorDrawing(d, start, GRID);
  d.form.detail.a.depthMm = 2.5;
  d.form.detail.a.repeats = 10;
  d.form.detail.a.tileHeightMm = 24;
  return normaliseDesign(d);
}

/** The entry Save stores, as storage hands it back. */
const stored = (entry, name = entry.name, id = `saved:${name.length}`) => normaliseSavedPattern({ ...entry, id, name, created: 1, updated: 1 });

// ---------- Content ids ----------

test('a drawing\'s id is a hash of what it draws: the same drawing, the same id', () => {
  const id = drawingId(ZIGZAG);
  assert.match(id, /^user:[0-9a-f]{16}$/);
  assert.equal(drawingId({ ...ZIGZAG }), id);
  assert.notEqual(drawingId({ ...ZIGZAG, cells: '+0-0' + '0+0+' }), id);
  assert.notEqual(drawingId({ ...ZIGZAG, columns: 2, rows: 4 }), id);              // same cells, other shape
  assert.notEqual(drawingId({ ...ZIGZAG, edges: 'soft' }), id);
  // A Pattern is crisp: its key ignores edges. A Detailed morph grid's has them, soft by default.
  assert.equal(drawingKey('pattern', { ...ZIGZAG, edges: 'round' }), id);
  assert.equal(drawingKey('detail', ZIGZAG), drawingId({ ...ZIGZAG, edges: 'soft' }));
  assert.equal(drawingKey('detail', { kind: 'shape', shape: 'flutes' }), null);
});

// ---------- What Save writes ----------

test('Save pattern writes the drawing, depth, density, Fade and Soften, never From / To', () => {
  const d = withOwnPattern();
  const e = savableEntry(d, library, PATTERN);
  assert.equal(e.kind, 'pattern');
  assert.equal(e.name, 'My pattern');
  assert.deepEqual(e.drawing, { kind: 'bitmap', columns: 4, rows: 2, cells: ZIGZAG.cells });
  assert.deepEqual(e.settings, {
    depthMm: 0.5, density: { by: 'points', spacingMm: 4, points: 120 }, fade: { shape: 'middle', amount: 0.6 }, softenCells: 0.75,
  });
  assert.ok(!('fromMm' in e.settings) && !('toMm' in e.settings));
  // A starter saves too, as a drawing of its own; no Pattern, nothing to save.
  const k = classic();
  setLayerPattern(k, findLayerEntry(library, 'lib:knit@1'));
  assert.equal(savableEntry(k, library, PATTERN).name, 'Knit');
  assert.equal(savableEntry(classic(), library, PATTERN), null);
});

test('Save on a Detailed morph slot writes the grid with its depth, repeats and tile height', () => {
  const d = withOwnSwatch();
  const e = savableEntry(d, library, slotA);
  assert.equal(e.kind, 'detail');
  assert.equal(e.name, 'My swatch');
  assert.deepEqual(e.drawing, GRID);
  assert.deepEqual(e.settings, { depthMm: 2.5, repeats: 10, tileHeightMm: 25 });
  // An analytic shape, an empty slot and Plain stay library-only (D45).
  assert.equal(savableEntry(classic(), library, slotA), null);
  assert.equal(savableEntry(classic(), library, slotB), null);
});

// ---------- Normalising what comes back from storage ----------

test('an entry from storage is checked and clamped; anything else is ignored', () => {
  const e = normaliseSavedPattern({
    id: 'saved:1', kind: 'pattern', name: '  Zigzag  ', drawing: { ...ZIGZAG, edges: 'round' },
    settings: { depthMm: 99, density: { by: 'sideways', spacingMm: -1, points: 7.6 }, fade: { shape: 'spiral', amount: 4 }, softenCells: 9 },
    created: 5, updated: 6,
  });
  assert.equal(e.name, 'Zigzag');
  assert.deepEqual(e.drawing, ZIGZAG);                                  // a Pattern is crisp
  assert.equal(e.settings.depthMm, 8);
  assert.deepEqual(e.settings.density, { by: 'spacing', spacingMm: 0.25, points: 8 });
  assert.deepEqual(e.settings.fade, { shape: 'even', amount: 1 });
  assert.equal(e.settings.softenCells, 2);
  assert.deepEqual([e.created, e.updated], [5, 6]);
  // Missing settings get defaults; a grid without edges gets soft ones; no name, the kind's.
  const g = normaliseSavedPattern({ id: 'saved:2', kind: 'detail', drawing: { kind: 'bitmap', columns: 2, rows: 1, cells: '+-' } });
  assert.equal(g.drawing.edges, 'soft');
  assert.equal(g.name, SAVED_NAMES.detail);
  assert.deepEqual(g.settings, { depthMm: 1.5, repeats: 8, tileHeightMm: 20 });
  // The old { id, name, recipe } records (D50), other kinds, broken drawings: not entries.
  for (const bad of [
    { id: 'user:abcd1234', name: 'Old', recipe: ZIGZAG },
    { id: 'saved:3', kind: 'morph', drawing: ZIGZAG },
    { id: 'saved:4', kind: 'pattern', drawing: { kind: 'shape', shape: 'flutes' } },
    { id: 'saved:5', kind: 'pattern', drawing: { ...ZIGZAG, cells: '+0-' } },
    { id: 'saved:6', kind: 'pattern', drawing: { kind: 'bitmap', columns: 65, rows: 1, cells: '0'.repeat(65) } },
    { kind: 'pattern', drawing: ZIGZAG },
    null, 'Zigzag',
  ]) assert.equal(normaliseSavedPattern(bad), null);
});

test('My patterns lists entries oldest first, by kind, and skips what isn\'t one', async () => {
  const records = new Map([
    ['user:old', { id: 'user:old', name: 'Old', recipe: ZIGZAG, created: 0 }],
    ['saved:b', { id: 'saved:b', kind: 'detail', name: 'Grid', drawing: GRID, settings: { depthMm: 2, repeats: 6, tileHeightMm: 18 }, created: 20 }],
    ['saved:a', { id: 'saved:a', kind: 'pattern', name: 'Zigzag', drawing: ZIGZAG, settings: {}, created: 10 }],
  ]);
  useDb({
    get: async (store, key) => structuredClone(records.get(key)),
    put: async (store, key, value) => { records.set(key, structuredClone(value)); return true; },
    delete: async (store, key) => { records.delete(key); },
    all: async () => [...records.values()].map((r) => structuredClone(r)),
  });
  assert.deepEqual((await listPatterns()).map((e) => e.id), ['saved:a', 'saved:b']);
  assert.deepEqual((await listPatterns('detail')).map((e) => e.name), ['Grid']);
  // Saving under an id replaces that entry and keeps when it was first saved.
  const again = await savePattern({ id: 'saved:a', kind: 'pattern', name: 'Zigzag', drawing: ZIGZAG, settings: { depthMm: 0.3 } });
  assert.equal(again.created, 10);
  assert.equal((await listPatterns('pattern'))[0].settings.depthMm, 0.3);
  const added = await savePattern({ kind: 'pattern', name: 'Rib', drawing: { kind: 'bitmap', columns: 2, rows: 1, cells: '+-' }, settings: {} });
  assert.match(added.id, /^saved:[0-9a-f]{8}$/);
  await assert.rejects(savePattern({ kind: 'pattern', name: 'Bad', drawing: { kind: 'shape' } }), TypeError);
  await deletePattern('saved:a');
  assert.deepEqual((await listPatterns('pattern')).map((e) => e.name), ['Rib']);
});

// ---------- Applying ----------

test('a saved Pattern applies to every preset in one go, with the default range', () => {
  const entry = stored(savableEntry(withOwnPattern(), library, PATTERN), 'Zigzag');
  for (const preset of presets) {
    const d = shapeOnly(normaliseDesign(preset));      // a preset opens as a shape, without a Pattern (D52)
    const want = defaultPatternRange(d);
    applyPatternEntry(d, entry);
    const id = drawingId(ZIGZAG);
    assert.equal(d.pattern.drawing, id, preset.meta.name);
    assert.deepEqual(patternSettings(d.pattern), entry.settings);
    assert.deepEqual([d.pattern.fromMm, d.pattern.toMm], [want.fromMm, want.toMm]);
    // The design keeps its own copy, named as the entry.
    assert.deepEqual(d.assets[id], { kind: 'recipe', name: 'Zigzag', recipe: ZIGZAG });
    // It is already what normaliseDesign would make of it.
    assert.ok(designsEqual(normaliseDesign(d), d));
  }
});

test('applying keeps the design\'s own From / To, and the drawing it replaces goes', () => {
  const entry = stored(savableEntry(withOwnPattern(), library, PATTERN), 'Zigzag');
  const d = classic();
  const start = editorStart(d, library, PATTERN, 'make');
  const other = writeEditorDrawing(d, start, { kind: 'bitmap', columns: 2, rows: 1, cells: '+-' });
  d.pattern.fromMm = 40;
  d.pattern.toMm = 100;
  applyPatternEntry(d, entry);
  assert.deepEqual([d.pattern.fromMm, d.pattern.toMm], [40, 100]);
  assert.equal(d.assets[other], undefined);
  // Applying it again changes nothing.
  const once = structuredClone(d);
  applyPatternEntry(d, entry);
  assert.deepEqual(d, once);
});

test('a saved Pattern holds to the bead of the design it lands on', () => {
  const entry = stored(savableEntry(withOwnPattern(), library, PATTERN), 'Zigzag');
  entry.settings.depthMm = 1.4;                                          // half of a 3 mm bead is 1.5
  entry.settings.density = { by: 'spacing', spacingMm: 8, points: 96 };
  const d = classic();
  d.layers.beadWidthMm = 2;
  d.layers.layerHeightMm = 1;
  const n = normaliseDesign(d);
  applyPatternEntry(n, entry);
  assert.equal(n.pattern.depthMm, DEPTH_BEADS.max * 2);                  // half of this 2 mm bead
  assert.equal(n.pattern.density.spacingMm, SPACING_BEADS.max * 2);
  assert.ok(designsEqual(normaliseDesign(n), n));
});

test('a saved Detailed morph swatch applies to a slot, presets included, with whole-layer tiles', () => {
  const entry = stored(savableEntry(withOwnSwatch(), library, slotA), 'Grid');
  const id = drawingId(GRID);
  for (const preset of presets) {
    const d = normaliseDesign(preset);
    const { fromMm, toMm, blend } = d.form.detail;
    applyDetailEntry(d, 'a', entry);
    const a = d.form.detail.a;
    assert.deepEqual([a.pattern, a.depthMm, a.repeats], [id, 2.5, 10], preset.meta.name);
    assert.equal(a.tileHeightMm, snapToLayers(24, d.layers.layerHeightMm));
    assert.deepEqual([d.form.detail.fromMm, d.form.detail.toMm, d.form.detail.blend], [fromMm, toMm, blend]);
    assert.deepEqual(d.assets[id], { kind: 'recipe', name: 'Grid', recipe: GRID });
    assert.ok(designsEqual(normaliseDesign(d), d));
  }
  // An empty slot B blends in, as a first pick of B does.
  const d = normaliseDesign(presets[1]);
  applyDetailEntry(d, 'b', entry);
  assert.equal(d.form.detail.b.pattern, id);
  assert.equal(d.form.detail.blend.shape, 'fadesUp');
});

test('a design that used a deleted entry still opens and prints the same, and its file carries the drawing', () => {
  const entry = stored(savableEntry(withOwnPattern(), library, PATTERN), 'Zigzag');
  const d = shapeOnly(normaliseDesign(presets[2]));
  applyPatternEntry(d, entry);
  // The file and a fresh load know nothing of My patterns.
  const file = JSON.parse(JSON.stringify(compactDesign(d)));
  assert.deepEqual(file.assets[d.pattern.drawing].recipe, ZIGZAG);
  const reopened = normaliseDesign(file);
  const a = computePreview(d, { library });
  const b = computePreview(reopened, { library });
  assert.equal(a.warnings.some((w) => w.id === 'missingPattern'), false);
  assert.deepEqual(b.pattern, a.pattern);
  assert.deepEqual(Array.from(b.positions), Array.from(a.positions));
});

// ---------- The two kinds apart, and the picked tile ----------

test('Pattern entries and Detailed morph entries never show among each other\'s swatches', () => {
  const pattern = stored(savableEntry(withOwnPattern(), library, PATTERN), 'Zigzag');
  const swatch = stored(savableEntry(withOwnSwatch(), library, slotA), 'Grid', 'saved:g');
  const saved = [pattern, swatch];
  const d = classic();
  assert.deepEqual(layerMineEntries(library, d, saved).map((e) => e.id), [pattern.id]);
  assert.deepEqual(mineEntries(library, d, saved).map((e) => e.id), [swatch.id]);
  // Applied, the design's copy shows as its saved tile, not twice.
  applyPatternEntry(d, pattern);
  applyDetailEntry(d, 'a', swatch);
  assert.deepEqual(layerMineEntries(library, d, saved).map((e) => e.id), [pattern.id]);
  assert.deepEqual(mineEntries(library, d, saved).map((e) => e.id), [swatch.id]);
  // The tiles are the ones on the pot.
  assert.equal(targetKey(d, library, PATTERN), drawingKey('pattern', pattern.drawing));
  assert.equal(targetKey(d, library, slotA), drawingKey('detail', swatch.drawing));
  // Once the entries are gone, the design's own copies show as its own.
  assert.deepEqual(layerMineEntries(library, d, []).map((e) => e.id), [d.pattern.drawing]);
  assert.deepEqual(mineEntries(library, d, []).map((e) => e.id), [d.form.detail.a.pattern]);
});

test('a saved swatch shows at its own grid, a saved Pattern at its own spacing', () => {
  const swatch = stored(savableEntry(withOwnSwatch(), library, slotA), 'Grid');
  const [tile] = mineEntries(library, classic(), [swatch]);
  assert.deepEqual(tile.defaults, swatch.settings);
  const pattern = stored(savableEntry(withOwnPattern(), library, PATTERN), 'Zigzag');
  const d = classic();
  assert.equal(savedSpacingMm(d, pattern), 8);                     // set in points: a bead apart
  pattern.settings.density = { by: 'spacing', spacingMm: 4.2, points: 96 };
  assert.equal(savedSpacingMm(d, pattern), 4.2);
});

// ---------- Names ----------

test('Save offers the name to update: the same drawing\'s, or the drawing\'s own; a default name never replaces', () => {
  const entry = savableEntry(withOwnPattern(), library, PATTERN);
  assert.equal(suggestName([], entry), 'My pattern');
  const other = stored({ ...entry, drawing: { kind: 'bitmap', columns: 2, rows: 1, cells: '+-' } }, 'My pattern', 'saved:o');
  assert.equal(suggestName([other], entry), 'My pattern 2');
  const same = stored(entry, 'Zigzag', 'saved:z');
  assert.equal(suggestName([other, same], entry), 'Zigzag');
  // Saved as Zigzag and drawn on since: Save offers Zigzag again, to update it.
  const drawnOn = { ...entry, name: 'zigzag', drawing: { kind: 'bitmap', columns: 2, rows: 2, cells: '+-0+' } };
  assert.equal(suggestName([other, same], drawnOn), 'Zigzag');
  // A swatch saved under the same name is another kind: it isn't replaced.
  const swatch = stored(savableEntry(withOwnSwatch(), library, slotA), 'My pattern', 'saved:s');
  assert.equal(suggestName([swatch], entry), 'My pattern');
  assert.equal(entryNamed([other, same, swatch], 'pattern', '  zigzag '), same);
  assert.equal(entryNamed([other, same, swatch], 'detail', 'zigzag'), null);
  assert.equal(entryNamed([same], 'pattern', '   '), null);
});

test('the design\'s own copy takes the saved name; a starter keeps its own', () => {
  const d = withOwnPattern();
  const key = drawingKey('pattern', ZIGZAG);
  assert.equal(nameDrawing(d, PATTERN, key, 'Zigzag'), true);
  assert.equal(d.assets[d.pattern.drawing].name, 'Zigzag');
  assert.equal(nameDrawing(d, PATTERN, key, 'Zigzag'), false);           // already so named
  assert.equal(nameDrawing(d, PATTERN, drawingKey('pattern', GRID), 'Grid'), false);
  const k = classic();
  setLayerPattern(k, findLayerEntry(library, 'lib:knit@1'));
  assert.equal(nameDrawing(k, PATTERN, targetKey(k, library, PATTERN), 'My knit'), false);
});

test('deleting an entry: the design keeps a copy it draws with, an unused copy goes', () => {
  const swatch = stored(savableEntry(withOwnSwatch(), library, slotA), 'Grid');
  const d = classic();
  applyDetailEntry(d, 'a', swatch);
  assert.equal(drawsWith(d, library, swatch), true);
  assert.deepEqual(unusedCopies(d, swatch), []);
  d.form.detail.a.pattern = 'lib:flutes@1';                            // picked another swatch: the copy lingers
  assert.equal(drawsWith(d, library, swatch), false);
  assert.deepEqual(unusedCopies(d, swatch), [drawingId(GRID)]);
  // The Pattern is checked on its own.
  const pattern = stored(savableEntry(withOwnPattern(), library, PATTERN), 'Zigzag');
  assert.equal(drawsWith(d, library, pattern), false);
  applyPatternEntry(d, pattern);
  assert.equal(drawsWith(d, library, pattern), true);
});

test('a drawing edited from a saved one is a new drawing; the entry keeps its own', () => {
  const entry = stored(savableEntry(withOwnPattern(), library, PATTERN), 'Zigzag');
  const d = classic();
  applyPatternEntry(d, entry);
  const start = editorStart(d, library, PATTERN, 'edit');
  assert.equal(start.name, 'Zigzag');
  const g = paintCell(gridOf(start.recipe), 0, 0, 0);
  writeEditorDrawing(d, start, recipeOf(g));
  assert.notEqual(d.pattern.drawing, drawingId(ZIGZAG));
  assert.equal(d.assets[drawingId(ZIGZAG)], undefined);
  assert.deepEqual(entry.drawing, ZIGZAG);
  assert.deepEqual(layerMineEntries(library, d, [entry]).map((e) => e.id), [entry.id, d.pattern.drawing]);
});
