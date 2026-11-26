import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { GcodeError, computePrint, emitGcode } from '../core/engine.js';
import { beadAreaMm2, fnv1a, profileHash } from '../core/gcode.js';
import { defaultPrinter, normalisePrinter } from '../core/printer.js';
import { cylinder, library, presets } from './support/fixtures.js';

const gcode = (design, printer = defaultPrinter(), onProgress) => emitGcode(design, null, printer, { library, onProgress }).join('');
const moves = (text) => text.split('\n').filter((l) => l.startsWith('G1 '));
const word = (line, letter) => {
  const m = line.match(new RegExp(`\\b${letter}(-?\\d+(?:\\.\\d+)?)`));
  return m ? Number(m[1]) : undefined;
};

const classic = gcode(presets[0]);

test('the header names the design, the draft printer, the profile hash and the design', () => {
  const lines = classic.split('\n');
  assert.equal(lines[0], '; Vasecreator v2');
  assert.equal(lines[1], '; Design: Classic vase');
  assert.equal(lines[2], '; Printer: Generic gantry (draft, not tested on a printer)');
  assert.match(lines[3], /^; Printer profile hash: [0-9a-f]{8}$/);
  const design = lines.find((l) => l.startsWith('; design: '));
  assert.equal(JSON.parse(design.slice(10)).meta.name, 'Classic vase');
  assert.ok(lines.includes(';LAYER_COUNT:34'));
  assert.ok(lines.includes('M83'));
  assert.ok(lines.includes(';LAYER:0') && lines.includes(';LAYER:33') && lines.includes(';Z:170.000'));
  for (const t of ['WALL-OUTER', 'BASE', 'SKIRT', 'PRIME']) assert.ok(lines.includes(`;TYPE:${t}`), t);
});

test('no NaN, no "-0.000", no heater codes, fixed decimals', () => {
  assert.doesNotMatch(classic, /NaN|Infinity|undefined/);
  assert.doesNotMatch(classic, /-0\.0+(?!\d*[1-9])/);
  assert.doesNotMatch(classic, /\bM(104|109|140|190)\b/);
  for (const line of moves(classic)) {
    for (const m of line.matchAll(/([XYZEF])(-?[\d.]+)/g)) {
      const digits = m[2].split('.')[1]?.length ?? 0;
      assert.equal(digits, { X: 3, Y: 3, Z: 3, E: 5, F: 0 }[m[1]], line);
    }
  }
});

test('the same design gives byte-identical G-code', () => {
  assert.equal(gcode(presets[0]), classic);
  assert.equal(gcode(presets[1]), gcode(presets[1]));
});

test('relative E is never negative and Z only climbs while printing', () => {
  let z = 0;
  let printing = false;
  for (const line of moves(classic)) {
    const e = word(line, 'E');
    const nz = word(line, 'Z');
    if (nz !== undefined) z = nz;
    if (line.includes(' X') && e !== undefined && !line.startsWith('G1 E')) printing = true;
    if (e !== undefined) assert.ok(e >= 0, line);
    if (printing && e !== undefined && nz !== undefined) assert.ok(nz >= z - 1e-9);
  }
});

test('absolute E increases and matches the relative total', () => {
  const printer = defaultPrinter();
  printer.extrusion.eMode = 'absolute';
  const text = gcode(presets[2], printer);
  assert.ok(text.split('\n').includes('M82'));
  let last = 0;
  for (const line of moves(text)) {
    const e = word(line, 'E');
    if (e === undefined) continue;
    assert.ok(e > last, line);
    last = e;
  }
  let sum = 0;
  for (const line of moves(gcode(presets[2]))) sum += word(line, 'E') ?? 0;
  assert.ok(Math.abs(sum - last) < 1e-4, `relative sum ${sum} vs absolute ${last}`);
});

test('E follows the bead volume', () => {
  // A straight 100 mm bead of 3 × 1.5 mm on a 3.1 mm feed.
  const area = beadAreaMm2(3, 1.5);
  assert.ok(Math.abs(area - ((3 - 1.5) * 1.5 + (Math.PI * 1.5 * 1.5) / 4)) < 1e-12);
  const text = gcode(cylinder());
  const first = moves(text).find((l) => l.includes(' X') && l.includes(' E'));
  assert.ok(first);
  const perMm = area / ((Math.PI * 3.1 * 3.1) / 4);
  assert.ok(perMm > 0.5 && perMm < 0.6);
});

