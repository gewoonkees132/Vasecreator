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
  d.surface = {
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
