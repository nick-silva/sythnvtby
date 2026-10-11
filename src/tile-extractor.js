/**
 * Tile extractor: from VIP dump (or raw pattern table), extract unique 8×8 tiles and assign content hashes.
 */

import { BYTES_PER_TILE, hashTile, getTileBytes } from './vip-state.js';
import { deserializeVIPState } from './vip-dump.js';

/**
 * Extract all unique tiles from a pattern table (32KB). Returns map hash -> 16-byte tile data.
 *
 * @param {Uint8Array} patternTable
 * @returns {Map<number, Uint8Array>}
 */
export function extractTilesFromPatternTable(patternTable) {
  const map = new Map();
  const numTiles = Math.floor(patternTable.length / BYTES_PER_TILE);
  for (let i = 0; i < numTiles; i++) {
    const tile = getTileBytes(patternTable, i);
    const hash = hashTile(tile);
    if (!map.has(hash)) map.set(hash, tile.slice());
  }
  return map;
}

/**
 * Extract tiles from a VIP dump (JSON object from deserializeVIPState or manifest).
 *
 * @param {Object} dumpObj - Object with patternTableBase64 (or already deserialized with patternTable)
 * @returns {{ tiles: Map<number, Uint8Array>, dump: { patternTable: Uint8Array, oam: Uint8Array, segments: Uint8Array[], windows: Uint8Array } }}
 */
export function extractTilesFromDump(dumpObj) {
  const dump = dumpObj.patternTable
    ? dumpObj
    : deserializeVIPState(dumpObj);
  const tiles = extractTilesFromPatternTable(dump.patternTable);
  return { tiles, dump };
}

/**
 * Export tile set to a JSON manifest: { version, tiles: [ { hash, dataBase64 }, ... ] }.
 *
 * @param {Map<number, Uint8Array>} tiles
 * @returns {Object}
 */
export function exportTileManifest(tiles) {
  const b64 = (u8) => {
    let b = '';
    for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
    return typeof btoa !== 'undefined' ? btoa(b) : Buffer.from(u8).toString('base64');
  };
  const list = [];
  for (const [hash, data] of tiles) {
    list.push({ hash: hash >>> 0, dataBase64: b64(data) });
  }
  return { version: 1, tiles: list };
}
