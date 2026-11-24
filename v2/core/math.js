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

// fdlibm atan: reduce |x| into one of five intervals around atan's known
// values, then a polynomial in x² on what is left.
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1,
  -1.11111104054623557880e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2,
  -3.65315727442169155270e-2, 1.62858201153657823623e-2,
];

/**
 * Arctangent with bit-identical results in every JavaScript engine.
 * @param {number} x
 * @returns {number} radians, in (−π/2, π/2)
 */
export function datan(x) {
  if (x !== x) return x;
  const negative = x < 0;
  let t = negative ? -x : x;
  if (t > 1e17) return negative ? -ATAN_HI[3] : ATAN_HI[3];
  let id = -1;
  if (t >= 0.4375) {
    if (t < 1.1875) {
      if (t < 0.6875) { id = 0; t = (2 * t - 1) / (2 + t); } else { id = 1; t = (t - 1) / (t + 1); }
    } else if (t < 2.4375) {
      id = 2; t = (t - 1.5) / (1 + 1.5 * t);
    } else {
      id = 3; t = -1 / t;
    }
  }
  const z = t * t;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return negative ? -(t - t * (s1 + s2)) : t - t * (s1 + s2);
  const r = ATAN_HI[id] - ((t * (s1 + s2) - ATAN_LO[id]) - t);
  return negative ? -r : r;
}

/**
 * Two-argument arctangent with bit-identical results in every engine.
 * @param {number} y @param {number} x
 * @returns {number} the angle of (x, y), radians in (−π, π]
 */
export function datan2(y, x) {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return PI / 2;
  if (y < 0) return -PI / 2;
  return 0;
}

/** @param {number} deg @returns {number} radians */
export function radians(deg) {
  return (deg * PI) / 180;
}

const LN2 = 0.6931471805599453;

/**
 * e^x from + − × ÷ only (range reduction by ln 2, then a Taylor polynomial),
 * so every engine gives the same bits. Accurate to about 1e-15 relative;
 * meant for blur weights and other smooth falloffs, not for long chains.
 * @param {number} x
 * @returns {number}
 */
export function dexp(x) {
  if (x !== x) return x;
  if (x < -745) return 0;
  if (x > 709) return Infinity;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let sum = 1;
  let term = 1;
  for (let n = 1; n <= 16; n++) {
    term = (term * r) / n;
    sum += term;
  }
  let scale = 1;
  if (k > 0) for (let i = 0; i < k; i++) scale *= 2;
  else for (let i = 0; i < -k; i++) scale /= 2;
  return sum * scale;
}
