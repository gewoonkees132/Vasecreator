// The printer profile (design §10 step 2, research §5.3): one generic gantry,
// kept apart from designs. It also holds the process settings (C19): prime,
// skirt, end moves, speeds, minimum layer time, flow and the refill reservoir.
//
// The values are a draft, not tested on a printer (D4). No template ever holds
// a heater code: clay printers have no hot end to wait for.

export const PRINTER_SCHEMA = 'vasecreator/printer';
export const PRINTER_VERSION = 1;

export const ORIGINS = ['frontLeft', 'centre'];
export const FIRMWARES = ['marlin', 'rrf', 'klipper'];
export const E_MODES = ['relative', 'absolute'];

/** Pause command per firmware (research §3.5). */
export const PAUSE_COMMANDS = { marlin: 'M0', rrf: 'M226', klipper: 'PAUSE' };
/** E-mode command (works under G90 on all three firmwares). */
export const E_MODE_COMMANDS = { relative: 'M83', absolute: 'M82' };

export const DEFAULT_TEMPLATES = Object.freeze({
  start: 'G21\nG90\n{e_mode_cmd}\nG28\nG92 E0',
  // Home X and Y only: homing Z at the end would drive the nozzle into the pot.
  end: 'G28 X Y\nM84',
  refill: [
    '; Refill {refill_index} of {refill_count}',
    'G1 Z{park_z} F{z_f}',
    'G1 X{park_x} Y{park_y} F{travel_f}',
    '{pause_cmd}',
    '{prime}',
    'G1 X{resume_x} Y{resume_y} F{travel_f}',
    'G1 Z{resume_z} F{z_f}',
  ].join('\n'),
});

/** Numeric ranges for the printer fields the Prepare print panel edits. */
export const PRINTER_LIMITS = Object.freeze({
  bedWidthMm: { min: 50, max: 3000, step: 1 },
  bedDepthMm: { min: 50, max: 3000, step: 1 },
  maxHeightMm: { min: 20, max: 3000, step: 1 },
  feedDiameterMm: { min: 0.5, max: 50, step: 0.01 },
  eScale: { min: 0.05, max: 20, step: 0.01 },
  volumeMm3: { min: 0, max: 100000, step: 10 },
  parkX: { min: -3000, max: 3000, step: 1 },
  parkY: { min: -3000, max: 3000, step: 1 },
  parkZ: { min: 0, max: 3000, step: 1 },
  liftMm: { min: 0, max: 500, step: 1 },
  offsetMm: { min: 0, max: 200, step: 0.5 },
  loops: { min: 0, max: 10, step: 1 },
  wipeMm: { min: 0, max: 100, step: 1 },
  speedMmS: { min: 1, max: 500, step: 1 },
  minLayerTimeS: { min: 0, max: 600, step: 1 },
  reservoirMl: { min: 0, max: 100000, step: 10 },
  usableFraction: { min: 0.1, max: 1, step: 0.01 },
});

const DEFAULT = {
  schema: PRINTER_SCHEMA,
  version: PRINTER_VERSION,
  id: 'generic-gantry',
  name: 'Generic gantry',
  status: 'draft',
  machine: { bedWidthMm: 300, bedDepthMm: 300, origin: 'frontLeft', maxHeightMm: 400, firmware: 'marlin' },
  extrusion: { eMode: 'relative', feedDiameterMm: 3.1, eScale: 1 },
  prime: { volumeMm3: 300, parkX: 0, parkY: -130, parkZ: 20, liftMm: 50 },
  skirt: { offsetMm: 15, loops: 1 },
  end: { liftMm: 10, wipeMm: 10 },
  speeds: { wallMmS: 25, baseMmS: 20, travelMmS: 40, zMmS: 10, minLayerTimeS: 20, minSpeedMmS: 8 },
  reservoirMl: 0,
  usableFraction: 0.85,
  templates: { ...DEFAULT_TEMPLATES },
};

