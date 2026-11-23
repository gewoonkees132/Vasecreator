// Layers & seam section (design §9.3): bead width, layer height, overhang
// limit and the seam. main.js shows the seam marker while this section is open.

import { numberField, segmented } from '../controls.js';
import { limit } from './shape.js';

const SEAM_LABELS = { fixed: 'fixed angle', followTwist: 'follows twist', hidden: 'hidden' };

function layerInfo(layers) {
  const ratio = layers.layerHeightMm / layers.beadWidthMm;
  return ratio < 0.3 || ratio > 0.6 ? 'Unusual for this bead (0.3–0.6 × bead width)' : '';
}

const section = {
  id: 'layers',
  title: 'Layers & seam',
  advanced: false,

  summary(design) {
    const l = design.layers;
    return `bead ${l.beadWidthMm} mm · layer ${l.layerHeightMm} mm · seam ${SEAM_LABELS[l.seam.position] ?? l.seam.position}`;
  },

  mount(el, ctx) {
    const { store } = ctx;
    const l0 = store.state.design.layers;
    const commit = () => store.commit();

    const bead = numberField({
      label: 'Bead width', unit: 'mm', ...limit(['beadWidthMm', 'layers.beadWidthMm'], { min: 0.4, max: 12, step: 0.1 }), decimals: 2,
      value: l0.beadWidthMm,
      onInput: (v) => store.change('Bead width', (d) => { d.layers.beadWidthMm = v; }),
      onCommit: commit,
    });
    const layer = numberField({
      label: 'Layer height', unit: 'mm', ...limit(['layerHeightMm', 'layers.layerHeightMm'], { min: 0.1, max: 8, step: 0.05 }), decimals: 2,
      value: l0.layerHeightMm, info: layerInfo(l0),
      onInput: (v) => store.change('Layer height', (d) => { d.layers.layerHeightMm = v; }),
      onCommit: commit,
    });
    const overhang = numberField({
      label: 'Overhang limit', unit: '°', ...limit(['overhangLimitDeg', 'layers.overhangLimitDeg'], { min: 5, max: 80, step: 1 }), decimals: 0,
      value: l0.overhangLimitDeg,
      onInput: (v) => store.change('Overhang limit', (d) => { d.layers.overhangLimitDeg = v; }),
      onCommit: commit,
    });
    const ramp = numberField({
      label: 'Seam ramp length', unit: 'mm', ...limit(['rampLengthMm', 'layers.seam.rampLengthMm'], { min: 0, max: 200, step: 1 }), decimals: 1,
      value: l0.seam.rampLengthMm,
      onInput: (v) => store.change('Seam ramp length', (d) => { d.layers.seam.rampLengthMm = v; }),
      onCommit: commit,
    });
    const position = segmented({
      label: 'Seam position',
      options: [{ value: 'fixed', label: 'Fixed angle' }, { value: 'followTwist', label: 'Follows twist' }, { value: 'hidden', label: 'Hidden' }],
      value: l0.seam.position,
      onChange: (v) => store.apply('Seam position', (d) => { d.layers.seam.position = v; }),
    });
    const angle = numberField({
      // The angle wraps (0–359°), so scrubbing past either end carries on round.
      label: 'Seam angle', unit: '°', min: -359, max: 718, step: 1, decimals: 0,
      value: l0.seam.angleDeg, info: '',
      onInput: (v) => store.change('Seam angle', (d) => { d.layers.seam.angleDeg = ((Math.round(v) % 360) + 360) % 360; }),
      onCommit: commit,
    });

    el.append(bead.el, layer.el, overhang.el, ramp.el, position.el, angle.el);

    const update = (state) => {
      const l = state.design.layers;
      bead.set(l.beadWidthMm);
      layer.set(l.layerHeightMm);
      layer.setInfo(layerInfo(l));
      overhang.set(l.overhangLimitDeg);
      ramp.set(l.seam.rampLengthMm);
      position.set(l.seam.position);
      angle.set(l.seam.angleDeg);
      angle.setInfo(l.seam.position === 'hidden' ? 'Hidden uses the corner or groove nearest this angle' : '');
    };
    update(store.state);

    return { update, destroy() { el.replaceChildren(); } };
  },
};

export default section;
export const { id, title, advanced, summary, mount } = section;
