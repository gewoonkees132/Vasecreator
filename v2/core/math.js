// Deterministic maths for the toolpath core.
//
// Math.sin, Math.cos, Math.exp and Math.pow are implementation-approximated and
// differ between browsers, so the core never uses them (research §8.3). Everything
// here uses only + − × ÷ and Math.floor / round / abs / sqrt, which are exactly
// specified, so every engine produces the same bits.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;

// Arguments beyond this would make the two-part π/2 reduction lose precision.
const MAX_ARGUMENT = 1e5;

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0; // first 33 bits of π/2, so k · PIO2_1 is exact
const PIO2_1T = 6.07710050650619224932e-11; // π/2 − PIO2_1

// fdlibm kernel polynomials on [−π/4, π/4].
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kernelSin(y) {
  const z = y * y;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return y + z * y * (S1 + z * r);
}

function kernelCos(y) {
  const z = y * y;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - z * r);
}

function reduce(x) {
  if (!(Math.abs(x) <= MAX_ARGUMENT)) {
    throw new RangeError(`Angle out of range for deterministic trig: ${x}`);
  }
  const k = Math.round(x * INV_PIO2);
  return { y: x - k * PIO2_1 - k * PIO2_1T, quadrant: k & 3 };
}

/**
 * Sine with bit-identical results in every JavaScript engine.
 * @param {number} x angle in radians, |x| ≤ 1e5
 * @returns {number}
 */
export function dsin(x) {
  const { y, quadrant } = reduce(x);
  switch (quadrant) {
    case 0: return kernelSin(y);
    case 1: return kernelCos(y);
    case 2: return -kernelSin(y);
    default: return -kernelCos(y);
  }
}

/**
 * Cosine with bit-identical results in every JavaScript engine.
 * @param {number} x angle in radians, |x| ≤ 1e5
 * @returns {number}
 */
export function dcos(x) {
  const { y, quadrant } = reduce(x);
  switch (quadrant) {
    case 0: return kernelCos(y);
    case 1: return -kernelSin(y);
    case 2: return -kernelCos(y);
    default: return kernelSin(y);
  }
}

/** @param {number} x @returns {number} x − ⌊x⌋, in [0, 1) */
export function frac(x) {
  return x - Math.floor(x);
}

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** @param {number} a @param {number} b @param {number} t @returns {number} */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Hermite step from 0 at e0 to 1 at e1. Works with e0 > e1 for a falling step.
 * @param {number} e0 @param {number} e1 @param {number} x @returns {number}
 */
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
