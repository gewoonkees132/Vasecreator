// Phase 2 core: assets, user recipes, image patterns, geometry morph, rasters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, MAX_ASSETS, defaultDesign, designsEqual, normaliseDesign } from '../core/design.js';
import { computePreview, computePrint, emitGcode } from '../core/engine.js';
import { MORPH_MAPS, evaluateMorphMap } from '../core/morph.js';
import { hashRaster, printableResolution, rasterFromRGBA } from '../core/raster.js';
import { buildToolpath, createWallModel } from '../core/toolpath.js';
import { cylinder, library } from './support/fixtures.js';

const HASH = '0123456789abcdef';

/** A raster of vertical stripes: `stripes` white/black pairs across. */
function stripes(width, height, count) {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = Math.floor((x * 2 * count) / width) % 2 === 0 ? 255 : 0;
  }
  return { width, height, data };
}

/** A smooth deterministic test image. */
function noise(width, height) {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (Math.imul(i, 2654435761) >>> 24) & 0xff;
  return { width, height, data };
}

function imageDesign(raster, hash, slot = {}) {
  const d = defaultDesign();
  d.assets = { [`img:${hash}`]: { kind: 'image', name: 'test.png', hash, width: raster.width, height: raster.height } };
  d.form.detail.a = { pattern: `img:${hash}`, depthMm: 2, repeats: 2, tileHeightMm: 19.5, ...slot };
  return d;
}

test('normaliseDesign keeps valid assets and drops bad ones', () => {
  const n = normaliseDesign({
    ...defaultDesign(),
    assets: {
      'user:ribs': { kind: 'recipe', name: '  My ribs ', recipe: { kind: 'bitmap', columns: 3, rows: 2, cells: '+-0-+0', edges: 'soft' } },
      'user:bad': { kind: 'recipe', name: 'Bad', recipe: { kind: 'bitmap', columns: 1, rows: 1, cells: '5' } },
      'user:unknown': { kind: 'recipe', recipe: { kind: 'shape', shape: 'nope' } },
      [`img:${HASH}`]: { kind: 'image', name: 'bark.jpg', hash: HASH, width: 256, height: 128 },
      'img:short': { kind: 'image', hash: 'abc', width: 10, height: 10 },
      'img:fedcba9876543210': { kind: 'image', hash: 'fedcba9876543210', width: 0, height: 10 },
      'img:1111111111111111': { kind: 'image', hash: '2222222222222222', width: 10, height: 10 },
      weird: 3,
    },
  });
  assert.deepEqual(Object.keys(n.assets), ['user:ribs', `img:${HASH}`]);
  assert.equal(n.assets['user:ribs'].name, 'My ribs');
  assert.deepEqual(n.assets[`img:${HASH}`], { kind: 'image', name: 'bark.jpg', hash: HASH, width: 256, height: 128 });
  assert.deepEqual(normaliseDesign({ ...defaultDesign(), assets: [1, 2] }).assets, {});
  const many = {};
  for (let i = 0; i < 40; i++) many[`user:p${i}`] = { kind: 'recipe', name: 'p', recipe: { kind: 'shape', shape: 'flutes' } };
  assert.equal(Object.keys(normaliseDesign({ ...defaultDesign(), assets: many }).assets).length, MAX_ASSETS);
  // A slot that points at a missing asset is kept; the toolpath reports it.
  const d = defaultDesign();
  d.form.detail.a.pattern = 'user:gone';
  assert.equal(normaliseDesign(d).form.detail.a.pattern, 'user:gone');
});

