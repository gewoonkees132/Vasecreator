// The paint (D79–D87, docs/design/v2-paint-brush.md): a black-and-white
// overlay over the whole wall that says how strongly the Pattern shows at
// each spot. White (255) is the Pattern as set, black (0) the plain wall.
//
// The overlay is a picture of fixed size, PAINT_AROUND columns round the pot
// by PAINT_UP rows over its full height, row 0 at the bottom. A cell is a
// sample at its own middle: column c at u = (c + ½) / PAINT_AROUND, row r at
// v = (r + ½) / PAINT_UP, where u is the outline's own position (the one the
// Pattern's columns use, so the paint follows the twist) and v the height as
// a share of the pot's. That is how a texture is read too, so the tint on
// the pot (render/beads.js) and the engine agree. It is fixed to the pot,
// not to the Pattern's grid: density, drawing and range can change under it.
//
// In the design it is text: the cells run-length packed and then base64
// (design.pattern.paint.cells). An overlay that is white everywhere is null.
//
// A stroke never goes past its Strength: while the pointer is down the brush
// builds a picture of how much each cell was touched (0–1, the most it got),
// and the overlay is the one from before the stroke combined with it.

/** Columns round the pot. */
export const PAINT_AROUND = 128;
/** Rows over the pot's height. */
export const PAINT_UP = 96;
export const PAINT_SIZE = PAINT_AROUND * PAINT_UP;
export const PAINT_WHITE = 255;

/** The strokes (D82). */
export const PAINT_STROKES = Object.freeze(['free', 'line', 'around', 'fade']);
/** The brush settings' ranges and where they start (design §5). */
export const BRUSH_LIMITS = Object.freeze({
  sizeMm: { min: 4, max: 120, step: 1 },
  soft: { min: 0, max: 1, step: 0.05 },
  strength: { min: 0.05, max: 1, step: 0.05 },
});
export const BRUSH_DEFAULTS = Object.freeze({ stroke: 'free', more: false, sizeMm: 30, soft: 0.5, strength: 1 });

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_OF = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_OF[B64.charCodeAt(i)] = i;

function toBase64(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    parts.push(
      B64[a >> 2],
      B64[((a & 3) << 4) | (b >> 4)],
      i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=',
      i + 2 < bytes.length ? B64[c & 63] : '=');
  }
  return parts.join('');
}

function fromBase64(text) {
  let length = text.length;
  if (length % 4 !== 0) return null;
  while (length > 0 && text[length - 1] === '=') length -= 1;
  const out = new Uint8Array(Math.floor((length * 3) / 4));
  let bits = 0;
  let have = 0;
  let o = 0;
  for (let i = 0; i < length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? B64_OF[code] : -1;
    if (value < 0) return null;
    bits = (bits << 6) | value;
    have += 6;
    if (have >= 8) {
      have -= 8;
      out[o++] = (bits >> have) & 255;
    }
  }
  return out;
}

// Run-length packing: a control byte n under 128 is followed by n + 1 cells
// as they are; from 128 it says the next byte repeats n − 126 times (2–129).
function pack(cells) {
  const out = [];
  const n = cells.length;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 129 && cells[i + run] === cells[i]) run += 1;
    if (run >= 3) {
      out.push(run + 126, cells[i]);
      i += run;
      continue;
    }
    const start = i;
    let count = 0;
    while (i < n && count < 128) {
      if (i + 2 < n && cells[i] === cells[i + 1] && cells[i] === cells[i + 2]) break;
      i += 1;
      count += 1;
    }
    out.push(count - 1);
    for (let k = start; k < i; k++) out.push(cells[k]);
  }
  return Uint8Array.from(out);
}

function unpack(bytes, size) {
  const out = new Uint8Array(size);
  let o = 0;
  let i = 0;
  while (i < bytes.length) {
    const control = bytes[i++];
    if (control < 128) {
      const count = control + 1;
      if (i + count > bytes.length || o + count > size) return null;
      for (let k = 0; k < count; k++) out[o++] = bytes[i++];
    } else {
      const count = control - 126;
      if (i >= bytes.length || o + count > size) return null;
      out.fill(bytes[i++], o, o + count);
      o += count;
    }
  }
  return o === size ? out : null;
}

