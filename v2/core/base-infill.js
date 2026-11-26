// The floor inside the base ring (design §9.4, docs/design/v2-base-infill.md):
// one path per base layer that covers the floor once and leaves no way
// through for water. Three infills share the same sealing rules:
//
//   Overlap   the infill starts with a closed lap beside the ring, on average
//             a quarter bead into it, so the floor is welded to the wall.
//   Stagger   that lap sits half a spacing further in on every other layer,
//             and the tracks inside it with it, so a bead lies over each
//             groove of the layer below. Lines turn 90° per layer instead.
//   Closed    the path ends with a closed lap round the hole, or round the
//   middle    middle of the floor, so neither is the loose end of a bead.
//
// Everything here is in the footprint's own frame (before the twist) and is
// built going inward from the seam; the toolpath runs it backward on the
// layers that print from the middle out.

import { TAU, datan2, dcos, dsin, frac } from './math.js';

/** The infills of base.pattern. */
export const BASE_PATTERNS = Object.freeze(['spiral', 'rings', 'lines']);

/** How far the lap beside the ring overlaps it, as a share of a bead, averaged over two layers. */
export const RING_OVERLAP = 0.25;

/** How far the ends of the lines run into the bead beside the ring, past its inner edge, as a share of a bead. */
export const TIP_OVERLAP = 0.25;

const hypot = (x, y) => Math.sqrt(x * x + y * y);

/**
 * The infill of one base layer.
 * @param {object} o
 * @param {'spiral' | 'rings' | 'lines'} o.pattern
 * @param {number} o.layer the base layer's index (the stagger and the lines' direction go by it)
 * @param {number} o.uS the seam's outline position
 * @param {number} o.w bead width
 * @param {number} o.step spacing between tracks
 * @param {number} o.pointStep spacing of points along a curve
 * @param {(u: number, delta: number, out: Float64Array) => void} o.curve the ring's centreline moved in by delta
 * @param {(delta: number) => number} o.perimeter its length
 * @param {number} o.centre the delta at which the outline closes on its middle
 * @param {number} o.holeMm drainage hole diameter, 0 for none (a round hole, whatever the footprint)
 * @param {(delta: number) => number[]} [o.corners] outline positions of that curve's corners, which the path must not cut
 * @param {number} [o.endU] outline position the path should end at (where the layer below ended)
 * @param {number[]} [o.endXY] the same as a point, for the lines
 * @returns {{ xy: number[], endU: number }} x, y pairs from beside the ring at
 *   the seam inward (empty when the ring alone fills the floor), and the
 *   outline position of the last point
 */
export function baseInfill(o) {
  const { w, step } = o;
  // The lap beside the ring: nearer on even layers, half a spacing further
  // in on odd ones, never past a bead width (the ring and it would part).
  const far = Math.min((1 - RING_OVERLAP) * w + step / 4, w);
  const near = Math.max(far - step / 2, w / 4);
  const first = o.layer % 2 === 1 ? far : near;
  // The innermost lap: its bead's edge on the hole, or a loop that just
  // closes over the middle.
  const inner = o.centre - (o.holeMm > 0 ? o.holeMm / 2 + w / 2 : step / 2);
  const out = [];
  const xy = new Float64Array(2);
  const t = { ...o, first, inner, out, xy, corners: o.corners || (() => []), holeR: o.holeMm > 0 ? o.holeMm / 2 + w / 2 : 0 };

  if (inner <= w / 4) return { xy: out, endU: o.uS };
  let endU;
  if (inner <= first) {
    // Room for one lap only.
    const laps = closing(o.uS, o.endU);
    trace(t, 0, laps, () => inner);
    endU = o.uS + laps;
  } else if (o.pattern === 'rings') {
    endU = rings(t);
  } else if (o.pattern === 'lines' && inner - first >= 1.5 * step) {
    endU = lines(t);
  } else {
    endU = spiral(t);
  }
  return { xy: dedupe(out), endU };
}

// Laps of the closing loop from outline position `from`: one, plus whatever
// brings the path to `endU`, so a layer printed outward starts right over
// the end of the layer below.
function closing(from, endU) {
  if (!Number.isFinite(endU)) return 1;
  const extra = frac(endU - from);
  return extra < 1e-6 || extra > 1 - 1e-6 ? 1 : 1 + extra;
}