test('normaliseDesign fills and clamps the morph', () => {
  assert.equal(normaliseDesign(defaultDesign()).form.morph, null);
  const d = defaultDesign();
  d.form.morph = { map: 'lib:lobes@1', softnessMm: 500, strengthMm: -3, repeats: 3.6, blend: 2 };
  assert.deepEqual(normaliseDesign(d).form.morph, {
    map: 'lib:lobes@1', softnessMm: LIMITS.morphSoftnessMm.max, strengthMm: 0, repeats: 4, blend: 1,
  });
  d.form.morph = { map: 'lib:lobes@1', repeats: 99 };
  assert.deepEqual(normaliseDesign(d).form.morph, { map: 'lib:lobes@1', softnessMm: 24, strengthMm: 16, repeats: 24, blend: 0.8 });
  for (const bad of [{ map: 'lib:nothing@1' }, { map: 7 }, 'lobes', [1], { map: 'img:xyz' }]) {
    d.form.morph = bad;
    assert.equal(normaliseDesign(d).form.morph, null, JSON.stringify(bad));
  }
  d.form.morph = { map: `img:${HASH}` };
  assert.equal(normaliseDesign(d).form.morph.map, `img:${HASH}`, 'kept even without its asset');
  // Empty phase 2 fields equal their absence.
  const old = defaultDesign();
  delete old.assets;
  delete old.form.morph;
  assert.ok(designsEqual(old, normaliseDesign(old)));
});

test('a user recipe slot prints exactly like the same recipe from the library', () => {
  const lib = defaultDesign();
  const entry = library.patterns.find((p) => p.id === lib.form.detail.a.pattern);
  const user = defaultDesign();
  user.assets = { 'user:mine': { kind: 'recipe', name: 'Mine', recipe: structuredClone(entry.recipe) } };
  user.form.detail.a.pattern = 'user:mine';
  const a = computePreview(lib, { library });
  const b = computePreview(user, { library });
  assert.deepEqual(b.positions, a.positions);
  assert.ok(!b.warnings.some((w) => w.id === 'missingPattern'));
  // Without its asset the slot prints plain and says so.
  delete user.assets['user:mine'];
  const c = computePreview(user, { library });
  assert.ok(c.warnings.some((w) => w.id === 'missingPattern'));
});

test('an image of 8 stripes at 2 repeats prints like 16 flutes, seamless at u = 0 and 1', () => {
  const raster = stripes(256, 64, 8);
  const hash = hashRaster(raster);
  const d = normaliseDesign(imageDesign(raster, hash));
  const images = new Map([[hash, raster]]);
  const m = createWallModel(d, library, { images });
  assert.deepEqual(m.missingImages, []);
  assert.equal(m.slots[0].features.around, 8);
  const z = 80;
  const n = 1024;
  let crossings = 0;
  let previous = Math.sign(m.displacement(z, 0.25 / n));
  for (let k = 1; k <= n; k++) {
    const sign = Math.sign(m.displacement(z, (k + 0.25) / n)); // k = n closes the loop
    if (sign !== 0 && previous !== 0 && sign !== previous) crossings++;
    if (sign !== 0) previous = sign;
  }
  assert.equal(crossings, 32, '16 bumps around: 32 sign changes');
  assert.ok(Math.abs(m.displacement(z, 0) - m.displacement(z, 1)) < 1e-12, 'seamless');
  assert.ok(Math.abs(m.displacement(z, 1e-7) - m.displacement(z, 1 - 1e-7)) < 1e-3);
  // White (stripe 0 starts white) pushes out, black pulls in.
  assert.ok(m.displacement(z, 0.25 / 16) > 0 && m.displacement(z, 0.75 / 16) < 0);
  const tp = buildToolpath(d, library, { images });
  const layer = 12;
  const count = tp.layerStarts[layer + 1] - tp.layerStarts[layer];
  assert.ok(count >= 8 * 16, `points per layer ${count}`);
});

test('a missing image prints plain, warns, and blocks export', () => {
  const raster = stripes(64, 64, 4);
  const hash = hashRaster(raster);
  const d = imageDesign(raster, hash);
  const plain = defaultDesign();
  plain.form.detail.a = { ...d.form.detail.a, pattern: 'plain' };
  const preview = computePreview(d, { library, images: new Map() });
  const warning = preview.warnings.find((w) => w.id === 'missingImage');
  assert.equal(warning?.severity, 'warning');
  assert.equal(warning.message, 'An image pattern is missing on this device');
  assert.deepEqual(preview.positions, computePreview(plain, { library }).positions);
  const print = computePrint(d, { library, images: new Map() });
  assert.equal(print.checks.find((c) => c.id === 'missingImage')?.severity, 'error');
  assert.equal(print.canExport, false);
  const ok = computePrint(d, { library, images: new Map([[hash, raster]]) });
  assert.ok(!ok.checks.some((c) => c.id === 'missingImage'));
  assert.equal(ok.canExport, true);
  // A morph map image that is missing reports the same way.
  const morph = defaultDesign();
  morph.form.morph = { map: `img:${hash}`, softnessMm: 10, strengthMm: 10, repeats: 2, blend: 1 };
  assert.ok(computePreview(morph, { library }).warnings.some((w) => w.id === 'missingImage'));
});

