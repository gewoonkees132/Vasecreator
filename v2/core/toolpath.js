// The toolpath: layer grid, seam and ramp, wall evaluation, base spiral and
// walls (research §5.1, §5.4 stages 2–6 and 5b; design §9.3, §9.4, §10).
//
// The path is one continuous line of beads. Layer i has its top at
// z_i = (i + 1)·h. A wall layer starts at its seam on the layer below's height
// and climbs one layer height over the seam ramp, then runs flat back to the
// seam, where the next layer starts. Every bead therefore sits exactly one
// layer height above the bead below it, with no travel between layers (D10).
//
// The wall point is P = B(z, u) + D(z, u)·d̂: B the footprint outline scaled
// by the profile radius and turned by the twist, d̂ its radial direction in
// XY, and D the surface pattern displacement in mm. Pattern coordinates are
// x = repeats·u and y = z / tile height, with u riding on the outline, so whole
// repeats meet without a seam and the pattern follows the twist.

import { TAU, dcos, dsin, radians } from './math.js';
import { PLAIN, evaluatePattern, findPattern } from './patterns.js';
import { surfaceWeights } from './surface.js';
import { createProfile } from './profile.js';
import { createPlan } from './plan.js';
import { ISSUE } from './checks.js';

/** What the move ending at a point is (ARCHITECTURE.md, PreviewResult.kinds). */
export const KIND = Object.freeze({ none: 0, outer: 1, inner: 2, base: 3, connector: 4 });

export const MIN_POINTS_PER_LAYER = 64;
export const MAX_POINTS_PER_LAYER = 1600;

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
  if (recipe.kind === 'motif') {
    const n = recipe.cells.length;
    const layout = recipe.layout ?? 'stripes';
    return { around: n, up: layout === 'stripes' ? 0 : layout === 'diagonal' ? n : 2 };
  }
  return { around: 0, up: 0 };
}

/**
 * Resolves the surface slots against the pattern library. A pattern missing
 * from the library prints plain and is reported, so an old design still opens.
 */
export function resolveSlots(design, library) {
  const slots = [];
  const missing = [];
  for (const key of ['a', 'b']) {
    const slot = design.surface[key];
    if (!slot) continue;
    let entry = PLAIN;
    try {
      entry = findPattern(library ?? { patterns: [] }, slot.pattern);
    } catch {
      missing.push(slot.pattern);
    }
    slots.push({
      key,
      recipe: entry.recipe,
      depthMm: slot.depthMm,
      repeats: slot.repeats,
      tileHeightMm: slot.tileHeightMm,
      features: patternFeatures(entry.recipe),
      active: slot.depthMm > 0 && entry.recipe.kind !== 'plain',
    });
  }
  return { slots, missing };
}

/**
 * Everything needed to evaluate wall points for one design, precomputed once.
 * @param {object} design a normalised design
 * @param {{ patterns: object[] }} library
 */
