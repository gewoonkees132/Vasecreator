// Footprint (advanced, design §9.5): the same control as in Shape. Polygon
// and Custom outlines join it later (D11).

import { footprintControls } from './shape.js';

const section = {
  id: 'footprint',
  title: 'Footprint',
  advanced: true,

  summary(design) {
    const plan = design.form.plan;
    return plan.footprint === 'rectangle' ? `rectangle · corners ${Math.round((plan.cornerRounding ?? 0) * 100)} %` : 'circle';
  },

  mount(el, ctx) {
    const fp = footprintControls(ctx.store, { hideLabel: true });
    el.append(...fp.els);
    const update = (state) => fp.update(state.design);
    update(ctx.store.state);
    return {
      update,
      destroy() {
        fp.destroy();
        el.replaceChildren();
      },
    };
  },
};

export default section;
export const { id, title, advanced, summary, mount } = section;
