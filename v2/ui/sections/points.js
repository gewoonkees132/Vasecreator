// Profile points (design §9.5), the Points part of Shape: every point's height and radius in
// mm, editable, with × to remove one. The selected row and the selected handle
// on the pot are the same thing (view.selectedKnot).
//
// The third column depends on the curve type (issue #6): on an Angular curve
// each inner point has its own corner radius, and on a Smooth or Gentle curve
// each inner point can be made sharp, a corner in an otherwise smooth curve.
// The bottom and top points are the curve's ends and have neither.

import { numberField, h } from '../controls.js';
import { moveKnot, insertKnot, deleteKnot, MAX_KNOTS, MIN_KNOTS } from '../../core/design.js';
import { limit } from './shape.js';

const SHARP_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" fill="currentColor"/></svg>';
const ROUND_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

const section = {
  id: 'points',
  title: 'Profile points',

  summary(design) {
    return `${design.form.profile.knots.length} points`;
  },

  mount(el, ctx) {
    const { store } = ctx;
    const radiusLim = limit(['knotR', 'r', 'radius'], { min: 1, max: 400, step: 0.5 });
    const heightLim = limit(['knotZ', 'z', 'height', 'form.height'], { min: 0, max: 600, step: 0.5 });
    const cornerLim = limit(['cornerMm', 'form.profile.cornerMm'], { min: 0, max: 100, step: 0.5 });

    const extraHead = h('th', { scope: 'col', class: 'point-extra' });
    const body = h('tbody');
    const table = h('table', { class: 'points-table' }, [
      h('thead', {}, [h('tr', {}, [
        h('th', { scope: 'col', text: '#' }),
        h('th', { scope: 'col' }, ['Height ', h('span', { class: 'th-unit', text: 'mm' })]),
        h('th', { scope: 'col' }, ['Radius ', h('span', { class: 'th-unit', text: 'mm' })]),
        extraHead,
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
      // Keep focus on the same cell across a rebuild (a point added or
      // removed), so a keyboard user isn't dropped back at the top of the page.
      const active = document.activeElement;
      let focusAt = null;
      rows.forEach((r, i) => {
        if (r.z.input === active) focusAt = [i, 'z'];
        if (r.r.input === active) focusAt = [i, 'r'];
        if (r.corner.input === active) focusAt = [i, 'corner'];
        if (r.sharp === active) focusAt = [i, 'sharp'];
        if (r.del === active) focusAt = [i, 'del'];
      });
      rows.forEach((r) => { r.z.destroy(); r.r.destroy(); r.corner.destroy(); });
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
        const corner = numberField({
          label: `Point ${i + 1} corner radius`, unit: 'mm', compact: true, ...cornerLim, decimals: 1, value: 0,
          onInput: (v) => store.change('Point corner', (d) => { d.form.profile.knots[i].corner = v; }),
          onCommit: () => store.commit(),
        });
        const sharp = h('button', { type: 'button', class: 'icon-btn sharp-btn', 'aria-label': `Point ${i + 1} sharp` });
        sharp.addEventListener('click', (e) => {
          e.stopPropagation();
          const on = !store.state.design.form.profile.knots[i]?.sharp;
          store.apply(on ? 'Sharp point' : 'Smooth point', (d) => {
            if (on) d.form.profile.knots[i].sharp = true;
            else delete d.form.profile.knots[i].sharp;
          });
        });
        const del = h('button', { type: 'button', class: 'icon-btn del-btn', text: '×', 'aria-label': `Remove point ${i + 1}`, title: 'Remove point' });
        del.disabled = i === 0 || i === knots.length - 1 || knots.length <= MIN_KNOTS;
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          store.apply('Remove point', (d) => { deleteKnot(d, i); });
          if (store.state.view.selectedKnot != null) store.setView({ selectedKnot: null });
        });
        const end = h('span', { class: 'point-end', 'aria-hidden': 'true', text: '–', title: 'An end of the curve' });
        const tr = h('tr', { class: 'point-row' }, [
          h('td', { class: 'point-num', text: String(i + 1) }),
          h('td', {}, [z.el]),
          h('td', {}, [r.el]),
          h('td', { class: 'point-extra' }, [corner.el, sharp, end]),
          h('td', {}, [del]),
        ]);
        tr.addEventListener('click', () => select(i));
        tr.addEventListener('focusin', () => select(i));
        body.append(tr);
        return { tr, z, r, corner, sharp, end, del };
      });
      if (focusAt) {
        const [i, kind] = focusAt;
        if (kind === 'del') {
          // The next point's ×, else the one before, else + Add point.
          const target = [rows[i]?.del, rows[i - 1]?.del].find((b) => b && !b.disabled) ?? add;
          target.focus();
        } else if (kind === 'sharp') {
          rows[i]?.sharp.focus();
        } else if (rows[i]) {
          rows[i][kind].input.focus();
        }
      }
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

    let headAngular = null;
    const update = (state) => {
      const profile = state.design.form.profile;
      const knots = profile.knots;
      const angular = profile.interp === 'linear';
      if (knots.length !== rows.length) build(knots);
      if (angular !== headAngular) {
        headAngular = angular;
        extraHead.replaceChildren(...(angular ? ['Corner ', h('span', { class: 'th-unit', text: 'mm' })] : ['Sharp']));
      }
      const last = knots.length - 1;
      knots.forEach((k, i) => {
        const row = rows[i];
        row.z.set(k.z);
        row.r.set(k.r);
        const isEnd = i === 0 || i === last;
        row.end.hidden = !isEnd;
        row.corner.el.hidden = isEnd || !angular;
        row.sharp.hidden = isEnd || angular;
        row.corner.set(Number.isFinite(k.corner) ? k.corner : (profile.cornerMm ?? 0));
        const sharp = !!k.sharp;
        if (row.sharp.getAttribute('aria-pressed') !== String(sharp)) {
          row.sharp.setAttribute('aria-pressed', String(sharp));
          row.sharp.innerHTML = sharp ? SHARP_ICON : ROUND_ICON;
          row.sharp.title = sharp ? 'Sharp: a corner in the curve. Click to make it smooth' : 'Smooth. Click to make a corner here';
        }
        row.del.disabled = isEnd || knots.length <= MIN_KNOTS;
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
        rows.forEach((r) => { r.z.destroy(); r.r.destroy(); r.corner.destroy(); });
        el.replaceChildren();
      },
    };
  },
};

export default section;
export const { id, title, summary, mount } = section;
