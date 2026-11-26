// What picking a Pattern does, shared by the sheet's swatch grid
// (ui/sections/pattern.js) and the dock's carousel (ui/dock.js), so a pattern
// behaves the same wherever it is picked (mobile stage, M11).
//
// The Pattern (design.pattern, D37–D48): finding a drawing (the starters in
// library.layerPatterns, or your own), putting it on the pot in one tap, the
// density readout and its two faces, and drawing it crisp at the pot's bead scale.
//
// The 2D editor (D45, D46, ui/pattern-editor.js): what a session starts from
// (an empty grid, a copy of a library drawing, or your own drawing edited in
// place) and how its drawing goes into the design.
//
// My patterns (D48, §3.9): what Save writes for the Pattern, the name it
// offers, and what applying a saved entry does to a design. Your own drawings
// go by content ids (core/bitmap.js drawingId), so a design's copy and its
// saved entry are the same drawing by id.
//
// The one target is { kind: 'pattern' }: the Detailed morph, the other kind,
// is gone (D63).

import { makeBitmap } from '../core/patterns.js';
import { DEPTH_BEADS, MAX_NODES, SPACING_BEADS, defaultPatternRange, defaultSpacingMm, drawingDefaults, newPattern, patternReadout } from '../core/layer-pattern.js';
import { drawingId } from '../core/bitmap.js';
import { drawBitmapSwatch } from './swatch.js';
import { savePattern, SAVED_NAMES } from '../store/assets.js';

// The editor and the image decoder load on first use.
const lazy = (path) => {
  let p = null;
  return () => (p ??= import(path).catch((err) => { p = null; throw err; }));
};
const loadEditor = lazy('./pattern-editor.js');

/** Whether the design draws with an asset (the morph map or the Pattern uses it). */
export function usesAsset(d, id) {
  return assetUses(d, id) > 0;
}

/** How many places draw with an asset: the morph map and the Pattern. */
export function assetUses(d, id) {
  return [d.form?.morph?.map, d.pattern?.drawing].filter((x) => x === id).length;
}

// A drawing of your own that nothing draws with any more goes; one worth
// keeping is saved in My patterns (D48). Mutates d.
function dropUnusedDrawing(d, id) {
  if (typeof id === 'string' && id.startsWith('user:') && d.assets?.[id] && !usesAsset(d, id)) delete d.assets[id];
}

/**
 * Opens the 2D editor (D45, D46) on the Pattern ({ kind: 'pattern' }). `mode`
 * 'make' starts an empty grid; 'edit' the drawing the Pattern holds (editableEntry).
 * @param {object} ctx  main.js's ctx
 * @param {{ kind: 'pattern' }} target
 * @param {{ mode?: 'make' | 'edit', returnFocus?: HTMLElement | null }} [opts]
 */
export function openEditor(ctx, target, opts = {}) {
  return loadEditor().then((m) => m.openPatternEditor(ctx, target, opts));
}

// ---------- The Pattern (the bead-scale bitmap, D35–D48) ----------

/** How wide a square of wall a Pattern swatch shows, in bead widths: the pot's own bead scale (§3.8). */
export const LAYER_SWATCH_BEADS = 8;

/**
 * A Pattern drawing by id: a starter (library.layerPatterns) or a bitmap of
 * your own in the design's assets.
 * @returns {{ id: string, name: string, recipe: object, own?: boolean, description?: string } | null}
 */
export function findLayerEntry(library, id, assets) {
  if (typeof id !== 'string' || !id) return null;
  const a = assets?.[id];
  if (a?.kind === 'recipe' && a.recipe?.kind === 'bitmap') return { id, name: a.name || 'My pattern', recipe: a.recipe, own: true };
  return library?.layerPatterns?.find((p) => p.id === id) ?? null;
}

/**
 * Puts a Pattern drawing on the draft design; null takes the Pattern off.
 * A first Pattern starts from newPattern. Switching drawings keeps From / To,
 * Fade and Soften; a starter brings the standard depth and spacing (D61,
 * D64), and one of your own keeps the ones you had. A drawing of
 * your own that it replaces, and nothing else uses, goes. Mutates d.
 * @param {object} d  a draft design (inside store.apply)
 * @param {object | null} entry  findLayerEntry's result
 */
