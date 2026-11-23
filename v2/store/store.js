// The app state: the design, its history, the view state, the printer and
// the newest preview result. Plain object plus subscribers; no framework.
//
// History is a list of design snapshots (oldest first) and a pointer. A drag
// is one gesture: change() edits live, commit() adds one step. Nothing is ever
// lost (design C3): undo/redo only move the pointer, and a new step made while
// the pointer is below the top is appended on top, so older steps all stay.

const MAX_STEPS = 200;
const PERSIST_DELAY_MS = 500;
const LS_ADVANCED = 'vc2.advanced';
const LS_SECTIONS = 'vc2.openSections';

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

function defaultView() {
  const sections = readLocal(LS_SECTIONS, null);
  return {
    advanced: readLocal(LS_ADVANCED, false) === true,
    mode: 'design',
    openSections: Array.isArray(sections) ? sections : ['surface'],
    slot: 'a',
    selectedKnot: null,
    highlight: null,
    phoneTab: 'shape',
    designsOpen: false,
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
 */
export function createStore({ design, history = null, printer = null, label = 'Start', db = null }) {
  /** @type {Step[]} */
  let steps;
  let pointer;
  if (history && Array.isArray(history.steps) && history.steps.length > 0) {
    steps = history.steps.map((s) => ({
      id: String(s.id),
      label: String(s.label || ''),
      time: Number(s.time) || Date.now(),
      design: s.design,
      savedId: s.savedId ?? null,
      thumb: s.thumb instanceof Blob ? s.thumb : null,
    }));
    pointer = Math.min(Math.max(0, history.pointer | 0), steps.length - 1);
  } else {
    steps = [{ id: newId(), label, time: Date.now(), design: structuredClone(design), savedId: null, thumb: null }];
    pointer = 0;
  }

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

  // Persistence bookkeeping: steps written since the last flush and ids to delete.
  const dirty = new Set();
  const removed = new Set();
  let persistTimer = 0;
  let metaDirty = false;

  function schedulePersist() {
    if (!db) return;
    metaDirty = true;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(flush, PERSIST_DELAY_MS);
  }

  function flush() {
    persistTimer = 0;
    if (!db || (!metaDirty && dirty.size === 0 && removed.size === 0)) return Promise.resolve();
    const put = steps.filter((s) => dirty.has(s.id)).map((s) => ({ ...s }));
    const remove = [...removed];
    dirty.clear();
    removed.clear();
    metaDirty = false;
    return db.saveHistory({ put, remove, order: steps.map((s) => s.id), pointer }).then((ok) => {
      if (ok !== false) return;
      // Not written (quota, a closed connection): keep it for the next write.
      for (const s of put) dirty.add(s.id);
      for (const id of remove) removed.add(id);
      metaDirty = true;
    });
  }

  // Write on page hide too, so a quick close doesn't lose the last step.
  // metaDirty also covers a write that failed earlier and waits for a retry.
  if (db && typeof addEventListener === 'function') {
    addEventListener('pagehide', () => { if (persistTimer || metaDirty) { clearTimeout(persistTimer); flush(); } });
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && (persistTimer || metaDirty)) { clearTimeout(persistTimer); flush(); }
    });
  }

  // A fresh start is a step too, so a reload right away finds "Last design".
  if (!(history && history.steps && history.steps.length)) {
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
    const step = { id: newId(), label: stepLabel, time: Date.now(), design: structuredClone(design), savedId, thumb: null };
    steps.push(step);
    dirty.add(step.id);
    while (steps.length > MAX_STEPS) {
      const old = steps.shift();
      dirty.delete(old.id);
      removed.add(old.id);
    }
    pointer = steps.length - 1;
    syncPointer();
    schedulePersist();
    return step;
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
     * @param {string} stepLabel
     * @param {(draft: object) => void} mutator
     */
    change(stepLabel, mutator) {
      const draft = structuredClone(state.design);
      mutator(draft);
      gestureLabel = stepLabel;
      state.design = draft;
      emit('design');
    },

    /** Ends a gesture: adds one step when the design differs from the step at the pointer. */
    commit() {
      const stepLabel = gestureLabel || 'Change';
      gestureLabel = null;
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
    apply(stepLabel, mutator) {
      store.change(stepLabel, mutator);
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
      gestureLabel = null;
      state.design = structuredClone(design);
      state.savedId = savedId;
      const same = key(design) === key(steps[pointer].design) && savedId === steps[pointer].savedId;
      if (!same) pushStep(stepLabel, design, savedId);
      emit('design', 'history');
    },

    undo() {
      if (gestureLabel) store.commit();
      if (pointer > 0) loadStep(pointer - 1);
    },

    redo() {
      if (gestureLabel) store.commit();
      if (pointer < steps.length - 1) loadStep(pointer + 1);
    },

    canUndo() { return pointer > 0; },
    canRedo() { return pointer < steps.length - 1; },

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

    /** @param {object} patch  merged into view; `advanced` and `openSections` are remembered */
    setView(patch) {
      Object.assign(state.view, patch);
      if ('advanced' in patch) writeLocal(LS_ADVANCED, !!state.view.advanced);
      if ('openSections' in patch) writeLocal(LS_SECTIONS, state.view.openSections);
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

    /** Writes pending history now (tests, page hide). */
    flush,
  };

  return store;
}
