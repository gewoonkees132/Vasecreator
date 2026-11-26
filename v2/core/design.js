// The design document (design §13): defaults, normalising, and the editing
// rules for the profile points (design §9.1).
//
// Version 4 (D63, no migration): the Detailed morph (form.detail) is gone.
// The bead-scale Pattern is design.pattern (null when off), and the warning
// thresholds are design.rules: the overhang limit, bead support and the
// tightest curve, all set in the warnings card (D44).
//
// Everything that edits a design goes through here, so the core can rely on a
// normalised design: knots sorted, a layer height apart, radii above the
// minimum, every field present and in range.

import { DENSITY_FACES, DEFAULT_POINTS, DEPTH_BEADS, FADE_SHAPES, PATTERN_SITS, SPACING_BEADS, defaultPatternRange, defaultSpacingMm } from './layer-pattern.js';
import { createProfile } from './profile.js';
import { BASE_PATTERNS, basePairs } from './base-infill.js';
import { validateRecipe } from './patterns.js';
import { normalisePaint } from './paint.js';
import { FACETS_DEFAULTS, FACETS_MAP, FACETS_MIN_AROUND, MORPH_DEFAULTS, isMorphMap } from './morph.js';

export const DESIGN_SCHEMA = 'vasecreator/design';
export const DESIGN_VERSION = 6;

export const INTERPS = ['catmullRomCentripetal', 'monotone', 'linear'];
export const FOOTPRINTS = ['circle', 'rectangle'];
export const SEAM_POSITIONS = ['fixed', 'followTwist', 'hidden'];
export const INNER_WALLS = ['smooth', 'followPattern'];
export const MIN_KNOTS = 2;
export const MAX_KNOTS = 12;
/** Most entries design.assets keeps (recipes and image references). */
export const MAX_ASSETS = 32;

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
  fromMm: { min: 0, max: 1000, step: 0.5 },           // pattern.fromMm
  toMm: { min: 0, max: 1000, step: 0.5 },             // pattern.toMm
  amount: { min: 0, max: 1, step: 0.01 },             // pattern.fade.amount
  patternDepthMm: { min: 0, max: 8, step: 0.05 },     // pattern.depthMm; the real most is ⅔ bead width
  spacingMm: { min: 0.1, max: 36, step: 0.1 },        // pattern.density.spacingMm; really ¼ to 3 bead widths
  points: { min: 1, max: 1600, step: 1 },             // pattern.density.points
  softenCells: { min: 0, max: 2, step: 0.05 },        // pattern.softenCells
  beadWidthMm: { min: 0.5, max: 12, step: 0.1 },      // layers.beadWidthMm
  layerHeightMm: { min: 0.2, max: 8, step: 0.05 },    // layers.layerHeightMm
  overhangLimitDeg: { min: 5, max: 80, step: 1 },     // rules.overhangLimitDeg
  supportRatio: { min: 0.1, max: 1, step: 0.05 },     // rules.supportRatio, of a bead width
  curveRatio: { min: 0.1, max: 1.5, step: 0.05 },     // rules.curveRatio, the tightest curve's radius, of a bead width
  rampPoints: { min: 1, max: 40, step: 1 },           // layers.seam.rampPoints (D67)
  angleDeg: { min: 0, max: 359, step: 1 },            // layers.seam.angleDeg (wraps)
  baseLayers: { min: 0, max: 20, step: 2 },           // base.layers, in pairs (D76)
  spacingRatio: { min: 0.5, max: 1.5, step: 0.01 },   // base.spacingRatio
  holeDiameter: { min: 0, max: 500, step: 0.5 },      // base.hole.diameter
  wallSpacingMm: { min: 0.5, max: 20, step: 0.1 },    // finish.wallSpacingMm
  morphSoftnessMm: { min: 0, max: 100, step: 0.5 },   // form.morph.softnessMm
  morphStrengthMm: { min: 0, max: 60, step: 0.5 },    // form.morph.strengthMm
  morphRepeats: { min: 1, max: 24, step: 1 },         // form.morph.repeats
  morphBlend: { min: 0, max: 1, step: 0.01 },         // form.morph.blend
  facetRows: { min: 1, max: 8, step: 1 },             // form.morph.facets.rows (D69)
  facetIrregularity: { min: 0, max: 1, step: 0.01 },  // form.morph.facets.irregularity
  facetSeed: { min: 0, max: 999, step: 1 },           // form.morph.facets.seed
  facetRimMm: { min: 0, max: 100, step: 0.5 },        // form.morph.facets.rimMm
  slantCells: { min: -8, max: 8, step: 0.25 },        // pattern.slant.cells and toCells (D70, D71)
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
    morph: null,
  },
  pattern: null,
  layers: {
    // The standard layer: 8 mm wide, 5 mm high (D62).
    beadWidthMm: 8,
    layerHeightMm: 5,
    seam: { rampPoints: 4, position: 'hidden', angleDeg: 0 },
  },
  rules: { overhangLimitDeg: 45, supportRatio: 0.7, curveRatio: 0.5 },
  base: { layers: 2, pattern: 'spiral', spacingRatio: 0.9, outline: true, hole: { diameter: 0 } },
  finish: { walls: 1, wallSpacingMm: 7.2, innerWall: 'smooth' },
  assets: {},
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

