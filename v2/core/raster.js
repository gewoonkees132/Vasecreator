// Greyscale rasters for image patterns and morph maps (ARCHITECTURE.md,
// "Phase 2 contracts"; research §6.3).
//
//   Raster = { width, height, data: Uint8Array }   8-bit grey, row 0 = top
//
// Everything here uses + − × ÷, Math.floor / round / sqrt and integer ops
// only (research §8.3), so a raster, its hash and every blurred copy are the
// same bits in every engine.

import { dexp } from './math.js';

/** Longest side a raster may have (ARCHITECTURE.md). */
export const MAX_RASTER_SIDE = 512;

// a^(1/n) for a > 0 by Newton's method from above (monotone, so it stops
// exactly where the next step no longer improves).
function root(a, n) {
  if (!(a > 0)) return 0;
  let y = a > 1 ? a : 1;
  for (let i = 0; i < 200; i++) {
    let p = 1;
    for (let k = 1; k < n; k++) p *= y;
    const next = y - (p * y - a) / (n * p);
    if (!(next < y)) break;
    y = next;
  }
  return y;
}

// sRGB code → linear light, and the midpoints between neighbouring codes in
// linear light (for re-encoding without an inverse power).
const LINEAR = new Float64Array(256);
const MIDPOINTS = new Float64Array(255);
for (let c = 0; c < 256; c++) {
  const s = c / 255;
  if (s <= 0.04045) {
    LINEAR[c] = s / 12.92;
  } else {
    const x = (s + 0.055) / 1.055;
    const x2 = x * x;
    LINEAR[c] = x2 * root(x2, 5); // x^2.4 = x² · (x²)^(1/5)
  }
}
for (let c = 0; c < 255; c++) MIDPOINTS[c] = (LINEAR[c] + LINEAR[c + 1]) / 2;

