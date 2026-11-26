// Facets (D69), Slant (D70), Slant per facet (D71) and the seam with Slant
// (D72): docs/design/v2-recreate-vases.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDesign, normaliseDesign } from '../core/design.js';
import { FACETS_DEFAULTS, createFacets, createMorph } from '../core/morph.js';
import { buildToolpath, createWallModel, KIND } from '../core/toolpath.js';
import { computePreview } from '../core/engine.js';
import { cylinder, library } from './support/fixtures.js';

const TAU = 2 * Math.PI;

/** An egg-shaped pot (it bulges, so its rows of facets need no extra lean) with the Facets morph. */
function faceted(facets = {}, morph = {}) {
  const d = defaultDesign();
  d.form.height = 300;
  d.form.profile = {
    interp: 'catmullRomCentripetal', tension: 0.5, cornerMm: 0,
    knots: [{ z: 0, r: 60 }, { z: 100, r: 90 }, { z: 200, r: 95 }, { z: 300, r: 80 }],
  };
  d.form.morph = { map: 'lib:facets@1', softnessMm: 0, strengthMm: 16, repeats: 6, blend: 1, facets: { ...FACETS_DEFAULTS, rimMm: 0, ...facets }, ...morph };
  return normaliseDesign(d);
}

const point = (radius, z, u) => [radius * Math.cos(TAU * u), radius * Math.sin(TAU * u), z];

test('normalising keeps a Facets layout only for Facets, with at least three around', () => {
  const d = defaultDesign();
  d.form.morph = { map: 'lib:facets@1', repeats: 1, facets: { rows: 40, stagger: 'yes', irregularity: -2, seed: 3.6, rimMm: 500 } };
  const m = normaliseDesign(d).form.morph;
  assert.equal(m.repeats, 3);
  assert.deepEqual(m.facets, { rows: 8, stagger: true, irregularity: 0, seed: 4, rimMm: 100 });
  d.form.morph = { map: 'lib:lobes@1', facets: { rows: 2 } };
  assert.equal('facets' in normaliseDesign(d).form.morph, false);
  d.form.morph = { map: 'lib:facets@1' };
  assert.deepEqual(normaliseDesign(d).form.morph.facets, { ...FACETS_DEFAULTS });
});

test('a regular facet on a straight wall is a flat face whose edges sit on the wall', () => {
  const r = 100;
  const f = createFacets(() => r, 300, { around: 6, rows: 1, stagger: false, irregularity: 0, seed: 0, rimMm: 0, softnessMm: 0, blend: 1 });
  const inset = Math.cos(Math.PI / 6);
  for (const u of [0, 0.01, 0.03, 0.06]) {
    assert.ok(Math.abs(r + f.at(150, u) - (inset * r) / Math.cos(TAU * u)) < 1e-9, `flat at u ${u}`);
  }
  assert.ok(Math.abs(f.at(150, 1 / 12)) < 1e-9, 'the edge lies on the wall');
  assert.equal(f.facetAt(150, 0.01), 0);
  assert.equal(f.facetAt(150, 0.16), 1);
});

test('rows of facets on a straight wall stay rows (they lean like a barrel)', () => {
  const f = createFacets(() => 100, 300, { around: 6, rows: 3, stagger: true, irregularity: 0, seed: 0, rimMm: 0, softnessMm: 0, blend: 1 });
  // Each row's middle belongs to that row, at its own facet's centre.
  assert.equal(Math.floor(f.facetAt(50, 0) / 6), 0);
  assert.equal(Math.floor(f.facetAt(150, 1 / 12) / 6), 1);
  assert.equal(Math.floor(f.facetAt(250, 0) / 6), 2);
});

