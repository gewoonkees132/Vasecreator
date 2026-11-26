// The tools of the phone dock, per design step (mobile stage §4.1). Each tool
// is one thing you can set from the stage. The dock (ui/dock.js) shows them as
// a row of chips with their values and gives the chosen one a single control.
//
// kinds:
//   dial      a number: dial(state, env) → the dial's spec, set(draft, v, state, env) changes the design
//   options   a choice: options, current(state), choose(draft, v)
//   drawings  the Pattern's carousel: the starter Patterns, None and your own (§3.8)
//   sheet     a hint and a button that opens the settings sheet at `part`
//   group     a tool that opens a row of its own: `modes` (a toggle at the
//             front of the row), mode(state) and tools per mode. No step has
//             one since the Detailed morph went (D63).
//
// env is { library }: the tools that need the libraries (the Pattern's
// density readout) read them from it.
//
// Every tool edits the design through the same core functions and limits as
// the sheet's controls, so the two always agree. applies(state) hides a tool
// that has nothing to set yet, like a part that doesn't apply (C34).
// No DOM here: the module is tested on real designs.

import { LIMITS, setHeight, setWidth, setDepth } from '../core/design.js';
import { DEPTH_BEADS } from '../core/layer-pattern.js';
import { footprintAt, depthLocked } from './sections/shape.js';
import { curveType } from './sections/curve.js';
import morph from './sections/morph.js';
import { findLayerEntry, readoutOf, densityText, softenText, slantText, densityLimits } from './pattern-actions.js';
import { FACETS_MAP } from '../core/morph.js';

const round1 = (v) => Math.round(v * 10) / 10;
const fmt = (v, decimals = 1) => {
  const f = 10 ** decimals;
  return String(Math.round(v * f) / f + 0);
};
const L = (key, fallback) => ({ ...fallback, ...(LIMITS[key] || {}) });

// Twist turns corners, the morph and the patterns; on a plain round pot there
// is nothing to turn (C30).
const twistHidden = (d) => d.form.plan.footprint === 'circle' && (d.form.plan.depthRatio ?? 1) === 1
  && !d.form.morph?.map && !d.pattern;

const CURVE_NOTES = {
  smooth: 'Flows through the points',
  gentle: 'Never bulges past the points',
  angular: 'Straight lines, rounded corners',
};
const CURVE_INTERP = { smooth: 'catmullRomCentripetal', gentle: 'monotone', angular: 'linear' };

/** The Pattern's Fade words (D42, D54). */
export const BLEND_OPTIONS = [
  { value: 'even', label: 'Even' }, { value: 'fadesUp', label: 'Fades up' }, { value: 'fadesDown', label: 'Fades down' },
  { value: 'middle', label: 'Middle' }, { value: 'diagonal', label: 'Diagonal' },
];
const blendLabel = (v) => BLEND_OPTIONS.find((o) => o.value === v)?.label ?? '';
// Where the amount shows most, for the notes.
const BLEND_WHERE = { fadesUp: 'At the top: ', fadesDown: 'At the bottom: ', middle: 'Halfway up: ', diagonal: 'In the band: ' };

function layerNote(layers) {
  const ratio = layers.layerHeightMm / layers.beadWidthMm;
  return ratio < 0.3 || ratio > 0.65 ? 'Unusual for this bead (0.3–0.65 × bead width)' : '';
}

// ---------- Shape's Morph tool ----------

const MORPH_TOOL = {
  id: 'morph', name: 'Morph', kind: 'sheet', part: 'morph',
  value: (s) => (s.design.form.morph?.map ? 'On' : 'Off'),
  hint: (s) => (s.design.form.morph?.map
    ? `Morph: ${safe(() => morph.summary(s.design))}.`
    : 'Push the whole wall in and out with a map or a picture, for big shapes like lobes and waves.'),
  action: 'Open morph settings',
};

// ---------- The Pattern step's tools (the bead-scale Pattern, D37–D42) ----------

const hasPattern = (s) => !!s.design.pattern;
const pat = (s) => s.design.pattern;
const deepest = (d) => Math.floor(DEPTH_BEADS.max * d.layers.beadWidthMm * 100) / 100;
const facetsOn = (s) => s.design.form.morph?.map === FACETS_MAP;
const eachFacet = (s) => facetsOn(s) && !!pat(s).slant?.perFacet;
const quarter = (v) => Math.round(Math.min(Math.max(v, LIMITS.slantCells.min), LIMITS.slantCells.max) * 4) / 4;

