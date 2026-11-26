// CAD export (issue #7): the toolpath as one continuous DXF polyline, a closed solid as STL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDesign } from '../core/design.js';
import { buildToolpath } from '../core/toolpath.js';
import { writeDxf, buildSolid, writeStl } from '../core/cad.js';
import { exportCad } from '../core/engine.js';
import { library, presets, cylinder, withPattern, TILES } from './support/fixtures.js';

// ---------- DXF ----------

function parseDxf(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  assert.equal(lines.length % 2, 0, 'group codes and values come in pairs');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    assert.match(lines[i], /^\d+$/, `line ${i + 1} is a group code`);
    pairs.push([Number(lines[i]), lines[i + 1]]);
  }
  return pairs;
}

// Polylines and their vertices as { layer, points: [[x, y, z]] }.
function polylines(pairs) {
  const out = [];
  let current = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code !== 0) continue;
    if (value === 'POLYLINE') current = { layer: pairs[i + 1][1], points: [] };
    else if (value === 'VERTEX') {
      const get = (c) => Number(pairs.slice(i + 1, i + 12).find(([k]) => k === c)[1]);
      current.points.push([get(10), get(20), get(30)]);
    } else if (value === 'SEQEND') { out.push(current); current = null; }
  }
  return out;
}

test('DXF: a well-formed R12 file with one open 3D polyline on TOOLPATH', () => {
  const d = normaliseDesign(presets[0]);
  d.finish.walls = 2;
  const text = writeDxf(buildToolpath(d, library, { walls: 2 }), { name: 'Classic vase' }).join('');
  const pairs = parseDxf(text);
  const values = pairs.filter(([c]) => c === 0).map(([, v]) => v);
  assert.equal(values[0], 'SECTION');
  assert.equal(values.at(-1), 'EOF');
  assert.equal(values.filter((v) => v === 'SECTION').length, values.filter((v) => v === 'ENDSEC').length);
  assert.equal(values.filter((v) => v === 'LAYER').length, 1);
  assert.equal(values.filter((v) => v === 'POLYLINE').length, 1, 'one continuous line');
  assert.equal(values.filter((v) => v === 'SEQEND').length, 1);
  const at = pairs.findIndex(([c, v]) => c === 0 && v === 'POLYLINE');
  const flags = pairs.slice(at + 1).find(([c]) => c === 70)[1];
  assert.equal(Number(flags), 8, '3D, open');
  assert.equal(polylines(pairs)[0].layer, 'TOOLPATH');
});

for (const [label, walls] of [['one wall', 1], ['two walls', 2]]) {
  test(`DXF: ${label}, every point of the path in print order, with no gap`, () => {
    const d = normaliseDesign(presets[1]);
    const tp = buildToolpath(d, library, { walls });
    const [line] = polylines(parseDxf(writeDxf(tp).join('')));
    assert.equal(line.points.length, tp.pointCount);
    for (let i = 0; i < tp.pointCount; i++) {
      for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(line.points[i][k] - tp.path[3 * i + k]) <= 0.0005, `point ${i}`);
      }
    }
    // It starts on the bed and ends at the top layer.
    assert.ok(line.points[0][2] <= d.layers.layerHeightMm + 1e-9);
    assert.ok(Math.abs(line.points.at(-1)[2] - tp.layerZ.at(-1)) <= 0.0005);
  });
}

// ---------- Solid ----------

