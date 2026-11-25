// The ruler dial of the phone dock (mobile stage M4): a number set with the
// thumb. The value sits large in the middle with − and + at the ends; under
// it a tick ruler is dragged sideways, the ticks moving under a fixed centre
// mark, one tick per step and a number on every tenth. A flick carries on and
// slows down. Tap the value to type one. On a keyboard the ruler is a slider.
//
// One dial is reused for every tool of the dock: configure() switches it to
// another value. onInput runs live during a gesture (the caller uses
// store.change), onCommit once at its end (store.commit), like controls.js.

import { h, parseNumber } from './controls.js';

const MOMENTUM_MIN = 0.25;     // px/ms to start a flick
const MOMENTUM_STOP = 0.02;    // px/ms where it ends
const FRICTION = 0.94;         // velocity kept per 16 ms
const SAMPLE_MS = 100;         // velocity from the last 100 ms of a drag
const REPEAT_DELAY = 400;
const REPEAT_EVERY = 70;
const RULER_H = 34;

/**
 * Pixels per step, from how many steps the range holds: a short range gets
 * wide ticks, a long one narrow ticks (a flick covers it).
 * @param {number} min @param {number} max @param {number} step
 * @param {boolean} [wrap] an angle that goes round
 * @returns {number}
 */
export function pxPerStep(min, max, step, wrap = false) {
  if (wrap || !Number.isFinite(max - min)) return 8;
  const steps = (max - min) / step;
  return steps <= 40 ? 18 : steps <= 200 ? 12 : 8;
}

/**
 * The dial position after dragging the ruler by dx px: dragging the ticks to
 * the left brings higher values under the mark.
 * @param {number} start @param {number} dx @param {number} px @param {number} step
 */
export function dragPosition(start, dx, px, step) {
  return start - (dx / px) * step;
}

/** v on the grid of whole steps (from 0), rounded to `decimals`. */
export function snapToStep(v, step, decimals = 6) {
  const f = 10 ** decimals;
  return Math.round(Math.round(v / step) * step * f) / f;
}

/** The value ≡ v (mod period) nearest to `around`, so a wrapped dial never spins the long way. */
export function wrapNear(v, around, period) {
  return v + Math.round((around - v) / period) * period;
}

/** v in [0, period). */
export const wrap = (v, period) => ((v % period) + period) % period;

