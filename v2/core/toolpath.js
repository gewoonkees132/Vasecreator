// The toolpath: layer grid, seam and ramp, wall evaluation, base spiral and
// walls (research §5.1, §5.4 stages 2–6 and 5b; design §9.3, §9.4, §10).
//
// The path is one continuous line of beads. Layer i has its top at
// z_i = (i + 1)·h. A wall layer starts at its seam on the layer below's height
// and climbs one layer height over the seam ramp, then runs flat back to the
// seam, where the next layer starts. Every bead therefore sits one layer
// height above the bead below it, with no travel between layers (D10). The
// exceptions are bounded: base layers are flat (rings included) and climb
// with a short step at the seam; the first RAMP_IN_LAYERS wall layers grow
// the ramp (gap ≥ 0.75 h); a seam that moves along the wall by up to a bead
// width changes the gap over the ramp by at most that width / ramp length.
//
// The wall point is P = B(z, u) + D(z, u)·d̂: B the footprint outline scaled
// by the profile radius and turned by the twist, d̂ its radial direction in
// XY, and D the displacement in mm: the Detailed morph (form.detail, D35)
// plus the Pattern (design.pattern, core/layer-pattern.js). Detailed morph
// coordinates are x = repeats·u and y = z / tile height, with u riding on the
// outline, so whole repeats meet without a seam and the relief follows the
// twist.
//
// The Pattern is per layer and per node (D37, D39): inside its range every
// layer has the same N nodes at u = j / N, plus the same k points in every
// gap, so a layer has N·(k + 1) points and every (k + 1)-th is a node. The
// seam sits on a node there, so the ramp never cuts a cell in half. It is
// exempt from the overhang and the two-layers-per-bump rules and has its own
// bead-support rule (D43).
//
// Phase 2: the geometry morph M(z, u) (core/morph.js) is added to the profile
// radius before the footprint, D and the minimum-radius clamp, so the walls,
// the base, the checks and the size all see the morphed form. Slots may also
// name a recipe from design.assets ('user:…') or an image ('img:…', sampled
// from the Raster passed in `images`, prefiltered for the bead grid).

import { TAU, dcos, dsin, radians } from './math.js';
import { PLAIN, evaluatePattern, findPattern } from './patterns.js';
import { blendShape, detailGate, detailWeights } from './surface.js';
import { createLayerPattern } from './layer-pattern.js';
import { createProfile } from './profile.js';
import { snapTileHeight } from './design.js';
import { createPlan } from './plan.js';
import { ISSUE } from './checks.js';
import { preparedRaster } from './raster.js';
import { createMorph } from './morph.js';

/** What the move ending at a point is (ARCHITECTURE.md, PreviewResult.kinds). */
export const KIND = Object.freeze({ none: 0, outer: 1, inner: 2, base: 3, connector: 4 });

export const MIN_POINTS_PER_LAYER = 64;
export const MAX_POINTS_PER_LAYER = 1600;
/**
 * Points one toolpath may have, so a huge pot at fine settings (1 m tall at
 * 0.2 mm layers, or a 1 m base at a 0.5 mm bead, which would be hundreds of
 * millions of points) can't hang the worker or run it out of memory. Three
 * quarters go to the walls and a quarter to the base. Over budget, points
 * are spaced further apart and the toolpath says `simplified`. The preview
 * gets less: it is drawn as well.
 */
export const MAX_TOOLPATH_POINTS = 4_000_000;
export const MAX_PREVIEW_POINTS = 2_000_000;
/** Wall layers over which the seam ramp grows to a full layer height above a flat layer. */
export const RAMP_IN_LAYERS = 4;

// Features per tile of each named shape, around and up: how many bumps one
// repeat puts in a row and in a column. Drives the points per layer (8 per
// feature) and the vertical fineness check.
const SHAPE_FEATURES = {
  flutes: [1, 0], pleats: [1, 0], ribs: [0, 1], ripple: [1, 1], spiral: [1, 1], chevron: [1, 1],
  diamonds: [1, 1], scales: [1, 2], dots: [1, 2], honeycomb: [1, 2], basket: [4, 4],
};

/**
 * Bumps per tile of a pattern recipe.
 * @param {object} recipe
 * @returns {{ around: number, up: number }}
 */
export function patternFeatures(recipe) {
  if (recipe.kind === 'shape') {
    const [around, up] = SHAPE_FEATURES[recipe.shape] ?? [1, 1];
    return { around, up };
  }
  if (recipe.kind === 'bitmap') {
    // A grid whose rows are all the same has no bumps up; one whose columns
    // are all the same has none around.
    const { columns, rows, cells } = recipe;
    let around = 0;
    let up = 0;
    for (let r = 0; r < rows && !around; r++) {
      for (let c = 1; c < columns; c++) if (cells[r * columns + c] !== cells[r * columns]) { around = columns; break; }
    }
    for (let i = columns; i < cells.length; i++) if (cells[i] !== cells[i % columns]) { up = rows; break; }
    return { around, up };
  }
  return { around: 0, up: 0 };
}

