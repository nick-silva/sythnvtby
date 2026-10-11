import { describe, it, expect } from 'vitest';
import { recoverClippedBgDraws } from './vip-edge-tiles.js';
import { serializeVIPState, deserializeVIPState } from './vip-dump.js';

// ── Test fixtures: a world table and DRAM segments built by hand ───────────────────────

const SEG_BYTES = 0x2000;

function blankState() {
  return {
    windows: new Uint8Array(1024),
    segments: Array.from({ length: 16 }, () => new Uint8Array(SEG_BYTES)),
    drawList: [],
  };
}

function wr16(u8, byteOff, v) {
  u8[byteOff] = v & 0xff;
  u8[byteOff + 1] = (v >> 8) & 0xff;
}

/** Write one halfword of DRAM (index in halfwords, as the VIP addresses it). */
function dramWrite(state, h, v) {
  wr16(state.segments[h >> 12], (h & 0xfff) * 2, v);
}

function dramRead(state, h) {
  const seg = state.segments[h >> 12];
  const o = (h & 0xfff) * 2;
  return seg[o] | (seg[o + 1] << 8);
}

/**
 * @param {object} w world fields; signed values are written as 16-bit two's complement,
 * which is what the VIP's 11/9-bit sign extension reads back.
 */
function setWorld(state, world, w) {
  const b = world * 32;
  const header =
    (w.lon === false ? 0 : 0x8000)
    | (w.ron === false ? 0 : 0x4000)
    | ((w.bgm ?? 0) << 12)
    | ((w.scx ?? 0) << 10)
    | ((w.scy ?? 0) << 8)
    | (w.over ? 0x80 : 0)
    | (w.end ? 0x40 : 0)
    | ((w.bgmapBase ?? 0) & 0xf);
  wr16(state.windows, b, header);
  wr16(state.windows, b + 2, (w.gx ?? 0) & 0xffff);
  wr16(state.windows, b + 4, (w.gp ?? 0) & 0xffff);
  wr16(state.windows, b + 6, (w.gy ?? 0) & 0xffff);
  wr16(state.windows, b + 8, (w.mx ?? 0) & 0xffff);
  wr16(state.windows, b + 10, (w.mp ?? 0) & 0xffff);
  wr16(state.windows, b + 12, (w.my ?? 0) & 0xffff);
  wr16(state.windows, b + 14, (w.w ?? 383) & 0xffff);
  wr16(state.windows, b + 16, (w.h ?? 223) & 0xffff);
  wr16(state.windows, b + 20, (w.overChar ?? 0) & 0xffff);
}

function endAt(state, world) {
  wr16(state.windows, world * 32, 0x40);
}

/** Only `world` is displayed: every world above it is switched off for both eyes. */
function onlyWorld(state, world, w) {
  for (let k = 31; k > world; k--) setWorld(state, k, { lon: false, ron: false });
  setWorld(state, world, w);
  if (world > 0) endAt(state, world - 1);
}

/** Fill a 64×64-cell BG map segment with distinct entries, optionally flipped / paletted. */
function fillMap(state, seg, rand = null) {
  for (let cy = 0; cy < 64; cy++) {
    for (let cx = 0; cx < 64; cx++) {
      let v = ((cy * 64 + cx) % 2047) + 1;
      if (rand) {
        if (rand() < 0.3) v |= 0x1000; // vflip
        if (rand() < 0.3) v |= 0x2000; // hflip
        v |= Math.floor(rand() * 4) << 14;
      }
      dramWrite(state, (seg << 12) + cy * 64 + cx, v);
    }
  }
}

// ── Reference: the patched core's DrawBG loop, line for line ────────────────────────────
// Mirrors mednafen/vb/vip_draw.inc (VIP_DrawBlock normal-BG branch + DrawBG) with the
// draw-list hook from patches/beetle-vb-vip-draw-list-export.patch. It returns what the core
// records and every tile cell it actually paints pixels of.

const s = (v, bits) => {
  v &= (1 << bits) - 1;
  return v >= 1 << (bits - 1) ? v - (1 << bits) : v;
};

const cellKey = (d) => `${d.world}|${d.x}|${d.y}|${d.tileIndex}|${d.flipH ? 1 : 0}|${d.flipV ? 1 : 0}|${d.paletteSelector}`;

