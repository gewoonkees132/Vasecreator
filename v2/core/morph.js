// Geometry morph (design §9.6, D23): a soft map that reshapes the whole form
// before patterns are applied.
//
// A map is evaluated at (x, v): x = repeats · u around the pot (u on the
// outline, as for patterns, so it follows the twist) and v = z / H over the
// full height, 0 at the base and 1 at the rim, without repeating. It gives
// −1…1, and the radial push is strengthMm × blend × value, added to the
// profile radius before the footprint, the pattern and the minimum-radius
// clamp (core/toolpath.js). Every map is periodic in x with period 1, so
// whole repeats meet with no seam. Image maps are blurred by softnessMm (as
// σ = softness / 2, converted to texels per axis) and sampled bilinearly,
// wrapping around and clamped in v. Maths from core/math.js only.
//
// Facets (D69) are the exception: flat faces calculated from the profile
// itself (createFacets), so they stay flat when the shape changes. Their
// push is in mm and doesn't use the strength; the swatch shows them on a
// plain cylinder (SHAPES).

import { PI, TAU, dcos, dsin, smoothstep } from './math.js';
import { preparedRaster } from './raster.js';
import { createProfile } from './profile.js';

export const FACETS_MAP = 'lib:facets@1';

export const MORPH_MAPS = Object.freeze([
  Object.freeze({ id: 'lib:lobes@1', name: 'Lobes' }),
  Object.freeze({ id: 'lib:lean@1', name: 'Lean' }),
  Object.freeze({ id: 'lib:waist@1', name: 'Waist' }),
  Object.freeze({ id: 'lib:swirl@1', name: 'Swirl' }),
  Object.freeze({ id: 'lib:blobs@1', name: 'Blobs' }),
  Object.freeze({ id: FACETS_MAP, name: 'Facets' }),
]);

/** Defaults for a new morph (design §13). */
export const MORPH_DEFAULTS = Object.freeze({ map: 'lib:lobes@1', softnessMm: 24, strengthMm: 16, repeats: 4, blend: 0.8 });

/**
 * The Facets layout a new Facets morph starts with (D69): 4 staggered rows,
 * half irregular, a 20 mm round band at the rim. Facets around is the
 * morph's repeats (at least FACETS_MIN_AROUND), the edges' rounding its softness.
 */
export const FACETS_DEFAULTS = Object.freeze({ rows: 4, stagger: true, irregularity: 0.5, seed: 1, rimMm: 20 });
/** What picking Facets sets besides the layout: 6 around, edges rounded 2 mm, all of it. */
export const FACETS_START = Object.freeze({ repeats: 6, softnessMm: 2, blend: 1 });
export const FACETS_MIN_AROUND = 3;