// Points along the curve from lap p0 to p1 (laps counted from the seam),
// `deltaAt(p)` in from the ring: both ends, and points a pointStep apart.
function trace(t, p0, p1, deltaAt) {
  const { curve, perimeter, uS, pointStep, w, out, xy } = t;
  let p = p0;
  for (;;) {
    const delta = deltaAt(p);
    curve(uS + p, delta, xy);
    out.push(xy[0], xy[1]);
    if (p >= p1) break;
    // At least eight points a lap, however small the loop.
    let next = p + Math.min(pointStep / Math.max(perimeter(delta), w), 1 / 8);
    for (const c of t.corners(delta)) {
      const at = p + frac(c - uS - p);
      if (at > p + 1e-9 && at < next) next = at;
    }
    p = next > p1 - 1e-9 ? p1 : next;
  }
}

function dedupe(out) {
  const kept = [];
  for (let i = 0; i < out.length; i += 2) {
    const n = kept.length;
    if (n && Math.abs(kept[n - 2] - out[i]) < 1e-9 && Math.abs(kept[n - 1] - out[i + 1]) < 1e-9) continue;
    kept.push(out[i], out[i + 1]);
  }
  return kept;
}

// Spiral: a closed lap beside the ring, a spiral peeling off it one spacing
// a lap, and a closed lap where it arrives. Each closed lap is overlapped by
// the lap of spiral next to it, never left with a gap.
function spiral(t) {
  const { first, inner, step, uS } = t;
  const arrive = 1 + (inner - first) / step;
  const laps = closing(uS + arrive, t.endU);
  trace(t, 0, 1, () => first);
  trace(t, 1, arrive, (p) => first + step * (p - 1));
  trace(t, arrive, arrive + laps, () => inner);
  return aroundHole(t, uS + arrive + laps);
}

// Rings: closed laps one spacing apart, each joined to the next by a short
// slanting bead, so no groove runs from the wall to the middle. The slant
// differs between layers, so the joins don't stack.
function rings(t) {
  const { first, inner, step, perimeter, w } = t;
  const deltas = [];
  for (let d = first; d < inner - 1e-9; d += step) deltas.push(d);
  // A last lap close to the closing one moves halfway, sharing the overlap.
  const n = deltas.length;
  if (n > 1 && inner - deltas[n - 1] < step / 2) deltas[n - 1] = (deltas[n - 2] + inner) / 2;
  deltas.push(inner);
  const drift = (t.layer % 2 === 1 ? 3 : 1) * step;
  let p = 0;
  for (let j = 0; j < deltas.length; j++) {
    const last = j === deltas.length - 1;
    const laps = last ? closing(t.uS + p, t.endU) : 1;
    trace(t, p, p + laps, () => deltas[j]);
    p += laps;
    if (!last) p += Math.min(drift / Math.max(perimeter(deltas[j]), w), 0.25);
  }
  return aroundHole(t, t.uS + p);
}

