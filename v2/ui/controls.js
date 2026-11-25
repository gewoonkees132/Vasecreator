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

// Pixels of horizontal drag per step when scrubbing a label or a value.
const SCRUB_PX = 4;
// Below this the pointer press is a click (focus the field), not a scrub. A
// finger wobbles more than a mouse, so a tap gets more room.
const SCRUB_DEADZONE = 3;
const SCRUB_DEADZONE_TOUCH = 8;
const REPEAT_DELAY = 400;
const REPEAT_EVERY = 70;
// Keys a range input steps with.
const STEP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

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

/**
 * Steps n times along the grid of whole multiples of `step`, the way a native
 * number input steps: 12.3 plus one step of 1 gives 13, not 13.3, so a drag or
 * an arrow press lands on round numbers. A value already on the grid moves by
 * exactly n steps.
 * @param {number} v @param {number} n whole steps, negative goes down @param {number} step
 * @returns {number}
 */
export function stepOnGrid(v, n, step) {
  if (!n || !(step > 0)) return v;
  const q = v / step;
  // The tolerance keeps 0.3 / 0.1 = 2.9999… on the grid.
  const near = Math.round(q);
  const base = Math.abs(q - near) < 1e-6 ? near : n > 0 ? Math.floor(q) : Math.ceil(q);
  return (base + n) * step;
}

// Shows at most `decimals` places and drops trailing zeros ("170", "2.5").
function formatNumber(v, decimals) {
  if (!Number.isFinite(v)) return '';
  const s = String(roundTo(v, decimals) + 0); // + 0 turns −0 into 0
  return s.includes('e') ? roundTo(v, decimals).toFixed(decimals) : s;
}

