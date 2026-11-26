// The toolpath: layer grid, seam and ramp, wall evaluation, base spiral and
// walls (research §5.1, §5.4 stages 2–6 and 5b; design §9.3, §9.4, §10).
//
// The path is one continuous line of beads. Layer i has its top at
// z_i = (i + 1)·h. A wall layer starts at its seam on the layer below's height
// and climbs one layer height over the seam ramp (a number of points, D67),
// then runs flat back to the seam, where the next layer starts. Every bead therefore sits one layer
// height above the bead below it, with no travel between layers (D10). The
// exceptions are bounded: base layers are flat (rings included) and climb
// with a short step at the seam; the first RAMP_IN_LAYERS wall layers grow
// the ramp (gap ≥ 0.75 h) and the last as many shrink it, so the rim is level
// (gap ≤ 1.25 h, D68); a seam that moves along the wall by up to a bead
// width changes the gap over the ramp by at most that width / ramp length.
//
// The wall point is P = B(z, u) + D(z, u)·d̂: B the footprint outline scaled
// by the profile radius and turned by the twist, d̂ its radial direction in
// XY, and D the displacement in mm: the Pattern (design.pattern,
// core/layer-pattern.js), with u riding on the outline, so it follows the
// twist.
//
// The Pattern is per layer and per node (D37, D39): inside its range every
// layer has the same N nodes at u = j / N and, crisp, no other points (D58):
// the outline and the Morph are followed at the nodes.
// With Soften on, the same k points sit in every gap (D59), so a layer has
// N·(k + 1) points and every (k + 1)-th is a node. The seam sits on one
// column of the drawing there, the same on every layer (D65, D66), and the
// ramp runs over whole cells: the climb is shared out evenly
// over those points, and so is the change from the row below to the layer's
// own, so the path never steps sideways at the seam (D60). It is
// exempt from the overhang and the two-layers-per-bump rules and has its own
// bead-support rule (D43).
//
// Phase 2: the geometry morph M(z, u) (core/morph.js) is added to the profile
// radius before the footprint, D and the minimum-radius clamp, so the walls,
// the base, the checks and the size all see the morphed form. A morph map may
// be an image ('img:…', sampled from the Raster passed in `images`).

import { TAU, dcos, dsin, radians } from './math.js';
import { createLayerPattern } from './layer-pattern.js';
import { createProfile } from './profile.js';
import { createPlan } from './plan.js';
import { ISSUE } from './checks.js';
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

// Widest radius of the profile curve over the layer tops (and the ends).
function widestProfileRadius(profile, H, h) {
  let widest = Math.max(profile.at(0), profile.at(H));
  for (let z = h; z < H; z += h) widest = Math.max(widest, profile.at(z));
  return widest;
}

/**
 * Everything needed to evaluate wall points for one design, precomputed once.
 * @param {object} design a normalised design
 * @param {{ layerPatterns?: object[] }} library
 * @param {{ images?: Map<string, object> }} [options]
 */
