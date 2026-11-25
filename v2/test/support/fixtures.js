// Shared test fixtures: the libraries and a few reference designs.

import { readFileSync } from 'node:fs';
import { defaultDesign } from '../../core/design.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

export const library = read('../../library/patterns.json');
export const presets = read('../../library/presets.json').presets;

/** A plain cylinder: no pattern, a short base, nothing to warn about. */
export function cylinder({ height = 30, radius = 30, baseLayers = 2, walls = 1, ...rest } = {}) {
  const d = defaultDesign();
  d.meta.name = 'Plain cylinder';
  d.form.height = height;
  d.form.profile = { interp: 'linear', tension: 0.5, cornerMm: 0, knots: [{ z: 0, r: radius }, { z: height, r: radius }] };
  d.form.detail = {
    fromMm: 0, toMm: height,
    a: { pattern: 'plain', depthMm: 0, repeats: 1, tileHeightMm: 19.5 }, b: null,
    blend: { shape: 'fadesUp', amount: 1 },
  };
  d.layers.seam.position = 'fixed';
  d.base.layers = baseLayers;
  d.finish.walls = walls;
  return Object.assign(d, rest);
}

/** Straight-sided design from (z, r) pairs with a linear profile. */
export function linearDesign(knots, patch = {}) {
  const d = cylinder({ height: knots.at(-1)[0] });
  d.form.profile.knots = knots.map(([z, r]) => ({ z, r }));
  return Object.assign(d, patch);
}

/** Distance between points i and j of an x,y,z array. */
export function distance(path, i, j) {
  const dx = path[3 * i] - path[3 * j];
  const dy = path[3 * i + 1] - path[3 * j + 1];
  const dz = path[3 * i + 2] - path[3 * j + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** The bitmap recipes the Pattern tests draw with (row 0 at the bottom). */
export const TILES = Object.freeze({
  zigzag: { kind: 'bitmap', columns: 2, rows: 1, cells: '+-' },
  rows: { kind: 'bitmap', columns: 1, rows: 2, cells: '+-' },
  stack: { kind: 'bitmap', columns: 1, rows: 3, cells: '+0-' },
  knit: { kind: 'bitmap', columns: 4, rows: 2, cells: '+0-0-0+0' },
});

/**
 * A design with a Pattern drawn from `recipe` (carried in its assets): a
 * quarter bead deep, nodes 3 mm apart, from 6 to 24 mm, crisp, no fade.
 */
export function withPattern(d, recipe = TILES.zigzag, patch = {}) {
  d.assets = { ...(d.assets ?? {}), 'user:tile': { kind: 'recipe', name: 'Tile', recipe } };
  d.pattern = {
    drawing: 'user:tile', depthMm: 0.75, density: { by: 'spacing', spacingMm: 3, points: 96 },
    fromMm: 6, toMm: 24, fade: { shape: 'even', amount: 1 }, softenCells: 0, ...patch,
  };
  return d;
}
