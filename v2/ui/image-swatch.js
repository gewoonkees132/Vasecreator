// Images as swatches (design §9.2, research §6.2–§6.3): a file picked by the
// person becomes an 8-bit greyscale raster (core/raster.js), stored once in the
// browser by its hash (store/assets.js) and sent to the engine. The design
// itself only carries the reference { kind: 'image', name, hash, width, height }.

import { rasterFromRGBA, hashRaster } from '../core/raster.js';
import { saveImage, loadImage, cachedImage } from '../store/assets.js';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_SIDE = 512;

/** The raster for a hash if this tab already has it, else null. */
export function cachedRaster(hash) {
  return cachedImage(hash);
}

/**
 * The raster for a hash, from browser storage. Resolves null when the browser
 * doesn't have it (a design from another device, opened without its file).
 * @param {string} hash
 */
export function getRaster(hash) {
  return loadImage(hash).catch(() => null);
}

/** A plain-language reason the file can't be used, or '' when it can. */
export function fileProblem(file) {
  if (!file) return 'No file was picked.';
  const typeOk = IMAGE_TYPES.includes(file.type) || (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name));
  if (!typeOk) return `${file.name} isn't a PNG, JPEG or WebP image.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name} is over 20 MB. Pick a smaller image.`;
  return '';
}

function canvasOf(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Decodes an image file into a greyscale raster at most 512 px on the long side.
 * Throws an Error with a plain message when the file can't be used.
 * @param {File} file
 * @returns {Promise<{ width: number, height: number, data: Uint8Array }>}
 */
export async function decodeImage(file) {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  let bitmap;
  try {
    // Raw pixels: no premultiplying (keeps the colour under transparent parts)
    // and no colour profile conversion (luminance is computed from sRGB).
    bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    throw new Error(`${file.name} couldn't be opened as an image.`);
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = canvasOf(w, h);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, 0, 0, w, h);
    const { data } = g.getImageData(0, 0, w, h);
    return rasterFromRGBA(data, w, h, MAX_SIDE);
  } finally {
    bitmap.close?.();
  }
}

/**
 * Turns a picked file into an image asset: decodes it, stores the pixels in
 * the browser and hands them to the engine before the design refers to them.
 * @param {{ engine: { setImage(hash: string, raster: object): Promise<void> } }} ctx
 * @param {File} file
 * @returns {Promise<{ id: string, asset: object, raster: object }>}
 */
export async function importImage(ctx, file) {
  const raster = await decodeImage(file);
  const name = String(file.name || 'Image').replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Image';
  let hash = hashRaster(raster);
  try {
    hash = (await saveImage(raster, name)) || hash;
  } catch (err) {
    // The design still works this session; it just won't find the pixels next visit.
    console.warn('Image not saved in the browser', err);
  }
  await ctx.engine.setImage?.(hash, raster);
  const asset = { kind: 'image', name, hash, width: raster.width, height: raster.height };
  return { id: `img:${hash}`, asset, raster };
}