test('every built-in morph map stays in −1…1 and is seamless around', () => {
  assert.deepEqual(MORPH_MAPS.map((m) => m.id), ['lib:lobes@1', 'lib:lean@1', 'lib:waist@1', 'lib:swirl@1', 'lib:blobs@1']);
  for (const { id } of MORPH_MAPS) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 64; i++) {
      for (let j = 0; j <= 200; j++) {
        const v = evaluateMorphMap(id, j / 200, i / 64);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      const v = i / 64;
      assert.ok(Math.abs(evaluateMorphMap(id, 0, v) - evaluateMorphMap(id, 1, v)) < 1e-12, `${id} seam at v ${v}`);
      assert.ok(Math.abs(evaluateMorphMap(id, 1e-6, v) - evaluateMorphMap(id, 1 - 1e-6, v)) < 1e-3, `${id} continuous at v ${v}`);
    }
    assert.ok(lo >= -1 && hi <= 1, `${id} range ${lo}…${hi}`);
    assert.ok(hi - lo > 0.5, `${id} does something`);
  }
  // Repeats are whole, so the morph of a design is seamless round the pot too.
  const d = defaultDesign();
  d.form.morph = { map: 'lib:blobs@1', softnessMm: 24, strengthMm: 10, repeats: 3, blend: 1 };
  const m = createWallModel(normaliseDesign(d), library);
  for (const z of [10, 60, 150]) assert.ok(Math.abs(m.morphAt(z, 0) - m.morphAt(z, 1)) < 1e-12);
});

test('the morph changes the size and can lean past the overhang limit', () => {
  const base = cylinder({ height: 120, radius: 40 });
  const before = computePreview(base, { library });
  const lobes = structuredClone(base);
  // Two lobes: both ends of the x axis push out by the strength.
  lobes.form.morph = { map: 'lib:lobes@1', softnessMm: 24, strengthMm: 10, repeats: 2, blend: 1 };
  const after = computePreview(lobes, { library });
  assert.ok(Math.abs(after.size.widthMm - before.size.widthMm - 20) < 0.5, `width ${before.size.widthMm} → ${after.size.widthMm}`);
  assert.ok(!before.warnings.some((w) => w.id === 'overhang'));
  assert.ok(!after.warnings.some((w) => w.id === 'overhang'), 'lobes are vertical');
  // A strong lean over a short pot steps out more than the limit per layer.
  const lean = cylinder({ height: 40, radius: 40 });
  lean.form.morph = { map: 'lib:lean@1', softnessMm: 0, strengthMm: 60, repeats: 1, blend: 1 };
  const leaning = computePreview(lean, { library });
  assert.ok(leaning.warnings.some((w) => w.id === 'overhang'));
  // The base follows the morph: base points reach the lobes.
  const tp = buildToolpath(normaliseDesign(lobes), library);
  assert.ok(Math.abs(tp.path[0]) < 60, 'spiral centre inside');
  // A morph pulling in further than the minimum radius clamps and warns.
  const thin = cylinder({ height: 60, radius: 12 });
  thin.form.morph = { map: 'lib:waist@1', softnessMm: 0, strengthMm: 20, repeats: 1, blend: 1 };
  assert.ok(computePreview(thin, { library }).warnings.some((w) => w.id === 'narrow'));
});

