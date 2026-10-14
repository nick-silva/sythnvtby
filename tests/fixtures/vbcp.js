/**
 * Synthetic VBoy Color packs (`.vbcp`) for tests: a little-endian writer laid out as their
 * TileColorPack::Serialize writes one (see src/vbcp.js for the layout).
 * Tiles are `{ hash, mask: bigint, rgb: { [pixelIndex]: [r, g, b] } }`.
 */
export function buildVbcp({ version = 3, tiles = [], layers = [], left = [], palettes = [], cells = [], level = 40, contexts = null, rom = null } = {}) {
  const out = [];
  const u8 = (...b) => out.push(...b);
  const u16 = (v) => u8(v & 255, (v >> 8) & 255);
  const u32 = (v) => u8(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const u64 = (v) => {
    for (let i = 0n; i < 8n; i++) u8(Number((BigInt(v) >> (8n * i)) & 255n));
  };
  const tag = (s) => u8(...[...s].map((c) => c.charCodeAt(0)));
  const tile = ({ mask, rgb = {} }) => {
    u64(mask);
    for (let i = 0; i < 64; i++) u8(...(rgb[i] || [0, 0, 0]));
  };
  tag(`VBGOCP0${version}`);
  u32(tiles.length);
  for (const t of tiles) {
    u32(t.hash);
    tile(t);
  }
  if (version >= 2) {
    u32(layers.length);
    for (const l of layers) {
      u32(l.hash);
      u32(l.world);
      tile(l);
    }
    u32(left.length);
    for (const l of left) {
      u32(l.hash);
      u64(l.mask);
    }
  }
  if (version >= 3) {
    u32(palettes.length);
    for (const p of palettes) {
      u32(p.hash);
      u32(p.palette);
      tile(p);
    }
    u32(cells.length);
    for (const c of cells) {
      u16(c.cell);
      u16(c.palette);
      u32(c.hash);
      u64(c.mask);
      u64(c.keep);
      for (let i = 0; i < 64; i++) u8(0, 0, 0);
    }
    u32(level);
    if (contexts) {
      tag('VBGOCTX1');
      u32(contexts.groups.length);
      for (const markers of contexts.groups) {
        u32(markers.length);
        markers.forEach(u32);
      }
      u32(contexts.tiles.length);
      for (const c of contexts.tiles) {
        u32(c.hash);
        u32(c.group);
        tile(c);
      }
    }
  }
  if (rom) {
    tag('VBGOROM1');
    u32(rom.crc);
    u32(rom.size);
  }
  return new Uint8Array(out);
}
