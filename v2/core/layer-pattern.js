// The Pattern (D35–D43): a bead-scale bitmap matched to the layers, set in
// design.pattern and drawn from a `bitmap` recipe (core/patterns.js).
//
// One row of the tile is one printed layer, always: row k prints on the k-th
// wall layer from the Pattern's From (mod rows), so the tile starts at From,
// as drawn, and repeats upwards (row 0 is the bottom row). One cell is one
// node, a single toolpath point. Every layer in the range has the same
// N = repeats × columns nodes at u_j = j / N (u from 0, the outline's own
// start, so the columns line up from layer to layer and follow the twist);
// node j uses column j mod columns. Crisp (Soften 0), the nodes are the
// layer's only points (D58): they stand one above the other and the Pattern
// runs straight between them, so in·out·in·out is a zigzag (D37). With Soften
// on, every gap gets the same `extra` points, about half a bead apart, on a
// smooth curve through the softened nodes (D59). It is added radially, after
// the profile and the Morph.
//
// A layer starts where the one below ended, on that layer's row, and changes
// to its own row over the seam ramp (D60): `at` takes the share of the row
// below, so the path never steps sideways at the seam.
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
//
// Slant (D70) moves the drawing round(slant × k) whole cells on the k-th
// layer from From, so the nodes stay nodes and vertical stripes become
// diagonal lines. With the Facets morph and *Different on each facet* (D71),
// each face takes its own slant between Slant and To, fixed by the Facets
// layout: a node finds its face at the layer's middle height.

import { bitmapValues } from './patterns.js';
import { BLEND_SHAPES, blendShape } from './surface.js';
import { blurGrid } from './raster.js';
import { createProfile } from './profile.js';
import { createPlan } from './plan.js';
import { FACETS_MAP, facetShare } from './morph.js';

/** The Fade's shapes (D42, D54). */
export const FADE_SHAPES = BLEND_SHAPES;
export const DENSITY_FACES = ['spacing', 'points'];
/** Node spacing around, in bead widths (D40; from a quarter bead since D64, so 2 mm fits the standard 8 mm bead). */
export const SPACING_BEADS = Object.freeze({ min: 0.25, max: 3 });
/** The node spacing every drawing starts with: 2 mm (D64), held to the bead's range. */
export const DEFAULT_SPACING_MM = 2;
/** The standard node spacing for a bead width, in mm. */
export function defaultSpacingMm(beadWidthMm) {
  return Math.min(Math.max(DEFAULT_SPACING_MM, SPACING_BEADS.min * beadWidthMm), SPACING_BEADS.max * beadWidthMm);
}
/**
 * Depth as a share of a bead width: the most, and the standard every drawing
 * starts with, both two thirds of a bead (D61; D38 had half a bead at most).
 */
export const DEPTH_BEADS = Object.freeze({ max: 2 / 3, default: 2 / 3 });
export const DEFAULT_POINTS = 96;
/** The most nodes a layer may have: the toolpath's MAX_POINTS_PER_LAYER (a test keeps them equal). */
export const MAX_NODES = 1600;
/** A Pattern without slant (D70). */
export const NO_SLANT = Object.freeze({ cells: 0, perFacet: false, toCells: 0 });

/**
 * Whether a Pattern's slant changes from face to face (D71): asked for, and
 * the design's Morph is Facets.
 * @param {object} design normalised
 */
export function slantPerFacet(design) {
  return !!design.pattern?.slant?.perFacet && design.form.morph?.map === FACETS_MAP;
}

/**
 * Where a new Pattern runs (§3.4): from 8 mm to 10 mm below the rim.
 * @param {object} design normalised
 * @returns {{ fromMm: number, toMm: number }}
 */
