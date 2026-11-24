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

import { PI, TAU, dcos, dsin } from './math.js';
import { preparedRaster } from './raster.js';

export const MORPH_MAPS = Object.freeze([
  Object.freeze({ id: 'lib:lobes@1', name: 'Lobes' }),
  Object.freeze({ id: 'lib:lean@1', name: 'Lean' }),
  Object.freeze({ id: 'lib:waist@1', name: 'Waist' }),
  Object.freeze({ id: 'lib:swirl@1', name: 'Swirl' }),
  Object.freeze({ id: 'lib:blobs@1', name: 'Blobs' }),
]);

/** Defaults for a new morph (design §13). */
export const MORPH_DEFAULTS = Object.freeze({ map: 'lib:lobes@1', softnessMm: 24, strengthMm: 16, repeats: 4, blend: 0.8 });

// Integer hash to [0, 1): a fixed pseudo-random layout, never Math.random.
function hash01(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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

const SHAPES = {
  'lib:lobes@1': (x) => dcos(TAU * x),
  'lib:lean@1': (x, v) => dcos(TAU * x) * v,
  'lib:waist@1': (x, v) => {
    const s = dsin(PI * v);
    return -s * s;
  },
  'lib:swirl@1': (x, v) => dcos(TAU * (x + 0.5 * v)),
  'lib:blobs@1': blobs,
};

// Bumps around per repeat, for the points per layer.
const FEATURES = { 'lib:lobes@1': 1, 'lib:lean@1': 1, 'lib:waist@1': 0, 'lib:swirl@1': 1, 'lib:blobs@1': 3 };

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
 *   at(z: number, u: number): number }} at() is the radial push in mm
 */
export function createMorph(design, { images, perimeterMm }) {
  const morph = design.form.morph;
  if (!morph) return null;
  const amplitude = morph.strengthMm * morph.blend;
  if (!(amplitude > 0)) return null;
  const H = design.form.height;
  const repeats = morph.repeats;
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
