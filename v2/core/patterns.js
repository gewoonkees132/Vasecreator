// Pattern generator: evaluates a pattern recipe on one repeat tile.
//
// A tile runs x around the pot and y up the pot, both in [0, 1). The value says
// how far the bead moves: +1 pushes it out by the pattern depth, −1 pulls it in,
// 0 leaves the surface alone. Every recipe is periodic in x and y and continuous
// across tile edges, so whole repeats wrap round the pot with no seam (D16).
//
// Recipes are plain JSON (v2/library/patterns.json):
//   { "kind": "shape", "shape": "flutes" }
//   { "kind": "motif", "cells": [1, -1, 1], "layout": "brick", "edges": "soft" }
//   { "kind": "plain" }

import { TAU, dcos, dsin, frac, lerp, smoothstep } from './math.js';

/** Width of a cell-to-cell transition, as a share of one cell. */
export const EDGE_WIDTHS = { sharp: 0.1, soft: 0.35, round: 1 };

export const MOTIF_LAYOUTS = ['stripes', 'diagonal', 'brick', 'checker'];

export const PLAIN = Object.freeze({
  id: 'plain',
  name: 'Plain',
  range: [0, 0],
  recipe: Object.freeze({ kind: 'plain' }),
});

const SQRT3 = 1.7320508075688772;
const ROW_SPACING = SQRT3 / 2;

// Smoothed triangle wave from its first three harmonics: −1 at x = 0,
// +1 at x = 0.5, with rounded tips a bead can follow.
const TRIANGLE_NORM = 1 + 1 / 9 + 1 / 25;
function softTriangle(x) {
  const a = TAU * x;
  return -(dcos(a) + dcos(3 * a) / 9 + dcos(5 * a) / 25) / TRIANGLE_NORM;
}

// Smooth dome: 1 at the centre, 0 at q ≥ 1, flat where it meets the surface.
function dome(q) {
  if (q >= 1) return 0;
  const s = 1 - q * q;
  return s * s;
}

// Regular hexagonal lattice, one point per repeat around and two rows per tile.
// y is stretched by √3 so neighbouring points are exactly 1 apart; the pattern
// looks regular when the tile height is about √3 × the width of one repeat.
// Calls visit(distance, px, py, row) for the points near (x, y), rows ascending.
function visitLattice(x, y, rowShift, visit) {
  const yy = y * SQRT3;
  const firstRow = Math.floor(yy / ROW_SPACING - rowShift) - 1;
  for (let k = firstRow; k <= firstRow + 3; k++) {
    const py = (k + rowShift) * ROW_SPACING;
    const offset = (k & 1) * 0.5;
    const firstColumn = Math.floor(x - offset) - 1;
    for (let i = firstColumn; i <= firstColumn + 2; i++) {
      const px = i + offset;
      const dx = x - px;
      const dy = yy - py;
      visit(Math.sqrt(dx * dx + dy * dy), px, py, k);
    }
  }
}

function scales(x, y) {
  // Discs centred on the lattice rows; higher rows overlap lower ones, like
  // roof tiles, so only the lower part of each scale shows. A scale lies flat
  // where it is tucked under the row above and lifts towards its lower edge,
  // then blends into the scale beneath over a short, printable edge.
  const radius = 0.68;
  const edge = 0.2;
  const yy = y * SQRT3;
  let value = -1;
  visitLattice(x, y, 0, (d, px, py) => {
    const cover = smoothstep(radius, radius - edge, d);
    if (cover > 0) {
      const lift = Math.min(Math.max((py - yy) / radius, -1), 1);
      value = lerp(value, lift, cover);
    }
  });
  return value;
}

function dots(x, y) {
  let value = 0;
  visitLattice(x, y, 0.5, (d) => {
    const h = dome(d / 0.34);
    if (h > value) value = h;
  });
  return value;
}

// Polynomial smooth minimum: rounds the crease where a and b cross.
function smoothMin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

function honeycomb(x, y) {
  const points = [];
  visitLattice(x, y, 0.5, (d, px, py) => points.push({ d, px, py }));
  let nearest = points[0];
  for (const p of points) if (p.d < nearest.d) nearest = p;
  // Distance to each wall of the nearest cell, joined with a smooth minimum
  // so the corners of the cell stay round enough for a bead to follow.
  let wall = Infinity;
  for (const p of points) {
    if (p === nearest) continue;
    const gx = p.px - nearest.px;
    const gy = p.py - nearest.py;
    const gap = Math.sqrt(gx * gx + gy * gy);
    wall = smoothMin(wall, (p.d * p.d - nearest.d * nearest.d) / (2 * gap), 0.12);
  }
  return 1 - smoothstep(0.04, 0.2, wall);
}

function basket(x, y) {
  // Four bundles per tile, alternating direction, each two strands wide.
  // Each bundle eases in and out along its length, so bundles meet flat at
  // the groove between them, with no step or crease.
  const qx = Math.floor(2 * x);
  const qy = Math.floor(2 * y);
  const s = 2 * x - qx;
  const t = 2 * y - qy;
  const strands = (u) => 0.5 - 0.5 * dcos(2 * TAU * u);
  const along = (u) => smoothstep(0, 0.35, u) * smoothstep(1, 0.65, u);
  const v = (qx + qy) % 2 === 0 ? strands(s) * along(t) : strands(t) * along(s);
  return 2 * v - 1;
}

