// The design document (design §13): defaults, normalising, and the editing
// rules for the profile points (design §9.1).
//
// Everything that edits a design goes through here, so the core can rely on a
// normalised design: knots sorted, a layer height apart, radii above the
// minimum, every field present and in range.

import { BLEND_SHAPES } from './surface.js';
import { createProfile } from './profile.js';

export const DESIGN_SCHEMA = 'vasecreator/design';
export const DESIGN_VERSION = 2;

export const INTERPS = ['catmullRomCentripetal', 'monotone', 'linear'];
export const FOOTPRINTS = ['circle', 'rectangle'];
export const SEAM_POSITIONS = ['fixed', 'followTwist', 'hidden'];
export const INNER_WALLS = ['smooth', 'followPattern'];
export const MIN_KNOTS = 2;
export const MAX_KNOTS = 12;

/**
 * Numeric ranges for every field the UI edits, used by the clamps here and by
 * the controls. Keys follow the JSON field names. knotR.min is an absolute
 * floor; the real minimum radius is 2 × bead width (minRadius()).
 */
export const LIMITS = Object.freeze({
  height: { min: 20, max: 1000, step: 1 },            // form.height
  width: { min: 20, max: 1000, step: 1 },             // widest diameter (setWidth)
  depth: { min: 10, max: 1000, step: 1 },             // width × depthRatio (setDepth)
  depthRatio: { min: 0.25, max: 4, step: 0.01 },      // form.plan.depthRatio
  cornerRounding: { min: 0, max: 1, step: 0.01 },     // form.plan.cornerRounding
  twist: { min: -720, max: 720, step: 1 },            // form.twist.degrees
  knotZ: { min: 0, max: 1000, step: 0.1 },            // knot z
  knotR: { min: 1, max: 500, step: 0.1 },             // knot r
  tension: { min: 0, max: 1, step: 0.01 },            // form.profile.tension
  cornerMm: { min: 0, max: 100, step: 0.5 },          // form.profile.cornerMm and knot corner
  depthMm: { min: 0, max: 10, step: 0.1 },            // slot depthMm
  repeats: { min: 1, max: 200, step: 1 },             // slot repeats
  tileHeightMm: { min: 3, max: 1000, step: 0.5 },     // slot tileHeightMm
  fromMm: { min: 0, max: 1000, step: 0.5 },           // surface.fromMm
  toMm: { min: 0, max: 1000, step: 0.5 },             // surface.toMm
  amount: { min: 0, max: 1, step: 0.01 },             // surface.blend.amount
  beadWidthMm: { min: 0.5, max: 12, step: 0.1 },      // layers.beadWidthMm
  layerHeightMm: { min: 0.2, max: 8, step: 0.05 },    // layers.layerHeightMm
  overhangLimitDeg: { min: 5, max: 80, step: 1 },     // layers.overhangLimitDeg
  rampLengthMm: { min: 0, max: 200, step: 1 },        // layers.seam.rampLengthMm
  angleDeg: { min: 0, max: 359, step: 1 },            // layers.seam.angleDeg (wraps)
  baseLayers: { min: 0, max: 20, step: 1 },           // base.layers
  spacingRatio: { min: 0.5, max: 1.5, step: 0.01 },   // base.spacingRatio
  holeDiameter: { min: 0, max: 500, step: 0.5 },      // base.hole.diameter
  wallSpacingMm: { min: 0.5, max: 20, step: 0.1 },    // finish.wallSpacingMm
});

