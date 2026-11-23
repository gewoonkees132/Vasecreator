// The engine facade used by the worker and by tests (ARCHITECTURE.md).
//
//   computePreview: the live loop. Centreline wall plus base, design checks.
//   computePrint:   Prepare print. Final walls, process moves, all checks.
//   emitGcode:      the G-code text, in chunks.
//
// The preview and the G-code come from the same toolpath code (research
// §5.4); the preview is that toolpath in Float32 for the GPU.

import { normaliseDesign } from './design.js';
import { normalisePrinter } from './printer.js';
import { profileLine as evaluateProfileLine } from './profile.js';
import { MAX_PREVIEW_POINTS, buildSkirt, buildToolpath } from './toolpath.js';
import { designChecks, printChecks } from './checks.js';
import { planRefills, writeGcode } from './gcode.js';

export { GcodeError } from './gcode.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
    pointCount,
    computeMs: now() - started,
  };
}

/**
 * The live preview: the centreline wall and the base, with design checks.
 * @param {object} design any design JSON (normalised here)
 * @param {{ library: { patterns: object[] }, printer?: object }} options
 * @returns {object} PreviewResult (ARCHITECTURE.md)
 */
export function computePreview(design, { library, printer } = {}) {
  const started = now();
  const d = normaliseDesign(design);
  const p = normalisePrinter(printer);
  const tp = buildToolpath(d, library, { walls: 1, maxPoints: MAX_PREVIEW_POINTS });
  const warnings = designChecks(tp, d, p);
  return summarise(tp, d, warnings, started);
}

/**
 * The finished print: final walls, every print-time check.
 * Besides the PreviewResult fields it carries `checks`, `canExport` and, for
 * emitGcode in the same thread, `toolpath` (the Float64 path and its layer
 * table; the worker drops it before posting).
 * @param {object} design
 * @param {{ library: { patterns: object[] }, printer?: object }} options
 */
export function computePrint(design, { library, printer } = {}) {
  const started = now();
  const d = normaliseDesign(design);
  const p = normalisePrinter(printer);
  const tp = buildToolpath(d, library, { walls: d.finish.walls });
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
 * @param {{ library: { patterns: object[] }, onProgress?: (fraction: number) => void }} options
 * @returns {string[]}
 * @throws {GcodeError} on a V16 sanity failure
 */
export function emitGcode(design, printResult, printer, { library, onProgress } = {}) {
  const d = normaliseDesign(design);
  const p = normalisePrinter(printer);
  const print = printResult?.toolpath ? printResult : computePrint(d, { library, printer: p });
  const { tp, skirt, refills } = print.toolpath;
  return writeGcode(tp, d, p, { skirt, refills, onProgress });
}
