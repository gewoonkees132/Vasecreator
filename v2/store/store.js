// The app state: the design, its history, the view state, the printer and
// the newest preview result. Plain object plus subscribers; no framework.
//
// History is a list of design snapshots (oldest first) and a pointer. A drag
// is one gesture: change() edits live, commit() adds one step. Nothing is ever
// lost (design C3): undo/redo only move the pointer, and a new step made while
// the pointer is below the top is appended on top, so older steps all stay.
//
// Other open tabs share the stored history. Every save merges (store/db.js),
// and a tab that saved a new step says so on the channel, so the others pick
// it up: it shows in their history column, while their pointer and their
// design stay where they are. Undo and redo skip steps that came in from
// another tab this way, so they only ever undo this tab's own changes.

import { mergeHistory, MAX_STEPS } from './db.js';

const PERSIST_DELAY_MS = 500;
const REFRESH_DELAY_MS = 100;
const LS_STEP = 'vc2.step';

/** The five design steps in their fixed order (design D28). */
export const STEPS = ['shape', 'pattern', 'layers', 'base', 'print'];

/** view.mode follows the step: Print is the print mode, every other step designs. */
export const modeOf = (step) => (step === 'print' ? 'print' : 'design');

/**
 * @typedef {{ id: string, label: string, time: number, design: object, savedId: string | null, thumb: Blob | null }} Step
 * @typedef {'design' | 'view' | 'printer' | 'result' | 'history'} What
 */

/**
 * Relative time for history labels and tiles: "now", "1 min", "3 min", "2 h", "3 d".
 * @param {number} time  ms since the epoch
 * @param {number} [now]
 * @returns {string}
 */
