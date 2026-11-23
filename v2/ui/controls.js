// Form controls for the design panels: number field, slider, segmented
// control, toggle and select. Plain DOM, no framework.
//
// Every factory returns { el, set(value), destroy() }. `onInput` is for live
// updates during a gesture (the caller uses store.change), `onCommit` ends the
// gesture (store.commit). A typed value calls both, once, on Enter or blur.
// set() never moves focus and never overwrites a field the user is typing in,
// because the store echoes every edit back through set().

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

// Pixels of horizontal drag per step when scrubbing a label.
const SCRUB_PX = 4;
// Below this the pointer press is a click (focus the field), not a scrub.
const SCRUB_DEADZONE = 3;
const REPEAT_DELAY = 400;
const REPEAT_EVERY = 70;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    // ARIA goes through attributes (the role property isn't reflected everywhere).
    else if (key in node && key !== 'role' && !key.includes('-')) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/** Small DOM helper shared by the panels: el(tag, props, children). */
export { el as h };

/**
 * Parses what a person typed: accepts a decimal comma, a typographic minus,
 * a trailing unit and spaces ("2,5 mm" → 2.5). Returns NaN when nothing numeric is there.
 * @param {string} text
 */
export function parseNumber(text) {
  const cleaned = String(text).trim().replace(/\s+/g, '').replace(/−/g, '-').replace(',', '.').replace(/[^0-9.+\-eE]+$/, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return NaN;
  return Number(cleaned);
}

function roundTo(v, decimals) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

// Shows at most `decimals` places and drops trailing zeros ("170", "2.5").
function formatNumber(v, decimals) {
  if (!Number.isFinite(v)) return '';
  const s = String(roundTo(v, decimals) + 0); // + 0 turns −0 into 0
  return s.includes('e') ? roundTo(v, decimals).toFixed(decimals) : s;
}

/**
 * A labelled number with a unit. Drag the label sideways to scrub (Shift ×10),
 * ArrowUp/Down to step, type and press Enter or leave the field to commit,
 * Escape to revert. − / + steppers show on touch screens.
 *
 * @param {object} o
 * @param {string} o.label visible label (also the accessible name)
 * @param {string} [o.unit] suffix such as 'mm', '°', '%', '×'
 * @param {number} [o.min] @param {number} [o.max] @param {number} [o.step=1]
 * @param {number} [o.decimals=0]
 * @param {number} o.value
 * @param {(v: number) => void} [o.onInput] live value during a gesture
 * @param {(v: number) => void} [o.onCommit] end of the gesture
 * @param {string} [o.info] small text under the field
 * @param {boolean} [o.compact] no visible label (the label stays as the accessible name), no steppers
 * @param {boolean} [o.readOnly]
 * @returns {{ el: HTMLElement, input: HTMLInputElement, set(v: number): void, setInfo(text: string): void,
 *   setDisabled(disabled: boolean): void, setLimits(limits: { min?: number, max?: number, step?: number }): void, destroy(): void }}
 */
export function numberField(o) {
  let step = o.step ?? 1;
  const decimals = o.decimals ?? 0;
  let min = o.min ?? -Infinity;
  let max = o.max ?? Infinity;
  let value = o.value;
  let disabled = !!o.readOnly;
  const id = nextId('nf');

  const clampRound = (v) => roundTo(Math.min(max, Math.max(min, v)), decimals);

  const input = el('input', {
    id,
    type: 'text',
    inputMode: 'decimal',
    autocomplete: 'off',
    class: 'nf-input',
    'aria-label': o.compact ? o.label : null,
  });
  input.readOnly = disabled;
  input.spellcheck = false;
  const unit = o.unit ? el('span', { class: 'nf-unit', 'aria-hidden': 'true', text: o.unit }) : null;
  const minus = o.compact ? null : el('button', { type: 'button', class: 'nf-step', text: '−', 'aria-label': `Decrease ${o.label}`, tabIndex: -1 });
  const plus = o.compact ? null : el('button', { type: 'button', class: 'nf-step', text: '+', 'aria-label': `Increase ${o.label}`, tabIndex: -1 });
  const box = el('div', { class: 'nf-box' }, [minus, el('div', { class: 'nf-field' }, [input, unit]), plus]);
  const label = o.compact ? null : el('label', { class: 'nf-label', htmlFor: id, text: o.label, title: 'Drag sideways to change' });
  const infoEl = el('div', { class: 'nf-info', id: `${id}-info`, hidden: !o.info, text: o.info || '' });
  if (o.info !== undefined) input.setAttribute('aria-describedby', infoEl.id);
  const root = el('div', { class: `nf${o.compact ? ' nf--compact' : ''}` }, [label, box, o.compact ? null : infoEl]);

  // Only rewrite the text when the person isn't typing in the field, so a
  // store echo never clobbers what they typed.
  let typing = false;
  const show = () => {
    if (!(typing && document.activeElement === input)) input.value = formatNumber(value, decimals);
  };
  show();

  const emitInput = (v) => {
    if (v === value) return false;
    value = v;
    input.value = formatNumber(value, decimals);
    o.onInput?.(value);
    return true;
  };

  // A gesture (scrub, arrows, steppers) is "dirty" once it changed the value;
  // only then does it end with onCommit.
  let gestureDirty = false;
  const stepBy = (n, big) => {
    if (disabled) return;
    const base = Number.isFinite(value) ? value : 0;
    if (emitInput(clampRound(base + n * step * (big ? 10 : 1)))) gestureDirty = true;
  };
  const endGesture = () => {
    if (gestureDirty) {
      gestureDirty = false;
      o.onCommit?.(value);
    }
  };

  const commitTyped = () => {
    if (!typing) {
      input.value = formatNumber(value, decimals);
      return;
    }
    typing = false;
    const parsed = parseNumber(input.value);
    if (!Number.isFinite(parsed)) {
      input.value = formatNumber(value, decimals);
      return;
    }
    const v = clampRound(parsed);
    input.value = formatNumber(v, decimals);
    if (v !== value) {
      value = v;
      o.onInput?.(value);
      o.onCommit?.(value);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTyped();
      input.select();
    } else if (e.key === 'Escape') {
      if (typing) {
        e.preventDefault();
        e.stopPropagation();
        typing = false;
        input.value = formatNumber(value, decimals);
        input.select();
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      // Arrows step from what is typed, so "12" then ArrowUp gives 13.
      if (typing) {
        typing = false;
        const typed = parseNumber(input.value);
        if (Number.isFinite(typed) && emitInput(clampRound(typed))) gestureDirty = true;
      }
      stepBy(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      input.select();
    }
  };
  const onKeyUp = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') endGesture();
  };
  const onBlur = () => {
    endGesture();
    commitTyped();
  };
  const onFocus = () => input.select();
  input.addEventListener('input', () => { typing = true; });
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('keyup', onKeyUp);
  input.addEventListener('blur', onBlur);
  input.addEventListener('focus', onFocus);

  // Scrub by dragging the label.
  let scrub = null;
  let suppressClick = false;
  const onLabelDown = (e) => {
    if (disabled || e.button !== 0) return;
    scrub = { x: e.clientX, start: Number.isFinite(value) ? value : 0, active: false, id: e.pointerId };
    label.setPointerCapture(e.pointerId);
  };
  const onLabelMove = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const dx = e.clientX - scrub.x;
    if (!scrub.active && Math.abs(dx) < SCRUB_DEADZONE) return;
    if (!scrub.active) {
      scrub.active = true;
      root.classList.add('is-scrubbing');
      // Typed-but-uncommitted text would be lost; commit it first.
      if (document.activeElement === input) input.blur();
    }
    const steps = Math.trunc(dx / SCRUB_PX);
    if (emitInput(clampRound(scrub.start + steps * step * (e.shiftKey ? 10 : 1)))) gestureDirty = true;
  };
  const onLabelUp = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const wasActive = scrub.active;
    scrub = null;
    root.classList.remove('is-scrubbing');
    if (wasActive) {
      suppressClick = true;
      endGesture();
    }
  };
  const onLabelClick = (e) => {
    if (suppressClick) {
      e.preventDefault();
      suppressClick = false;
    }
  };
  if (label) {
    label.addEventListener('pointerdown', onLabelDown);
    label.addEventListener('pointermove', onLabelMove);
    label.addEventListener('pointerup', onLabelUp);
    label.addEventListener('pointercancel', onLabelUp);
    label.addEventListener('click', onLabelClick);
  }

  // Steppers repeat while held, and the hold is one gesture.
  let repeatTimer = 0;
  const stopRepeat = () => {
    clearTimeout(repeatTimer);
    clearInterval(repeatTimer);
    repeatTimer = 0;
  };
  const bindStepper = (button, dir) => {
    if (!button) return;
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || disabled) return;
      e.preventDefault(); // keeps focus where it is
      button.setPointerCapture(e.pointerId);
      stepBy(dir, e.shiftKey);
      stopRepeat();
      repeatTimer = setTimeout(() => {
        repeatTimer = setInterval(() => stepBy(dir, false), REPEAT_EVERY);
      }, REPEAT_DELAY);
    });
    const release = () => {
      if (!repeatTimer && !gestureDirty) return;
      stopRepeat();
      endGesture();
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    // Keyboard or assistive-tech activation arrives as a click without a pointer press.
    button.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      stepBy(dir, false);
      endGesture();
    });
  };
  bindStepper(minus, -1);
  bindStepper(plus, 1);

  const applyDisabled = () => {
    input.readOnly = disabled;
    root.classList.toggle('is-disabled', disabled);
    if (minus) minus.disabled = disabled;
    if (plus) plus.disabled = disabled;
  };
  applyDisabled();

  return {
    el: root,
    input,
    set(v) {
      // Don't fight an active scrub or stepper hold: their value is newer.
      if (scrub?.active || repeatTimer) return;
      value = v;
      show();
    },
    setInfo(text) {
      infoEl.textContent = text || '';
      infoEl.hidden = !text;
    },
    setDisabled(d) {
      disabled = !!d;
      applyDisabled();
    },
    setLimits(limits) {
      if (limits.min !== undefined) min = limits.min;
      if (limits.max !== undefined) max = limits.max;
      if (limits.step !== undefined) step = limits.step;
    },
    destroy() {
      stopRepeat();
      root.remove();
    },
  };
}