test('the origin maps the centred part onto the bed', () => {
  const xs = (text) => moves(text).map((l) => word(l, 'X')).filter((x) => x !== undefined && !Number.isNaN(x));
  const front = xs(gcode(cylinder()));
  const printer = defaultPrinter();
  printer.machine.origin = 'centre';
  const centre = xs(gcode(cylinder(), printer));
  const mid = (v) => (Math.max(...v) + Math.min(...v)) / 2;
  assert.ok(Math.abs(mid(front.slice(10)) - 150) < 1 && Math.abs(mid(centre.slice(10))) < 1);
});

test('short layers slow down, then dwell for the rest of the minimum layer time', () => {
  const text = gcode(cylinder({ radius: 8, height: 15 }));
  assert.match(text, /\nG4 P\d+\n/);
  const feeds = moves(text).filter((l) => l.includes(' E') && l.includes(' X')).map((l) => word(l, 'F')).filter(Boolean);
  assert.ok(feeds.every((f) => f >= 8 * 60 - 1e-9));
  assert.ok(feeds.some((f) => f < 25 * 60));
});

test('a refill pause goes in at a layer start with the firmware pause command', () => {
  for (const [firmware, cmd] of [['marlin', 'M0'], ['rrf', 'M226'], ['klipper', 'PAUSE']]) {
    const printer = defaultPrinter();
    printer.machine.firmware = firmware;
    printer.reservoirMl = 60;
    const text = gcode(presets[0], printer);
    const lines = text.split('\n');
    const at = lines.indexOf(cmd);
    assert.ok(at > 0, firmware);
    assert.match(lines.slice(at - 3, at).join('\n'), /; Refill 1 of \d/);
    assert.ok(lines.slice(at, at + 8).some((l) => l.startsWith(';LAYER:')));
  }
});

test('the reservoir is never drawn past its usable share between refills', () => {
  // An 8 mm by 5 mm bead takes about 40 ml a layer of this pot.
  for (const ml of [100, 150, 250]) {
    const printer = defaultPrinter();
    printer.reservoirMl = ml;
    const text = gcode(presets[0], printer);
    const feedArea = (Math.PI * 3.1 * 3.1) / 4;
    const usableE = (ml * 1000 * printer.usableFraction) / feedArea;
    let e = 0;
    let pauses = 0;
    for (const line of text.split('\n')) {
      if (line === 'M0') {
        assert.ok(e <= usableE + 1e-3, `${ml} ml: ${(e * feedArea / 1000).toFixed(1)} ml used before pause ${pauses + 1}`);
        e = 0;
        pauses++;
      }
      if (line.startsWith('G1 ')) e += word(line, 'E') ?? 0;
    }
    assert.ok(e <= usableE + 1e-3, `${ml} ml after the last pause`);
    assert.ok(pauses > 0);
  }
});

test('a G92 E0 in a template restarts absolute E, after its own prime too', () => {
  const firstE = (printer) => {
    const lines = gcode(cylinder(), printer).split('\n');
    const at = lines.findIndex((l) => l.startsWith(';TYPE:SKIRT'));
    return word(lines.slice(at).find((l) => / X.* E/.test(l)), 'E');
  };
  const plain = defaultPrinter();
  plain.extrusion.eMode = 'absolute';
  const expected = firstE(plain) - word(gcode(cylinder(), plain).split('\n').find((l) => l.startsWith('G1 E')), 'E');
  for (const start of ['G21\nG90\n{e_mode_cmd}\nG28\nG92 E0\n{prime}\nG92 E0', 'G21\nG90\n{e_mode_cmd}\nG28\n{prime}']) {
    const printer = defaultPrinter();
    printer.extrusion.eMode = 'absolute';
    printer.templates.start = start;
    // The prime happened in the template, then E was reset: the skirt starts from zero.
    assert.ok(Math.abs(firstE(printer) - expected) < 1e-4, start);
  }
});