// Integer hash to [0, 1): a fixed pseudo-random layout, never Math.random.
function hash01(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * A fixed share 0…1 for a face of the Facets layout and its Shuffle seed:
 * where the face's slant lies between Slant and To (D71).
 */
export function facetShare(face, seed) {
  return hash01(face * 131 + Math.round(seed) * 7919 + 17);
}

// Blobs: five soft bumps per repeat, in and out, at fixed places.
const BLOBS = [];
for (let k = 0; k < 5; k++) {
  BLOBS.push({
    x: (k + 0.6 * hash01(4 * k + 1)) / 5,
    v: 0.15 + 0.7 * hash01(4 * k + 2),
    rx: 0.16 + 0.08 * hash01(4 * k + 3),
    rv: 0.14 + 0.08 * hash01(4 * k + 4),
    sign: k & 1 ? -1 : 1,
  });
}

function blobs(x, v) {
  let s = 0;
  for (let k = 0; k < BLOBS.length; k++) {
    const b = BLOBS[k];
    let dx = x - b.x;
    dx -= Math.round(dx);
    const qx = dx / b.rx;
    const qv = (v - b.v) / b.rv;
    const q = qx * qx + qv * qv;
    if (q < 1) {
      const t = 1 - q;
      s += b.sign * t * t;
    }
  }
  return s > 1 ? 1 : s < -1 ? -1 : s;
}

/**
 * Flat faces round a form (D69). Each face is a plane tangent to the form at
 * a point (its centre) in `rows` rows of `around`, moved in by cos(π/around)
 * so the edges between faces lie about on the form and the faces sink in.
 * The radius at (z, θ) is the nearest plane along the ray from the axis,
 * among the faces of the row z lies in and the rows next to it (so a plane
 * never cuts a neck far above its own row), with the edges rounded by a
 * smooth minimum `softnessMm` wide. The push is that radius less the form's,
 * times `blend`, fading to round over `rimMm` below the rim.
 * @param {(z: number) => number} radiusAt the form's radius, z in 0…H
 * @param {number} H
 * @param {{ around: number, rows: number, stagger: boolean, irregularity: number, seed: number,
 *   rimMm: number, softnessMm: number, blend: number }} o
 * @returns {{ at(z: number, u: number): number, facetAt(z: number, u: number): number, faces: number }}
 *   u is the share of a turn (θ = 2πu); facetAt gives the face whose plane is nearest, row · around + i
 */
export function createFacets(radiusAt, H, o) {
  const n = Math.max(FACETS_MIN_AROUND, Math.round(o.around));
  const rows = Math.max(1, Math.round(o.rows));
  const rowH = H / rows;
  const inset = dcos(PI / n);
  const seed = Math.round(o.seed) * 7919;
  const irr = o.irregularity;
  const slopeAt = (z) => {
    const dz = Math.min(1, H / 4);
    const lo = Math.max(z - dz, 0);
    const hi = Math.min(z + dz, H);
    return hi > lo ? (radiusAt(hi) - radiusAt(lo)) / (hi - lo) : 0;
  };
  // Rows only exist where the faces lean out less from row to row going up
  // (a barrel): on a straight or hollow wall every row's planes would run
  // on into the others and the rows would merge into one ring. So a row's
  // faces lean at least `drop` less than the row below, a lean whose row
  // edges sit a quarter of the faces' depth in, centred so that on a shape
  // that already bulges enough nothing changes.
  const lean = new Float64Array(rows);
  if (rows > 1) {
    let mean = 0;
    for (let j = 0; j < rows; j++) mean += radiusAt(rowH * (j + 0.5)) / rows;
    const drop = ((1 - inset) * mean) / rowH;
    let prev = Infinity;
    let added = 0;
    for (let j = 0; j < rows; j++) {
      const own = slopeAt(rowH * (j + 0.5));
      lean[j] = Math.min(own, prev - drop);
      prev = lean[j];
      lean[j] -= own;
      added += lean[j] / rows;
    }
    for (let j = 0; j < rows; j++) lean[j] -= added;
  }
  const faces = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < n; i++) {
      const k = seed + j * 1009 + i * 31;
      const zc = Math.min(Math.max(rowH * (j + 0.5) + irr * 0.3 * rowH * (2 * hash01(k + 1) - 1), 0), H);
      const th = (TAU * (i + (o.stagger && j % 2 === 1 ? 0.5 : 0) + irr * 0.35 * (2 * hash01(k + 2) - 1))) / n;
      faces.push({ row: j, zc, r: inset * radiusAt(zc), slope: inset * (slopeAt(zc) + lean[j]), c: dcos(th), s: dsin(th) });
    }
  }
  const soft = Math.max(o.softnessMm, 0);
  const rim = Math.max(o.rimMm, 0);
  const blend = o.blend;

  // The nearest plane along the ray (and the next nearest, for the rounding).
  let best = 0;
  let second = 0;
  let bestFace = -1;
  function nearest(z, u) {
    const zz = z < 0 ? 0 : z > H ? H : z;
    const row = Math.min(rows - 1, Math.max(0, Math.floor(zz / rowH)));
    const a = TAU * (u - Math.floor(u));
    const ca = dcos(a);
    const sa = dsin(a);
    best = Infinity;
    second = Infinity;
    bestFace = -1;
    for (let j = Math.max(0, row - 1); j <= Math.min(rows - 1, row + 1); j++) {
      for (let i = 0; i < n; i++) {
        const f = faces[j * n + i];
        const cos = ca * f.c + sa * f.s;
        if (cos < 0.05) continue;
        const rho = (f.r + f.slope * (zz - f.zc)) / cos;
        if (rho < best) { second = best; best = rho; bestFace = j * n + i; } else if (rho < second) second = rho;
      }
    }
    return zz;
  }

  return {
    faces: faces.length,
    at(z, u) {
      const zz = nearest(z, u);
      if (bestFace < 0) return 0;
      let rho = best;
      if (soft > 0 && second - best < soft) {
        const t = (soft - (second - best)) / soft;
        rho -= (t * t * soft) / 4;
      }
      let push = blend * (rho - radiusAt(zz));
      if (rim > 0 && zz > H - rim) push *= smoothstep(H, H - rim, zz);
      return push;
    },
    facetAt(z, u) {
      nearest(z, u);
      return bestFace;
    },
  };
}

// The Facets swatch: one face per repeat on a plain cylinder of radius 1,
// three staggered rows, regular; −1 at a face's centre, 1 on its edges.
const SWATCH_AROUND = 6;
const SWATCH_INSET = 1 - dcos(PI / SWATCH_AROUND);
const swatchFacets = createFacets(() => 1, 4.5, {
  around: SWATCH_AROUND, rows: 3, stagger: true, irregularity: 0, seed: 0, rimMm: 0, softnessMm: 0, blend: 1,
});
function facetsSwatch(x, v) {
  const value = 1 + (2 * swatchFacets.at(v * 4.5, x / SWATCH_AROUND)) / SWATCH_INSET;
  return value > 1 ? 1 : value < -1 ? -1 : value;
}