/**
 * A range slider with a compact number field beside it (Depth ──●── [2.5 mm]).
 * Same options as numberField; `format` is not needed because the field shows the value.
 * @param {object} o see numberField
 * @returns {{ el: HTMLElement, set(v: number): void, setInfo(text: string): void, setDisabled(d: boolean): void, destroy(): void }}
 */
export function slider(o) {
  const step = o.step ?? 1;
  const decimals = o.decimals ?? 0;
  let value = o.value;
  const id = nextId('sl');
  let dirty = false;

  const range = el('input', {
    id,
    type: 'range',
    class: 'sl-range',
    min: String(o.min),
    max: String(o.max),
    step: String(step),
    'aria-valuetext': null,
  });
  range.value = String(value);
  const setValueText = () => range.setAttribute('aria-valuetext', `${formatNumber(value, decimals)}${o.unit ? ` ${o.unit}` : ''}`);
  setValueText();

  const field = numberField({
    label: o.label,
    unit: o.unit,
    min: o.min,
    max: o.max,
    step,
    decimals,
    value,
    compact: true,
    onInput: (v) => {
      value = v;
      range.value = String(v);
      setValueText();
      o.onInput?.(v);
    },
    onCommit: (v) => o.onCommit?.(v),
  });
  const label = el('label', { class: 'sl-label', htmlFor: id, text: o.label });
  const infoEl = el('div', { class: 'nf-info', id: `${id}-info`, hidden: !o.info, text: o.info || '' });
  if (o.info !== undefined) range.setAttribute('aria-describedby', infoEl.id);
  const root = el('div', { class: 'sl' }, [label, el('div', { class: 'sl-row' }, [range, field.el]), infoEl]);

  const onInput = () => {
    const v = roundTo(Number(range.value), decimals);
    if (v === value) return;
    value = v;
    dirty = true;
    field.set(v);
    setValueText();
    o.onInput?.(v);
  };
  const onChange = () => {
    if (!dirty) return;
    dirty = false;
    o.onCommit?.(value);
  };
  range.addEventListener('input', onInput);
  range.addEventListener('change', onChange);
  range.addEventListener('pointerup', onChange);

  let pressed = false;
  range.addEventListener('pointerdown', () => { pressed = true; });
  range.addEventListener('pointerup', () => { pressed = false; });
  range.addEventListener('pointercancel', () => { pressed = false; onChange(); });

  return {
    el: root,
    set(v) {
      if (pressed) return;
      value = v;
      range.value = String(v);
      setValueText();
      field.set(v);
    },
    setInfo(text) {
      infoEl.textContent = text || '';
      infoEl.hidden = !text;
    },
    setDisabled(d) {
      range.disabled = !!d;
      field.setDisabled(d);
    },
    destroy() {
      field.destroy();
      root.remove();
    },
  };
}

