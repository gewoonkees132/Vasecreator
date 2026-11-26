// Painting the Pattern on the pot (D79–D87, docs/design/v2-paint-brush.md):
// what the Paint part of the Pattern step (ui/sections/pattern.js), the
// phone dock's Paint tools (ui/dock-tools.js) and main.js share. No DOM.
//
// The paint itself is in the design (design.pattern.paint, core/paint.js).
// The brush is not: Paint mode, the Paint · Turn switch and the brush's
// settings live in the view (view.paint, view.paintTurn, view.brush), last
// the session and never reach history. The settings used last are kept in
// this browser.

import { BRUSH_DEFAULTS, BRUSH_LIMITS, PAINT_STROKES, decodePaint, maxBrushMm } from '../core/paint.js';

export { BRUSH_LIMITS, maxBrushMm };
import { createProfile } from '../core/profile.js';
import { createPlan } from '../core/plan.js';

const LS_BRUSH = 'vc2.brush';

export const STROKE_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'line', label: 'Line' },
  { value: 'around', label: 'Around' },
  { value: 'fade', label: 'Fade' },
];
export const STROKE_NOTES = {
  free: 'Follows your finger.',
  line: 'Press, drag and let go: a straight stroke. At an angle it winds round the pot.',
  around: 'A level band all the way round, where you drag.',
  fade: 'Press and drag up or down: the Pattern fades between the two heights, all the way round.',
};
export const MORE_OPTIONS = [{ value: 'less', label: 'Less' }, { value: 'more', label: 'More' }];
export const MORE_NOTES = { less: 'Takes the Pattern away where you paint.', more: 'Brings the Pattern back where you paint.' };
export const TURN_OPTIONS = [{ value: 'paint', label: 'Paint' }, { value: 'turn', label: 'Turn' }];

const clamp = (v, { min, max }, fallback) => (Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback);

/** A brush with every setting in its range. */
export function normaliseBrush(input) {
  const b = input && typeof input === 'object' ? input : {};
  return {
    stroke: PAINT_STROKES.includes(b.stroke) ? b.stroke : BRUSH_DEFAULTS.stroke,
    more: b.more === true,
    sizeMm: clamp(b.sizeMm, BRUSH_LIMITS.sizeMm, BRUSH_DEFAULTS.sizeMm),
    soft: clamp(b.soft, BRUSH_LIMITS.soft, BRUSH_DEFAULTS.soft),
    strength: clamp(b.strength, BRUSH_LIMITS.strength, BRUSH_DEFAULTS.strength),
  };
}

/** The brush this browser used last, or the standard one. */
export function loadBrush() {
  try {
    return normaliseBrush(JSON.parse(globalThis.localStorage?.getItem(LS_BRUSH) ?? 'null'));
  } catch {
    return normaliseBrush(null);
  }
}

let remembered = null;

/** The brush in use: the view's, else the one this browser used last. */
export function brushOf(state) {
  return state.view.brush ?? (remembered ||= loadBrush());
}

/**
 * A view patch that changes brush settings, remembered in this browser.
 * The view only: a brush never makes a history step.
 */
export function brushPatch(state, patch) {
  const brush = normaliseBrush({ ...brushOf(state), ...patch });
  remembered = brush;
  try { globalThis.localStorage?.setItem(LS_BRUSH, JSON.stringify(brush)); } catch { /* private mode */ }
  return { brush };
}

/** Changes brush settings. */
export function setBrush(store, patch) {
  store.setView(brushPatch(store.state, patch));
}

/** The brush's size on this pot: never more than half its height. */
export function brushSizeMm(state) {
  return Math.min(brushOf(state).sizeMm, maxBrushMm(state.design.form.height));
}

/** Whether a design has something painted. */
export function hasPaint(design) {
  return !!design.pattern?.paint;
}

/**
 * Whether Paint mode is on: asked for, in the Pattern step, with a Pattern
 * to paint and the 2D editor closed (D85).
 */
export function paintActive(state) {
  const v = state.view;
  return !!v.paint && v.step === 'pattern' && v.mode === 'design' && !v.editor && !!state.design.pattern;
}

/** Turns Paint mode on or off; on always starts at Paint, not Turn. */
export function setPaintMode(store, on) {
  store.setView({ paint: !!on, paintTurn: false });
}

/** Puts the overlay back to white everywhere: one history step (D81). */
export function resetPaint(store) {
  if (!hasPaint(store.state.design)) return false;
  return store.apply('Reset paint', (d) => { if (d.pattern) d.pattern.paint = null; });
}

/**
 * The wall a stroke paints on: the overlay as it is, the pot's height and
 * its way round in mm at a height share (the plain form, without the Morph).
 * @param {object} design normalised
 * @returns {{ before: Uint8Array | null, heightMm: number, perimeterAt: (v: number) => number }}
 */
export function wallOf(design) {
  const profile = createProfile(design.form.profile);
  const around = createPlan(design.form.plan).unitPerimeter;
  const heightMm = design.form.height;
  return {
    before: decodePaint(design.pattern?.paint),
    heightMm,
    perimeterAt: (v) => profile.at(v * heightMm) * around,
  };
}

const percent = (v) => `${Math.round(v * 100)} %`;

/** The Paint part's one-line summary. */
export function paintText(state) {
  if (!hasPaint(state.design)) return 'Nothing painted';
  return 'Painted';
}

export const brushText = {
  size: (state) => `${Math.round(brushSizeMm(state))} mm`,
  soft: (state) => percent(brushOf(state).soft),
  strength: (state) => percent(brushOf(state).strength),
};