// The sRGB code whose linear value is nearest to y.
function encode(y) {
  let lo = 0;
  let hi = 255;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (y < MIDPOINTS[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * A greyscale raster from RGBA pixels (canvas ImageData order): Rec. 709
 * luminance of linearised sRGB, area-averaged in linear light when the long
 * side is over maxSide, then re-encoded as sRGB so mid-grey reads as about
 * 0.5. Alpha is ignored.
 * @param {Uint8Array | Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @param {number} [maxSide]
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function rasterFromRGBA(rgba, width, height, maxSide = MAX_RASTER_SIDE) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Image size must be whole pixels');
  }
  if (!rgba || rgba.length < 4 * width * height) throw new RangeError('Image data is shorter than its size');
  const side = Math.max(width, height);
  const limit = Math.max(1, Math.floor(maxSide));
  const scale = side > limit ? limit / side : 1;
  const W = Math.max(1, Math.round(width * scale));
  const H = Math.max(1, Math.round(height * scale));
  const sum = new Float64Array(W * H);
  const count = new Uint32Array(W * H);
  for (let y = 0; y < height; y++) {
    const ty = Math.min(H - 1, Math.floor((y * H) / height));
    for (let x = 0; x < width; x++) {
      const tx = Math.min(W - 1, Math.floor((x * W) / width));
      const i = 4 * (y * width + x);
      const lum = 0.2126 * LINEAR[rgba[i]] + 0.7152 * LINEAR[rgba[i + 1]] + 0.0722 * LINEAR[rgba[i + 2]];
      const t = ty * W + tx;
      sum[t] += lum;
      count[t]++;
    }
  }
  const data = new Uint8Array(W * H);
  for (let t = 0; t < W * H; t++) data[t] = encode(count[t] ? sum[t] / count[t] : 0);
  return { width: W, height: H, data };
}

/**
 * FNV-1a 64 over the width and height (4 bytes each, little-endian) and the
 * pixels, as 16 hex characters. 16-bit limbs keep it exact without BigInt.
 * @param {{ width: number, height: number, data: Uint8Array }} raster
 * @returns {string}
 */
export function hashRaster(raster) {
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
  const step = (byte) => {
    h0 ^= byte;
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + (h0 << 8) + (t1 >>> 16);
    const t3 = h3 * 0x1b3 + (h1 << 8) + (t2 >>> 16);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  };
  for (const v of [raster.width, raster.height]) {
    for (let k = 0; k < 4; k++) step((v >>> (8 * k)) & 0xff);
  }
  const { data } = raster;
  for (let i = 0; i < data.length; i++) step(data[i]);
  return [h3, h2, h1, h0].map((x) => x.toString(16).padStart(4, '0')).join('');
}

/**
 * How many beads one tile of a pattern prints at (research §6.3): around at
 * a bead spacing of w/2, up at one sample per layer. "Prints at ~39 × 100".
 * @param {{ repeats: number, tileHeightMm: number }} slot
 * @param {number} perimeterMm the wall's perimeter
 * @param {{ beadWidthMm: number, layerHeightMm: number }} layers
 * @returns {{ around: number, up: number }}
 */
export function printableResolution(slot, perimeterMm, layers) {
  const repeats = Math.max(1, slot.repeats);
  return {
    around: Math.max(1, Math.round(perimeterMm / repeats / (layers.beadWidthMm / 2))),
    up: Math.max(1, Math.round(slot.tileHeightMm / layers.layerHeightMm)),
  };
}

// ---------------------------------------------------------------------------
// Blur and sampling

/** σ rounded to a quarter texel (whole texels past 4), so caches hit while dragging. */
export function quantiseSigma(sigma) {
  if (!(sigma > 0.25)) return 0;
  return sigma < 4 ? Math.round(sigma * 4) / 4 : Math.round(sigma);
}

const index = (i, n, wrap) => (wrap ? ((i % n) + n) % n : i < 0 ? 0 : i >= n ? n - 1 : i);

// One blur pass along lines of `n` samples (`stride` apart), `lines` of them
// (`lineStride` apart). A Gaussian kernel up to σ = 3, three box passes
// (the same variance) beyond, so a large blur costs the same as a small one.
function blurAxis(src, n, stride, lines, lineStride, sigma, wrap) {
  if (!(sigma > 0) || n < 2) return src;
  const line = new Float64Array(n);
  const out = new Float64Array(n);
  const dst = new Float32Array(src.length);
  let kernel = null;
  let radius = 0;
  if (sigma <= 3) {
    radius = Math.ceil(3 * sigma);
    kernel = new Float64Array(2 * radius + 1);
    let total = 0;
    for (let k = -radius; k <= radius; k++) {
      const wgt = dexp(-(k * k) / (2 * sigma * sigma));
      kernel[k + radius] = wgt;
      total += wgt;
    }
    for (let k = 0; k < kernel.length; k++) kernel[k] /= total;
  } else {
    radius = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  }
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    for (let i = 0; i < n; i++) line[i] = src[base + i * stride];
    if (kernel) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) s += kernel[k + radius] * line[index(i + k, n, wrap)];
        out[i] = s;
      }
    } else {
      const width = 2 * radius + 1;
      for (let pass = 0; pass < 3; pass++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) s += line[index(k, n, wrap)];
        for (let i = 0; i < n; i++) {
          out[i] = s / width;
          s += line[index(i + radius + 1, n, wrap)] - line[index(i - radius, n, wrap)];
        }
        if (pass < 2) line.set(out);
      }
    }
    for (let i = 0; i < n; i++) dst[base + i * stride] = out[i];
  }
  return dst;
}

/**
 * A separable Gaussian blur of a row-major grid, wrapping around in x and
 * either wrapping or clamping in y.
 * @param {Float32Array} values
 * @param {number} width
 * @param {number} height
 * @param {number} sigmaX texels
 * @param {number} sigmaY texels
 * @param {boolean} wrapY
 * @returns {Float32Array} a new grid (or `values` itself when nothing blurs)
 */
export function blurGrid(values, width, height, sigmaX, sigmaY, wrapY) {
  const across = blurAxis(values, width, 1, height, width, sigmaX, true);
  return blurAxis(across, height, width, width, 1, sigmaY, wrapY);
}

/** A raster's pixels as values from −1 (black) to +1 (white). */
export function rasterValues(raster) {
  const out = new Float32Array(raster.width * raster.height);
  for (let i = 0; i < out.length; i++) out[i] = (2 * raster.data[i]) / 255 - 1;
  return out;
}

/**
 * Bilinear sampler over a grid with row 0 at the top. x and y are tile
 * coordinates in [0, 1] (y = 0 at the bottom); x always wraps, y wraps or
 * clamps.
 */
