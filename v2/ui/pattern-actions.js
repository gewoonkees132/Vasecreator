// What picking a pattern does, shared by the sheet's swatch grids
// (ui/sections/detail.js, ui/sections/pattern.js) and the dock's carousels
// (ui/dock.js), so a pattern behaves the same wherever it is picked (mobile
// stage, M11).
//
// The Detailed morph (form.detail, D35): finding a swatch by id, putting it
// in slot A or B with its own defaults, images, whole-layer tile heights, and
// drawing a swatch on the pot's own bead grid.
//
// The Pattern (design.pattern, D37–D48): finding a drawing (the starters in
// library.layerPatterns, or your own), putting it on the pot in one tap, the
// density readout and its two faces, and drawing it crisp at the pot's bead scale.
//
// The 2D editor (D45, D46, ui/pattern-editor.js): what a session starts from
// (an empty grid, a copy of a library drawing, or your own drawing edited in
// place) and how its drawing goes into the design, for both kinds.
//
// My patterns (D48, §3.9): what Save writes for the Pattern or a Detailed
// morph slot, the name it offers, and what applying a saved entry does to a
// design. Your own drawings go by content ids (core/bitmap.js drawingId), so
// a design's copy and its saved entry are the same drawing by id.

import { PLAIN, makeBitmap } from '../core/patterns.js';
import { LIMITS } from '../core/design.js';
import { DEPTH_BEADS, MAX_NODES, SPACING_BEADS, defaultPatternRange, drawingDefaults, newPattern, patternReadout } from '../core/layer-pattern.js';
import { drawingId } from '../core/bitmap.js';
import { footprintAt } from './sections/shape.js';
import { drawSwatch, drawRasterSwatch, drawBitmapSwatch, beadGrid } from './swatch.js';
import { loadImage, cachedImage, savePattern, SAVED_NAMES } from '../store/assets.js';

// The editor and the image decoder load on first use.
const lazy = (path) => {
  let p = null;
  return () => (p ??= import(path).catch((err) => { p = null; throw err; }));
};
const loadEditor = lazy('./pattern-editor.js');
export const loadImages = lazy('./image-swatch.js');

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
/** Starting values for your own recipe on a flat slot. */
export const USER_SLOT = Object.freeze({ depthMm: 1.5, repeats: 8, tileHeightMm: 20 });
export const IMAGE_REPEATS = 4;
/** Neutral values for a slot made from Plain, where there is nothing to keep. */
export const PLAIN_SLOT = Object.freeze({ depthMm: 0, repeats: 1 });
/** The grid a library swatch is drawn at when it has no defaults. */
const SWATCH_FALLBACK = { repeats: 12, tileHeightMm: 18 };

/**
 * A Detailed morph swatch by id: Plain, the design's own assets (`user:`
 * recipes and `img:` images), then the library. A saved one is applied from
 * its entry (applyDetailEntry), which puts a copy in the design's assets.
 * @returns {{ id: string, name: string, recipe?: object, image?: object, own?: boolean, defaults?: object } | null}
 */
export function findEntry(library, id, assets) {
  if (id === PLAIN.id) return PLAIN;
  const a = assets?.[id];
  if (a?.kind === 'recipe' && a.recipe) return { id, name: a.name || 'My pattern', recipe: a.recipe, own: true };
  if (a?.kind === 'image') return { id, name: a.name || 'Image', image: a, own: true };
  return library.patterns.find((p) => p.id === id) ?? null;
}

/** Whether the design draws with an asset (a slot, the morph map or the Pattern uses it). */
export function usesAsset(d, id) {
  return assetUses(d, id) > 0;
}

/** How many places draw with an asset: slots A and B, the morph map and the Pattern. */
export function assetUses(d, id) {
  const detail = d.form?.detail;
  return [detail?.a?.pattern, detail?.b?.pattern, d.form?.morph?.map, d.pattern?.drawing].filter((x) => x === id).length;
}

// A drawing of your own that nothing draws with any more goes. For the
// Pattern that keeps it from turning up among the Detailed morph's own
// swatches; one worth keeping is saved in My patterns (D48). Mutates d.
function dropUnusedDrawing(d, id) {
  if (typeof id === 'string' && id.startsWith('user:') && d.assets?.[id] && !usesAsset(d, id)) delete d.assets[id];
}