/** @returns {object} a fresh copy of the generic gantry profile */
export function defaultPrinter() {
  return structuredClone(DEFAULT);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pick = (value, options, fallback) => (options.includes(value) ? value : fallback);

function num(value, fallback, limit, integer = false) {
  let v = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (integer) v = Math.round(v);
  return Math.min(Math.max(v, limit.min), limit.max);
}

/**
 * Fills defaults and clamps ranges. Never throws on missing fields.
 * @param {unknown} json
 * @returns {object} a new, normalised printer profile
 * @throws {TypeError} when json is not a printer profile
 */
export function normalisePrinter(json) {
  if (json === undefined || json === null) return defaultPrinter();
  if (!isObject(json)) throw new TypeError('Not a printer profile: expected an object');
  if (json.schema !== undefined && json.schema !== PRINTER_SCHEMA) throw new TypeError(`Not a printer profile: schema ${json.schema}`);
  const D = DEFAULT;
  const L = PRINTER_LIMITS;
  const get = (key) => (isObject(json[key]) ? json[key] : {});
  const machine = get('machine');
  const extrusion = get('extrusion');
  const prime = get('prime');
  const skirt = get('skirt');
  const end = get('end');
  const speeds = get('speeds');
  const templates = get('templates');
  const text = (v, fallback) => (typeof v === 'string' ? v : fallback);
  return {
    schema: PRINTER_SCHEMA,
    version: PRINTER_VERSION,
    id: text(json.id, D.id),
    name: text(json.name, D.name) || D.name,
    status: pick(json.status, ['verified', 'community', 'draft'], 'draft'),
    machine: {
      bedWidthMm: num(machine.bedWidthMm, D.machine.bedWidthMm, L.bedWidthMm),
      bedDepthMm: num(machine.bedDepthMm, D.machine.bedDepthMm, L.bedDepthMm),
      origin: pick(machine.origin, ORIGINS, D.machine.origin),
      maxHeightMm: num(machine.maxHeightMm, D.machine.maxHeightMm, L.maxHeightMm),
      firmware: pick(machine.firmware, FIRMWARES, D.machine.firmware),
    },
    extrusion: {
      eMode: pick(extrusion.eMode, E_MODES, D.extrusion.eMode),
      feedDiameterMm: num(extrusion.feedDiameterMm, D.extrusion.feedDiameterMm, L.feedDiameterMm),
      eScale: num(extrusion.eScale, D.extrusion.eScale, L.eScale),
    },
    prime: {
      volumeMm3: num(prime.volumeMm3, D.prime.volumeMm3, L.volumeMm3),
      parkX: num(prime.parkX, D.prime.parkX, L.parkX),
      parkY: num(prime.parkY, D.prime.parkY, L.parkY),
      parkZ: num(prime.parkZ, D.prime.parkZ, L.parkZ),
      liftMm: num(prime.liftMm, D.prime.liftMm, L.liftMm),
    },
    skirt: {
      offsetMm: num(skirt.offsetMm, D.skirt.offsetMm, L.offsetMm),
      loops: num(skirt.loops, D.skirt.loops, L.loops, true),
    },
    end: {
      liftMm: num(end.liftMm, D.end.liftMm, L.liftMm),
      wipeMm: num(end.wipeMm, D.end.wipeMm, L.wipeMm),
    },
    speeds: {
      wallMmS: num(speeds.wallMmS, D.speeds.wallMmS, L.speedMmS),
      baseMmS: num(speeds.baseMmS, D.speeds.baseMmS, L.speedMmS),
      travelMmS: num(speeds.travelMmS, D.speeds.travelMmS, L.speedMmS),
      zMmS: num(speeds.zMmS, D.speeds.zMmS, L.speedMmS),
      minLayerTimeS: num(speeds.minLayerTimeS, D.speeds.minLayerTimeS, L.minLayerTimeS),
      minSpeedMmS: num(speeds.minSpeedMmS, D.speeds.minSpeedMmS, L.speedMmS),
    },
    reservoirMl: num(json.reservoirMl, D.reservoirMl, L.reservoirMl),
    usableFraction: num(json.usableFraction, D.usableFraction, L.usableFraction),
    templates: {
      start: text(templates.start, D.templates.start),
      end: text(templates.end, D.templates.end),
      refill: text(templates.refill, D.templates.refill),
    },
  };
}

/** "Generic gantry (draft, not tested on a printer)" */
export function printerLabel(printer) {
  return printer.status === 'draft' ? `${printer.name} (draft, not tested on a printer)` : printer.name;
}