export function setLayerPattern(d, entry) {
  const old = d.pattern?.drawing;
  if (!entry) {
    d.pattern = null;
    dropUnusedDrawing(d, old);
    return;
  }
  if (entry.own) {
    d.assets ??= {};
    d.assets[entry.id] = { kind: 'recipe', name: entry.name, recipe: structuredClone(entry.recipe) };
  }
  if (!d.pattern) {
    d.pattern = newPattern(d, entry.id);
    return;
  }
  d.pattern.drawing = entry.id;
  if (!entry.own) Object.assign(d.pattern, drawingDefaults(d));
  dropUnusedDrawing(d, old);
}

/**
 * Puts a Pattern drawing on the pot as one history step ("Pattern: Knit").
 * @param {object} ctx  main.js's ctx
 * @param {string | null} id  null = no Pattern
 * @returns {boolean} false when the id isn't known
 */
export function pickLayerPattern(ctx, id) {
  const { store, library } = ctx;
  const entry = id ? findLayerEntry(library, id, store.state.design.assets) : null;
  if (id && !entry) return false;
  if ((store.state.design.pattern?.drawing ?? null) === (id ?? null)) return true;
  store.apply(`Pattern: ${entry ? entry.name : 'none'}`, (d) => setLayerPattern(d, entry));
  return true;
}

/**
 * Your own Patterns: the Pattern's entries in My patterns (`saved`), then
 * the drawing of your own on the pot unless it is one of them.
 */
export function layerMineEntries(library, d, saved) {
  const tiles = savedOfKind(saved, 'pattern').map(savedTile);
  const id = d.pattern?.drawing;
  const e = typeof id === 'string' && id.startsWith('user:') ? findLayerEntry(library, id, d.assets) : null;
  if (e && !tiles.some((t) => t.key === drawingKey('pattern', e.recipe))) tiles.push(e);
  return tiles;
}

const readouts = new WeakMap();
/**
 * The Pattern's density readout for a design (core/layer-pattern.js
 * patternReadout), worked out once per design object.
 * @returns {ReturnType<typeof patternReadout>}
 */
export function readoutOf(design, library) {
  if (!design?.pattern) return null;
  if (readouts.has(design)) return readouts.get(design);
  let r = null;
  try { r = patternReadout(design, library); } catch { r = null; }
  readouts.set(design, r);
  return r;
}

const mm1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
/** A whole number with thousands separators: 20,160. */
export const wholeText = (n) => Math.round(n).toLocaleString('en-US');
/**
 * The density readout (D40, D58, §3.2): "96 points per layer · 3.8–6.1 mm ·
 * 8,064 in all": the points a layer has, how far apart its cells are from
 * the narrowest layer in the range to the widest, and the points over all the
 * Pattern's layers. With Soften on a layer has more points than cells (D59),
 * so both are named, unless `compact` (the dock's one line).
 * @param {ReturnType<typeof patternReadout>} r
 * @param {{ compact?: boolean }} [options]
 */
export function densityText(r, { compact = false } = {}) {
  if (!r) return '';
  const lo = mm1(r.spacingMinMm);
  const hi = mm1(r.spacingMaxMm);
  const per = r.extra > 0 && !compact ? `${r.nodes} cells, ${r.pointsPerLayer} points per layer` : `${r.pointsPerLayer} points per layer`;
  return `${per} · ${lo === hi ? `${lo} mm apart` : `${lo}–${hi} mm`} · ${wholeText(r.points)} in all${r.clamped ? ' · the most a layer takes' : ''}`;
}

/**
 * What Soften does to the points (D58, D59): crisp, a layer has one point a
 * cell; softened, the same points are added between every two cells.
 * @param {number} softenCells
 * @param {ReturnType<typeof patternReadout>} r
 * @param {{ compact?: boolean }} [options] compact: the dock's one line
 */
