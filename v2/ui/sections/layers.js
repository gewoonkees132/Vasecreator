// Layers & seam section (design §9.3): the seam, bead width and layer height,
// as the parts Seam and Bead of the Layers step (ui/steps.js). The overhang
// limit is a rule in the warnings card now (ui/chips.js, pattern studio D44).
// main.js shows the seam marker while that step is open.

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

    for (const e of [position.el, angle.el, ramp.el]) e.dataset.part = 'seam';
    for (const e of [bead.el, layer.el]) e.dataset.part = 'bead';
    el.append(position.el, angle.el, ramp.el, bead.el, layer.el);

    const update = (state) => {
      const l = state.design.layers;
      bead.set(l.beadWidthMm);
      layer.set(l.layerHeightMm);
      layer.setInfo(layerInfo(l));
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
export const { id, title, summary, mount } = section;
