// The profile curve r(z): the pot's radius as a function of height (design §9.1, §9.5).
//
// z is strictly increasing along the knots, so r is single-valued in z and the
// wall can never fold under itself. The curve is compiled once into pieces with
// precomputed coefficients; evaluating it is then a table walk and a few
// multiplications, cheap enough to call for every toolpath point.
//
//   'catmullRomCentripetal' (shown as Smooth): cubic Hermite through the knots.
//   'monotone': Fritsch–Carlson, never overshoots between knots.
//   'linear' (shown as Angular): straight segments with true tangent-arc corners.

import { clamp } from './math.js';

const LINE = 0;
const CUBIC = 1;
const ARC = 2;

// Hermite tangents dr/dz for the Smooth curve. Interior knots use the
// Catmull-Rom chord, scaled by 2 × tension so 0.5 is the classic curve (and v1's
// slider). End knots take the secant to their neighbour, the same as a
// mirrored phantom knot: the curve leaves the base and meets the rim no
// steeper than the straight line to the next knot. (The natural end condition,
// (3·secant − m) / 2, steepens the base flare enough to lean past 45° on the
// Classic vase.)
function smoothTangents(knots, tension) {
  const n = knots.length;
  const m = new Float64Array(n);
  if (n === 2) {
    m[0] = m[1] = (knots[1].r - knots[0].r) / (knots[1].z - knots[0].z);
    return m;
  }
  for (let i = 1; i < n - 1; i++) {
    m[i] = (2 * tension * (knots[i + 1].r - knots[i - 1].r)) / (knots[i + 1].z - knots[i - 1].z);
  }
  const s0 = (knots[1].r - knots[0].r) / (knots[1].z - knots[0].z);
  const sn = (knots[n - 1].r - knots[n - 2].r) / (knots[n - 1].z - knots[n - 2].z);
  m[0] = s0;
  m[n - 1] = sn;
  return m;
}

// Fritsch–Carlson: start from the mean secant, zero it at local extremes, then
// shrink any pair of tangents that would make the cubic overshoot.
function monotoneTangents(knots) {
  const n = knots.length;
  const s = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) s[i] = (knots[i + 1].r - knots[i].r) / (knots[i + 1].z - knots[i].z);
  const m = new Float64Array(n);
  m[0] = s[0];
  m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / s[i];
    const b = m[i + 1] / s[i];
    const q = a * a + b * b;
    if (q > 9) {
      const tau = 3 / Math.sqrt(q);
      m[i] = tau * a * s[i];
      m[i + 1] = tau * b * s[i];
    }
  }
  return m;
}

function hermitePieces(knots, m, out) {
  for (let i = 0; i < knots.length - 1; i++) {
    const z0 = knots[i].z;
    const dz = knots[i + 1].z - z0;
    const p0 = knots[i].r;
    const p1 = knots[i + 1].r;
    const m0 = m[i] * dz;
    const m1 = m[i + 1] * dz;
    out.push({
      type: CUBIC, z0, z1: knots[i + 1].z, inv: 1 / dz,
      c0: p0, c1: m0, c2: 3 * (p1 - p0) - 2 * m0 - m1, c3: 2 * (p0 - p1) + m0 + m1,
    });
  }
}

// Straight segments in the (z, r) plane, each interior corner replaced by a
// circular arc tangent to both segments. The tangent length is clamped to half
// of each neighbouring segment, so neighbouring fillets can meet but never
// overlap. Both segments rise in z, so the arc between them does too and r
// stays a function of z.
function linearPieces(knots, cornerMm, out) {
  const n = knots.length;
  // Tangent points: where each knot's fillet starts and ends (the knot itself without one).
  const starts = [];
  const ends = [];
  const arcs = [];
  for (let i = 0; i < n; i++) {
    const k = knots[i];
    starts.push({ z: k.z, r: k.r });
    ends.push({ z: k.z, r: k.r });
    arcs.push(null);
    if (i === 0 || i === n - 1) continue;
    const radius = k.corner ?? cornerMm;
    if (!(radius > 0)) continue;
    const p = knots[i - 1];
    const q = knots[i + 1];
    const l1 = Math.sqrt((k.z - p.z) * (k.z - p.z) + (k.r - p.r) * (k.r - p.r));
    const l2 = Math.sqrt((q.z - k.z) * (q.z - k.z) + (q.r - k.r) * (q.r - k.r));
    const d1z = (k.z - p.z) / l1;
    const d1r = (k.r - p.r) / l1;
    const d2z = (q.z - k.z) / l2;
    const d2r = (q.r - k.r) / l2;
    const cross = d1z * d2r - d1r * d2z;
    const dot = d1z * d2z + d1r * d2r;
    const sine = Math.abs(cross);
    if (sine < 1e-9) continue; // straight through: nothing to round
    // tan(φ/2) = sin φ / (1 + cos φ), φ the turning angle.
    const halfTan = sine / (1 + dot);
    const tangent = Math.min(radius * halfTan, l1 / 2, l2 / 2);
    const rho = tangent / halfTan;
    const t1 = { z: k.z - d1z * tangent, r: k.r - d1r * tangent };
    const t2 = { z: k.z + d2z * tangent, r: k.r + d2r * tangent };
    // The centre lies on the inside of the turn, one radius from t1 along d1's normal.
    const side = cross > 0 ? 1 : -1;
    const cz = t1.z - side * d1r * rho;
    const cr = t1.r + side * d1z * rho;
    starts[i] = t1;
    ends[i] = t2;
    arcs[i] = { cz, cr, rho, sign: cross > 0 ? -1 : 1 };
  }
  for (let i = 0; i < n; i++) {
    if (arcs[i]) {
      const a = arcs[i];
      out.push({ type: ARC, z0: starts[i].z, z1: ends[i].z, c0: a.cz, c1: a.cr, c2: a.rho * a.rho, c3: a.sign });
    }
    if (i < n - 1) {
      const from = ends[i];
      const to = starts[i + 1];
      const dz = to.z - from.z;
      if (dz > 0) out.push({ type: LINE, z0: from.z, z1: to.z, c0: from.r, c1: (to.r - from.r) / dz, c2: 0, c3: 0 });
    }
  }
}