test('facets are flat on the shape: points of one face lie in one plane', () => {
  const d = faceted({ irregularity: 0.5, seed: 7 });
  const m = createMorph(d, { perimeterMm: 600 });
  const profile = createWallModel(d, library).profile;
  const face = m.facetAt(150, 0.02);
  const pts = [];
  for (let dz = -12; dz <= 12 && pts.length < 6; dz += 6) {
    for (let du = -0.012; du <= 0.012 && pts.length < 6; du += 0.008) {
      const z = 150 + dz;
      const u = 0.02 + du + dz * 1e-4;
      if (m.facetAt(z, u) === face) pts.push(point(profile.at(z) + m.at(z, u), z, u));
    }
  }
  assert.ok(pts.length >= 5, 'enough points in one face');
  // Three points not in a line (two at one height, one at another), then the rest.
  const a = pts[0];
  const b = pts[1];
  const c = pts.at(-1);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const len = Math.hypot(...n);
  for (const p of pts.slice(2, -1)) {
    const dist = (n[0] * (p[0] - a[0]) + n[1] * (p[1] - a[1]) + n[2] * (p[2] - a[2])) / len;
    assert.ok(Math.abs(dist) < 1e-6, `off the plane by ${dist}`);
  }
});

test('Shuffle moves the facets, and the round rim fades them out', () => {
  const a = createMorph(faceted({ seed: 1, irregularity: 0.6 }), { perimeterMm: 600 });
  const b = createMorph(faceted({ seed: 2, irregularity: 0.6 }), { perimeterMm: 600 });
  let differ = 0;
  for (let k = 0; k < 50; k++) if (Math.abs(a.at(150, k / 50) - b.at(150, k / 50)) > 0.1) differ++;
  assert.ok(differ > 10);
  const rim = createMorph(faceted({ rimMm: 30 }), { perimeterMm: 600 });
  for (let k = 0; k < 20; k++) assert.ok(Math.abs(rim.at(300, k / 20)) < 1e-12);
});

/** A cylinder with vertical stripes ++-- and a Slant. */
function slanted(slant, extra = {}) {
  const d = cylinder({ height: 30, radius: 30, baseLayers: 0 });
  d.assets = { 'user:stripes': { kind: 'recipe', name: 'Stripes', recipe: { kind: 'bitmap', columns: 4, rows: 1, cells: '++--' } } };
  d.pattern = {
    drawing: 'user:stripes', depthMm: 1, density: { by: 'points', points: 64, spacingMm: 3 }, fromMm: 0, toMm: 30,
    fade: { shape: 'even', amount: 1 }, softenCells: 0, slant,
  };
  return normaliseDesign(Object.assign(d, extra));
}

test('Slant moves the drawing whole cells a layer, rounded', () => {
  const d = slanted({ cells: 1.5 });
  assert.deepEqual(d.pattern.slant, { cells: 1.5, perFacet: false, toCells: 0 });
  const lp = createWallModel(d, library).pattern;
  const N = lp.nodes;
  for (const k of [0, 1, 2, 3, 5]) {
    const i = lp.first + k;
    const shift = Math.round(1.5 * k);
    for (let j = 0; j < N; j++) {
      assert.equal(lp.at(i, j / N), lp.at(lp.first, (((j - shift) % N) + N) % N / N), `layer +${k}, node ${j}`);
    }
  }
  // Quarter cells, within ±8.
  assert.deepEqual(slanted({ cells: 30.13, toCells: -0.3 }).pattern.slant, { cells: 8, perFacet: false, toCells: -0.25 });
});

test('an even slant takes the seam along: every layer starts on the same column (D72)', () => {
  const d = slanted({ cells: 1 });
  const tp = buildToolpath(d, library);
  const lp = createWallModel(d, library).pattern;
  const startU = (i) => {
    const p = tp.layerStarts[i];
    let u = Math.atan2(tp.path[3 * p + 1], tp.path[3 * p]) / TAU;
    return u < 0 ? u + 1 : u;
  };
  const u0 = startU(lp.first + 1);
  for (const k of [2, 3, 4]) {
    let du = startU(lp.first + k) - u0 - (k - 1) / lp.nodes;
    du -= Math.round(du);
    assert.ok(Math.abs(du) < 1e-6, `layer +${k} starts ${du} off`);
  }
});

