// The shapes of the Pattern's Fade (D42, D54): how far a fade has gone at a
// height and a place around.

import { PI, dsin, smoothstep } from './math.js';

export const BLEND_SHAPES = ['even', 'fadesUp', 'fadesDown', 'middle', 'diagonal'];

/**
 * How far a fade has gone at t (0 at From, 1 at To) and u (around): 0 is
 * none, 1 the full amount (core/layer-pattern.js). Diagonal is a band that winds once round the
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