export function gridSampler(grid, width, height, wrapY) {
  return function sample(x, y) {
    const px = (x - Math.floor(x)) * width - 0.5;
    const yy = wrapY ? y - Math.floor(y) : y < 0 ? 0 : y > 1 ? 1 : y;
    let py = (1 - yy) * height - 0.5;
    if (!wrapY) py = py < 0 ? 0 : py > height - 1 ? height - 1 : py;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const tx = px - ix;
    const ty = py - iy;
    const x0 = ix < 0 ? ix + width : ix;
    const x1 = x0 + 1 >= width ? x0 + 1 - width : x0 + 1;
    let y0 = iy;
    let y1 = iy + 1;
    if (wrapY) {
      if (y0 < 0) y0 += height;
      if (y1 >= height) y1 -= height;
    } else if (y1 > height - 1) {
      y1 = height - 1;
    }
    const r0 = y0 * width;
    const r1 = y1 * width;
    const top = grid[r0 + x0] + (grid[r0 + x1] - grid[r0 + x0]) * tx;
    const bottom = grid[r1 + x0] + (grid[r1 + x1] - grid[r1 + x0]) * tx;
    return top + (bottom - top) * ty;
  };
}

// Bumps along one line of a grid (as a closed loop when wrap): sign changes
// around the line's middle, with a band so noise doesn't count.
function bumpsAlong(grid, n, stride, base, wrap) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = grid[base + i * stride];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 0.1) return 0;
  const mid = (hi + lo) / 2;
  const band = (hi - lo) / 4;
  const stateOf = (v) => (v > mid + band ? 1 : v < mid - band ? -1 : 0);
  let state = 0;
  if (wrap) for (let i = n - 1; i >= 0 && state === 0; i--) state = stateOf(grid[base + i * stride]);
  let flips = 0;
  for (let i = 0; i < n; i++) {
    const s = stateOf(grid[base + i * stride]);
    if (s !== 0 && s !== state) {
      if (state !== 0) flips++;
      state = s;
    }
  }
  return Math.ceil(flips / 2);
}

/**
 * Bumps per tile of a value grid, around and up (the most along any sampled
 * row or column), for the points per layer and the fineness check.
 * @returns {{ around: number, up: number }}
 */
export function gridFeatures(grid, width, height) {
  let around = 0;
  let up = 0;
  const rows = Math.min(height, 32);
  for (let k = 0; k < rows; k++) {
    const r = Math.floor(((k + 0.5) * height) / rows);
    around = Math.max(around, bumpsAlong(grid, width, 1, r * width, true));
  }
  const columns = Math.min(width, 32);
  for (let k = 0; k < columns; k++) {
    const c = Math.floor(((k + 0.5) * width) / columns);
    up = Math.max(up, bumpsAlong(grid, height, width, c, true));
  }
  return { around, up };
}

// Prepared copies per raster and blur, so a drag reuses them.
const prepared = new WeakMap();

/**
 * A raster as −1…1 values blurred by (sigmaX, sigmaY) texels, cached per
 * raster object and blur. Returns { sample(x, y), features, width, height }.
 * @param {{ width: number, height: number, data: Uint8Array }} raster
 * @param {number} sigmaX
 * @param {number} sigmaY
 * @param {boolean} wrapY
 */
export function preparedRaster(raster, sigmaX, sigmaY, wrapY) {
  const sx = quantiseSigma(sigmaX);
  const sy = quantiseSigma(sigmaY);
  let byBlur = prepared.get(raster);
  if (!byBlur) {
    byBlur = new Map();
    prepared.set(raster, byBlur);
  }
  const key = `${sx}|${sy}|${wrapY ? 1 : 0}`;
  let entry = byBlur.get(key);
  if (!entry) {
    const { width, height } = raster;
    const grid = blurGrid(rasterValues(raster), width, height, sx, sy, wrapY);
    entry = { grid, width, height, sample: gridSampler(grid, width, height, wrapY), features: gridFeatures(grid, width, height) };
    if (byBlur.size >= 8) byBlur.delete(byBlur.keys().next().value);
    byBlur.set(key, entry);
  }
  return entry;
}

/**
 * Whether a value is a usable Raster.
 * @param {unknown} r
 * @returns {boolean}
 */
export function isRaster(r) {
  return !!r && Number.isInteger(r.width) && Number.isInteger(r.height) && r.width > 0 && r.height > 0
    && r.data instanceof Uint8Array && r.data.length === r.width * r.height;
}
