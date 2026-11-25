// The Pattern (D35–D43): a bead-scale bitmap matched to the layers, set in
// design.pattern and drawn from a `bitmap` recipe (core/patterns.js).
//
// One row of the tile is one printed layer, always: row k prints on the k-th
// wall layer from the Pattern's From (mod rows), so the tile starts at From,
// as drawn, and repeats upwards (row 0 is the bottom row). One cell is one
// node, a single toolpath point. Every layer in the range has the same
// N = repeats × columns nodes at u_j = j / N (u from 0, the outline's own
// start, so the columns line up from layer to layer and follow the twist);
// node j uses column j mod columns. Between nodes the Pattern runs straight,
// so in·out·in·out is a zigzag (D37). It is added radially, after the
// profile, the Morph and the Detailed morph.
//
// Displacement at a node = depth × softened cell × fade:
//   Soften (σ 0–2 cells, wrapping both ways) blurs the drawing first;
//   Fade multiplies by a strength over From–To (D42).
// Neither changes the drawing itself, which stays in / flat / out.
//
// Density (D40) is the node spacing around, set as a spacing in mm (measured
// on the narrowest layer in the range; the repeats are whole, so the spacing
// shown is recomputed from them) or as points per layer (a whole number of
// tiles). The one set last is kept when the pot changes size.

import { PI, dsin } from './math.js';
import { PLAIN, bitmapValues } from './patterns.js';
import { blendShape } from './surface.js';
import { blurGrid } from './raster.js';

export const FADE_SHAPES = ['even', 'fadesUp', 'fadesDown', 'middle', 'diagonal'];
export const DENSITY_FACES = ['spacing', 'points'];
/** Node spacing around, in bead widths (D40). */
export const SPACING_BEADS = Object.freeze({ min: 0.5, max: 3, default: 1 });
/** Depth as a share of a bead width: the most, and the default (D38, §3.3). */
export const DEPTH_BEADS = Object.freeze({ max: 0.5, default: 0.25 });
export const DEFAULT_POINTS = 96;

/**
 * Where a new Pattern runs: the Detailed morph's range when it has one,
 * else from 8 mm to 10 mm below the rim (§3.4).
 * @param {object} design normalised
 * @returns {{ fromMm: number, toMm: number }}
 */
export function defaultPatternRange(design) {
  const detail = design.form.detail;
  const on = (slot) => !!slot && slot.pattern !== PLAIN.id && slot.depthMm > 0;
  if (detail && (on(detail.a) || on(detail.b))) return { fromMm: detail.fromMm, toMm: detail.toMm };
  const H = design.form.height;
  const h = design.layers.layerHeightMm;
  const toMm = Math.max(H - 10, h);
  return { fromMm: Math.min(8, Math.max(toMm - h, 0)), toMm };
}

/**
 * The drawing a Pattern names: a 'user:…' recipe in design.assets or a
 * 'lib:…' entry of library.layerPatterns. Only bitmaps draw a Pattern.
 * @returns {object | null} the bitmap recipe, or null when it can't be found
 */
export function findDrawing(design, library) {
  const id = design.pattern?.drawing;
  if (typeof id !== 'string') return null;
  let recipe = null;
  if (id.startsWith('user:')) {
    const asset = design.assets?.[id];
    if (asset?.kind === 'recipe') recipe = asset.recipe;
  } else {
    recipe = library?.layerPatterns?.find?.((p) => p.id === id)?.recipe ?? null;
  }
  return recipe?.kind === 'bitmap' ? recipe : null;
}

/**
 * Strength of the Pattern at t (0 at From, 1 at To) and u (D42, §3.5).
 * Diagonal is a band without pattern that winds once round the pot over
 * From–To: 1 − a·sin²(π(t + u)).
 * @param {{ shape: string, amount: number }} fade
 */
export function fadeAt(fade, t, u) {
  if (fade.shape === 'even') return 1;
  if (fade.shape === 'diagonal') {
    const s = dsin(PI * (t + u));
    return 1 - fade.amount * s * s;
  }
  return 1 - fade.amount * blendShape(fade.shape, t);
}

/**
 * Nodes around for a Pattern (D40): N = repeats × columns.
 * @param {{ by: string, spacingMm: number, points: number }} density
 * @param {number} columns
 * @param {number} perimeterMinMm the narrowest layer's perimeter in the range
 * @param {number} maxNodes the most nodes a layer may have
 * @returns {{ repeats: number, nodes: number, clamped: boolean }}
 */
export function nodesAround(density, columns, perimeterMinMm, maxNodes) {
  let repeats = density.by === 'points'
    ? Math.round(density.points / columns)
    : Math.floor(perimeterMinMm / (columns * density.spacingMm) + 1e-9);
  repeats = Math.max(1, repeats);
  const most = Math.max(1, Math.floor(maxNodes / columns));
  const clamped = repeats > most;
  if (clamped) repeats = most;
  return { repeats, nodes: repeats * columns, clamped };
}

