// IndexedDB for v2: history steps (with their thumbnails), saved designs and
// settings such as the printer profile. No dependency, just small promise
// helpers. When IndexedDB is missing or refuses to open (some private modes),
// the same API keeps working in memory for the session, so the app never
// breaks over storage.
//
// History is shared by every open tab. Each tab keeps its own list in memory
// and saves it with one read-merge-write transaction: it reads what is
// stored, takes the union by step id, writes its new steps and deletes only
// what the merged list no longer holds. So the tab that saves last never
// hides the other tab's steps (mergeHistory, planHistorySave).

const DB_NAME = 'vasecreator-v2';
// Version 2 (phase 2) adds 'images' (greyscale rasters by hash) and 'patterns'
// ("My patterns"); upgrading only adds the missing stores, so a version-1
// database keeps its history, designs and settings.
const DB_VERSION = 2;
const STORES = ['history', 'designs', 'settings', 'images', 'patterns'];

// The history store holds one record per step (key = step id) plus this one
// record: { order: string[], pointers: { [tab]: { id, at } } }. Older builds
// wrote { order, pointer } instead; that still reads.
const HISTORY_META = 'meta';

/** About 200 steps are kept (design §8.4). */
export const MAX_STEPS = 200;
// Live pointers of this many tabs (newest first) are protected from the cap.
// Every page load is a new tab, so a closed tab's entry ages out.
const MAX_TABS = 8;

/**
 * @typedef {object} Db
 * @property {boolean} persistent   false when everything lives in memory only
 * @property {(store: string, key: string) => Promise<any>} get
 * @property {(store: string, key: string, value: any) => Promise<boolean>} put   false when the write failed
 * @property {(store: string, key: string) => Promise<void>} delete
 * @property {(store: string) => Promise<any[]>} all
 * @property {() => Promise<{ steps: object[], pointer: number } | null>} loadHistory   pointer = the newest step
 * @property {(save: HistorySave) => Promise<HistorySaved | false>} saveHistory   false when the write failed
 *
 * @typedef {object} HistorySave
 * @property {object[]} steps    this tab's steps, oldest first (shallow copies: they are written as they are)
 * @property {Iterable<string>} dirty   ids of steps changed since the last save
 * @property {string} pointer    id of the step at this tab's pointer; never dropped
 * @property {string} tab        id of this tab (one per page load)
 * @property {number} [cap]      MAX_STEPS
 *
 * @typedef {object} HistorySaved
 * @property {string[]} order    the merged list, oldest first, as stored now
 * @property {object[]} added    stored steps this tab didn't have (other tabs' steps)
 * @property {boolean} grew      a step new to storage was written (worth telling other tabs)
 */

/** A stored step record that can be read: an id, a design object and a time. */
function isStepRecord(record, key) {
  return !!record && typeof record === 'object' && typeof record.id === 'string' && record.id !== ''
    && record.id !== HISTORY_META && (key === undefined || record.id === key)
    && !!record.design && typeof record.design === 'object';
}

const timeOf = (step) => (Number.isFinite(step.time) ? step.time : 0);

/**
 * Merges the stored step list with this tab's list. Pure, so it is tested
 * on its own. The union by id: this tab's steps keep their order and win over
 * a stored copy with the same id; stored steps this tab doesn't have are
 * slotted in by time (on a tie, this tab's step goes first). Then, beyond
 * `cap`, the oldest steps go, except those in `keep` (live pointers).
 * @template {{ id: string, time: number }} S
 * @param {S[]} stored  oldest first
 * @param {S[]} local   oldest first
 * @param {{ cap?: number, keep?: Iterable<string> }} [options]
 * @returns {{ steps: S[], dropped: string[] }}
 */
export function mergeHistory(stored, local, { cap = MAX_STEPS, keep = [] } = {}) {
  const seen = new Set();
  const mine = local.filter((s) => s && !seen.has(s.id) && seen.add(s.id));
  const others = stored.filter((s) => s && !seen.has(s.id) && seen.add(s.id));
  const merged = [];
  let i = 0;
  let j = 0;
  while (i < mine.length || j < others.length) {
    if (j >= others.length || (i < mine.length && timeOf(mine[i]) <= timeOf(others[j]))) merged.push(mine[i++]);
    else merged.push(others[j++]);
  }
  let excess = merged.length - cap;
  if (excess <= 0) return { steps: merged, dropped: [] };
  const kept = new Set(keep);
  const dropped = [];
  const steps = merged.filter((s) => {
    if (excess > 0 && !kept.has(s.id)) {
      excess -= 1;
      dropped.push(s.id);
      return false;
    }
    return true;
  });
  return { steps, dropped };
}

