/**
 * Reading VBoy Color's colour packs (`.vbcp`, github.com/yuk27/VBoyColor, GPL-3.0): painted colours
 * per 8×8 tile, keyed by the tile's FNV-1a hash — the same hash as ours (src/vip-state.js
 * hashTile), so a tile in their pack is the same tile in ours. Layout (their
 * core/emu/TileColorPack.cpp Serialize/Deserialize), all little-endian:
 *
 *   "VBGOCP03" (or …02, …01), tile count, per tile: hash u32, mask u64, 64 × RGB
 *   v2+: per-layer variants: count, (hash u32, world u32, mask, 64 × RGB) each;
 *        pixels left uncoloured on purpose: count, (hash u32, mask u64) each
 *   v3:  per-palette variants: count, (hash u32, palette u32, mask, 64 × RGB) each;
 *        map cells: count, (cell u16, palette u16, hash u32, mask u64, keep u64, 64 × RGB) each;
 *        reference brightness u32
 *   optional blocks: "VBGOCTX1" context (character) variants, "VBGOCTXL"/"VBGOCTXW" layer-bound
 *   groups, "VBGOAMB1" ambiguous tiles, "VBGOEYT1" right-eye tiles; footer "VBGOROM1" CRC-32, size
 *
 * A mask bit (y * 8 + x) marks a painted pixel — the same pixel order as our 256-byte tile paint.
 */

const MAGIC = { VBGOCP03: 3, VBGOCP02: 2, VBGOCP01: 1 };
const TILE_BYTES = 8 + 64 * 3;
const CELL_BYTES = 2 + 2 + 4 + 8 + 8 + 64 * 3;

/**
 * @typedef {{ mask: bigint, rgb: Uint8Array }} VbcpTile 64 × RGB, painted where the mask bit is set
 * @typedef {{
 *   version: number,
 *   tiles: Map<number, VbcpTile>,
 *   layerTiles: Array<{ hash: number, world: number, tile: VbcpTile }>,
 *   leftUncoloured: Map<number, bigint>,
 *   paletteTiles: Array<{ hash: number, palette: number, tile: VbcpTile }>,
 *   cellTiles: Array<{ cell: number, palette: number, hash: number, mask: bigint, keep: bigint, rgb: Uint8Array }>,
 *   referenceLevel: number,
 *   contextGroups: number[][],
 *   contextTiles: Array<{ hash: number, group: number, tile: VbcpTile }>,
 *   ambiguous: number[],
 *   rom: { crc: number, size: number } | null,
 * }} Vbcp
 */

/**
 * Parse a `.vbcp` file. Throws on a file that is not one, or is cut short in its main part; an
 * optional block that is damaged is left out, as their reader does.
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {Vbcp}
 */