/** A white overlay: the Pattern in full everywhere. */
export function whitePaint() {
  return new Uint8Array(PAINT_SIZE).fill(PAINT_WHITE);
}

/** Whether every cell is white, which is the same as no paint. */
export function isWhite(cells) {
  for (let i = 0; i < cells.length; i++) if (cells[i] !== PAINT_WHITE) return false;
  return true;
}

/**
 * The overlay as the design keeps it.
 * @param {Uint8Array | null} cells PAINT_SIZE values
 * @returns {{ cells: string } | null} null when it is white everywhere
 */
export function encodePaint(cells) {
  if (!cells || cells.length !== PAINT_SIZE || isWhite(cells)) return null;
  return { cells: toBase64(pack(cells)) };
}

/**
 * The cells of a design's paint.
 * @param {unknown} paint design.pattern.paint
 * @returns {Uint8Array | null} null without paint, or when it can't be read
 */
export function decodePaint(paint) {
  const text = paint && typeof paint === 'object' ? paint.cells : null;
  // Packed cells never grow past a control byte in 128; base64 adds a third.
  if (typeof text !== 'string' || !text || text.length > PAINT_SIZE * 2) return null;
  const bytes = fromBase64(text);
  if (!bytes) return null;
  const cells = unpack(bytes, PAINT_SIZE);
  return cells && !isWhite(cells) ? cells : null;
}

/**
 * The paint as a design may keep it: what it holds when that reads as an
 * overlay with something painted, else null.
 * @param {unknown} paint
 * @returns {{ cells: string } | null}
 */
export function normalisePaint(paint) {
  return decodePaint(paint) ? { cells: paint.cells } : null;
}

/**
 * How strongly the Pattern shows at (u, v): 0–1, read bilinearly, wrapping
 * round the pot and held at the bottom and the rim.
 * @param {Uint8Array} cells
 * @param {number} u position round the pot (any real; wraps)
 * @param {number} v height as a share of the pot's, 0–1
 */
export function paintAt(cells, u, v) {
  let x = (u - Math.floor(u)) * PAINT_AROUND - 0.5;
  if (x < 0) x += PAINT_AROUND;
  let c0 = Math.floor(x);
  const fx = x - c0;
  if (c0 >= PAINT_AROUND) c0 -= PAINT_AROUND;
  const c1 = c0 + 1 === PAINT_AROUND ? 0 : c0 + 1;
  let y = v * PAINT_UP - 0.5;
  if (!(y > 0)) y = 0;
  else if (y > PAINT_UP - 1) y = PAINT_UP - 1;
  const r0 = Math.floor(y);
  const fy = y - r0;
  const r1 = r0 + 1 < PAINT_UP ? r0 + 1 : r0;
  const a = cells[r0 * PAINT_AROUND + c0] + fx * (cells[r0 * PAINT_AROUND + c1] - cells[r0 * PAINT_AROUND + c0]);
  const b = cells[r1 * PAINT_AROUND + c0] + fx * (cells[r1 * PAINT_AROUND + c1] - cells[r1 * PAINT_AROUND + c0]);
  return (a + fy * (b - a)) / PAINT_WHITE;
}

// ---------------------------------------------------------------- the brush

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * How much a brush touches at a distance from its middle (0 the middle, 1
 * its edge): full inside the hard core, falling off smoothly to the edge.
 * `soft` 0 is a hard edge, kept one `feather` wide so it isn't jagged.
 */
function falloff(distance, soft, feather) {
  const band = Math.max(soft, feather);
  if (distance >= 1) return 0;
  if (distance <= 1 - band) return 1;
  return smoothstep((1 - distance) / band);
}

/** A stroke picture: how much each cell was touched, 0–1. */
export function emptyTouch() {
  return new Float32Array(PAINT_SIZE);
}