// A round hole in a floor that isn't round: the laps stop where they first
// touch the hole, on the floor's narrow side, and the floor beside the hole
// on its long sides is still open. The hole gets a closed lap of its own,
// and the laps that would run through it are printed as arcs from the hole
// round and back to it, joined along the hole's lap. Returns the outline
// position the path ends at (not a number when it ends on the hole's lap).
function aroundHole(t, endU) {
  const { holeR: R, inner, centre, step, out, pointStep } = t;
  if (!(R > 0)) return endU;
  // On a round floor the last lap is the hole's lap already.
  const closingLap = polygon(t, inner, 24);
  let round = true;
  for (let i = 0; i < closingLap.M && round; i++) {
    round = Math.abs(hypot(closingLap.pts[2 * i], closingLap.pts[2 * i + 1]) - R) < 1e-6 * R;
  }
  if (round) return endU;
  const deltas = [];
  const last = centre - step / 2;
  for (let d = inner + step; d < last - 1e-9; d += step) deltas.push(d);
  const n = deltas.length;
  if (n && last - deltas[n - 1] < step / 2) deltas[n - 1] = ((n > 1 ? deltas[n - 2] : inner) + last) / 2;
  deltas.push(last);

  // The arcs: the parts of each lap outside the hole's lap, grouped by the
  // side of the hole they are on, outermost first.
  const lobes = [];
  const angleOf = (x, y) => datan2(y, x);
  for (let j = 0; j < deltas.length; j++) {
    const { pts, M } = polygon(t, deltas[j], 24);
    const outside = (i) => hypot(pts[2 * i], pts[2 * i + 1]) > R;
    let start = -1;
    for (let i = 0; i < M; i++) if (!outside(i) && outside((i + 1) % M)) { start = i; break; }
    if (start < 0) continue;
    // Where the edge from point i to the next one crosses the hole's lap.
    const cross = (i) => {
      const k = (i + 1) % M;
      const ra = hypot(pts[2 * i], pts[2 * i + 1]);
      const rb = hypot(pts[2 * k], pts[2 * k + 1]);
      const f = rb === ra ? 0 : (R - ra) / (rb - ra);
      const x = pts[2 * i] + f * (pts[2 * k] - pts[2 * i]);
      const y = pts[2 * i + 1] + f * (pts[2 * k + 1] - pts[2 * i + 1]);
      const l = hypot(x, y) || 1;
      return [(x * R) / l, (y * R) / l];
    };
    let arc = null;
    for (let q = 0; q < M; q++) {
      const i = (start + q) % M;
      const k = (i + 1) % M;
      if (!outside(i) && outside(k)) arc = [...cross(i)];
      if (arc && outside(k)) arc.push(pts[2 * k], pts[2 * k + 1]);
      if (arc && outside(i) && !outside(k)) {
        arc.push(...cross(i));
        const a0 = angleOf(arc[0], arc[1]);
        const a1 = angleOf(arc[arc.length - 2], arc[arc.length - 1]);
        let length = 0;
        for (let v = 2; v < arc.length; v += 2) length += hypot(arc[v] - arc[v - 2], arc[v + 1] - arc[v - 1]);
        if (length > 0.3 * t.w) {
          const mid = a0 + frac((a1 - a0) / TAU) * (TAU / 2);
          const home = lobes.find((lobe) => frac((mid - lobe.a0) / TAU) <= frac((lobe.a1 - lobe.a0) / TAU));
          if (home) home.arcs.push(arc); else lobes.push({ a0, a1, arcs: [arc] });
        }
        arc = null;
      }
    }
  }
  // Onto the hole's lap, once round it, then lobe by lobe going round.
  let at = angleOf(out[out.length - 2], out[out.length - 1]);
  const ring = (a) => out.push(R * dcos(a), R * dsin(a));
  // Along the hole's lap from the angle the path is at to angle b, the shorter way.
  const along = (b) => {
    let turn = frac((b - at) / TAU) * TAU;
    if (turn > TAU / 2) turn -= TAU;
    const steps = Math.max(1, Math.ceil((Math.abs(turn) * R) / pointStep));
    for (let v = 1; v <= steps; v++) ring(at + (turn * v) / steps);
    at = b;
  };
  ring(at);
  const full = Math.max(8, Math.ceil((TAU * R) / pointStep));
  for (let v = 1; v <= full; v++) ring(at + (TAU * v) / full);
  lobes.sort((p, q) => frac((p.a0 - at) / TAU) - frac((q.a0 - at) / TAU));
  const gap = (a) => { const d = frac((a - at) / TAU); return Math.min(d, 1 - d); };
  for (const lobe of lobes) {
    for (const arc of lobe.arcs) {
      const m = arc.length;
      const a0 = angleOf(arc[0], arc[1]);
      const a1 = angleOf(arc[m - 2], arc[m - 1]);
      if (gap(a0) <= gap(a1)) {
        along(a0);
        for (let v = 2; v < m; v += 2) out.push(arc[v], arc[v + 1]);
        at = a1;
      } else {
        along(a1);
        for (let v = m - 4; v >= 0; v -= 2) out.push(arc[v], arc[v + 1]);
        at = a0;
      }
    }
  }
  if (t.endXY) along(angleOf(t.endXY[0], t.endXY[1]));
  return NaN;
}

// A closed curve as M points, point i at outline position uS + i / M.
function polygon(t, delta, min) {
  const even = Math.min(Math.max(Math.ceil(t.perimeter(delta) / t.pointStep), min), 2880);
  const us = [];
  for (let i = 0; i < even; i++) us.push(i / even);
  // Sharp corners are points of their own, so the curve isn't cut short there.
  for (const c of t.corners(delta)) {
    const at = frac(c - t.uS);
    if (us.every((u) => Math.abs(u - at) > 1e-9)) us.push(at);
  }
  us.sort((a, b) => a - b);
  const M = us.length;
  const pts = new Float64Array(2 * M);
  for (let i = 0; i < M; i++) {
    t.curve(t.uS + us[i], delta, t.xy);
    pts[2 * i] = t.xy[0];
    pts[2 * i + 1] = t.xy[1];
  }
  return { pts, M };
}

