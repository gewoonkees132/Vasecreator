// Base section (design §9.4, docs/design/v2-base-infill.md): floor thickness
// in layers, the infill (spiral, rings or crossed lines) and a drainage hole:
// the parts Base and Hole of the Base step.

import { numberField, segmented, h } from '../controls.js';
import { limit } from './shape.js';

const INFILLS = [
  { value: 'spiral', label: 'Spiral', note: 'One bead from the wall to the middle' },
  { value: 'rings', label: 'Rings', note: 'Closed rings, one inside the other' },
  { value: 'lines', label: 'Lines', note: 'Straight lines, crossed on every layer' },
];
const infillOf = (b) => INFILLS.find((i) => i.value === b.pattern) || INFILLS[0];

const section = {
  id: 'base',
  title: 'Base',

  summary(design) {
    const b = design.base;
    if (!(b.layers > 0)) return 'no floor (sleeve)';
    const hole = b.hole?.diameter > 0 ? `hole ${b.hole.diameter} mm` : 'no hole';
    return `${b.layers} base layers · ${infillOf(b).label.toLowerCase()} · ${hole}`;
  },

  mount(el, ctx) {
    const { store } = ctx;
    const b0 = store.state.design.base;

    const layers = numberField({
      label: 'Base layers', ...limit(['baseLayers', 'base.layers'], { min: 0, max: 20, step: 1 }), decimals: 0,
      value: b0.layers, info: '',
      onInput: (v) => store.change('Base layers', (d) => { d.base.layers = Math.round(v); }),
      onCommit: () => store.commit(),
    });
    const infill = segmented({
      label: 'Infill',
      options: INFILLS.map(({ value, label }) => ({ value, label })),
      value: infillOf(b0).value,
      onChange: (v) => store.apply('Infill', (d) => { d.base.pattern = v; }),
    });
    const hint = h('p', { class: 'panel-note', text: infillOf(b0).note });
    const hole = numberField({
      label: 'Hole', unit: 'mm', ...limit(['holeDiameter', 'base.hole.diameter', 'holeMm'], { min: 0, max: 200, step: 1 }), decimals: 1,
      value: b0.hole?.diameter ?? 0, info: '',
      onInput: (v) => store.change('Hole', (d) => { d.base.hole = { ...(d.base.hole || {}), diameter: v }; }),
      onCommit: () => store.commit(),
    });

    // The Base step's parts: Base (layers and infill) and Hole.
    for (const e of [layers.el, infill.el, hint]) e.dataset.part = 'base';
    hole.el.dataset.part = 'hole';
    el.append(layers.el, infill.el, hint, hole.el);

    const update = (state) => {
      const b = state.design.base;
      layers.set(b.layers);
      layers.setInfo(b.layers > 0 ? '' : 'No floor: the pot prints as a sleeve');
      infill.set(infillOf(b).value);
      infill.setDisabled?.(!(b.layers > 0));
      hint.textContent = infillOf(b).note;
      const dia = b.hole?.diameter ?? 0;
      hole.set(dia);
      // Design §9.4: under two bead widths the hole may close up (checked again in Prepare print).
      const twoBeads = 2 * state.design.layers.beadWidthMm;
      const fmt = (v) => String(Math.round(v * 10) / 10);
      if (!(dia > 0)) hole.setInfo('0 mm = no hole');
      else if (dia < twoBeads) hole.setInfo(`Narrower than two beads (${fmt(twoBeads)} mm), so it may close up`);
      else hole.setInfo('');
      hole.setDisabled(!(b.layers > 0));
    };
    update(store.state);

    return { update, destroy() { el.replaceChildren(); } };
  },
};

export default section;
export const { id, title, summary, mount } = section;