/** A slot with a texture: set, and not Plain. */
export const textured = (slot) => !!slot && slot.pattern !== PLAIN.id;

/**
 * Whole layers, and never under the core's minimum tile height (the core
 * would clamp it on the next load and the design would quietly change).
 * @param {number} mm @param {number} layerHeightMm @returns {number}
 */
export function snapToLayers(mm, layerHeightMm) {
  const min = LIMITS.tileHeightMm?.min ?? 0;
  const max = LIMITS.tileHeightMm?.max ?? Infinity;
  let n = Math.max(1, Math.ceil(min / layerHeightMm - 1e-9), Math.round(mm / layerHeightMm));
  n = Math.min(n, Math.max(1, Math.floor(max / layerHeightMm + 1e-9)));
  return Math.round(n * layerHeightMm * 1000) / 1000;
}

/**
 * An image slot: keep the depth, 4 repeats around, and a tile as high as one
 * repeat is wide times the image's aspect, in whole layers. Mutates d.
 */
export function placeImage(d, s, id, asset) {
  const surf = d.form.detail;
  const lh = d.layers.layerHeightMm;
  let cur = surf[s];
  if (!cur) {
    cur = surf[s] = { pattern: id, depthMm: USER_SLOT.depthMm, repeats: IMAGE_REPEATS, tileHeightMm: 0 };
    if (s === 'b') surf.blend = { ...surf.blend, shape: 'fadesUp', amount: 1 };
  }
  const wasImage = String(cur.pattern).startsWith('img:');
  if (!(cur.depthMm > 0) || cur.pattern === PLAIN.id) cur.depthMm = USER_SLOT.depthMm;
  if (!wasImage) cur.repeats = IMAGE_REPEATS;
  cur.pattern = id;
  const cellMm = footprintAt(d).perimeterMm / Math.max(1, cur.repeats);
  cur.tileHeightMm = snapToLayers(cellMm * (asset.height / Math.max(1, asset.width)), lh);
}

/**
 * Puts a pattern in slot `s` of the draft design: `id` null clears slot B.
 * A new slot gets the pattern's own defaults; switching texture keeps depth,
 * repeats and tile height, except from Plain (or a flat slot), which has
 * nothing worth keeping. Your own patterns travel inside the design. Mutates d.
 * @param {object} d  a draft design (inside store.apply)
 * @param {'a' | 'b'} s
 * @param {string | null} id
 * @param {object | null} entry  findEntry's result for id
 */
export function setSlotPattern(d, s, id, entry) {
  const surf = d.form.detail;
  if (!id) {
    if (s === 'b') surf.b = null;
    return;
  }
  if (entry.own || String(id).startsWith('user:')) {
    d.assets ??= {};
    d.assets[id] = entry.image ? { ...entry.image } : { kind: 'recipe', name: entry.name, recipe: structuredClone(entry.recipe) };
  }
  if (entry.image) {
    placeImage(d, s, id, entry.image);
    return;
  }
  const defaults = entry.defaults ?? (String(id).startsWith('user:') ? USER_SLOT : PLAIN_SLOT);
  const lh = d.layers.layerHeightMm;
  const cur = surf[s];
  if (!cur) {
    // Pattern rows line up with beads only at whole layers (C7).
    const tile = snapToLayers(defaults.tileHeightMm ?? surf.a.tileHeightMm, lh);
    surf[s] = { pattern: id, depthMm: defaults.depthMm ?? 0, repeats: defaults.repeats ?? 1, tileHeightMm: tile };
    if (s === 'b') surf.blend = { ...surf.blend, shape: 'fadesUp', amount: 1 };
    return;
  }
  const flat = cur.pattern === PLAIN.id || !(cur.depthMm > 0);
  cur.pattern = id;
  if (flat && defaults !== PLAIN_SLOT) {
    Object.assign(cur, defaults);
    cur.tileHeightMm = snapToLayers(cur.tileHeightMm, lh);
  }
}

/** Sends an image the engine may not have yet (main.js also sends referenced ones). */
export function ensureImage(ctx, hash) {
  Promise.resolve(loadImage(hash))
    .then((r) => r && ctx.engine?.setImage?.(hash, r))
    .catch((err) => console.warn('Image not sent to the preview', err));
}