test('Slant per facet gives each face its own slant, only with Facets', () => {
  const pot = faceted({ irregularity: 0.4 });
  pot.assets = { 'user:stripes': { kind: 'recipe', name: 'Stripes', recipe: { kind: 'bitmap', columns: 4, rows: 1, cells: '++--' } } };
  pot.pattern = {
    drawing: 'user:stripes', depthMm: 2, density: { by: 'spacing', points: 96, spacingMm: 3 }, fromMm: 0, toMm: 280,
    fade: { shape: 'even', amount: 1 }, softenCells: 0, slant: { cells: -2, perFacet: true, toCells: 2 },
  };
  const d = normaliseDesign(pot);
  const model = createWallModel(d, library);
  const lp = model.pattern;
  assert.equal(lp.seamShift(lp.first + 10), 0, 'per facet the seam holds');
  // Two layers apart, the nodes of different faces moved by different amounts.
  const i = lp.first + 20;
  const shifts = new Set();
  const N = lp.nodes;
  for (let j = 0; j < N; j += 3) {
    const face = model.morph.facetAt((i + 0.5) * d.layers.layerHeightMm, j / N);
    shifts.add(face);
  }
  assert.ok(shifts.size >= 4, 'the layer crosses several faces');
  const even = normaliseDesign({ ...pot, pattern: { ...pot.pattern, slant: { cells: -2, perFacet: false, toCells: 2 } } });
  const evenNodes = (dd) => { const l = createWallModel(dd, library).pattern; return Array.from({ length: N }, (_, j) => l.at(i, j / N)); };
  assert.notDeepEqual(evenNodes(d), evenNodes(even), 'per facet differs from even');
  // Without Facets the toggle does nothing: the even slant applies.
  const lobes = normaliseDesign({ ...pot, form: { ...pot.form, morph: { map: 'lib:lobes@1', softnessMm: 24, strengthMm: 4, repeats: 4, blend: 1 } } });
  const lobesEven = normaliseDesign({ ...lobes, pattern: { ...lobes.pattern, slant: { cells: -2, perFacet: false, toCells: 2 } } });
  assert.deepEqual(evenNodes(lobes), evenNodes(lobesEven));
});

test('a faceted, slanted pot previews the same twice and has no lone spikes at facet edges', () => {
  const pot = faceted({ irregularity: 0.5 });
  pot.assets = { 'user:hatch': { kind: 'recipe', name: 'Hatch', recipe: { kind: 'bitmap', columns: 8, rows: 1, cells: '+++++---' } } };
  pot.pattern = {
    drawing: 'user:hatch', depthMm: 4, density: { by: 'spacing', points: 96, spacingMm: 2 }, fromMm: 0, toMm: 280,
    fade: { shape: 'even', amount: 1 }, softenCells: 0, slant: { cells: -2.5, perFacet: true, toCells: 2.5 },
  };
  const d = normaliseDesign(pot);
  const a = computePreview(d, { library });
  const b = computePreview(d, { library });
  assert.deepEqual(a.positions, b.positions);
  const p = a.positions;
  const k = a.kinds;
  let reversals = 0;
  for (let i = 1; i < k.length - 1; i++) {
    if (k[i] !== KIND.outer || k[i + 1] !== KIND.outer) continue;
    const ax = p[3 * i] - p[3 * i - 3];
    const ay = p[3 * i + 1] - p[3 * i - 2];
    const bx = p[3 * i + 3] - p[3 * i];
    const by = p[3 * i + 4] - p[3 * i + 1];
    if ((ax * bx + ay * by) / Math.hypot(ax, ay) / Math.hypot(bx, by) < -0.5) reversals++;
  }
  assert.equal(reversals, 0);
});