/**
 * The write half of a history save, as a pure function of what the
 * transaction read. Everything in the merged list has a record afterwards,
 * and every other record is deleted (steps the cap dropped, records an older
 * build left behind, unreadable ones).
 * @param {{ meta: any, keys: any[], records: Map<string, any> }} read
 *   meta, every key but meta's, and the records of the keys this tab doesn't have
 * @param {HistorySave} save
 * @param {number} [now]
 * @returns {{ puts: [string, any][], deletes: any[], meta: object, result: HistorySaved }}
 */
export function planHistorySave({ meta, keys, records }, { steps, dirty, pointer, tab, cap = MAX_STEPS }, now = Date.now()) {
  const stored = new Set(keys);
  const changed = new Set(dirty);
  // No meta: a first save, or the site data was cleared under us. Write it all again.
  const wiped = !meta || typeof meta !== 'object';
  // A step that is gone from storage was dropped by another tab's cap. Only
  // this tab's own changes and its current step come back.
  const local = steps.filter((s) => wiped || stored.has(s.id) || changed.has(s.id) || s.id === pointer);
  const localIds = new Set(steps.map((s) => s.id));

  const position = new Map((Array.isArray(meta?.order) ? meta.order : []).map((id, i) => [id, i]));
  const others = [...records]
    .filter(([key, record]) => !localIds.has(key) && isStepRecord(record, key))
    .map(([, record]) => record)
    .sort((a, b) => timeOf(a) - timeOf(b) || (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity));

  const pointers = { [tab]: { id: pointer, at: now } };
  const prior = meta?.pointers && typeof meta.pointers === 'object' ? Object.entries(meta.pointers) : [];
  prior
    .filter(([name, p]) => name !== tab && p && typeof p.id === 'string')
    .sort((a, b) => (Number(b[1].at) || 0) - (Number(a[1].at) || 0))
    .slice(0, MAX_TABS - 1)
    .forEach(([name, p]) => { pointers[name] = { id: p.id, at: Number(p.at) || 0 }; });

  const keep = Object.values(pointers).map((p) => p.id);
  const merged = mergeHistory(others, local, { cap, keep }).steps;
  const order = merged.map((s) => s.id);
  const inMerged = new Set(order);

  const puts = merged
    .filter((s) => localIds.has(s.id) && (wiped || changed.has(s.id) || !stored.has(s.id)))
    .map((s) => [s.id, s]);
  const deletes = keys.filter((key) => key !== HISTORY_META && !inMerged.has(key));
  return {
    puts,
    deletes,
    meta: { order, pointers },
    result: { order, added: merged.filter((s) => !localIds.has(s.id)), grew: puts.some(([id]) => !stored.has(id)) },
  };
}

/**
 * Orders loaded step records: the stored order first, then any record the
 * order doesn't list (an older build could leave a tab's steps out of it),
 * slotted in by time, so they come back instead of staying hidden.
 */
function orderLoaded(meta, entries) {
  const byId = new Map();
  for (const [key, r] of entries) if (isStepRecord(r, key)) byId.set(r.id, r);
  const listed = Array.isArray(meta?.order) ? meta.order.map((id) => byId.get(id)).filter(Boolean) : [];
  const inList = new Set(listed);
  const rest = [...byId.values()].filter((r) => !inList.has(r)).sort((a, b) => timeOf(a) - timeOf(b));
  return mergeHistory(rest, listed, { cap: Infinity }).steps;
}

function promised(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

function openIndexedDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      // Out-of-line keys: every record is written with an explicit key.
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    let settled = false;
    request.onsuccess = () => {
      const db = request.result;
      // Gave up on it already (blocked): don't hold a connection nobody uses.
      if (settled) { db.close(); return; }
      settled = true;
      // A newer version in another tab must not wait for this one to close.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => { settled = true; reject(request.error); };
    request.onblocked = () => { settled = true; reject(new Error('IndexedDB blocked')); };
  });
}

