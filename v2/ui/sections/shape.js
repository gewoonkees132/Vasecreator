// Shape section (design §9.1, C6): height, width, depth with a lock,
// footprint, corner rounding and twist. Also exports the small helpers the
// other sections share (field limits, footprint size and perimeter).

import { numberField, slider, segmented, h } from '../controls.js';
import { LIMITS, setHeight, setWidth, setDepth, widestRadius } from '../../core/design.js';

/**
 * Field limits from core LIMITS (the first key found), falling back to the
 * given values for anything LIMITS doesn't set.
 * @param {string[]} keys
 * @param {{ min?: number, max?: number, step?: number }} fallback
 * @returns {{ min: number, max: number, step: number }}
 */
export function limit(keys, fallback) {
  for (const k of keys) {
    const direct = LIMITS?.[k];
    const nested = k.split('.').reduce((o, part) => (o == null ? undefined : o[part]), LIMITS);
    const found = [direct, nested].find((x) => x && typeof x === 'object' && ('min' in x || 'max' in x));
    if (found) return { ...fallback, ...pick(found) };
  }
  return { step: 1, ...fallback };
}

function pick(o) {
  const out = {};
  for (const k of ['min', 'max', 'step']) if (Number.isFinite(o[k])) out[k] = o[k];
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Overall footprint at the widest point of the profile: width and depth in mm,
 * the rectangle's corner radius, and the perimeter (ellipse or rounded rectangle).
 * @param {object} design
 * @returns {{ widthMm: number, depthMm: number, cornerMm: number, perimeterMm: number }}
 */
export function footprintAt(design) {
  const plan = design.form.plan;
  const widthMm = 2 * widestRadius(design);
  const depthMm = widthMm * (plan.depthRatio ?? 1);
  if (plan.footprint === 'rectangle') {
    const cornerMm = ((plan.cornerRounding ?? 0) * Math.min(widthMm, depthMm)) / 2;
    return { widthMm, depthMm, cornerMm, perimeterMm: 2 * (widthMm + depthMm) - 8 * cornerMm + 2 * Math.PI * cornerMm };
  }
  // Ramanujan's ellipse perimeter: well under 0.1 % off for any ratio we allow.
  const a = widthMm / 2;
  const b = depthMm / 2;
  const perimeterMm = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  return { widthMm, depthMm, cornerMm: 0, perimeterMm };
}

/**
 * Footprint and corner-rounding controls, shared by Shape and the advanced
 * Footprint section.
 * @param {object} store
 * @param {{ hideLabel?: boolean }} [opts] hide the Footprint label where the section title already says it
 * @returns {{ els: HTMLElement[], update(design: object): void, destroy(): void }}
 */
export function footprintControls(store, opts = {}) {
  const footprint = segmented({
    label: 'Footprint',
    hideLabel: opts.hideLabel,
    options: [{ value: 'circle', label: 'Circle' }, { value: 'rectangle', label: 'Rectangle' }],
    value: store.state.design.form.plan.footprint,
    onChange: (v) => store.apply('Footprint', (d) => { d.form.plan.footprint = v; }),
  });
  const corner = slider({
    label: 'Corner rounding',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    decimals: 0,
    value: Math.round((store.state.design.form.plan.cornerRounding ?? 0) * 100),
    info: '',
    onInput: (v) => store.change('Corner rounding', (d) => { d.form.plan.cornerRounding = v / 100; }),
    onCommit: () => store.commit(),
  });
  return {
    els: [footprint.el, corner.el],
    update(design) {
      const plan = design.form.plan;
      footprint.set(plan.footprint);
      corner.el.hidden = plan.footprint !== 'rectangle';
      if (plan.footprint === 'rectangle') {
        corner.set(Math.round((plan.cornerRounding ?? 0) * 100));
        corner.setInfo(`≈ ${Math.round(footprintAt(design).cornerMm)} mm at the widest point`);
      }
    },
    destroy() {
      footprint.destroy();
      corner.destroy();
    },
  };
}

const LOCK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const UNLOCK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 5.8-1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

const isLocked = (state) => state.view.sizeLocked !== false && (state.design.form.plan.depthRatio ?? 1) === 1;

const section = {
  id: 'shape',
  title: 'Shape',
  advanced: false,

  /** @param {object} design */
  summary(design) {
    const { widthMm } = footprintAt(design);
    return `${Math.round(design.form.height)} × ${Math.round(widthMm)} mm · ${design.form.plan.footprint} · twist ${Math.round(design.form.twist.degrees)}°`;
  },

  mount(el, ctx) {
    const { store } = ctx;
    const d0 = store.state.design;
    const commit = () => store.commit();
    const ratioLimits = limit(['depthRatio'], { min: 0.25, max: 4 });

    const height = numberField({
      label: 'Height',
      unit: 'mm',
      ...limit(['height', 'form.height'], { min: 20, max: 600, step: 1 }),
      decimals: 1,
      value: d0.form.height,
      onInput: (v) => store.change('Height', (d) => setHeight(d, v)),
      onCommit: commit,
    });
    const width = numberField({
      label: 'Width',
      unit: 'mm',
      ...limit(['width', 'form.width'], { min: 20, max: 600, step: 1 }),
      decimals: 1,
      value: round1(footprintAt(d0).widthMm),
      onInput: (v) => store.change('Width', (d) => setWidth(d, v)),
      onCommit: commit,
    });
    const depth = numberField({
      label: 'Depth',
      unit: 'mm',
      min: 1,
      step: 1,
      decimals: 1,
      value: round1(footprintAt(d0).depthMm),
      onInput: (v) => store.change('Depth', (d) => setDepth(d, v)),
      onCommit: commit,
    });
    const lock = h('button', { type: 'button', class: 'icon-btn lock-btn' });
    lock.addEventListener('click', () => {
      if (isLocked(store.state)) {
        store.setView({ sizeLocked: false });
      } else {
        if ((store.state.design.form.plan.depthRatio ?? 1) !== 1) {
          store.apply('Depth', (d) => { d.form.plan.depthRatio = 1; });
        }
        store.setView({ sizeLocked: true });
      }
    });
    depth.el.insertBefore(lock, depth.el.querySelector('.nf-box'));

    const fp = footprintControls(store);
    const twist = numberField({
      label: 'Twist',
      unit: '°',
      min: -360,
      max: 360,
      step: 1,
      decimals: 0,
      value: d0.form.twist.degrees,
      onInput: (v) => store.change('Twist', (d) => { d.form.twist.degrees = v; }),
      onCommit: commit,
    });

    el.append(height.el, width.el, depth.el, ...fp.els, twist.el);

    const update = (state) => {
      const d = state.design;
      const size = footprintAt(d);
      height.set(d.form.height);
      width.set(round1(size.widthMm));
      depth.set(round1(size.depthMm));
      depth.setLimits({ min: round1(size.widthMm * ratioLimits.min), max: round1(size.widthMm * ratioLimits.max) });
      const locked = isLocked(state);
      depth.setDisabled(locked);
      lock.setAttribute('aria-pressed', String(locked));
      lock.setAttribute('aria-label', locked ? 'Depth follows width. Unlock to set depth' : 'Lock depth to width');
      lock.title = locked ? 'Unlock depth' : 'Lock depth to width';
      lock.innerHTML = locked ? LOCK_ICON : UNLOCK_ICON;
      fp.update(d);
      twist.set(d.form.twist.degrees);
    };
    update(store.state);

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