/**
 * Picks a swatch for a Detailed morph slot as one history step ("Detailed morph A: Flutes").
 * @param {object} ctx  main.js's ctx
 * @param {'a' | 'b'} s
 * @param {string | null} id  null = None (slot B only)
 * @returns {boolean} false when the id isn't known
 */
export function pickPattern(ctx, s, id) {
  const { store, library } = ctx;
  const entry = id ? findEntry(library, id, store.state.design.assets) : null;
  if (id && !entry) return false;
  if (entry?.image) ensureImage(ctx, entry.image.hash);
  store.apply(`Detailed morph ${s.toUpperCase()}: ${id ? entry.name : 'None'}`, (d) => setSlotPattern(d, s, id, entry));
  return true;
}

/**
 * Reads an image file and puts it in slot `s` as one history step.
 * Throws a plain Error with a message for the person when the file can't be used.
 * @returns {Promise<{ id: string, asset: object }>}
 */
export async function importImageFile(ctx, file, s) {
  const m = await loadImages();
  const problem = m.fileProblem(file);
  if (problem) throw new Error(problem);
  const { id, asset } = await m.importImage(ctx, file);
  ctx.store.apply(`Detailed morph ${s.toUpperCase()}: ${asset.name}`, (d) => {
    d.assets ??= {};
    d.assets[id] = asset;
    placeImage(d, s, id, asset);
  });
  return { id, asset };
}

/**
 * Opens the 2D editor (D45, D46) on the Pattern ({ kind: 'pattern' }) or on a
 * Detailed morph slot ({ kind: 'detail', slot: 'a' | 'b' }). `mode` 'make'
 * starts an empty grid; 'edit' the drawing the target holds (editableEntry).
 * @param {object} ctx  main.js's ctx
 * @param {{ kind: 'pattern' } | { kind: 'detail', slot: 'a' | 'b' }} target
 * @param {{ mode?: 'make' | 'edit', returnFocus?: HTMLElement | null }} [opts]
 */
export function openEditor(ctx, target, opts = {}) {
  return loadEditor().then((m) => m.openPatternEditor(ctx, target, opts));
}

/**
 * Draws a pattern swatch on this pot's bead grid into `target.canvas`, and
 * remembers what it drew in `target.drawn`, so it redraws only when the
 * pattern or the grid changed. A library swatch shows at its own default
 * size; a slot's swatch at the slot's size. Images draw once their pixels
 * are in (`onLoaded` runs then).
 * @param {{ canvas: HTMLCanvasElement, drawn: string }} target
 * @param {object} entry  findEntry's result
 * @param {object | null} slot  the slot that uses it, or null for its defaults
 * @param {object} design
 * @param {number} size  CSS px
 * @param {() => void} [onLoaded]
 */
export function drawEntry(target, entry, slot, design, size, onLoaded) {
  if (!entry) return;
  const fp = footprintAt(design);
  const layers = design.layers;
  if (entry.image) {
    const a = entry.image;
    const sl = slot ?? { repeats: IMAGE_REPEATS, tileHeightMm: (fp.perimeterMm / IMAGE_REPEATS) * (a.height / Math.max(1, a.width)) };
    const g = beadGrid(sl, fp.perimeterMm, layers);
    const raster = cachedImage(a.hash);
    const key = `${entry.id}|${Math.round(g.columns)}|${Math.round(g.rows)}|${raster ? 1 : 0}|${size}`;
    if (key === target.drawn) return;
    target.drawn = key;
    if (raster) drawRasterSwatch(target.canvas, raster, { id: entry.id, size, columns: g.columns, rows: g.rows });
    else {
      drawSwatch(target.canvas, PLAIN.recipe, { id: PLAIN.id, size });
      Promise.resolve(loadImage(a.hash)).then((r) => { if (r) onLoaded?.(); }, () => {});
    }
    return;
  }
  const own = entry.own || String(entry.id).startsWith('user:');
  const g = beadGrid(slot ?? entry.defaults ?? (own ? USER_SLOT : SWATCH_FALLBACK), fp.perimeterMm, layers);
  // Library recipes cache by id; your own can change under the same id.
  const key = `${entry.id}|${own ? JSON.stringify(entry.recipe) : ''}|${Math.round(g.columns)}|${Math.round(g.rows)}|${size}`;
  if (key === target.drawn) return;
  target.drawn = key;
  drawSwatch(target.canvas, entry.recipe, { id: own ? undefined : entry.id, size, columns: g.columns, rows: g.rows });
}