test('an image morph is blurred, clamped in v and seamless', () => {
  const raster = noise(128, 128);
  const hash = hashRaster(raster);
  const d = defaultDesign();
  d.assets = { [`img:${hash}`]: { kind: 'image', name: 'n', hash, width: 128, height: 128 } };
  d.form.morph = { map: `img:${hash}`, softnessMm: 30, strengthMm: 10, repeats: 2, blend: 1 };
  const m = createWallModel(normaliseDesign(d), library, { images: new Map([[hash, raster]]) });
  let lo = Infinity;
  let hi = -Infinity;
  for (let z = 0; z <= 170; z += 5) {
    assert.ok(Math.abs(m.morphAt(z, 0) - m.morphAt(z, 1)) < 1e-9);
    for (let k = 0; k < 64; k++) {
      const v = m.morphAt(z, k / 64);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  assert.ok(hi <= 10 && lo >= -10);
  assert.ok(hi - lo < 10, `blurred noise is gentle: ${lo}…${hi}`);
});

test('rasters: luminance, downscaling, hash and printable resolution', () => {
  const rgba = new Uint8Array(4 * 4 * 2);
  for (let i = 0; i < 8; i++) rgba.set(i < 4 ? [255, 255, 255, 0] : [0, 0, 0, 255], 4 * i);
  const r = rasterFromRGBA(rgba, 4, 2);
  assert.deepEqual([...r.data], [255, 255, 255, 255, 0, 0, 0, 0]);
  const grey = rasterFromRGBA(new Uint8Array([128, 128, 128, 255]), 1, 1);
  assert.equal(grey.data[0], 128, 'grey stays grey');
  const green = rasterFromRGBA(new Uint8Array([0, 255, 0, 255]), 1, 1);
  assert.ok(green.data[0] > 200 && green.data[0] < 240, `green ${green.data[0]}`);
  // Half black, half white averages in linear light: brighter than code 128.
  const big = new Uint8Array(4 * 1024 * 2);
  for (let i = 0; i < 2048; i++) big.fill(i % 2 ? 255 : 0, 4 * i, 4 * i + 3);
  const small = rasterFromRGBA(big, 1024, 2, 512);
  assert.equal(small.width, 512);
  assert.equal(small.height, 1);
  assert.ok(small.data[0] > 180 && small.data[0] < 195, `mixed ${small.data[0]}`);
  // FNV-1a 64, checked against BigInt.
  const raster = noise(37, 11);
  let h = 0xcbf29ce484222325n;
  const bytes = [37, 0, 0, 0, 11, 0, 0, 0, ...raster.data];
  for (const b of bytes) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  assert.equal(hashRaster(raster), h.toString(16).padStart(16, '0'));
  assert.match(hashRaster(raster), /^[0-9a-f]{16}$/);
  assert.notEqual(hashRaster(noise(11, 37)), hashRaster(raster));
  // Research §6.3: ⌀100 mm, 4 tiles around, H 150, w 4, h 1.5 → ~39 × 100.
  assert.deepEqual(
    printableResolution({ repeats: 4, tileHeightMm: 150 }, 100 * 3.141592653589793, { beadWidthMm: 4, layerHeightMm: 1.5 }),
    { around: 39, up: 100 },
  );
});

test('the same design with an image and a morph writes the same G-code twice', () => {
  const raster = noise(256, 256);
  const hash = hashRaster(raster);
  const d = imageDesign(raster, hash);
  d.assets[`img:${hash}`].name = 'noise';
  d.form.morph = { map: 'lib:swirl@1', softnessMm: 24, strengthMm: 8, repeats: 3, blend: 0.8 };
  const run = () => emitGcode(d, null, null, { library, images: new Map([[hash, { ...raster, data: raster.data.slice() }]]) }).join('');
  const a = run();
  assert.equal(run(), a);
  assert.match(a, /"morph":\{"map":"lib:swirl@1"/);
});

test('a 170 mm pot with a 256² image on A and a morph previews quickly', () => {
  const raster = noise(256, 256);
  const hash = hashRaster(raster);
  const d = imageDesign(raster, hash, { repeats: 6 });
  d.form.morph = { map: 'lib:lobes@1', softnessMm: 24, strengthMm: 10, repeats: 4, blend: 0.8 };
  const images = new Map([[hash, raster]]);
  computePreview(d, { library, images }); // warm the prefilter cache and the JIT
  let best = Infinity;
  for (let k = 0; k < 3; k++) best = Math.min(best, computePreview(d, { library, images }).computeMs);
  assert.ok(best < 80, `preview took ${best.toFixed(1)} ms`);
});