export function softenText(softenCells, r, { compact = false } = {}) {
  if (!(softenCells > 0)) return compact ? 'Crisp: one point a cell' : 'Crisp: what you draw is what prints, one point a cell';
  if (!r) return 'Blurs each point into its neighbours';
  if (r.extra === 0) return compact ? 'Blurs the cells · adds no points' : 'Blurs each point into its neighbours; the cells are close enough that it adds no points';
  const between = `${r.extra} ${r.extra === 1 ? 'point' : 'points'} between cells`;
  if (compact) return `Adds ${between} · ${r.pointsPerLayer} per layer`;
  return `Blurs each point into its neighbours and adds ${between}: ${wholeText(r.points - r.nodes * r.layers)} more points. The drawing stays in, flat or out`;
}

/**
 * The density's two faces (D40): what the Spacing face (mm) and the Points
 * face (points per layer, whole tiles) may be set to on this pot, half a
 * bead to three beads apart on the narrowest layer, never past the point
 * cap. The range always holds the value in use.
 * @param {object} design normalised, with a Pattern
 * @param {NonNullable<ReturnType<typeof patternReadout>>} r
 */
export function densityLimits(design, r) {
  const w = design.layers.beadWidthMm;
  const c = r.columns;
  const spacing = {
    min: Math.ceil(SPACING_BEADS.min * w * 10) / 10,
    max: Math.floor(SPACING_BEADS.max * w * 10) / 10,
  };
  let lo = c * Math.max(1, Math.ceil(r.perimeterMinMm / (SPACING_BEADS.max * w * c) - 1e-9));
  let hi = c * Math.max(1, Math.floor(Math.min(r.perimeterMinMm / (SPACING_BEADS.min * w), MAX_NODES) / c + 1e-9));
  lo = Math.min(lo, r.nodes);
  hi = Math.max(hi, lo, r.nodes);
  return { spacing, points: { min: lo, max: hi, step: c } };
}

/**
 * Switches the density to the other face without changing the pot: the
 * Points face takes the nodes in use, the Spacing face the spacing in use on
 * the narrowest layer (rounded down, so the repeats stay whole). Mutates d.
 * @param {object} d  a draft design with a Pattern
 * @param {'spacing' | 'points'} by
 * @param {ReturnType<typeof patternReadout>} r  the readout of d before the switch
 */
export function setDensityFace(d, by, r) {
  const density = d.pattern.density;
  if (density.by === by) return;
  density.by = by;
  if (!r) return;
  if (by === 'points') density.points = r.nodes;
  else {
    const w = d.layers.beadWidthMm;
    density.spacingMm = Math.min(Math.max(Math.floor(r.spacingMinMm * 100) / 100, SPACING_BEADS.min * w), SPACING_BEADS.max * w);
  }
}

/**
 * Draws a Pattern drawing as it prints, crisp, at this pot's bead scale:
 * one cell per node spacing by one layer, over a square of wall
 * LAYER_SWATCH_BEADS bead widths wide.
 * @param {{ canvas: HTMLCanvasElement, drawn: string }} target
 * @param {object} entry  findLayerEntry's result
 * @param {object} design
 * @param {number} size  CSS px
 * @param {number} [spacingMm]  the node spacing; by default the drawing's own default
 */
export function drawLayerEntry(target, entry, design, size, spacingMm) {
  if (!entry?.recipe) return;
  const w = design.layers.beadWidthMm;
  const h = design.layers.layerHeightMm;
  const spacing = spacingMm ?? drawingDefaults(design).density.spacingMm;
  const key = `${entry.id}|${entry.own ? entry.recipe.cells : ''}|${entry.recipe.columns}|${spacing.toFixed(2)}|${h}|${w}|${size}`;
  if (key === target.drawn) return;
  target.drawn = key;
  drawBitmapSwatch(target.canvas, entry.recipe, {
    id: entry.own ? undefined : entry.id, size, cellWidthMm: spacing, cellHeightMm: h, windowMm: LAYER_SWATCH_BEADS * w,
  });
}

// ---------- The 2D editor (D45, D46) ----------

/**
 * The most cells a side the editor draws (D57): 24, so every cell stays one
 * you can hit. The bitmap format itself holds up to 64 (D48): a larger
 * drawing from a file still opens, it just can't grow.
 */
export const EDITOR_MAX = Object.freeze({ pattern: 24 });
/**
 * The grid *Make your own* starts with: small enough that a Pattern's whole
 * tile fits a 360 px phone at the clickable cell size (D56).
 */