/**
 * Your own swatches for the Detailed morph: the Detailed morph's entries in
 * My patterns (`saved`, with the entry and its settings as `defaults`), then
 * the recipes and images the design carries. A copy of a saved drawing shows
 * as its saved tile, and a drawing only the Pattern uses stays out (it shows
 * among the Pattern's own, layerMineEntries); so do the Pattern's saved entries.
 */
export function mineEntries(library, d, saved) {
  const out = new Map();
  const tiles = savedOfKind(saved, 'detail').map((e) => ({ ...savedTile(e), defaults: { ...e.settings } }));
  for (const t of tiles) out.set(t.id, t);
  const keys = new Set(tiles.map((t) => t.key));
  const detail = d.form?.detail;
  for (const id of Object.keys(d.assets ?? {})) {
    if (d.pattern?.drawing === id && detail?.a?.pattern !== id && detail?.b?.pattern !== id) continue;
    const e = findEntry(library, id, d.assets);
    if (!e?.own || (e.recipe && keys.has(drawingKey('detail', e.recipe)))) continue;
    out.set(id, e);
  }
  return [...out.values()];
}

// ---------- The Pattern (the bead-scale bitmap, D35–D48) ----------

/** How wide a square of wall a Pattern swatch shows, in bead widths: the pot's own bead scale (§3.8). */
export const LAYER_SWATCH_BEADS = 8;

/**
 * A Pattern drawing by id: a starter (library.layerPatterns) or a bitmap of
 * your own in the design's assets.
 * @returns {{ id: string, name: string, recipe: object, own?: boolean, defaults?: object, description?: string } | null}
 */
export function findLayerEntry(library, id, assets) {
  if (typeof id !== 'string' || !id) return null;
  const a = assets?.[id];
  if (a?.kind === 'recipe' && a.recipe?.kind === 'bitmap') return { id, name: a.name || 'My pattern', recipe: a.recipe, own: true };
  return library?.layerPatterns?.find((p) => p.id === id) ?? null;
}

/**
 * Puts a Pattern drawing on the draft design; null takes the Pattern off.
 * A first Pattern starts from newPattern (its range over the Detailed
 * morph's, D41). Switching drawings keeps From / To, Fade and Soften; a
 * starter brings its own depth and density, which pass bead support on the
 * presets (§3.8), and one of your own keeps the ones you had. A drawing of
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
    d.pattern = newPattern(d, entry.id, entry.defaults);
    return;
  }
  d.pattern.drawing = entry.id;
  if (entry.defaults) Object.assign(d.pattern, drawingDefaults(d, entry.defaults));
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
 * the drawing of your own on the pot unless it is one of them. The Detailed
 * morph's entries never show here.
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
/**
 * The density readout (D40, §3.2): "96 points per layer · 3.8–6.1 mm",
 * from the narrowest layer in the range to the widest.
 * @param {ReturnType<typeof patternReadout>} r
 */
export function densityText(r) {
  if (!r) return '';
  const lo = mm1(r.spacingMinMm);
  const hi = mm1(r.spacingMaxMm);
  return `${r.nodes} points per layer · ${lo === hi ? `${lo} mm apart` : `${lo}–${hi} mm`}${r.clamped ? ' · the most a layer takes' : ''}`;
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
  const spacing = spacingMm ?? drawingDefaults(design, entry.defaults).density.spacingMm;
  const key = `${entry.id}|${entry.own ? entry.recipe.cells : ''}|${entry.recipe.columns}|${spacing.toFixed(2)}|${h}|${w}|${size}`;
  if (key === target.drawn) return;
  target.drawn = key;
  drawBitmapSwatch(target.canvas, entry.recipe, {
    id: entry.own ? undefined : entry.id, size, cellWidthMm: spacing, cellHeightMm: h, windowMm: LAYER_SWATCH_BEADS * w,
  });
}

// ---------- The 2D editor (D45, D46) ----------

/**
 * The most cells a side the editor draws (D57): 24 for a Pattern, 16 for a
 * Detailed morph's coarse grid (D45), so every cell stays one you can hit.
 * The bitmap format itself holds up to 64 (D48): a larger drawing from a
 * file still opens, it just can't grow.
 */
