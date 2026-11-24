// G-code emission (research §5.4 stages 7–11, §3.5).
//
// The toolpath (Float64, part centred on the origin) becomes text: header,
// start template, prime, skirt, the layers with Cura/Prusa-style comments,
// refill pauses, end moves. Extrusion is tracked as volume: each segment's 3D
// length × the stadium bead area, converted to virtual filament length with the
// printer's feed diameter and flow scale.
//
// Output is deterministic to the byte: numbers are rounded through integers
// (xyz 3 decimals, E 5, F 0), so there is never a "-0.000" and no engine's
// float formatting is involved. V16 sanity failures throw GcodeError.

import { PI } from './math.js';
import { E_MODE_COMMANDS, PAUSE_COMMANDS, printerLabel } from './printer.js';
import { KIND } from './toolpath.js';
import { compactDesign } from './design.js';

/** A G-code sanity failure (research §7, V16). Blocks the export. */
export class GcodeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GcodeError';
  }
}

/**
 * Stadium cross-section of a bead (research §3.4): (w − h)·h + π·h²/4.
 * @param {number} w bead width @param {number} h layer height @returns {number} mm²
 */
export function beadAreaMm2(w, h) {
  const width = Math.max(w, h);
  return (width - h) * h + (PI * h * h) / 4;
}

/** JSON with object keys sorted, so equal profiles hash equally. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a 32-bit hash of a string's UTF-8 bytes, as 8 hex digits. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Deterministic hash of a printer profile, for the G-code header. */
export function profileHash(printer) {
  return fnv1a(canonicalJson(printer));
}

// Leading zeros too: Marlin reads M0104 as M104.
const HEATER = /(^|[\s;])M0*(104|109|140|190)(?!\d)/im;
const RESET_E = /^\s*G92\s+E0(\.0*)?\s*(;.*)?$/i;
const SET_POSITION = /(^|\s)G0*92(?![\d.])/i;
const PLACEHOLDERS = new Set([
  'e_mode_cmd', 'pause_cmd', 'prime', 'park_x', 'park_y', 'park_z', 'travel_f', 'z_f', 'bed_width', 'bed_depth',
  'max_height', 'layer_height', 'bead_width', 'layer_z', 'refill_index', 'refill_count', 'resume_x', 'resume_y', 'resume_z',
]);

/**
 * Throws GcodeError if a template holds a heater code, a G92 other than
 * G92 E0, an unknown placeholder, or {prime} sharing a line.
 * @param {object} printer normalised
 */
export function validateTemplates(printer) {
  for (const [name, text] of Object.entries(printer.templates)) {
    for (const line of text.split('\n')) {
      const code = line.split(';')[0];
      if (HEATER.test(code)) {
        throw new GcodeError(`The ${name} G-code has a heater command; clay printers must not use M104, M109, M140 or M190`);
      }
      // G92 with X, Y or Z (or bare, which zeroes every axis) moves the
      // coordinates under the print, and G92 E<n> puts absolute E out of step:
      // either can send the nozzle into the pot or flood it with clay.
      if (SET_POSITION.test(code) && !RESET_E.test(code)) {
        throw new GcodeError(`The ${name} G-code sets a position with G92; only G92 E0 is allowed`);
      }
      // {prime} is a whole move; inside another line it would add clay to that move.
      if (line.includes('{prime}') && line.trim() !== '{prime}') {
        throw new GcodeError(`{prime} must be on a line of its own in the ${name} G-code`);
      }
    }
    for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
      if (!PLACEHOLDERS.has(match[1])) throw new GcodeError(`Unknown placeholder {${match[1]}} in the ${name} G-code`);
    }
  }
}