export function createWallModel(design, library) {
  const { form, surface, layers, base } = design;
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
  const { slots, missing } = resolveSlots(design, library);
  const active = slots.filter((s) => s.active);
  const limit = radians(layers.overhangLimitDeg);
  const stepLimit = (h * dsin(limit)) / dcos(limit);

  // Two-entry weight cache: wall points alternate between their own height
  // and the height one layer below (for the overhang check).
  let zA = NaN, aA = 0, bA = 0, zB = NaN, aB = 0, bB = 0, flip = false;
  const weight = { a: 0, b: 0 };
  function weightsAt(z) {
    if (z === zA) { weight.a = aA; weight.b = bA; return weight; }
    if (z === zB) { weight.a = aB; weight.b = bB; return weight; }
    const s = surfaceWeights(surface, z, h);
    if (flip) { zA = z; aA = s.a; bA = s.b; } else { zB = z; aB = s.a; bB = s.b; }
    flip = !flip;
    weight.a = s.a;
    weight.b = s.b;
    return weight;
  }

  /** Pattern displacement D in mm at height z, position u. Never on the base. */
  function displacement(z, u) {
    if (z <= baseTop || active.length === 0) return 0;
    const wt = weightsAt(z);
    let d = 0;
    for (let k = 0; k < active.length; k++) {
      const s = active[k];
      const ws = s.key === 'a' ? wt.a : wt.b;
      if (ws > 0) d += ws * s.depthMm * evaluatePattern(s.recipe, s.repeats * u, z / s.tileHeightMm);
    }
    return d;
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

  return {
    design, h, w, H, layerCount, baseLayers, baseTop, profile, plan, twistPerMm, rMin,
    slots, active, missing, stepLimit, displacement, weightsAt, twistAt,
  };
}

// Growable point buffer: Float64 positions (the canonical toolpath) plus
// per-point kind, issue bits and layer index.
class PathBuffer {
  constructor(capacity) {
    this.n = 0;
    this.alloc(Math.max(capacity, 1024));
  }

  alloc(capacity) {
    const xyz = new Float64Array(capacity * 3);
    const kinds = new Uint8Array(capacity);
    const issues = new Uint8Array(capacity);
    const layer = new Uint16Array(capacity);
    if (this.xyz) {
      xyz.set(this.xyz.subarray(0, this.n * 3));
      kinds.set(this.kinds.subarray(0, this.n));
      issues.set(this.issues.subarray(0, this.n));
      layer.set(this.layer.subarray(0, this.n));
    }
    Object.assign(this, { xyz, kinds, issues, layer, capacity });
  }

  push(x, y, z, kind, issue, layer) {
    if (this.n === this.capacity) this.alloc(this.capacity * 2);
    const i = this.n++;
    this.xyz[3 * i] = x;
    this.xyz[3 * i + 1] = y;
    this.xyz[3 * i + 2] = z;
    this.kinds[i] = kind;
    this.issues[i] = issue;
    this.layer[i] = layer;
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
  const { design, plan, h, w, layerCount } = m;
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
    if (position === 'fixed') u = plan.uAtAngle(angle - m.twistPerMm * zStart);
    else if (position === 'hidden') u = plan.footprint === 'rectangle' ? corner : groove(m, (i + 1) * h, previous, w);
    seams[i] = u;
    previous = u;
  }
  return seams;
}

function groove(m, z, centre, w) {
  const wt = m.weightsAt(z);
  let repeats = 0;
  for (const s of m.active) {
    if ((s.key === 'a' ? wt.a : wt.b) > 0 && (repeats === 0 || s.repeats < repeats)) repeats = s.repeats;
  }
  if (repeats === 0) return centre;
  const half = 0.5 / repeats;
  const samples = 64;
  let lo = Infinity;
  let hi = -Infinity;
  let best = centre;
  for (let k = 0; k <= samples; k++) {
    const u = centre - half + (2 * half * k) / samples;
    const d = m.displacement(z, u);
    if (d < lo || (d === lo && Math.abs(u - centre) < Math.abs(best - centre))) { lo = d; best = u; }
    if (d > hi) hi = d;
  }
  if (hi - lo < 1e-3) return centre;
  const maxStep = w / (m.profile.at(z) * m.plan.unitPerimeter);
  return centre + Math.min(Math.max(best - centre, -maxStep), maxStep);
}

/**
 * Points around for a layer at height z (lead decision 5): bead spacing of
 * w/2, at least 8 points per pattern feature, then the 64–1600 clamp.
 * @returns {{ n: number, capped: boolean }}
 */
function pointsAround(m, zStart, zTop) {
  const perimeter = m.profile.at(zTop) * m.plan.unitPerimeter;
  let need = Math.max(Math.ceil(perimeter / (m.w / 2)), MIN_POINTS_PER_LAYER);
  const lo = m.weightsAt(zStart);
  const loA = lo.a;
  const loB = lo.b;
  const hi = m.weightsAt(zTop);
  for (const s of m.active) {
    const on = s.key === 'a' ? loA > 0 || hi.a > 0 : loB > 0 || hi.b > 0;
    if (on) need = Math.max(need, 8 * s.repeats * s.features.around);
  }
  return { n: Math.min(need, MAX_POINTS_PER_LAYER), capped: need > MAX_POINTS_PER_LAYER };
}

/**
 * Builds the full toolpath for a design.
 * @param {object} design a normalised design
 * @param {{ patterns: object[] }} library
 * @param {{ walls?: 1 | 2 }} [options] walls defaults to 1 (the design view's centreline wall)
 */
export function buildToolpath(design, library, { walls = 1 } = {}) {
  const m = createWallModel(design, library);
  const { h, w, layerCount: L, baseLayers: nb, profile, plan, rMin, stepLimit } = m;
  const spacing = design.finish.wallSpacingMm;
  const innerWall = design.finish.innerWall;
  const rampMm = design.layers.seam.rampLengthMm;
  const seams = seamPositions(m);

  const estimate = Math.ceil((L - nb) * walls * 1.1 * (profile.at(design.form.height / 2) * plan.unitPerimeter) / (w / 2)) + nb * 4000;
  const buf = new PathBuffer(estimate);
  const layerStarts = new Uint32Array(L + 1);
  const layerZ = new Float64Array(L);
  const cappedLayers = new Uint8Array(L);
  const seamLine = new Float32Array(3 * (L - nb));
  const unit = new Float64Array(2);
  const xy = new Float64Array(2);
  let maxGapMm = 0;
  let minD = 0;
  let maxD = 0;

  // One closed loop of the outer wall (or a base ring) from the seam back to
  // the seam. With a ramp it starts one layer lower and climbs over the ramp.
  function outerLoop(i, uS, n, ramp, kind, firstKind, checkOverhang) {
    const zStart = i * h;
    const zTop = (i + 1) * h;
    const perimeter = profile.at(zTop) * plan.unitPerimeter;
    const rampLength = Math.min(rampMm, perimeter / 2);
    minD = Infinity;
    maxD = -Infinity;
    for (let j = 0; j <= n; j++) {
      const u = uS + j / n;
      let z = zTop;
      if (ramp) {
        if (j === 0) z = zStart;
        else if (rampLength > 0) z = zStart + h * Math.min(((j / n) * perimeter) / rampLength, 1);
      }
      plan.unitPoint(u, unit);
      const unitLength = Math.sqrt(unit[0] * unit[0] + unit[1] * unit[1]);
      const D = m.displacement(z, u);
      if (D < minD) minD = D;
      if (D > maxD) maxD = D;
      let radius = profile.at(z) * unitLength + D;
      let issue = 0;
      // A hair of slack: a circle of exactly r_min must not flag itself.
      if (radius < rMin - 1e-9) { radius = rMin; issue |= ISSUE.narrow; }
      if (checkOverhang) {
        const zb = z - h;
        let below = profile.at(zb) * unitLength + m.displacement(zb, u);
        if (below < rMin - 1e-9) below = rMin;
        if (Math.abs(radius - below) > stepLimit) issue |= ISSUE.overhang;
      }
      const t = m.twistAt(z);
      const s = radius / unitLength;
      const x = (unit[0] * t.c - unit[1] * t.s) * s;
      const y = (unit[0] * t.s + unit[1] * t.c) * s;
      if (j === 0) {
        if (kind === KIND.outer && i >= nb) {
          const k = 3 * (i - nb);
          seamLine[k] = x;
          seamLine[k + 1] = y;
          seamLine[k + 2] = z;
        }
        if (buf.at(x, y, z)) continue;
        buf.push(x, y, z, buf.n === 0 ? KIND.none : firstKind, issue, i);
      } else {
        buf.push(x, y, z, kind, issue, i);
      }
    }
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
      const D = innerWall === 'smooth' ? layerMinD : m.displacement(zTop, u);
      let radius = profile.at(zTop) * unitLength + D - spacing;
      let issue = 0;
      if (radius < floor) { radius = floor; issue |= ISSUE.narrow; }
      const t = m.twistAt(zTop);
      const s = radius / unitLength;
      buf.push((unit[0] * t.c - unit[1] * t.s) * s, (unit[0] * t.s + unit[1] * t.c) * s, zTop, j === 0 ? firstKind : KIND.inner, issue, i);
    }
  }

  // Base spiral parameters for base layer k: offset δ(p) = inset + spacing·(1 + p)
  // grows by one spacing per turn p, and every turn starts at the seam u.
  function spiralTurns(k, inset) {
    const zTop = (k + 1) * h;
    const r = profile.at(zTop);
    const a = r;
    const b = r * plan.ratio;
    const step = design.base.spacingRatio * w;
    const hole = design.base.hole.diameter;
    const stop = hole > 0 ? hole / 2 + w / 2 : step / 2;
    const end = (Math.min(a, b) - stop - inset) / step - 1;
    const ps = [];
    if (end < 0) return { ps, a, b, step, zTop };
    let p = 0;
    ps.push(0);
    for (;;) {
      const perimeter = plan.perimeter(a, b, inset + step * (1 + p));
      p += w / 2 / Math.max(perimeter, w);
      if (p >= end - 1e-9) { if (end > 0) ps.push(end); break; }
      ps.push(p);
    }
    return { ps, a, b, step, zTop };
  }

  function spiralPoint(spiral, inset, uS, p, kind, layer) {
    plan.point(uS + p, spiral.a, spiral.b, inset + spiral.step * (1 + p), xy);
    const t = m.twistAt(spiral.zTop);
    buf.push(xy[0] * t.c - xy[1] * t.s, xy[0] * t.s + xy[1] * t.c, spiral.zTop, kind, 0, layer);
  }

  // Base layers (design §9.4, research §5.4 stage 6): the ring(s) plus a
  // spiral inside, alternating direction so the last base layer ends at the
  // seam on the outer ring and the wall starts in place.
  //   outward: centre → spiral out → step to the ring → ring loop to the seam
  //   inward:  ring loop from the seam → step in → spiral in to the centre
  for (let k = 0; k < nb; k++) {
    layerStarts[k] = buf.n;
    layerZ[k] = (k + 1) * h;
    const uS = seams[k];
    const { n } = pointsAround(m, k * h, (k + 1) * h);
    const outward = (nb - 1 - k) % 2 === 0;
    const inset = walls === 2 ? spacing : 0;
    const spiral = spiralTurns(k, inset);
    if (outward) {
      for (let q = spiral.ps.length - 1; q >= 0; q--) {
        spiralPoint(spiral, inset, uS, spiral.ps[q], q === spiral.ps.length - 1 ? KIND.none : KIND.base, k);
      }
      if (walls === 2) {
        innerLoop(k, uS, n, 0, spiral.ps.length ? KIND.base : KIND.none);
        outerLoop(k, uS, n, false, KIND.outer, KIND.connector, false);
      } else {
        outerLoop(k, uS, n, false, KIND.outer, spiral.ps.length ? KIND.base : KIND.none, false);
      }
    } else {
      const firstKind = buf.lastKind() === KIND.inner ? KIND.connector : KIND.outer;
      outerLoop(k, uS, n, k > 0, KIND.outer, firstKind, false);
      if (walls === 2) innerLoop(k, uS, n, 0, KIND.connector);
      for (let q = 0; q < spiral.ps.length; q++) spiralPoint(spiral, inset, uS, spiral.ps[q], KIND.base, k);
    }
  }

  // Wall layers: outer loop (ramped), then for two walls a connector in at the
  // seam, the inner loop flat at the layer top and a connector back out to the
  // next layer's start.
  for (let i = nb; i < L; i++) {
    layerStarts[i] = buf.n;
    layerZ[i] = (i + 1) * h;
    const uS = seams[i];
    const { n, capped } = pointsAround(m, i * h, (i + 1) * h);
    const firstKind = buf.lastKind() === KIND.inner ? KIND.connector : KIND.outer;
    const start = buf.n;
    outerLoop(i, uS, n, i > 0, KIND.outer, firstKind, i > 0);
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
    layerStarts,
    layerZ,
    cappedLayers,
    seamLine,
    seams,
    pointCount: count,
    maxGapMm,
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
  const r = m.profile.at(z);
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
