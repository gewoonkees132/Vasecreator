// How much of surface patterns A and B apply at each height (design doc §9.2).

import { PI, dsin, smoothstep } from './math.js';

export const BLEND_SHAPES = ['even', 'fadesUp', 'middle'];

/**
 * Length of the soft start and end of the surface pattern: at least two
 * layers, and long enough that the pattern grows by no more than half a layer
 * height per layer (a smoothstep's steepest slope is 1.5 × its average).
 * @param {number} depthMm deepest pattern depth
 * @param {number} layerHeightMm
 * @returns {number}
 */
export function softEdgeMm(depthMm, layerHeightMm) {
  return Math.max(2 * layerHeightMm, 3 * depthMm);
}

function blendShape(shape, t) {
  if (shape === 'even') return 1;
  if (shape === 'fadesUp') return smoothstep(0, 1, t);
  if (shape === 'middle') {
    const s = dsin(PI * t);
    return s * s;
  }
  throw new RangeError(`Unknown blend shape: ${shape}`);
}

/**
 * Weights of pattern slots A and B at height z, soft edges included.
 * Slot B is null when blending is off (design doc §13).
 * @param {{ fromMm: number, toMm: number, a: { depthMm: number }, b: { depthMm: number } | null,
 *           blend: { shape: string, amount: number } }} surface
 * @param {number} zMm
 * @param {number} layerHeightMm
 * @returns {{ a: number, b: number }}
 */
export function surfaceWeights(surface, zMm, layerHeightMm) {
  const { fromMm, toMm, a, b, blend } = surface;
  if (zMm <= fromMm || zMm >= toMm) return { a: 0, b: 0 };
  const deepest = Math.max(a.depthMm, b ? b.depthMm : 0);
  const edge = softEdgeMm(deepest, layerHeightMm);
  const gate = smoothstep(fromMm, fromMm + edge, zMm) * smoothstep(toMm, toMm - edge, zMm);
  if (!b) return { a: gate, b: 0 };
  const w = blend.amount * blendShape(blend.shape, (zMm - fromMm) / (toMm - fromMm));
  return { a: gate * (1 - w), b: gate * w };
}