export function createWallModel(design, library, { images } = {}) {
  const { form, layers, base } = design;
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
  const widestMm = form.morph ? widestProfileRadius(profile, H, h) * plan.unitPerimeter : 0;
  const morph = createMorph(design, { images, perimeterMm: widestMm });
  /** A Pattern whose drawing can't be found prints plain and is reported, so an old design still opens. */
  const missing = [];
  /** The morph's image map when this device doesn't have it. */
  const missingImages = morph?.missingImage ? [design.form.morph.map] : [];
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
  const limit = radians(design.rules.overhangLimitDeg);
  const stepLimit = (h * dsin(limit)) / dcos(limit);
  const supportLimit = design.rules.supportRatio * w;

  /** The wall layer a height lies on: layer i runs from i·h up to its top at (i + 1)·h. */
  const layerAt = (z) => Math.max(0, Math.ceil(z / h - 1e-6) - 1);
  /** The Pattern's displacement in mm on wall layer i at u (0 outside its range). */
  const patternAt = lp ? lp.at : () => 0;

  /**
   * The displacement D in mm at height z, position u: the Pattern of
   * `layer` (by default the layer z lies on; the toolpath passes it, as the
   * first point of a ramp sits on the layer below's top).
   */
  function displacement(z, u, layer = layerAt(z)) {
    return lp ? lp.at(layer, u) : 0;
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
   * (P, the Pattern), radius the distance along the
   * unit outline (|unit| = unitLength), bare that radius without the Pattern
   * (for the overhang check, D43), narrow whether the minimum radius clamped it.
   * `below` is the share of the Pattern still on the row of the layer below
   * (the start of a layer, D60).
   */
  function centrePoint(u, z, layer = layerAt(z), below = 0) {
    plan.unitPoint(u, unitXY);
    const unitLength = Math.sqrt(unitXY[0] * unitXY[0] + unitXY[1] * unitXY[1]);
    const P = lp ? lp.at(layer, u, below) : 0;
    const D = P;
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
    missing, missingImages, stepLimit, supportLimit,
    patternAt, displacement, layerAt, twistAt, centrePoint,
    morph: morphOn ? morph : null, morphAmp, morphAt, morphRange,
    /** The Pattern (core/layer-pattern.js) when it prints, else null. */
    pattern: lp,
    /** Points per layer in the Pattern's range: N·(k + 1), the same on every layer there. */
    patternPoints: 0,
  };
  // The nodes alone when crisp; with Soften the same extra points in each gap (D58, D59).
  if (lp) model.patternPoints = lp.pointsPerLayer;
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
 *   hidden: the rectangle corner nearest the angle, or else the deepest Pattern
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
  // The most the seam moves between layer i and the one above it: a bead
  // width on the wider of the two, in u.
  const most = (i) => w / (Math.max(m.profile.at((i + 1) * h), m.profile.at((i + 2) * h)) * plan.unitPerimeter);
  // u moved towards `from` until it is at most `limit` away (round the pot).
  const toward = (u, from, limit) => {
    let d = u - from;
    d -= Math.round(d);
    return Math.abs(d) <= limit ? u : from + Math.sign(d) * limit;
  };
  let previous = follow;
  let column = NaN;
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
      // The seam column (D65, D66): every layer in the range starts on the
      // same column of the drawing, so each lap is whole tiles from seam to
      // seam and the seam is one line that turns with the columns. Hidden
      // takes the quietest column, the others the drawing's left edge, on
      // the tile nearest where the seam would be on the range's first layer.
      if (Number.isNaN(column)) {
        const c = position === 'hidden' ? lp.seamColumn(patternRampCells(m)) : 0;
        const t = Math.round((u * lp.nodes - c) / lp.columns);
        column = (t * lp.columns + c) / lp.nodes;
        column -= Math.floor(column);
      }
      u = column;
    } else if (!Number.isNaN(column)) {
      // Above the range the seam goes back to its own place a bead width a
      // layer at most (a hidden seam on a plain wall holds).
      u = toward(u, previous, most(i - 1));
    }
    seams[i] = u;
    previous = u;
  }
  // Below the range the seam walks to the seam column a bead width a layer
  // at most, so it doesn't jump where the Pattern starts.
  if (lp && !Number.isNaN(column)) {
    for (let i = lp.first - 1; i >= 0; i--) seams[i] = toward(seams[i], seams[i + 1], most(i));
  }
  return seams;
}

/**
 * Cells the seam ramp runs over in the Pattern's range (D67): the ramp's
 * points, at most half a lap, at least one.
 */
function patternRampCells(m) {
  return Math.max(1, Math.min(m.design.layers.seam.rampPoints, Math.floor(m.pattern.nodes / 2)));
}