// The "Classic vase" preset (library/presets.json), named for a new design.
// Kept here so the core never needs to fetch; a test keeps the two equal.
const DEFAULT = {
  schema: DESIGN_SCHEMA,
  version: DESIGN_VERSION,
  units: 'mm',
  meta: { name: 'Design 1' },
  form: {
    height: 170,
    profile: {
      interp: 'catmullRomCentripetal',
      tension: 0.5,
      cornerMm: 0,
      knots: [
        { z: 0, r: 42 },
        { z: 55, r: 62 },
        { z: 128, r: 31 },
        { z: 170, r: 39 },
      ],
    },
    plan: { footprint: 'circle', depthRatio: 1, cornerRounding: 0 },
    twist: { degrees: 0 },
  },
  surface: {
    fromMm: 10,
    toMm: 150,
    a: { pattern: 'lib:flutes@1', depthMm: 2, repeats: 20, tileHeightMm: 19.5 },
    b: { pattern: 'plain', depthMm: 0, repeats: 1, tileHeightMm: 19.5 },
    blend: { shape: 'fadesUp', amount: 1 },
  },
  layers: {
    beadWidthMm: 3,
    layerHeightMm: 1.5,
    overhangLimitDeg: 45,
    seam: { rampLengthMm: 15, position: 'hidden', angleDeg: 0 },
  },
  base: { layers: 3, pattern: 'spiral', spacingRatio: 0.9, outline: true, hole: { diameter: 0 } },
  finish: { walls: 1, wallSpacingMm: 2.7, innerWall: 'smooth' },
};

/** @returns {object} a fresh copy of the default design ("Classic vase", named "Design 1") */
export function defaultDesign() {
  return structuredClone(DEFAULT);
}

