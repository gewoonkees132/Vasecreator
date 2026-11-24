// Printability checks (design §11, research §7).
//
// Design-level checks run on every preview and colour the beads they flag;
// they never block designing. Print-time checks run in Prepare print, where
// errors (off the bed, G-code sanity) block the export and everything else is
// advice. Messages are plain and give heights in mm, never layer numbers.

/** Issue bits per point (ARCHITECTURE.md). */
export const ISSUE = Object.freeze({ overhang: 1, finePattern: 2, narrow: 4, bed: 8 });

// Layer kinds as numbers, to stay free of an import cycle with toolpath.js.
const OUTER = 1;
const INNER = 2;

/** Heights in whole mm, as people read them off a ruler. */
const mm = (z) => `${Math.round(z)}`;

/**
 * Groups flagged layers into height ranges. Ranges closer than `gap` layers
 * merge, so one leaning band reads as one place.
 * @param {Uint8Array} flagged per layer, 1 when the layer has a flagged bead
 * @param {Float64Array} layerZ layer tops in mm
 * @returns {{ from: number, to: number }[]} heights in mm
 */
export function heightRanges(flagged, layerZ, gap = 2) {
  const ranges = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < flagged.length; i++) {
    if (!flagged[i]) continue;
    if (start >= 0 && i - last <= gap) {
      last = i;
      continue;
    }
    if (start >= 0) ranges.push({ from: layerZ[start], to: layerZ[last] });
    start = i;
    last = i;
  }
  if (start >= 0) ranges.push({ from: layerZ[start], to: layerZ[last] });
  return ranges;
}

/**
 * "between 96 and 110 mm", "at 40–60 mm", "at 142 mm", up to three places
 * listed ("at 6–14 and 96–110 mm"), or "in 5 places, from 10 to 110 mm".
 * @param {{ from: number, to: number }[]} ranges
 * @param {'between' | 'dash'} style how a single range reads
 */
export function describeHeights(ranges, style = 'between') {
  if (ranges.length === 0) return '';
  if (ranges.length > 3) return `in ${ranges.length} places, from ${mm(ranges[0].from)} to ${mm(ranges.at(-1).to)} mm`;
  if (ranges.length > 1) {
    // A few places read best listed, so each band can be found on the pot.
    const parts = ranges.map(({ from, to }) => (mm(from) === mm(to) ? `${mm(from)}` : `${mm(from)}–${mm(to)}`));
    return `at ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)} mm`;
  }
  const { from, to } = ranges[0];
  if (mm(from) === mm(to)) return `at ${mm(from)} mm`;
  return style === 'dash' ? `at ${mm(from)}–${mm(to)} mm` : `between ${mm(from)} and ${mm(to)} mm`;
}

function flaggedLayers(tp, bit) {
  const flagged = new Uint8Array(tp.layerZ.length);
  let any = false;
  for (let p = 0; p < tp.pointCount; p++) {
    if (tp.issues[p] & bit) {
      flagged[tp.layerOf[p]] = 1;
      any = true;
    }
  }
  return any ? flagged : null;
}

// Bead-scale curvature (V6): the circle through each wall point and its two
// neighbours must be at least half a bead wide.
function markCurvature(tp, w) {
  const { path, kinds, layerOf, issues, pointCount } = tp;
  const limit = w / 2;
  for (let p = 1; p < pointCount - 1; p++) {
    const k = kinds[p];
    if ((k !== OUTER && k !== INNER) || kinds[p - 1] !== k || kinds[p + 1] !== k) continue;
    if (layerOf[p - 1] !== layerOf[p] || layerOf[p + 1] !== layerOf[p]) continue;
    const ax = path[3 * p - 3] - path[3 * p];
    const ay = path[3 * p - 2] - path[3 * p + 1];
    const bx = path[3 * p + 3] - path[3 * p];
    const by = path[3 * p + 4] - path[3 * p + 1];
    const cross = Math.abs(ax * by - ay * bx);
    if (cross < 1e-12) continue;
    const cx = bx - ax;
    const cy = by - ay;
    const radius = Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by) * (cx * cx + cy * cy)) / (2 * cross);
    if (radius < limit) issues[p] |= ISSUE.finePattern;
  }
}