/**
 * Resolves the Detailed morph's slots: library ids against the pattern library,
 * 'user:…' against the recipes in design.assets, 'img:…' against the rasters
 * in `images` (by the asset's hash). A pattern that can't be found prints
 * plain and is reported (missing, or missingImages for an image this device
 * doesn't have), so an old design still opens.
 * @param {object} design
 * @param {{ patterns: object[] }} library
 * @param {{ images?: Map<string, object>, perimeterMm?: number }} [options] perimeterMm at the widest
 *   radius, for an image's prefilter
 */
export function resolveSlots(design, library, { images, perimeterMm = 0 } = {}) {
  const slots = [];
  const missing = [];
  const missingImages = [];
  const assets = design.assets ?? {};
  const h = design.layers.layerHeightMm;
  const w = design.layers.beadWidthMm;
  for (const key of ['a', 'b']) {
    const slot = design.form.detail[key];
    if (!slot) continue;
    let recipe = PLAIN.recipe;
    let evaluate = null;
    let features = null;
    // Snapped here too, so a design edited without normalising still lines up.
    const tileHeightMm = snapTileHeight(slot.tileHeightMm, h);
    const id = slot.pattern;
    if (typeof id === 'string' && id.startsWith('img:')) {
      const asset = assets[id];
      const hash = asset?.kind === 'image' ? asset.hash : id.slice(4);
      const raster = images?.get?.(hash);
      if (raster) {
        // Prefilter for the bead grid (research §6.3): σ of half a sample,
        // the bead spacing w/2 around and the layer height up, in texels.
        const tileWidthMm = Math.max(perimeterMm / slot.repeats, 1e-6);
        const spacingU = ((w / 2) * raster.width) / tileWidthMm;
        const spacingV = (h * raster.height) / tileHeightMm;
        const image = preparedRaster(raster, spacingU > 1 ? spacingU / 2 : 0, spacingV > 1 ? spacingV / 2 : 0, true);
        recipe = { kind: 'image', hash };
        evaluate = image.sample;
        features = image.features;
      } else {
        missingImages.push(id);
      }
    } else if (typeof id === 'string' && id.startsWith('user:')) {
      const asset = assets[id];
      if (asset?.kind === 'recipe') recipe = asset.recipe;
      else missing.push(id);
    } else {
      try {
        recipe = findPattern(library ?? { patterns: [] }, id).recipe;
      } catch {
        missing.push(id);
      }
    }
    const r = recipe;
    slots.push({
      key,
      recipe,
      depthMm: slot.depthMm,
      repeats: slot.repeats,
      tileHeightMm,
      features: features ?? patternFeatures(recipe),
      active: slot.depthMm > 0 && recipe.kind !== 'plain',
      evaluate: evaluate ?? ((x, y) => evaluatePattern(r, x, y)),
    });
  }
  return { slots, missing, missingImages };
}

// Widest radius of the profile curve over the layer tops (and the ends).
function widestProfileRadius(profile, H, h) {
  let widest = Math.max(profile.at(0), profile.at(H));
  for (let z = h; z < H; z += h) widest = Math.max(widest, profile.at(z));
  return widest;
}

/**
 * Everything needed to evaluate wall points for one design, precomputed once.
 * @param {object} design a normalised design
 * @param {{ patterns: object[] }} library
 * @param {{ images?: Map<string, object> }} [options]
 */
