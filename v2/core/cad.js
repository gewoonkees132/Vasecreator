// CAD export (issue #7): plain file formats written here, with no library.
//
//   writeDxf(tp)   the nozzle path as 3D polylines in a DXF (R12, ASCII), one
//                  polyline per layer and kind, on the layers WALL_OUTER,
//                  WALL_INNER, BASE and CONNECTOR. Millimetres, the pot's axis
//                  on the origin, z up from the bed. Rhino, Grasshopper and
//                  most CAD programs open it with the layers intact. (A .3dm
//                  file would need rhino3dm.js, several MB of WebAssembly.)
//   buildSolid()   a closed triangle mesh of the finished pot: the outer and
//                  inner skin of the wall, the rim, and the base with its
//                  hole. writeStl() writes it as binary STL.
//
// The solid is built on the same centreline as the toolpath
// (createWallModel().centrePoint), sampled once per layer height and offset by
// half a bead to each side along the outline's normal in plan, the way a bead
// is wide sideways. Layer lines are not modelled: the skins are smooth. Where
// the fine-pattern warning shows (a curve tighter than half a bead), the
// offset skin can fold over itself.

import { TAU, dcos, dsin, datan2 } from './math.js';
import { KIND, createWallModel, pointsAround } from './toolpath.js';

// ---------- DXF ----------

const DXF_LAYERS = [
  { kind: KIND.outer, name: 'WALL_OUTER', colour: 7 },
  { kind: KIND.inner, name: 'WALL_INNER', colour: 5 },
  { kind: KIND.base, name: 'BASE', colour: 3 },
  { kind: KIND.connector, name: 'CONNECTOR', colour: 1 },
];

const num = (v) => {
  const s = v.toFixed(3);
  return s === '-0.000' ? '0.000' : s;
};

/**
 * The toolpath as DXF text: a 3D POLYLINE for every run of one kind within a
 * layer. Moves without clay (kind 0) break the runs and are not drawn.
 * @param {{ path: Float64Array, kinds: Uint8Array, layerOf: Uint16Array, pointCount: number }} tp from buildToolpath
 * @param {{ name?: string }} [options]
 * @returns {string[]} chunks to join or put in a Blob
 */
export function writeDxf(tp, { name = 'Vasecreator' } = {}) {
  const chunks = [];
  const pair = (code, value) => `${code}\n${value}\n`;
  chunks.push(
    pair(999, `${String(name).replace(/[\r\n]+/g, ' ')}, toolpath from Vasecreator, millimetres`)
    + pair(0, 'SECTION') + pair(2, 'HEADER')
    + pair(9, '$ACADVER') + pair(1, 'AC1009')
    + pair(9, '$INSUNITS') + pair(70, 4)
    + pair(9, '$MEASUREMENT') + pair(70, 1)
    + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'TABLES')
    + pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 1)
    + pair(0, 'LTYPE') + pair(2, 'CONTINUOUS') + pair(70, 0) + pair(3, 'Solid line') + pair(72, 65) + pair(73, 0) + pair(40, '0.0')
    + pair(0, 'ENDTAB')
    + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, DXF_LAYERS.length)
    + DXF_LAYERS.map((l) => pair(0, 'LAYER') + pair(2, l.name) + pair(70, 0) + pair(62, l.colour) + pair(6, 'CONTINUOUS')).join('')
    + pair(0, 'ENDTAB')
    + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'ENTITIES'),
  );

  const layerName = new Map(DXF_LAYERS.map((l) => [l.kind, l.name]));
  const { path, kinds, layerOf } = tp;
  const n = tp.pointCount ?? kinds.length;
  const vertex = (layer, i) => pair(0, 'VERTEX') + pair(8, layer)
    + pair(10, num(path[3 * i])) + pair(20, num(path[3 * i + 1])) + pair(30, num(path[3 * i + 2])) + pair(70, 32);

  let i = 1;
  while (i < n) {
    const kind = kinds[i];
    const layer = layerName.get(kind);
    if (!layer) { i += 1; continue; }
    // The run: moves i..end of this kind in this layer, drawn from point i − 1.
    let end = i;
    while (end + 1 < n && kinds[end + 1] === kind && layerOf[end + 1] === layerOf[i]) end += 1;
    let text = pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1)
      + pair(10, '0.0') + pair(20, '0.0') + pair(30, '0.0') + pair(70, 8);
    for (let p = i - 1; p <= end; p++) text += vertex(layer, p);
    text += pair(0, 'SEQEND') + pair(8, layer);
    chunks.push(text);
    i = end + 1;
  }
  chunks.push(pair(0, 'ENDSEC') + pair(0, 'EOF'));
  return chunks;
}

// ---------- Solid ----------

/** Triangles the solid may have, about 30 MB of STL; past it, fewer points per ring. */
export const MAX_SOLID_TRIANGLES = 600_000;
const MIN_RING = 64;
const MAX_RING = 1024;

