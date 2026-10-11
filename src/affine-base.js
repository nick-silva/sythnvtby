/**
 * Base tiles of a scaled (affine) layer: the picture as it sits in the game's background map,
 * before the VIP scales it. A far-court player in Mario's Tennis is drawn by zooming a block of
 * map cells; laying those cells out 1:1 shows the drawing at its real size, and painting it paints
 * every scaled copy (paint is per tile pattern).
 *
 * The layout is plain background draws — one 8×8 draw per map cell — so a stand-in frame built
 * from it renders, hit-tests and paints like any other background.
 */
import { affineWorlds, sampleAffineWorld } from './affine-world.js';
import { getTileBytes, hashTile } from './vip-state.js';

const FRAME_W = 384;
const FRAME_H = 224;
const TILE = 8;
/** Empty cells between two worlds laid side by side. */
const WORLD_GAP_CELLS = 2;

/**
 * The map cells of these affine worlds that hold one of the wanted patterns on this frame, laid
 * out unscaled and centred on the screen. Each world keeps its own cells' arrangement; several
 * worlds sit side by side, front world (lower number) first.
 * @param {any} state a VIP frame
 * @param {number} eye
 * @param {number[]} worlds affine worlds to read
 * @param {Set<number>} want unsigned pattern hashes
 * @returns {Array<{ tileIndex: number, x: number, y: number, flipH: boolean, flipV: boolean, paletteSelector: number, world: number, layer: 0, eye: number }>}
 */
export function affineBaseDraws(state, eye, worlds, want) {
  if (!state?.patternTable) return [];
  const shown = new Set(affineWorlds(state, eye));
  /** @type {Map<number, number>} */
  const hashOfChar = new Map();
  const hashOf = (ch) => {
    let h = hashOfChar.get(ch);
    if (h === undefined) hashOfChar.set(ch, (h = hashTile(getTileBytes(state.patternTable, ch)) >>> 0));
    return h;
  };
  const blocks = [];
  for (const world of [...worlds].sort((a, b) => a - b)) {
    if (!shown.has(world)) continue;
    /** @type {Map<number, { ch: number, hflip: boolean, vflip: boolean, pal: number }>} */
    const cells = new Map();
    sampleAffineWorld(state, world, eye, (_x, _y, ch, _tx, _ty, _px, pal, hflip, vflip, _rot, cell) => {
      if (cell < 0 || cells.has(cell) || !want.has(hashOf(ch))) return;
      cells.set(cell, { ch, hflip, vflip, pal });
    });
    if (!cells.size) continue;
    let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity;
    for (const c of cells.keys()) {
      const cx = c % 1024, cy = Math.floor(c / 1024);
      cx0 = Math.min(cx0, cx); cy0 = Math.min(cy0, cy);
      cx1 = Math.max(cx1, cx); cy1 = Math.max(cy1, cy);
    }
    blocks.push({ world, cells, cx0, cy0, w: cx1 - cx0 + 1, h: cy1 - cy0 + 1 });
  }
  if (!blocks.length) return [];
  const totalW = blocks.reduce((n, b) => n + b.w, 0) + WORLD_GAP_CELLS * (blocks.length - 1);
  const totalH = Math.max(...blocks.map((b) => b.h));
  let left = Math.max(0, Math.floor((FRAME_W / TILE - totalW) / 2)) * TILE;
  const top = Math.max(0, Math.floor((FRAME_H / TILE - totalH) / 2)) * TILE;
  const draws = [];
  for (const b of blocks) {
    for (const [c, t] of b.cells) {
      const x = left + (c % 1024 - b.cx0) * TILE;
      const y = top + (Math.floor(c / 1024) - b.cy0) * TILE;
      if (x >= FRAME_W || y >= FRAME_H) continue;
      // cellX/cellY: the map cell, so a picture in the map (src/overpaint.js) can be laid on it.
      draws.push({ tileIndex: t.ch, x, y, flipH: t.hflip, flipV: t.vflip, paletteSelector: t.pal, world: b.world, layer: 0, eye: eye ? 1 : 0, cellX: c % 1024, cellY: Math.floor(c / 1024) });
    }
    left += (b.w + WORLD_GAP_CELLS) * TILE;
  }
  return draws.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * A stand-in frame showing those draws on both eyes: the frame's patterns, palettes and
 * brightness, but no world table, so nothing is scaled.
 * @param {any} state the frame the base tiles came from
 * @param {ReturnType<typeof affineBaseDraws>} draws
 */
export function affineBaseState(state, draws) {
  return {
    patternTable: state.patternTable,
    ...(state.gplt && { gplt: state.gplt }),
    ...(state.masterBrightness != null && { masterBrightness: state.masterBrightness }),
    ...(state.brightnessReference != null && { brightnessReference: state.brightnessReference }),
    drawList: [...draws, ...draws.map((d) => ({ ...d, eye: d.eye ? 0 : 1 }))],
  };
}