export const EDITOR_MAX = Object.freeze({ pattern: 24, detail: 16 });
/**
 * The grid *Make your own* starts with: small enough that a Pattern's whole
 * tile fits a 360 px phone at the clickable cell size (D56).
 */
export const NEW_GRID = Object.freeze({ pattern: { columns: 6, rows: 6 }, detail: { columns: 6, rows: 4 } });
/**
 * A first Pattern drawn in the editor starts as deep and as dense as the
 * starters (§11.2): 0.14 bead passes bead support on every preset.
 */
export const OWN_PATTERN_DEFAULTS = Object.freeze({ depthBeads: 0.14, spacingBeads: 1 });

const copyName = (name) => `${name} (mine)`.slice(0, 80);
const sessionLabel = (target) => (target.kind === 'pattern' ? 'Edited pattern' : `Edited Detailed morph ${target.slot.toUpperCase()}`);

/**
 * The drawing the editor would open on *Edit* for a target, or null when it
 * holds none (no Pattern, or a slot with a shape, an image or Plain: the
 * analytic shapes stay library-only, D45).
 * @param {object} design
 * @param {object} library
 * @param {{ kind: 'pattern' } | { kind: 'detail', slot: 'a' | 'b' }} target
 */
export function editableEntry(design, library, target) {
  if (target.kind === 'pattern') {
    const id = design.pattern?.drawing;
    return id ? findLayerEntry(library, id, design.assets) : null;
  }
  const slot = design.form.detail[target.slot];
  const entry = slot ? findEntry(library, slot.pattern, design.assets) : null;
  return entry?.recipe?.kind === 'bitmap' ? entry : null;
}

/** The id of the drawing a target shows now, or null. */
export function targetDrawingId(design, target) {
  if (target.kind === 'pattern') return design.pattern?.drawing ?? null;
  return design.form.detail[target.slot]?.pattern ?? null;
}

/**
 * What an editor session starts from. *Make your own* is an empty grid
 * (NEW_GRID). *Edit* opens the target's drawing: a library one as a copy
 * ("Knit (mine)"), your own in place (`replaces`: it goes once the edit
 * replaces it), unless something else draws with it too, which then keeps
 * its own. Each edit goes in under its own content id (writeEditorDrawing).
 * `kept` lists the design's assets that stay when the session replaces them.
 *
 * A Detailed morph grid keeps its cells their size when the tile grows or
 * shrinks (`base`, writeEditorDrawing). On a slot with a texture it starts
 * from the slot's repeats and tile height; on a flat or empty one from
 * USER_SLOT.
 * @param {object} design  normalised
 * @param {object} library
 * @param {{ kind: 'pattern' } | { kind: 'detail', slot: 'a' | 'b' }} target
 * @param {'make' | 'edit'} mode
 * @returns {{ target: object, mode: string, name: string, recipe: object, label: string,
 *   opened: { drawing: string | null, cells: string | null }, replaces: string | null, kept: string[],
 *   base: null | { columns: number, rows: number, repeats: number, tileHeightMm: number } }}
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
    if (target.kind === 'pattern') delete recipe.edges;          // a Pattern is always crisp (D53)
    else recipe.edges ??= 'soft';
  } else {
    const size = NEW_GRID[target.kind];
    name = SAVED_NAMES[target.kind];
    recipe = makeBitmap(size.columns, size.rows, new Int8Array(size.columns * size.rows), target.kind === 'detail' ? 'soft' : undefined);
  }
  const kept = Object.keys(design.assets ?? {}).filter((id) => id !== replaces);
  let base = null;
  if (target.kind === 'detail') {
    const slot = design.form.detail[target.slot];
    const kept = textured(slot) && slot.depthMm > 0;
    base = {
      columns: recipe.columns,
      rows: recipe.rows,
      repeats: kept ? slot.repeats : USER_SLOT.repeats,
      tileHeightMm: kept ? slot.tileHeightMm : snapToLayers(USER_SLOT.tileHeightMm, design.layers.layerHeightMm),
    };
  }
  return { target, mode, name, recipe, label, opened, replaces, kept, base };
}

/**
 * The repeats and tile height of a Detailed morph grid of `columns × rows`
 * whose cells keep the size they had when the session started: a tile one
 * row taller is one cell height taller (in whole layers), one column wider
 * takes the wall of one more cell, so fewer repeats fit around.
 * @param {{ columns: number, rows: number, repeats: number, tileHeightMm: number }} base
 */