// Offsets a closed ring (x, y pairs, counter-clockwise) by `by` mm along its
// outward normal in plan, the normal taken from the neighbours on both sides.
function offsetRing(ring, by, out) {
  const n = ring.length / 2;
  for (let j = 0; j < n; j++) {
    const a = ((j + n - 1) % n) * 2;
    const b = ((j + 1) % n) * 2;
    const tx = ring[b] - ring[a];
    const ty = ring[b + 1] - ring[a + 1];
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    out[2 * j] = ring[2 * j] + (ty / len) * by;
    out[2 * j + 1] = ring[2 * j + 1] - (tx / len) * by;
  }
  return out;
}

/**
 * A closed, outward-facing triangle mesh of the finished pot.
 * @param {object} design a normalised design
 * @param {{ patterns: object[] }} library
 * @param {{ images?: Map<string, object>, maxTriangles?: number }} [options]
 * @returns {{ positions: Float64Array, triangles: Uint32Array, vertexCount: number, triangleCount: number,
 *   ringPoints: number, layers: number }}
 */
export function buildSolid(design, library, { images, maxTriangles = MAX_SOLID_TRIANGLES } = {}) {
  const m = createWallModel(design, library, { images });
  const { h, w, layerCount: L, baseLayers: nb, rMin } = m;
  const walls = design.finish.walls === 2 ? 2 : 1;
  const spacing = design.finish.wallSpacingMm;
  const smoothInner = design.finish.innerWall !== 'follow';
  const holeR = nb > 0 ? Math.max(0, (design.base.hole?.diameter ?? 0) / 2) : 0;
  const k0 = nb > 0 ? nb : 0; // the first inner ring: the floor's top, or the bottom of a sleeve

  // One ring count for every height, so the skins are plain quad strips:
  // the most the toolpath uses on any layer, within the triangle budget.
  let N = MIN_RING;
  for (let i = 0; i < L; i++) N = Math.max(N, pointsAround(m, i * h, (i + 1) * h, MAX_RING).n);
  const rows = (L + 1) + (L + 1 - k0);
  N = Math.max(MIN_RING, Math.min(N, Math.floor(maxTriangles / (2 * rows + 6))));
  const holeN = holeR > 0 ? Math.max(32, Math.min(256, Math.ceil((TAU * holeR) / (w / 2)))) : 0;

  const vertexCount = rows * N + (holeR > 0 ? 2 * holeN : nb > 0 ? 2 : 0);
  const positions = new Float64Array(vertexCount * 3);
  let vi = 0;
  const addVertex = (x, y, z) => {
    positions[3 * vi] = x;
    positions[3 * vi + 1] = y;
    positions[3 * vi + 2] = z;
    return vi++;
  };

  const centreRing = new Float64Array(2 * N);
  const skin = new Float64Array(2 * N);
  const innerCentre = new Float64Array(2 * N);
  const outerStart = [];
  const innerStart = [];
  const floor = Math.max(rMin - spacing, w / 2);
  for (let k = 0; k <= L; k++) {
    const z = k * h;
    let minD = Infinity;
    for (let j = 0; j < N; j++) {
      const c = m.centrePoint(j / N, z);
      centreRing[2 * j] = c.x;
      centreRing[2 * j + 1] = c.y;
      if (c.D < minD) minD = c.D;
    }
    outerStart.push(vi);
    offsetRing(centreRing, w / 2, skin);
    for (let j = 0; j < N; j++) addVertex(skin[2 * j], skin[2 * j + 1], z);
    if (k < k0) continue;
    // The inner skin: half a bead inside the innermost wall. With two walls
    // that is the inner wall, placed as in buildToolpath's innerLoop.
    if (walls === 2) {
      for (let j = 0; j < N; j++) {
        const c = m.centrePoint(j / N, z);
        // Moved in along the same direction from the axis: smooth sits behind
        // the ring's deepest groove, follow keeps the pattern (D27).
        let radius = c.radius - c.D + (smoothInner ? minD : c.D) - spacing;
        if (radius < floor) radius = floor;
        const s = radius / c.radius;
        innerCentre[2 * j] = c.x * s;
        innerCentre[2 * j + 1] = c.y * s;
      }
      offsetRing(innerCentre, -w / 2, skin);
    } else {
      offsetRing(centreRing, -w / 2, skin);
    }
    innerStart.push(vi);
    for (let j = 0; j < N; j++) addVertex(skin[2 * j], skin[2 * j + 1], z);
  }

  const tris = [];
  const tri = (a, b, c) => { tris.push(a, b, c); };
  const next = (j) => (j + 1) % N;

  // Outer skin faces out, inner skin faces the axis.
  for (let k = 0; k < L; k++) {
    const a = outerStart[k];
    const b = outerStart[k + 1];
    for (let j = 0; j < N; j++) {
      tri(a + j, a + next(j), b + next(j));
      tri(a + j, b + next(j), b + j);
    }
  }
  for (let k = 0; k < L - k0; k++) {
    const a = innerStart[k];
    const b = innerStart[k + 1];
    for (let j = 0; j < N; j++) {
      tri(a + j, b + next(j), a + next(j));
      tri(a + j, b + j, b + next(j));
    }
  }
  // An annulus between an outer ring and an inner ring with the same points:
  // up = true faces +z (the rim), else -z (the bottom of a sleeve).
  const strip = (outer, inner, up) => {
    for (let j = 0; j < N; j++) {
      if (up) {
        tri(outer + j, outer + next(j), inner + next(j));
        tri(outer + j, inner + next(j), inner + j);
      } else {
        tri(outer + j, inner + next(j), outer + next(j));
        tri(outer + j, inner + j, inner + next(j));
      }
    }
  };
  strip(outerStart[L], innerStart[L - k0], true);

  if (nb === 0) {
    strip(outerStart[0], innerStart[0], false);
  } else if (holeR > 0) {
    // The hole: a cylinder through the base, and the bottom and the floor
    // stitched to it by angle (zipRings).
    const bottom = vi;
    for (let j = 0; j < holeN; j++) addVertex(holeR * dcos((TAU * j) / holeN), holeR * dsin((TAU * j) / holeN), 0);
    const top = vi;
    for (let j = 0; j < holeN; j++) addVertex(holeR * dcos((TAU * j) / holeN), holeR * dsin((TAU * j) / holeN), nb * h);
    for (let j = 0; j < holeN; j++) {
      const jn = (j + 1) % holeN;
      tri(bottom + j, top + jn, bottom + jn);
      tri(bottom + j, top + j, top + jn);
    }
    zipRings(positions, outerStart[0], N, bottom, holeN, false, tri);
    zipRings(positions, innerStart[0], N, top, holeN, true, tri);
  } else {
    const c0 = addVertex(0, 0, 0);
    const c1 = addVertex(0, 0, nb * h);
    const a = outerStart[0];
    const b = innerStart[0];
    for (let j = 0; j < N; j++) {
      tri(c0, a + next(j), a + j);
      tri(c1, b + j, b + next(j));
    }
  }

  const triangles = Uint32Array.from(tris);
  return { positions, triangles, vertexCount: vi, triangleCount: triangles.length / 3, ringPoints: N, layers: L };
}