/** @param {object} d @returns {object} a deep copy */
export function cloneDesign(d) {
  return structuredClone(d);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function num(value, fallback, limit, integer = false) {
  let v = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (integer) v = Math.round(v);
  if (limit) v = Math.min(Math.max(v, limit.min), limit.max);
  return v;
}

const pick = (value, options, fallback) => (options.includes(value) ? value : fallback);

/** Smallest radius the wall may have: two bead widths (design §11, V7). */
export function minRadius(d) {
  return 2 * d.layers.beadWidthMm;
}

function normaliseSlot(slot, fallback) {
  const s = isObject(slot) ? slot : {};
  return {
    pattern: typeof s.pattern === 'string' && s.pattern ? s.pattern : fallback.pattern,
    depthMm: num(s.depthMm, fallback.depthMm, LIMITS.depthMm),
    repeats: num(s.repeats, fallback.repeats, LIMITS.repeats, true),
    tileHeightMm: num(s.tileHeightMm, fallback.tileHeightMm, LIMITS.tileHeightMm),
  };
}

// Knots sorted by z, the bottom at 0 and the top at the height, neighbours at
// least one layer apart, radii in range. Knots that crowd a neighbour are
// dropped rather than moved, so the rest of the curve keeps its shape.
function normaliseKnots(input, height, h, rMin, fallbackKnots) {
  let knots = (Array.isArray(input) ? input : [])
    .filter((k) => isObject(k) && Number.isFinite(k.z) && Number.isFinite(k.r))
    .map((k) => {
      const out = { z: k.z, r: k.r };
      if (Number.isFinite(k.corner)) out.corner = Math.min(Math.max(k.corner, 0), LIMITS.cornerMm.max);
      return out;
    })
    .sort((a, b) => a.z - b.z);
  if (knots.length < MIN_KNOTS) knots = structuredClone(fallbackKnots);
  const z0 = knots[0].z;
  const span = knots[knots.length - 1].z - z0;
  if (span > 0) for (const k of knots) k.z = ((k.z - z0) / span) * height;
  else knots = [{ ...knots[0], z: 0 }, { ...knots[knots.length - 1], z: height }];
  knots[0].z = 0;
  knots[knots.length - 1].z = height;

  const kept = [knots[0]];
  for (let i = 1; i < knots.length - 1; i++) {
    if (knots[i].z - kept[kept.length - 1].z >= h && height - knots[i].z >= h) kept.push(knots[i]);
  }
  kept.push(knots[knots.length - 1]);
  while (kept.length > MAX_KNOTS) kept.splice(kept.length - 2, 1);
  for (const k of kept) k.r = Math.min(Math.max(k.r, rMin, LIMITS.knotR.min), LIMITS.knotR.max);
  return kept;
}

/**
 * Whether an opened file is a design at all, before normaliseDesign() fills
 * the gaps: it names the design schema, or (an older file without one) it
 * holds a form. Any other JSON, such as `{"hello": 1}`, would otherwise
 * normalise into the default pot without a word.
 * @param {unknown} json
 * @returns {boolean}
 */
export function looksLikeDesign(json) {
  if (!isObject(json)) return false;
  if (json.schema !== undefined) return json.schema === DESIGN_SCHEMA;
  return isObject(json.form);
}

/**
 * Fills defaults, clamps ranges, sorts knots and migrates older versions.
 * Never throws on missing or broken fields.
 * @param {unknown} json
 * @returns {object} a new, normalised design
 * @throws {TypeError} when json is not a design at all
 */
export function normaliseDesign(json) {
  if (!isObject(json)) throw new TypeError('Not a design: expected an object');
  if (json.schema !== undefined && json.schema !== DESIGN_SCHEMA) throw new TypeError(`Not a design: schema ${json.schema}`);
  if (typeof json.version === 'number' && json.version > DESIGN_VERSION) {
    throw new TypeError(`This design was made by a newer version (${json.version})`);
  }
  const D = DEFAULT;
  const form = isObject(json.form) ? json.form : {};
  const profile = isObject(form.profile) ? form.profile : {};
  const plan = isObject(form.plan) ? form.plan : {};
  const twist = isObject(form.twist) ? form.twist : {};
  const surface = isObject(json.surface) ? json.surface : {};
  const blend = isObject(surface.blend) ? surface.blend : {};
  const layers = isObject(json.layers) ? json.layers : {};
  const seam = isObject(layers.seam) ? layers.seam : {};
  const base = isObject(json.base) ? json.base : {};
  const hole = isObject(base.hole) ? base.hole : {};
  const finish = isObject(json.finish) ? json.finish : {};
  const meta = isObject(json.meta) ? json.meta : {};

  const beadWidthMm = num(layers.beadWidthMm, D.layers.beadWidthMm, LIMITS.beadWidthMm);
  const layerHeightMm = num(layers.layerHeightMm, D.layers.layerHeightMm, LIMITS.layerHeightMm);
  const lastKnotZ = Array.isArray(profile.knots) && profile.knots.length ? profile.knots.at(-1)?.z : undefined;
  const height = num(form.height, Number.isFinite(lastKnotZ) ? lastKnotZ : D.form.height, LIMITS.height);
  const knots = normaliseKnots(profile.knots, height, layerHeightMm, 2 * beadWidthMm, D.form.profile.knots);

  let fromMm = num(surface.fromMm, D.surface.fromMm, LIMITS.fromMm);
  let toMm = num(surface.toMm, D.surface.toMm, LIMITS.toMm);
  if (fromMm > toMm) [fromMm, toMm] = [toMm, fromMm];
  toMm = Math.min(toMm, height);
  fromMm = Math.min(fromMm, Math.max(toMm - layerHeightMm, 0));

  const angle = num(seam.angleDeg, 0);
  const out = {
    schema: DESIGN_SCHEMA,
    version: DESIGN_VERSION,
    units: 'mm',
    meta: { ...structuredClone(meta), name: typeof meta.name === 'string' && meta.name ? meta.name : D.meta.name },
    form: {
      height,
      profile: {
        interp: pick(profile.interp, INTERPS, D.form.profile.interp),
        tension: num(profile.tension, D.form.profile.tension, LIMITS.tension),
        cornerMm: num(profile.cornerMm, 0, LIMITS.cornerMm),
        knots,
      },
      plan: {
        footprint: pick(plan.footprint, FOOTPRINTS, 'circle'),
        depthRatio: num(plan.depthRatio, 1, LIMITS.depthRatio),
        cornerRounding: num(plan.cornerRounding, 0, LIMITS.cornerRounding),
      },
      twist: { degrees: num(twist.degrees, 0, LIMITS.twist) },
    },
    surface: {
      fromMm,
      toMm,
      a: normaliseSlot(surface.a, D.surface.a),
      b: isObject(surface.b) ? normaliseSlot(surface.b, { pattern: 'plain', depthMm: 0, repeats: 1, tileHeightMm: 19.5 }) : null,
      blend: {
        shape: pick(blend.shape, BLEND_SHAPES, 'fadesUp'),
        amount: num(blend.amount, 1, LIMITS.amount),
      },
    },
    layers: {
      beadWidthMm,
      layerHeightMm,
      overhangLimitDeg: num(layers.overhangLimitDeg, D.layers.overhangLimitDeg, LIMITS.overhangLimitDeg),
      seam: {
        rampLengthMm: num(seam.rampLengthMm, D.layers.seam.rampLengthMm, LIMITS.rampLengthMm),
        position: pick(seam.position, SEAM_POSITIONS, 'fixed'),
        angleDeg: angle - 360 * Math.floor(angle / 360),
      },
    },
    base: {
      layers: num(base.layers, D.base.layers, LIMITS.baseLayers, true),
      pattern: 'spiral',
      spacingRatio: num(base.spacingRatio, D.base.spacingRatio, LIMITS.spacingRatio),
      outline: base.outline !== false,
      hole: { diameter: num(hole.diameter, 0, LIMITS.holeDiameter) },
    },
    finish: {
      walls: finish.walls === 2 ? 2 : 1,
      wallSpacingMm: num(finish.wallSpacingMm, 0.9 * beadWidthMm, LIMITS.wallSpacingMm),
      innerWall: pick(finish.innerWall, INNER_WALLS, 'smooth'),
    },
  };
  // C7: tile heights are whole layers, so pattern rows line up with beads.
  for (const slot of [out.surface.a, out.surface.b]) {
    if (slot) slot.tileHeightMm = snapTileHeight(slot.tileHeightMm, layerHeightMm);
  }
  return out;
}

/**
 * A tile height rounded to a whole number of layers (at least one), so
 * pattern rows line up with beads (design §9.2, C7).
 * @param {number} mm
 * @param {number} layerHeightMm
 * @returns {number}
 */
export function snapTileHeight(mm, layerHeightMm) {
  const layers = Math.max(1, Math.round(mm / layerHeightMm));
  return Math.round(layers * layerHeightMm * 1e6) / 1e6;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.hasOwn(b, k) || !deepEqual(a[k], b[k])) return false;
  return true;
}