export function parseVbcp(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at) => String.fromCharCode(...bytes.subarray(at, at + 8));
  if (bytes.length < 12) throw new Error('Not a VBoy Color pack: too short.');
  const version = MAGIC[tag(0)];
  if (!version) throw new Error('Not a VBoy Color pack (.vbcp): its first bytes are not VBGOCP01–03.');
  let off = 8;
  const have = (n) => off + n <= bytes.length;
  const need = (n, what) => {
    if (!have(n)) throw new Error(`The pack is cut short in its ${what}.`);
  };
  const u32 = () => {
    const v = view.getUint32(off, true);
    off += 4;
    return v;
  };
  const u64 = () => {
    const v = view.getBigUint64(off, true);
    off += 8;
    return v;
  };
  const tile = () => {
    const mask = u64();
    const rgb = bytes.slice(off, off + 64 * 3);
    off += 64 * 3;
    return { mask, rgb };
  };

  const out = /** @type {Vbcp} */ ({
    version,
    tiles: new Map(),
    layerTiles: [],
    leftUncoloured: new Map(),
    paletteTiles: [],
    cellTiles: [],
    referenceLevel: 63,
    contextGroups: [],
    contextTiles: [],
    ambiguous: [],
    rom: null,
  });

  need(4, 'tile list');
  const count = u32();
  need(count * (4 + TILE_BYTES), 'tile list');
  for (let i = 0; i < count; i++) {
    const hash = u32();
    out.tiles.set(hash, tile());
  }
  const variants = (into, keyName, what) => {
    need(4, what);
    const n = u32();
    need(n * (8 + TILE_BYTES), what);
    for (let i = 0; i < n; i++) {
      const hash = u32();
      const key = u32();
      into.push({ hash, [keyName]: key, tile: tile() });
    }
  };
  if (version >= 2 && have(4)) {
    variants(out.layerTiles, 'world', 'layer colours');
    if (have(4)) {
      const n = u32();
      need(n * 12, 'uncoloured pixels');
      for (let i = 0; i < n; i++) {
        const hash = u32();
        out.leftUncoloured.set(hash, u64());
      }
    }
  }
  if (version >= 3) {
    variants(out.paletteTiles, 'palette', 'palette colours');
    need(4, 'map cells');
    const cells = u32();
    need(cells * CELL_BYTES, 'map cells');
    for (let i = 0; i < cells; i++) {
      const cell = view.getUint16(off, true);
      const palette = view.getUint16(off + 2, true) & 3;
      off += 4;
      const hash = u32();
      const mask = u64();
      const keep = u64();
      const rgb = bytes.slice(off, off + 64 * 3);
      off += 64 * 3;
      out.cellTiles.push({ cell, palette, hash, mask, keep, rgb });
    }
    if (have(4)) out.referenceLevel = Math.min(63, Math.max(1, u32()));
    off = readContexts(out, bytes, view, off);
    if (have(12) && tag(off) === 'VBGOAMB1') {
      const n = view.getUint32(off + 8, true);
      off += 12;
      for (let i = 0; i < n && have(4); i++) out.ambiguous.push(u32());
    }
  }
  if (bytes.length >= 28 && tag(bytes.length - 16) === 'VBGOROM1') {
    out.rom = { crc: view.getUint32(bytes.length - 8, true), size: view.getUint32(bytes.length - 4, true) };
  }
  return out;
}

/**
 * The optional context block at `start`; a damaged one is dropped whole.
 * @returns {number} where reading goes on
 */
function readContexts(out, bytes, view, start) {
  let off = start;
  const tag = (at) => String.fromCharCode(...bytes.subarray(at, at + 8));
  if (off + 12 > bytes.length || tag(off) !== 'VBGOCTX1') return start;
  off += 8;
  const ok = (n) => off + n <= bytes.length;
  const groups = [];
  const groupCount = view.getUint32(off, true);
  off += 4;
  for (let g = 0; g < groupCount; g++) {
    if (!ok(4)) return start;
    const n = view.getUint32(off, true);
    off += 4;
    if (!ok(n * 4)) return start;
    const markers = [];
    for (let i = 0; i < n; i++, off += 4) markers.push(view.getUint32(off, true));
    groups.push(markers);
  }
  if (!ok(4)) return start;
  const tileCount = view.getUint32(off, true);
  off += 4;
  if (!ok(tileCount * (8 + TILE_BYTES))) return start;
  const tiles = [];
  for (let i = 0; i < tileCount; i++) {
    const hash = view.getUint32(off, true);
    const group = view.getUint32(off + 4, true);
    const mask = view.getBigUint64(off + 8, true);
    const rgb = bytes.slice(off + 16, off + 16 + 64 * 3);
    off += 8 + TILE_BYTES;
    if (group >= groups.length) return start;
    tiles.push({ hash, group, tile: { mask, rgb } });
  }
  if (ok(16) && tag(off) === 'VBGOCTXL') off += 16;
  else if (ok(8 + 32) && tag(off) === 'VBGOCTXW') off += 8 + 32;
  out.contextGroups = groups;
  out.contextTiles = tiles;
  return off;
}

/**
 * Their tile as our 256-byte tile paint: RGBA per pixel, opaque where they painted it and clear
 * where they did not (which our tools show as not painted).
 * @param {VbcpTile} tile
 * @returns {Uint8Array}
 */
export function vbcpTileToRgba(tile) {
  const out = new Uint8Array(256);
  for (let i = 0; i < 64; i++) {
    if (!((tile.mask >> BigInt(i)) & 1n)) continue;
    out[i * 4] = tile.rgb[i * 3];
    out[i * 4 + 1] = tile.rgb[i * 3 + 1];
    out[i * 4 + 2] = tile.rgb[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Painted pixels in a tile. @param {VbcpTile} tile */
export function vbcpPaintedPixels(tile) {
  let n = 0;
  for (let m = tile.mask; m; m &= m - 1n) n++;
  return n;
}
