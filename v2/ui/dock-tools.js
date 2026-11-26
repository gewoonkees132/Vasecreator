// The tools of the phone dock, per design step (mobile stage §4.1). Each tool
// is one thing you can set from the stage. The dock (ui/dock.js) shows them as
// a row of chips with their values and gives the chosen one a single control.
//
// kinds:
//   dial      a number: dial(state, env) → the dial's spec, set(draft, v, state, env) changes the design
//   options   a choice: options, current(state), choose(draft, v)
//   patterns  the Detailed morph's swatch carousel for slot A or B
//   drawings  the Pattern's carousel: the starter Patterns, None and your own (§3.8)
//   sheet     a hint and a button that opens the settings sheet at `part`
//   group     a tool that opens a row of its own (Shape's Morph, D36): `modes`
//             (a toggle at the front of the row), mode(state) and tools per mode
//
// env is { library }: the tools that need the libraries (the Pattern's
// density readout) read them from it.
//
// Every tool edits the design through the same core functions and limits as
// the sheet's controls, so the two always agree. applies(state) hides a tool
// that has nothing to set yet, like a part that doesn't apply (C34).
// No DOM here: the module is tested on real designs.

import { LIMITS, setHeight, setWidth, setDepth, snapTileHeight } from '../core/design.js';
import { PLAIN } from '../core/patterns.js';
import { DEPTH_BEADS } from '../core/layer-pattern.js';
import { footprintAt, depthLocked } from './sections/shape.js';
import { curveType } from './sections/curve.js';
import morph from './sections/morph.js';
import {
  findEntry, textured, snapToLayers, findLayerEntry, readoutOf, densityText, softenText, densityLimits,
} from './pattern-actions.js';

const round1 = (v) => Math.round(v * 10) / 10;
const fmt = (v, decimals = 1) => {
  const f = 10 ** decimals;
  return String(Math.round(v * f) / f + 0);
};
const L = (key, fallback) => ({ ...fallback, ...(LIMITS[key] || {}) });

const slotKey = (state) => (state.view.slot === 'b' ? 'b' : 'a');
const slotOf = (state) => state.design.form.detail[slotKey(state)];
/** "Depth" while only A is in use, "Depth B" once there is a B. */
const perSlot = (name) => (state) => (state.design.form.detail.b ? `${name} ${slotKey(state).toUpperCase()}` : name);
const detailOn = (d) => textured(d.form.detail.a) || textured(d.form.detail.b);

// Twist turns corners, the morph and the patterns; on a plain round pot there
// is nothing to turn (C30).
const twistHidden = (d) => d.form.plan.footprint === 'circle' && (d.form.plan.depthRatio ?? 1) === 1
  && !d.form.morph?.map && !detailOn(d) && !d.pattern;

const CURVE_NOTES = {
  smooth: 'Flows through the points',
  gentle: 'Never bulges past the points',
  angular: 'Straight lines, rounded corners',
};
const CURVE_INTERP = { smooth: 'catmullRomCentripetal', gentle: 'monotone', angular: 'linear' };

/** The blend and fade words (D42, D54), shared by the Detailed morph's A/B and the Pattern's Fade. */
export const BLEND_OPTIONS = [
  { value: 'even', label: 'Even' }, { value: 'fadesUp', label: 'Fades up' }, { value: 'fadesDown', label: 'Fades down' },
  { value: 'middle', label: 'Middle' }, { value: 'diagonal', label: 'Diagonal' },
];
const blendLabel = (v) => BLEND_OPTIONS.find((o) => o.value === v)?.label ?? '';
// Where the amount shows most, for the notes.
const BLEND_WHERE = { fadesUp: 'At the top: ', fadesDown: 'At the bottom: ', middle: 'Halfway up: ', diagonal: 'In the band: ' };

function layerNote(layers) {
  const ratio = layers.layerHeightMm / layers.beadWidthMm;
  return ratio < 0.3 || ratio > 0.6 ? 'Unusual for this bead (0.3–0.6 × bead width)' : '';
}

// ---------- Shape's Morph tool: Large (the Morph) · Detailed (the Detailed morph) ----------

const LARGE_TOOLS = [
  {
    id: 'morph', name: 'Morph', kind: 'sheet', part: 'morph',
    value: (s) => (s.design.form.morph?.map ? 'On' : 'Off'),
    hint: (s) => (s.design.form.morph?.map
      ? `Morph: ${safe(() => morph.summary(s.design))}.`
      : 'Push the whole wall in and out with a map or a picture, for big shapes like lobes and waves.'),
    action: 'Open morph settings',
  },
];