export const NEW_GRID = Object.freeze({ pattern: { columns: 6, rows: 6 } });

const copyName = (name) => `${name} (mine)`.slice(0, 80);
const sessionLabel = () => 'Edited pattern';

/**
 * The drawing the editor would open on *Edit*, or null when the design has no Pattern.
 * @param {object} design
 * @param {object} library
 * @param {{ kind: 'pattern' }} [target]
 */
export function editableEntry(design, library, target) {
  const id = design.pattern?.drawing;
  return id ? findLayerEntry(library, id, design.assets) : null;
}

/** The id of the drawing the Pattern shows now, or null. */
export function targetDrawingId(design, target) {
  return design.pattern?.drawing ?? null;
}

/**
 * What an editor session starts from. *Make your own* is an empty grid
 * (NEW_GRID). *Edit* opens the target's drawing: a library one as a copy
 * ("Knit (mine)"), your own in place (`replaces`: it goes once the edit
 * replaces it), unless something else draws with it too, which then keeps
 * its own. Each edit goes in under its own content id (writeEditorDrawing).
 * `kept` lists the design's assets that stay when the session replaces them.
 * @param {object} design  normalised
 * @param {object} library
 * @param {{ kind: 'pattern' }} target
 * @param {'make' | 'edit'} mode
 * @returns {{ target: object, mode: string, name: string, recipe: object, label: string,
 *   opened: { drawing: string | null, cells: string | null }, replaces: string | null, kept: string[] }}
 */
export function editorStart(design, library, target, mode) {
  const entry = editableEntry(design, library, target);
  const opened = { drawing: targetDrawingId(design, target), cells: entry?.recipe?.cells ?? null };
  const label = sessionLabel(target);
  let name;
  let recipe;
  let replaces = null;
  if (mode === 'edit' && entry) {
    const inPlace = (entry.own || String(entry.id).startsWith('user:')) && assetUses(design, entry.id) <= 1;
    if (inPlace) replaces = entry.id;
    name = inPlace ? entry.name : copyName(entry.name);
    recipe = structuredClone(entry.recipe);
    delete recipe.edges;                                         // a Pattern is always crisp (D53)
  } else {
    const size = NEW_GRID.pattern;
    name = SAVED_NAMES.pattern;
    recipe = makeBitmap(size.columns, size.rows, new Int8Array(size.columns * size.rows));
  }
  const kept = Object.keys(design.assets ?? {}).filter((id) => id !== replaces);
  return { target, mode, name, recipe, label, opened, replaces, kept };
}

/**
 * Puts the editor's drawing on the draft design (inside store.change): the
 * recipe goes into design.assets under its content id (drawingId), named as
 * the session names it, and the Pattern draws with it. A first Pattern starts
 * from newPattern, as deep and as dense as a starter; an existing one keeps its depth,
 * density, range, Fade and Soften. The drawing it replaces goes when nothing
 * draws with it. Mutates d.
 * @param {object} d
 * @param {ReturnType<typeof editorStart>} start
 * @param {object} recipe  the bitmap the editor holds
 * @returns {string} the drawing's id
 */
export function writeEditorDrawing(d, start, recipe) {
  const id = drawingId(recipe);
  const prev = targetDrawingId(d, start.target);
  d.assets ??= {};
  d.assets[id] = { kind: 'recipe', name: start.name, recipe: structuredClone(recipe) };
  if (!d.pattern) d.pattern = newPattern(d, id);
  else d.pattern.drawing = id;
  if (prev !== id) dropUnusedDrawing(d, prev);
  return id;
}

// ---------- My patterns (D48, §3.9): saving a setup, applying it ----------

/**
 * A drawing's identity in My patterns: its content id (drawingId), crisp (a
 * Pattern has no edges, D53). Null for anything that isn't a bitmap.
 * @param {'pattern'} kind
 * @param {object | null | undefined} recipe
 */
export function drawingKey(kind, recipe) {
  if (recipe?.kind !== 'bitmap') return null;
  const { columns, rows, cells } = recipe;
  return drawingId({ columns, rows, cells });
}

/** The entries of one kind in My patterns. */
export function savedOfKind(saved, kind) {
  return (saved ?? []).filter((e) => e?.kind === kind);
}

