// The warning rules (pattern studio D44): the thresholds the design checks
// use (design.rules), set in the warnings card right under their warning
// (ui/chips.js). No DOM here, so the card's layout can be tested.

import { LIMITS } from '../core/design.js';

/**
 * One rule per check that has a threshold, in the order the design checks
 * list their warnings (core/checks.js). A field shows its rule the way people
 * read it: the ratios of a bead width as a percentage (`scale` 100).
 * `ok` is what the rule's line says while its check passes.
 */
export const RULES = Object.freeze([
  {
    id: 'overhang', warning: 'overhang', name: 'Overhang',
    ok: 'Nothing leans past the limit',
    fields: [{ key: 'overhangLimitDeg', label: 'Overhang limit', unit: '°', scale: 1, decimals: 0 }],
  },
  {
    id: 'support', warning: 'support', name: 'Bead support',
    ok: 'Every bead sits on the one below',
    fields: [{ key: 'supportRatio', label: 'Bead support', unit: '%', scale: 100, decimals: 0, info: 'How far a bead may sit off the one below, of a bead width' }],
  },
  {
    id: 'fineness', warning: 'finePattern', name: 'Fineness',
    ok: 'Nothing finer than the bead can print',
    fields: [
      { key: 'curveRatio', label: 'Tightest curve', unit: '%', scale: 100, decimals: 0, info: 'Its radius, of a bead width' },
      { key: 'layersPerBump', label: 'Layers per bump', unit: '', scale: 1, decimals: 0, info: 'Up the wall, for a Detailed morph' },
    ],
  },
]);

const round = (v, decimals) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** The rule whose check gives this warning id, or undefined. */
export function ruleFor(warningId) {
  return RULES.find((r) => r.warning === warningId);
}

/** A field's { min, max, step } as shown (LIMITS times its scale). */
export function ruleLimits(field) {
  const l = LIMITS[field.key];
  return { min: round(l.min * field.scale, 6), max: round(l.max * field.scale, 6), step: round(l.step * field.scale, 6) };
}

/** A rule's value as its field shows it. */
export function shownRule(design, field) {
  return round(design.rules[field.key] * field.scale, field.decimals);
}

/**
 * Writes a shown value back into a design draft: unscaled, held in LIMITS,
 * whole for a whole-number rule (layers per bump).
 */
export function setRule(draft, field, shown) {
  const l = LIMITS[field.key];
  let v = round(shown / field.scale, 6);
  if (Number.isInteger(l.step) && Number.isInteger(l.min)) v = Math.round(v);
  draft.rules[field.key] = Math.min(Math.max(v, l.min), l.max);
}

/**
 * Where everything goes in the warnings card.
 *
 * A rule sits under its warning in the list while the warning shows, and
 * in the Rules group at the foot of the card while it doesn't. A rule being
 * edited is `pinned` where it was, so it never moves under a finger or a
 * pointer: a warning the edit fixes stays in the list as a passing line, and
 * one it brings up shows in the Rules group, on the rule's own line.
 * The list holds the rules first, in their order, then the other warnings.
 * @param {{ id: string }[]} warnings the listed warnings, in order
 * @param {Map<string, 'list' | 'rest'>} [pinned] rule id → where it stays
 * @returns {{ list: { rule?: object, warning: object | null }[], rest: { rule: object, warning: object | null }[] }}
 */
export function cardLayout(warnings, pinned = new Map()) {
  const list = [];
  const rest = [];
  for (const rule of RULES) {
    const warning = warnings.find((w) => w.id === rule.warning) || null;
    const where = pinned.get(rule.id) ?? (warning ? 'list' : 'rest');
    (where === 'list' ? list : rest).push({ rule, warning });
  }
  for (const warning of warnings) {
    if (!ruleFor(warning.id)) list.push({ warning });
  }
  return { list, rest };
}
