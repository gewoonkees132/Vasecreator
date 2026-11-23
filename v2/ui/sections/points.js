// Profile points (advanced, design §9.5): every point's height and radius in
// mm, editable, with × to remove one. The selected row and the selected handle
// on the pot are the same thing (view.selectedKnot).

import { numberField, h } from '../controls.js';
import { moveKnot, insertKnot, deleteKnot } from '../../core/design.js';
import { limit } from './shape.js';

const MAX_KNOTS = 12;

const section = {
  id: 'points',
  title: 'Profile points',
  advanced: true,

  summary(design) {
    return `${design.form.profile.knots.length} points`;
  },

  mount(el, ctx) {
    const { store } = ctx;
    const radiusLim = limit(['knotR', 'r', 'radius'], { min: 1, max: 400, step: 0.5 });
    const heightLim = limit(['knotZ', 'z', 'height', 'form.height'], { min: 0, max: 600, step: 0.5 });

    const body = h('tbody');
    const table = h('table', { class: 'points-table' }, [
      h('thead', {}, [h('tr', {}, [
        h('th', { scope: 'col', text: '#' }),
        h('th', { scope: 'col', text: 'Height' }),
        h('th', { scope: 'col', text: 'Radius' }),
        h('th', { scope: 'col' }, [h('span', { class: 'visually-hidden', text: 'Remove' })]),
      ])]),
      body,
    ]);
    const add = h('button', { type: 'button', class: 'link-btn add-point', text: '+ Add point' });
    el.append(table, add);

    let rows = [];
    const select = (i) => {
      if (store.state.view.selectedKnot !== i) store.setView({ selectedKnot: i });
    };

    const build = (knots) => {
      // Keep focus on the same cell across a rebuild (a point added elsewhere).
      const active = document.activeElement;
      let focusAt = null;
      rows.forEach((r, i) => {
        if (r.z.input === active) focusAt = [i, 'z'];
        if (r.r.input === active) focusAt = [i, 'r'];
      });
      rows.forEach((r) => { r.z.destroy(); r.r.destroy(); });
      body.replaceChildren();
      rows = knots.map((k, i) => {
        const z = numberField({
          label: `Point ${i + 1} height`, unit: 'mm', compact: true, ...heightLim, decimals: 1, value: k.z, readOnly: i === 0,
          onInput: (v) => store.change('Point height', (d) => moveKnot(d, i, { z: v, r: d.form.profile.knots[i].r })),
          onCommit: () => store.commit(),
        });
        const r = numberField({
          label: `Point ${i + 1} radius`, unit: 'mm', compact: true, ...radiusLim, decimals: 1, value: k.r,
          onInput: (v) => store.change('Point radius', (d) => moveKnot(d, i, { z: d.form.profile.knots[i].z, r: v })),
          onCommit: () => store.commit(),
        });
        const del = h('button', { type: 'button', class: 'icon-btn del-btn', text: '×', 'aria-label': `Remove point ${i + 1}`, title: 'Remove point' });
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          store.apply('Remove point', (d) => { deleteKnot(d, i); });
          if (store.state.view.selectedKnot != null) store.setView({ selectedKnot: null });
        });
        const tr = h('tr', { class: 'point-row' }, [
          h('td', { class: 'point-num', text: String(i + 1) }),
          h('td', {}, [z.el]),
          h('td', {}, [r.el]),
          h('td', {}, [del]),
        ]);
        tr.addEventListener('click', () => select(i));
        tr.addEventListener('focusin', () => select(i));
        body.append(tr);
        return { tr, z, r, del };
      });
      if (focusAt && rows[focusAt[0]]) rows[focusAt[0]][focusAt[1]].input.focus();
    };

    add.addEventListener('click', () => {
      const knots = store.state.design.form.profile.knots;
      if (knots.length >= MAX_KNOTS) return;
      // Midway up the tallest gap; insertKnot puts it on the curve, so the
      // shape doesn't change until the point is moved.
      let gap = 0;
      for (let i = 1; i < knots.length - 1; i++) {
        if (knots[i + 1].z - knots[i].z > knots[gap + 1].z - knots[gap].z) gap = i;
      }
      const at = { z: Math.round(((knots[gap].z + knots[gap + 1].z) / 2) * 10) / 10 };
      let index = -1;
      store.apply('Add point', (d) => { index = insertKnot(d, at); });
      if (index >= 0) store.setView({ selectedKnot: index });
    });

    const update = (state) => {
      const knots = state.design.form.profile.knots;
      if (knots.length !== rows.length) build(knots);
      const last = knots.length - 1;
      knots.forEach((k, i) => {
        const row = rows[i];
        row.z.set(k.z);
        row.r.set(k.r);
        row.del.disabled = i === 0 || i === last || knots.length <= 2;
        const selected = state.view.selectedKnot === i;
        row.tr.classList.toggle('is-selected', selected);
        if (selected) row.tr.setAttribute('aria-current', 'true');
        else row.tr.removeAttribute('aria-current');
      });
      add.disabled = knots.length >= MAX_KNOTS;
      add.textContent = knots.length >= MAX_KNOTS ? `${MAX_KNOTS} points is the most` : '+ Add point';
    };
    update(store.state);

    return {
      update,
      destroy() {
        rows.forEach((r) => { r.z.destroy(); r.r.destroy(); });
        el.replaceChildren();
      },
    };
  },
};

export default section;
export const { id, title, advanced, summary, mount } = section;