const PATTERN_TOOLS = [
  { id: 'drawing', name: 'Pattern', kind: 'drawings' },
  {
    id: 'depth', name: 'Depth', kind: 'dial',
    applies: hasPattern,
    value: (s) => `${fmt(pat(s).depthMm, 2)} mm`,
    dial: (s) => {
      const v = pat(s).depthMm;
      return {
        label: 'Pattern depth', unit: 'mm', min: 0, max: Math.max(deepest(s.design), v), step: 0.05, decimals: 2, value: v,
        note: v > 0 ? `Out +${fmt(v, 2)} mm, in −${fmt(v, 2)} mm · up to ⅔ of a bead` : 'Flat: the drawing doesn’t print',
      };
    },
    set: (d, v) => { if (d.pattern) d.pattern.depthMm = Math.min(Math.max(0, v), deepest(d)); },
  },
  {
    id: 'density', name: 'Density', kind: 'dial', face: true,
    applies: hasPattern,
    // The value as set, like the dial; the dial's note says what prints (D40).
    value: (s, env) => {
      if (pat(s).density.by !== 'points') return `${fmt(pat(s).density.spacingMm)} mm`;
      const r = readoutOf(s.design, env?.library);
      return r ? `${r.nodes} pts` : '–';
    },
    dial: (s, env) => {
      const p = pat(s);
      const r = readoutOf(s.design, env?.library);
      if (!r) return { label: 'Density', unit: '', min: 0, max: 1, step: 1, decimals: 0, value: 0, disabled: true, note: 'The drawing isn’t available' };
      const lim = densityLimits(s.design, r);
      const note = densityText(r, { compact: true });
      if (p.density.by === 'points') {
        return { label: 'Points per layer', unit: 'pts', ...lim.points, decimals: 0, value: r.nodes, note };
      }
      const v = Math.min(Math.max(p.density.spacingMm, lim.spacing.min), lim.spacing.max);
      return { label: 'Spacing', unit: 'mm', ...lim.spacing, step: 0.1, decimals: 1, value: v, note };
    },
    set: (d, v, s, env) => {
      if (!d.pattern) return;
      const density = d.pattern.density;
      if (density.by === 'points') {
        const c = readoutOf(s.design, env?.library)?.columns ?? 1;
        density.points = Math.max(c, Math.round(v / c) * c);
      } else {
        density.spacingMm = Math.round(v * 100) / 100;
      }
    },
  },
  {
    id: 'from', name: 'From', kind: 'dial',
    applies: hasPattern,
    value: (s) => `${fmt(pat(s).fromMm, 0)} mm`,
    dial: (s) => ({
      label: 'Pattern from', unit: 'mm', min: 0, max: s.design.form.height, step: 0.5, decimals: 1, value: pat(s).fromMm,
      note: 'Or drag the bracket beside the pot',
    }),
    set: (d, v) => { if (d.pattern) d.pattern.fromMm = Math.max(0, Math.min(v, d.pattern.toMm - d.layers.layerHeightMm)); },
  },
  {
    id: 'to', name: 'To', kind: 'dial',
    applies: hasPattern,
    value: (s) => `${fmt(pat(s).toMm, 0)} mm`,
    dial: (s) => ({
      label: 'Pattern to', unit: 'mm', min: 0, max: s.design.form.height, step: 0.5, decimals: 1, value: pat(s).toMm,
      note: 'Or drag the bracket beside the pot',
    }),
    set: (d, v) => { if (d.pattern) d.pattern.toMm = Math.min(d.form.height, Math.max(v, d.pattern.fromMm + d.layers.layerHeightMm)); },
  },
  {
    id: 'fade', name: 'Fade', kind: 'options',
    applies: hasPattern,
    options: BLEND_OPTIONS,
    current: (s) => pat(s).fade.shape,
    value: (s) => (pat(s).fade.shape === 'even' ? 'None' : blendLabel(pat(s).fade.shape)),
    note: (s) => ({
      even: 'Even: the Pattern prints in full from From to To',
      diagonal: 'A band without the Pattern winds round the pot',
    })[pat(s).fade.shape] ?? 'Where the Pattern fades out, bottom to top',
    choose: (d, v) => { if (d.pattern) d.pattern.fade.shape = v; },
    label: () => 'Fade',
  },
  {
    id: 'fadeAmount', name: 'Amount', kind: 'dial',
    applies: (s) => hasPattern(s) && pat(s).fade.shape !== 'even',
    value: (s) => `${Math.round(pat(s).fade.amount * 100)} %`,
    dial: (s) => {
      const f = pat(s).fade;
      const a = Math.round(f.amount * 100);
      return { label: 'Fade amount', unit: '%', min: 0, max: 100, step: 5, decimals: 0, value: a, note: `${BLEND_WHERE[f.shape] ?? ''}${100 - a} % of the depth` };
    },
    set: (d, v) => { if (d.pattern) d.pattern.fade.amount = Math.min(1, Math.max(0, v / 100)); },
  },
  {
    id: 'soften', name: 'Soften', kind: 'dial',
    applies: hasPattern,
    value: (s) => (pat(s).softenCells > 0 ? fmt(pat(s).softenCells, 2) : 'Crisp'),
    dial: (s, env) => ({
      label: 'Soften', unit: 'cells', ...L('softenCells', {}), step: 0.05, decimals: 2, value: pat(s).softenCells,
      note: softenText(pat(s).softenCells, readoutOf(s.design, env?.library), { compact: true }),
    }),
    set: (d, v) => { if (d.pattern) d.pattern.softenCells = Math.min(2, Math.max(0, v)); },
  },
  {
    id: 'slant', name: 'Slant', kind: 'dial',
    applies: hasPattern,
    value: (s) => (eachFacet(s) ? `${fmt(pat(s).slant.cells, 2)} to ${fmt(pat(s).slant.toCells, 2)}` : pat(s).slant.cells ? fmt(pat(s).slant.cells, 2) : 'None'),
    dial: (s, env) => ({
      label: eachFacet(s) ? 'Slant from' : 'Slant', unit: 'cells', ...L('slantCells', {}), step: 0.25, decimals: 2, value: pat(s).slant.cells,
      note: slantText(s.design, readoutOf(s.design, env?.library), { perFacet: eachFacet(s), compact: true }),
    }),
    set: (d, v) => { if (d.pattern) d.pattern.slant.cells = quarter(v); },
  },
  {
    id: 'slantFacets', name: 'Slant on', kind: 'options',
    applies: (s) => hasPattern(s) && facetsOn(s),
    options: [{ value: 'even', label: 'Even' }, { value: 'facet', label: 'Each facet' }],
    current: (s) => (pat(s).slant.perFacet ? 'facet' : 'even'),
    value: (s) => (pat(s).slant.perFacet ? 'Each facet' : 'Even'),
    note: (s) => (pat(s).slant.perFacet ? 'Each facet leans its own way, between Slant and To' : 'The whole Pattern leans the same way'),
    choose: (d, v) => { if (d.pattern) d.pattern.slant.perFacet = v === 'facet'; },
    label: () => 'Slant on',
  },
  {
    id: 'slantTo', name: 'Slant to', kind: 'dial',
    applies: (s) => hasPattern(s) && eachFacet(s),
    value: (s) => fmt(pat(s).slant.toCells, 2),
    dial: (s, env) => ({
      label: 'Slant to', unit: 'cells', ...L('slantCells', {}), step: 0.25, decimals: 2, value: pat(s).slant.toCells,
      note: slantText(s.design, readoutOf(s.design, env?.library), { perFacet: true, compact: true }),
    }),
    set: (d, v) => { if (d.pattern) d.pattern.slant.toCells = quarter(v); },
  },
];

