import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE, describeHeights, heightRanges } from '../core/checks.js';
import { computePreview, computePrint } from '../core/engine.js';
import { defaultPrinter } from '../core/printer.js';
import { TILES, cylinder, library, linearDesign, presets, withPattern } from './support/fixtures.js';

// A crisp zigzag half a bead apart and a quarter bead deep: the tightest
// corner the Pattern makes, a circle of half a bead (1.5 mm) through three nodes.
const tightZigzag = (d, patch = {}) => withPattern(d, TILES.zigzag, { depthMm: 0.75, density: { by: 'spacing', spacingMm: 1.5, points: 96 }, ...patch });

const warning = (result, id) => result.warnings.find((w) => w.id === id);

// Heights of the beads flagged with a bit.
function flaggedHeights(result, bit) {
  const zs = [];
  for (let p = 0; p < result.pointCount; p++) if (result.issues[p] & bit) zs.push(result.positions[3 * p + 2]);
  return zs;
}

test('the presets and a plain cylinder have no warnings', () => {
  for (const d of [...presets, cylinder()]) {
    const r = computePreview(d, { library });
    assert.deepEqual(r.warnings, [], d.meta.name);
    assert.ok(r.issues.every((i) => i === 0), d.meta.name);
  }
});

test('a steep cone leans past the limit between the expected heights', () => {
  // Straight from r 40 to r 70 between 40 and 60 mm: 1.5 mm out per mm up (56°).
  const d = linearDesign([[0, 40], [40, 40], [60, 70], [100, 70]]);
  const r = computePreview(d, { library });
  const w = warning(r, 'overhang');
  assert.ok(w, 'overhang warning');
  assert.equal(w.severity, 'warning');
  assert.equal(w.bit, ISSUE.overhang);
  const zs = flaggedHeights(r, ISSUE.overhang);
  assert.ok(Math.min(...zs) >= 40 && Math.max(...zs) <= 62, `flagged ${Math.min(...zs)}–${Math.max(...zs)}`);
  assert.match(w.message, /^Leans past 45° between 4\d and 6\d mm$/);
  // A gentler lean (0.75 mm per mm, 37°) passes.
  assert.equal(warning(computePreview(linearDesign([[0, 40], [40, 40], [80, 70], [100, 70]]), { library }), 'overhang'), undefined);
});

test('the overhang limit is a design setting', () => {
  const d = linearDesign([[0, 40], [40, 40], [80, 70], [100, 70]]);
  d.rules.overhangLimitDeg = 30;
  assert.match(warning(computePreview(d, { library }), 'overhang').message, /^Leans past 30° /);
});

test('a needle is too narrow for the bead', () => {
  // The Pattern's in cells pull the wall under two bead widths.
  const d = withPattern(linearDesign([[0, 6], [80, 6]]), TILES.zigzag, { fromMm: 10, toMm: 70 });
  const r = computePreview(d, { library });
  const w = warning(r, 'narrow');
  assert.ok(w);
  assert.match(w.message, /^Too narrow for the bead between 1\d and [67]\d mm$/);
  // The clamp holds the wall at two bead widths.
  for (let p = 0; p < r.pointCount; p++) {
    if (r.kinds[p] === 1) assert.ok(Math.hypot(r.positions[3 * p], r.positions[3 * p + 1]) >= 6 - 1e-4);
  }
});

test('a pot bigger than the bed is an error', () => {
  const d = cylinder({ radius: 160 });
  const r = computePreview(d, { library });
  const w = warning(r, 'bed');
  assert.ok(w);
  assert.equal(w.severity, 'error');
  assert.equal(w.message, "Doesn't fit the printer bed");
  assert.ok(r.issues.some((i) => i & ISSUE.bed));
  const print = computePrint(d, { library });
  assert.equal(print.canExport, false);
  // Fits a bigger bed.
  const printer = defaultPrinter();
  printer.machine.bedWidthMm = printer.machine.bedDepthMm = 500;
  assert.equal(warning(computePreview(d, { library, printer }), 'bed'), undefined);
});

test('a tall pot is off the bed too', () => {
  const printer = defaultPrinter();
  printer.machine.maxHeightMm = 100;
  assert.ok(warning(computePreview(cylinder({ height: 120 }), { library, printer }), 'bed'));
});

test('an unusual layer height for the bead is a warning without beads', () => {
  const d = cylinder();
  d.layers.layerHeightMm = 2.5;
  const w = warning(computePreview(d, { library }), 'layerRatio');
  assert.deepEqual(w, { id: 'layerRatio', severity: 'warning', bit: 0, message: 'Layer height is unusual for this bead' });
});