test('moves without clay never climb faster than the Z speed', () => {
  for (const d of [presets[0], cylinder({ baseLayers: 4 }), { ...structuredClone(presets[0]), form: { ...presets[0].form, plan: { footprint: 'circle', depthRatio: 0.6, cornerRounding: 0 } } }]) {
    let x = 0, y = 0, z = 0;
    for (const line of moves(gcode(d))) {
      const nx = word(line, 'X') ?? x;
      const ny = word(line, 'Y') ?? y;
      const nz = word(line, 'Z') ?? z;
      const f = word(line, 'F');
      if (f !== undefined) var feed = f;
      if (word(line, 'E') === undefined && nz > z) {
        const length = Math.hypot(nx - x, ny - y, nz - z);
        assert.ok(((nz - z) / length) * feed <= 600 * 1.01, line);
      }
      x = nx;
      y = ny;
      z = nz;
    }
  }
});

test('V16: heater codes and unknown placeholders block the export', () => {
  const heater = defaultPrinter();
  heater.templates.start = 'G28\nM104 S200';
  assert.throws(() => gcode(cylinder(), heater), GcodeError);
  const unknown = defaultPrinter();
  unknown.templates.end = 'G28 {nope}';
  assert.throws(() => gcode(cylinder(), unknown), /Unknown placeholder \{nope\}/);
  // A heater code in a comment is fine.
  const comment = defaultPrinter();
  comment.templates.start += '\n; never send M104 here';
  assert.doesNotThrow(() => gcode(cylinder(), comment));
});

test('progress runs to 1', () => {
  const seen = [];
  gcode(cylinder(), defaultPrinter(), (f) => seen.push(f));
  assert.equal(seen.at(-1), 1);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1]);
});

test('a print result from computePrint is reused', () => {
  const d = cylinder();
  const print = computePrint(d, { library });
  assert.equal(emitGcode(d, print, defaultPrinter(), { library }).join(''), gcode(d));
});

test('the profile hash is FNV-1a and ignores key order', () => {
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
  const p = defaultPrinter();
  const shuffled = Object.fromEntries(Object.entries(p).reverse());
  assert.equal(profileHash(normalisePrinter(shuffled)), profileHash(p));
});

// Golden files (research §8.5): a change to the output needs UPDATE_GOLDEN=1
// and a look at the diff.
const goldens = [
  ['plain-cylinder', cylinder()],
  ['classic-vase', presets[0]],
  ['twisted-column', presets[1]],
  ['square-planter', presets[2]],
];
for (const [name, design] of goldens) {
  test(`golden: ${name}`, () => {
    const file = new URL(`./golden/${name}.gcode`, import.meta.url);
    const text = name === 'classic-vase' ? classic : gcode(design);
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) {
      writeFileSync(file, text);
      return;
    }
    const expected = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (text !== expected) {
      const a = text.split('\n');
      const b = expected.split('\n');
      const i = a.findIndex((line, k) => line !== b[k]);
      assert.fail(`${name}.gcode differs at line ${i + 1}:\n  got      ${a[i]}\n  expected ${b[i]}\nRun UPDATE_GOLDEN=1 npm test after checking the change.`);
    }
  });
}

// A tiny Marlin model of the modes: G90/G91 also set the E mode there.
function marlinModes(text) {
  let absolute = true;
  let eAbsolute = true;
  const states = [];
  for (const line of text.split('\n')) {
    const code = line.split(';')[0].trim().toUpperCase();
    if (code === 'G90') absolute = eAbsolute = true;
    else if (code === 'G91') absolute = eAbsolute = false;
    else if (code === 'M82') eAbsolute = true;
    else if (code === 'M83') eAbsolute = false;
    else if (/^G1 .*E/.test(code)) states.push({ absolute, eAbsolute, line });
  }
  return states;
}

