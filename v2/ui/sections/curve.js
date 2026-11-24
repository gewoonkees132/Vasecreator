// Profile curve (design §9.5, issue #6), the Curve part of Shape. Three curve types:
//   Smooth   centripetal Catmull-Rom with a tension (core 'catmullRomCentripetal')
//   Gentle   never bulges past the points (core 'monotone', Fritsch–Carlson)
//   Angular  straight lines with a corner radius in mm (core 'linear')
// Switching type keeps the points; the curve is redrawn through them.
// Per-point control (sharp points, one corner's radius) is in Profile points.

import { slider, numberField, segmented, h } from '../controls.js';
import { limit } from './shape.js';

const TYPES = [
  { value: 'smooth', interp: 'catmullRomCentripetal', label: 'Smooth', note: 'Flows through the points. Tension sets how round it is.' },
  { value: 'gentle', interp: 'monotone', label: 'Gentle', note: 'Flows through the points without bulging past them.' },
  { value: 'angular', interp: 'linear', label: 'Angular', note: 'Straight lines between the points, with rounded corners.' },
];

/** Smooth, Gentle or Angular for a profile. */
export function curveType(profile) {
  return TYPES.find((t) => t.interp === profile.interp)?.value ?? 'smooth';
}

const interior = (knots) => knots.slice(1, -1);

const section = {
  id: 'curve',
  title: 'Profile curve',

  summary(design) {
    const p = design.form.profile;
    const type = curveType(p);
    if (type === 'angular') {
      const own = interior(p.knots).some((k) => Number.isFinite(k.corner) && k.corner !== (p.cornerMm ?? 0));
      return own ? 'angular · corners vary' : `angular · corners ${p.cornerMm ?? 0} mm`;
    }
    const sharp = interior(p.knots).filter((k) => k.sharp).length;
    const extra = sharp ? ` · ${sharp} sharp point${sharp === 1 ? '' : 's'}` : '';
    return type === 'gentle' ? `gentle${extra}` : `smooth · tension ${p.tension ?? 0.5}${extra}`;
  },

  mount(el, ctx) {
    const { store } = ctx;
    const p0 = store.state.design.form.profile;

    const kind = segmented({
      label: 'Profile curve',
      hideLabel: true,
      options: TYPES.map((t) => ({ value: t.value, label: t.label })),
      value: curveType(p0),
      onChange: (v) => {
        const type = TYPES.find((t) => t.value === v);
        store.apply(`${type.label} curve`, (d) => { d.form.profile.interp = type.interp; });
      },
    });
    const note = h('p', { class: 'panel-note' });
    const tension = slider({
      label: 'Tension', min: 0, max: 1, step: 0.01, snap: 0.05, decimals: 2, value: p0.tension ?? 0.5,
      onInput: (v) => store.change('Tension', (d) => { d.form.profile.tension = v; }),
      onCommit: () => store.commit(),
    });
    // "All corners": a corner set on one point in Profile points gives way.
    const corner = numberField({
      label: 'Corner radius', unit: 'mm', ...limit(['cornerMm', 'form.profile.cornerMm'], { min: 0, max: 100, step: 0.5 }), decimals: 1,
      value: p0.cornerMm ?? 0, info: '',
      onInput: (v) => store.change('Corner radius', (d) => {
        d.form.profile.cornerMm = v;
        for (const k of d.form.profile.knots) delete k.corner;
      }),
      onCommit: () => store.commit(),
    });

    el.append(kind.el, note, tension.el, corner.el);

    const update = (state) => {
      const p = state.design.form.profile;
      const type = curveType(p);
      kind.set(type);
      note.textContent = TYPES.find((t) => t.value === type).note;
      tension.el.hidden = type !== 'smooth';
      corner.el.hidden = type !== 'angular';
      tension.set(p.tension ?? 0.5);
      corner.set(p.cornerMm ?? 0);
      const own = interior(p.knots).some((k) => Number.isFinite(k.corner));
      corner.setInfo(own
        ? 'Some points have their own corner (Profile points). Changing this sets every corner.'
        : 'Every corner. Profile points can set one corner on its own.');
    };
    update(store.state);

    return { update, destroy() { el.replaceChildren(); } };
  },
};

export default section;
export const { id, title, summary, mount } = section;
