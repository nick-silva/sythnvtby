/**
 * File ▸ Import VBoy Color pack: a `.vbcp` (src/vbcp.js) brought into the open project as a head
 * start. The pack's own tile colours become shared colours (the project's `.vbcolor`) for tiles the
 * project has no shared colours for yet; they apply wherever the game draws the tile, and nothing
 * already painted changes. No groups are made: grouping stays the person's own. Per-layer,
 * per-palette, map-cell and per-character colours are counted, not imported. The import is recorded
 * in the manifest (`vbcpImports`) for credit.
 */
import { parseVBColorPack, buildVBColorPack } from './vbcolor-pack.js';
import { crc32 } from './rom-identity.js';
import { vbcpTileToRgba, vbcpPaintedPixels } from './vbcp.js';

const sharedColours = (parts) => (parts.vbcolor?.byteLength ? parseVBColorPack(parts.vbcolor)?.entries : null) || new Map();

/** What a pack holds beyond its tile colours, which the import leaves out. */
const leftOut = (vbcp) => ({
  layer: vbcp.layerTiles.length,
  palette: vbcp.paletteTiles.length,
  cells: vbcp.cellTiles.length,
  characters: vbcp.contextTiles.length,
});

/**
 * Whether the pack was made for the project's ROM: true / false, or null when either side does
 * not say (an older pack, or a project without its ROM).
 * @param {any} parts @param {import('./vbcp.js').Vbcp} vbcp
 */
export function vbcpRomMatches(parts, vbcp) {
  if (!vbcp.rom || !parts.rom?.byteLength) return null;
  const rom = parts.rom instanceof Uint8Array ? parts.rom : new Uint8Array(parts.rom);
  return rom.length === vbcp.rom.size && crc32(rom) === vbcp.rom.crc.toString(16).padStart(8, '0');
}

/**
 * What an import would bring, for the confirmation.
 * @param {any} parts @param {import('./vbcp.js').Vbcp} vbcp
 */
export function summarizeVbcp(parts, vbcp) {
  const shared = sharedColours(parts);
  let newTiles = 0;
  let pixels = 0;
  for (const [hash, tile] of vbcp.tiles) {
    if (shared.has(hash) || !tile.mask) continue;
    newTiles++;
    pixels += vbcpPaintedPixels(tile);
  }
  return {
    tiles: vbcp.tiles.size,
    newTiles,
    alreadyColoured: vbcp.tiles.size - newTiles,
    pixels,
    skipped: leftOut(vbcp),
    romMatches: vbcpRomMatches(parts, vbcp),
  };
}

/** "179 per-layer, 35 per-palette … tile colour(s)" for what is left out, or '' when nothing is. */
export function describeLeftOut({ layer, palette, cells, characters }) {
  const kinds = [
    [layer, 'per-layer'],
    [palette, 'per-palette'],
    [cells, 'map-cell'],
    [characters, 'per-character'],
  ]
    .filter(([n]) => n)
    .map(([n, what]) => `${n.toLocaleString()} ${what}`);
  return kinds.length ? `${kinds.join(', ')} tile colour(s)` : '';
}

/**
 * The project with the pack's tile colours brought in. `parts` is not changed.
 * @param {any} parts pack parts (src/art-pack.js) @param {import('./vbcp.js').Vbcp} vbcp
 * @param {{ fileName?: string, now?: () => number }} [opts]
 * @returns {{ parts: any, log: string[] }}
 */
export function importVbcp(parts, vbcp, { fileName = 'pack.vbcp', now = Date.now } = {}) {
  const log = [];
  const next = { ...parts };

  const shared = new Map(sharedColours(parts));
  let added = 0;
  for (const [hash, tile] of vbcp.tiles) {
    if (shared.has(hash) || !tile.mask) continue;
    shared.set(hash, vbcpTileToRgba(tile));
    added++;
  }
  if (added) {
    const gameId = (parts.vbcolor?.byteLength && parseVBColorPack(parts.vbcolor)?.gameId) || parts.manifest?.gameId || 'vb-pack';
    next.vbcolor = buildVBColorPack(gameId, shared);
    log.push(`${added.toLocaleString()} tile colour(s) added as shared colours.`);
  } else {
    log.push('Nothing new to bring in: every tile in the pack already has shared colours here.');
  }

  const skipped = describeLeftOut(leftOut(vbcp));
  if (skipped) log.push(`Not brought in: ${skipped}.`);

  next.manifest = {
    ...(parts.manifest || {}),
    vbcpImports: [
      ...(Array.isArray(parts.manifest?.vbcpImports) ? parts.manifest.vbcpImports : []),
      { from: 'VBoy Color (github.com/yuk27/VBoyColor, GPL-3.0)', file: fileName, at: new Date(now()).toISOString(), tilesAdded: added },
    ],
  };
  return { parts: next, log };
}