/**
 * Everything the toolpath needs to add the Pattern, precomputed once.
 * @param {object} design normalised
 * @param {object} library
 * @param {{ profile: { at(z: number): number }, unitPerimeter: number, layerCount: number,
 *           baseLayers: number, maxNodes: number }} wall
 * @returns {null | {
 *   drawing: string, missing: boolean, active: boolean, recipe: object | null,
 *   columns: number, rows: number, repeats: number, nodes: number, clamped: boolean,
 *   first: number, last: number, depthMm: number, spacingMinMm: number, spacingMaxMm: number,
 *   inRange(layer: number): boolean, rowOf(layer: number): number, at(layer: number, u: number): number,
 * }} null when the design has no Pattern
 */
export function createLayerPattern(design, library, { profile, unitPerimeter, layerCount, baseLayers, maxNodes }) {
  const p = design.pattern;
  if (!p) return null;
  const h = design.layers.layerHeightMm;
  const recipe = findDrawing(design, library);
  // Wall layers whose middle lies in From–To; the Pattern starts and stops sharply.
  let first = Math.max(baseLayers, Math.ceil(p.fromMm / h - 0.5 - 1e-9));
  const last = Math.min(layerCount - 1, Math.floor(p.toMm / h - 0.5 + 1e-9));
  if (first > last) first = last + 1;
  const columns = recipe ? recipe.columns : 1;
  const rows = recipe ? recipe.rows : 1;

  let perimeterMin = Infinity;
  let perimeterMax = 0;
  for (let i = first; i <= last; i++) {
    const perimeter = profile.at((i + 1) * h) * unitPerimeter;
    if (perimeter < perimeterMin) perimeterMin = perimeter;
    if (perimeter > perimeterMax) perimeterMax = perimeter;
  }
  if (first > last) perimeterMin = perimeterMax = profile.at(design.form.height / 2) * unitPerimeter;
  const { repeats, nodes: N, clamped } = nodesAround(p.density, columns, perimeterMin, maxNodes);
  const active = !!recipe && p.depthMm > 0 && first <= last;

  const grid = recipe
    ? blurGrid(Float32Array.from(bitmapValues(recipe)), columns, rows, p.softenCells, p.softenCells, true)
    : new Float32Array(1);
  const span = Math.max(last - first, 1);
  const inRange = (i) => active && i >= first && i <= last;
  const rowOf = (i) => (inRange(i) ? (i - first) % rows : -1);

  // Node displacements per layer. Wall points alternate between their own
  // layer and the one below (the checks), so two layers are kept.
  const cache = [{ layer: -1, values: new Float64Array(N) }, { layer: -1, values: new Float64Array(N) }];
  let flip = 0;
  function nodesOf(i) {
    if (cache[0].layer === i) return cache[0].values;
    if (cache[1].layer === i) return cache[1].values;
    const entry = cache[flip];
    flip ^= 1;
    entry.layer = i;
    const offset = rowOf(i) * columns;
    const t = (i - first) / span;
    const uniform = p.fade.shape !== 'diagonal';
    const strength = uniform ? fadeAt(p.fade, t, 0) : 1;
    for (let j = 0; j < N; j++) {
      const f = uniform ? strength : fadeAt(p.fade, t, j / N);
      entry.values[j] = p.depthMm * grid[offset + (j % columns)] * f;
    }
    return entry.values;
  }

  /** The Pattern's radial push in mm on wall layer i at outline position u. */
  function at(i, u) {
    if (!inRange(i)) return 0;
    const v = nodesOf(i);
    const x = (u - Math.floor(u)) * N;
    let j = Math.floor(x);
    let f = x - j;
    // A point on a node takes the node's own value, not a hair of the next.
    if (f > 1 - 1e-7) { j += 1; f = 0; } else if (f < 1e-7) f = 0;
    if (j >= N) j -= N;
    if (f === 0) return v[j];
    const next = j + 1 === N ? 0 : j + 1;
    return v[j] + f * (v[next] - v[j]);
  }

  return {
    drawing: p.drawing, missing: !recipe, active, recipe,
    columns, rows, repeats, nodes: N, clamped, first, last, depthMm: p.depthMm,
    spacingMinMm: perimeterMin / N, spacingMaxMm: perimeterMax / N,
    inRange, rowOf, at,
  };
}

/**
 * The Pattern settings a new Pattern starts with (D38, D40): a quarter bead
 * deep, nodes one bead apart, crisp, no fade, over defaultPatternRange.
 * @param {object} design normalised
 * @param {string} drawing
 */
export function newPattern(design, drawing) {
  const w = design.layers.beadWidthMm;
  return {
    drawing,
    depthMm: Math.round(DEPTH_BEADS.default * w * 100) / 100,
    density: { by: 'spacing', spacingMm: SPACING_BEADS.default * w, points: DEFAULT_POINTS },
    ...defaultPatternRange(design),
    fade: { shape: 'even', amount: 1 },
    softenCells: 0,
  };
}

