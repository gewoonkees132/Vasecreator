// The engine facade used by the worker and by tests (ARCHITECTURE.md).
//
//   computePreview: the live loop. Centreline wall plus base, design checks.
//   computePrint:   Prepare print. Final walls, process moves, all checks.
//   emitGcode:      the G-code text, in chunks.
//   exportCad:      CAD files (issue #7): the toolpath as one DXF polyline, the solid as STL.
//
// The preview and the G-code come from the same toolpath code (research
// §5.4); the preview is that toolpath in Float32 for the GPU.

import { normaliseDesign } from './design.js';
import { normalisePrinter } from './printer.js';
import { profileLine as evaluateProfileLine } from './profile.js';
import { MAX_PREVIEW_POINTS, buildSkirt, buildToolpath } from './toolpath.js';
import { designChecks, printChecks } from './checks.js';
import { planRefills, writeGcode } from './gcode.js';
import { writeDxf, buildSolid, writeStl } from './cad.js';

export { GcodeError } from './gcode.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// The Pattern's density readout (D40): nodes per layer, the node spacing on
// the narrowest and widest layer of its range, and whether the density was
// clamped to the point cap. Null without a Pattern that prints.
function patternInfo(m) {
  const lp = m.pattern;
  if (!lp) return null;
  return {
    nodes: lp.nodes, columns: lp.columns, rows: lp.rows, repeats: lp.repeats,
    spacingMinMm: lp.spacingMinMm, spacingMaxMm: lp.spacingMaxMm, clamped: lp.clamped,
    pointsPerLayer: m.patternPoints,
  };
}

function summarise(tp, design, warnings, started) {
  const { path, pointCount } = tp;
  const w = design.layers.beadWidthMm;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const positions = new Float32Array(3 * pointCount);
  for (let i = 0; i < 3 * pointCount; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = path[i + a];
      positions[i + a] = v;
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (pointCount === 0) {
    min.fill(0);
    max.fill(0);
  }
  return {
    positions,
    kinds: tp.kinds,
    issues: tp.issues,
    beadWidthMm: w,
    layerHeightMm: design.layers.layerHeightMm,
    warnings,
    size: { heightMm: max[2], widthMm: max[0] - min[0] + w, depthMm: max[1] - min[1] + w },
    bounds: { min, max },
    profileLine: evaluateProfileLine(tp.model.profile),
    seamLine: tp.seamLine,
    pattern: patternInfo(tp.model),
    pointCount,
    computeMs: now() - started,
  };
}

/**
 * The live preview: the centreline wall and the base, with design checks.
 * @param {object} design any design JSON (normalised here)
 * @param {{ library: { patterns: object[] }, printer?: object, images?: Map<string, object> }} options
 *   images: Rasters by hash, for 'img:' patterns and morph maps
 * @returns {object} PreviewResult (ARCHITECTURE.md)
 */
export function computePreview(design, { library, printer, images } = {}) {
  const started = now();
  const d = normaliseDesign(design);
  const p = normalisePrinter(printer);
  const tp = buildToolpath(d, library, { walls: 1, maxPoints: MAX_PREVIEW_POINTS, images });
  const warnings = designChecks(tp, d, p);
  return summarise(tp, d, warnings, started);
}

/**
 * The finished print: final walls, every print-time check.
 * Besides the PreviewResult fields it carries `checks`, `canExport` and, for
 * emitGcode in the same thread, `toolpath` (the Float64 path and its layer
 * table; the worker drops it before posting).
 * @param {object} design
 * @param {{ library: { patterns: object[] }, printer?: object, images?: Map<string, object> }} options
 */
export function computePrint(design, { library, printer, images } = {}) {
  const started = now();
  const d = normaliseDesign(design);
  const p = normalisePrinter(printer);
  const tp = buildToolpath(d, library, { walls: d.finish.walls, images });
  const warnings = designChecks(tp, d, p);
  const skirt = buildSkirt(tp.model, p);
  const refills = planRefills(tp, d, p, skirt);
  const { checks, canExport } = printChecks(tp, d, p, { skirt, refills, designWarnings: warnings });
  const result = summarise(tp, d, warnings, started);
  return { ...result, checks, canExport, toolpath: { tp, skirt, refills } };
}

/**
 * G-code for a design, in chunks (header and start, one per layer, the end).
 * @param {object} design
 * @param {object | null} printResult from computePrint in this thread, or null to compute it
 * @param {object} printer
 * @param {{ library: { patterns: object[] }, images?: Map<string, object>, onProgress?: (fraction: number) => void }} options
 * @returns {string[]}
 * @throws {GcodeError} on a V16 sanity failure
 */
export function emitGcode(design, printResult, printer, { library, images, onProgress } = {}) {
  const d = normaliseDesign(design);
  const p = normalisePrinter(printer);
  const print = printResult?.toolpath ? printResult : computePrint(d, { library, printer: p, images });
  const { tp, skirt, refills } = print.toolpath;
  return writeGcode(tp, d, p, { skirt, refills, onProgress });
}

/** The CAD formats exportCad writes. */
export const CAD_FORMATS = Object.freeze({
  dxf: { extension: 'dxf', type: 'application/dxf' },
  stl: { extension: 'stl', type: 'model/stl' },
});

/**
 * A CAD file for a design (core/cad.js). 'dxf' is the nozzle path of the
 * final walls (finish.walls) as one continuous 3D polyline; 'stl' is the closed solid.
 * Neither depends on the printer, and print checks don't block them: a
 * design that doesn't fit the bed can still go to CAD.
 * @param {object} design
 * @param {'dxf' | 'stl'} format
 * @param {{ library: { patterns: object[] }, images?: Map<string, object> }} options
 * @returns {{ chunks: (string | ArrayBuffer)[], type: string, extension: string }}
 */
export function exportCad(design, format, { library, images } = {}) {
  const d = normaliseDesign(design);
  const name = d.meta?.name || 'Vasecreator';
  if (format === 'dxf') {
    const tp = buildToolpath(d, library, { walls: d.finish.walls, images });
    return { chunks: writeDxf(tp, { name }), ...CAD_FORMATS.dxf };
  }
  if (format === 'stl') {
    return { chunks: [writeStl(buildSolid(d, library, { images }), { name })], ...CAD_FORMATS.stl };
  }
  throw new TypeError(`Unknown CAD format: ${format}`);
}