export function relativeTime(time, now = Date.now()) {
  const s = Math.max(0, (now - time) / 1000);
  if (s < 45) return 'now';
  const min = Math.round(s / 60);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

// Designs compare without meta: renaming or saving is not a design change.
function key(design) {
  if (!design) return '';
  const { meta, ...rest } = design;
  return JSON.stringify(rest);
}

let idCounter = 0;
function newId() {
  idCounter += 1;
  return `s${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function readLocal(name, fallback) {
  try {
    const raw = localStorage.getItem(name);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeLocal(name, value) {
  try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* storage off */ }
}

// A reload comes back to the step you were on; every step starts on its first
// part, and on a phone its first dock tool (both last the session only).
function defaultView() {
  const saved = readLocal(LS_STEP, null);
  const step = STEPS.includes(saved) ? saved : 'shape';
  return {
    step,
    parts: {},
    tools: {},
    mode: modeOf(step),
    slot: 'a',
    selectedKnot: null,
    highlight: null,
    designsOpen: false,
    editor: null,
    sizeLocked: true,
  };
}

/**
 * Creates the store.
 * @param {object} options
 * @param {object} options.design   the design to start with (used when there is no history)
 * @param {{ steps: Step[], pointer: number } | null} [options.history]  persisted history (oldest first)
 * @param {object} [options.printer]
 * @param {string} [options.label]  label of the first step when there is no history, e.g. 'Opened: Classic vase'
 * @param {{ saveHistory: Function } | null} [options.db]  persists history when given (store/db.js)
 * @param {{ postMessage: Function, addEventListener: Function } | null} [options.channel]
 *   a BroadcastChannel shared by the app's tabs, to hear about their new steps
 * @param {(design: object) => object | null} [options.normalise]
 *   applied to steps that come in from other tabs; null skips the step
 */
export function createStore({ design, history = null, printer = null, label = 'Start', db = null, channel = null, normalise = null }) {
  // One id per page load, so the stored history knows where each tab's pointer is.
  const tab = `t${newId()}`;

  /** A step record as stored, or null when it can't be used. */
  function readStep(s, incoming = false) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id) return null;
    let stepDesign = s.design;
    if (incoming && normalise) {
      try { stepDesign = normalise(stepDesign); } catch { stepDesign = null; }
    }
    if (!stepDesign || typeof stepDesign !== 'object') return null;
    return {
      id: s.id,
      label: String(s.label || ''),
      time: Number.isFinite(s.time) ? s.time : 0,
      design: stepDesign,
      savedId: s.savedId ?? null,
      thumb: typeof Blob !== 'undefined' && s.thumb instanceof Blob ? s.thumb : null,
    };
  }

  /** @type {Step[]} */
  let steps = [];
  let pointer = 0;
  const given = history && Array.isArray(history.steps) ? history.steps : [];
  if (given.length > 0) {
    const pointerId = given[Math.min(Math.max(0, history.pointer | 0), given.length - 1)]?.id;
    steps = given.map((s) => readStep(s)).filter(Boolean);
    pointer = steps.findIndex((s) => s.id === pointerId);
    if (pointer < 0) pointer = steps.length - 1;
  }
  const restored = steps.length > 0;
  if (!restored) {
    steps = [{ id: newId(), label, time: Date.now(), design: structuredClone(design), savedId: null, thumb: null }];
    pointer = 0;
  }
  // Steps another tab made while this one was open: on the list, but not on undo's path.
  const foreign = new Set();

  const state = {
    design: structuredClone(steps[pointer].design),
    view: defaultView(),
    printer,
    result: null,
    savedId: steps[pointer].savedId,
    historyIndex: steps.length - 1 - pointer,
    historyId: steps[pointer].id,
  };

  const listeners = new Set();
  let gestureLabel = null;
  // Which kind of gesture is open: null for the controls, 'editor' for an
  // editor session (D46). A change of another kind ends the open gesture
  // first, so each lands as its own step.
  let gestureGroup = null;

  // Persistence bookkeeping: steps changed since the last save.
  const dirty = new Set();
  let persistTimer = 0;
  let metaDirty = false;

  function schedulePersist(delay = PERSIST_DELAY_MS) {
    if (!db) return;
    metaDirty = true;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(flush, delay);
  }

  // Saves are merges (store/db.js), so one tab never hides another tab's
  // steps, and the answer brings in the steps other tabs saved meanwhile.
  function flush() {
    clearTimeout(persistTimer);
    persistTimer = 0;
    if (!db) return Promise.resolve();
    const sent = steps.map((s) => ({ ...s }));
    const changed = [...dirty];
    dirty.clear();
    metaDirty = false;
    return db.saveHistory({ steps: sent, dirty: changed, pointer: steps[pointer].id, tab }).then((saved) => {
      if (!saved) {
        // Not written (quota, a closed connection): keep it for the next write.
        for (const id of changed) dirty.add(id);
        metaDirty = true;
        return;
      }
      adopt(saved, new Set(sent.map((s) => s.id)));
      if (saved.grew && channel) {
        try { channel.postMessage({ type: 'steps', tab }); } catch { /* closed */ }
      }
    });
  }

  /**
   * Takes the merged list from a save: other tabs' new steps come in, steps
   * the cap dropped go. Steps made while the save ran, and the step at the
   * pointer, always stay. The design and the pointer's step never change.
   */
  function adopt(saved, sent) {
    const byId = new Map(steps.map((s) => [s.id, s]));
    for (const record of saved.added) {
      if (byId.has(record.id)) continue;
      const step = readStep(record, true);
      if (!step) continue;
      byId.set(step.id, step);
      foreign.add(step.id);
    }
    const listed = new Set(saved.order);
    const current = steps[pointer];
    const ordered = saved.order.map((id) => byId.get(id)).filter(Boolean);
    const extra = steps.filter((s) => !listed.has(s.id) && (!sent.has(s.id) || s === current));
    const next = extra.length ? mergeHistory(ordered, extra, { cap: Infinity }).steps : ordered;
    const same = next.length === steps.length && next.every((s, i) => s === steps[i]);
    if (same) return;
    steps = next;
    pointer = steps.indexOf(current);
    const live = new Set(steps.map((s) => s.id));
    for (const id of foreign) if (!live.has(id)) foreign.delete(id);
    syncPointer();
    emit('history');
  }

  // Write on page hide too, so a quick close doesn't lose the last step.
  // metaDirty also covers a write that failed earlier and waits for a retry.
  // Coming back to the tab picks up what other tabs did meanwhile.
  if (db && typeof addEventListener === 'function') {
    addEventListener('pagehide', () => { if (persistTimer || metaDirty) flush(); });
    addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') schedulePersist(REFRESH_DELAY_MS);
      else if (persistTimer || metaDirty) flush();
    });
  }
  // Another tab saved a new step: merge it in soon (a burst is one save).
  if (db && channel) {
    channel.addEventListener('message', (e) => {
      if (e?.data?.type === 'steps' && e.data.tab !== tab) schedulePersist(REFRESH_DELAY_MS);
    });
  }

  // A fresh start is a step too, so a reload right away finds "Last design".
  if (!restored) {
    dirty.add(steps[0].id);
    schedulePersist();
  }

  function emit(...what) {
    const set = new Set(what);
    for (const fn of [...listeners]) {
      try {
        fn(state, set);
      } catch (err) {
        console.error('[store] subscriber failed', err);
      }
    }
  }

  function syncPointer() {
    state.historyIndex = steps.length - 1 - pointer;
    state.historyId = steps[pointer].id;
  }

  function pushStep(stepLabel, design, savedId = state.savedId) {
    // Never older than the newest step, so a clock that jumps back can't bury it.
    const time = Math.max(Date.now(), steps[steps.length - 1].time);
    const step = { id: newId(), label: stepLabel, time, design: structuredClone(design), savedId, thumb: null };
    steps.push(step);
    dirty.add(step.id);
    // Memory stays bounded even when saves fail; the next save deletes the records.
    while (steps.length > MAX_STEPS) {
      const old = steps.shift();
      dirty.delete(old.id);
      foreign.delete(old.id);
    }
    pointer = steps.length - 1;
    syncPointer();
    schedulePersist();
    return step;
  }

  // The next step in this direction that isn't another tab's, or -1.
  function ownStep(from, direction) {
    for (let i = from + direction; i >= 0 && i < steps.length; i += direction) {
      if (!foreign.has(steps[i].id)) return i;
    }
    return -1;
  }

  function loadStep(index) {
    pointer = index;
    state.design = structuredClone(steps[pointer].design);
    state.savedId = steps[pointer].savedId;
    syncPointer();
    schedulePersist();
    emit('design', 'history');
  }

  const store = {
    /** @returns {{ design, view, printer, result, savedId, historyIndex, historyId }} */
    get state() { return state; },

    /**
     * @param {(state: object, what: Set<What>) => void} fn
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * Live edit inside a gesture (a drag, a scrub). The mutator edits a draft
     * copy; subscribers get a new design object. No history step yet.
     * A gesture of another `group` (an editor session is 'editor', the
     * controls null) is committed first, so the two never share a step.
     * @param {string} stepLabel
     * @param {(draft: object) => void} mutator
     * @param {{ group?: string | null }} [options]
     */
    change(stepLabel, mutator, { group = null } = {}) {
      if (gestureLabel && gestureGroup !== group) store.commit();
      const draft = structuredClone(state.design);
      mutator(draft);
      gestureLabel = stepLabel;
      gestureGroup = group;
      state.design = draft;
      emit('design');
    },

    /** Ends a gesture: adds one step when the design differs from the step at the pointer. */
    commit() {
      const stepLabel = gestureLabel || 'Change';
      gestureLabel = null;
      gestureGroup = null;
      if (key(state.design) === key(steps[pointer].design)) return false;
      pushStep(stepLabel, state.design);
      emit('history');
      return true;
    },

    /**
     * A one-shot edit (a click, a typed value): change() + commit().
     * @param {string} stepLabel
     * @param {(draft: object) => void} mutator
     */
    apply(stepLabel, mutator, options) {
      store.change(stepLabel, mutator, options);
      return store.commit();
    },

    /**
     * Replaces the design (Designs screen, design files) and adds a step, so
     * the work you left is one click back.
     * @param {object} design  a normalised design
     * @param {string} stepLabel  e.g. 'Opened: Classic vase'
     * @param {{ savedId?: string | null }} [options]  the saved tile it came from
     */
    open(design, stepLabel, { savedId = null } = {}) {
      // An editor session's edits stay a step of their own; a control's
      // half-done gesture is dropped, as before.
      if (gestureLabel && gestureGroup) store.commit();
      gestureLabel = null;
      gestureGroup = null;
      state.design = structuredClone(design);
      state.savedId = savedId;
      const same = key(design) === key(steps[pointer].design) && savedId === steps[pointer].savedId;
      if (!same) pushStep(stepLabel, design, savedId);
      emit('design', 'history');
    },

    undo() {
      if (gestureLabel) store.commit();
      const i = ownStep(pointer, -1);
      if (i >= 0) loadStep(i);
    },

    redo() {
      if (gestureLabel) store.commit();
      const i = ownStep(pointer, 1);
      if (i >= 0) loadStep(i);
    },

    canUndo() { return ownStep(pointer, -1) >= 0; },
    canRedo() { return ownStep(pointer, 1) >= 0; },

    /**
     * Restores a step as a new step on top ("Restored: 4 min"), so nothing is lost.
     * @param {string} stepId
     */
    restore(stepId) {
      const step = steps.find((s) => s.id === stepId);
      if (!step) return;
      if (gestureLabel) store.commit();
      if (key(step.design) === key(state.design) && step.savedId === state.savedId) return;
      state.design = structuredClone(step.design);
      state.savedId = step.savedId;
      pushStep(`Restored: ${relativeTime(step.time)}`, step.design, step.savedId);
      // The restored snapshot already looks right, so reuse its thumbnail.
      steps[pointer].thumb = step.thumb;
      emit('design', 'history');
    },

    /** @returns {Step[]} newest first */
    history() {
      return steps.slice().reverse();
    },

    /** @returns {Step} the step at the pointer */
    currentStep() {
      return steps[pointer];
    },

    /**
     * @param {object} patch  merged into view. `step` is remembered in this
     *   browser; `mode` is derived from it and can't be set on its own.
     */
    setView(patch) {
      const { mode: _mode, ...rest } = patch;
      if ('step' in rest && !STEPS.includes(rest.step)) delete rest.step;
      Object.assign(state.view, rest);
      state.view.mode = modeOf(state.view.step);
      if ('step' in rest) writeLocal(LS_STEP, state.view.step);
      emit('view');
    },

    setPrinter(printer) {
      state.printer = printer;
      emit('printer');
    },

    setResult(result) {
      state.result = result;
      emit('result');
    },

    /**
     * @param {string} stepId
     * @param {Blob | null} blob
     */
    setThumb(stepId, blob) {
      const step = steps.find((s) => s.id === stepId);
      if (!step) return;
      step.thumb = blob;
      dirty.add(step.id);
      schedulePersist();
      emit('history');
    },

    /**
     * Records that the current design is (now) a saved tile: sets savedId and
     * the design's name on the current design and its step, without a new step.
     * @param {string | null} savedId
     * @param {string} [name]
     */
    setSaved(savedId, name) {
      state.savedId = savedId;
      const step = steps[pointer];
      step.savedId = savedId;
      if (name != null) {
        state.design = { ...state.design, meta: { ...(state.design.meta || {}), name } };
        step.design = { ...step.design, meta: { ...(step.design.meta || {}), name } };
      }
      dirty.add(step.id);
      schedulePersist();
      emit('history');
    },

    /**
     * Saves now, merging with what other tabs saved, and takes in their new
     * steps. Otherwise this runs 500 ms after a change, on page hide, when
     * the tab comes back, and when another tab says it saved a step.
     * @returns {Promise<void>}
     */
    flush,
  };

  return store;
}
