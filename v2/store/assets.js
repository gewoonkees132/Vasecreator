// Browser storage for phase 2 assets (ARCHITECTURE.md, "Phase 2 contracts"):
// greyscale image rasters by hash (IndexedDB store 'images') and "My
// patterns", the Patterns and Detailed morph swatches saved apart from any
// design, each with its settings (pattern studio D48; store 'patterns').
// Designs only carry references (`img:<hash>`); the pixels live here, and in
// design files (ui/design-file.js).
//
// Uses the app's database when main.js hands it over (useDb), else opens it
// itself. openDb() falls back to memory without IndexedDB, so this does too.

import { openDb } from './db.js';
import { hashRaster } from '../core/raster.js';
import { validateRecipe } from '../core/patterns.js';
import { LIMITS } from '../core/design.js';
import { DEFAULT_POINTS, DENSITY_FACES, FADE_SHAPES } from '../core/layer-pattern.js';

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

/// ---------- My patterns (pattern studio D48, §3.9, §9) ----------
//
// One entry is one saved setup, apart from any design:
//   { id: 'saved:…', kind: 'pattern' | 'detail', name, drawing, settings, created, updated }
// `drawing` is a `bitmap` recipe (crisp for a Pattern, with edges for a
// Detailed morph grid). `settings` is what applying it sets besides the
// drawing: for a Pattern { depthMm, density: { by, spacingMm, points },
// fade: { shape, amount }, softenCells } (never From / To, which depend on
// the pot's height), for a Detailed morph { depthMm, repeats, tileHeightMm }.
// A design that uses one keeps its own copy of the drawing in design.assets.
// Records of any other shape (the old { id, name, recipe }) are ignored (D50).

/** The two kinds of saved entry: the Pattern's, and the Detailed morph's. */
export const SAVED_KINDS = Object.freeze(['pattern', 'detail']);
/** The name an entry without one gets. */
export const SAVED_NAMES = Object.freeze({ pattern: 'My pattern', detail: 'My swatch' });
// What fills a missing setting: a starter's depth and density on the default
// bead (core/layer-pattern.js), and a swatch of your own (USER_SLOT).
const FALLBACK = Object.freeze({
  pattern: { depthMm: 0.42, spacingMm: 3, points: DEFAULT_POINTS },
  detail: { depthMm: 1.5, repeats: 8, tileHeightMm: 20 },
});

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function num(v, fallback, { min, max }, whole = false) {
  let x = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  if (whole) x = Math.round(x);
  return Math.min(Math.max(x, min), max);
}
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

/**
 * One of My patterns as it comes back from storage, checked and clamped, or
 * null when it isn't one (another shape, an unknown kind, a drawing that
 * isn't a valid bitmap). A Pattern's drawing loses `edges` (it is always
 * crisp, D53); a Detailed morph grid's gets 'soft' when it has none.
 * @param {unknown} raw
 * @returns {null | { id: string, kind: 'pattern' | 'detail', name: string, drawing: object, settings: object, created: number, updated: number }}
 */
export function normaliseSavedPattern(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 80) return null;
  const kind = raw.kind;
  if (!SAVED_KINDS.includes(kind) || !isObject(raw.drawing) || raw.drawing.kind !== 'bitmap') return null;
  const { columns, rows, cells, edges } = raw.drawing;
  const drawing = { kind: 'bitmap', columns, rows, cells };
  if (kind === 'detail') drawing.edges = edges ?? 'soft';
  try {
    validateRecipe(drawing);
  } catch {
    return null;
  }
  const s = isObject(raw.settings) ? raw.settings : {};
  const F = FALLBACK[kind];
  let settings;
  if (kind === 'pattern') {
    const density = isObject(s.density) ? s.density : {};
    const fade = isObject(s.fade) ? s.fade : {};
    settings = {
      depthMm: num(s.depthMm, F.depthMm, LIMITS.patternDepthMm),
      density: {
        by: oneOf(density.by, DENSITY_FACES, 'spacing'),
        spacingMm: num(density.spacingMm, F.spacingMm, LIMITS.spacingMm),
        points: num(density.points, F.points, LIMITS.points, true),
      },
      fade: { shape: oneOf(fade.shape, FADE_SHAPES, 'even'), amount: num(fade.amount, 1, LIMITS.amount) },
      softenCells: num(s.softenCells, 0, LIMITS.softenCells),
    };
  } else {
    settings = {
      depthMm: num(s.depthMm, F.depthMm, LIMITS.depthMm),
      repeats: num(s.repeats, F.repeats, LIMITS.repeats, true),
      tileHeightMm: num(s.tileHeightMm, F.tileHeightMm, LIMITS.tileHeightMm),
    };
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : SAVED_NAMES[kind];
  const time = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { id: raw.id, kind, name, drawing, settings, created: time(raw.created), updated: time(raw.updated) };
}

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

const newSavedId = () => `saved:${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')}`;

/**
 * My patterns, oldest first: every kind, or one.
 * @param {'pattern' | 'detail'} [kind]
 * @returns {Promise<NonNullable<ReturnType<typeof normaliseSavedPattern>>[]>}
 */
export async function listPatterns(kind) {
  const db = await getDb();
  const all = await db.all('patterns');
  return (Array.isArray(all) ? all : [])
    .map(normaliseSavedPattern)
    .filter((p) => p && (!kind || p.kind === kind))
    .sort((a, b) => a.created - b.created);
}

/**
 * Adds one of My patterns, or replaces the one with this id (keeping when it
 * was first saved). A missing id gets a new 'saved:' id.
 * @param {{ id?: string, kind: 'pattern' | 'detail', name: string, drawing: object, settings: object }} entry
 * @returns {Promise<ReturnType<typeof normaliseSavedPattern>>} the entry as stored; null when the browser didn't store it
 */
export async function savePattern({ id, kind, name, drawing, settings } = {}) {
  const key = typeof id === 'string' && id ? id : newSavedId();
  const now = Date.now();
  const check = normaliseSavedPattern({ id: key, kind, name, drawing, settings, created: now, updated: now });
  if (!check) throw new TypeError('Not a pattern to save');
  const db = await getDb();
  const prior = normaliseSavedPattern(await db.get('patterns', key));
  const entry = { ...check, created: prior?.created || now };
  const ok = await db.put('patterns', key, entry);
  if (ok === false) return null;
  changed();
  return entry;
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