// A tile in a swatch grid or carousel for one of My patterns: `saved` is the
// entry, `key` its drawing's identity, so the tile shows as picked while the
// pot draws the same drawing (targetKey), whatever id the design gives it.
function savedTile(e) {
  return { id: e.id, name: e.name, recipe: e.drawing, own: true, saved: e, key: drawingKey(e.kind, e.drawing) };
}

/** The identity (drawingKey) of the drawing a target shows now, or null. */
export function targetKey(design, library, target) {
  const e = editableEntry(design, library, target);
  return e ? drawingKey(target.kind, e.recipe) : null;
}

/** The settings a saved Pattern carries: all but its drawing and its From / To (§3.9). */
export function patternSettings(p) {
  return {
    depthMm: p.depthMm,
    density: { by: p.density.by, spacingMm: p.density.spacingMm, points: p.density.points },
    fade: { shape: p.fade.shape, amount: p.fade.amount },
    softenCells: p.softenCells,
  };
}

/**
 * What Save writes (§3.9, D48), and the name it offers: the drawing the
 * Pattern shows, as a bitmap, with its depth, density (its face and value),
 * Fade and Soften, never From / To, which depend on the pot's height. Null
 * when the design has no Pattern.
 * @returns {null | { kind: 'pattern', name: string, drawing: object, settings: object }}
 */
