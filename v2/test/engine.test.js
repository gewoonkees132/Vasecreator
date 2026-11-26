import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePreview, computePrint, emitGcode } from '../core/engine.js';
import { defaultDesign } from '../core/design.js';
import { cylinder, library, presets } from './support/fixtures.js';

test('computePreview returns the PreviewResult contract', () => {
  const r = computePreview(defaultDesign(), { library });
  assert.ok(r.positions instanceof Float32Array);
  assert.ok(r.kinds instanceof Uint8Array);
  assert.ok(r.issues instanceof Uint8Array);
  assert.ok(r.profileLine instanceof Float32Array);
  assert.ok(r.seamLine instanceof Float32Array);
  assert.equal(r.positions.length, 3 * r.pointCount);
  assert.equal(r.kinds.length, r.pointCount);
  assert.equal(r.issues.length, r.pointCount);
  // The standard layer (D62): 170 mm in 34 layers of 5 mm, 2 of them the base.
  assert.equal(r.seamLine.length, 3 * (34 - 2));
  assert.equal(r.beadWidthMm, 8);
  assert.equal(r.layerHeightMm, 5);
  assert.ok(Array.isArray(r.warnings));
  assert.equal(r.size.heightMm, 170);
  assert.ok(Math.abs(r.size.widthMm - (r.bounds.max[0] - r.bounds.min[0] + 8)) < 1e-9);
  assert.ok(r.size.widthMm > 2 * 62 && r.size.widthMm < 2 * 66 + 8);
  assert.equal(typeof r.computeMs, 'number');
  assert.ok(r.kinds.every((k) => k <= 3), 'one wall in the design view');
  // Every array has its own buffer, so all can be transferred.
  const buffers = [r.positions, r.kinds, r.issues, r.profileLine, r.seamLine].map((a) => a.buffer);
  assert.equal(new Set(buffers).size, 5);
  assert.ok(buffers.every((b, i) => b.byteLength === [r.positions, r.kinds, r.issues, r.profileLine, r.seamLine][i].byteLength));
});

test('computePrint adds the final walls and the checks', () => {
  const d = defaultDesign();
  d.finish.walls = 2;
  const r = computePrint(d, { library });
  assert.ok(r.kinds.includes(2) && r.kinds.includes(4));
  assert.ok(Array.isArray(r.checks) && r.checks.length > 0);
  assert.equal(r.canExport, true);
  assert.ok(r.pointCount > computePreview(d, { library }).pointCount * 1.8);
});

test('an unknown pattern prints plain and says so', () => {
  const d = defaultDesign();
  d.pattern = { drawing: 'lib:gone@1' };
  const r = computePreview(d, { library });
  assert.ok(r.warnings.some((w) => w.id === 'missingPattern'));
});

test('the live preview is fast', () => {
  const design = presets[0];
  for (let i = 0; i < 5; i++) computePreview(design, { library });
  const times = [];
  let points = 0;
  for (let i = 0; i < 10; i++) {
    const r = computePreview(design, { library });
    times.push(r.computeMs);
    points = r.pointCount;
  }
  times.sort((a, b) => a - b);
  const median = times[5];
  const t0 = performance.now();
  const text = emitGcode(design, null, undefined, { library }).join('');
  const gcodeMs = performance.now() - t0;
  console.log(`# preview ${median.toFixed(1)} ms for ${points} points; G-code ${gcodeMs.toFixed(0)} ms, ${(text.length / 1e6).toFixed(2)} MB`);
  assert.ok(median < 250, `preview took ${median} ms`);
});

test('a burst of different designs all compute', () => {
  for (const d of [...presets, cylinder({ baseLayers: 0 }), cylinder({ walls: 2 })]) {
    const r = computePreview(d, { library });
    assert.ok(r.pointCount > 0);
  }
});