// The deepest groove of layer i near u = centre, over one tile of the Pattern.
function groove(m, i, centre, w) {
  const z = (i + 1) * m.h;
  if (!m.pattern?.inRange(i)) return centre;
  const repeats = m.pattern.repeats;
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

// Points the outline and the Morph need on the layer up to zTop (lead
// decision 5): a bead spacing of w/2 and at least 8 points per feature,
// before any clamp.
function pointsNeeded(m, zTop) {
  const perimeter = (m.profile.at(zTop) + m.morphAmp) * m.plan.unitPerimeter;
  let need = Math.max(Math.ceil(perimeter / (m.w / 2)), MIN_POINTS_PER_LAYER);
  if (m.morph) need = Math.max(need, 8 * m.morph.repeats * m.morph.featuresAround);
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
  const need = pointsNeeded(m, zTop);
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
 * @param {{ layerPatterns?: object[] }} library
 * @param {{ walls?: 1 | 2, maxPoints?: number, images?: Map<string, object> }} [options] walls defaults
 *   to 1 (the design view's centreline wall); maxPoints is the point budget (MAX_TOOLPATH_POINTS);
 *   images are the Rasters by hash for 'img:' morph maps
 */
export function buildToolpath(design, library, { walls = 1, maxPoints = MAX_TOOLPATH_POINTS, images } = {}) {
  const m = createWallModel(design, library, { images });
  const { h, w, layerCount: L, baseLayers: nb, profile, plan, rMin, stepLimit, supportLimit, pattern: lp } = m;
  const spacing = design.finish.wallSpacingMm;
  const innerWall = design.finish.innerWall;
  const rampPoints = design.layers.seam.rampPoints;
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
  function wallPoint(u, z, checkOverhang, i, below = 0) {
    const c = m.centrePoint(u, z, i, below);
    const { D, radius, bare, unitLength } = c;
    if (D < minD) minD = D;
    if (D > maxD) maxD = D;
    let issue = c.narrow ? ISSUE.narrow : 0;
    if (checkOverhang) {
      const zb = z - h;
      let baseBelow = profile.at(zb);
      if (morphed) baseBelow = Math.max(baseBelow + m.morphAt(zb, u), rMin);
      const bareBelow = baseBelow * unitLength;
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
  // `firstKind`. With `changeRow` the Pattern starts on the row of the layer
  // below and changes to this layer's own over the same ramp (D60).
  function outerLoop(i, u0, u1, n, rise, kind, firstKind, checkOverhang, changeRow = false) {
    const zTop = (i + 1) * h;
    const zLow = zTop - rise;
    const span = u1 - u0;
    const onGrid = !!lp && lp.inRange(i) && n <= MAX_POINTS_PER_LAYER;
    const count = onGrid ? gridPoints(u0, u1, n) : Math.max(1, Math.round(n * span));
    // The ramp is a number of points (D67), at most half a lap: in the
    // Pattern's range whole cells, so the climb ends on a node and Soften's
    // points between them come along; elsewhere the layer's own points.
    const rampCells = onGrid ? patternRampCells(m) : 0;
    const rampSteps = Math.max(1, Math.min(rampPoints, Math.floor(n / 2)));
    const blend = changeRow && !!lp && (lp.inRange(i) || lp.inRange(i - 1));
    for (let j = 0; j <= count; j++) {
      const u = onGrid ? grid[j] : j === count ? u1 : u0 + (span * j) / count;
      // How far up the ramp this point is: 0 at the start, 1 from its end on.
      let ramp = 1;
      if (j === 0) ramp = 0;
      else if (rampCells > 0) ramp = Math.min(((u - u0) * lp.nodes) / rampCells, 1);
      else ramp = Math.min(j / rampSteps, 1);
      const z = rise > 0 ? zLow + rise * ramp : zTop;
      wallPoint(u, z, checkOverhang, i, blend ? 1 - ramp : 0);
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
    wallPoint(u, z, checkOverhang, i, 1);
    if (buf.n > 0 && !buf.at(wx, wy, z)) buf.push(wx, wy, z, kind, wIssue, i, wNode);
  }

  // The seam marker of wall layer i: where the layer starts.
  function markSeam(i, u, z, below = 0) {
    wallPoint(u, z, false, i, below);
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
  //   Ramp out: the last RAMP_IN_LAYERS wall layers shrink the climb the same
  //   way, so the top layer is flat and the rim level (D68); the gap never
  //   rises over (1 + 1/RAMP_IN_LAYERS) of a layer.
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
      // The climb grows over the first RAMP_IN_LAYERS wall layers and shrinks
      // over the last as many, so the top layer is flat (D68).
      const grow = i < firstRamped ? 0 : Math.min((i - firstRamped + 1) / RAMP_IN_LAYERS, 1);
      const shrink = Math.min((L - 1 - i) / RAMP_IN_LAYERS, 1);
      const rise = h * Math.min(grow, shrink);
      let ahead = uS - seams[i - 1];
      ahead -= Math.round(ahead);
      const u0 = ahead < 0 ? uS - ahead : uS;
      markSeam(i, u0, i * h, 1);
      stepOnto(i, u0, i * h, buf.lastKind() === KIND.inner ? KIND.connector : KIND.outer, true);
      outerLoop(i, u0, uS + 1, n, rise, KIND.outer, KIND.none, true, true);
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
