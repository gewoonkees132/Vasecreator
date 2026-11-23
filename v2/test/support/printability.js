// Printability measures for tests, ahead of the core's own checks (research §7).
// They sample the outer wall layer by layer around a circle of the profile
// radius. Corners of rectangular footprints are left out; their arc length is
// longer than a circle's, so these measures stay on the cautious side.

import { TAU } from '../../core/math.js';
import { evaluatePattern } from '../../core/patterns.js';

export const REFERENCE_POT = { radiusMm: 45, beadWidthMm: 3, layerHeightMm: 1.5, overhangLimitDeg: 45 };

const SAMPLES_AROUND = 720;
const CURVATURE_STEP_MM = 0.25;

/**
 * Worst radial step between layers (V2) and worst in-layer curvature (V6).
 * @param {object} pot
 * @param {number} pot.heightMm
 * @param {(z: number) => number} pot.radiusAt profile radius at height z
 * @param {number} [pot.twistDeg] total twist; patterns follow it
 * @param {{ recipe: object, depthMm: number, repeats: number, tileHeightMm: number,
 *           weightAt: (z: number) => number }[]} pot.slots
 * @param {{ beadWidthMm: number, layerHeightMm: number }} process
 */
export function measureWall(pot, process) {
  const { heightMm, radiusAt, twistDeg = 0, slots } = pot;
  const h = process.layerHeightMm;

  const displacement = (u, z) => {
    const turn = u - (twistDeg / 360) * (z / heightMm);
    let d = 0;
    for (const s of slots) {
      const w = s.weightAt(z);
      if (w !== 0) d += w * s.depthMm * evaluatePattern(s.recipe, s.repeats * turn, z / s.tileHeightMm);
    }
    return d;
  };

  let step = { mm: 0, atMm: 0 };
  let curvature = { perMm: 0, atMm: 0 };
  const layers = Math.round(heightMm / h);
  for (let i = 0; i < layers; i++) {
    const z = (i + 0.5) * h;
    const r = radiusAt(z);
    const du = CURVATURE_STEP_MM / (TAU * r);
    const hasNext = i + 1 < layers;
    const rNext = hasNext ? radiusAt(z + h) : r;
    for (let j = 0; j < SAMPLES_AROUND; j++) {
      const u = j / SAMPLES_AROUND;
      const d = displacement(u, z);
      if (hasNext) {
        const s = Math.abs(rNext + displacement(u, z + h) - r - d);
        if (s > step.mm) step = { mm: s, atMm: z };
      }
      const bend = Math.abs(displacement(u + du, z) - 2 * d + displacement(u - du, z)) / (CURVATURE_STEP_MM * CURVATURE_STEP_MM);
      const k = bend + 1 / (r + d);
      if (k > curvature.perMm) curvature = { perMm: k, atMm: z };
    }
  }
  return { step, curvature };
}

/** Limits a wall must stay inside: the overhang limit (D8) and a bead-sized bend (research §7, V6). */
export function wallLimits({ beadWidthMm, layerHeightMm, overhangLimitDeg }) {
  return {
    stepMm: layerHeightMm * Math.tan((overhangLimitDeg * Math.PI) / 180),
    curvaturePerMm: 2 / beadWidthMm,
  };
}