export function detailTileFor(base, columns, rows, layerHeightMm) {
  const maxRepeats = LIMITS.repeats?.max ?? Infinity;
  const repeats = columns === base.columns
    ? base.repeats
    : Math.min(maxRepeats, Math.max(1, Math.round((base.repeats * base.columns) / columns)));
  const tileHeightMm = rows === base.rows ? base.tileHeightMm : snapToLayers((base.tileHeightMm * rows) / base.rows, layerHeightMm);
  return { repeats, tileHeightMm };
}

/**
 * Puts the editor's drawing on the draft design (inside store.change): the
 * recipe goes into design.assets under its content id (drawingId), named as
 * the session names it, and the target draws with it. A first Pattern starts
 * from newPattern with OWN_PATTERN_DEFAULTS; an existing one keeps its depth,
 * density, range, Fade and Soften. A Detailed morph slot gets the grid at its
 * cells' size (detailTileFor) and, when it was flat or empty, USER_SLOT's
 * depth. The drawing it replaces goes when nothing draws with it: for the
 * Pattern always, for a slot when the session wrote it or edits it in place
 * (a swatch of your own the design had stays among its swatches). Mutates d.
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
  if (start.target.kind === 'pattern') {
    if (!d.pattern) d.pattern = newPattern(d, id, OWN_PATTERN_DEFAULTS);
    else d.pattern.drawing = id;
    if (prev !== id) dropUnusedDrawing(d, prev);
    return id;
  }
  const s = start.target.slot;
  const surf = d.form.detail;
  const { repeats, tileHeightMm } = detailTileFor(start.base, recipe.columns, recipe.rows, d.layers.layerHeightMm);
  let slot = surf[s];
  if (!slot) {
    slot = surf[s] = { pattern: id, depthMm: USER_SLOT.depthMm, repeats, tileHeightMm };
    if (s === 'b') surf.blend = { ...surf.blend, shape: 'fadesUp', amount: 1 };
  }
  if (slot.pattern === PLAIN.id || !(slot.depthMm > 0)) slot.depthMm = USER_SLOT.depthMm;
  slot.pattern = id;
  slot.repeats = repeats;
  slot.tileHeightMm = tileHeightMm;
  if (prev !== id && !(start.kept ?? []).includes(prev)) dropUnusedDrawing(d, prev);
  return id;
}

// ---------- My patterns (D48, §3.9): saving a setup, applying it ----------

/**
 * A drawing's identity in My patterns: its content id (drawingId), crisp for
 * a Pattern (a Pattern has no edges, D53), with its edges ('soft' when it has
 * none) for a Detailed morph grid. Null for anything that isn't a bitmap.
 * @param {'pattern' | 'detail'} kind
 * @param {object | null | undefined} recipe
 */
