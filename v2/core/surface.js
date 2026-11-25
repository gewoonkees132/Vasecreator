// How much of the Detailed morph's slots A and B apply at each point
// (design doc §9.2; D35, D42, D54). The Detailed morph is design.form.detail.

import { PI, dsin, smoothstep } from './math.js';

export const BLEND_SHAPES = ['even', 'fadesUp', 'fadesDown', 'middle', 'diagonal'];

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
 * How far a blend has gone at t (0 at From, 1 at To) and u (around): 0 is
 * all A, 1 all B at full amount. The same words as the Pattern's Fade
 * (core/layer-pattern.js). Diagonal is a band that winds once round the
 * pot over From–To, sin²(π(t + u)) (D54); the others don't depend on u.
 * @param {string} shape one of BLEND_SHAPES
 * @param {number} t
 * @param {number} [u]
 */
export function blendShape(shape, t, u = 0) {
  if (shape === 'even') return 1;
  if (shape === 'fadesUp') return smoothstep(0, 1, t);
  if (shape === 'fadesDown') return smoothstep(0, 1, 1 - t);
  if (shape === 'middle') {
    const s = dsin(PI * t);
    return s * s;
  }
  if (shape === 'diagonal') {
    const s = dsin(PI * (t + u));
    return s * s;
  }
  throw new RangeError(`Unknown blend shape: ${shape}`);
}

/**
 * The soft start and end of the Detailed morph at height z: 0 outside
 * From–To, 1 once past the soft edges.
 * @param {{ fromMm: number, toMm: number, a: { depthMm: number }, b: { depthMm: number } | null }} detail
 * @param {number} zMm
 * @param {number} layerHeightMm
 */
export function detailGate(detail, zMm, layerHeightMm) {
  const { fromMm, toMm, a, b } = detail;
  if (zMm <= fromMm || zMm >= toMm) return 0;
  const edge = softEdgeMm(Math.max(a.depthMm, b ? b.depthMm : 0), layerHeightMm);
  return smoothstep(fromMm, fromMm + edge, zMm) * smoothstep(toMm, toMm - edge, zMm);
}

/**
 * Weights of slots A and B at height z and position u around, soft edges
 * included. Slot B is null when blending is off (design doc §13).
 * @param {{ fromMm: number, toMm: number, a: { depthMm: number }, b: { depthMm: number } | null,
 *           blend: { shape: string, amount: number } }} detail
 * @param {number} zMm
 * @param {number} layerHeightMm
 * @param {number} [u] around, only Diagonal uses it
 * @returns {{ a: number, b: number }}
 */
export function detailWeights(detail, zMm, layerHeightMm, u = 0) {
  const gate = detailGate(detail, zMm, layerHeightMm);
  if (gate === 0) return { a: 0, b: 0 };
  if (!detail.b) return { a: gate, b: 0 };
  const { fromMm, toMm, blend } = detail;
  const w = blend.amount * blendShape(blend.shape, (zMm - fromMm) / (toMm - fromMm), u);
  return { a: gate * (1 - w), b: gate * w };
}