/** Named shapes. Each takes tile coordinates in [0, 1) and returns a value in [−1, 1]. */
export const SHAPES = {
  flutes: (x) => dcos(TAU * x),
  pleats: (x) => softTriangle(x),
  ribs: (x, y) => dcos(TAU * y),
  ripple: (x, y) => dcos(TAU * (y + 0.18 * dsin(TAU * x))),
  spiral: (x, y) => dcos(TAU * (x + y)),
  chevron: (x, y) => dcos(TAU * (y + 0.3 * softTriangle(x))),
  diamonds: (x, y) => {
    const ridge = (u) => (1 - softTriangle(u)) / 2; // 1 at the tile edge, 0 in the middle
    return 1 - 2 * smoothstep(0.3, 0.7, (ridge(x) + ridge(y)) / 2);
  },
  scales,
  dots,
  honeycomb,
  basket,
};

// One row of motif cells along t (in cells). Neighbouring cells blend over
// `width` cells, centred on their shared border.
function motifRow(cells, t, width) {
  const n = cells.length;
  const u = t - n * Math.floor(t / n);
  const i = Math.min(Math.floor(u), n - 1);
  const f = u - i;
  const h = width / 2;
  const here = cells[i];
  if (f < 0.5) return lerp(cells[(i + n - 1) % n], here, smoothstep(-h, h, f));
  return lerp(here, cells[(i + 1) % n], smoothstep(1 - h, 1 + h, f));
}

function motif(recipe, x, y) {
  const { cells, layout = 'stripes', edges = 'soft' } = recipe;
  const n = cells.length;
  const width = EDGE_WIDTHS[edges];
  if (layout === 'stripes') return motifRow(cells, x * n, width);
  if (layout === 'diagonal') return motifRow(cells, (x + y) * n, width);

  // Brick and checker: two rows per tile, blended into each other like cells.
  const row = (j) =>
    layout === 'brick'
      ? motifRow(cells, x * n + (j & 1) * (n / 2), width)
      : (j & 1 ? -1 : 1) * motifRow(cells, x * n, width);
  const r = 2 * y;
  const j = Math.floor(r);
  const f = r - j;
  const h = width / 2;
  if (f < 0.5) return lerp(row(j - 1), row(j), smoothstep(-h, h, f));
  return lerp(row(j), row(j + 1), smoothstep(1 - h, 1 + h, f));
}

/**
 * Throws if a recipe can't be evaluated.
 * @param {object} recipe
 */
export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') throw new TypeError('Pattern recipe must be an object');
  if (recipe.kind === 'plain') return;
  if (recipe.kind === 'shape') {
    if (!Object.hasOwn(SHAPES, recipe.shape)) throw new RangeError(`Unknown pattern shape: ${recipe.shape}`);
    return;
  }
  if (recipe.kind === 'motif') {
    const { cells, layout = 'stripes', edges = 'soft' } = recipe;
    if (!Array.isArray(cells) || cells.length < 2 || cells.some((c) => !(c >= -1 && c <= 1))) {
      throw new RangeError('Motif cells must be 2 or more values from -1 to 1');
    }
    if (!MOTIF_LAYOUTS.includes(layout)) throw new RangeError(`Unknown motif layout: ${layout}`);
    if (!Object.hasOwn(EDGE_WIDTHS, edges)) throw new RangeError(`Unknown motif edges: ${edges}`);
    return;
  }
  throw new RangeError(`Unknown pattern kind: ${recipe.kind}`);
}

/**
 * Value of a pattern at tile position (x, y). Coordinates wrap, so any real
 * x and y are allowed: x = repeats × (angle / 2π), y = height / tile height.
 * @param {object} recipe
 * @param {number} x position around, in tiles
 * @param {number} y position up, in tiles
 * @returns {number} from −1 (in) to 1 (out)
 */
export function evaluatePattern(recipe, x, y) {
  const u = frac(x);
  const v = frac(y);
  switch (recipe.kind) {
    case 'plain': return 0;
    case 'shape': return SHAPES[recipe.shape](u, v);
    case 'motif': return motif(recipe, u, v);
    default: throw new RangeError(`Unknown pattern kind: ${recipe.kind}`);
  }
}

/**
 * Samples one tile on a grid, for swatches and thumbnails.
 * @param {object} recipe
 * @param {number} columns samples around
 * @param {number} rows samples up
 * @returns {Float64Array} row-major, row 0 at the bottom of the tile
 */
export function sampleTile(recipe, columns, rows) {
  const out = new Float64Array(columns * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      out[r * columns + c] = evaluatePattern(recipe, (c + 0.5) / columns, (r + 0.5) / rows);
    }
  }
  return out;
}

/**
 * Looks up a pattern by id in a library ("plain" is always available).
 * @param {{ patterns: object[] }} library
 * @param {string} id
 */
export function findPattern(library, id) {
  if (id === PLAIN.id) return PLAIN;
  const entry = library.patterns.find((p) => p.id === id);
  if (!entry) throw new RangeError(`Pattern not in library: ${id}`);
  return entry;
}