/** Deep equality of two designs, ignoring meta (name, id, dates). */
export function designsEqual(a, b) {
  const { meta: _a, ...restA } = a;
  const { meta: _b, ...restB } = b;
  return deepEqual(restA, restB);
}

// Keeps the surface range inside the height after the height changed.
function clampSurface(d) {
  const H = d.form.height;
  const h = d.layers.layerHeightMm;
  d.surface.toMm = Math.min(d.surface.toMm, H);
  d.surface.fromMm = Math.min(d.surface.fromMm, Math.max(d.surface.toMm - h, 0));
}

/**
 * Moves a profile point (design §9.1). The bottom point stays at height 0;
 * moving the top point changes the height. Neighbours keep at least one layer
 * height apart and the radius stays at or above 2 × bead width.
 * Mutates d in place.
 * @param {object} d a normalised design
 * @param {number} index
 * @param {{ z?: number, r?: number }} to
 */
export function moveKnot(d, index, { z, r } = {}) {
  const knots = d.form.profile.knots;
  const k = knots[index];
  if (!k) return;
  const h = d.layers.layerHeightMm;
  if (Number.isFinite(r)) k.r = Math.min(Math.max(r, minRadius(d), LIMITS.knotR.min), LIMITS.knotR.max);
  if (!Number.isFinite(z)) return;
  if (index === 0) {
    k.z = 0;
  } else if (index === knots.length - 1) {
    k.z = Math.min(Math.max(z, knots[index - 1].z + h, LIMITS.height.min), LIMITS.height.max);
    d.form.height = k.z;
    clampSurface(d);
  } else {
    k.z = Math.min(Math.max(z, knots[index - 1].z + h), knots[index + 1].z - h);
  }
}