/** Half extents the part needs on the bed, centreline plus half a bead. */
function footprintExtent(tp, w) {
  let ex = 0;
  let ey = 0;
  let top = 0;
  for (let p = 0; p < tp.pointCount; p++) {
    ex = Math.max(ex, Math.abs(tp.path[3 * p]));
    ey = Math.max(ey, Math.abs(tp.path[3 * p + 1]));
    top = Math.max(top, tp.path[3 * p + 2]);
  }
  return { ex: ex + w / 2, ey: ey + w / 2, top };
}

function markBed(tp, printer, w) {
  const halfW = printer.machine.bedWidthMm / 2;
  const halfD = printer.machine.bedDepthMm / 2;
  const maxZ = printer.machine.maxHeightMm;
  let any = false;
  for (let p = 0; p < tp.pointCount; p++) {
    const x = Math.abs(tp.path[3 * p]) + w / 2;
    const y = Math.abs(tp.path[3 * p + 1]) + w / 2;
    if (x > halfW || y > halfD || tp.path[3 * p + 2] > maxZ) {
      tp.issues[p] |= ISSUE.bed;
      any = true;
    }
  }
  return any;
}

/**
 * The design-level checks (design §11). Adds curvature and bed bits to
 * tp.issues (overhang, narrow and the points-per-layer cap are set while the
 * toolpath is built) and returns one warning per failing check.
 * @param {object} tp the toolpath from buildToolpath()
 * @param {object} design normalised
 * @param {object} printer normalised
 * @returns {{ id: string, severity: string, bit: number, message: string }[]}
 */
export function designChecks(tp, design, printer) {
  const { beadWidthMm: w, layerHeightMm: h, overhangLimitDeg } = design.layers;
  markCurvature(tp, w);
  const offBed = markBed(tp, printer, w);
  const warnings = [];

  const overhang = flaggedLayers(tp, ISSUE.overhang);
  if (overhang) {
    warnings.push({
      id: 'overhang', severity: 'warning', bit: ISSUE.overhang,
      message: `Leans past ${overhangLimitDeg}° ${describeHeights(heightRanges(overhang, tp.layerZ))}`,
    });
  }

  // Vertical fineness (V5): a pattern needs at least two layers per bump.
  let rowsTooFine = false;
  for (const s of tp.model.active) {
    if (s.features.up > 0 && s.tileHeightMm / s.features.up < 2 * h) rowsTooFine = true;
  }
  const fine = flaggedLayers(tp, ISSUE.finePattern);
  if (fine || rowsTooFine) {
    const where = fine ? ` ${describeHeights(heightRanges(fine, tp.layerZ), 'dash')}` : '';
    warnings.push({
      id: 'finePattern', severity: 'warning', bit: fine ? ISSUE.finePattern : 0,
      message: `Pattern finer than the bead can print${where}`,
    });
  }

  const narrow = flaggedLayers(tp, ISSUE.narrow);
  if (narrow) {
    warnings.push({
      id: 'narrow', severity: 'warning', bit: ISSUE.narrow,
      message: `Too narrow for the bead ${describeHeights(heightRanges(narrow, tp.layerZ))}`,
    });
  }

  if (offBed) warnings.push({ id: 'bed', severity: 'error', bit: ISSUE.bed, message: "Doesn't fit the printer bed" });

  const ratio = h / w;
  if (ratio < 0.3 - 1e-9 || ratio > 0.6 + 1e-9) {
    warnings.push({ id: 'layerRatio', severity: 'warning', bit: 0, message: 'Layer height is unusual for this bead' });
  }

  if (tp.simplified) {
    warnings.push({ id: 'simplified', severity: 'warning', bit: 0, message: 'Too big for full detail, so the path has fewer points' });
  }

  if (tp.model.missing.length) {
    warnings.push({ id: 'missingPattern', severity: 'warning', bit: 0, message: "A pattern in this design isn't available, so it prints plain" });
  }
  if (tp.model.missingImages?.length) {
    warnings.push({ id: 'missingImage', severity: 'warning', bit: 0, message: 'An image pattern is missing on this device' });
  }
  return warnings;
}