function coreReference(state, eye) {
  const W = state.windows;
  const rd = (i) => W[i] | (W[i + 1] << 8);
  const recorded = [];
  const painted = new Map();
  for (let world = 31; world >= 0; world--) {
    const b = world * 32;
    const w0 = rd(b);
    if (w0 & 0x40) break;
    const bgm = (w0 >> 12) & 3;
    if (bgm !== 0) continue;
    if (!(w0 & (eye ? 0x4000 : 0x8000))) continue;
    const bgmapBase = w0 & 0xf;
    const over = !!(w0 & 0x80);
    const scy = (w0 >> 8) & 3;
    const scx = (w0 >> 10) & 3;
    const gx = s(rd(b + 2), 11) & 0xffff;
    const gp = s(rd(b + 4), 9) & 0xffff;
    const gy = s(rd(b + 6), 11) & 0xffff;
    const mx = rd(b + 8);
    const mp = s(rd(b + 10), 9) & 0xffff;
    const my = rd(b + 12);
    const destWidth = s(rd(b + 14), 11) & 0xffff;
    const destHeight = rd(b + 16) & 0x3ff;
    const overChar = rd(b + 20);
    for (let realY = 0; realY < 224; realY++) {
      const srcX = (mx + (eye ? mp : -mp)) & 0xffff;
      const srcY = (my + (realY - gy)) & 0xffff;
      let destX = (gx + (eye ? gp : -gp)) & 0xffff;
      const destY = gy;
      // DrawBG
      const sizeX = 512 * (1 << scx);
      const sizeY = 512 * (1 << scy);
      const maskX = over ? 0x1fff : sizeX - 1;
      const maskY = over ? 0x1fff : sizeY - 1;
      if (((realY - destY) & 0xffff) > destHeight) continue;
      let sourceX = s(srcX, 16) >>> 0;
      let sourceY = s(srcY, 16) >>> 0;
      destX = s(destX, 10);
      if (destX < 0) sourceX = (sourceX - destX) >>> 0;
      let startX = destX;
      let finalX = destX + destWidth;
      if (startX < 0) startX = 0;
      if (finalX > 383) finalX = 383;
      if (startX > finalX) continue;
      sourceY &= maskY;
      const base = (bgmapBase << 12) | (((sourceY >> 3) & 0x3f) * 0x40) | (((sourceY << 3) & ~0xfff) << scx);
      for (let x = startX; x <= finalX; x++) {
        sourceX &= maskX;
        let bgsc = dramRead(state, overChar);
        if (sourceX < sizeX && sourceY < sizeY) {
          bgsc = dramRead(state, (base | ((sourceX << 3) & ~0xfff) | ((sourceX >> 3) & 0x3f)) & 0xffff);
        }
        const vflipXor = bgsc & 0x1000 ? 7 : 0;
        const charSubY = vflipXor ^ (sourceY & 7);
        const draw = {
          tileIndex: bgsc & 0x7ff,
          x: x - (sourceX & 7),
          y: realY - (sourceY & 7),
          flipH: !!(bgsc & 0x2000),
          flipV: !!(bgsc & 0x1000),
          eye,
          world,
          layer: 0,
          paletteSelector: (bgsc >> 14) & 3,
        };
        painted.set(cellKey(draw), draw);
        // The patch's hook: one draw per tile, on its top scanline in screen space.
        if (charSubY === 0 && (sourceX & 7) === 0) {
          recorded.push({ ...draw, y: realY - vflipXor, strip: realY >> 3 });
        }
        if (!(sourceX & 7) && x + 7 <= finalX) {
          x += 7;
          sourceX += 8;
        } else {
          sourceX++;
        }
      }
    }
  }
  return { recorded, painted };
}

function checkAgainstCore(state, eye = 0) {
  const { recorded, painted } = coreReference(state, eye);
  state.drawList = recorded;
  const recovered = recoverClippedBgDraws(state, eye);
  const recKeys = new Set(recorded.map(cellKey));
  const got = new Set(recovered.map(cellKey));
  const missing = [...painted.keys()].filter((k) => !recKeys.has(k));
  return { recorded, recovered, recKeys, got, missing };
}

// ── Tests ──────────────────────────────────────────────────────────────────────────────

