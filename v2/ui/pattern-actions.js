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

import { PLAIN, makeBitmap } from '../core/patterns.js';
import { LIMITS } from '../core/design.js';
import { MAX_NODES, SPACING_BEADS, drawingDefaults, newPattern, patternReadout } from '../core/layer-pattern.js';
import { footprintAt } from './sections/shape.js';
import { drawSwatch, drawRasterSwatch, drawBitmapSwatch, beadGrid } from './swatch.js';
import { loadImage, cachedImage } from '../store/assets.js';

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
 * A pattern by id: Plain, the design's own assets (`user:` recipes and
 * `img:` images), the library, then "My patterns" saved in this browser.
 * @returns {{ id: string, name: string, recipe?: object, image?: object, own?: boolean, defaults?: object } | null}
 */
export function findEntry(library, id, assets, saved) {
  if (id === PLAIN.id) return PLAIN;
  const a = assets?.[id];
  if (a?.kind === 'recipe' && a.recipe) return { id, name: a.name || 'My pattern', recipe: a.recipe, own: true };
  if (a?.kind === 'image') return { id, name: a.name || 'Image', image: a, own: true };
  return library.patterns.find((p) => p.id === id) ?? saved?.find((p) => p.id === id) ?? null;
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

/** A new id for a drawing of your own: 'user:' + 8 hex characters. */
export function newOwnId() {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return `user:${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

// A Pattern drawing of your own that nothing draws with any more goes, so it
// can't turn up among the Detailed morph's own swatches. Until Save pattern
// keeps drawings across designs (D48), nothing lists it anyway. Mutates d.
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
 * @param {object[]} [saved]  My patterns, as listPatterns() gave them
 * @returns {boolean} false when the id isn't known
 */
export function pickPattern(ctx, s, id, saved) {
  const { store, library } = ctx;
  const entry = id ? findEntry(library, id, store.state.design.assets, saved) : null;
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
 * @param {{ mode?: 'make' | 'edit', saved?: object[], returnFocus?: HTMLElement | null }} [opts]
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
 * Your own patterns for the Detailed morph: My patterns saved in this
 * browser, plus the recipes and images the design carries, except a drawing
 * only the Pattern uses (it shows among the Pattern's own, layerMineEntries).
 */
export function mineEntries(library, d, saved) {
  const out = new Map();
  for (const p of saved || []) out.set(p.id, { id: p.id, name: p.name, recipe: p.recipe });
  const detail = d.form?.detail;
  for (const id of Object.keys(d.assets ?? {})) {
    if (d.pattern?.drawing === id && detail?.a?.pattern !== id && detail?.b?.pattern !== id) continue;
    const e = findEntry(library, id, d.assets);
    if (e?.own) out.set(id, e);
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

/** Your own Pattern drawings for this design (saving them across designs comes with D48). */
export function layerMineEntries(library, d) {
  const id = d.pattern?.drawing;
  const e = typeof id === 'string' && id.startsWith('user:') ? findLayerEntry(library, id, d.assets) : null;
  return e ? [e] : [];
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

/** The most cells a side: a Pattern up to 64 (D48), a Detailed morph's coarse grid up to 16 (D45). */
export const EDITOR_MAX = Object.freeze({ pattern: 64, detail: 16 });
/** The grid *Make your own* starts with. */
export const NEW_GRID = Object.freeze({ pattern: { columns: 8, rows: 8 }, detail: { columns: 6, rows: 4 } });
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
 * @param {object[]} [saved]  My patterns
 */
export function editableEntry(design, library, target, saved) {
  if (target.kind === 'pattern') {
    const id = design.pattern?.drawing;
    return id ? findLayerEntry(library, id, design.assets) : null;
  }
  const slot = design.form.detail[target.slot];
  const entry = slot ? findEntry(library, slot.pattern, design.assets, saved) : null;
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
 * ("Knit (mine)"), your own in place, unless something else draws with it
 * too, which then keeps its own.
 *
 * A Detailed morph grid keeps its cells their size when the tile grows or
 * shrinks (`base`, writeEditorDrawing). On a slot with a texture it starts
 * from the slot's repeats and tile height; on a flat or empty one from
 * USER_SLOT.
 * @param {object} design  normalised
 * @param {object} library
 * @param {{ kind: 'pattern' } | { kind: 'detail', slot: 'a' | 'b' }} target
 * @param {'make' | 'edit'} mode
 * @param {object[]} [saved]
 * @returns {{ target: object, mode: string, id: string, name: string, recipe: object, label: string,
 *   opened: { drawing: string | null, cells: string | null },
 *   base: null | { columns: number, rows: number, repeats: number, tileHeightMm: number } }}
 */
export function editorStart(design, library, target, mode, saved) {
  const entry = editableEntry(design, library, target, saved);
  const opened = { drawing: targetDrawingId(design, target), cells: entry?.recipe?.cells ?? null };
  const label = sessionLabel(target);
  let id;
  let name;
  let recipe;
  if (mode === 'edit' && entry) {
    const inPlace = (entry.own || String(entry.id).startsWith('user:')) && assetUses(design, entry.id) <= 1;
    id = inPlace ? entry.id : newOwnId();
    name = inPlace ? entry.name : copyName(entry.name);
    recipe = structuredClone(entry.recipe);
    if (target.kind === 'pattern') delete recipe.edges;          // a Pattern is always crisp (D53)
    else recipe.edges ??= 'soft';
  } else {
    const size = NEW_GRID[target.kind];
    id = newOwnId();
    name = target.kind === 'pattern' ? 'My pattern' : 'My swatch';
    recipe = makeBitmap(size.columns, size.rows, new Int8Array(size.columns * size.rows), target.kind === 'detail' ? 'soft' : undefined);
  }
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
  return { target, mode, id, name, recipe, label, opened, base };
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
 * recipe goes into design.assets under the session's id and the target
 * draws with it. A first Pattern starts from newPattern with
 * OWN_PATTERN_DEFAULTS; an existing one keeps its depth, density, range,
 * Fade and Soften. A Detailed morph slot gets the grid at its cells' size
 * (detailTileFor) and, when it was flat or empty, USER_SLOT's depth.
 * Mutates d.
 * @param {object} d
 * @param {ReturnType<typeof editorStart>} start
 * @param {object} recipe  the bitmap the editor holds
 */
export function writeEditorDrawing(d, start, recipe) {
  d.assets ??= {};
  d.assets[start.id] = { kind: 'recipe', name: start.name, recipe: structuredClone(recipe) };
  if (start.target.kind === 'pattern') {
    if (!d.pattern) {
      d.pattern = newPattern(d, start.id, OWN_PATTERN_DEFAULTS);
      return;
    }
    const old = d.pattern.drawing;
    d.pattern.drawing = start.id;
    dropUnusedDrawing(d, old);
    return;
  }
  const s = start.target.slot;
  const surf = d.form.detail;
  const { repeats, tileHeightMm } = detailTileFor(start.base, recipe.columns, recipe.rows, d.layers.layerHeightMm);
  let slot = surf[s];
  if (!slot) {
    slot = surf[s] = { pattern: start.id, depthMm: USER_SLOT.depthMm, repeats, tileHeightMm };
    if (s === 'b') surf.blend = { ...surf.blend, shape: 'fadesUp', amount: 1 };
  }
  if (slot.pattern === PLAIN.id || !(slot.depthMm > 0)) slot.depthMm = USER_SLOT.depthMm;
  slot.pattern = start.id;
  slot.repeats = repeats;
  slot.tileHeightMm = tileHeightMm;
}
