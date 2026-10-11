/**
 * VIP world (window) clip rectangles for BG/Affine draws — matches Beetle `VIP_DrawBlock` +
 * `DrawBG` / `DrawAffine` horizontal and vertical bounds (`mednafen/vb/vip_draw.inc`).
 *
 * Object worlds (`bgm === 3`) do not use this rectangle in the core (`DrawOBJ` has no DestX
 * clip), so we return null and let sprites paint the full tile.
 */

const FRAME_W = 384;
const FRAME_H = 224;

/** Avoid decoding `windowsBase64` and allocating 1 KiB every frame when unchanged. */
let _windowsBase64CacheKey = '';
/** @type {Uint8Array | null} */
let _windowsBase64CacheU8 = null;

function readU16(windows, byteOff) {
  return windows[byteOff] | (windows[byteOff + 1] << 8);
}

/** @param {number} w raw 16-bit word (11-bit magnitude in low bits) */
function sign11(w) {
  const v = w & 0x7ff;
  return v >= 0x400 ? v - 0x800 : v;
}

/** @param {number} w raw 16-bit word (9-bit magnitude in low bits) */
function sign9(w) {
  const v = w & 0x1ff;
  return v >= 0x100 ? v - 0x200 : v;
}

/**
 * @typedef {{ x0: number, x1: number, y0: number, y1: number }} WorldClipRect Inclusive pixel bounds.
 */

/**
 * @param {Uint8Array} windows - 1024 bytes (32 × 32-byte VIP world records)
 * @param {number} worldIdx - 0..31
 * @param {number} eye - 0 left, 1 right (parallax uses gx ± gp like DrawBG)
 * @returns {WorldClipRect | null} null = no clip (OBJ world or invalid); empty draw if x0 > x1
 */
export function getBgAffineWorldClipRect(windows, worldIdx, eye) {
  if (!windows || worldIdx === undefined || worldIdx === null) return null;
  const idx = worldIdx | 0;
  if (idx < 0 || idx > 31) return null;
  const base = idx * 32;
  if (base + 32 > windows.length) return null;

  const w0 = readU16(windows, base);
  if (w0 & 0x40) return null;
  const bgm = (w0 >> 12) & 3;
  if (bgm === 3) return null;

  const gx = sign11(readU16(windows, base + 2));
  const gp = sign9(readU16(windows, base + 4));
  const gy = sign11(readU16(windows, base + 6));
  const destW = sign11(readU16(windows, base + 14));
  const destH = readU16(windows, base + 16) & 0x3ff;

  const lr = eye & 1;
  const destX = gx + (lr ? gp : -gp);
  const destY = gy;

  let startX = destX;
  let finalX = destX + destW;
  if (startX < 0) startX = 0;
  if (finalX > FRAME_W - 1) finalX = FRAME_W - 1;
  if (startX > finalX) return { x0: 1, x1: 0, y0: 0, y1: -1 };

  let y0 = 0;
  let y1 = FRAME_H - 1;
  if (destH > 0) {
    y0 = destY;
    y1 = destY + destH;
    if (y0 < 0) y0 = 0;
    if (y1 > FRAME_H - 1) y1 = FRAME_H - 1;
    if (y0 > y1) return { x0: 1, x1: 0, y0: 0, y1: -1 };
  }

  return { x0: startX, x1: finalX, y0, y1 };
}

/**
 * @param {import('./vip-state.js').VIPState & { windowsBase64?: string }} state
 * @returns {Uint8Array | null}
 */
export function getWindowsTableBytesFromState(state) {
  if (!state) return null;
  const w = state.windows;
  if (w instanceof Uint8Array && w.byteLength >= 1024) return w.subarray(0, 1024);
  if (Array.isArray(w) && w.length >= 1024) return Uint8Array.from(w.slice(0, 1024));
  if (ArrayBuffer.isView(w) && w.byteLength >= 1024) {
    return new Uint8Array(w.buffer, w.byteOffset, 1024);
  }
  const b64 = state.windowsBase64;
  if (typeof b64 !== 'string' || b64.length < 8) return null;
  if (b64 === _windowsBase64CacheKey && _windowsBase64CacheU8) return _windowsBase64CacheU8;
  try {
    const bin = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    if (bin.length < 1024) return null;
    const u8 = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) u8[i] = bin.charCodeAt(i);
    _windowsBase64CacheKey = b64;
    _windowsBase64CacheU8 = u8;
    return u8;
  } catch (_) {
    return null;
  }
}