function list(values) {
  const parts = values.map(mm);
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * Print-time checks for Prepare print (design §10 step 3).
 * @param {object} tp the toolpath with the final walls
 * @param {object} design normalised
 * @param {object} printer normalised
 * @param {{ skirt: Float64Array[], refills: { zMm: number }[], designWarnings: object[] }} extra
 * @returns {{ checks: object[], canExport: boolean }}
 */
export function printChecks(tp, design, printer, { skirt, refills, designWarnings }) {
  const w = design.layers.beadWidthMm;
  const checks = [];
  const { machine, prime } = printer;
  const halfW = machine.bedWidthMm / 2;
  const halfD = machine.bedDepthMm / 2;
  let { ex, ey, top } = footprintExtent(tp, w);
  for (const loop of skirt) {
    for (let j = 0; j < loop.length; j += 3) {
      ex = Math.max(ex, Math.abs(loop[j]) + w / 2);
      ey = Math.max(ey, Math.abs(loop[j + 1]) + w / 2);
    }
  }
  const parkInside = Math.abs(prime.parkX) <= halfW && Math.abs(prime.parkY) <= halfD;
  // The end lift (and the refill park, which rises the same lift above the
  // print) must stay inside the machine too.
  const tallEnough = top + printer.end.liftMm <= machine.maxHeightMm && prime.parkZ + prime.liftMm <= machine.maxHeightMm;
  if (ex <= halfW && ey <= halfD && parkInside && tallEnough) {
    checks.push({ id: 'bed', severity: 'ok', bit: 0, message: 'Fits the bed' });
  } else if (ex <= halfW && ey <= halfD && parkInside) {
    checks.push({
      id: 'bed', severity: 'error', bit: ISSUE.bed,
      message: `Too tall for the printer: the nozzle has to reach ${mm(Math.max(top + printer.end.liftMm, prime.parkZ + prime.liftMm))} mm`,
    });
  } else {
    checks.push({ id: 'bed', severity: 'error', bit: ISSUE.bed, message: "Doesn't fit the printer bed" });
  }

  // The prime (at the start and at every refill) leaves a blob of clay under
  // the park point. Over the pot or the skirt, the beads would be printed into
  // it. Clear means outside the box or the circle around everything printed.
  let reach = 0;
  const reachOf = (x, y) => { reach = Math.max(reach, x * x + y * y); };
  for (let p = 0; p < tp.pointCount; p++) reachOf(tp.path[3 * p], tp.path[3 * p + 1]);
  for (const loop of skirt) for (let j = 0; j < loop.length; j += 3) reachOf(loop[j], loop[j + 1]);
  const radius = Math.sqrt(reach) + w / 2;
  const { parkX: px, parkY: py } = prime;
  if (Math.abs(px) <= ex && Math.abs(py) <= ey && px * px + py * py <= radius * radius) {
    checks.push({ id: 'park', severity: 'error', bit: 0, message: 'The prime point is over the pot or the skirt; move it to the side' });
  }

  const hole = design.base.hole.diameter;
  if (hole > 0 && hole < 2 * w) {
    checks.push({ id: 'hole', severity: 'warning', bit: 0, message: 'The hole is narrower than two beads and may close up' });
  }

  if (refills.length) {
    const word = refills.length === 1 ? 'refill pause' : 'refill pauses';
    checks.push({ id: 'refill', severity: 'info', bit: 0, message: `${refills.length} ${word}, at ${list(refills.map((r) => r.zMm))} mm` });
  }

  if (tp.walls === 2 && design.finish.innerWall === 'smooth' && tp.maxGapMm > 0.05) {
    checks.push({
      id: 'wallGap', severity: 'info', bit: 0,
      message: `Walls fuse in the grooves; gaps up to ${tp.maxGapMm.toFixed(1)} mm behind raised parts`,
    });
  }

  for (const warning of designWarnings) {
    if (warning.id === 'bed') continue; // the print-time bed check above replaces it
    // Printing without the image would print a different pot, so it blocks export.
    if (warning.id === 'missingImage') checks.push({ ...warning, severity: 'error' });
    else checks.push({ ...warning });
  }
  return { checks, canExport: !checks.some((c) => c.severity === 'error') };
}
