// Editing the size chip (issue #5). The chip shows the finished outer size,
// patterns and the bead included (design §8.5), while Shape's height, width
// and depth are the form's own sizes. An edit in the chip therefore moves the
// form's own size until the measured outer size lands on the typed number.
//
// Only the engine knows the outer size, so this works in passes: set the form
// size, wait for the next preview, measure, correct. Patterns add about the
// same millimetres at any size, so the first pass (slope 1) is usually within
// half a millimetre. A twist or a stretched footprint makes the outer box grow
// slower than the form, and later passes use the slope they measured. No DOM
// here, so the tests can drive it with the real engine.

import { setHeight, setWidth, setDepth, widestRadius } from '../core/design.js';

/** Close enough: the chip shows whole millimetres. */
export const SIZE_TOLERANCE_MM = 0.25;
const MAX_PASSES = 4;

/**
 * The three chip numbers: which outer size they show and which form size an
 * edit moves. `get` reads the form size, `set` writes it (with the setters'
 * own limits and rules). `tolerance(d)` is how close a fit can get.
 *
 * Patterns don't add height: the outer height is the form height rounded to
 * whole layers (the toolpath's layer count). So height takes the typed number
 * as it is, and it is as close as it gets within half a layer.
 */
export const SIZE_AXES = {
  height: {
    key: 'heightMm', name: 'Height', offset: false, get: (d) => d.form.height, set: setHeight,
    tolerance: (d) => d.layers.layerHeightMm / 2 + 1e-6,
  },
  width: {
    key: 'widthMm', name: 'Width', offset: true, get: (d) => 2 * widestRadius(d), set: setWidth,
    tolerance: () => SIZE_TOLERANCE_MM,
  },
  depth: {
    key: 'depthMm', name: 'Depth', offset: true, get: (d) => 2 * widestRadius(d) * (d.form.plan.depthRatio ?? 1), set: setDepth,
    tolerance: () => SIZE_TOLERANCE_MM,
  },
};

/**
 * Moves one form size until its measured outer size reaches `target`.
 * @param {object} o
 * @param {number} o.target outer size wanted, mm
 * @param {number} o.x the form size now
 * @param {number | null} o.m the outer size measured for x, or null to measure it first
 * @param {(x: number) => number} o.apply sets the form size and returns the size it really got (limits clamp it)
 * @param {() => Promise<number | null>} o.measure the outer size after the last apply; null means stop (cancelled)
 * @param {number} [o.tolerance] close enough, mm (the axis' own tolerance)
 * @param {number} [o.maxPasses]
 * @returns {Promise<{ x: number, m: number | null, passes: number }>}
 */
export async function fitOuterSize({ target, x, m, apply, measure, tolerance = SIZE_TOLERANCE_MM, maxPasses = MAX_PASSES }) {
  if (m == null) m = await measure();
  let prev = null;
  let passes = 0;
  while (m != null && passes < maxPasses && Math.abs(target - m) > tolerance) {
    let slope = 1;
    if (prev && Math.abs(x - prev.x) > 1e-9) {
      slope = Math.min(Math.max((m - prev.m) / (x - prev.x), 0.2), 5);
    }
    const next = apply(x + (target - m) / slope);
    passes += 1;
    // A limit stopped it: another pass can't get closer.
    if (Math.abs(next - x) < 1e-6) break;
    prev = { x, m };
    x = next;
    m = await measure();
  }
  return { x, m, passes };
}