// Knots sorted by z, the bottom at 0 and the top at the height, neighbours at
// least one layer apart, radii in range. Knots that crowd a neighbour are
// dropped rather than moved, so the rest of the curve keeps its shape.
function normaliseKnots(input, height, h, rMin, fallbackKnots) {
  let knots = (Array.isArray(input) ? input : [])
    .filter((k) => isObject(k) && Number.isFinite(k.z) && Number.isFinite(k.r))
    .map((k) => {
      const out = { z: k.z, r: k.r };
      if (Number.isFinite(k.corner)) out.corner = Math.min(Math.max(k.corner, 0), LIMITS.cornerMm.max);
      if (k.sharp === true) out.sharp = true;
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

const HASH = /^[0-9a-f]{16}$/;
const assetName = (name, fallback) => (typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : fallback);

// design.assets (ARCHITECTURE.md, phase 2): 'user:…' recipes that evaluate,
// 'img:<hash>' image references with a positive size. Anything else is
// dropped; at most MAX_ASSETS entries are kept.
function normaliseAssets(input) {
  const out = {};
  if (!isObject(input)) return out;
  let count = 0;
  for (const [key, entry] of Object.entries(input)) {
    if (count >= MAX_ASSETS) break;
    if (!isObject(entry) || key.length > 80) continue;
    if (entry.kind === 'recipe' && key.startsWith('user:') && key.length > 5) {
      try {
        validateRecipe(entry.recipe);
      } catch {
        continue;
      }
      out[key] = { kind: 'recipe', name: assetName(entry.name, 'My pattern'), recipe: structuredClone(entry.recipe) };
    } else if (entry.kind === 'image' && typeof entry.hash === 'string' && HASH.test(entry.hash) && key === `img:${entry.hash}`
      && Number.isInteger(entry.width) && Number.isInteger(entry.height) && entry.width > 0 && entry.height > 0) {
      out[key] = { kind: 'image', name: assetName(entry.name, 'Image'), hash: entry.hash, width: entry.width, height: entry.height };
    } else {
      continue;
    }
    count++;
  }
  return out;
}

// form.morph: null, or a built-in map or an image reference with every field
// clamped. An 'img:' map whose asset is missing is kept; the toolpath reports it.
// Facets (D69) also have their layout, and at least three faces around;
// every other map drops it.
function normaliseMorph(input) {
  if (!isObject(input) || typeof input.map !== 'string') return null;
  const map = input.map;
  if (!isMorphMap(map) && !/^img:[0-9a-f]{16}$/.test(map)) return null;
  const D = MORPH_DEFAULTS;
  const out = {
    map,
    softnessMm: num(input.softnessMm, D.softnessMm, LIMITS.morphSoftnessMm),
    strengthMm: num(input.strengthMm, D.strengthMm, LIMITS.morphStrengthMm),
    repeats: num(input.repeats, D.repeats, LIMITS.morphRepeats, true),
    blend: num(input.blend, D.blend, LIMITS.morphBlend),
  };
  if (map === FACETS_MAP) {
    const f = isObject(input.facets) ? input.facets : {};
    const F = FACETS_DEFAULTS;
    out.repeats = Math.max(out.repeats, FACETS_MIN_AROUND);
    out.facets = {
      rows: num(f.rows, F.rows, LIMITS.facetRows, true),
      stagger: typeof f.stagger === 'boolean' ? f.stagger : F.stagger,
      irregularity: num(f.irregularity, F.irregularity, LIMITS.facetIrregularity),
      seed: num(f.seed, F.seed, LIMITS.facetSeed, true),
      rimMm: num(f.rimMm, F.rimMm, LIMITS.facetRimMm),
    };
  }
  return out;
}

const quarter = (v) => Math.round(v * 4) / 4;

// pattern.slant (D70, D71): whole quarter cells a layer, per facet or even.
function normaliseSlant(input) {
  const s = isObject(input) ? input : {};
  return {
    cells: quarter(num(s.cells, 0, LIMITS.slantCells)),
    perFacet: s.perFacet === true,
    toCells: quarter(num(s.toCells, 0, LIMITS.slantCells)),
  };
}

// A From / To pair inside the height, at least a layer apart.
function normaliseRange(input, fallback, height, h) {
  let fromMm = num(input.fromMm, fallback.fromMm, LIMITS.fromMm);
  let toMm = num(input.toMm, fallback.toMm, LIMITS.toMm);
  if (fromMm > toMm) [fromMm, toMm] = [toMm, fromMm];
  toMm = Math.min(toMm, height);
  fromMm = Math.min(fromMm, Math.max(toMm - h, 0));
  return { fromMm, toMm };
}

// design.pattern (D38–D42): null, or a drawing id with every setting clamped.
// Depth is at most two thirds of a bead and the spacing a quarter bead to three beads,
// for the bead width the design has now. A drawing that can't be found is
// kept; the toolpath reports it.
function normalisePattern(input, d) {
  if (!isObject(input) || typeof input.drawing !== 'string' || !input.drawing || input.drawing.length > 80) return null;
  const w = d.layers.beadWidthMm;
  const density = isObject(input.density) ? input.density : {};
  const fade = isObject(input.fade) ? input.fade : {};
  const range = normaliseRange(input, defaultPatternRange(d), d.form.height, d.layers.layerHeightMm);
  return {
    drawing: input.drawing,
    depthMm: num(input.depthMm, DEPTH_BEADS.default * w, { min: 0, max: DEPTH_BEADS.max * w }),
    density: {
      by: pick(density.by, DENSITY_FACES, 'spacing'),
      spacingMm: num(density.spacingMm, defaultSpacingMm(w), { min: SPACING_BEADS.min * w, max: SPACING_BEADS.max * w }),
      points: num(density.points, DEFAULT_POINTS, LIMITS.points, true),
    },
    fromMm: range.fromMm,
    toMm: range.toMm,
    fade: { shape: pick(fade.shape, FADE_SHAPES, 'even'), amount: num(fade.amount, 1, LIMITS.amount) },
    softenCells: num(input.softenCells, 0, LIMITS.softenCells),
    slant: normaliseSlant(input.slant),
    sits: pick(input.sits, PATTERN_SITS, 'centre'),
    // The paint (D79, core/paint.js): null is white, the Pattern in full everywhere.
    paint: normalisePaint(input.paint),
  };
}

/**
 * A design without the optional fields when they are empty (assets {},
 * form.morph null, pattern null and a Pattern's paint null), so files stay short.
 * @param {object} d a design
 * @returns {object} d itself, or a shallow copy without the empty fields
 */
export function compactDesign(d) {
  const emptyAssets = !isObject(d.assets) || Object.keys(d.assets).length === 0;
  const noMorph = isObject(d.form) && d.form.morph == null;
  const noPattern = Object.hasOwn(d, 'pattern') && d.pattern == null;
  const noPaint = isObject(d.pattern) && Object.hasOwn(d.pattern, 'paint') && d.pattern.paint == null;
  if (!emptyAssets && !noMorph && !noPattern && !noPaint) return d;
  const out = { ...d };
  if (noPaint) {
    out.pattern = { ...d.pattern };
    delete out.pattern.paint;
  }
  if (emptyAssets) delete out.assets;
  if (noPattern) delete out.pattern;
  if (noMorph) {
    out.form = { ...d.form };
    delete out.form.morph;
  }
  return out;
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
  const layers = isObject(json.layers) ? json.layers : {};
  const rules = isObject(json.rules) ? json.rules : {};
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

  const angle = num(seam.angleDeg, 0);
  const out = {
    schema: DESIGN_SCHEMA,
    version: DESIGN_VERSION,
    units: 'mm',
    // Names come from files too, so keep them to a length every tile and file name can hold.
    meta: { ...structuredClone(meta), name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim().slice(0, 80) : D.meta.name },
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
      morph: normaliseMorph(form.morph),
    },
    pattern: null,
    layers: {
      beadWidthMm,
      layerHeightMm,
      seam: {
        rampPoints: num(seam.rampPoints, D.layers.seam.rampPoints, LIMITS.rampPoints, true),
        position: pick(seam.position, SEAM_POSITIONS, 'fixed'),
        angleDeg: angle - 360 * Math.floor(angle / 360),
      },
    },
    rules: {
      overhangLimitDeg: num(rules.overhangLimitDeg, D.rules.overhangLimitDeg, LIMITS.overhangLimitDeg),
      supportRatio: num(rules.supportRatio, D.rules.supportRatio, LIMITS.supportRatio),
      curveRatio: num(rules.curveRatio, D.rules.curveRatio, LIMITS.curveRatio),
    },
    base: {
      layers: basePairs(num(base.layers, D.base.layers, LIMITS.baseLayers, true)),
      pattern: pick(base.pattern, BASE_PATTERNS, 'spiral'),
      spacingRatio: num(base.spacingRatio, D.base.spacingRatio, LIMITS.spacingRatio),
      outline: base.outline !== false,
      hole: { diameter: num(hole.diameter, 0, LIMITS.holeDiameter) },
    },
    finish: {
      walls: finish.walls === 2 ? 2 : 1,
      wallSpacingMm: num(finish.wallSpacingMm, 0.9 * beadWidthMm, LIMITS.wallSpacingMm),
      innerWall: pick(finish.innerWall, INNER_WALLS, 'smooth'),
    },
    assets: normaliseAssets(json.assets),
  };
  // Last: its defaults depend on the rest (the bead width, the height).
  out.pattern = normalisePattern(json.pattern, out);
  return out;
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

/**
 * Deep equality of two designs, ignoring meta (name, id, dates). Empty
 * assets, a null morph and a null pattern equal their absence (compactDesign).
 */
export function designsEqual(a, b) {
  const { meta: _a, ...restA } = compactDesign(a);
  const { meta: _b, ...restB } = compactDesign(b);
  return deepEqual(restA, restB);
}

// Keeps the Pattern's range inside the height after the height changed.
function clampRanges(d) {
  const range = d.pattern;
  if (!range) return;
  const h = d.layers.layerHeightMm;
  range.toMm = Math.min(range.toMm, d.form.height);
  range.fromMm = Math.min(range.fromMm, Math.max(range.toMm - h, 0));
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
    clampRanges(d);
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
 * Sets the height, scaling every point height and the Pattern's range in proportion. Stops short of squeezing two points closer than a layer.
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
  if (d.pattern) {
    d.pattern.fromMm *= s;
    d.pattern.toMm *= s;
  }
  clampRanges(d);
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