const SHAPES = {
  'lib:lobes@1': (x) => dcos(TAU * x),
  'lib:lean@1': (x, v) => dcos(TAU * x) * v,
  'lib:waist@1': (x, v) => {
    const s = dsin(PI * v);
    return -s * s;
  },
  'lib:swirl@1': (x, v) => dcos(TAU * (x + 0.5 * v)),
  'lib:blobs@1': blobs,
  [FACETS_MAP]: facetsSwatch,
};

// Bumps around per repeat, for the points per layer.
const FEATURES = { 'lib:lobes@1': 1, 'lib:lean@1': 1, 'lib:waist@1': 0, 'lib:swirl@1': 1, 'lib:blobs@1': 3, [FACETS_MAP]: 1 };

/** Whether id names a built-in morph map. */
export function isMorphMap(id) {
  return Object.hasOwn(SHAPES, id);
}

/**
 * Value of a built-in map.
 * @param {string} id one of MORPH_MAPS
 * @param {number} x position around, in repeats (wraps)
 * @param {number} v height share, 0 at the base and 1 at the rim (clamped)
 * @returns {number} −1…1
 */
export function evaluateMorphMap(id, x, v) {
  const shape = SHAPES[id];
  if (!shape) throw new RangeError(`Unknown morph map: ${id}`);
  const vv = v < 0 ? 0 : v > 1 ? 1 : v;
  return shape(x - Math.floor(x), vv);
}

/**
 * The morph of a design, ready to evaluate, or null when it has none.
 * @param {object} design a normalised design
 * @param {{ images?: Map<string, object>, perimeterMm: number }} options perimeterMm at the widest radius
 * @returns {null | { amplitude: number, repeats: number, featuresAround: number, missingImage: boolean,
 *   at(z: number, u: number): number, facetAt?(z: number, u: number): number }} at() is the radial
 *   push in mm; Facets add facetAt(), the face at (z, u) (D71)
 */
export function createMorph(design, { images, perimeterMm }) {
  const morph = design.form.morph;
  if (!morph) return null;
  const H = design.form.height;
  const repeats = morph.repeats;
  if (morph.map === FACETS_MAP) {
    if (!(morph.blend > 0)) return null;
    const profile = createProfile(design.form.profile);
    const f = { ...FACETS_DEFAULTS, ...(morph.facets || {}) };
    const facets = createFacets(profile.at, H, {
      around: repeats, rows: f.rows, stagger: f.stagger, irregularity: f.irregularity, seed: f.seed,
      rimMm: f.rimMm, softnessMm: morph.softnessMm, blend: morph.blend,
    });
    // The largest push, in or out, sampled: for the points a layer needs.
    let amplitude = 0;
    for (let a = 0; a <= 48; a++) {
      for (let b = 0; b < 192; b++) {
        const p = Math.abs(facets.at((H * a) / 48, b / 192));
        if (p > amplitude) amplitude = p;
      }
    }
    if (!(amplitude > 0)) return null;
    return {
      amplitude, repeats: Math.max(FACETS_MIN_AROUND, repeats), featuresAround: 1, missingImage: false,
      at: facets.at, facetAt: facets.facetAt,
    };
  }
  const amplitude = morph.strengthMm * morph.blend;
  if (!(amplitude > 0)) return null;
  if (isMorphMap(morph.map)) {
    const shape = SHAPES[morph.map];
    return {
      amplitude, repeats, featuresAround: FEATURES[morph.map], missingImage: false,
      at(z, u) {
        const x = repeats * u;
        const v = z / H;
        return amplitude * shape(x - Math.floor(x), v < 0 ? 0 : v > 1 ? 1 : v);
      },
    };
  }
  const asset = design.assets?.[morph.map];
  const hash = asset?.kind === 'image' ? asset.hash : String(morph.map).slice(4);
  const raster = String(morph.map).startsWith('img:') ? images?.get?.(hash) : undefined;
  if (!raster) return { amplitude: 0, repeats, featuresAround: 0, missingImage: String(morph.map).startsWith('img:'), at: () => 0 };
  const sigmaMm = morph.softnessMm / 2;
  const tileWidthMm = Math.max(perimeterMm / repeats, 1e-6);
  const image = preparedRaster(raster, (sigmaMm * raster.width) / tileWidthMm, (sigmaMm * raster.height) / H, false);
  return {
    amplitude, repeats, featuresAround: Math.max(1, image.features.around), missingImage: false,
    at: (z, u) => amplitude * image.sample(repeats * u, z / H),
  };
}