/**
 * Compiles a profile into a fast r(z) evaluator.
 * @param {{ interp: string, tension: number, cornerMm?: number,
 *           knots: { z: number, r: number, corner?: number }[] }} profile knots sorted, z strictly increasing
 * @returns {{ at(z: number): number, heightMm: number, knots: object[] }}
 *   at() clamps z to [0, height] and returns the radius in mm
 */
export function createProfile(profile) {
  const knots = profile.knots;
  const pieces = [];
  if (profile.interp === 'linear') linearPieces(knots, profile.cornerMm ?? 0, pieces);
  else if (profile.interp === 'monotone') hermitePieces(knots, monotoneTangents(knots), pieces);
  else hermitePieces(knots, smoothTangents(knots, profile.tension ?? 0.5), pieces);

  const count = pieces.length;
  const type = new Uint8Array(count);
  const z0 = new Float64Array(count);
  const z1 = new Float64Array(count);
  const inv = new Float64Array(count);
  const c = new Float64Array(count * 4);
  pieces.forEach((p, i) => {
    type[i] = p.type;
    z0[i] = p.z0;
    z1[i] = p.z1;
    inv[i] = p.inv ?? 0;
    c[4 * i] = p.c0;
    c[4 * i + 1] = p.c1;
    c[4 * i + 2] = p.c2;
    c[4 * i + 3] = p.c3;
  });
  const bottom = knots[0].z;
  const top = knots[knots.length - 1].z;
  let last = 0; // toolpath queries climb slowly, so the last piece is the best first guess

  function at(zIn) {
    const z = clamp(zIn, bottom, top);
    let i = last;
    while (i > 0 && z < z0[i]) i--;
    while (i < count - 1 && z > z1[i]) i++;
    last = i;
    const k = 4 * i;
    if (type[i] === CUBIC) {
      const t = (z - z0[i]) * inv[i];
      return c[k] + t * (c[k + 1] + t * (c[k + 2] + t * c[k + 3]));
    }
    if (type[i] === LINE) return c[k] + c[k + 1] * (z - z0[i]);
    const dz = z - c[k];
    return c[k + 1] + c[k + 3] * Math.sqrt(Math.max(0, c[k + 2] - dz * dz));
  }

  return { at, heightMm: top, knots };
}

/**
 * The evaluated curve as r,z pairs from the bottom to the top, about one pair
 * per stepMm and exactly one at every knot height (for the handle overlay).
 * On an Angular profile with corners the curve passes inside the knots.
 * @param {object} profile as for createProfile, or an already compiled profile
 * @param {number} [stepMm]
 * @returns {Float32Array} r0, z0, r1, z1, …
 */
export function profileLine(profile, stepMm = 1) {
  const curve = typeof profile.at === 'function' ? profile : createProfile(profile);
  const knots = curve.knots;
  const values = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const za = knots[i].z;
    const zb = knots[i + 1].z;
    const steps = Math.max(1, Math.ceil((zb - za) / stepMm));
    for (let s = 0; s < steps; s++) {
      const z = s === 0 ? za : za + ((zb - za) * s) / steps;
      values.push(curve.at(z), z);
    }
  }
  const lastKnot = knots[knots.length - 1];
  values.push(curve.at(lastKnot.z), lastKnot.z);
  return Float32Array.from(values);
}