// Triangulates the annulus between an outer ring (nA points from a) and an
// inner ring (nB points from b), both counter-clockwise around the axis, by
// walking them together in angle. up faces +z, else -z.
function zipRings(pos, a, nA, b, nB, up, tri) {
  const angle = (v) => datan2(pos[3 * v + 1], pos[3 * v]);
  const start = angle(a);
  const rel = (v) => {
    let t = angle(v) - start;
    while (t < 0) t += TAU;
    while (t >= TAU) t -= TAU;
    return t;
  };
  // The inner ring starts at its point with the smallest angle past the outer start.
  let b0 = 0;
  for (let j = 1; j < nB; j++) if (rel(b + j) < rel(b + b0)) b0 = j;
  const A = (i) => a + (i % nA);
  const B = (j) => b + ((b0 + j) % nB);
  const tA = (i) => (i >= nA ? TAU + rel(A(i)) : rel(A(i)));
  const tB = (j) => (j >= nB ? TAU + rel(B(j)) : rel(B(j)));
  let i = 0;
  let j = 0;
  while (i < nA || j < nB) {
    const advanceA = j >= nB || (i < nA && tA(i + 1) <= tB(j + 1));
    if (advanceA) {
      if (up) tri(A(i), A(i + 1), B(j)); else tri(A(i), B(j), A(i + 1));
      i += 1;
    } else {
      if (up) tri(A(i), B(j + 1), B(j)); else tri(A(i), B(j), B(j + 1));
      j += 1;
    }
  }
}

/**
 * Binary STL of a mesh from buildSolid. Units are millimetres (STL has none;
 * mm is the usual reading).
 * @param {{ positions: Float64Array, triangles: Uint32Array }} mesh
 * @param {{ name?: string }} [options]
 * @returns {ArrayBuffer}
 */
export function writeStl(mesh, { name = 'Vasecreator' } = {}) {
  const { positions: p, triangles: t } = mesh;
  const count = t.length / 3;
  const buffer = new ArrayBuffer(84 + 50 * count);
  const view = new DataView(buffer);
  // The header must not start with "solid", or some readers take it for ASCII STL.
  const header = `Vasecreator binary STL, mm: ${String(name)}`.replace(/[^\x20-\x7e]/g, '?').slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, count, true);
  let o = 84;
  for (let f = 0; f < count; f++) {
    const a = 3 * t[3 * f];
    const b = 3 * t[3 * f + 1];
    const c = 3 * t[3 * f + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    view.setFloat32(o + 12, p[a], true); view.setFloat32(o + 16, p[a + 1], true); view.setFloat32(o + 20, p[a + 2], true);
    view.setFloat32(o + 24, p[b], true); view.setFloat32(o + 28, p[b + 1], true); view.setFloat32(o + 32, p[b + 2], true);
    view.setFloat32(o + 36, p[c], true); view.setFloat32(o + 40, p[c + 1], true); view.setFloat32(o + 44, p[c + 2], true);
    view.setUint16(o + 48, 0, true);
    o += 50;
  }
  return buffer;
}