/** The Detailed morph's tools (D36): its two slots, their settings, its range and blend. */
const DETAIL_TOOLS = [
  { id: 'a', name: 'A', kind: 'patterns', slot: 'a' },
  { id: 'b', name: 'B', kind: 'patterns', slot: 'b' },
  {
    id: 'depth', name: perSlot('Depth'), kind: 'dial',
    applies: (s) => textured(slotOf(s)),
    value: (s) => `${fmt(slotOf(s)?.depthMm ?? 0)} mm`,
    dial: (s) => ({ label: perSlot('Depth')(s), unit: 'mm', ...L('depthMm', {}), step: 0.1, decimals: 1, value: slotOf(s)?.depthMm ?? 0 }),
    set: (d, v, s) => { const slot = d.form.detail[slotKey(s)]; if (slot) slot.depthMm = v; },
  },
  {
    id: 'repeats', name: perSlot('Repeats'), kind: 'dial',
    applies: (s) => textured(slotOf(s)),
    value: (s) => `${slotOf(s)?.repeats ?? 1}×`,
    dial: (s) => {
      const slot = slotOf(s);
      const fp = footprintAt(s.design);
      let note = `≈ ${Math.round(fp.perimeterMm / Math.max(1, slot?.repeats ?? 1))} mm per repeat`;
      if (s.design.form.plan.footprint === 'rectangle' && (slot?.repeats ?? 1) % 4 !== 0) note += ' · try a multiple of 4';
      return { label: perSlot('Repeats around')(s), unit: '×', ...L('repeats', {}), step: 1, decimals: 0, value: slot?.repeats ?? 1, note };
    },
    set: (d, v, s) => { const slot = d.form.detail[slotKey(s)]; if (slot) slot.repeats = Math.max(1, Math.round(v)); },
  },
  {
    id: 'tile', name: perSlot('Tile'), kind: 'dial',
    applies: (s) => textured(slotOf(s)),
    value: (s) => `${fmt(snapTileHeight(slotOf(s)?.tileHeightMm ?? 0, s.design.layers.layerHeightMm))} mm`,
    dial: (s) => {
      const lh = s.design.layers.layerHeightMm;
      const v = snapTileHeight(slotOf(s)?.tileHeightMm ?? lh, lh);
      return {
        label: perSlot('Tile height')(s), unit: 'mm', step: lh, decimals: 2, value: v,
        min: snapToLayers(LIMITS.tileHeightMm.min, lh), max: Math.min(400, LIMITS.tileHeightMm.max),
        note: `${Math.round(v / lh)} layers per tile`,
      };
    },
    set: (d, v, s) => { const slot = d.form.detail[slotKey(s)]; if (slot) slot.tileHeightMm = snapToLayers(v, d.layers.layerHeightMm); },
  },
  {
    id: 'from', name: 'From', kind: 'dial',
    applies: (s) => detailOn(s.design),
    value: (s) => `${fmt(s.design.form.detail.fromMm, 0)} mm`,
    dial: (s) => ({
      label: 'Detailed morph from', unit: 'mm', min: 0, max: s.design.form.height, step: 1, decimals: 1, value: s.design.form.detail.fromMm,
      note: 'Or drag the bracket beside the pot',
    }),
    set: (d, v) => { d.form.detail.fromMm = Math.max(0, Math.min(v, d.form.detail.toMm - 1)); },
  },
  {
    id: 'to', name: 'To', kind: 'dial',
    applies: (s) => detailOn(s.design),
    value: (s) => `${fmt(s.design.form.detail.toMm, 0)} mm`,
    dial: (s) => ({
      label: 'Detailed morph to', unit: 'mm', min: 0, max: s.design.form.height, step: 1, decimals: 1, value: s.design.form.detail.toMm,
      note: 'Or drag the bracket beside the pot',
    }),
    set: (d, v) => { d.form.detail.toMm = Math.min(d.form.height, Math.max(v, d.form.detail.fromMm + 1)); },
  },
  {
    id: 'blend', name: 'Blend', kind: 'options',
    applies: (s) => !!s.design.form.detail.b,
    options: BLEND_OPTIONS,
    current: (s) => s.design.form.detail.blend?.shape ?? 'fadesUp',
    value: (s) => blendLabel(s.design.form.detail.blend?.shape),
    note: (s) => (s.design.form.detail.blend?.shape === 'diagonal' ? 'B comes in as a band that winds round the pot' : 'How B comes in over A, bottom to top'),
    choose: (d, v) => {
      if (!d.form.detail.blend) d.form.detail.blend = { shape: v, amount: 1 };
      d.form.detail.blend.shape = v;
      // Even at full amount is all B; start at half so the first tap shows a mix.
      if (v === 'even' && d.form.detail.blend.amount === 1) d.form.detail.blend.amount = 0.5;
    },
    label: () => 'Blend',
  },
  {
    id: 'amount', name: 'Amount', kind: 'dial',
    applies: (s) => !!s.design.form.detail.b,
    value: (s) => `${Math.round((s.design.form.detail.blend?.amount ?? 1) * 100)} %`,
    dial: (s) => {
      const blend = s.design.form.detail.blend ?? { shape: 'fadesUp', amount: 1 };
      const b = Math.round(blend.amount * 100);
      return { label: 'Blend amount', unit: '%', min: 0, max: 100, step: 5, decimals: 0, value: b, note: `${BLEND_WHERE[blend.shape] ?? ''}A ${100 - b} % · B ${b} %` };
    },
    set: (d, v) => { if (d.form.detail.blend) d.form.detail.blend.amount = Math.min(1, Math.max(0, v / 100)); },
  },
];

