// The warning rules in the warnings card (pattern studio D44, ui/rules.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, defaultDesign, normaliseDesign } from '../core/design.js';
import { computePreview } from '../core/engine.js';
import { RULES, cardLayout, ruleFor, ruleLimits, setRule, shownRule } from '../ui/rules.js';
import { DOCK_TOOLS } from '../ui/dock-tools.js';
import { STEP_LIST } from '../ui/steps.js';
import { library } from './support/fixtures.js';

const field = (key) => RULES.flatMap((r) => r.fields).find((f) => f.key === key);
const warn = (id, bit = 1) => ({ id, severity: 'warning', bit, message: id });

test('every rule field edits a rule of the design, and every rule has a field', () => {
  const keys = RULES.flatMap((r) => r.fields.map((f) => f.key));
  assert.deepEqual([...keys].sort(), Object.keys(defaultDesign().rules).sort());
  for (const key of keys) assert.ok(LIMITS[key], key);
  // Each rule belongs to the check whose warning it sets.
  assert.deepEqual(RULES.map((r) => r.warning), ['overhang', 'support', 'finePattern']);
  assert.equal(ruleFor('support').id, 'support');
  assert.equal(ruleFor('narrow'), undefined);
});

test('ratios of a bead show as percentages, within the design limits', () => {
  const d = defaultDesign();
  assert.equal(shownRule(d, field('overhangLimitDeg')), 45);
  assert.equal(shownRule(d, field('supportRatio')), 70);
  assert.equal(shownRule(d, field('curveRatio')), 50);
  assert.equal(shownRule(d, field('layersPerBump')), 2);
  assert.deepEqual(ruleLimits(field('supportRatio')), { min: 10, max: 100, step: 5 });
  assert.deepEqual(ruleLimits(field('curveRatio')), { min: 10, max: 150, step: 5 });
  assert.deepEqual(ruleLimits(field('overhangLimitDeg')), { min: 5, max: 80, step: 1 });
  assert.deepEqual(ruleLimits(field('layersPerBump')), { min: 1, max: 6, step: 1 });
});

test('a shown value writes back unscaled, clamped and whole where it must be', () => {
  const d = defaultDesign();
  setRule(d, field('supportRatio'), 35);
  assert.equal(d.rules.supportRatio, 0.35);
  setRule(d, field('curveRatio'), 55);
  assert.equal(d.rules.curveRatio, 0.55);
  setRule(d, field('curveRatio'), 400);
  assert.equal(d.rules.curveRatio, LIMITS.curveRatio.max);
  setRule(d, field('layersPerBump'), 2.6);
  assert.equal(d.rules.layersPerBump, 3);
  setRule(d, field('overhangLimitDeg'), 2);
  assert.equal(d.rules.overhangLimitDeg, 5);
  // What a field writes survives normalising unchanged.
  assert.deepEqual(normaliseDesign(d).rules, d.rules);
});

test('a rule sits under its warning, and in the Rules group without one', () => {
  const none = cardLayout([]);
  assert.equal(none.list.length, 0);
  assert.deepEqual(none.rest.map((e) => e.rule.id), ['overhang', 'support', 'fineness']);

  const some = cardLayout([warn('bed'), warn('support'), warn('layerRatio', 0)]);
  // The rules come first in the list, then the other warnings in their order.
  assert.deepEqual(some.list.map((e) => e.rule?.id ?? e.warning.id), ['support', 'bed', 'layerRatio']);
  assert.equal(some.list[0].warning.id, 'support');
  assert.deepEqual(some.rest.map((e) => e.rule.id), ['overhang', 'fineness']);
  assert.ok(some.rest.every((e) => e.warning === null));
});

test('a rule being edited stays where it is while its warning comes and goes', () => {
  // Fixed under its warning: it stays in the list, passing.
  const fixed = cardLayout([], new Map([['overhang', 'list']]));
  assert.deepEqual(fixed.list, [{ rule: RULES[0], warning: null }]);
  assert.deepEqual(fixed.rest.map((e) => e.rule.id), ['support', 'fineness']);
  // Brought up from the Rules group: it shows its warning there.
  const raised = cardLayout([warn('support')], new Map([['support', 'rest']]));
  assert.deepEqual(raised.list, []);
  assert.equal(raised.rest.find((e) => e.rule.id === 'support').warning.id, 'support');
});

test('the overhang limit is only in the warnings card now', () => {
  const layers = STEP_LIST.find((s) => s.id === 'layers');
  assert.deepEqual(layers.parts.map((p) => p.id), ['seam', 'bead']);
  for (const tools of Object.values(DOCK_TOOLS)) {
    for (const tool of tools) {
      assert.notEqual(tool.id, 'overhang');
      if (tool.set) {
        // No dock tool writes a rule.
        const d = defaultDesign();
        tool.set(d, 1, { design: defaultDesign(), view: {} }, { library });
        assert.deepEqual(d.rules, defaultDesign().rules, tool.id);
      }
    }
  }
});

test('a rule set in the card changes the warning live', () => {
  // A cone leaning about 37°: fine at 45°, flagged at 30°, as the card sets it.
  const d = defaultDesign();
  d.form.detail.a = null;
  d.form.profile = { interp: 'linear', tension: 0.5, cornerMm: 0, knots: [{ z: 0, r: 40 }, { z: 40, r: 40 }, { z: 80, r: 70 }, { z: 100, r: 70 }] };
  d.form.height = 100;
  const overhang = (design) => computePreview(design, { library }).warnings.find((w) => w.id === 'overhang');
  assert.equal(overhang(d), undefined);
  setRule(d, field('overhangLimitDeg'), 30);
  assert.match(overhang(d).message, /^Leans past 30° /);
});
