// The footprint outline at a height (design §9.1, research §5.1).
//
// At profile radius r the outline has half-width a = r (X) and half-depth
// b = r · depthRatio (Y). A circle becomes an ellipse; a rectangle gets true
// circular corners of radius cornerRounding · min(a, b). Both scale with r, so
// the outline at every height is the same shape at a different size, and the
// unit outline (r = 1) is enough to place points and seams.
//
// Points are placed by normalised arc length u in [0, 1): u = 0 on the +X axis,
// counter-clockwise. Sampling by u spaces beads evenly on any footprint, where
// the polar angle would bunch them up at the ends of an ellipse (research §5.1).

import { PI, TAU, datan2, dcos, dsin } from './math.js';

// Ellipse arc length is tabulated at this many equal steps of the parametric
// angle; Simpson's rule per step keeps the table exact to well under a micron.
const ELLIPSE_STEPS = 1024;

function ellipseTable(ratio) {
  const n = ELLIPSE_STEPS;
  const dt = TAU / n;
  const speed = (t) => {
    const s = dsin(t);
    const c = dcos(t);
    return Math.sqrt(s * s + ratio * ratio * c * c);
  };
  const cumulative = new Float64Array(n + 1);
  let previous = speed(0);
  for (let k = 0; k < n; k++) {
    const mid = speed((k + 0.5) * dt);
    const next = speed((k + 1) * dt);
    cumulative[k + 1] = cumulative[k] + (dt / 6) * (previous + 4 * mid + next);
    previous = next;
  }
  return { cumulative, dt, perimeter: cumulative[n] };
}

// Parametric angle of the ellipse point at normalised arc length u.
function ellipseAngle(table, u) {
  const { cumulative, dt, perimeter } = table;
  const target = (u - Math.floor(u)) * perimeter;
  let lo = 0;
  let hi = ELLIPSE_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= target) lo = mid; else hi = mid;
  }
  const span = cumulative[lo + 1] - cumulative[lo];
  return (lo + (span > 0 ? (target - cumulative[lo]) / span : 0)) * dt;
}

// Rounded rectangle with half extents A, B and corner radius c, walked from
// (A, 0) counter-clockwise: right half-edge, corner, top, corner, left,
// corner, bottom, corner, right half-edge.
function roundedRectPoint(A, B, c, u, out) {
  const ex = A - c;
  const ey = B - c;
  const quarter = (PI * c) / 2;
  const perimeter = 4 * ex + 4 * ey + 2 * PI * c;
  let s = (u - Math.floor(u)) * perimeter;
  const corner = (cx, cy, start) => {
    const angle = start + (c > 0 ? s / c : 0);
    out[0] = cx + c * dcos(angle);
    out[1] = cy + c * dsin(angle);
  };
  if (s < ey) { out[0] = A; out[1] = s; return; }
  s -= ey;
  if (s < quarter) { corner(ex, ey, 0); return; }
  s -= quarter;
  if (s < 2 * ex) { out[0] = ex - s; out[1] = B; return; }
  s -= 2 * ex;
  if (s < quarter) { corner(-ex, ey, PI / 2); return; }
  s -= quarter;
  if (s < 2 * ey) { out[0] = -A; out[1] = ey - s; return; }
  s -= 2 * ey;
  if (s < quarter) { corner(-ex, -ey, PI); return; }
  s -= quarter;
  if (s < 2 * ex) { out[0] = -ex + s; out[1] = -B; return; }
  s -= 2 * ex;
  if (s < quarter) { corner(ex, -ey, 1.5 * PI); return; }
  s -= quarter;
  out[0] = A;
  out[1] = -ey + s;
}

/**
 * Builds the footprint for a design's form.plan.
 * @param {{ footprint: 'circle' | 'rectangle', depthRatio: number, cornerRounding: number }} plan
 */
export function createPlan(plan) {
  const ratio = plan.depthRatio;
  const rectangle = plan.footprint === 'rectangle';
  const rounding = plan.cornerRounding;
  const circle = !rectangle && ratio === 1;
  const table = rectangle || circle ? null : ellipseTable(ratio);

  // Corner radius of the outline with half extents a, b, offset inward by delta.
  const cornerOf = (a, b, delta) => Math.max(rounding * Math.min(a, b) - delta, 0);

  /**
   * Outline point at u for half extents a, b, offset inward by delta (negative
   * = outward). An ellipse offsets to (a − δ, b − δ); a rectangle to
   * (a − δ, b − δ) with corner max(ρ − δ, 0). Writes x, y into out.
   */
  function point(u, a, b, delta, out) {
    if (rectangle) {
      const c = cornerOf(a, b, delta);
      roundedRectPoint(Math.max(a - delta, c), Math.max(b - delta, c), c, u, out);
      return;
    }
    const t = circle ? TAU * (u - Math.floor(u)) : ellipseAngle(table, u);
    out[0] = Math.max(a - delta, 0) * dcos(t);
    out[1] = Math.max(b - delta, 0) * dsin(t);
  }

  /** Perimeter of the outline with half extents a, b, offset inward by delta. */
  function perimeter(a, b, delta) {
    if (rectangle) {
      const c = cornerOf(a, b, delta);
      const A = Math.max(a - delta, c);
      const B = Math.max(b - delta, c);
      return 4 * (A - c) + 4 * (B - c) + 2 * PI * c;
    }
    const A = Math.max(a - delta, 0);
    const B = Math.max(b - delta, 0);
    if (delta === 0 && table) return A * table.perimeter;
    // Ramanujan's approximation: plenty for spacing the base spiral.
    return PI * (3 * (A + B) - Math.sqrt((3 * A + B) * (A + 3 * B)));
  }

  const unit = new Float64Array(2);
  const angleAt = (u) => {
    point(u, 1, ratio, 0, unit);
    const angle = datan2(unit[1], unit[0]);
    return angle < 0 ? angle + TAU : angle;
  };

  /**
   * The u whose outline point lies at polar angle `radians` (outline
   * coordinates, before twist). The outline is star-shaped about the axis, so
   * the polar angle grows with u and a bisection finds it.
   */
  function uAtAngle(radians) {
    const target = radians - TAU * Math.floor(radians / TAU);
    if (circle) return target / TAU;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 48; k++) {
      const mid = (lo + hi) / 2;
      if (angleAt(mid) < target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // u at the middle of each rectangle corner, for the hidden seam.
  const cornerUs = [];
  if (rectangle) {
    const c = cornerOf(1, ratio, 0);
    const ex = 1 - c;
    const ey = ratio - c;
    const quarter = (PI * c) / 2;
    const total = 4 * ex + 4 * ey + 2 * PI * c;
    let s = ey + quarter / 2;
    for (const edge of [2 * ex, 2 * ey, 2 * ex, 0]) {
      cornerUs.push(s / total);
      s += quarter + edge;
    }
  }

  return {
    footprint: plan.footprint,
    ratio,
    /** Perimeter of the outline at r = 1; the outline at radius r is r times as long. */
    unitPerimeter: perimeter(1, ratio, 0),
    /** Outline point at u for profile radius 1 (scale x, y by r). */
    unitPoint: (u, out) => point(u, 1, ratio, 0, out),
    point,
    perimeter,
    uAtAngle,
    angleAt,
    cornerUs,
  };
}
