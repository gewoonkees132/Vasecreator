// Base section (design §9.4): floor thickness in layers, the infill (spiral
// only in phase 1) and a drainage hole.

import { numberField, segmented, h } from '../controls.js';
import { limit } from './shape.js';

const section = {
  id: 'base',
  title: 'Base',
  advanced: false,

  summary(design) {
    const b = design.base;
    if (!(b.layers > 0)) return 'no floor (sleeve)';
    const hole = b.hole?.diameter > 0 ? `hole ${b.hole.diameter} mm` : 'no hole';
    return `${b.layers} base layers · spiral · ${hole}`;
  },

  mount(el, ctx) {
    const { store } = ctx;
    const b0 = store.state.design.base;

    const layers = numberField({
      label: 'Base layers', min: 0, max: 10, step: 1, decimals: 0,
      value: b0.layers, info: '',
      onInput: (v) => store.change('Base layers', (d) => { d.base.layers = Math.round(v); }),
      onCommit: () => store.commit(),
    });
    const infill = segmented({
      label: 'Infill',
      options: [{ value: 'spiral', label: 'Spiral' }],
      value: 'spiral',
    });
    const hint = h('p', { class: 'panel-note', text: 'More infills later.' });
    const hole = numberField({
      label: 'Hole', unit: 'mm', ...limit(['holeDiameter', 'base.hole.diameter', 'holeMm'], { min: 0, max: 200, step: 1 }), decimals: 1,
      value: b0.hole?.diameter ?? 0, info: '',
      onInput: (v) => store.change('Hole', (d) => { d.base.hole = { ...(d.base.hole || {}), diameter: v }; }),
      onCommit: () => store.commit(),
    });

    el.append(layers.el, infill.el, hint, hole.el);

    const update = (state) => {
      const b = state.design.base;
      layers.set(b.layers);
      layers.setInfo(b.layers > 0 ? '' : 'No floor: the pot prints as a sleeve');
      infill.set(b.pattern || 'spiral');
      const dia = b.hole?.diameter ?? 0;
      hole.set(dia);
      hole.setInfo(dia > 0 ? '' : '0 mm = no hole');
      hole.setDisabled(!(b.layers > 0));
    };
    update(store.state);

    return { update, destroy() { el.replaceChildren(); } };
  },
};

export default section;
export const { id, title, advanced, summary, mount } = section;