// Closed and consistently oriented: every directed edge appears once, and so
// does its reverse.
function assertClosed(mesh, label) {
  const edges = new Map();
  const t = mesh.triangles;
  for (let f = 0; f < t.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = t[f + e];
      const b = t[f + ((e + 1) % 3)];
      assert.notEqual(a, b, `${label}: degenerate triangle ${f / 3}`);
      const key = `${a},${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of edges) {
    assert.equal(count, 1, `${label}: edge ${key} used ${count} times`);
    const [a, b] = key.split(',');
    assert.equal(edges.get(`${b},${a}`), 1, `${label}: edge ${key} has no partner`);
  }
}

function volume(mesh) {
  const p = mesh.positions;
  const t = mesh.triangles;
  let v = 0;
  for (let f = 0; f < t.length; f += 3) {
    const a = 3 * t[f], b = 3 * t[f + 1], c = 3 * t[f + 2];
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

const cases = [
  ...presets.map((p) => [p.meta?.name, normaliseDesign(p)]),
  ['two smooth walls', (() => { const d = normaliseDesign(presets[0]); d.finish.walls = 2; return d; })()],
  ['two walls that follow', (() => { const d = normaliseDesign(presets[2]); d.finish.walls = 2; d.finish.innerWall = 'follow'; return d; })()],
  ['a sleeve (no base)', normaliseDesign(cylinder({ baseLayers: 0 }))],
  ['a base with a hole', (() => { const d = normaliseDesign(cylinder({ baseLayers: 3 })); d.base.hole = { diameter: 20 }; return d; })()],
  ['a Pattern, two walls', (() => { const d = normaliseDesign(withPattern(structuredClone(presets[0]), TILES.knit, { fromMm: 10, toMm: 150 })); d.finish.walls = 2; return d; })()],
];

for (const [label, design] of cases) {
  test(`solid: ${label} is closed, faces outward and has a sensible volume`, () => {
    const mesh = buildSolid(design, library);
    assert.equal(mesh.positions.length, 3 * mesh.vertexCount);
    assertClosed(mesh, label);
    const v = volume(mesh);
    assert.ok(v > 0, `${label}: volume ${v} (negative means it faces inward)`);
  });
}

test('solid: a plain cylinder has the volume of its wall and base', () => {
  const R = 30, H = 30, nb = 2;
  const d = normaliseDesign(cylinder({ height: H, radius: R, baseLayers: nb }));
  const { beadWidthMm: w, layerHeightMm: h } = d.layers;
  const top = Math.round(H / h) * h;
  const outer = Math.PI * (R + w / 2) ** 2;
  const inner = Math.PI * (R - w / 2) ** 2;
  const want = outer * top - inner * (top - nb * h);
  const got = volume(buildSolid(d, library));
  assert.ok(Math.abs(got - want) / want < 0.005, `volume ${got.toFixed(0)} for ${want.toFixed(0)} mm³`);
  const mesh = buildSolid(d, library);
  let zMax = 0;
  for (let i = 2; i < mesh.positions.length; i += 3) zMax = Math.max(zMax, mesh.positions[i]);
  assert.ok(Math.abs(zMax - top) < 1e-9, 'the rim is the top of the last layer');

  const holed = normaliseDesign(cylinder({ height: H, radius: R, baseLayers: nb }));
  holed.base.hole = { diameter: 20 };
  const hole = Math.PI * 10 ** 2 * nb * h;
  const gotHoled = volume(buildSolid(holed, library));
  assert.ok(Math.abs(gotHoled - (want - hole)) / want < 0.005, `with a hole ${gotHoled.toFixed(0)} for ${(want - hole).toFixed(0)} mm³`);
});

test('solid: the wall is one bead wide around the toolpath centreline', () => {
  const d = normaliseDesign(cylinder({ height: 30, radius: 30, baseLayers: 1 }));
  const mesh = buildSolid(d, library);
  const w = d.layers.beadWidthMm;
  let lo = Infinity, hi = 0;
  const p = mesh.positions;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const r = Math.sqrt(p[3 * i] ** 2 + p[3 * i + 1] ** 2);
    if (r > 1) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
  }
  assert.ok(Math.abs(hi - (30 + w / 2)) < 0.01, `outer ${hi}`);
  assert.ok(Math.abs(lo - (30 - w / 2)) < 0.01, `inner ${lo}`);
});

test('solid: the triangle budget lowers the points per ring', () => {
  const d = normaliseDesign(presets[2]);
  const full = buildSolid(d, library);
  const small = buildSolid(d, library, { maxTriangles: 5_000 });
  assert.ok(small.triangleCount <= 5_000 + 2 * 256 + 2 * full.ringPoints, `${small.triangleCount} triangles`);
  assert.ok(small.ringPoints < full.ringPoints);
  assertClosed(small, 'budget');
});

test('STL: binary layout, one record per triangle, outward normals', () => {
  const d = normaliseDesign(presets[0]);
  const mesh = buildSolid(d, library);
  const buf = writeStl(mesh, { name: 'Classic vase' });
  const view = new DataView(buf);
  assert.equal(buf.byteLength, 84 + 50 * mesh.triangleCount);
  assert.equal(view.getUint32(80, true), mesh.triangleCount);
  const header = String.fromCharCode(...new Uint8Array(buf, 0, 5));
  assert.notEqual(header, 'solid', 'a binary STL must not look like ASCII');
  // The first triangle is on the outer skin at the bottom: its normal points away from the axis.
  const nx = view.getFloat32(84, true), ny = view.getFloat32(88, true);
  const cx = view.getFloat32(96, true), cy = view.getFloat32(100, true);
  assert.ok(nx * cx + ny * cy > 0);
});

test('exportCad: both formats come back as chunks with their type', () => {
  const d = normaliseDesign(presets[0]);
  const dxf = exportCad(d, 'dxf', { library });
  assert.equal(dxf.extension, 'dxf');
  assert.ok(dxf.chunks.join('').endsWith('0\nEOF\n'));
  const stl = exportCad(d, 'stl', { library });
  assert.equal(stl.extension, 'stl');
  assert.ok(stl.chunks[0] instanceof ArrayBuffer);
  assert.throws(() => exportCad(d, '3dm', { library }), TypeError);
});

test('exportCad: the same design gives the same bytes', () => {
  const d = normaliseDesign(presets[1]);
  const a = new Uint8Array(exportCad(d, 'stl', { library }).chunks[0]);
  const b = new Uint8Array(exportCad(d, 'stl', { library }).chunks[0]);
  assert.deepEqual(a, b);
});