// The hole's own lap: a circle, whatever the footprint.
function circle(t) {
  const M = Math.min(Math.max(Math.ceil((TAU * t.holeR) / t.pointStep), 12), 2880);
  const pts = new Float64Array(2 * M);
  for (let i = 0; i < M; i++) {
    pts[2 * i] = t.holeR * dcos((TAU * i) / M);
    pts[2 * i + 1] = t.holeR * dsin((TAU * i) / M);
  }
  return { pts, M };
}

// Along a polygon from position a to position b (point index plus a
// fraction), the shorter way round: the points passed, without the ends.
function walk(out, poly, a, b) {
  const { pts, M } = poly;
  const ahead = ((b - a) % M + M) % M;
  const push = (v) => {
    const i = ((v % M) + M) % M;
    out.push(pts[2 * i], pts[2 * i + 1]);
  };
  if (ahead <= M / 2) for (let v = Math.floor(a) + 1; v < a + ahead - 1e-9; v++) push(v);
  else for (let v = Math.ceil(a) - 1; v > a - (M - ahead) + 1e-9; v--) push(v);
}

// Once round a polygon from position a, back to where it started.
function lap(out, poly, a) {
  const { pts, M } = poly;
  for (let k = 1; k <= M; k++) {
    const i = (Math.floor(a) + k) % M;
    out.push(pts[2 * i], pts[2 * i + 1]);
  }
}