/**
 * Adds a profile point between its neighbours in height.
 * @param {object} d
 * @param {{ z: number, r?: number }} at r defaults to the curve's radius at z
 * @returns {number} index of the new point, or −1 (12 points already, or no room)
 */
export function insertKnot(d, { z, r } = {}) {
  const knots = d.form.profile.knots;
  if (knots.length >= MAX_KNOTS || !Number.isFinite(z)) return -1;
  const h = d.layers.layerHeightMm;
  let i = 1;
  while (i < knots.length - 1 && knots[i].z < z) i++;
  const lo = knots[i - 1].z + h;
  const hi = knots[i].z - h;
  if (lo > hi) return -1;
  const zz = Math.min(Math.max(z, lo), hi);
  const rr = Number.isFinite(r) ? r : createProfile(d.form.profile).at(zz);
  knots.splice(i, 0, { z: zz, r: Math.min(Math.max(rr, minRadius(d), LIMITS.knotR.min), LIMITS.knotR.max) });
  return i;
}

/**
 * Removes a profile point.
 * @returns {boolean} false for the bottom or top point, or when only 2 remain
 */
export function deleteKnot(d, index) {
  const knots = d.form.profile.knots;
  if (index <= 0 || index >= knots.length - 1 || knots.length <= MIN_KNOTS) return false;
  knots.splice(index, 1);
  return true;
}

/**
 * Sets the height, scaling every point height and the surface range in
 * proportion. Stops short of squeezing two points closer than a layer.
 * @param {object} d @param {number} mm
 */
export function setHeight(d, mm) {
  const knots = d.form.profile.knots;
  const H = d.form.height;
  const h = d.layers.layerHeightMm;
  let gap = Infinity;
  for (let i = 1; i < knots.length; i++) gap = Math.min(gap, knots[i].z - knots[i - 1].z);
  const target = Math.min(Math.max(mm, LIMITS.height.min, (h * H) / gap), LIMITS.height.max);
  const s = target / H;
  for (const k of knots) k.z *= s;
  knots[0].z = 0;
  knots[knots.length - 1].z = target;
  d.form.height = target;
  d.surface.fromMm *= s;
  d.surface.toMm *= s;
  clampSurface(d);
}

/**
 * Widest radius of the evaluated profile curve (not just of the knots: a
 * smooth curve can bulge past them).
 * @param {object} d @returns {number} mm
 */
export function widestRadius(d) {
  const curve = createProfile(d.form.profile);
  let widest = 0;
  for (const k of d.form.profile.knots) widest = Math.max(widest, curve.at(k.z));
  const H = d.form.height;
  const steps = Math.ceil(H / 0.5);
  for (let i = 0; i <= steps; i++) widest = Math.max(widest, curve.at((H * i) / steps));
  return widest;
}

/**
 * Sets the widest diameter, scaling every point radius in proportion so the
 * curve keeps its character (C6).
 * @param {object} d @param {number} mm
 */
export function setWidth(d, mm) {
  const target = Math.min(Math.max(mm, LIMITS.width.min), LIMITS.width.max);
  const s = target / (2 * widestRadius(d));
  for (const k of d.form.profile.knots) {
    k.r = Math.min(Math.max(k.r * s, minRadius(d), LIMITS.knotR.min), LIMITS.knotR.max);
  }
}

/**
 * Sets the depth (Y size) as a ratio of the width.
 * @param {object} d @param {number} mm
 */
export function setDepth(d, mm) {
  const width = 2 * widestRadius(d);
  const ratio = Math.min(Math.max(mm, LIMITS.depth.min), LIMITS.depth.max) / width;
  d.form.plan.depthRatio = Math.min(Math.max(ratio, LIMITS.depthRatio.min), LIMITS.depthRatio.max);
}