test('a pattern finer than the bead is flagged', () => {
  const d = tightZigzag(cylinder({ radius: 30, height: 60 }));
  d.rules.curveRatio = 1;
  const r = computePreview(d, { library });
  const w = warning(r, 'finePattern');
  assert.ok(w);
  assert.equal(w.bit, ISSUE.finePattern);
  assert.match(w.message, /^Pattern finer than the bead can print at \d+–\d+ mm$/);
});

test('the tightest curve is a design setting (rules.curveRatio)', () => {
  const zigzag = (curveRatio) => {
    const d = tightZigzag(cylinder({ radius: 30, height: 60 }));
    d.rules.curveRatio = curveRatio;
    return computePreview(d, { library });
  };
  // A stricter rule flags the zigzag; a looser one lets the same zigzag pass.
  assert.equal(warning(zigzag(1), 'finePattern').bit, ISSUE.finePattern);
  const loose = zigzag(0.3);
  assert.equal(warning(loose, 'finePattern'), undefined);
  assert.ok(loose.issues.every((i) => !(i & ISSUE.finePattern)));
});

test('height ranges read in mm, merged and counted', () => {
  const z = Float64Array.from({ length: 100 }, (_, i) => (i + 1) * 1.5);
  const flags = new Uint8Array(100);
  flags[63] = flags[64] = flags[66] = flags[72] = 1;
  const ranges = heightRanges(flags, z);
  assert.deepEqual(ranges, [{ from: 96, to: 100.5 }, { from: 109.5, to: 109.5 }]);
  assert.equal(describeHeights(ranges), 'at 96–101 and 110 mm');
  const many = [{ from: 6, to: 9 }, { from: 30, to: 30 }, { from: 50, to: 52.5 }, { from: 96, to: 110 }];
  assert.equal(describeHeights(many.slice(0, 3)), 'at 6–9, 30 and 50–53 mm');
  assert.equal(describeHeights(many), 'in 4 places, from 6 to 110 mm');
  assert.equal(describeHeights([ranges[0]]), 'between 96 and 101 mm');
  assert.equal(describeHeights([ranges[0]], 'dash'), 'at 96–101 mm');
  assert.equal(describeHeights([ranges[1]]), 'at 110 mm');
});

test('print checks: fits the bed, refills, wall gaps and the hole', () => {
  const printer = defaultPrinter();
  printer.reservoirMl = 100;
  // Two walls behind a Pattern: the smooth inner wall leaves gaps behind the out cells.
  const d = withPattern(structuredClone(presets[0]), TILES.knit, { fromMm: 20, toMm: 140 });
  d.finish.walls = 2;
  const print = computePrint(d, { library, printer });
  const byId = Object.fromEntries(print.checks.map((c) => [c.id, c]));
  assert.deepEqual(byId.bed, { id: 'bed', severity: 'ok', bit: 0, message: 'Fits the bed' });
  assert.match(byId.refill.message, /^\d refill pauses?, at [\d, and]+ mm$/);
  assert.equal(byId.refill.severity, 'info');
  assert.match(byId.wallGap.message, /^Walls fuse in the grooves; gaps up to \d+\.\d mm behind raised parts$/);
  assert.equal(print.canExport, true);

  const small = cylinder();
  small.base.hole.diameter = 4;
  assert.equal(computePrint(small, { library }).checks.find((c) => c.id === 'hole').severity, 'warning');

  // The skirt and the prime park point count for the bed.
  const parked = defaultPrinter();
  parked.prime.parkY = -200;
  assert.equal(computePrint(cylinder(), { library, printer: parked }).canExport, false);
  const skirted = defaultPrinter();
  skirted.skirt.offsetMm = 120;
  assert.equal(computePrint(cylinder(), { library, printer: skirted }).checks[0].severity, 'error');
});

test('the bed check counts the end lift, and a prime point over the pot is an error', () => {
  const tall = cylinder({ height: 396 });
  const printer = defaultPrinter();
  const tooTall = computePrint(tall, { library, printer });
  assert.equal(tooTall.checks.find((c) => c.id === 'bed').severity, 'error');
  assert.match(tooTall.checks.find((c) => c.id === 'bed').message, /Too tall/);
  assert.equal(tooTall.canExport, false);
  assert.equal(computePrint(cylinder({ height: 380 }), { library, printer }).canExport, true);

  const over = defaultPrinter();
  over.prime.parkY = -20;
  const result = computePrint(cylinder(), { library, printer: over });
  assert.equal(result.checks.find((c) => c.id === 'park')?.severity, 'error');
  assert.equal(result.canExport, false);
  assert.equal(computePrint(cylinder(), { library, printer }).checks.find((c) => c.id === 'park'), undefined);
});
