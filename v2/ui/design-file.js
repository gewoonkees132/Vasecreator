// Design files (`<name>.vasecreator.json`, ARCHITECTURE.md "Phase 2
// contracts"): the design JSON plus, under a top-level "images", the pixels
// of every image it references, so a file opens the same on another device.
// History steps and saved tiles never carry pixels; only files do.

import { imageHashes, loadImage, saveImage } from '../store/assets.js';

/** Image pixels a file may bring in, decoded (a raster is at most 512 × 512). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** The largest file worth reading: 8 MB of pixels in base64 plus the design. */
export const FILE_MAX_BYTES = 12 * 1024 * 1024;

const HASH = /^[0-9a-f]{16}$/;

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * The text of a design file: the design with the pixels of its referenced
 * images. An image this browser no longer has is left out (it opens plain).
 * @param {object} design
 * @returns {Promise<string>}
 */
export async function designFileText(design) {
  const images = {};
  for (const hash of imageHashes(design)) {
    const r = await loadImage(hash);
    if (r) images[hash] = { width: r.width, height: r.height, data: toBase64(r.data) };
  }
  const file = Object.keys(images).length ? { ...design, images } : design;
  return JSON.stringify(file, null, 2);
}

/** @returns {Promise<Blob>} application/json */
export async function designFileBlob(design) {
  return new Blob([await designFileText(design)], { type: 'application/json' });
}

/**
 * Stores the images a parsed design file carries (saveImage) and returns the
 * JSON without them, ready for normaliseDesign. Bad or oversized entries are
 * skipped; the design then shows those patterns plain.
 * @param {object} json
 * @returns {Promise<object>}
 */
export async function takeFileImages(json) {
  if (!json || typeof json !== 'object' || !('images' in json)) return json;
  const { images, ...design } = json;
  if (!images || typeof images !== 'object') return design;
  const names = new Map();
  for (const [id, a] of Object.entries(design.assets && typeof design.assets === 'object' ? design.assets : {})) {
    if (a?.kind === 'image') names.set(a.hash || id.slice(4), a.name);
  }
  let total = 0;
  for (const [hash, img] of Object.entries(images)) {
    try {
      if (!HASH.test(hash) || !img || typeof img.data !== 'string') continue;
      const { width, height } = img;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 512 || height > 512) continue;
      total += width * height;
      if (total > MAX_IMAGE_BYTES) break;
      const data = fromBase64(img.data);
      if (data.length !== width * height) continue;
      const stored = await saveImage({ width, height, data }, names.get(hash) || '');
      if (stored !== hash) console.warn('[design file] image hash differs from its key', hash, stored);
    } catch (err) {
      console.warn('[design file] skipped an image', err);
    }
  }
  return design;
}
