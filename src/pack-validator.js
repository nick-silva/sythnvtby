/**
 * Pack validator: verify .vbcolor format and optionally report coverage vs a VIP dump.
 */

import { parseVBColorPack } from './vbcolor-pack.js';
import { extractTilesFromDump } from './tile-extractor.js';

/**
 * Validate .vbcolor buffer and return result.
 *
 * @param {ArrayBuffer} packBuffer
 * @returns {{ valid: boolean, gameId?: string, entryCount?: number, error?: string }}
 */
export function validatePack(packBuffer) {
  const pack = parseVBColorPack(packBuffer);
  if (!pack) return { valid: false, error: 'Invalid or unsupported .vbcolor format' };
  return {
    valid: true,
    gameId: pack.gameId,
    entryCount: pack.entries.size,
  };
}

/**
 * Compute coverage: how many tiles from the dump have a colorized entry in the pack.
 *
 * @param {ArrayBuffer} packBuffer
 * @param {Object} dumpObj - VIP dump (JSON object or deserialized)
 * @returns {{ valid: boolean, gameId: string, entryCount: number, tilesInDump: number, tilesCovered: number, coveragePercent: number }}
 */
export function coverageReport(packBuffer, dumpObj) {
  const pack = parseVBColorPack(packBuffer);
  if (!pack) return { valid: false, entryCount: 0, tilesInDump: 0, tilesCovered: 0, coveragePercent: 0 };
  const { tiles } = extractTilesFromDump(dumpObj);
  let covered = 0;
  for (const hash of tiles.keys()) {
    if (pack.entries.has(hash)) covered++;
  }
  const total = tiles.size;
  return {
    valid: true,
    gameId: pack.gameId,
    entryCount: pack.entries.size,
    tilesInDump: total,
    tilesCovered: covered,
    coveragePercent: total ? Math.round((covered / total) * 100) : 0,
  };
}