const MORPH_MODES = [{ value: 'large', label: 'Large' }, { value: 'detailed', label: 'Detailed' }];

/**
 * Which side of the Morph tool shows: the one picked last (view.morphKind),
 * else Detailed when the pot has a Detailed morph and no Morph.
 */
export function morphMode(state) {
  const k = state.view.morphKind;
  if (k === 'large' || k === 'detailed') return k;
  return detailOn(state.design) && !state.design.form.morph?.map ? 'detailed' : 'large';
}

// ---------- The Pattern step's tools (the bead-scale Pattern, D37–D42) ----------

const hasPattern = (s) => !!s.design.pattern;
const pat = (s) => s.design.pattern;
const deepest = (d) => Math.floor(DEPTH_BEADS.max * d.layers.beadWidthMm * 100) / 100;

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
    {
      id: 'morph', name: 'Morph', kind: 'group', back: 'Shape',
      value: (s) => {
        const large = !!s.design.form.morph?.map;
        const detailed = detailOn(s.design);
        return large && detailed ? 'Both' : large ? 'Large' : detailed ? 'Detailed' : 'Off';
      },
      modes: MORPH_MODES,
      modesLabel: 'Morph size',
      mode: morphMode,
      setMode: (v) => ({ morphKind: v }),
      tools: { large: LARGE_TOOLS, detailed: DETAIL_TOOLS },
    },
  ],

  pattern: PATTERN_TOOLS,

  layers: [
    {
      id: 'seam', name: 'Seam', kind: 'options',
      options: [{ value: 'fixed', label: 'Fixed' }, { value: 'followTwist', label: 'Follows twist' }, { value: 'hidden', label: 'Hidden' }],
      current: (s) => s.design.layers.seam.position,
      value: (s) => ({ fixed: 'Fixed', followTwist: 'Follows twist', hidden: 'Hidden' })[s.design.layers.seam.position],
      note: (s) => (s.design.layers.seam.position === 'hidden'
        ? 'In the corner or groove nearest the grip'
        : 'Drag the grip on the pot to move it'),
      choose: (d, v) => { d.layers.seam.position = v; },
      label: () => 'Seam position',
    },
    {
      id: 'angle', name: 'Angle', kind: 'dial',
      value: (s) => `${Math.round(s.design.layers.seam.angleDeg)}°`,
      dial: (s) => ({
        label: 'Seam angle', unit: '°', min: 0, max: 359, step: 1, decimals: 0, wrap: 360, value: s.design.layers.seam.angleDeg,
        note: s.design.layers.seam.position === 'hidden' ? 'Hides in the corner or groove nearest this' : 'Or drag the grip on the pot',
      }),
      set: (d, v) => { d.layers.seam.angleDeg = ((Math.round(v) % 360) + 360) % 360; },
    },
    {
      id: 'ramp', name: 'Ramp', kind: 'dial',
      value: (s) => `${fmt(s.design.layers.seam.rampLengthMm, 0)} mm`,
      dial: (s) => ({ label: 'Seam ramp length', unit: 'mm', ...L('rampLengthMm', {}), step: 1, decimals: 1, value: s.design.layers.seam.rampLengthMm }),
      set: (d, v) => { d.layers.seam.rampLengthMm = v; },
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

/** A tool's chip name (some say which slot they edit). */
export function toolName(tool, state) {
  return typeof tool.name === 'function' ? tool.name(state) : tool.name;
}

/**
 * The tool to show for a step: the one picked (view.tools; in an open group
 * view.tools['<step>.<group>.<side>']), if it still applies, else the first.
 * The Detailed morph's slot tools follow view.slot.
 * @returns {object | null}
 */
export function currentTool(stepId, state) {
  const list = toolsFor(stepId, state);
  if (!list.length) return null;
  const g = openGroup(stepId, state);
  let id = g ? state.view.tools?.[g.key] : state.view.tools?.[stepId];
  if (g?.mode === 'detailed' && (id === 'a' || id === 'b' || id == null)) id = slotKey(state);
  return list.find((t) => t.id === id) ?? list[0];
}

/**
 * The chip text of a slot tool: the pattern's name, or "None".
 * @returns {{ name: string, entry: object | null, slot: object | null }}
 */
export function slotInfo(state, library, s) {
  const slot = state.design.form.detail[s];
  if (!slot) return { name: 'None', entry: null, slot: null };
  const entry = findEntry(library, slot.pattern, state.design.assets);
  return { name: entry?.name ?? (slot.pattern === PLAIN.id ? 'Plain' : slot.pattern), entry, slot };
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