/** @type {Record<string, object[]>} */
export const DOCK_TOOLS = {
  shape: [
    {
      id: 'points', name: 'Points', kind: 'sheet', part: 'points',
      value: (s) => String(s.design.form.profile.knots.length),
      hint: () => 'Drag the dots on the pot. Tap the outline to add one; hold a dot to remove it.',
      action: 'Edit as numbers',
    },
    {
      id: 'height', name: 'Height', kind: 'dial',
      value: (s) => `${fmt(s.design.form.height, 0)} mm`,
      dial: (s) => ({ label: 'Height', unit: 'mm', ...L('height', {}), step: 1, decimals: 1, value: s.design.form.height }),
      set: (d, v) => setHeight(d, v),
    },
    {
      id: 'width', name: 'Width', kind: 'dial',
      value: (s) => `${fmt(footprintAt(s.design).widthMm, 0)} mm`,
      dial: (s) => ({ label: 'Width', unit: 'mm', ...L('width', {}), step: 1, decimals: 1, value: round1(footprintAt(s.design).widthMm) }),
      set: (d, v) => setWidth(d, v),
    },
    {
      id: 'depth', name: 'Depth', kind: 'dial', lock: true,
      value: (s) => `${fmt(footprintAt(s.design).depthMm, 0)} mm`,
      dial: (s) => {
        const fp = footprintAt(s.design);
        const ratio = L('depthRatio', { min: 0.25, max: 4 });
        const locked = depthLocked(s);
        return {
          label: 'Depth', unit: 'mm', step: 1, decimals: 1, value: round1(fp.depthMm),
          min: Math.max(LIMITS.depth.min, round1(fp.widthMm * ratio.min)),
          max: Math.min(LIMITS.depth.max, round1(fp.widthMm * ratio.max)),
          disabled: locked,
          note: locked ? 'Follows the width. Unlock to set it apart.' : '',
        };
      },
      set: (d, v) => setDepth(d, v),
    },
    {
      id: 'footprint', name: 'Footprint', kind: 'options',
      options: [{ value: 'circle', label: 'Circle' }, { value: 'rectangle', label: 'Rectangle' }],
      current: (s) => s.design.form.plan.footprint,
      value: (s) => (s.design.form.plan.footprint === 'rectangle' ? 'Rectangle' : 'Circle'),
      choose: (d, v) => { d.form.plan.footprint = v; },
    },
    {
      id: 'corners', name: 'Corners', kind: 'dial',
      applies: (s) => s.design.form.plan.footprint === 'rectangle',
      value: (s) => `${Math.round((s.design.form.plan.cornerRounding ?? 0) * 100)} %`,
      dial: (s) => ({
        label: 'Corner rounding', unit: '%', min: 0, max: 100, step: 5, decimals: 0,
        value: Math.round((s.design.form.plan.cornerRounding ?? 0) * 100),
        note: `≈ ${Math.round(footprintAt(s.design).cornerMm)} mm at the widest point`,
      }),
      set: (d, v) => { d.form.plan.cornerRounding = Math.min(1, Math.max(0, v / 100)); },
    },
    {
      id: 'twist', name: 'Twist', kind: 'dial',
      value: (s) => `${fmt(s.design.form.twist.degrees, 0)}°`,
      dial: (s) => ({
        label: 'Twist', unit: '°', ...L('twist', {}), step: 1, decimals: 0, value: s.design.form.twist.degrees,
        note: twistHidden(s.design) ? 'Shows once there’s a pattern, a corner or a morph' : '',
      }),
      set: (d, v) => { d.form.twist.degrees = v; },
    },
    {
      id: 'curve', name: 'Curve', kind: 'options',
      options: [{ value: 'smooth', label: 'Smooth' }, { value: 'gentle', label: 'Gentle' }, { value: 'angular', label: 'Angular' }],
      current: (s) => curveType(s.design.form.profile),
      value: (s) => ({ smooth: 'Smooth', gentle: 'Gentle', angular: 'Angular' })[curveType(s.design.form.profile)],
      note: (s) => CURVE_NOTES[curveType(s.design.form.profile)],
      choose: (d, v) => { d.form.profile.interp = CURVE_INTERP[v]; },
      label: (v) => `${({ smooth: 'Smooth', gentle: 'Gentle', angular: 'Angular' })[v]} curve`,
    },
    MORPH_TOOL,
  ],

  pattern: PATTERN_TOOLS,

  layers: [
    {
      id: 'seam', name: 'Seam', kind: 'options',
      options: [{ value: 'fixed', label: 'Fixed' }, { value: 'followTwist', label: 'Follows twist' }, { value: 'hidden', label: 'Hidden' }],
      current: (s) => s.design.layers.seam.position,
      value: (s) => ({ fixed: 'Fixed', followTwist: 'Follows twist', hidden: 'Hidden' })[s.design.layers.seam.position],
      note: (s) => (s.design.layers.seam.position === 'hidden'
        ? 'In a Pattern’s quietest column, else the corner nearest the grip'
        : 'Drag the grip on the pot to move it'),
      choose: (d, v) => { d.layers.seam.position = v; },
      label: () => 'Seam position',
    },
    {
      id: 'angle', name: 'Angle', kind: 'dial',
      value: (s) => `${Math.round(s.design.layers.seam.angleDeg)}°`,
      dial: (s) => ({
        label: 'Seam angle', unit: '°', min: 0, max: 359, step: 1, decimals: 0, wrap: 360, value: s.design.layers.seam.angleDeg,
        note: s.design.layers.seam.position === 'hidden' ? 'Hides in a Pattern’s quietest column, else the corner nearest this' : 'Or drag the grip on the pot',
      }),
      set: (d, v) => { d.layers.seam.angleDeg = ((Math.round(v) % 360) + 360) % 360; },
    },
    {
      id: 'ramp', name: 'Ramp', kind: 'dial',
      value: (s) => `${s.design.layers.seam.rampPoints} pts`,
      dial: (s) => ({
        label: 'Seam ramp', unit: 'pts', ...L('rampPoints', {}), step: 1, decimals: 0, value: s.design.layers.seam.rampPoints,
        note: 'The climb to the next layer; in a Pattern a point is a cell',
      }),
      set: (d, v) => { d.layers.seam.rampPoints = Math.round(v); },
    },
    {
      id: 'bead', name: 'Bead', kind: 'dial',
      value: (s) => `${fmt(s.design.layers.beadWidthMm)} mm`,
      dial: (s) => ({ label: 'Bead width', unit: 'mm', ...L('beadWidthMm', {}), step: 0.1, decimals: 2, value: s.design.layers.beadWidthMm }),
      set: (d, v) => { d.layers.beadWidthMm = v; },
    },
    {
      id: 'layer', name: 'Layer', kind: 'dial',
      value: (s) => `${fmt(s.design.layers.layerHeightMm, 2)} mm`,
      dial: (s) => ({
        label: 'Layer height', unit: 'mm', ...L('layerHeightMm', {}), step: 0.05, decimals: 2, value: s.design.layers.layerHeightMm,
        note: layerNote(s.design.layers),
      }),
      set: (d, v) => { d.layers.layerHeightMm = v; },
    },
  ],

  base: [
    {
      id: 'floor', name: 'Floor', kind: 'dial',
      value: (s) => `${s.design.base.layers} layers`,
      dial: (s) => ({
        label: 'Base layers', unit: 'layers', ...L('baseLayers', {}), step: 1, decimals: 0, value: s.design.base.layers,
        note: s.design.base.layers > 0 ? 'A spiral floor' : 'No floor: the pot prints as a sleeve',
      }),
      set: (d, v) => { d.base.layers = Math.round(v); },
    },
    {
      id: 'hole', name: 'Hole', kind: 'dial',
      value: (s) => (s.design.base.hole?.diameter > 0 ? `${fmt(s.design.base.hole.diameter, 0)} mm` : 'None'),
      dial: (s) => {
        const dia = s.design.base.hole?.diameter ?? 0;
        const twoBeads = 2 * s.design.layers.beadWidthMm;
        let note = '';
        if (!(s.design.base.layers > 0)) note = 'No floor to put a hole in';
        else if (!(dia > 0)) note = '0 mm = no hole';
        else if (dia < twoBeads) note = `Under two beads (${fmt(twoBeads)} mm): may close up`;
        return {
          label: 'Hole', unit: 'mm', min: 0, max: Math.min(200, LIMITS.holeDiameter.max), step: 1, decimals: 1, value: dia,
          disabled: !(s.design.base.layers > 0), note,
        };
      },
      set: (d, v) => { d.base.hole = { ...(d.base.hole || {}), diameter: v }; },
    },
  ],
};