function memoryBackend() {
  const maps = Object.fromEntries(STORES.map((name) => [name, new Map()]));
  return {
    persistent: false,
    async get(store, key) { return maps[store].get(key); },
    async put(store, key, value) { maps[store].set(key, value); },
    async delete(store, key) { maps[store].delete(key); },
    async all(store) { return [...maps[store].values()]; },
    async loadHistory() {
      const map = maps.history;
      return { meta: map.get(HISTORY_META), entries: [...map.entries()] };
    },
    async saveHistory(save) {
      const map = maps.history;
      const keys = [...map.keys()].filter((k) => k !== HISTORY_META);
      const known = new Set(save.steps.map((s) => s.id));
      const records = new Map(keys.filter((k) => !known.has(k)).map((k) => [k, map.get(k)]));
      const plan = planHistorySave({ meta: map.get(HISTORY_META), keys, records }, save);
      // Copies, as IndexedDB would store them: a later edit in memory must not leak in.
      for (const [key, value] of plan.puts) map.set(key, { ...value });
      for (const key of plan.deletes) map.delete(key);
      map.set(HISTORY_META, plan.meta);
      return plan.result;
    },
  };
}

function idbBackend(db) {
  return {
    persistent: true,
    async get(store, key) {
      return promised(db.transaction(store).objectStore(store).get(key));
    },
    async put(store, key, value) {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      return done(tx);
    },
    async delete(store, key) {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      return done(tx);
    },
    async all(store) {
      return promised(db.transaction(store).objectStore(store).getAll());
    },
    async loadHistory() {
      const os = db.transaction('history').objectStore('history');
      // Both come in key order, so they pair up.
      const [meta, keys, records] = await Promise.all([promised(os.get(HISTORY_META)), promised(os.getAllKeys()), promised(os.getAll())]);
      return { meta, entries: keys.map((key, i) => [key, records[i]]) };
    },
    // One readwrite transaction from read to write, so no other tab can save
    // in between. Plain request callbacks (no awaits) keep it alive throughout.
    saveHistory(save) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('history', 'readwrite');
        const os = tx.objectStore('history');
        let result = null;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
        const metaRequest = os.get(HISTORY_META);
        const keysRequest = os.getAllKeys();
        // Requests in one transaction finish in order: meta is in by now.
        keysRequest.onsuccess = () => {
          const keys = keysRequest.result.filter((k) => k !== HISTORY_META);
          const known = new Set(save.steps.map((s) => s.id));
          // Only the records this tab doesn't have are read: other tabs' new steps.
          const wanted = keys.filter((k) => !known.has(k));
          const records = new Map();
          const write = () => {
            // A throw here aborts the transaction, so nothing is half written.
            const plan = planHistorySave({ meta: metaRequest.result, keys, records }, save);
            for (const [key, value] of plan.puts) os.put(value, key);
            for (const key of plan.deletes) os.delete(key);
            os.put(plan.meta, HISTORY_META);
            result = plan.result;
          };
          let pending = wanted.length;
          if (pending === 0) { write(); return; }
          for (const key of wanted) {
            const request = os.get(key);
            request.onsuccess = () => {
              records.set(key, request.result);
              pending -= 1;
              if (pending === 0) write();
            };
          }
        };
      });
    },
  };
}

/**
 * Opens the v2 database, falling back to memory when IndexedDB is unavailable.
 * Never rejects. Asks once for persistent storage, so the browser is less
 * likely to clear saved designs.
 * @returns {Promise<Db>}
 */
export async function openDb() {
  let backend;
  try {
    backend = idbBackend(await openIndexedDb());
  } catch (err) {
    console.info('[db] IndexedDB unavailable, keeping everything in memory:', err?.message || err);
    backend = memoryBackend();
  }
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch { /* not supported */ }

  // A failing write (quota, a closed connection) must never break the app:
  // log it and carry on in memory terms.
  const safe = (fn, fallback) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.warn('[db]', err?.message || err);
      return fallback;
    }
  };

  return {
    get persistent() { return backend.persistent; },
    get: safe(backend.get, undefined),
    // true once written, false when the write failed (quota, a closed connection).
    put: safe(async (...args) => { await backend.put(...args); return true; }, false),
    delete: safe(backend.delete, undefined),
    all: safe(backend.all, []),

    // Unreadable records are skipped. The pointer is the newest step: "Last
    // design" on the next visit is the newest step any tab made (design §8.4).
    loadHistory: safe(async () => {
      const { meta, entries } = await backend.loadHistory();
      const steps = orderLoaded(meta, entries || []);
      return steps.length ? { steps, pointer: steps.length - 1 } : null;
    }, null),

    saveHistory: safe((save) => backend.saveHistory(save), false),
  };
}
