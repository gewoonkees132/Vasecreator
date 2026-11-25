// The tools of the phone dock, per design step (mobile stage §4.1). Each tool
// is one thing you can set from the stage. The dock (ui/dock.js) shows them as
// a row of chips with their values and gives the chosen one a single control.
//
// kinds:
//   dial      a number: dial(state) → the dial's spec, set(draft, v, state) changes the design
//   options   a choice: options, current(state), choose(draft, v)
//   patterns  the swatch carousel for slot A or B
//   sheet     a hint and a button that opens the settings sheet at `part`
//
// Every tool edits the design through the same core functions and limits as
// the sheet's controls, so the two always agree. applies(state) hides a tool
// that has nothing to set yet, like a part that doesn't apply (C34).
// No DOM here: the module is tested on real designs.

import { LIMITS, setHeight, setWidth, setDepth, snapTileHeight } from '../core/design.js';
import { PLAIN } from '../core/patterns.js';
import { footprintAt, depthLocked } from './sections/shape.js';
import { curveType } from './sections/curve.js';
import morph from './sections/morph.js';
import { findEntry, textured, snapToLayers } from './pattern-actions.js';

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

// Twist turns corners, the morph and the pattern; on a plain round pot there
// is nothing to turn (C30).
const twistHidden = (d) => d.form.plan.footprint === 'circle' && (d.form.plan.depthRatio ?? 1) === 1 && !d.form.morph?.map;

const CURVE_NOTES = {
  smooth: 'Flows through the points',
  gentle: 'Never bulges past the points',
  angular: 'Straight lines, rounded corners',
};
const CURVE_INTERP = { smooth: 'catmullRomCentripetal', gentle: 'monotone', angular: 'linear' };

function layerNote(layers) {
  const ratio = layers.layerHeightMm / layers.beadWidthMm;
  return ratio < 0.3 || ratio > 0.6 ? 'Unusual for this bead (0.3–0.6 × bead width)' : '';
}

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
      id: 'morph', name: 'Morph', kind: 'sheet', part: 'morph',
      value: (s) => (s.design.form.morph?.map ? 'On' : 'Off'),
      hint: (s) => (s.design.form.morph?.map
        ? `Morph: ${safe(() => morph.summary(s.design))}.`
        : 'Push the wall in and out with a pattern or a picture, for big shapes like lobes and waves.'),
      action: 'Open morph settings',
    },
  ],

  pattern: [
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
      applies: (s) => textured(s.design.form.detail.a) || textured(s.design.form.detail.b),
      value: (s) => `${fmt(s.design.form.detail.fromMm, 0)} mm`,
      dial: (s) => ({
        label: 'Pattern from', unit: 'mm', min: 0, max: s.design.form.height, step: 1, decimals: 1, value: s.design.form.detail.fromMm,
        note: 'Or drag the bracket beside the pot',
      }),
      set: (d, v) => { d.form.detail.fromMm = Math.max(0, Math.min(v, d.form.detail.toMm - 1)); },
    },
    {
      id: 'to', name: 'To', kind: 'dial',
      applies: (s) => textured(s.design.form.detail.a) || textured(s.design.form.detail.b),
      value: (s) => `${fmt(s.design.form.detail.toMm, 0)} mm`,
      dial: (s) => ({
        label: 'Pattern to', unit: 'mm', min: 0, max: s.design.form.height, step: 1, decimals: 1, value: s.design.form.detail.toMm,
        note: 'Or drag the bracket beside the pot',
      }),
      set: (d, v) => { d.form.detail.toMm = Math.min(d.form.height, Math.max(v, d.form.detail.fromMm + 1)); },
    },
    {
      id: 'blend', name: 'Blend', kind: 'options',
      applies: (s) => !!s.design.form.detail.b,
      options: [{ value: 'even', label: 'Even' }, { value: 'fadesUp', label: 'Fades up' }, { value: 'fadesDown', label: 'Fades down' }, { value: 'middle', label: 'Middle' }],
      current: (s) => s.design.form.detail.blend?.shape ?? 'fadesUp',
      value: (s) => ({ even: 'Even', fadesUp: 'Fades up', fadesDown: 'Fades down', middle: 'Middle' })[s.design.form.detail.blend?.shape] ?? '',
      note: () => 'How B comes in over A, bottom to top',
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
        const where = { fadesUp: 'At the top: ', fadesDown: 'At the bottom: ', middle: 'Halfway up: ' }[blend.shape] ?? '';
        return { label: 'Blend amount', unit: '%', min: 0, max: 100, step: 5, decimals: 0, value: b, note: `${where}A ${100 - b} % · B ${b} %` };
      },
      set: (d, v) => { if (d.form.detail.blend) d.form.detail.blend.amount = Math.min(1, Math.max(0, v / 100)); },
    },
  ],

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
    {
      id: 'overhang', name: 'Overhang', kind: 'dial',
      value: (s) => `${fmt(s.design.rules.overhangLimitDeg, 0)}°`,
      dial: (s) => ({ label: 'Overhang limit', unit: '°', ...L('overhangLimitDeg', {}), step: 1, decimals: 0, value: s.design.rules.overhangLimitDeg }),
      set: (d, v) => { d.rules.overhangLimitDeg = v; },
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

/** The tools of a step that apply now, in order. Print has none: it is the sheet. */
export function toolsFor(stepId, state) {
  return (DOCK_TOOLS[stepId] || []).filter((t) => !t.applies || safe(() => t.applies(state)));
}

/** A tool's chip name (some say which slot they edit). */
export function toolName(tool, state) {
  return typeof tool.name === 'function' ? tool.name(state) : tool.name;
}

/**
 * The tool to show for a step: the one picked (view.tools), if it still
 * applies, else the first. In Pattern the slot tools follow view.slot.
 * @returns {object | null}
 */
export function currentTool(stepId, state) {
  const list = toolsFor(stepId, state);
  if (!list.length) return null;
  let id = state.view.tools?.[stepId];
  if (stepId === 'pattern' && (id === 'a' || id === 'b' || id == null)) id = slotKey(state);
  return list.find((t) => t.id === id) ?? list[0];
}

/**
 * The chip text of a slot tool: the pattern's name, or "None".
 * @returns {{ name: string, entry: object | null, slot: object | null }}
 */
export function slotInfo(state, library, s, saved) {
  const slot = state.design.form.detail[s];
  if (!slot) return { name: 'None', entry: null, slot: null };
  const entry = findEntry(library, slot.pattern, state.design.assets, saved);
  return { name: entry?.name ?? (slot.pattern === PLAIN.id ? 'Plain' : slot.pattern), entry, slot };
}
