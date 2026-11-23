// Profile curve (advanced, design §9.5): Smooth with a tension, or Angular
// with a corner radius in mm.

import { slider, numberField, segmented } from '../controls.js';
import { limit } from './shape.js';

const isAngular = (profile) => profile.interp === 'linear';

const section = {
  id: 'curve',
  title: 'Profile curve',
  advanced: true,

  summary(design) {
    const p = design.form.profile;
    return isAngular(p) ? `angular · corners ${p.cornerMm ?? 0} mm` : `smooth · tension ${p.tension ?? 0.5}`;
  },

  mount(el, ctx) {
    const { store } = ctx;
    const p0 = store.state.design.form.profile;

    const kind = segmented({
      label: 'Profile curve',
      hideLabel: true,
      options: [{ value: 'smooth', label: 'Smooth' }, { value: 'angular', label: 'Angular' }],
      value: isAngular(p0) ? 'angular' : 'smooth',
      onChange: (v) => store.apply(v === 'angular' ? 'Angular curve' : 'Smooth curve', (d) => {
        d.form.profile.interp = v === 'angular' ? 'linear' : 'catmullRomCentripetal';
      }),
    });
    const tension = slider({
      label: 'Tension', min: 0, max: 1, step: 0.05, decimals: 2, value: p0.tension ?? 0.5,
      onInput: (v) => store.change('Tension', (d) => { d.form.profile.tension = v; }),
      onCommit: () => store.commit(),
    });
    const corner = numberField({
      label: 'Corner radius', unit: 'mm', ...limit(['cornerMm', 'form.profile.cornerMm'], { min: 0, max: 100, step: 0.5 }), decimals: 1,
      value: p0.cornerMm ?? 0,
      onInput: (v) => store.change('Corner radius', (d) => { d.form.profile.cornerMm = v; }),
      onCommit: () => store.commit(),
    });

    el.append(kind.el, tension.el, corner.el);

    const update = (state) => {
      const p = state.design.form.profile;
      const angular = isAngular(p);
      kind.set(angular ? 'angular' : 'smooth');
      tension.el.hidden = angular;
      corner.el.hidden = !angular;
      tension.set(p.tension ?? 0.5);
      corner.set(p.cornerMm ?? 0);
    };
    update(store.state);

    return { update, destroy() { el.replaceChildren(); } };
  },
};

export default section;
export const { id, title, advanced, summary, mount } = section;