// Lines: a closed lap beside the ring, then straight lines to and fro inside
// it, turned 90° on every layer so each layer crosses the grooves of the one
// below. The lines end a little inside that lap, lapping onto its bead
// (TIP_OVERLAP), and turn along it: where a line meets the lap at a shallow
// angle, less overlap leaves a sliver open between two line ends. A
// hole gets a closed lap of its own the first time a line reaches it; the
// lines stop at it, fill one side of it going up and the other coming back.
function lines(t) {
  const { first, step, out, layer } = t;
  trace(t, 0, 1, () => first);
  const outer = polygon(t, first + (0.5 - TIP_OVERLAP) * t.w, 24);
  const hole = t.holeR > 0 ? circle(t) : null;
  const polys = hole ? [outer, hole] : [outer];

  // The sweep starts on the seam's side on even layers and a quarter turn on
  // from it on odd ones: d is the way it advances, e the way the lines run.
  let sx = outer.pts[0];
  let sy = outer.pts[1];
  const sl = hypot(sx, sy) || 1;
  sx /= sl;
  sy /= sl;
  const dx = layer % 2 === 0 ? -sx : sy;
  const dy = layer % 2 === 0 ? -sy : -sx;
  const ex = -dy;
  const ey = dx;

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < outer.M; i++) {
    const s = outer.pts[2 * i] * dx + outer.pts[2 * i + 1] * dy;
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  // The lines fit the floor exactly; every other layer that runs the same
  // way has one line more, so its lines don't lie on the ones two below.
  const count = Math.max(1, Math.ceil((hi - lo) / step - 1e-9)) + ((layer >> 1) % 2);
  const pitch = (hi - lo) / count;

  // Where each line crosses the curves, in order along the line.
  const rows = [];
  for (let i = 0; i < count; i++) {
    const s = lo + pitch * (i + 0.5);
    const hits = [];
    for (const poly of polys) {
      const { pts, M } = poly;
      let sa = pts[2 * (M - 1)] * dx + pts[2 * (M - 1) + 1] * dy - s;
      for (let j = 0; j < M; j++) {
        const a = (j + M - 1) % M;
        const sb = pts[2 * j] * dx + pts[2 * j + 1] * dy - s;
        if ((sa <= 0) !== (sb <= 0)) {
          const f = sa / (sa - sb);
          let x = pts[2 * a] + f * (pts[2 * j] - pts[2 * a]);
          let y = pts[2 * a + 1] + f * (pts[2 * j + 1] - pts[2 * a + 1]);
          if (poly === hole) {
            // On the hole's lap itself, not on the chord between two of its points.
            const out = t.holeR / (hypot(x, y) || 1);
            x *= out;
            y *= out;
          }
          hits.push({ t: x * ex + y * ey, poly, pos: a + f, x, y });
        }
        sa = sb;
      }
    }
    hits.sort((p, q) => p.t - q.t);
    if (hits.length >= 2 && hits.length % 2 === 0) rows.push(hits);
  }
  if (!rows.length) return t.uS + 1;

  let holeDone = false;
  let cur = { poly: outer, pos: 0, x: outer.pts[0], y: outer.pts[1] };
  out.push(cur.x, cur.y);
  // To a point on a curve: along the curve when the path is on the same one
  // (a turn, or the way round the hole), straight otherwise.
  const go = (hit) => {
    if (hit.poly === cur.poly) {
      if (hit.poly === hole && !holeDone) {
        lap(out, hole, cur.pos);
        out.push(cur.x, cur.y);
        holeDone = true;
      }
      walk(out, hit.poly, cur.pos, hit.pos);
    }
    out.push(hit.x, hit.y);
    cur = hit;
  };
  const straight = (hit) => {
    out.push(hit.x, hit.y);
    cur = hit;
  };
  // A whole line from one end to the other: straight inside the floor, and
  // along the curve where it leaves it (a hole, or a dent in the outline).
  const through = (hits, reverse) => {
    const n = hits.length;
    for (let j = 0; j < n; j++) {
      const hit = hits[reverse ? n - 1 - j : j];
      if (j % 2 === 1) straight(hit); else go(hit);
    }
  };

  // The lines that cross the hole, when they do so plainly: in, hole, hole, out.
  const crosses = (hits) => hits.length === 4 && hits[0].poly === outer && hits[1].poly === hole && hits[2].poly === hole && hits[3].poly === outer;
  let i0 = -1;
  let i1 = -1;
  let plain = !!hole;
  for (let i = 0; i < rows.length && plain; i++) {
    const onHole = rows[i].some((hit) => hit.poly === hole);
    if (!onHole) continue;
    if (!crosses(rows[i]) || (i1 >= 0 && i !== i1 + 1)) plain = false;
    if (i0 < 0) i0 = i;
    i1 = i;
  }
  if (!plain) i0 = i1 = -1;

  // Start at the end of the first line nearer the seam.
  const ends0 = rows[0];
  const arc = (pos) => Math.min(pos, outer.M - pos);
  let reverse = arc(ends0[ends0.length - 1].pos) < arc(ends0[0].pos);

  for (let i = 0; i < rows.length; i++) {
    if (i !== i0) {
      through(rows[i], reverse);
      reverse = !reverse;
      continue;
    }
    // The hole. Side X is the one the path is on, Y the other. With an odd
    // number of lines: up side X (ending on the hole), over the hole, down
    // side Y. With an even number the first line goes straight through and
    // the sides swap. Either way the path ends on the outside, at the
    // bottom of the hole, and walks up the outline to the next line.
    const side = (hits, high) => (high ? [hits[3], hits[2]] : [hits[0], hits[1]]);
    let high = reverse;
    let from = i0;
    if ((i1 - i0 + 1) % 2 === 0) {
      through(rows[i0], reverse);
      high = !high;
      from = i0 + 1;
    }
    for (let j = from; j <= i1; j++) {
      const [rim, edge] = side(rows[j], high);
      if ((j - from) % 2 === 0) { go(rim); straight(edge); } else { go(edge); straight(rim); }
    }
    for (let j = i1; j >= from; j--) {
      const [rim, edge] = side(rows[j], !high);
      if ((i1 - j) % 2 === 0) { go(edge); straight(rim); } else { go(rim); straight(edge); }
    }
    reverse = !high;
    i = i1;
  }

  // End over the end of the layer below.
  if (t.endXY && cur.poly === outer) {
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < outer.M; j++) {
      const d = hypot(outer.pts[2 * j] - t.endXY[0], outer.pts[2 * j + 1] - t.endXY[1]);
      if (d < bestD) { bestD = d; best = j; }
    }
    go({ poly: outer, pos: best, x: outer.pts[2 * best], y: outer.pts[2 * best + 1] });
  }
  return cur.poly === outer ? t.uS + cur.pos / outer.M : t.uS;
}
