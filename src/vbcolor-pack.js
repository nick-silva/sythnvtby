/**
 * .vbcolor pack format: parse and lookup.
 * Format: magic "VBCL", version, gameId len + utf8, num entries, then per entry: hash (4) + RGBA (256).
 */

const MAGIC = new Uint8Array([0x56, 0x42, 0x43, 0x4c]); // VBCL

/**
 * Parse a .vbcolor pack from ArrayBuffer.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ gameId: string, entries: Map<number, Uint8Array> } | null}
 */
export function parseVBColorPack(buffer) {
  if (!buffer || buffer.byteLength < 12) return null;
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < 4; i++) {
    if (u8[i] !== MAGIC[i]) return null;
  }
  const view = new DataView(buffer);
  const version = view.getUint16(4, true);
  if (version !== 1) return null;
  const gameIdLen = view.getUint16(6, true);
  if (gameIdLen > 255 || 8 + gameIdLen > buffer.byteLength) return null;
  const gameId = new TextDecoder().decode(u8.subarray(8, 8 + gameIdLen));
  const numEntries = view.getUint32(8 + gameIdLen, true);
  const entries = new Map();
  let offset = 12 + gameIdLen;
  const entrySize = 4 + 256;
  for (let i = 0; i < numEntries && offset + entrySize <= buffer.byteLength; i++) {
    const hash = view.getUint32(offset, true);
    offset += 4;
    const rgba = new Uint8Array(buffer, offset, 256);
    entries.set(hash, rgba);
    offset += 256;
  }
  return { gameId, entries };
}

/**
 * Build a .vbcolor pack from gameId and hash -> RGBA map (RGBA is 256 bytes per tile).
 *
 * @param {string} gameId
 * @param {Map<number, Uint8Array>} entries - hash -> 256-byte RGBA
 * @returns {ArrayBuffer}
 */
export function buildVBColorPack(gameId, entries) {
  const gameIdBytes = new TextEncoder().encode(gameId);
  if (gameIdBytes.length > 255) throw new Error('gameId too long');
  const size = 12 + gameIdBytes.length + entries.size * (4 + 256);
  const buffer = new ArrayBuffer(size);
  const u8 = new Uint8Array(buffer);
  const view = new DataView(buffer);
  u8.set(MAGIC, 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, gameIdBytes.length, true);
  u8.set(gameIdBytes, 8);
  view.setUint32(8 + gameIdBytes.length, entries.size, true);
  let offset = 12 + gameIdBytes.length;
  for (const [hash, rgba] of entries) {
    view.setUint32(offset, hash >>> 0, true);
    offset += 4;
    u8.set(rgba.subarray(0, 256), offset);
    offset += 256;
  }
  return buffer;
}