export function createWallModel(design, library, { images } = {}) {
  const { form, layers, base } = design;
  const detail = form.detail;
  const h = layers.layerHeightMm;
  const w = layers.beadWidthMm;
  const H = form.height;
  const layerCount = Math.max(1, Math.round(H / h));
  const baseLayers = Math.min(base.layers, layerCount);
  const baseTop = baseLayers * h;
  const profile = createProfile(form.profile);
  const plan = createPlan(form.plan);
  const twistPerMm = radians(form.twist.degrees) / H;
  const rMin = 2 * w;
  const needsWidest = form.morph || ['a', 'b'].some((k) => String(detail[k]?.pattern ?? '').startsWith('img:'));
  const widestMm = needsWidest ? widestProfileRadius(profile, H, h) * plan.unitPerimeter : 0;
  const morph = createMorph(design, { images, perimeterMm: widestMm });
  const { slots, missing, missingImages } = resolveSlots(design, library, { images, perimeterMm: widestMm });
  if (morph?.missingImage) missingImages.push(design.form.morph.map);
  const pattern = createLayerPattern(design, library, {
    profile, unitPerimeter: plan.unitPerimeter, layerCount, baseLayers, maxNodes: MAX_POINTS_PER_LAYER,
  });
  if (pattern?.missing) missing.push(pattern.drawing);
  const lp = pattern?.active ? pattern : null;
  const morphOn = !!morph && morph.amplitude > 0;
  const morphAmp = morphOn ? morph.amplitude : 0;
  /** The morph's radial push in mm at height z, position u (0 without a morph). */
  const morphAt = morphOn ? morph.at : () => 0;
  // Least and most push around at height z, for the base spiral and the skirt.
  function morphRange(z) {
    if (!morphOn) return { lo: 0, hi: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 256; k++) {
      const v = morphAt(z, k / 256);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { lo, hi };
  }
  const active = slots.filter((s) => s.active);
  const limit = radians(design.rules.overhangLimitDeg);
  const stepLimit = (h * dsin(limit)) / dcos(limit);
  const supportLimit = design.rules.supportRatio * w;

  // A Diagonal blend (D54) gives B a share that also depends on u, so the
  // weights cached per height are the most each slot can reach there (A the
  // soft edges alone, B those times the amount) and detailAt splits them per point.
  const diagonal = !!detail.b && detail.blend.shape === 'diagonal';
  const span = Math.max(detail.toMm - detail.fromMm, 1e-9);

  // Two-entry weight cache: wall points alternate between their own height
  // and the height one layer below (for the overhang check).
  let zA = NaN, aA = 0, bA = 0, zB = NaN, aB = 0, bB = 0, flip = false;
  const weight = { a: 0, b: 0 };
  function weightsAt(z) {
    if (z === zA) { weight.a = aA; weight.b = bA; return weight; }
    if (z === zB) { weight.a = aB; weight.b = bB; return weight; }
    let a;
    let b;
    if (diagonal) {
      a = detailGate(detail, z, h);
      b = a * detail.blend.amount;
    } else {
      ({ a, b } = detailWeights(detail, z, h));
    }
    if (flip) { zA = z; aA = a; bA = b; } else { zB = z; aB = a; bB = b; }
    flip = !flip;
    weight.a = a;
    weight.b = b;
    return weight;
  }

  /** The Detailed morph's displacement in mm at height z, position u. Never on the base. */
  function detailAt(z, u) {
    if (z <= baseTop || active.length === 0) return 0;
    const wt = weightsAt(z);
    let wa = wt.a;
    let wb = wt.b;
    if (diagonal && wa > 0) {
      const share = detail.blend.amount * blendShape('diagonal', (z - detail.fromMm) / span, u);
      wb = wa * share;
      wa *= 1 - share;
    }
    let d = 0;
    for (let k = 0; k < active.length; k++) {
      const s = active[k];
      const ws = s.key === 'a' ? wa : wb;
      if (ws > 0) d += ws * s.depthMm * s.evaluate(s.repeats * u, z / s.tileHeightMm);
    }
    return d;
  }

  /** The wall layer a height lies on: layer i runs from i·h up to its top at (i + 1)·h. */
  const layerAt = (z) => Math.max(0, Math.ceil(z / h - 1e-6) - 1);
  /** The Pattern's displacement in mm on wall layer i at u (0 outside its range). */
  const patternAt = lp ? lp.at : () => 0;

  /**
   * All the displacement D in mm at height z, position u: the Detailed
   * morph plus the Pattern of `layer` (by default the layer z lies on; the
   * toolpath passes it, as the first point of a ramp sits on the layer below's top).
   */
  function displacement(z, u, layer = layerAt(z)) {
    return detailAt(z, u) + (lp ? lp.at(layer, u) : 0);
  }

  let tz = NaN, tc = 1, ts = 0;
  const twist = { c: 1, s: 0 };
  /** cos and sin of the twist angle at height z. */
  function twistAt(z) {
    if (z !== tz) {
      tz = z;
      const a = twistPerMm * z;
      tc = dcos(a);
      ts = dsin(a);
    }
    twist.c = tc;
    twist.s = ts;
    return twist;
  }

  const unitXY = new Float64Array(2);
  const centre = { x: 0, y: 0, D: 0, P: 0, radius: 0, bare: 0, unitLength: 1, narrow: false };
  /**
   * The outer wall's centreline at outline position u and height z (on wall
   * layer `layer`, by default the one z lies on): the toolpath's wall point
   * and the CAD solid's skeleton (core/cad.js). The returned object is
   * reused; copy what you need before the next call. D is the displacement
   * (the Detailed morph plus P, the Pattern), radius the distance along the
   * unit outline (|unit| = unitLength), bare that radius without the Pattern
   * (for the overhang check, D43), narrow whether the minimum radius clamped it.
   */
  function centrePoint(u, z, layer = layerAt(z)) {
    plan.unitPoint(u, unitXY);
    const unitLength = Math.sqrt(unitXY[0] * unitXY[0] + unitXY[1] * unitXY[1]);
    const P = lp ? lp.at(layer, u) : 0;
    const D = detailAt(z, u) + P;
    let narrow = false;
    let base = profile.at(z);
    if (morphOn) {
      base += morphAt(z, u);
      if (base < rMin) { base = rMin; narrow = true; }
    }
    let radius = base * unitLength + D;
    // A hair of slack: a circle of exactly r_min must not flag itself.
    if (radius < rMin - 1e-9) { radius = rMin; narrow = true; }
    let bare = radius;
    if (P !== 0) {
      bare = base * unitLength + D - P;
      if (bare < rMin - 1e-9) bare = rMin;
    }
    const t = twistAt(z);
    const s = radius / unitLength;
    centre.x = (unitXY[0] * t.c - unitXY[1] * t.s) * s;
    centre.y = (unitXY[0] * t.s + unitXY[1] * t.c) * s;
    centre.D = D;
    centre.P = P;
    centre.radius = radius;
    centre.bare = bare;
    centre.unitLength = unitLength;
    centre.narrow = narrow;
    return centre;
  }

  const model = {
    design, h, w, H, layerCount, baseLayers, baseTop, profile, plan, twistPerMm, rMin,
    slots, active, missing, missingImages, stepLimit, supportLimit,
    detailAt, patternAt, displacement, layerAt, weightsAt, twistAt, centrePoint,
    morph: morphOn ? morph : null, morphAmp, morphAt, morphRange,
    /** The Pattern (core/layer-pattern.js) when it prints, else null. */
    pattern: lp,
    /** Points per layer in the Pattern's range: N·(k + 1), the same on every layer there. */
    patternPoints: 0,
  };
  if (lp) {
    // k extra points in each gap, enough for the outline, the Morph and the
    // Detailed morph on the layer that needs the most (§3.1, §3.2).
    const N = lp.nodes;
    let need = 0;
    for (let i = lp.first; i <= lp.last; i++) need = Math.max(need, pointsNeeded(model, i * h, (i + 1) * h));
    const k = Math.max(0, Math.min(Math.ceil(need / N) - 1, Math.floor(MAX_POINTS_PER_LAYER / N) - 1));
    model.patternPoints = N * (k + 1);
  }
  return model;
}

// Growable point buffer: Float64 positions (the canonical toolpath) plus
// per-point kind, issue bits and layer index, and with a Pattern a flag for
// the points that are its nodes.
class PathBuffer {
  constructor(capacity, withNodes = false) {
    this.n = 0;
    this.withNodes = withNodes;
    this.alloc(Math.max(capacity, 1024));
  }

  alloc(capacity) {
    const xyz = new Float64Array(capacity * 3);
    const kinds = new Uint8Array(capacity);
    const issues = new Uint8Array(capacity);
    const layer = new Uint16Array(capacity);
    const node = this.withNodes ? new Uint8Array(capacity) : null;
    if (this.xyz) {
      xyz.set(this.xyz.subarray(0, this.n * 3));
      kinds.set(this.kinds.subarray(0, this.n));
      issues.set(this.issues.subarray(0, this.n));
      layer.set(this.layer.subarray(0, this.n));
      if (node) node.set(this.node.subarray(0, this.n));
    }
    Object.assign(this, { xyz, kinds, issues, layer, node, capacity });
  }

  push(x, y, z, kind, issue, layer, node = 0) {
    if (this.n === this.capacity) this.alloc(this.capacity * 2);
    const i = this.n++;
    this.xyz[3 * i] = x;
    this.xyz[3 * i + 1] = y;
    this.xyz[3 * i + 2] = z;
    this.kinds[i] = kind;
    this.issues[i] = issue;
    this.layer[i] = layer;
    if (this.node) this.node[i] = node;
  }

  // True when (x, y, z) is where the path already is: no zero-length beads.
  at(x, y, z) {
    if (this.n === 0) return false;
    const i = 3 * (this.n - 1);
    return Math.abs(this.xyz[i] - x) < 1e-9 && Math.abs(this.xyz[i + 1] - y) < 1e-9 && Math.abs(this.xyz[i + 2] - z) < 1e-9;
  }

  lastKind() {
    return this.n === 0 ? -1 : this.kinds[this.n - 1];
  }
}

/**
 * Seam position u for every layer (design §9.3).
 *   fixed: the outline point at a world angle; it does not turn with the twist.
 *   followTwist: the angle in outline coordinates, turning with the twist.
 *   hidden: the rectangle corner nearest the angle, or else the deepest pattern
 *   groove near the seam of the layer below. Tracking the groove from layer to
 *   layer (rather than re-searching around the angle every time) keeps the
 *   seam from jumping across the wall where a groove drifts, as on a spiral;
 *   the seam moves at most one bead width per layer for the same reason.
 *   Where the wall is plain the seam holds its place.
 */
function seamPositions(m) {
  const { design, plan, h, w, layerCount, pattern: lp } = m;
  const { position, angleDeg } = design.layers.seam;
  const angle = radians(angleDeg);
  const seams = new Float64Array(layerCount);
  const follow = plan.uAtAngle(angle);
  let corner = follow;
  if (plan.footprint === 'rectangle') {
    let best = Infinity;
    for (const u of plan.cornerUs) {
      let d = Math.abs(plan.angleAt(u) - angle);
      d = Math.min(d, TAU - d);
      if (d < best) { best = d; corner = u; }
    }
  }
  let previous = follow;
  for (let i = 0; i < layerCount; i++) {
    const zStart = i === 0 ? h : i * h;
    let u = follow;
    // A fixed seam on a pot that twists counter-clockwise (the print direction)
    // moves back along the wall, so each layer starts where the one below
    // ended (buildToolpath, "Seam moved back"); taking the angle at the layer
    // top puts those starts on the chosen angle.
    const zSeam = m.twistPerMm > 0 ? (i + 1) * h : zStart;
    if (position === 'fixed') u = plan.uAtAngle(angle - m.twistPerMm * zSeam);
    else if (position === 'hidden') u = plan.footprint === 'rectangle' ? corner : groove(m, i, previous, w);
    if (lp?.inRange(i)) {
      // On a node, so the ramp never cuts a cell in half. A hidden seam
      // still moves at most a bead width a layer, in whole nodes.
      const N = lp.nodes;
      u = Math.round(u * N) / N;
      if (position === 'hidden' && lp.inRange(i - 1)) {
        const most = Math.floor((w / (m.profile.at((i + 1) * h) * plan.unitPerimeter)) * N + 1e-9);
        const steps = Math.round((u - previous) * N);
        u = previous + Math.max(-most, Math.min(most, steps)) / N;
      }
    }
    seams[i] = u;
    previous = u;
  }
  return seams;
}

// The deepest groove of layer i near u = centre, over the widest tile in
// play there (the Detailed morph's or the Pattern's).
function groove(m, i, centre, w) {
  const z = (i + 1) * m.h;
  const wt = m.weightsAt(z);
  let repeats = 0;
  for (const s of m.active) {
    if ((s.key === 'a' ? wt.a : wt.b) > 0 && (repeats === 0 || s.repeats < repeats)) repeats = s.repeats;
  }
  if (m.pattern?.inRange(i) && (repeats === 0 || m.pattern.repeats < repeats)) repeats = m.pattern.repeats;
  if (repeats === 0) return centre;
  const half = 0.5 / repeats;
  const samples = 64;
  let lo = Infinity;
  let hi = -Infinity;
  let best = centre;
  for (let k = 0; k <= samples; k++) {
    const u = centre - half + (2 * half * k) / samples;
    const d = m.displacement(z, u, i);
    if (d < lo || (d === lo && Math.abs(u - centre) < Math.abs(best - centre))) { lo = d; best = u; }
    if (d > hi) hi = d;
  }
  if (hi - lo < 1e-3) return centre;
  const maxStep = w / (m.profile.at(z) * m.plan.unitPerimeter);
  return centre + Math.min(Math.max(best - centre, -maxStep), maxStep);
}

// Points the outline, the Morph and the Detailed morph need on the layer
// from zStart to zTop (lead decision 5): a bead spacing of w/2 and at least
// 8 points per feature, before any clamp.
function pointsNeeded(m, zStart, zTop) {
  const perimeter = (m.profile.at(zTop) + m.morphAmp) * m.plan.unitPerimeter;
  let need = Math.max(Math.ceil(perimeter / (m.w / 2)), MIN_POINTS_PER_LAYER);
  if (m.morph) need = Math.max(need, 8 * m.morph.repeats * m.morph.featuresAround);
  const lo = m.weightsAt(zStart);
  const loA = lo.a;
  const loB = lo.b;
  const hi = m.weightsAt(zTop);
  for (const s of m.active) {
    const on = s.key === 'a' ? loA > 0 || hi.a > 0 : loB > 0 || hi.b > 0;
    if (on) need = Math.max(need, 8 * s.repeats * s.features.around);
  }
  return need;
}

/**
 * Points around for the layer from zStart to zTop: pointsNeeded, then the
 * 64–1600 clamp, or the lower `cap` the point budget allows. In the
 * Pattern's range it is the same N·(k + 1) on every layer
 * (m.patternPoints), with fewer extra points k under a lower cap.
 * @returns {{ n: number, capped: boolean, simplified: boolean }}
 */
export function pointsAround(m, zStart, zTop, cap = MAX_POINTS_PER_LAYER) {
  const need = pointsNeeded(m, zStart, zTop);
  const capped = need > MAX_POINTS_PER_LAYER;
  if (m.pattern?.inRange(Math.round(zTop / m.h) - 1)) {
    const N = m.pattern.nodes;
    let n = m.patternPoints;
    if (n > cap) n = N <= cap ? N * Math.floor(cap / N) : cap;
    return { n, capped, simplified: n < m.patternPoints };
  }
  const n = Math.min(need, MAX_POINTS_PER_LAYER);
  return { n: Math.min(n, cap), capped, simplified: n > cap };
}

/**
 * Builds the full toolpath for a design.
 * @param {object} design a normalised design
 * @param {{ patterns: object[] }} library
 * @param {{ walls?: 1 | 2, maxPoints?: number, images?: Map<string, object> }} [options] walls defaults
 *   to 1 (the design view's centreline wall); maxPoints is the point budget (MAX_TOOLPATH_POINTS);
 *   images are the Rasters by hash for 'img:' patterns and morph maps
 */
export function buildToolpath(design, library, { walls = 1, maxPoints = MAX_TOOLPATH_POINTS, images } = {}) {
  const m = createWallModel(design, library, { images });
  const { h, w, layerCount: L, baseLayers: nb, profile, plan, rMin, stepLimit, supportLimit, pattern: lp } = m;
  const spacing = design.finish.wallSpacingMm;
  const innerWall = design.finish.innerWall;
  const rampMm = design.layers.seam.rampLengthMm;
  const seams = seamPositions(m);

  // The point budget (MAX_TOOLPATH_POINTS): a cap on points per wall layer,
  // and a spacing along the base spiral, both untouched for any usual pot.
  const layerCap = Math.min(MAX_POINTS_PER_LAYER,
    Math.max(MIN_POINTS_PER_LAYER, Math.floor((0.75 * maxPoints) / (Math.max(L - nb, 1) * walls))));
  let basePoints = 0;
  for (let k = 0; k < nb; k++) {
    const r = profile.at((k + 1) * h);
    basePoints += (4 * r * r * plan.ratio) / (design.base.spacingRatio * w * (w / 2));
  }
  const baseStep = (w / 2) * Math.max(1, basePoints / (0.25 * maxPoints));
  let simplified = baseStep > w / 2;

  const around = Math.min(Math.max((profile.at(design.form.height / 2) * plan.unitPerimeter) / (w / 2), MIN_POINTS_PER_LAYER), layerCap);
  const estimate = Math.ceil((L - nb) * walls * 1.1 * around + Math.min(basePoints, 0.25 * maxPoints) + nb * 2 * layerCap);
  const buf = new PathBuffer(estimate, !!lp);
  // Whether outline position u is a node of the Pattern on layer i.
  const isNode = (i, u) => {
    if (!lp || !lp.inRange(i)) return 0;
    const x = u * lp.nodes;
    return Math.abs(x - Math.round(x)) < 1e-6 ? 1 : 0;
  };
  const layerStarts = new Uint32Array(L + 1);
  const layerZ = new Float64Array(L);
  const cappedLayers = new Uint8Array(L);
  const seamLine = new Float32Array(3 * (L - nb));
  const unit = new Float64Array(2);
  const xy = new Float64Array(2);
  let maxGapMm = 0;
  let minD = 0;
  let maxD = 0;

  // One outer wall point of layer i at outline position u and height z, into
  // wx, wy, wIssue. The overhang check compares the walls without the
  // Pattern; bead support (D43) compares them with it, on the Pattern's
  // layers and the layer on top of them.
  let wx = 0, wy = 0, wIssue = 0, wNode = 0;
  const morphed = !!m.morph;
  function wallPoint(u, z, checkOverhang, i) {
    const c = m.centrePoint(u, z, i);
    const { D, radius, bare, unitLength } = c;
    if (D < minD) minD = D;
    if (D > maxD) maxD = D;
    let issue = c.narrow ? ISSUE.narrow : 0;
    if (checkOverhang) {
      const zb = z - h;
      let baseBelow = profile.at(zb);
      if (morphed) baseBelow = Math.max(baseBelow + m.morphAt(zb, u), rMin);
      const bareBelow = baseBelow * unitLength + m.detailAt(zb, u);
      let below = bareBelow;
      if (below < rMin - 1e-9) below = rMin;
      if (Math.abs(bare - below) > stepLimit) issue |= ISSUE.overhang;
      if (lp && (lp.inRange(i) || lp.inRange(i - 1))) {
        below = bareBelow + lp.at(i - 1, u);
        if (below < rMin - 1e-9) below = rMin;
        if (Math.abs(radius - below) > supportLimit + 1e-9) issue |= ISSUE.support;
      }
    }
    wx = c.x;
    wy = c.y;
    wIssue = issue;
    wNode = isNode(i, u);
  }

  // Outline positions on the grid of n points per turn from u0 to u1, into
  // `grid`: u0, every grid point after it, then u1. In the Pattern's range
  // the grid holds the nodes, so they print exactly where they are drawn,
  // also when the layer starts off the grid (where the seam moved back).
  const grid = new Float64Array(MAX_POINTS_PER_LAYER + 3);
  function gridPoints(u0, u1, n) {
    let c = 0;
    grid[c++] = u0;
    for (let g = Math.floor(u0 * n + 1e-7) + 1; g < u1 * n - 1e-7; g++) grid[c++] = g / n;
    grid[c++] = u1;
    return c - 1;
  }

  // The outer wall (or a base ring) of layer i from u0 round to u1, n points
  // per full turn. It starts `rise` below the layer top and climbs that much
  // over the seam ramp (rise 0: flat at the top). The first point is not
  // repeated when the path is already there; otherwise the move to it is
  // `firstKind`.
  function outerLoop(i, u0, u1, n, rise, kind, firstKind, checkOverhang) {
    const zTop = (i + 1) * h;
    const zLow = zTop - rise;
    const perimeter = profile.at(zTop) * plan.unitPerimeter;
    const rampLength = Math.min(rampMm, perimeter / 2);
    const span = u1 - u0;
    const onGrid = !!lp && lp.inRange(i) && n <= MAX_POINTS_PER_LAYER;
    const count = onGrid ? gridPoints(u0, u1, n) : Math.max(1, Math.round(n * span));
    for (let j = 0; j <= count; j++) {
      const u = onGrid ? grid[j] : j === count ? u1 : u0 + (span * j) / count;
      let z = zTop;
      if (rise > 0) {
        if (j === 0) z = zLow;
        else if (rampLength > 0) z = zLow + rise * Math.min((onGrid ? u - u0 : (span * j) / count) * perimeter / rampLength, 1);
      }
      wallPoint(u, z, checkOverhang, i);
      if (j === 0) {
        if (buf.at(wx, wy, z)) continue;
        buf.push(wx, wy, z, buf.n === 0 ? KIND.none : firstKind, wIssue, i, wNode);
      } else {
        buf.push(wx, wy, z, kind, wIssue, i, wNode);
      }
    }
  }

  // Gets the path onto the outer wall at u, height z, before a loop: a bead
  // of `kind` when the path is elsewhere (a seam that moved on, or a
  // connector out from the inner wall), nothing when it is already there.
  function stepOnto(i, u, z, kind, checkOverhang) {
    wallPoint(u, z, checkOverhang, i);
    if (buf.n > 0 && !buf.at(wx, wy, z)) buf.push(wx, wy, z, kind, wIssue, i, wNode);
  }

  // The seam marker of wall layer i: where the layer starts.
  function markSeam(i, u, z) {
    wallPoint(u, z, false, i);
    const k = 3 * (i - nb);
    seamLine[k] = wx;
    seamLine[k + 1] = wy;
    seamLine[k + 2] = z;
  }

  // The inner wall: flat at the layer top, `spacing` inside the outer wall.
  // Smooth: behind the deepest groove of this layer, so the walls never
  // cross. Follow pattern: the outer wall moved in along the radius (D27).
  function innerLoop(i, uS, n, layerMinD, firstKind) {
    const zTop = (i + 1) * h;
    const floor = Math.max(rMin - spacing, w / 2);
    for (let j = 0; j <= n; j++) {
      const u = uS + j / n;
      plan.unitPoint(u, unit);
      const unitLength = Math.sqrt(unit[0] * unit[0] + unit[1] * unit[1]);
      const D = innerWall === 'smooth' ? layerMinD : m.displacement(zTop, u, i);
      let base = profile.at(zTop);
      if (morphed) base = Math.max(base + m.morphAt(zTop, u), rMin);
      let radius = base * unitLength + D - spacing;
      let issue = 0;
      if (radius < floor) { radius = floor; issue |= ISSUE.narrow; }
      const t = m.twistAt(zTop);
      const s = radius / unitLength;
      const node = innerWall === 'smooth' ? 0 : isNode(i, u);
      buf.push((unit[0] * t.c - unit[1] * t.s) * s, (unit[0] * t.s + unit[1] * t.c) * s, zTop, j === 0 ? firstKind : KIND.inner, issue, i, node);
    }
  }

  // Base spiral parameters for base layer k: offset δ(p) = inset + spacing·(1 + p)
  // grows by one spacing per turn p, and every turn starts at the seam u. The
  // spiral runs `endTurns` turns, by default as far in as the layer allows.
  function spiralTurns(k, inset, endTurns) {
    const zTop = (k + 1) * h;
    const r = profile.at(zTop);
    const a = r;
    const b = r * plan.ratio;
    const step = design.base.spacingRatio * w;
    const hole = design.base.hole.diameter;
    const stop = hole > 0 ? hole / 2 + w / 2 : step / 2;
    // A morph that pulls in narrows the base: the spiral stops short of the
    // narrowest part and follows the morphed outline (spiralPoint).
    const pull = morphed ? Math.min(Math.max(r + m.morphRange(zTop).lo, rMin) - r, 0) : 0;
    const own = (Math.min(a + pull, b + pull * plan.ratio) - stop - inset) / step - 1;
    const end = endTurns >= 0 ? endTurns : own;
    const ps = [];
    if (own < 0) return { ps, a, b, step, zTop, end: own };
    let p = 0;
    ps.push(0);
    for (;;) {
      const perimeter = plan.perimeter(a, b, inset + step * (1 + p));
      p += baseStep / Math.max(perimeter, w);
      if (p >= end - 1e-9) { if (end > 0) ps.push(end); break; }
      ps.push(p);
    }
    return { ps, a, b, step, zTop, end };
  }

  function spiralPoint(spiral, inset, uS, p, kind, layer) {
    if (morphed) {
      const u = uS + p;
      const r = Math.max(spiral.a + m.morphAt(spiral.zTop, u - Math.floor(u)), rMin);
      plan.point(u, r, r * plan.ratio, inset + spiral.step * (1 + p), xy);
    } else {
      plan.point(uS + p, spiral.a, spiral.b, inset + spiral.step * (1 + p), xy);
    }
    const t = m.twistAt(spiral.zTop);
    buf.push(xy[0] * t.c - xy[1] * t.s, xy[0] * t.s + xy[1] * t.c, spiral.zTop, kind, 0, layer);
  }

  // Base layers (design §9.4, research §5.4 stage 6): the ring(s) plus a
  // spiral inside, alternating direction so the last base layer ends at the
  // seam on the outer ring and the wall starts in place.
  //   outward: centre → spiral out → step to the ring → ring loop to the seam
  //   inward:  step up at the seam → ring loop → step in → spiral in to the centre
  // Every base layer is flat at its top, rings included, so each ring sits
  // exactly one layer height on the ring below; the climb from one to the
  // next is a short step up with no bead (at the seam, or at the centre).
  // An outward spiral turns as far as the inward one below it, so the step up
  // at the centre stays short on a narrow ellipse as well.
  const inset = walls === 2 ? spacing : 0;
  for (let k = 0; k < nb; k++) {
    layerStarts[k] = buf.n;
    layerZ[k] = (k + 1) * h;
    const uS = seams[k];
    const { n } = pointsAround(m, k * h, (k + 1) * h, layerCap);
    const outward = (nb - 1 - k) % 2 === 0;
    const below = outward && k > 0 ? spiralTurns(k - 1, inset).end : -1;
    const spiral = spiralTurns(k, inset, below);
    if (outward) {
      for (let q = spiral.ps.length - 1; q >= 0; q--) {
        spiralPoint(spiral, inset, uS, spiral.ps[q], q === spiral.ps.length - 1 ? KIND.none : KIND.base, k);
      }
      if (walls === 2) {
        innerLoop(k, uS, n, 0, spiral.ps.length ? KIND.base : KIND.none);
        outerLoop(k, uS, uS + 1, n, 0, KIND.outer, KIND.connector, false);
      } else {
        outerLoop(k, uS, uS + 1, n, 0, KIND.outer, spiral.ps.length ? KIND.base : KIND.none, false);
      }
    } else {
      outerLoop(k, uS, uS + 1, n, 0, KIND.outer, KIND.none, false);
      if (walls === 2) innerLoop(k, uS, n, 0, KIND.connector);
      for (let q = 0; q < spiral.ps.length; q++) spiralPoint(spiral, inset, uS, spiral.ps[q], KIND.base, k);
    }
  }

  // Wall layers: outer loop (ramped), then for two walls a connector in at the
  // seam, the inner loop flat at the layer top and a connector back out to the
  // next layer's start.
  //   Ramp in: the layer above a flat one (the last base ring, or a sleeve's
  //   first layer) can't climb a whole layer height over the ramp, or it would
  //   start on the bead below with no gap. The climb grows over RAMP_IN_LAYERS
  //   layers instead, with the rest as a step up at the seam, so the gap to
  //   the bead below never drops under (1 − 1/RAMP_IN_LAYERS) of a layer.
  //   Seam moved back: starting the layer behind where the one below ended
  //   would run over that layer's last beads at their own height. The layer
  //   starts where the one below ended and stops at its own seam, a little
  //   short of a full turn; the next layer covers the rest.
  const firstRamped = Math.max(nb, 1);
  for (let i = nb; i < L; i++) {
    layerStarts[i] = buf.n;
    layerZ[i] = (i + 1) * h;
    const uS = seams[i];
    const { n, capped, simplified: thinned } = pointsAround(m, i * h, (i + 1) * h, layerCap);
    if (thinned) simplified = true;
    const start = buf.n;
    minD = Infinity;
    maxD = -Infinity;
    if (i === 0) {
      markSeam(0, uS, h);
      outerLoop(0, uS, uS + 1, n, 0, KIND.outer, KIND.none, false);
    } else {
      const rise = i < firstRamped ? 0 : h * Math.min((i - firstRamped + 1) / RAMP_IN_LAYERS, 1);
      let ahead = uS - seams[i - 1];
      ahead -= Math.round(ahead);
      const u0 = ahead < 0 ? uS - ahead : uS;
      markSeam(i, u0, i * h);
      stepOnto(i, u0, i * h, buf.lastKind() === KIND.inner ? KIND.connector : KIND.outer, true);
      outerLoop(i, u0, uS + 1, n, rise, KIND.outer, KIND.none, true);
    }
    if (maxD - minD > maxGapMm) maxGapMm = maxD - minD;
    if (walls === 2) innerLoop(i, uS, n, minD, KIND.connector);
    if (capped) {
      cappedLayers[i] = 1;
      for (let p = start; p < buf.n; p++) buf.issues[p] |= ISSUE.finePattern;
    }
  }
  layerStarts[L] = buf.n;

  const count = buf.n;
  return {
    model: m,
    walls,
    path: buf.xyz.slice(0, 3 * count),
    kinds: buf.kinds.slice(0, count),
    issues: buf.issues.slice(0, count),
    layerOf: buf.layer.slice(0, count),
    /** 1 where a point is a node of the Pattern (D37), or null without one. */
    nodes: buf.node ? buf.node.slice(0, count) : null,
    layerStarts,
    layerZ,
    cappedLayers,
    seamLine,
    seams,
    pointCount: count,
    maxGapMm,
    simplified,
  };
}

/**
 * Skirt loops around the first layer's footprint (research §5.4 stage 7).
 * @param {ReturnType<typeof createWallModel>} m
 * @param {{ skirt: { offsetMm: number, loops: number } }} printer
 * @returns {Float64Array[]} one x,y,z array per loop, innermost first
 */
export function buildSkirt(m, printer) {
  const loops = [];
  const { offsetMm, loops: count } = printer.skirt;
  const z = m.h;
  const r = m.profile.at(z) + (m.morph ? Math.max(m.morphRange(z).hi, 0) : 0);
  const a = r;
  const b = r * m.plan.ratio;
  const xy = new Float64Array(2);
  const t = m.twistAt(z);
  for (let k = 0; k < count; k++) {
    const delta = -(offsetMm + k * m.w);
    const n = Math.max(64, Math.ceil(m.plan.perimeter(a, b, delta) / m.w));
    const loop = new Float64Array(3 * (n + 1));
    for (let j = 0; j <= n; j++) {
      m.plan.point(j / n, a, b, delta, xy);
      loop[3 * j] = xy[0] * t.c - xy[1] * t.s;
      loop[3 * j + 1] = xy[0] * t.s + xy[1] * t.c;
      loop[3 * j + 2] = z;
    }
    loops.push(loop);
  }
  return loops;
}