/** Volume (mm³) laid down in each layer of a toolpath. */
export function layerVolumes(tp, areaMm2) {
  const { path, kinds, layerStarts } = tp;
  const L = layerStarts.length - 1;
  const volumes = new Float64Array(L);
  for (let k = 0; k < L; k++) {
    let length = 0;
    for (let p = Math.max(layerStarts[k], 1); p < layerStarts[k + 1]; p++) {
      if (kinds[p] === KIND.none) continue;
      const dx = path[3 * p] - path[3 * p - 3];
      const dy = path[3 * p + 1] - path[3 * p - 2];
      const dz = path[3 * p + 2] - path[3 * p - 1];
      length += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    volumes[k] = length * areaMm2;
  }
  return volumes;
}

function loopsVolume(loops, areaMm2) {
  let length = 0;
  for (const loop of loops) {
    for (let j = 3; j < loop.length; j += 3) {
      const dx = loop[j] - loop[j - 3];
      const dy = loop[j + 1] - loop[j - 2];
      length += Math.sqrt(dx * dx + dy * dy);
    }
  }
  return length * areaMm2;
}

/**
 * Where refill pauses go (research §7, V12): pause at the start of the layer
 * that would take the clay used since the last fill past the usable share of
 * the reservoir, so the reservoir is never drawn below its reserve. A layer
 * bigger than a whole fill still prints after one pause. A reservoir of 0
 * never pauses.
 * @returns {{ layer: number, zMm: number }[]} zMm is the height printed so far
 */
export function planRefills(tp, design, printer, skirt) {
  if (!(printer.reservoirMl > 0)) return [];
  const area = beadAreaMm2(design.layers.beadWidthMm, design.layers.layerHeightMm);
  const usable = printer.reservoirMl * 1000 * printer.usableFraction;
  const volumes = layerVolumes(tp, area);
  const prime = printer.prime.volumeMm3;
  let used = prime + loopsVolume(skirt, area);
  const pauses = [];
  for (let k = 0; k < volumes.length; k++) {
    if (k > 0 && used + volumes[k] > usable && used > prime) {
      pauses.push({ layer: k, zMm: tp.layerZ[k - 1] });
      used = prime;
    }
    used += volumes[k];
  }
  return pauses;
}

// Fixed-point formatting through an integer, so it never prints "-0.000".
// Past 2^53 that integer is no longer exact (and from 1e21 String() writes an
// exponent), so such a number is refused rather than written.
function fixed(value, scale, digits) {
  let k = Math.round(value * scale);
  if (!(Math.abs(k) <= Number.MAX_SAFE_INTEGER)) throw new GcodeError(`A number is out of range for G-code: ${value}`);
  if (k === 0) return digits ? `0.${'0'.repeat(digits)}` : '0';
  const negative = k < 0;
  if (negative) k = -k;
  if (!digits) return negative ? `-${k}` : `${k}`;
  const whole = Math.floor(k / scale);
  const part = String(k - whole * scale).padStart(digits, '0');
  return `${negative ? '-' : ''}${whole}.${part}`;
}
const f3 = (v) => fixed(v, 1000, 3);
const fixedE = (k) => fixed(k / 100000, 100000, 5);
const fF = (v) => fixed(v, 1, 0);

const TYPES = { [KIND.outer]: 'WALL-OUTER', [KIND.inner]: 'WALL-INNER', [KIND.base]: 'BASE', [KIND.connector]: 'CONNECTOR' };
const FLAVORS = { marlin: 'Marlin', rrf: 'RepRap', klipper: 'Klipper' };

/**
 * Writes the G-code for a finished toolpath.
 * @param {object} tp toolpath from buildToolpath() with the final walls
 * @param {object} design normalised
 * @param {object} printer normalised
 * @param {{ skirt: Float64Array[], refills: { layer: number, zMm: number }[],
 *           onProgress?: (fraction: number) => void }} options
 * @returns {string[]} chunks: the header and start, one per layer, the end
 * @throws {GcodeError}
 */
export function writeGcode(tp, design, printer, { skirt, refills, onProgress }) {
  validateTemplates(printer);
  const { machine, extrusion, prime, end, speeds } = printer;
  const w = design.layers.beadWidthMm;
  const h = design.layers.layerHeightMm;
  const area = beadAreaMm2(w, h);
  const feedArea = (PI * extrusion.feedDiameterMm * extrusion.feedDiameterMm) / 4;
  const ePerMm3 = extrusion.eScale / feedArea;
  const relative = extrusion.eMode === 'relative';
  const ox = machine.origin === 'frontLeft' ? machine.bedWidthMm / 2 : 0;
  const oy = machine.origin === 'frontLeft' ? machine.bedDepthMm / 2 : 0;
  const feed = {
    [KIND.outer]: speeds.wallMmS, [KIND.inner]: speeds.wallMmS, [KIND.connector]: speeds.wallMmS, [KIND.base]: speeds.baseMmS,
  };
  const travelF = speeds.travelMmS * 60;
  const zF = speeds.zMmS * 60;
  const primeF = speeds.wallMmS * area * ePerMm3 * 60;
  for (const f of [travelF, zF, primeF, feed[1] * 60, feed[3] * 60]) {
    if (!(f > 0) || !Number.isFinite(f)) throw new GcodeError('Every speed must be above zero');
  }

  const chunks = [];
  let lines = [];
  const flush = () => {
    chunks.push(`${lines.join('\n')}\n`);
    lines = [];
  };

  // Machine state. E is kept exact as a running total and written through
  // integers, so relative steps add up to the absolute value exactly.
  let cx = NaN, cy = NaN, cz = NaN;
  let eTotal = 0;
  let eWritten = 0;
  let lastX = '', lastY = '', lastZ = '', lastF = '';
  let printZ = -Infinity;
  let type = '';

  const eWord = () => {
    const k = Math.round(eTotal * 100000);
    const word = `E${fixedE(relative ? k - eWritten : k)}`;
    eWritten = k;
    return word;
  };

  function move(x, y, z, kind, speedMmS, partCoords = true) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new GcodeError('The toolpath has a point that is not a number');
    const f = speedMmS * 60;
    if (!(f > 0) || !Number.isFinite(f)) throw new GcodeError('A move has no feed rate');
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-9) return 0;
    const xs = f3(x + (partCoords ? ox : 0));
    const ys = f3(y + (partCoords ? oy : 0));
    const zs = f3(z);
    let line = 'G1';
    if (xs !== lastX || Number.isNaN(cx)) line += ` X${xs}`;
    if (ys !== lastY || Number.isNaN(cy)) line += ` Y${ys}`;
    if (zs !== lastZ) line += ` Z${zs}`;
    // No move, with clay or without, may go below what is already printed.
    if (z < printZ - 1e-9) throw new GcodeError(`The print goes down to ${zs} mm after reaching ${f3(printZ)} mm`);
    if (kind !== KIND.none) {
      printZ = Math.max(printZ, z);
      eTotal += length * area * ePerMm3;
      line += ` ${eWord()}`;
    }
    const fs = fF(f);
    if (fs !== lastF) line += ` F${fs}`;
    lines.push(line);
    lastX = xs;
    lastY = ys;
    lastZ = zs;
    lastF = fs;
    cx = x;
    cy = y;
    cz = z;
    return length;
  }

  function setType(kind) {
    const t = TYPES[kind];
    if (t && t !== type) {
      lines.push(`;TYPE:${t}`);
      type = t;
    }
  }

  function primeBlock() {
    eTotal += prime.volumeMm3 * ePerMm3;
    const word = eWord();
    lastF = fF(primeF);
    return `G1 ${word} F${lastF}`;
  }

  // A G92 E0 anywhere restarts the E count, so absolute E stays in step with
  // the machine (a template may reset E after its own prime).
  const resetE = () => {
    eTotal = 0;
    eWritten = 0;
  };

  // Expands a template into lines and returns the positioning (G90/G91) and
  // E mode (M82/M83) it leaves behind, '' where it set none. On Marlin, G90
  // and G91 set the E mode as well (a G90 after M83 makes E absolute again),
  // so an E mode only counts when it comes after the last G90 or G91.
  function expand(name, context, unknown = false) {
    const text = printer.templates[name];
    const modes = { positioning: '', eMode: '', touched: false };
    if (!text) return modes;
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\{([a-z_]+)\}/g, (_, key) => {
        if (key === 'prime' && context.prime) {
          // The prime's E word is in the profile's E mode; set it first if
          // the template (or, at the start, the machine) may have another.
          if ((modes.touched || unknown) && modes.eMode !== common.e_mode_cmd) {
            Object.assign(modes, { eMode: common.e_mode_cmd, touched: true });
            return `${common.e_mode_cmd}\n${primeBlock()}`;
          }
          return primeBlock();
        }
        if (!(key in context)) throw new GcodeError(`The placeholder {${key}} can't be used in the ${name} G-code`);
        return context[key];
      });
      lines.push(line);
      if (RESET_E.test(line)) resetE();
      for (const word of line.split(';')[0].toUpperCase().split(/\s+/)) {
        if (word === 'G90' || word === 'G91') Object.assign(modes, { positioning: word, eMode: '', touched: true });
        else if (word === 'M82' || word === 'M83') Object.assign(modes, { eMode: word, touched: true });
      }
    }
    return modes;
  }

  // After a template: absolute positioning (a G91 left on would read every
  // later coordinate as a step) and the profile's E mode, put back whenever
  // the template may have changed them. `unknown` is for the start, where
  // nothing is known about the machine before.
  function restoreModes(modes, unknown) {
    const absolute = modes.positioning === 'G91' || (unknown && modes.positioning !== 'G90');
    if (absolute) lines.push('G90');
    if (absolute || ((modes.touched || unknown) && modes.eMode !== common.e_mode_cmd)) lines.push(common.e_mode_cmd);
  }

  const common = {
    e_mode_cmd: E_MODE_COMMANDS[extrusion.eMode],
    pause_cmd: PAUSE_COMMANDS[machine.firmware],
    travel_f: fF(travelF),
    z_f: fF(zF),
    bed_width: f3(machine.bedWidthMm),
    bed_depth: f3(machine.bedDepthMm),
    max_height: f3(machine.maxHeightMm),
    layer_height: f3(h),
    bead_width: f3(w),
    park_x: f3(prime.parkX + ox),
    park_y: f3(prime.parkY + oy),
    park_z: f3(prime.parkZ),
  };

  // Header (research §5.4 stage 11).
  const L = tp.layerStarts.length - 1;
  const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ');
  lines.push(
    '; Vasecreator v2',
    `; Design: ${oneLine(design.meta.name)}`,
    `; Printer: ${oneLine(printerLabel(printer))}`,
    `; Printer profile hash: ${profileHash(printer)}`,
    `; Bead width ${f3(w)} mm, layer height ${f3(h)} mm`,
    `;FLAVOR:${FLAVORS[machine.firmware]}`,
    `;LAYER_COUNT:${L}`,
    `; design: ${JSON.stringify(compactDesign(design))}`,
  );

  // Start, then prime: a stationary volume at the park point, then a lift.
  const startHasPrime = printer.templates.start.includes('{prime}');
  restoreModes(expand('start', { ...common, prime: startHasPrime }, true), true);
  // E counts from zero from here on, whatever the start template did.
  if (!printer.templates.start.split('\n').some((line) => RESET_E.test(line))) {
    lines.push('G92 E0');
    resetE();
  }
  if (!startHasPrime) {
    lines.push(';TYPE:PRIME', `G1 Z${common.park_z} F${common.z_f}`, `G1 X${common.park_x} Y${common.park_y} F${common.travel_f}`);
    lines.push(primeBlock());
  }
  const liftZ = prime.parkZ + prime.liftMm;
  lines.push(`G1 Z${f3(liftZ)} F${common.z_f}`);
  cx = prime.parkX;
  cy = prime.parkY;
  cz = liftZ;
  // A start template with its own {prime} may have primed anywhere, so the
  // first move writes X and Y in full.
  lastX = startHasPrime ? '' : common.park_x;
  lastY = startHasPrime ? '' : common.park_y;
  lastZ = f3(liftZ);
  lastF = common.z_f;

  // Travel over to the first bead at the prime height (never lower than that
  // bead, so a low park point doesn't drag the nozzle over the bed), then down.
  const goTo = (x, y, z) => {
    move(x, y, Math.max(cz, z), KIND.none, speeds.travelMmS);
    move(x, y, z, KIND.none, speeds.zMmS);
  };

  if (skirt.length) {
    lines.push(';TYPE:SKIRT');
    type = 'SKIRT';
    // Outermost loop first, so the travel in to the part crosses no skirt bead.
    for (let k = skirt.length - 1; k >= 0; k--) {
      const loop = skirt[k];
      if (k === skirt.length - 1) goTo(loop[0], loop[1], loop[2]);
      else move(loop[0], loop[1], loop[2], KIND.base, speeds.baseMmS);
      for (let j = 3; j < loop.length; j += 3) move(loop[j], loop[j + 1], loop[j + 2], KIND.base, speeds.baseMmS);
    }
    move(tp.path[0], tp.path[1], cz, KIND.none, speeds.travelMmS);
    move(tp.path[0], tp.path[1], tp.path[2], KIND.none, speeds.zMmS);
  } else {
    goTo(tp.path[0], tp.path[1], tp.path[2]);
  }
  flush();

  const { path, kinds, layerStarts, layerZ } = tp;
  const refillAt = new Map(refills.map((r, i) => [r.layer, i]));
  const segment = (p) => {
    const dx = path[3 * p] - path[3 * p - 3];
    const dy = path[3 * p + 1] - path[3 * p - 2];
    const dz = path[3 * p + 2] - path[3 * p - 1];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  // A move without clay (a step up at the seam or the base centre) climbs no
  // faster than the Z speed, however short its sideways part.
  const travelSpeed = (p) => {
    const dz = Math.abs(path[3 * p + 2] - path[3 * p - 1]);
    return dz > 1e-9 ? Math.min(speeds.travelMmS, (speeds.zMmS * segment(p)) / dz) : speeds.travelMmS;
  };

  for (let k = 0; k < L; k++) {
    const first = layerStarts[k];
    const last = layerStarts[k + 1];
    if (refillAt.has(k)) {
      const index = refillAt.get(k);
      const context = {
        ...common,
        prime: true,
        refill_index: String(index + 1),
        refill_count: String(refills.length),
        park_z: f3(Math.max(cz + end.liftMm, prime.parkZ)),
        resume_x: f3(cx + ox),
        resume_y: f3(cy + oy),
        resume_z: f3(cz),
        layer_z: f3(layerZ[k]),
      };
      restoreModes(expand('refill', context), false);
      // A refill template that doesn't come back down to {resume_z} would
      // leave the next bead to start from wherever it parked: go back over
      // the top, then down onto the seam.
      if (!printer.templates.refill.includes('{resume_z}')) {
        lines.push(
          `G1 Z${context.park_z} F${common.z_f}`,
          `G1 X${context.resume_x} Y${context.resume_y} F${common.travel_f}`,
          `G1 Z${context.resume_z} F${common.z_f}`,
        );
      }
      // The template moved the head; write every word of the next move again.
      lastX = lastY = lastZ = lastF = '';
    }
    lines.push(`;LAYER:${k}`, `;Z:${f3(layerZ[k])}`);

    // Minimum layer time: slow the beads down (not below the minimum speed),
    // then dwell for whatever is still missing.
    let time = 0;
    for (let p = Math.max(first, 1); p < last; p++) {
      time += segment(p) / (kinds[p] === KIND.none ? travelSpeed(p) : feed[kinds[p]]);
    }
    let slow = 1;
    if (speeds.minLayerTimeS > 0 && time > 0 && time < speeds.minLayerTimeS) slow = time / speeds.minLayerTimeS;
    let slowedTime = 0;
    for (let p = first; p < last; p++) {
      const kind = kinds[p];
      let speed;
      if (kind === KIND.none) {
        speed = p > 0 ? travelSpeed(p) : speeds.travelMmS;
      } else {
        setType(kind);
        const nominal = feed[kind];
        speed = Math.max(nominal * slow, Math.min(nominal, speeds.minSpeedMmS));
      }
      slowedTime += move(path[3 * p], path[3 * p + 1], path[3 * p + 2], kind, speed) / speed;
    }
    if (speeds.minLayerTimeS > 0 && slowedTime > 0 && slowedTime < speeds.minLayerTimeS - 1e-6) {
      lines.push(`G4 P${fF((speeds.minLayerTimeS - slowedTime) * 1000)}`);
    }
    flush();
    if (onProgress) onProgress((k + 1) / L);
  }

  // End: wipe along the start of the last layer without clay, lift, template.
  lines.push(';TYPE:END');
  if (end.wipeMm > 0 && L > 0) {
    let left = end.wipeMm;
    const z = cz;
    for (let p = layerStarts[L - 1] + 1; p < layerStarts[L] && left > 1e-9; p++) {
      const x = path[3 * p];
      const y = path[3 * p + 1];
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= left) {
        move(x, y, z, KIND.none, speeds.wallMmS);
        left -= d;
      } else {
        const t = left / d;
        move(cx + dx * t, cy + dy * t, z, KIND.none, speeds.wallMmS);
        left = 0;
      }
    }
  }
  if (end.liftMm > 0) move(cx, cy, cz + end.liftMm, KIND.none, speeds.zMmS);
  expand('end', { ...common, layer_z: f3(L > 0 ? layerZ[L - 1] : 0) });
  flush();
  return chunks;
}