/**
 * A row of mutually exclusive buttons, exposed as a radio group. Arrow keys
 * move the choice (and call onChange), Home/End jump to the ends.
 * @param {object} o
 * @param {string} o.label
 * @param {{ value: any, label: string, disabled?: boolean }[]} o.options
 * @param {any} o.value
 * @param {(v: any) => void} [o.onChange]
 * @param {boolean} [o.hideLabel] keep the label for screen readers only
 * @returns {{ el: HTMLElement, set(v: any): void, destroy(): void }}
 */
export function segmented(o) {
  let value = o.value;
  const labelId = nextId('seg');
  const group = el('div', { class: 'seg-group', role: 'radiogroup', 'aria-labelledby': labelId });
  const buttons = o.options.map((opt) => {
    const b = el('button', { type: 'button', class: 'seg-btn', role: 'radio', text: opt.label, disabled: !!opt.disabled });
    b.dataset.value = String(opt.value);
    b.addEventListener('click', () => choose(opt.value, false));
    group.append(b);
    return b;
  });
  const root = el('div', { class: 'seg' }, [
    el('span', { class: `seg-label${o.hideLabel ? ' visually-hidden' : ''}`, id: labelId, text: o.label }),
    group,
  ]);

  const render = () => {
    let anyChecked = false;
    o.options.forEach((opt, i) => {
      const on = opt.value === value;
      anyChecked ||= on;
      buttons[i].setAttribute('aria-checked', String(on));
      buttons[i].tabIndex = on ? 0 : -1;
    });
    // Keep one tab stop even when no option matches.
    if (!anyChecked && buttons[0]) buttons[0].tabIndex = 0;
  };
  const choose = (v, focus) => {
    const i = o.options.findIndex((opt) => opt.value === v);
    if (focus && buttons[i]) buttons[i].focus();
    if (v === value) return;
    value = v;
    render();
    o.onChange?.(v);
  };
  group.addEventListener('keydown', (e) => {
    const enabled = o.options.filter((opt) => !opt.disabled);
    if (!enabled.length) return;
    const i = Math.max(0, enabled.findIndex((opt) => opt.value === value));
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(i + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = enabled[(i + enabled.length - 1) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    choose(next.value, true);
  });
  render();

  return {
    el: root,
    set(v) {
      value = v;
      render();
    },
    destroy() {
      root.remove();
    },
  };
}

/**
 * An on/off switch.
 * @param {{ label: string, value: boolean, onChange?: (v: boolean) => void }} o
 * @returns {{ el: HTMLElement, set(v: boolean): void, destroy(): void }}
 */
export function toggle(o) {
  let value = !!o.value;
  const button = el('button', { type: 'button', class: 'tg-btn', role: 'switch' }, [el('span', { class: 'tg-knob', 'aria-hidden': 'true' })]);
  const labelId = nextId('tg');
  button.setAttribute('aria-labelledby', labelId);
  const root = el('div', { class: 'tg' }, [el('span', { class: 'tg-label', id: labelId, text: o.label }), button]);
  const render = () => button.setAttribute('aria-checked', String(value));
  button.addEventListener('click', () => {
    value = !value;
    render();
    o.onChange?.(value);
  });
  render();
  return {
    el: root,
    set(v) {
      value = !!v;
      render();
    },
    destroy() {
      root.remove();
    },
  };
}

/**
 * A labelled native select.
 * @param {{ label: string, options: { value: string, label: string }[], value: string, onChange?: (v: string) => void }} o
 * @returns {{ el: HTMLElement, set(v: string): void, destroy(): void }}
 */
export function select(o) {
  const id = nextId('sel');
  const sel = el('select', { id, class: 'sel-input' }, o.options.map((opt) => el('option', { value: String(opt.value), text: opt.label })));
  sel.value = String(o.value);
  sel.addEventListener('change', () => {
    const opt = o.options.find((x) => String(x.value) === sel.value);
    o.onChange?.(opt ? opt.value : sel.value);
  });
  const root = el('div', { class: 'sel' }, [el('label', { class: 'sel-label', htmlFor: id, text: o.label }), sel]);
  return {
    el: root,
    set(v) {
      if (document.activeElement !== sel) sel.value = String(v);
    },
    destroy() {
      root.remove();
    },
  };
}