export function defaultPatternRange(design) {
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
  return 1 - fade.amount * blendShape(fade.shape, t, u);
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
 * Points between two nodes (D58, D59): none when crisp, so a layer has its
 * nodes alone; with Soften on, enough to space the points about half a bead
 * apart on the widest layer, the same in every gap and on every layer.
 * @param {number} softenCells
 * @param {number} nodes
 * @param {number} perimeterMaxMm the widest layer's perimeter in the range
 * @param {number} beadWidthMm
 * @param {number} maxNodes the most points a layer may have
 */
export function extraPoints(softenCells, nodes, perimeterMaxMm, beadWidthMm, maxNodes) {
  if (!(softenCells > 0)) return 0;
  const want = Math.ceil(perimeterMaxMm / nodes / (beadWidthMm / 2) - 1e-9) - 1;
  return Math.max(0, Math.min(want, Math.floor(maxNodes / nodes) - 1));
}

/**
 * Which layers the Pattern prints on and how many nodes each gets (D40, D41):
 * the wall layers whose middle, (i + ½)·h, lies in From–To (never the base),
 * and N = repeats × columns from the density, measured on the narrowest of them.
 * @param {object} design normalised, with a Pattern
 * @param {object | null} recipe its drawing
 * @param {{ profile: { at(z: number): number }, unitPerimeter: number, layerCount: number,
 *           baseLayers: number, maxNodes: number }} wall
 */
function patternLayout(design, recipe, { profile, unitPerimeter, layerCount, baseLayers, maxNodes }) {
  const p = design.pattern;
  const h = design.layers.layerHeightMm;
  const w = design.layers.beadWidthMm;
  let first =Math.max(baseLayers, Math.ceil(p.fromMm / h - 0.5 - 1e-9));
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
  const { repeats, nodes, clamped } = nodesAround(p.density, columns, perimeterMin, maxNodes);
  const extra = extraPoints(p.softenCells, nodes, perimeterMax, w, maxNodes);
  return {
    first, last, columns, rows, repeats, nodes, clamped, extra, pointsPerLayer: nodes * (extra + 1),
    perimeterMinMm: perimeterMin, spacingMinMm: perimeterMin / nodes, spacingMaxMm: perimeterMax / nodes,
  };
}

/**
 * The Pattern's density readout without building the toolpath (D40, §3.2),
 * the same numbers PreviewResult.pattern reports: for the controls, which
 * also need them in Shape (where the preview leaves the Pattern out) and
 * before a preview has come back.
 * @param {object} design normalised
 * @param {object} library
 * @returns {null | { columns: number, rows: number, repeats: number, nodes: number, clamped: boolean,
 *   spacingMinMm: number, spacingMaxMm: number, perimeterMinMm: number, layers: number }}
 *   null without a Pattern or when its drawing can't be found; layers is how many it prints on
 */
export function patternReadout(design, library) {
  if (!design.pattern) return null;
  const recipe = findDrawing(design, library);
  if (!recipe) return null;
  const h = design.layers.layerHeightMm;
  const layerCount = Math.max(1, Math.round(design.form.height / h));
  const l = patternLayout(design, recipe, {
    profile: createProfile(design.form.profile),
    unitPerimeter: createPlan(design.form.plan).unitPerimeter,
    layerCount,
    baseLayers: Math.min(design.base.layers, layerCount),
    maxNodes: MAX_NODES,
  });
  return {
    columns: l.columns, rows: l.rows, repeats: l.repeats, nodes: l.nodes, clamped: l.clamped,
    spacingMinMm: l.spacingMinMm, spacingMaxMm: l.spacingMaxMm, perimeterMinMm: l.perimeterMinMm,
    layers: Math.max(0, l.last - l.first + 1),
    // The nodes plus Soften's points between them, a layer and over all its layers.
    extra: l.extra, pointsPerLayer: l.pointsPerLayer, points: l.pointsPerLayer * Math.max(0, l.last - l.first + 1),
  };
}

/**
 * Everything the toolpath needs to add the Pattern, precomputed once.
 * @param {object} design normalised
 * @param {object} library
 * @param {{ profile: { at(z: number): number }, unitPerimeter: number, layerCount: number,
 *           baseLayers: number, maxNodes: number, facetAt?: (z: number, u: number) => number }} wall
 *   facetAt: the Facets morph's face at (z, u), for a slant per facet (D71)
 * @returns {null | {
 *   drawing: string, missing: boolean, active: boolean, recipe: object | null,
 *   columns: number, rows: number, repeats: number, nodes: number, clamped: boolean,
 *   first: number, last: number, depthMm: number, spacingMinMm: number, spacingMaxMm: number,
 *   extra: number, pointsPerLayer: number,
 *   inRange(layer: number): boolean, rowOf(layer: number): number, at(layer: number, u: number, below?: number): number,
 *   seamColumn(rampCells: number): number, seamShift(layer: number): number,
 * }} null when the design has no Pattern; seamShift is how many cells the seam column moves on a layer (D72)
 */
export function createLayerPattern(design, library, wall) {
  const p = design.pattern;
  if (!p) return null;
  const recipe = findDrawing(design, library);
  // The Pattern starts and stops sharply at its first and last layer.
  const { first, last, columns, rows, repeats, nodes: N, clamped, extra, pointsPerLayer, spacingMinMm, spacingMaxMm } = patternLayout(design, recipe, wall);
  const smooth = p.softenCells > 0;
  const active = !!recipe && p.depthMm > 0 && first <= last;

  const grid = recipe
    ? blurGrid(Float32Array.from(bitmapValues(recipe)), columns, rows, p.softenCells, p.softenCells, true)
    : new Float32Array(1);
  const span = Math.max(last - first, 1);
  const inRange = (i) => active && i >= first && i <= last;
  const rowOf = (i) => (inRange(i) ? (i - first) % rows : -1);

  // Slant (D70, D71): the cells layer i is moved by, evenly or on each face.
  const slant = p.slant ?? NO_SLANT;
  const perFacet = slantPerFacet(design) && typeof wall.facetAt === 'function';
  const seed = design.form.morph?.facets?.seed ?? 0;
  const faceSlant = (face) => (face < 0 ? slant.cells : slant.cells + (slant.toCells - slant.cells) * facetShare(face, seed));
  const evenShift = (i) => (inRange(i) ? Math.round(slant.cells * (i - first)) : 0);
  const slanted = perFacet ? slant.cells !== 0 || slant.toCells !== 0 : slant.cells !== 0;
  const h = design.layers.layerHeightMm;
  const mod = (a, b) => ((a % b) + b) % b;

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
    const k = i - first;
    const zMid = (i + 0.5) * h;
    const shift = evenShift(i);
    const v = entry.values;
    const faceOf = perFacet && slanted ? faceRow : null;
    for (let j = 0; j < N; j++) {
      const f = uniform ? strength : fadeAt(p.fade, t, j / N);
      let column = j % columns;
      if (faceOf) {
        faceOf[j] = wall.facetAt(zMid, j / N);
        column = mod(j - Math.round(faceSlant(faceOf[j]) * k), columns);
      } else if (slanted) {
        column = mod(j - shift, columns);
      }
      v[j] = p.depthMm * grid[offset + column] * f;
    }
    // Where two facets meet, their drawings, moved by different amounts, can
    // leave a lone cell standing out of or sunk into both neighbours: a spike
    // a cell wide that the drawing never had. It takes its neighbours' mean.
    if (faceOf) {
      for (let j = 0; j < N; j++) {
        const a = j === 0 ? N - 1 : j - 1;
        const b = j + 1 === N ? 0 : j + 1;
        if (faceOf[a] === faceOf[j] && faceOf[b] === faceOf[j]) continue;
        if ((v[j] - v[a]) * (v[j] - v[b]) > 1e-9) v[j] = 0.5 * (v[a] + v[b]);
      }
    }
    return v;
  }
  const faceRow = new Int32Array(N);

  // Layer i's own row at u: on a node its value; between nodes a straight
  // line when crisp, and with Soften a smooth curve through the nodes
  // (Catmull-Rom, wrapping round the pot).
  function own(i, u) {
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
    const a = v[j];
    const b = v[next];
    if (!smooth) return a + f * (b - a);
    const before = v[j === 0 ? N - 1 : j - 1];
    const after = v[next + 1 === N ? 0 : next + 1];
    return a + 0.5 * f * (b - before + f * (2 * before - 5 * a + 4 * b - after + f * (3 * (a - b) + after - before)));
  }

  /**
   * The Pattern's radial push in mm on wall layer i at outline position u.
   * `below` (0–1) is the share still on the row of the layer below: a layer
   * starts on that row and changes to its own over the seam ramp (D60). It
   * also carries the last row onto the layer above the range, and a plain
   * wall into the first.
   */
  function at(i, u, below = 0) {
    if (below <= 0) return own(i, u);
    if (below >= 1) return own(i - 1, u);
    return (1 - below) * own(i, u) + below * own(i - 1, u);
  }

  /**
   * The quietest column of the drawing for a hidden seam (D66): a layer
   * starts on the row below and changes to its own over `rampCells` cells
   * from the seam column c (D60, D67), so cell c + k shows a share
   * 1 − k / rampCells of the row below. The column whose rows change least
   * there, over every row against the one below it (the tile repeats
   * upwards), wins; then the deepest (a groove), then the lowest c.
   * @param {number} rampCells
   * @returns {number} a column, 0 … columns − 1
   */
  function seamColumn(rampCells) {
    if (!recipe) return 0;
    const n = Math.max(1, Math.min(Math.round(rampCells), columns));
    let best = 0;
    let bestScore = Infinity;
    let bestDepth = Infinity;
    for (let c = 0; c < columns; c++) {
      let score = 0;
      let depth = 0;
      for (let r = 0; r < rows; r++) {
        const row = r * columns;
        const below = (r === 0 ? rows - 1 : r - 1) * columns;
        for (let k = 0; k < n; k++) {
          const col = (c + k) % columns;
          score += (1 - k / n) * Math.abs(grid[row + col] - grid[below + col]);
        }
        depth += grid[row + c];
      }
      if (score < bestScore - 1e-6 || (score < bestScore + 1e-6 && depth < bestDepth - 1e-6)) {
        best = c;
        bestScore = score;
        bestDepth = depth;
      }
    }
    return best;
  }

  return {
    drawing: p.drawing, missing: !recipe, active, recipe,
    columns, rows, repeats, nodes: N, clamped, first, last, depthMm: p.depthMm,
    extra, pointsPerLayer, spacingMinMm, spacingMaxMm,
    inRange, rowOf, at, seamColumn,
    // The seam column follows an even slant; per facet it holds (D72).
    seamShift: (i) => (perFacet ? 0 : evenShift(i)),
  };
}

/**
 * The depth and density every drawing starts with, in mm for this design's
 * bead: two thirds of a bead deep (D61) and nodes 2 mm apart (D64).
 * @param {object} design normalised
 * @returns {{ depthMm: number, density: { by: 'spacing', spacingMm: number, points: number } }}
 */
export function drawingDefaults(design) {
  const w = design.layers.beadWidthMm;
  return {
    // A whole hundredth of a mm, never past the most.
    depthMm: Math.min(Math.round(DEPTH_BEADS.default * w * 100) / 100, Math.floor(DEPTH_BEADS.max * w * 100) / 100),
    density: { by: 'spacing', spacingMm: Math.round(defaultSpacingMm(w) * 100) / 100, points: DEFAULT_POINTS },
  };
}

/**
 * The Pattern settings a new Pattern starts with: the drawing's defaults
 * (drawingDefaults), crisp, no fade, over defaultPatternRange.
 * @param {object} design normalised
 * @param {string} drawing
 */
export function newPattern(design, drawing) {
  return {
    drawing,
    ...drawingDefaults(design),
    ...defaultPatternRange(design),
    fade: { shape: 'even', amount: 1 },
    softenCells: 0,
    slant: { ...NO_SLANT },
  };
}

