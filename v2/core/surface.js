// How much of the Detailed morph's slots A and B apply at each height
// (design doc §9.2; D35, D42). The Detailed morph is design.form.detail.

import { PI, dsin, smoothstep } from './math.js';

export const BLEND_SHAPES = ['even', 'fadesUp', 'fadesDown', 'middle'];

/**
 * Length of the soft start and end of the Detailed morph: at least two
 * layers, and long enough that it grows by no more than half a layer
 * height per layer (a smoothstep's steepest slope is 1.5 × its average).
 * @param {number} depthMm deepest slot depth
 * @param {number} layerHeightMm
 * @returns {number}
 */
export function softEdgeMm(depthMm, layerHeightMm) {
  return Math.max(2 * layerHeightMm, 3 * depthMm);
}

/**
 * How far a blend has gone at t (0 at From, 1 at To): 0 is all A, 1 all B
 * at full amount. The same words as the Pattern's Fade (core/layer-pattern.js).
 * @param {string} shape one of BLEND_SHAPES
 * @param {number} t
 */
export function blendShape(shape, t) {
  if (shape === 'even') return 1;
  if (shape === 'fadesUp') return smoothstep(0, 1, t);
  if (shape === 'fadesDown') return smoothstep(0, 1, 1 - t);
  if (shape === 'middle') {
    const s = dsin(PI * t);
    return s * s;
  }
  throw new RangeError(`Unknown blend shape: ${shape}`);
}

/**
 * Weights of slots A and B at height z, soft edges included.
 * Slot B is null when blending is off (design doc §13).
 * @param {{ fromMm: number, toMm: number, a: { depthMm: number }, b: { depthMm: number } | null,
 *           blend: { shape: string, amount: number } }} detail
 * @param {number} zMm
 * @param {number} layerHeightMm
 * @returns {{ a: number, b: number }}
 */
export function detailWeights(detail, zMm, layerHeightMm) {
  const { fromMm, toMm, a, b, blend } = detail;
  if (zMm <= fromMm || zMm >= toMm) return { a: 0, b: 0 };
  const deepest = Math.max(a.depthMm, b ? b.depthMm : 0);
  const edge = softEdgeMm(deepest, layerHeightMm);
  const gate = smoothstep(fromMm, fromMm + edge, zMm) * smoothstep(toMm, toMm - edge, zMm);
  if (!b) return { a: gate, b: 0 };
  const w = blend.amount * blendShape(blend.shape, (zMm - fromMm) / (toMm - fromMm));
  return { a: gate * (1 - w), b: gate * w };
}
