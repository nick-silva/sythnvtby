/**
 * Browser side of layer art (src/layer-art.js): PNG ⇄ pixels, importing any image at the
 * layer's size, and the clipboard. Kept apart from layer-art.js so that stays pure and testable.
 */

import { setLayerArtDecoder } from './layer-art.js';

/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} Pixels */

/** @param {Uint8Array} u8 */
export function base64FromBytes(u8) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) s += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  return btoa(s);
}

/** @param {string} b64 */
export function bytesFromBase64(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** @param {number} w @param {number} h */
function scratchCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Draw an image into a width×height buffer. Same size: copied as is. Otherwise scaled to fill
 * it exactly, nearest-neighbour so pixel art stays crisp.
 * @param {ImageBitmap} bmp @param {number} [width] @param {number} [height]
 * @returns {Pixels}
 */
function bitmapToPixels(bmp, width = bmp.width, height = bmp.height) {
  const c = scratchCanvas(width, height);
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  return { width, height, data: img.data };
}

/** @param {string} b64 base64 PNG @returns {Promise<Pixels>} */
export async function decodePngBase64(b64) {
  const bmp = await createImageBitmap(new Blob([bytesFromBase64(b64)], { type: 'image/png' }));
  try {
    return bitmapToPixels(bmp);
  } finally {
    bmp.close?.();
  }
}

/** @param {Pixels} px @returns {Promise<Blob>} */
export async function pixelsToPngBlob(px) {
  const c = scratchCanvas(px.width, px.height);
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) =>
    /** @type {HTMLCanvasElement} */ (c).toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}

/** @param {Pixels} px @returns {Promise<string>} base64 PNG */
export async function encodePngBase64(px) {
  const blob = await pixelsToPngBlob(px);
  return base64FromBytes(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Any image (file, clipboard blob) as pixels at the layer's size.
 * @param {Blob} blob
 * @param {number} width @param {number} height
 * @returns {Promise<{ pixels: Pixels, sourceWidth: number, sourceHeight: number }>}
 */
export async function imageBlobToPixels(blob, width, height) {
  const bmp = await createImageBitmap(blob);
  try {
    return { pixels: bitmapToPixels(bmp, width, height), sourceWidth: bmp.width, sourceHeight: bmp.height };
  } finally {
    bmp.close?.();
  }
}

/**
 * The first image on the clipboard, via the async Clipboard API (asks for permission).
 * @returns {Promise<Blob | null>}
 */
export async function readClipboardImage() {
  if (!navigator.clipboard?.read) return null;
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return item.getType(type);
  }
  return null;
}

/** The image in a paste event, if any. @param {ClipboardEvent} e @returns {Blob | null} */
export function imageFromPasteEvent(e) {
  for (const item of e.clipboardData?.items || []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}

/** Put pixels on the clipboard as a PNG. @param {Pixels} px */
export async function writeClipboardImage(px) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('This browser cannot copy images.');
  const blob = await pixelsToPngBlob(px);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Let the renderer decode saved layer art in this page. */
export function installLayerArtDecoder() {
  setLayerArtDecoder(decodePngBase64);
}