const decimalsOf = (x) => {
  const s = String(Math.round(x * 1e6) / 1e6);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

function format(v, decimals) {
  if (!Number.isFinite(v)) return '–';
  const f = 10 ** decimals;
  return String(Math.round(v * f) / f + 0);
}

/**
 * @param {object} o
 * @param {(v: number) => void} o.onInput
 * @param {(v: number) => void} o.onCommit
 * @returns {{ el: HTMLElement, configure(spec: DialSpec): void, set(v: number): void, setNote(text: string): void,
 *   setDisabled(disabled: boolean): void, setExtra(node: HTMLElement | null): void, destroy(): void }}
 *
 * @typedef {{ label: string, unit?: string, min: number, max: number, step: number, decimals?: number,
 *   value: number, wrap?: number, disabled?: boolean, note?: string }} DialSpec
 */
export function createDial({ onInput, onCommit }) {
  /** @type {DialSpec} */
  let spec = { label: '', unit: '', min: 0, max: 1, step: 1, decimals: 0, value: 0 };
  let value = 0;       // the value shown and sent, on the step grid (wrapped dials: unwrapped)
  let pos = 0;         // the ruler's position, continuous while dragging
  let px = 10;
  let disabled = false;
  let dirty = false;   // the current gesture changed the value
  let drag = null;
  let anim = 0;
  let typing = false;
  let repeatTimer = 0;
  let drawFrame = 0;

  const minus = h('button', { type: 'button', class: 'dial-step', text: '−' });
  const plus = h('button', { type: 'button', class: 'dial-step', text: '+' });
  const num = h('span', { class: 'dial-num' });
  const unit = h('span', { class: 'dial-unit' });
  const valueBtn = h('button', { type: 'button', class: 'dial-value' }, [num, unit]);
  const input = h('input', { type: 'text', class: 'dial-input', inputMode: 'decimal', autocomplete: 'off', hidden: true });
  input.spellcheck = false;
  const extraBox = h('span', { class: 'dial-extra' });
  const valueRow = h('div', { class: 'dial-value-row' }, [extraBox, valueBtn, input]);
  const canvas = h('canvas', { class: 'dial-canvas', 'aria-hidden': 'true' });
  const mark = h('span', { class: 'dial-mark', 'aria-hidden': 'true' });
  const ruler = h('div', { class: 'dial-ruler', role: 'slider', tabIndex: 0 }, [canvas, mark]);
  const note = h('div', { class: 'dial-note' });
  const mid = h('div', { class: 'dial-mid' }, [valueRow, ruler, note]);
  const el = h('div', { class: 'dial' }, [minus, mid, plus]);

  const period = () => spec.wrap || 0;
  const clamp = (v) => (period() ? v : Math.min(spec.max, Math.max(spec.min, v)));
  const out = (v) => {
    const d = spec.decimals ?? 0;
    const f = 10 ** d;
    const r = Math.round((period() ? wrap(v, period()) : v) * f) / f;
    return period() ? wrap(r, period()) : r;
  };

  // ---------- Drawing ----------

  function draw() {
    drawFrame = 0;
    const w = ruler.clientWidth;
    if (!w) return;
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(RULER_H * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(RULER_H * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${RULER_H}px`;
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, RULER_H);
    const { step } = spec;
    const cx = w / 2;
    const first = Math.ceil((pos - (cx / px) * step) / step - 1e-9);
    const last = Math.floor((pos + (cx / px) * step) / step + 1e-9);
    const labelDecimals = decimalsOf(step * 10);
    g.font = '500 10px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    for (let k = first; k <= last; k++) {
      const v = k * step;
      if (!period() && (v < spec.min - step * 1e-6 || v > spec.max + step * 1e-6)) continue;
      const x = Math.round(cx + ((v - pos) / step) * px) + 0.5;
      const major = k % 10 === 0;
      const medium = !major && k % 5 === 0;
      const end = !period() && (Math.abs(v - spec.min) < step * 1e-6 || Math.abs(v - spec.max) < step * 1e-6);
      const len = major || end ? 16 : medium ? 11 : 7;
      g.strokeStyle = disabled ? 'rgba(18,47,45,.3)' : major || end ? 'rgba(18,47,45,.78)' : 'rgba(18,47,45,.55)';
      g.lineWidth = major || end ? 1.5 : 1;
      g.beginPath();
      g.moveTo(x, 2);
      g.lineTo(x, 2 + len);
      g.stroke();
      if (major) {
        g.fillStyle = disabled ? 'rgba(18,47,45,.35)' : 'rgba(18,47,45,.72)';
        g.fillText(format(period() ? wrap(v, period()) : v, labelDecimals), x, RULER_H - 2);
      }
    }
  }
  const redraw = () => { if (!drawFrame) drawFrame = requestAnimationFrame(draw); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(redraw) : null;
  ro?.observe(ruler);

  // ---------- Value ----------

  function show() {
    const d = spec.decimals ?? 0;
    const shown = out(value);
    num.textContent = format(shown, d);
    unit.textContent = spec.unit ? ` ${spec.unit}` : '';
    const text = `${format(shown, d)}${spec.unit ? ` ${spec.unit}` : ''}`;
    ruler.setAttribute('aria-valuenow', String(shown));
    ruler.setAttribute('aria-valuetext', text);
    if (period()) {
      ruler.setAttribute('aria-valuemin', '0');
      ruler.setAttribute('aria-valuemax', String(period() - spec.step));
    } else {
      ruler.setAttribute('aria-valuemin', String(spec.min));
      ruler.setAttribute('aria-valuemax', String(spec.max));
    }
    valueBtn.setAttribute('aria-label', `${spec.label} ${text}. Type a value`);
    const atMin = !period() && value <= spec.min + spec.step * 1e-6;
    const atMax = !period() && value >= spec.max - spec.step * 1e-6;
    minus.disabled = disabled || atMin;
    plus.disabled = disabled || atMax;
  }

  /** Moves to v (unwrapped, on the grid); sends it when it changed. */
  function moveTo(v) {
    const next = clamp(v);
    if (Math.abs(next - value) < 1e-9) return false;
    value = next;
    dirty = true;
    show();
    onInput?.(out(value));
    return true;
  }

  function endGesture() {
    if (!dirty) return;
    dirty = false;
    onCommit?.(out(value));
  }

  function stopMomentum() {
    if (!anim) return;
    cancelAnimationFrame(anim);
    anim = 0;
    pos = value;
    redraw();
    endGesture();
  }

  // ---------- Ruler: drag and flick ----------

  ruler.addEventListener('pointerdown', (e) => {
    if (disabled || (e.button !== 0 && e.pointerType === 'mouse')) return;
    e.preventDefault();
    stopMomentum();
    ruler.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, start: pos, samples: [{ t: e.timeStamp, x: e.clientX }] };
    el.classList.add('is-dragging');
  });
  ruler.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = clamp(dragPosition(drag.start, e.clientX - drag.x, px, spec.step));
    pos = p;
    drag.samples.push({ t: e.timeStamp, x: e.clientX });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > SAMPLE_MS) drag.samples.shift();
    moveTo(snapToStep(p, spec.step));
    redraw();
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const s = drag.samples;
    drag = null;
    el.classList.remove('is-dragging');
    const a = s[0];
    const b = s[s.length - 1];
    const dt = b.t - a.t;
    let v = dt > 0 && e.type === 'pointerup' ? (b.x - a.x) / dt : 0;   // px/ms, + = ticks moving right
    if (Math.abs(v) < MOMENTUM_MIN) {
      pos = value;
      redraw();
      endGesture();
      return;
    }
    let last = performance.now();
    const tick = (now) => {
      const ms = Math.min(48, now - last);
      last = now;
      const before = pos;
      pos = clamp(dragPosition(pos, v * ms, px, spec.step));
      moveTo(snapToStep(pos, spec.step));
      v *= FRICTION ** (ms / 16);
      redraw();
      if (Math.abs(v) < MOMENTUM_STOP || pos === before) {
        anim = 0;
        pos = value;
        redraw();
        endGesture();
        return;
      }
      anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  };
  ruler.addEventListener('pointerup', release);
  ruler.addEventListener('pointercancel', release);

  ruler.addEventListener('keydown', (e) => {
    if (disabled) return;
    const n = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    let target = null;
    if (n) target = snapToStep(value, spec.step) + n * spec.step;
    else if (e.key === 'Home' && !period()) target = spec.min;
    else if (e.key === 'End' && !period()) target = spec.max;
    if (target == null) return;
    e.preventDefault();
    stopMomentum();
    moveTo(target);
    pos = value;
    redraw();
    endGesture();
  });

  // ---------- − and +: tap, or hold to repeat ----------

  const stepBy = (n) => {
    if (moveTo(snapToStep(value, spec.step) + n * spec.step)) {
      pos = value;
      redraw();
    }
  };
  const stopRepeat = () => {
    clearTimeout(repeatTimer);
    clearInterval(repeatTimer);
    repeatTimer = 0;
  };
  for (const [btn, n] of [[minus, -1], [plus, 1]]) {
    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled || (e.button !== 0 && e.pointerType === 'mouse')) return;
      e.preventDefault();
      stopMomentum();
      stepBy(n);
      stopRepeat();
      repeatTimer = setTimeout(() => { repeatTimer = setInterval(() => stepBy(n), REPEAT_EVERY); }, REPEAT_DELAY);
    });
    const end = () => { if (repeatTimer || dirty) { stopRepeat(); endGesture(); } };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('pointerleave', end);
    // A keyboard press (no pointer) steps once.
    btn.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      stepBy(n);
      endGesture();
    });
  }

  // ---------- Typing ----------

  valueBtn.addEventListener('click', () => {
    if (disabled) return;
    stopMomentum();
    typing = true;
    input.value = format(out(value), spec.decimals ?? 0);
    input.setAttribute('aria-label', spec.label);
    valueBtn.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  });
  const finishTyping = (keep) => {
    if (!typing) return;
    typing = false;
    const parsed = parseNumber(input.value);
    input.hidden = true;
    valueBtn.hidden = false;
    if (keep && Number.isFinite(parsed)) {
      const d = spec.decimals ?? 0;
      const f = 10 ** d;
      let v = Math.round(parsed * f) / f;
      if (period()) v = wrapNear(wrap(v, period()), value, period());
      if (moveTo(v)) {
        pos = value;
        redraw();
      }
      endGesture();
    }
    show();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishTyping(true); valueBtn.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishTyping(false); valueBtn.focus(); }
  });
  input.addEventListener('blur', () => finishTyping(true));

  // ---------- API ----------

  const busy = () => !!drag || !!anim || typing || !!repeatTimer;

  return {
    el,
    configure(next) {
      stopMomentum();
      stopRepeat();
      if (drag) { drag = null; el.classList.remove('is-dragging'); }
      if (typing) finishTyping(true);
      endGesture();
      spec = { decimals: 0, unit: '', ...next };
      px = pxPerStep(spec.min, spec.max, spec.step, !!spec.wrap);
      disabled = !!spec.disabled;
      value = period() ? spec.value : clamp(spec.value);
      pos = value;
      ruler.setAttribute('aria-label', spec.label);
      minus.setAttribute('aria-label', `Decrease ${spec.label}`);
      plus.setAttribute('aria-label', `Increase ${spec.label}`);
      el.classList.toggle('is-disabled', disabled);
      ruler.setAttribute('aria-disabled', String(disabled));
      note.textContent = spec.note || '';
      show();
      redraw();
    },
    /** A value from the store; ignored while a gesture or typing is on. */
    set(v) {
      if (busy() || !Number.isFinite(v)) return;
      const next = period() ? wrapNear(v, value, period()) : clamp(v);
      if (Math.abs(next - value) < 1e-9) return;
      value = next;
      pos = value;
      show();
      redraw();
    },
    setNote(text) {
      if (note.textContent !== (text || '')) note.textContent = text || '';
    },
    setDisabled(on) {
      if (disabled === !!on) return;
      disabled = !!on;
      el.classList.toggle('is-disabled', disabled);
      ruler.setAttribute('aria-disabled', String(disabled));
      show();
      redraw();
    },
    /** A small control left of the value (the depth lock). */
    setExtra(node) {
      extraBox.replaceChildren(...(node ? [node] : []));
    },
    destroy() {
      stopMomentum();
      stopRepeat();
      ro?.disconnect();
      cancelAnimationFrame(drawFrame);
      el.remove();
    },
  };
}