export function savableEntry(design, library, target) {
  const e = editableEntry(design, library, target);
  if (!e?.recipe) return null;
  const { columns, rows, cells } = e.recipe;
  return { kind: 'pattern', name: e.name, drawing: { kind: 'bitmap', columns, rows, cells }, settings: patternSettings(design.pattern) };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Applies a saved Pattern to a draft design (D48): its drawing, depth,
 * density, Fade and Soften. The design keeps its own From / To, or takes the
 * default range when it has no Pattern yet (a preset opens without one,
 * D52). Its own copy of the drawing goes into design.assets under the
 * drawing's content id, so it opens without My patterns and a design file
 * carries it. Depth and spacing hold to this design's bead, as normaliseDesign would. A drawing of
 * your own it replaces goes when nothing else draws with it. Mutates d.
 * @param {object} d  a draft design (inside store.apply)
 * @param {{ name: string, drawing: object, settings: object }} entry  a Pattern entry of My patterns
 */
export function applyPatternEntry(d, entry) {
  const id = drawingKey('pattern', entry.drawing);
  const old = d.pattern?.drawing ?? null;
  const range = d.pattern ? { fromMm: d.pattern.fromMm, toMm: d.pattern.toMm } : defaultPatternRange(d);
  const w = d.layers.beadWidthMm;
  const s = entry.settings;
  const { columns, rows, cells } = entry.drawing;
  d.assets ??= {};
  d.assets[id] = { kind: 'recipe', name: entry.name, recipe: { kind: 'bitmap', columns, rows, cells } };
  d.pattern = {
    drawing: id,
    depthMm: clamp(s.depthMm, 0, DEPTH_BEADS.max * w),
    density: {
      by: s.density.by,
      spacingMm: clamp(s.density.spacingMm, SPACING_BEADS.min * w, SPACING_BEADS.max * w),
      points: s.density.points,
    },
    fromMm: range.fromMm,
    toMm: range.toMm,
    fade: { shape: s.fade.shape, amount: s.fade.amount },
    softenCells: s.softenCells,
  };
  if (old !== id) dropUnusedDrawing(d, old);
}

/**
 * Applies one of My patterns' Patterns as one history step ("Pattern:
 * Zigzag"); nothing when the design already has all of it.
 * @returns {boolean} whether the design changed
 */
export function pickSavedPattern(ctx, entry) {
  return ctx.store.apply(`Pattern: ${entry.name}`, (d) => applyPatternEntry(d, entry));
}

/**
 * The node spacing a saved Pattern's swatch shows at on this pot: its own
 * spacing, held to this bead, or the standard spacing when it is set in points.
 */
export function savedSpacingMm(design, entry) {
  const w = design.layers.beadWidthMm;
  const density = entry.settings.density;
  const mm = density.by === 'spacing' ? density.spacingMm : defaultSpacingMm(w);
  return clamp(mm, SPACING_BEADS.min * w, SPACING_BEADS.max * w);
}

const sameName = (a, b) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** The entry of this kind a name would replace (names match without case), or null. */
export function entryNamed(saved, kind, name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  return savedOfKind(saved, kind).find((e) => sameName(e.name, name)) ?? null;
}

/**
 * The name Save offers for an entry (savableEntry): the name the same
 * drawing is saved under, so Save updates it; else the drawing's own name.
 * A drawing named as one of My patterns (applied from it, or saved and drawn
 * on since) offers that name too, so Save updates it, and the form says it
 * replaces it. Only the default name ("My pattern") is
 * numbered when taken ("My pattern 2"), so they never replace anything.
 */
export function suggestName(saved, entry) {
  const key = drawingKey(entry.kind, entry.drawing);
  const same = savedOfKind(saved, entry.kind).find((e) => drawingKey(e.kind, e.drawing) === key);
  if (same) return same.name;
  const fallback = SAVED_NAMES[entry.kind];
  const base = String(entry.name ?? '').trim().slice(0, 76) || fallback;
  const taken = entryNamed(saved, entry.kind, base);
  if (!taken) return base;
  if (!sameName(base, fallback)) return taken.name;
  let n = 2;
  while (entryNamed(saved, entry.kind, `${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

// The design's own copy of a drawing that Save names: the target's drawing,
// when it is one of your own (a starter keeps its name) that draws `key`
// under another name.
function copyToName(d, target, key, name) {
  const id = targetDrawingId(d, target);
  const a = typeof id === 'string' && id.startsWith('user:') ? d.assets?.[id] : null;
  return a?.kind === 'recipe' && a.name !== name && drawingKey(target.kind, a.recipe) === key ? a : null;
}

/**
 * Names the design's own copy of a saved drawing as the entry is named, so
 * the pot, the swatches and a design file all say the same. Mutates d.
 * @returns {boolean} false when there is nothing to rename
 */
export function nameDrawing(d, target, key, name) {
  const a = copyToName(d, target, key, name);
  if (a) a.name = name;
  return !!a;
}

/**
 * Save (D48): writes the entry to My patterns under `name`, replacing the
 * entry of that name and kind (entryNamed), then names the design's own copy
 * the same, as one history step ("Saved pattern: Zigzag"), when its name
 * changes. A starter on the pot keeps its own name.
 * @param {object} ctx  main.js's ctx
 * @param {{ kind: 'pattern' }} target
 * @param {NonNullable<ReturnType<typeof savableEntry>>} entry
 * @param {string} name
 * @param {object[]} saved  My patterns as listed when the name was asked
 * @returns {Promise<null | { entry: object, replaced: boolean }>} null when the browser didn't store it
 */
export async function saveEntry(ctx, target, entry, name, saved) {
  const existing = entryNamed(saved, entry.kind, name);
  const stored = await savePattern({ id: existing?.id, kind: entry.kind, name, drawing: entry.drawing, settings: entry.settings });
  if (!stored) return null;
  const key = drawingKey(entry.kind, stored.drawing);
  const { store } = ctx;
  if (copyToName(store.state.design, target, key, stored.name)) {
    store.apply(`Saved pattern: ${stored.name}`, (d) => { nameDrawing(d, target, key, stored.name); });
  }
  return { entry: stored, replaced: !!existing };
}

/** Whether the design draws with a saved entry's drawing (so it keeps its own copy once the entry goes). */
export function drawsWith(design, library, entry) {
  const key = drawingKey(entry.kind, entry.drawing);
  return targetKey(design, library, { kind: 'pattern' }) === key;
}

/**
 * The design's copies of a saved entry's drawing that nothing draws with.
 * They go with the entry, or the drawing would come back as a swatch of the
 * design's own the moment its saved tile leaves the grid.
 */
export function unusedCopies(design, entry) {
  const key = drawingKey(entry.kind, entry.drawing);
  return Object.entries(design.assets ?? {})
    .filter(([id, a]) => a?.kind === 'recipe' && drawingKey(entry.kind, a.recipe) === key && !usesAsset(design, id))
    .map(([id]) => id);
}