/**
 * A labelled number with a unit. Drag the label or the value sideways to
 * scrub in whole steps (Shift ×10, Alt ÷10 where the decimals show it);
 * ArrowUp/Down step the same way. Click the value to type, then press Enter
 * or leave the field to commit; Escape reverts. − / + steppers show on touch
 * screens. Screen readers get a spinbutton, so every step is announced.
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
    role: 'spinbutton',
    'aria-label': o.compact ? o.label : null,
  });
  input.readOnly = disabled;
  input.spellcheck = false;
  const unit = o.unit ? el('span', { class: 'nf-unit', 'aria-hidden': 'true', text: o.unit }) : null;
  const minus = o.compact ? null : el('button', { type: 'button', class: 'nf-step', text: '−', 'aria-label': `Decrease ${o.label}`, tabIndex: -1 });
  const plus = o.compact ? null : el('button', { type: 'button', class: 'nf-step', text: '+', 'aria-label': `Increase ${o.label}`, tabIndex: -1 });
  const box = el('div', { class: 'nf-box' }, [minus, el('div', { class: 'nf-field' }, [input, unit]), plus]);
  const label = o.compact ? null : el('label', { class: 'nf-label', htmlFor: id, text: o.label, title: 'Drag sideways to change' });
  const fieldBox = box.querySelector('.nf-field');
  const infoEl = el('div', { class: 'nf-info', id: `${id}-info`, hidden: !o.info, text: o.info || '' });
  if (o.info !== undefined) input.setAttribute('aria-describedby', infoEl.id);
  const root = el('div', { class: `nf${o.compact ? ' nf--compact' : ''}` }, [label, box, o.compact ? null : infoEl]);

  // Only rewrite the text when the person isn't typing in the field, so a
  // store echo never clobbers what they typed.
  let typing = false;
  const unitText = o.unit ? ` ${o.unit}` : '';
  const setAria = (name, v) => (v == null ? input.removeAttribute(name) : input.setAttribute(name, v));
  const syncAria = () => {
    setAria('aria-valuemin', Number.isFinite(min) ? String(min) : null);
    setAria('aria-valuemax', Number.isFinite(max) ? String(max) : null);
    const known = Number.isFinite(value);
    setAria('aria-valuenow', known ? String(roundTo(value, decimals)) : null);
    setAria('aria-valuetext', known ? `${formatNumber(value, decimals)}${unitText}` : null);
  };
  const show = () => {
    if (!(typing && document.activeElement === input)) input.value = formatNumber(value, decimals);
    syncAria();
  };
  show();

  // The last number this field sent, which ends the gesture even when an
  // echo through set() has replaced `value` meanwhile.
  let lastSent = value;
  const emitInput = (v) => {
    if (v === value) return false;
    value = v;
    lastSent = v;
    input.value = formatNumber(value, decimals);
    syncAria();
    o.onInput?.(v);
    return true;
  };

  // Shift takes ten steps at once; Alt (Option) a tenth of one, but only
  // where the field shows that many decimals.
  const fineStep = () => {
    const fine = step / 10;
    return roundTo(fine, decimals) === fine && fine > 0 ? fine : step;
  };
  const stepSize = (mods) => (mods?.shiftKey ? step * 10 : mods?.altKey ? fineStep() : step);

  // A gesture (scrub, arrows, steppers) is "dirty" once it changed the value;
  // only then does it end with onCommit.
  let gestureDirty = false;
  const stepBy = (n, mods) => {
    if (disabled) return;
    const base = Number.isFinite(value) ? value : 0;
    if (emitInput(clampRound(stepOnGrid(base, n, stepSize(mods))))) gestureDirty = true;
  };
  const endGesture = () => {
    if (gestureDirty) {
      gestureDirty = false;
      o.onCommit?.(lastSent);
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
      syncAria();
      // The typed number goes to both: onInput's store echo may call set()
      // with an older value before onCommit runs.
      o.onInput?.(v);
      o.onCommit?.(v);
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
      stepBy(e.key === 'ArrowUp' ? 1 : -1, e);
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

  // Scrub by dragging the label or the value. Both take only horizontal
  // drags (touch-action: pan-y in the CSS), so on a phone a vertical swipe
  // still scrolls the panel. A press on the value that doesn't move is a
  // click and focuses the field for typing. While the field has focus, a
  // press in it places the caret as usual.
  let scrub = null;
  let suppressClick = false;
  const typingInField = () => document.activeElement === input;
  const onScrubDown = (e) => {
    if (disabled || e.button !== 0) return;
    const onValue = e.currentTarget === fieldBox;
    if (onValue) {
      if (typingInField()) return;
      // No focus and no text selection until it's clear this is a click.
      e.preventDefault();
    }
    scrub = {
      x: e.clientX, start: Number.isFinite(value) ? value : 0, active: false, id: e.pointerId, onValue,
      deadzone: e.pointerType === 'mouse' ? SCRUB_DEADZONE : SCRUB_DEADZONE_TOUCH,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onScrubMove = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const dx = e.clientX - scrub.x;
    if (!scrub.active && Math.abs(dx) < scrub.deadzone) return;
    if (!scrub.active) {
      scrub.active = true;
      // Count from the edge of the dead zone, so the first step takes as
      // much travel as every later one.
      scrub.x += Math.sign(dx) * scrub.deadzone;
      root.classList.add('is-scrubbing');
      // Typed-but-uncommitted text would be lost; commit it first.
      if (typingInField()) input.blur();
    }
    const steps = Math.trunc((e.clientX - scrub.x) / SCRUB_PX);
    if (emitInput(clampRound(stepOnGrid(scrub.start, steps, stepSize(e))))) gestureDirty = true;
  };
  const onScrubUp = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const { active, onValue } = scrub;
    scrub = null;
    root.classList.remove('is-scrubbing');
    if (active) {
      suppressClick = true;
      endGesture();
    } else if (onValue && e.type === 'pointerup') {
      input.focus(); // the focus handler selects the text, ready to type over
    }
  };
  const onScrubClick = (e) => {
    if (suppressClick) {
      e.preventDefault();
      suppressClick = false;
    }
  };
  for (const target of [label, fieldBox]) {
    if (!target) continue;
    target.addEventListener('pointerdown', onScrubDown);
    target.addEventListener('pointermove', onScrubMove);
    target.addEventListener('pointerup', onScrubUp);
    target.addEventListener('pointercancel', onScrubUp);
    // Capture also goes when the field moves to the other layout mid-scrub;
    // an unfinished scrub would leave set() ignoring the store for good.
    target.addEventListener('lostpointercapture', onScrubUp);
    target.addEventListener('click', onScrubClick);
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
      stepBy(dir, e);
      stopRepeat();
      repeatTimer = setTimeout(() => {
        repeatTimer = setInterval(() => stepBy(dir, null), REPEAT_EVERY);
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
      stepBy(dir, null);
      endGesture();
    });
  };
  bindStepper(minus, -1);
  bindStepper(plus, 1);

  const applyDisabled = () => {
    input.readOnly = disabled;
    setAria('aria-readonly', disabled ? 'true' : null);
    fieldBox.title = disabled ? '' : 'Drag sideways, or click to type';
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
      syncAria();
    },
    destroy() {
      stopRepeat();
      root.remove();
    },
  };
}

/**
 * The values a slider snaps to while its thumb is dragged: every `snap` from
 * min to max, plus max itself when the range isn't a whole number of snaps.
 * Exported for the tests.
 * @param {number} min @param {number} max @param {number} snap @param {number} decimals
 * @returns {number[]} empty when snap is missing or would give more than 41 marks
 */
