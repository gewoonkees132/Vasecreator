// Browser storage for phase 2 assets (ARCHITECTURE.md, "Phase 2 contracts"):
// greyscale image rasters by hash (IndexedDB store 'images') and "My
// patterns", the user's own recipe swatches across designs ('patterns').
// Designs only carry references (`img:<hash>`); the pixels live here, and in
// design files (ui/design-file.js).
//
// Uses the app's database when main.js hands it over (useDb), else opens it
// itself. openDb() falls back to memory without IndexedDB, so this does too.

import { openDb } from './db.js';
import { hashRaster } from '../core/raster.js';

let dbPromise = null;
const getDb = () => (dbPromise ??= openDb());

/** Shares the app's open database instead of opening a second connection. */
export function useDb(db) {
  if (db) dbPromise = Promise.resolve(db);
}

// Decoded rasters stay in memory: the worker, the morph previews and the
// swatches all ask for the same few images.
const cache = new Map();   // hash → Raster

const IMAGE_PREFIX = 'img:';

function isRaster(r) {
  return !!r && Number.isInteger(r.width) && Number.isInteger(r.height) && r.width > 0 && r.height > 0
    && r.data instanceof Uint8Array && r.data.length === r.width * r.height;
}

const imageListeners = new Set();
const patternListeners = new Set();
const emit = (set, arg) => { for (const fn of [...set]) { try { fn(arg); } catch (err) { console.warn('[assets]', err); } } };

/**
 * Stores a greyscale raster under its content hash (idempotent: storing the
 * same pixels again keeps the first record). Resolves the hash.
 * @param {{ width: number, height: number, data: Uint8Array }} raster
 * @param {string} [name]
 * @returns {Promise<string>}
 */
export async function saveImage(raster, name = '') {
  if (!isRaster(raster)) throw new TypeError('Not a greyscale raster');
  const hash = hashRaster(raster);
  const record = { width: raster.width, height: raster.height, data: new Uint8Array(raster.data), name: String(name || '').slice(0, 120) };
  if (!cache.has(hash)) cache.set(hash, { width: record.width, height: record.height, data: record.data });
  const db = await getDb();
  const existing = await db.get('images', hash);
  if (!isRaster(existing)) await db.put('images', hash, record);
  emit(imageListeners, hash);
  return hash;
}

/**
 * @param {string} hash  16 hex chars, or an `img:<hash>` asset id
 * @returns {Promise<{ width: number, height: number, data: Uint8Array } | null>}
 */
export async function loadImage(hash) {
  const key = String(hash || '').startsWith(IMAGE_PREFIX) ? hash.slice(IMAGE_PREFIX.length) : hash;
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const db = await getDb();
  const rec = await db.get('images', key);
  if (!isRaster(rec)) return null;
  const raster = { width: rec.width, height: rec.height, data: rec.data };
  cache.set(key, raster);
  return raster;
}

/** The cached raster, without waiting (null until loaded or saved). */
export function cachedImage(hash) {
  return cache.get(hash) ?? null;
}

/** Called with the hash whenever an image is saved. Returns unsubscribe. */
export function onImageSaved(fn) {
  imageListeners.add(fn);
  return () => imageListeners.delete(fn);
}

/**
 * The image hashes a design references: its slots' patterns and its morph
 * map, where they are `img:` assets. Unreferenced assets don't count.
 * @param {object} design
 * @returns {string[]}
 */
export function imageHashes(design) {
  const assets = design?.assets && typeof design.assets === 'object' ? design.assets : {};
  const refs = [design?.form?.detail?.a?.pattern, design?.form?.detail?.b?.pattern, design?.form?.morph?.map];
  const out = new Set();
  for (const ref of refs) {
    if (typeof ref !== 'string' || !ref.startsWith(IMAGE_PREFIX)) continue;
    const hash = typeof assets[ref]?.hash === 'string' && assets[ref].hash ? assets[ref].hash : ref.slice(IMAGE_PREFIX.length);
    if (hash) out.add(hash);
  }
  return [...out];
}

// ---------- My patterns ----------

// Other tabs hear about pattern edits, so their swatch grids refresh too.
let channel = null;
try {
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel('vc2-patterns');
    channel.onmessage = () => emit(patternListeners);
    // Node (the tests) would otherwise stay alive for the channel; browsers have no unref.
    channel.unref?.();
  }
} catch { channel = null; }

function changed() {
  emit(patternListeners);
  try { channel?.postMessage({ type: 'patterns' }); } catch { /* closed */ }
}

const newPatternId = () => `user:${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')}`;

/** @returns {Promise<{ id: string, name: string, recipe: object }[]>} oldest first */
export async function listPatterns() {
  const db = await getDb();
  const all = await db.all('patterns');
  return (Array.isArray(all) ? all : [])
    .filter((p) => p && typeof p.id === 'string' && p.recipe && typeof p.recipe === 'object')
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0))
    .map(({ id, name, recipe }) => ({ id, name: String(name || 'My pattern'), recipe }));
}

/**
 * Adds or replaces one of "My patterns". A missing id gets a new `user:` id.
 * @returns {Promise<{ id: string, name: string, recipe: object } | null>} null when it couldn't be stored
 */
export async function savePattern({ id, name, recipe } = {}) {
  if (!recipe || typeof recipe !== 'object') throw new TypeError('A pattern needs a recipe');
  const db = await getDb();
  const key = typeof id === 'string' && id ? id : newPatternId();
  const prior = await db.get('patterns', key);
  const record = { id: key, name: String(name || 'My pattern').slice(0, 80), recipe: structuredClone(recipe), created: prior?.created ?? Date.now(), updated: Date.now() };
  const ok = await db.put('patterns', key, record);
  if (!ok) return null;
  changed();
  return { id: record.id, name: record.name, recipe: record.recipe };
}

/** Removes one of "My patterns". Designs that use it keep their own copy (design.assets). */
export async function deletePattern(id) {
  const db = await getDb();
  await db.delete('patterns', id);
  changed();
}

/** Called after "My patterns" changed (here or in another tab). Returns unsubscribe. */
export function onPatternsChanged(fn) {
  patternListeners.add(fn);
  return () => patternListeners.delete(fn);
}