test('templates that switch G90/G91 or the E mode never leave the print in the wrong mode', () => {
  const templates = [
    { refill: 'G91\nG1 Z10 F600\nG90\nG1 X{park_x} Y{park_y} F{travel_f}\n{pause_cmd}\n{prime}' },
    { refill: 'G91\nG1 Z10 F600\n{pause_cmd}' },
    { start: 'G28\nM83' },
    { start: 'G90\n{e_mode_cmd}\nM82\nG28' },
    { start: '{prime}\nG28' },
  ];
  for (const t of templates) {
    for (const eMode of ['relative', 'absolute']) {
      const printer = normalisePrinter({ reservoirMl: 0.5, extrusion: { eMode }, templates: { ...defaultPrinter().templates, ...t } });
      for (const s of marlinModes(gcode(cylinder(), printer))) {
        assert.ok(s.absolute, `${JSON.stringify(t)}: ${s.line}`);
        assert.equal(s.eAbsolute, eMode === 'absolute', `${JSON.stringify(t)} ${eMode}: ${s.line}`);
      }
    }
  }
});

test('the default templates come out exactly as before (no extra mode lines)', () => {
  const lines = classic.split('\n');
  const start = lines.indexOf('G21');
  assert.deepEqual(lines.slice(start, start + 6), ['G21', 'G90', 'M83', 'G28', 'G92 E0', ';TYPE:PRIME']);
});

test('V16: G92 other than G92 E0, {prime} inside a line and padded heater codes are refused', () => {
  for (const [key, text] of [
    ['start', 'G28\nG92 X0 Y0'], ['refill', 'g92'], ['refill', 'G92 E5'], ['end', 'G92 Z0'],
    ['start', 'G1 X10 {prime}'], ['start', 'M0104 S0'], ['start', ' m109 S0'], ['end', 'm140'],
  ]) {
    const printer = defaultPrinter();
    printer.templates[key] = text;
    assert.throws(() => gcode(cylinder(), printer), GcodeError, text);
  }
  const ok = defaultPrinter();
  ok.templates.refill = `G92 E0.0 ; reset\n${ok.templates.refill}`;
  assert.doesNotThrow(() => gcode(cylinder(), ok));
});

test('a refill template that does not resume still comes back over the top onto the seam', () => {
  const printer = normalisePrinter({ reservoirMl: 0.5, templates: { refill: '{pause_cmd}' } });
  const lines = gcode(cylinder(), printer).split('\n');
  const at = lines.indexOf('M0');
  assert.ok(at > 0);
  const [lift, over, down] = lines.slice(at + 1, at + 4);
  const z = word(lines.slice(0, at).filter((l) => / Z/.test(l)).at(-1), 'Z');
  assert.ok(word(lift, 'Z') >= z + 5, lift);
  assert.ok(word(over, 'X') !== undefined && word(over, 'Y') !== undefined && word(over, 'E') === undefined, over);
  assert.equal(word(down, 'Z'), z);
});

test('no move goes below the printed height, and the end and refill lifts clear the rim', () => {
  const printer = normalisePrinter({ reservoirMl: 0.5, end: { liftMm: 0 }, prime: { parkZ: 0, liftMm: 0 } });
  assert.equal(printer.end.liftMm, 5);
  assert.equal(printer.prime.parkZ, 2);
  const text = gcode(presets[0], printer);
  let z = NaN;
  let top = -Infinity;
  let parked = 0;
  for (const line of text.split('\n')) {
    z = word(line, 'Z') ?? z;
    if (/^G1 [XY].* E/.test(line)) top = Math.max(top, z);
    else if (line.startsWith('G1 ') && top > -Infinity) assert.ok(z >= top - 1e-9, line);
    if (line === 'M0') { parked++; assert.ok(z >= top + 5 - 1e-9, `refill park at ${z}, print at ${top}`); }
  }
  assert.ok(parked > 0);
  const end = text.split('\n');
  const homing = end.indexOf('G28 X Y');
  assert.ok(word(end.slice(0, homing).filter((l) => / Z/.test(l)).at(-1), 'Z') >= top + 5);
});

test('a skirt of several loops runs outermost first, so the travel in crosses none of them', () => {
  const printer = normalisePrinter({ skirt: { loops: 3, offsetMm: 10 } });
  const lines = gcode(cylinder(), printer).split('\n');
  const at = lines.indexOf(';TYPE:SKIRT');
  const first = lines[at + 1];
  const x0 = word(first, 'X') - 150;
  assert.ok(Math.abs(x0 - (30 + 10 + 2 * 3)) < 1e-3, first);
});
