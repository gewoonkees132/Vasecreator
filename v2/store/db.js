// IndexedDB for v2: history steps (with their thumbnails), saved designs and
// settings such as the printer profile. No dependency, just small promise
// helpers. When IndexedDB is missing or refuses to open (some private modes),
// the same API keeps working in memory for the session, so the app never
// breaks over storage.

const DB_NAME = 'vasecreator-v2';
const DB_VERSION = 1;
const STORES = ['history', 'designs', 'settings'];

// The history store holds one record per step (key = step id) plus this one
// record with the order and the pointer.
const HISTORY_META = 'meta';

/**
 * @typedef {object} Db
 * @property {boolean} persistent   false when everything lives in memory only
 * @property {(store: string, key: string) => Promise<any>} get
 * @property {(store: string, key: string, value: any) => Promise<void>} put
 * @property {(store: string, key: string) => Promise<void>} delete
 * @property {(store: string) => Promise<any[]>} all
 * @property {() => Promise<{ steps: object[], pointer: number } | null>} loadHistory
 * @property {(change: { put: object[], remove: string[], order: string[], pointer: number }) => Promise<void>} saveHistory
 */

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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function memoryBackend() {
  const maps = Object.fromEntries(STORES.map((name) => [name, new Map()]));
  return {
    persistent: false,
    async get(store, key) { return maps[store].get(key); },
    async put(store, key, value) { maps[store].set(key, value); },
    async delete(store, key) { maps[store].delete(key); },
    async all(store) { return [...maps[store].entries()].map(([, v]) => v); },
    async batch(store, puts, removes) {
      for (const [key, value] of puts) maps[store].set(key, value);
      for (const key of removes) maps[store].delete(key);
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
    async batch(store, puts, removes) {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const [key, value] of puts) os.put(value, key);
      for (const key of removes) os.delete(key);
      return done(tx);
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
    put: safe(backend.put, undefined),
    delete: safe(backend.delete, undefined),
    all: safe(backend.all, []),

    loadHistory: safe(async () => {
      const meta = await backend.get('history', HISTORY_META);
      if (!meta || !Array.isArray(meta.order) || meta.order.length === 0) return null;
      const records = await backend.all('history');
      const byId = new Map(records.filter((r) => r && r.id).map((r) => [r.id, r]));
      const steps = meta.order.map((id) => byId.get(id)).filter(Boolean);
      if (steps.length === 0) return null;
      const pointer = Math.min(Math.max(0, meta.pointer | 0), steps.length - 1);
      return { steps, pointer };
    }, null),

    saveHistory: safe(async ({ put, remove, order, pointer }) => {
      const puts = put.map((step) => [step.id, step]);
      puts.push([HISTORY_META, { order, pointer }]);
      await backend.batch('history', puts, remove);
    }, undefined),
  };
}
