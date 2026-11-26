// My patterns in the UI (pattern studio D48, §3.9): the name form Save
// opens, and the confirmation before an entry is deleted. The Pattern step,
// the phone dock and the 2D editor share them.
//
// Both open in place, never over the pot (D22): under the swatches, in the
// dock's adjuster, or under the editor's head. Save itself is an icon
// (labelIcon, D49); the form's Cancel and Save confirm and keep their words
// (§11.5). What saving does is ui/pattern-actions.js (savableEntry,
// suggestName, saveEntry); this is only the asking.

import { h } from './controls.js';
import { listPatterns } from '../store/assets.js';
import { entryNamed, suggestName } from './pattern-actions.js';

const ADDS = {
  pattern: 'Adds it to My patterns in this browser, with its depth, density, Fade and Soften.',
};

let uid = 0;

/**
 * Brings a form that just opened into view inside the nearest area that
 * scrolls (the step's parts, the phone sheet), never the whole panel, whose
 * step row would scroll away with it.
 * @param {HTMLElement} el
 */
export function revealInPlace(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy !== 'auto' && oy !== 'scroll') || p.scrollHeight <= p.clientHeight) continue;
    const a = el.getBoundingClientRect();
    const box = p.getBoundingClientRect();
    if (a.bottom > box.bottom) p.scrollTop += Math.min(a.bottom - box.bottom + 8, a.top - box.top - 8);
    else if (a.top < box.top) p.scrollTop -= box.top - a.top + 8;
    return;
  }
}

/**
 * The name form Save opens. `open()` lists My patterns, offers a name
 * (suggestName) and focuses the field. A name an entry of this kind already
 * has turns Save into Replace and says so. Enter saves, Esc and Cancel close.
 * @param {{ kind: 'pattern', compact?: boolean,
 *   build(): object | null,
 *   save(entry: object, name: string, saved: object[]): Promise<{ entry: object, replaced: boolean } | null>,
 *   onClose?(result: { entry: object, replaced: boolean } | null): void }} opts
 *   build gives the entry to save now (savableEntry), or null when there is
 *   none; save stores it (saveEntry) and resolves null when the browser
 *   didn't; compact is the dock's one-row form.
 * @returns {{ el: HTMLFormElement, open(): Promise<boolean>, close(): void, readonly isOpen: boolean }}
 */
export function createSaveForm({ kind, compact = false, build, save, onClose }) {
  const n = ++uid;
  const noteId = `save-note-${n}`;
  const input = h('input', {
    type: 'text', id: `save-name-${n}`, class: 'save-name', maxlength: '80', autocomplete: 'off',
    enterkeyhint: 'done', 'aria-describedby': noteId,
  });
  input.spellcheck = false;
  const label = h('label', { class: compact ? 'save-label visually-hidden' : 'save-label', for: input.id, text: 'Name' });
  input.placeholder = 'Name';
  const cancel = h('button', { type: 'button', class: 'btn save-cancel', text: 'Cancel' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary save-submit', text: 'Save' });
  const note = h('p', { class: 'save-note', id: noteId, 'aria-live': 'polite' });
  const what = kind === 'pattern' ? 'pattern' : 'swatch';
  const form = h('form', { class: `save-form${compact ? ' save-form--compact' : ''}`, hidden: true, 'aria-label': `Save the ${what} to My patterns` }, [
    h('div', { class: 'save-row' }, [label, input, cancel, submit]),
    note,
  ]);

  let saved = [];
  let busy = false;
  let open = false;

  function sync() {
    const taken = entryNamed(saved, kind, input.value);
    submit.textContent = taken ? 'Replace' : 'Save';
    submit.disabled = busy || !input.value.trim();
    note.textContent = taken
      ? `Replaces “${taken.name}” in My patterns.`
      : compact ? 'Adds it to My patterns in this browser.' : ADDS[kind];
  }

  function close(result = null) {
    if (!open) return;
    open = false;
    busy = false;
    form.hidden = true;
    onClose?.(result);
  }

  input.addEventListener('input', sync);
  cancel.addEventListener('click', () => close(null));
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close(null);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (busy || !name) return;
    const entry = build();
    if (!entry) {
      close(null);
      return;
    }
    busy = true;
    sync();
    let result = null;
    try {
      result = await save(entry, name, saved);
    } catch (err) {
      console.warn('Pattern not saved', err);
    }
    busy = false;
    if (!open) return;
    if (!result) {
      sync();
      note.textContent = 'This browser didn’t store it. Try again.';
      return;
    }
    close(result);
  });

  return {
    el: form,
    async open() {
      const entry = build();
      if (!entry) return false;
      try {
        saved = await listPatterns(kind);
      } catch (err) {
        console.warn('My patterns not loaded', err);
        saved = [];
      }
      input.value = suggestName(saved, entry);
      open = true;
      busy = false;
      form.hidden = false;
      sync();
      revealInPlace(form);
      input.focus({ preventScroll: true });
      input.select();
      return true;
    },
    close: () => close(null),
    get isOpen() { return open; },
  };
}

/**
 * The confirmation before one of My patterns is deleted, under the swatches.
 * `ask` shows it for an entry, with Cancel focused; Delete runs `onDelete`
 * with what was asked. Esc and Cancel put the focus back where it came from.
 * @param {{ onDelete(pending: { entry: object, from: HTMLElement | null }): void }} opts
 * @returns {{ el: HTMLElement, ask(entry: object, from: HTMLElement | null, text: string): void, close(refocus?: boolean): void, readonly pending: object | null }}
 */
export function createDeleteConfirm({ onDelete }) {
  const text = h('p', { class: 'mine-confirm-text', id: `mine-confirm-${++uid}` });
  const cancel = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
  const del = h('button', { type: 'button', class: 'btn btn-danger', text: 'Delete' });
  const el = h('div', { class: 'mine-confirm', role: 'group', 'aria-labelledby': text.id, hidden: true }, [
    text,
    h('div', { class: 'mine-confirm-actions' }, [cancel, del]),
  ]);
  let pending = null;
  const close = (refocus = false) => {
    const p = pending;
    pending = null;
    el.hidden = true;
    if (refocus && p?.from?.isConnected) p.from.focus();
  };
  cancel.addEventListener('click', () => close(true));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  });
  del.addEventListener('click', () => {
    const p = pending;
    if (!p) return;
    close(false);
    onDelete(p);
  });
  return {
    el,
    ask(entry, from, message) {
      pending = { entry, from };
      text.textContent = message;
      el.hidden = false;
      revealInPlace(el);
      cancel.focus({ preventScroll: true });
    },
    close,
    get pending() { return pending; },
  };
}