function safe(fn) {
  try { return fn(); } catch { return ''; }
}

const applies = (state) => (t) => !t.applies || safe(() => t.applies(state));

/**
 * The group tool open in a step's row, with the side it shows, or null: a
 * group opens when it is the tool picked (view.tools[step]).
 * @returns {{ tool: object, mode: string, key: string } | null}
 */
export function openGroup(stepId, state) {
  const id = state.view.tools?.[stepId];
  const tool = (DOCK_TOOLS[stepId] || []).find((t) => t.id === id && t.kind === 'group');
  if (!tool || !applies(state)(tool)) return null;
  const mode = tool.mode(state);
  return { tool, mode, key: `${stepId}.${tool.id}.${mode}` };
}

/**
 * The tools a step's row shows now, in order: the step's own, or an open
 * group's for the side it shows. Print has none: it is the sheet.
 */
export function toolsFor(stepId, state) {
  const g = openGroup(stepId, state);
  const list = g ? g.tool.tools[g.mode] || [] : DOCK_TOOLS[stepId] || [];
  return list.filter(applies(state));
}

/** A tool's chip name. */
export function toolName(tool, state) {
  return typeof tool.name === 'function' ? tool.name(state) : tool.name;
}

/**
 * The tool to show for a step: the one picked (view.tools; in an open group
 * view.tools['<step>.<group>.<side>']), if it still applies, else the first.
 * @returns {object | null}
 */
export function currentTool(stepId, state) {
  const list = toolsFor(stepId, state);
  if (!list.length) return null;
  const g = openGroup(stepId, state);
  const id = g ? state.view.tools?.[g.key] : state.view.tools?.[stepId];
  return list.find((t) => t.id === id) ?? list[0];
}

/**
 * The chip text of the Pattern's drawing tool: the drawing's name, or "None".
 * @returns {{ name: string, entry: object | null }}
 */
export function drawingInfo(state, library) {
  const id = state.design.pattern?.drawing;
  if (!id) return { name: 'None', entry: null };
  const entry = findLayerEntry(library, id, state.design.assets);
  return { name: entry?.name ?? 'Missing', entry };
}