/**
 * Presses a round brush on the wall at (u, v). `ru` and `rv` are its radius
 * as shares of the way round and of the height, so it is round on the wall.
 * @param {Float32Array} touched
 */
export function stamp(touched, u, v, ru, rv, soft) {
  if (!(ru > 0) || !(rv > 0)) return;
  const cx = u * PAINT_AROUND - 0.5;
  const cy = v * PAINT_UP - 0.5;
  const rx = ru * PAINT_AROUND;
  const ry = rv * PAINT_UP;
  // A cell's width of feathering on the brush's smaller side.
  const feather = Math.min(1, 1 / Math.min(rx, ry));
  const r0 = Math.max(0, Math.ceil(cy - ry));
  const r1 = Math.min(PAINT_UP - 1, Math.floor(cy + ry));
  // A brush wider than the pot is round touches every column once.
  const c0 = rx * 2 >= PAINT_AROUND ? 0 : Math.ceil(cx - rx);
  const c1 = rx * 2 >= PAINT_AROUND ? PAINT_AROUND - 1 : Math.floor(cx + rx);
  for (let r = r0; r <= r1; r++) {
    const dy = (r - cy) / ry;
    const row = r * PAINT_AROUND;
    for (let c = c0; c <= c1; c++) {
      let dx = c - cx;
      if (rx * 2 >= PAINT_AROUND) {
        dx -= PAINT_AROUND * Math.round(dx / PAINT_AROUND);
      }
      dx /= rx;
      const t = falloff(Math.sqrt(dx * dx + dy * dy), soft, feather);
      if (t <= 0) continue;
      const i = row + (((c % PAINT_AROUND) + PAINT_AROUND) % PAINT_AROUND);
      if (t > touched[i]) touched[i] = t;
    }
  }
}

/** The short way round from u0 to u1, as a signed share of the way round. */
export function shortWay(u0, u1) {
  const d = u1 - u0;
  return d - Math.round(d);
}

/**
 * Drags the brush straight from a to b on the unrolled wall, the short way
 * round, pressing it often enough to leave no gaps. `radii(v)` gives the
 * brush's { ru, rv } at a height: it stays round where the pot narrows.
 * @param {Float32Array} touched
 * @param {{ u: number, v: number }} a
 * @param {{ u: number, v: number }} b
 * @param {(v: number) => { ru: number, rv: number }} radii
 */