export function drawingKey(kind, recipe) {
  if (recipe?.kind !== 'bitmap') return null;
  const { columns, rows, cells } = recipe;
  return drawingId(kind === 'pattern' ? { columns, rows, cells } : { columns, rows, cells, edges: recipe.edges ?? 'soft' });
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
 * What Save writes for a target (§3.9, D48), and the name it offers: the
 * drawing the target shows, as a bitmap, with the settings that go with it.
 * A Pattern brings its depth, density (its face and value), Fade and Soften,
 * never From / To, which depend on the pot's height; a Detailed morph slot
 * brings its depth, repeats and tile height. Null when the target shows no
 * drawing: no Pattern, or a slot with a shape, an image or Plain, which stay
 * library-only (D45).
 * @returns {null | { kind: 'pattern' | 'detail', name: string, drawing: object, settings: object }}
 */
export function savableEntry(design, library, target) {
  const e = editableEntry(design, library, target);
  if (!e?.recipe) return null;
  const { columns, rows, cells, edges } = e.recipe;
  if (target.kind === 'pattern') {
    return { kind: 'pattern', name: e.name, drawing: { kind: 'bitmap', columns, rows, cells }, settings: patternSettings(design.pattern) };
  }
  const slot = design.form.detail[target.slot];
  return {
    kind: 'detail',
    name: e.name,
    drawing: { kind: 'bitmap', columns, rows, cells, edges: edges ?? 'soft' },
    settings: { depthMm: slot.depthMm, repeats: slot.repeats, tileHeightMm: slot.tileHeightMm },
  };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Applies a saved Pattern to a draft design (D48): its drawing, depth,
 * density, Fade and Soften. The design keeps its own From / To, or takes the
 * default range when it has no Pattern yet (a preset opens without one,
 * D52). Its own copy of the drawing goes into design.assets under the
 * drawing's content id, so it opens without My patterns and a design file
 * carries it. Depth and spacing hold to this design's bead (at most half a
 * bead deep, ½ to 3 beads apart), as normaliseDesign would. A drawing of
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
 * Applies a saved Detailed morph swatch to slot `s` of a draft design (D48):
 * its drawing, depth, repeats and tile height (in whole layers of this
 * design). A new slot B blends in as a first pick of B does. The range and
 * the blend stay the design's. The design keeps its own copy of the drawing,
 * as applyPatternEntry. Mutates d.
 * @param {object} d
 * @param {'a' | 'b'} s
 * @param {{ name: string, drawing: object, settings: object }} entry  a Detailed morph entry of My patterns
 */
export function applyDetailEntry(d, s, entry) {
  const id = drawingKey('detail', entry.drawing);
  const { columns, rows, cells, edges } = entry.drawing;
  d.assets ??= {};
  d.assets[id] = { kind: 'recipe', name: entry.name, recipe: { kind: 'bitmap', columns, rows, cells, edges: edges ?? 'soft' } };
  const surf = d.form.detail;
  const set = {
    pattern: id,
    depthMm: clamp(entry.settings.depthMm, LIMITS.depthMm?.min ?? 0, LIMITS.depthMm?.max ?? Infinity),
    repeats: clamp(Math.round(entry.settings.repeats), LIMITS.repeats?.min ?? 1, LIMITS.repeats?.max ?? Infinity),
    tileHeightMm: snapToLayers(entry.settings.tileHeightMm, d.layers.layerHeightMm),
  };
  if (surf[s]) {
    Object.assign(surf[s], set);
    return;
  }
  surf[s] = set;
  if (s === 'b') surf.blend = { ...surf.blend, shape: 'fadesUp', amount: 1 };
}

/**
 * Applies one of My patterns' Patterns as one history step ("Pattern:
 * Zigzag"); nothing when the design already has all of it.
 * @returns {boolean} whether the design changed
 */
export function pickSavedPattern(ctx, entry) {
  return ctx.store.apply(`Pattern: ${entry.name}`, (d) => applyPatternEntry(d, entry));
}

/** Applies one of My patterns' swatches to slot `s` as one history step ("Detailed morph A: Zigzag"). */
export function pickSavedDetail(ctx, s, entry) {
  return ctx.store.apply(`Detailed morph ${s.toUpperCase()}: ${entry.name}`, (d) => applyDetailEntry(d, s, entry));
}

/**
 * The node spacing a saved Pattern's swatch shows at on this pot: its own
 * spacing, held to this bead, or a bead apart when it is set in points.
 */
export function savedSpacingMm(design, entry) {
  const w = design.layers.beadWidthMm;
  const density = entry.settings.density;
  const mm = density.by === 'spacing' ? density.spacingMm : SPACING_BEADS.default * w;
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
 * replaces it. Only the default names ("My pattern", "My swatch") are
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
 * @param {{ kind: 'pattern' } | { kind: 'detail', slot: 'a' | 'b' }} target
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
    store.apply(`${entry.kind === 'pattern' ? 'Saved pattern' : 'Saved swatch'}: ${stored.name}`, (d) => { nameDrawing(d, target, key, stored.name); });
  }
  return { entry: stored, replaced: !!existing };
}

/** Whether the design draws with a saved entry's drawing (so it keeps its own copy once the entry goes). */
export function drawsWith(design, library, entry) {
  const key = drawingKey(entry.kind, entry.drawing);
  const targets = entry.kind === 'pattern' ? [{ kind: 'pattern' }] : [{ kind: 'detail', slot: 'a' }, { kind: 'detail', slot: 'b' }];
  return targets.some((t) => targetKey(design, library, t) === key);
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