describe('recoverClippedBgDraws', () => {
  it('recovers the row of tiles cut by the top of the screen (the IntroCin cloud case)', () => {
    const st = blankState();
    fillMap(st, 0);
    // World 3 on IntroCin: window starts above the screen, source row 1 px into a tile.
    onlyWorld(st, 3, { gx: 0, gy: -73, my: 64, mx: 0, w: 383, h: 191 });
    const { recovered, missing, got } = checkAgainstCore(st);
    expect(missing.length).toBeGreaterThan(0);
    expect(recovered.every((d) => d.y === -1 && d.world === 3 && d.layer === 0)).toBe(true);
    expect([...got].sort()).toEqual([...missing].sort());
    expect(recovered).toHaveLength(48); // 384 px of tiles across
  });

  it('recovers nothing when the window is tile-aligned on screen', () => {
    const st = blankState();
    fillMap(st, 0);
    onlyWorld(st, 0, { gy: 0, my: 0, w: 383, h: 223 });
    expect(checkAgainstCore(st).recovered).toEqual([]);
  });

  it('recovers the column of tiles cut by the left edge', () => {
    const st = blankState();
    fillMap(st, 0);
    onlyWorld(st, 0, { gx: -3, gy: 0, my: 0, mx: 0, w: 400, h: 223 });
    const { recovered, missing, got } = checkAgainstCore(st);
    expect(recovered.length).toBe(28);
    expect(recovered.every((d) => d.x === -3)).toBe(true);
    expect([...got].sort()).toEqual([...missing].sort());
  });

  it('leaves vertically flipped tiles at the top alone (the core recorded them) and recovers them at the bottom', () => {
    const st = blankState();
    for (let i = 0; i < 4096; i++) dramWrite(st, i, 0x1000 | ((i % 2047) + 1)); // every cell vflipped
    onlyWorld(st, 0, { gy: -3, my: 0, w: 383, h: 223 + 3 + 4 });
    const { recorded, recovered, missing, got } = checkAgainstCore(st);
    expect(recorded.some((d) => d.y === -3)).toBe(true);
    expect(recovered.length).toBeGreaterThan(0);
    expect(recovered.every((d) => d.y + 7 > 223)).toBe(true);
    expect([...got].sort()).toEqual([...missing].sort());
  });

  it('matches the core exactly across random world placements, flips, parallax and overplane', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let trial = 0; trial < 60; trial++) {
      const st = blankState();
      for (let seg = 0; seg < 4; seg++) fillMap(st, seg, rand);
      const nWorlds = ri(1, 4);
      for (let k = 0; k < nWorlds; k++) {
        setWorld(st, 31 - k, {
          scx: ri(0, 1),
          scy: ri(0, 1),
          bgmapBase: 0,
          over: rand() < 0.2,
          overChar: ri(0, 4095),
          gx: ri(-40, 380),
          gp: ri(-8, 8),
          gy: ri(-60, 220),
          mx: ri(0, 1100),
          mp: ri(-8, 8),
          my: ri(0, 1100),
          w: rand() < 0.1 ? -1 : ri(0, 420),
          h: ri(0, 300),
        });
      }
      endAt(st, 31 - nWorlds);
      for (const eye of [0, 1]) {
        const { recovered, recKeys, got, missing } = checkAgainstCore(st, eye);
        expect([...got].sort(), `trial ${trial} eye ${eye}`).toEqual([...missing].sort());
        // Never duplicates a tile the core already recorded, and never repeats itself.
        expect(recovered.filter((d) => recKeys.has(cellKey(d)))).toEqual([]);
        expect(got.size).toBe(recovered.length);
      }
    }
  });

  it('skips worlds that are not normal BG (affine, OBJ) and stops at END', () => {
    const st = blankState();
    fillMap(st, 0);
    setWorld(st, 31, { bgm: 2, gy: -3, my: 0 });
    setWorld(st, 30, { bgm: 3 });
    setWorld(st, 29, { end: true });
    setWorld(st, 28, { gy: -3, my: 0 }); // after END: never drawn
    expect(recoverClippedBgDraws(st, 0)).toEqual([]);
  });

  it('respects the per-eye display flags', () => {
    const st = blankState();
    fillMap(st, 0);
    setWorld(st, 31, { gy: -3, my: 0, lon: false, ron: true });
    endAt(st, 30);
    expect(recoverClippedBgDraws(st, 0)).toEqual([]);
    expect(recoverClippedBgDraws(st, 1).length).toBeGreaterThan(0);
  });

  it('returns nothing without a world table or DRAM segments', () => {
    expect(recoverClippedBgDraws({ drawList: [] }, 0)).toEqual([]);
    const st = blankState();
    delete st.segments;
    expect(recoverClippedBgDraws(st, 0)).toEqual([]);
  });

  it('marks recovered draws and gives them the shape the compositor expects', () => {
    const st = blankState();
    fillMap(st, 0);
    setWorld(st, 31, { gy: -2, my: 0 });
    endAt(st, 30);
    const d = recoverClippedBgDraws(st, 0)[0];
    expect(d).toMatchObject({ eye: 0, world: 31, layer: 0, recovered: true });
    expect(typeof d.tileIndex).toBe('number');
    expect(d.strip).toBe(0);
  });

  it('adds nothing for frames from a core that records cut tiles itself (patch level 3+)', () => {
    const st = blankState();
    fillMap(st, 0);
    setWorld(st, 31, { gy: -2, my: 0 });
    endAt(st, 30);
    expect(recoverClippedBgDraws({ ...st, corePatchLevel: 2 }, 0).length).toBeGreaterThan(0);
    expect(recoverClippedBgDraws({ ...st, corePatchLevel: 3 }, 0)).toEqual([]);
  });

  it('a saved capture remembers which core made it, and keeps negative tile positions', () => {
    const st = blankState();
    st.patternTable = new Uint8Array(2048 * 16);
    st.oam = new Uint8Array(0x2000);
    st.corePatchLevel = 3;
    st.drawList = [{ tileIndex: 5, x: -3, y: -6, eye: 0, layer: 2, world: 19 }];
    const back = deserializeVIPState(JSON.parse(JSON.stringify(serializeVIPState(st))));
    expect(back.corePatchLevel).toBe(3);
    expect(back.drawList[0]).toMatchObject({ x: -3, y: -6, layer: 2 });
    const old = deserializeVIPState(JSON.parse(JSON.stringify(serializeVIPState({ ...st, corePatchLevel: undefined }))));
    expect(old.corePatchLevel).toBeUndefined();
  });

  it('returns the same array for the same state and eye (per-frame cache)', () => {
    const st = blankState();
    fillMap(st, 0);
    setWorld(st, 31, { gy: -2, my: 0 });
    endAt(st, 30);
    expect(recoverClippedBgDraws(st, 0)).toBe(recoverClippedBgDraws(st, 0));
  });
});