export function segment(touched, a, b, radii, soft) {
  const du = shortWay(a.u, b.u);
  const dv = b.v - a.v;
  const at = radii((a.v + b.v) / 2);
  // A quarter of the brush between presses, in the brush's own measure.
  const length = Math.sqrt((du / at.ru) * (du / at.ru) + (dv / at.rv) * (dv / at.rv));
  const steps = Math.max(1, Math.min(2048, Math.ceil(length / 0.5)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const v = a.v + dv * t;
    const r = radii(v);
    stamp(touched, a.u + du * t, v, r.ru, r.rv, soft);
  }
}

/**
 * A level band all the way round, from height v0 to v1 and a brush radius
 * `rv` beyond each.
 * @param {Float32Array} touched
 */
export function band(touched, v0, v1, rv, soft) {
  if (!(rv > 0)) return;
  const lo = Math.min(v0, v1);
  const hi = Math.max(v0, v1);
  const feather = Math.min(1, 1 / (rv * PAINT_UP));
  for (let r = 0; r < PAINT_UP; r++) {
    const v = (r + 0.5) / PAINT_UP;
    const outside = v < lo ? lo - v : v > hi ? v - hi : 0;
    const t = falloff(outside / rv, soft, feather);
    if (t <= 0) continue;
    const row = r * PAINT_AROUND;
    for (let c = 0; c < PAINT_AROUND; c++) if (t > touched[row + c]) touched[row + c] = t;
  }
}

/**
 * A ramp by height, all the way round: nothing at the press height and on
 * its far side, full at the release height and beyond.
 * @param {Float32Array} touched
 */
export function ramp(touched, vPress, vRelease) {
  const span = vRelease - vPress;
  // Under half a row is a tap, not a drag.
  if (Math.abs(span) < 0.5 / PAINT_UP) return;
  for (let r = 0; r < PAINT_UP; r++) {
    const t = smoothRamp(((r + 0.5) / PAINT_UP - vPress) / span);
    if (t <= 0) continue;
    const row = r * PAINT_AROUND;
    for (let c = 0; c < PAINT_AROUND; c++) if (t > touched[row + c]) touched[row + c] = t;
  }
}

const smoothRamp = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

/**
 * The overlay after a stroke: Less takes `strength × touched` of what was
 * there, More adds that share of what was missing. A cell the stroke really
 * touched moves by a level at least, so a weak brush still reaches black
 * and white (design §4).
 * @param {Uint8Array} before the overlay when the stroke began
 * @param {Float32Array} touched
 * @param {number} strength 0–1
 * @param {boolean} more
 * @returns {Uint8Array} a new overlay
 */
export function composite(before, touched, strength, more) {
  const out = new Uint8Array(before);
  for (let i = 0; i < out.length; i++) {
    const t = touched[i];
    if (t <= 0) continue;
    const b = before[i];
    const room = more ? PAINT_WHITE - b : b;
    if (room === 0) continue;
    let change = Math.round(room * strength * t);
    if (change === 0 && t >= 0.02) change = 1;
    out[i] = more ? b + change : b - change;
  }
  return out;
}

/**
 * The brush's radius on the overlay at a height, from its size on the wall.
 * @param {number} sizeMm the brush's width
 * @param {number} perimeterMm the wall's way round at that height
 * @param {number} heightMm the pot's height
 * @returns {{ ru: number, rv: number }}
 */
export function brushRadii(sizeMm, perimeterMm, heightMm) {
  return { ru: sizeMm / 2 / Math.max(perimeterMm, 1), rv: sizeMm / 2 / Math.max(heightMm, 1) };
}

/** The largest brush for a pot: never more than half its height. */
export function maxBrushMm(heightMm) {
  return Math.max(BRUSH_LIMITS.sizeMm.min, Math.min(BRUSH_LIMITS.sizeMm.max, Math.floor(heightMm / 2)));
}

/**
 * One stroke, from the pointer going down to it lifting.
 * @param {{ stroke: string, more: boolean, sizeMm: number, soft: number, strength: number }} brush
 * @param {{ before: Uint8Array | null, heightMm: number, perimeterAt: (v: number) => number }} wall
 *   before: the overlay as it is (null is white); perimeterAt: the wall's way round in mm at a height share
 * @returns {{ to(u: number, v: number): void, lift(): void, cells(): Uint8Array, touched: Float32Array }}
 *   to: the pointer is at (u, v) on the wall; lift: it left the wall, so the next `to` doesn't join up
 */
export function createStroke(brush, { before, heightMm, perimeterAt }) {
  const start = before ? new Uint8Array(before) : whitePaint();
  const touched = emptyTouch();
  const size = Math.min(Math.max(brush.sizeMm, BRUSH_LIMITS.sizeMm.min), maxBrushMm(heightMm));
  const radii = (v) => brushRadii(size, perimeterAt(Math.min(Math.max(v, 0), 1)), heightMm);
  const rv = size / 2 / Math.max(heightMm, 1);
  let first = null;
  let last = null;

  function to(u, v) {
    const p = { u, v };
    if (!first) first = p;
    switch (brush.stroke) {
      case 'line':
        touched.fill(0);
        segment(touched, first, p, radii, brush.soft);
        break;
      case 'around':
        band(touched, last ? last.v : v, v, rv, brush.soft);
        break;
      case 'fade':
        touched.fill(0);
        ramp(touched, first.v, v);
        break;
      default:
        segment(touched, last || p, p, radii, brush.soft);
    }
    last = p;
  }

  return {
    to,
    lift() { if (brush.stroke === 'free') last = null; },
    cells: () => composite(start, touched, brush.strength, brush.more),
    touched,
  };
}