export function snapMarks(min, max, snap, decimals) {
  if (!(snap > 0) || !(max > min) || (max - min) / snap > 40) return [];
  const marks = [];
  for (let i = 0; min + i * snap <= max + snap * 1e-6; i++) marks.push(roundTo(min + i * snap, decimals));
  if (marks.at(-1) < max) marks.push(roundTo(max, decimals));
  return marks;
}

/**
 * A range slider with a compact number field beside it (Depth ──●── [2.5 mm]).
 * Same options as numberField, plus `snap`: dragging the thumb moves in steps
 * of `snap`, shown as tick marks under the track, and holding Shift drags in
 * the finer `step`. Arrow keys and the number field always use `step`.
 * @param {object} o see numberField
 * @param {number} [o.snap] coarse step for dragging the thumb
 * @returns {{ el: HTMLElement, set(v: number): void, setInfo(text: string): void, setDisabled(d: boolean): void, destroy(): void }}
 */
export function slider(o) {
  const step = o.step ?? 1;
  const decimals = o.decimals ?? 0;
  let value = o.value;
  const id = nextId('sl');
  let dirty = false;
  const marks = snapMarks(o.min, o.max, o.snap, decimals);

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
  // Native tick marks: the browser lines them up with the thumb's travel.
  const ticks = marks.length
    ? el('datalist', { id: `${id}-ticks` }, marks.map((m) => el('option', { value: String(m) })))
    : null;
  if (ticks) {
    range.setAttribute('list', ticks.id);
    range.classList.add('has-ticks');
  }
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
  const root = el('div', { class: 'sl' }, [label, el('div', { class: 'sl-row' }, [range, ticks, field.el]), infoEl]);

  // While the thumb is dragged (not on arrow keys) it snaps to the marks,
  // unless Shift is held for the fine steps.
  let fineDrag = false;
  const snapped = (v) => {
    if (!marks.length || !pressed || fineDrag) return v;
    let best = marks[0];
    for (const m of marks) if (Math.abs(m - v) < Math.abs(best - v)) best = m;
    return best;
  };

  const onInput = () => {
    const v = snapped(roundTo(Number(range.value), decimals));
    if (String(v) !== range.value) range.value = String(v);
    if (v === value) return;
    value = v;
    dirty = true;
    field.set(v);
    setValueText();
    o.onInput?.(v);
  };
  // A held arrow key fires 'change' on every repeat; the whole hold is one
  // gesture, so the commit waits for the key to come up.
  let keyHeld = false;
  const onChange = () => {
    if (!dirty || keyHeld) return;
    dirty = false;
    o.onCommit?.(value);
  };
  range.addEventListener('input', onInput);
  range.addEventListener('change', onChange);
  range.addEventListener('keydown', (e) => { if (STEP_KEYS.has(e.key)) keyHeld = true; });
  range.addEventListener('keyup', (e) => {
    if (!STEP_KEYS.has(e.key)) return;
    keyHeld = false;
    onChange();
  });
  range.addEventListener('blur', () => {
    keyHeld = false;
    onChange();
  });

  // While pressed, store echoes don't move the thumb. The release is caught on
  // the window too: a pointer let go off the track must not leave the slider
  // deaf to undo and every later update.
  let pressed = false;
  const release = () => {
    if (!pressed) return;
    pressed = false;
    removeEventListener('pointerup', release, true);
    removeEventListener('pointercancel', release, true);
    onChange();
  };
  range.addEventListener('pointerdown', (e) => {
    pressed = true;
    fineDrag = e.shiftKey;
    addEventListener('pointerup', release, true);
    addEventListener('pointercancel', release, true);
  });
  range.addEventListener('pointermove', (e) => { if (pressed) fineDrag = e.shiftKey; });

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
    /** New ends (a limit that follows the design, such as half a bead); the snap marks follow. */
    setLimits({ min = o.min, max = o.max } = {}) {
      if (min === o.min && max === o.max) return;
      o.min = min;
      o.max = max;
      range.min = String(min);
      range.max = String(max);
      field.setLimits({ min, max });
      marks.splice(0, marks.length, ...snapMarks(min, max, o.snap, decimals));
      ticks?.replaceChildren(...marks.map((m) => el('option', { value: String(m) })));
      range.value = String(value);
    },
    destroy() {
      release();
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
  // Five or more choices (the blend and fade words) wrap onto a second row.
  const root = el('div', { class: o.options.length > 4 ? 'seg seg--many' : 'seg' }, [
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
