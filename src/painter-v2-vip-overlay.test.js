import { describe, it, expect } from 'vitest';
import { hashTile } from './vip-state.js';
import {
  parsePainterV2VipOverlaysJson,
  blendPainterV2VipOverlaysIntoImageData,
  overlayBrightness,
  groupDrawMembership,
  overlayGroupsOnScreen,
} from './painter-v2-vip-overlay.js';

describe('overlayGroupsOnScreen', () => {
  // An overlay is painted for one screen: it belongs on a frame only while its group's anchor
  // tile is there (the emulator's rule). SpriteStudio drew every overlay on every frame, so a
  // new layer art started from a Level 1 frame picked up the Safety and Splash screens' paint.
  const pt = new Uint8Array(16 * 2048);
  pt.fill(0xaa, 16, 32); // tile 1
  pt.fill(0x55, 32, 48); // tile 2
  const h1 = hashTile(pt.subarray(16, 32)) >>> 0;
  const h2 = hashTile(pt.subarray(32, 48)) >>> 0;
  const safety = { id: 'safety', anchorHash: h1, criteria: { windowIds: [31], layers: [0], hashes: [h1] } };
  const splash = { id: 'splash', anchorHash: h2, criteria: { windowIds: [30], layers: [0], hashes: [h2] } };
  const frame = (draws) => ({ patternTable: pt, drawList: draws });

  it('lists only the groups whose anchor is drawn on this frame and eye', () => {
    const level = frame([{ tileIndex: 2, x: 0, y: 0, world: 30, layer: 0, eye: 0 }]);
    expect([...overlayGroupsOnScreen(level, 0, [safety, splash])]).toEqual(['splash']);
    expect([...overlayGroupsOnScreen(level, 1, [safety, splash])]).toEqual([]);
  });

  it('needs the anchor in the group’s own world', () => {
    const elsewhere = frame([{ tileIndex: 1, x: 0, y: 0, world: 5, layer: 0, eye: 0 }]);
    expect([...overlayGroupsOnScreen(elsewhere, 0, [safety])]).toEqual([]);
  });
});

describe('parsePainterV2VipOverlaysJson', () => {
  it('returns empty map for invalid input', () => {
    expect(parsePainterV2VipOverlaysJson('').size).toBe(0);
    expect(parsePainterV2VipOverlaysJson('not json').size).toBe(0);
  });

  it('parses one full-size layer', () => {
    const px = 384 * 224 * 4;
    const buf = new Uint8Array(px);
    buf[3] = 255;
    let b64 = '';
    for (let i = 0; i < buf.length; i++) b64 += String.fromCharCode(buf[i]);
    const doc = {
      schemaVersion: 1,
      width: 384,
      height: 224,
      entries: [{ groupId: 'g1', eye: 0, rgbaBase64: btoa(b64) }],
    };
    const m = parsePainterV2VipOverlaysJson(JSON.stringify(doc));
    expect(m.size).toBe(1);
    const layer = m.get('g1')?.get(0);
    expect(layer?.length).toBe(px);
    expect(layer?.[3]).toBe(255);
  });
});

describe('blendPainterV2VipOverlaysIntoImageData', () => {
  it('writes opaque overlay pixel when anchor matches', () => {
    const pt = new Uint8Array(16 * 2048).fill(0);
    const tileBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) tileBytes[i] = 0xaa;
    pt.set(tileBytes, 0);
    const drawList = [{ tileIndex: 0, x: 0, y: 0, layer: 0, eye: 0, world: 0 }];
    const state = { patternTable: pt, drawList, masterBrightness: 1 };
    const ah = hashTile(tileBytes) >>> 0;
    const groups = [{ id: 'bg', anchorHash: ah, criteria: {} }];
    const px = 384 * 224 * 4;
    const rgba = new Uint8Array(px);
    rgba[0] = 10;
    rgba[1] = 20;
    rgba[2] = 30;
    rgba[3] = 255;
    const overlay = new Map([['bg', new Map([[0, rgba]])]]);
    const imageData = { data: new Uint8Array(px).fill(0) };
    blendPainterV2VipOverlaysIntoImageData(state, imageData, 0, groups, overlay);
    expect(imageData.data[0]).toBe(10);
    expect(imageData.data[3]).toBe(255);
  });

  it('blends a sparse overlay everywhere it is painted and nowhere else', () => {
    const { state, groups } = anchoredFixture();
    const rgba = new Uint8Array(384 * 224 * 4);
    // A rectangle away from the origin, so a blend that only walked the first rows or
    // stopped at the first painted pixel would miss it.
    const rect = { x0: 100, y0: 90, x1: 140, y1: 120 };
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        const o = (y * 384 + x) * 4;
        rgba[o] = 11;
        rgba[o + 1] = 22;
        rgba[o + 2] = 33;
        rgba[o + 3] = 255;
      }
    }
    const overlay = new Map([['bg', new Map([[0, rgba]])]]);
    const imageData = { data: new Uint8Array(384 * 224 * 4).fill(0) };
    blendPainterV2VipOverlaysIntoImageData(state, imageData, 0, groups, overlay);

    let painted = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i + 3] === 0) continue;
      painted++;
      const x = (i / 4) % 384;
      const y = Math.floor(i / 4 / 384);
      expect(x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1).toBe(true);
      expect(imageData.data[i]).toBe(11);
    }
    expect(painted).toBe((rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1));
  });

  it('writes nothing for a fully transparent overlay', () => {
    const { state, groups } = anchoredFixture();
    const overlay = new Map([['bg', new Map([[0, new Uint8Array(384 * 224 * 4)]])]]);
    const imageData = { data: new Uint8Array(384 * 224 * 4).fill(0) };
    blendPainterV2VipOverlaysIntoImageData(state, imageData, 0, groups, overlay);
    expect(imageData.data.some((v) => v !== 0)).toBe(false);
  });

  it('skips the overlay when the anchor tile is absent from the frame', () => {
    const { state } = anchoredFixture();
    const groups = [{ id: 'bg', anchorHash: 0x12345678, criteria: {} }];
    const rgba = new Uint8Array(384 * 224 * 4);
    rgba[0] = 99;
    rgba[3] = 255;
    const overlay = new Map([['bg', new Map([[0, rgba]])]]);
    const imageData = { data: new Uint8Array(384 * 224 * 4).fill(0) };
    blendPainterV2VipOverlaysIntoImageData(state, imageData, 0, groups, overlay);
    expect(imageData.data[0]).toBe(0);
  });
});

/** A one-draw frame whose tile is the anchor of group `bg`. */
function anchoredFixture() {
  const pt = new Uint8Array(16 * 2048).fill(0);
  const tileBytes = new Uint8Array(16).fill(0xaa);
  pt.set(tileBytes, 0);
  const state = {
    patternTable: pt,
    drawList: [{ tileIndex: 0, x: 0, y: 0, layer: 0, eye: 0, world: 0 }],
    masterBrightness: 1,
  };
  const groups = [{ id: 'bg', anchorHash: hashTile(tileBytes) >>> 0, criteria: {} }];
  return { state, groups };
}

describe('overlay paint fades with the scene', () => {
  // Painted tiles already dim through compositeColorFrame's masterBrightness. Overlays are
  // blended afterwards, so without this they stayed lit while everything around them faded —
  // which is why an anchored group appeared at full brightness the instant a screen began to
  // fade in.
  function blendAt(masterBrightness, scale) {
    const { state, groups } = anchoredFixture();
    state.masterBrightness = masterBrightness;
    const rgba = new Uint8Array(384 * 224 * 4);
    rgba[0] = 200;
    rgba[1] = 100;
    rgba[2] = 50;
    rgba[3] = 255;
    const overlay = new Map([['bg', new Map([[0, rgba]])]]);
    const imageData = { data: new Uint8Array(384 * 224 * 4).fill(0) };
    blendPainterV2VipOverlaysIntoImageData(state, imageData, 0, groups, overlay, scale);
    return Array.from(imageData.data.slice(0, 4));
  }

  it('dims overlay paint part-way through a fade', () => {
    expect(blendAt(0.25, 1)).toEqual([50, 25, 12, 255]);
  });

  it('leaves it alone at full brightness', () => {
    expect(blendAt(1, 1)).toEqual([200, 100, 50, 255]);
  });

  it('keeps alpha, so a faded overlay still covers what is under it', () => {
    expect(blendAt(0, 1)[3]).toBe(255);
  });

  it('applies the fade response the composite uses, capped at full', () => {
    // masterBrightness 0.5 x DEFAULT_FADE_RESPONSE 1.34 = 0.67
    expect(blendAt(0.5, 1.34)[0]).toBe((200 * 0.67) | 0);
    // 0.9 x 1.34 is over 1, and paint must not come out brighter than it was painted.
    expect(blendAt(0.9, 1.34)).toEqual([200, 100, 50, 255]);
  });

  it('still honours the scene brightness when the caller passes no scale', () => {
    const { state, groups } = anchoredFixture();
    state.masterBrightness = 0.5;
    const rgba = new Uint8Array(384 * 224 * 4);
    rgba[0] = 200;
    rgba[3] = 255;
    const imageData = { data: new Uint8Array(384 * 224 * 4).fill(0) };
    blendPainterV2VipOverlaysIntoImageData(state, imageData, 0, groups, new Map([['bg', new Map([[0, rgba]])]]));
    expect(imageData.data[0]).toBe(100);
  });
});

describe('overlayBrightness', () => {
  it('is 1 when nothing is fading', () => {
    expect(overlayBrightness({ masterBrightness: 1 }, 1)).toBe(1);
    expect(overlayBrightness({}, 1)).toBe(1);
    expect(overlayBrightness(null, 1)).toBe(1);
  });

  it('multiplies brightness by the scale and clamps to 0..1', () => {
    expect(overlayBrightness({ masterBrightness: 0.5 }, 1)).toBe(0.5);
    expect(overlayBrightness({ masterBrightness: 0.5 }, 1.34)).toBeCloseTo(0.67, 5);
    expect(overlayBrightness({ masterBrightness: 0.9 }, 1.34)).toBe(1);
    expect(overlayBrightness({ masterBrightness: -1 }, 1)).toBe(0);
  });
});

describe('overlay paint stops at whatever is drawn in front of it', () => {
  // An overlay is blended after the frame is composited, so it used to paint over anything —
  // a sprite walking in front of an anchored foreground platform came out hidden by the
  // platform's own paint. The owner buffer says who is actually visible at each pixel.
  const W = 384;

  /** Two draws at the same spot: the group's own tile, and a sprite over it. */
  function scene() {
    const pt = new Uint8Array(16 * 2048).fill(0);
    const bgTile = new Uint8Array(16).fill(0xaa);
    const objTile = new Uint8Array(16).fill(0x55);
    pt.set(bgTile, 0);
    pt.set(objTile, 16);
    const state = {
      patternTable: pt,
      masterBrightness: 1,
      drawList: [
        { tileIndex: 0, x: 0, y: 0, layer: 0, eye: 0, world: 9 },
        { tileIndex: 1, x: 0, y: 0, layer: 2, eye: 0, world: 8 },
      ],
    };
    const groups = [{ id: 'bg', anchorHash: hashTile(bgTile) >>> 0, criteria: { layers: [0] } }];
    const rgba = new Uint8Array(W * 224 * 4);
    for (let i = 0; i < 8 * 4; i += 4) {
      rgba[i] = 77;
      rgba[i + 3] = 255;
    }
    return { state, groups, overlay: new Map([['bg', new Map([[0, rgba]])]]) };
  }

  const blend = (owners) => {
    const { state, groups, overlay } = scene();
    const imageData = { data: new Uint8Array(W * 224 * 4).fill(0) };
    blendPainterV2VipOverlaysIntoImageData(state, imageData, 0, groups, overlay, 1, owners);
    return imageData.data[0];
  };

  it('paints where its own group is the thing you can see', () => {
    const owners = new Int32Array(W * 224).fill(-1);
    owners[0] = 0; // the BG draw owns this pixel
    expect(blend(owners)).toBe(77);
  });

  it('does not paint where another draw is in front', () => {
    const owners = new Int32Array(W * 224).fill(-1);
    owners[0] = 1; // the sprite owns this pixel
    expect(blend(owners)).toBe(0);
  });

  it('does not paint where nothing is lit at all', () => {
    expect(blend(new Int32Array(W * 224).fill(-1))).toBe(0);
  });

  it('paints everywhere when no owner buffer is given, as it always did', () => {
    expect(blend(null)).toBe(77);
  });
});

describe('groupDrawMembership', () => {
  it('flags the draws a group claims, by draw-list index', () => {
    const pt = new Uint8Array(16 * 2048).fill(0);
    const a = new Uint8Array(16).fill(0xaa);
    const b = new Uint8Array(16).fill(0x55);
    pt.set(a, 0);
    pt.set(b, 16);
    const state = {
      patternTable: pt,
      drawList: [
        { tileIndex: 0, x: 0, y: 0, layer: 0, eye: 0, world: 9 },
        { tileIndex: 1, x: 8, y: 0, layer: 2, eye: 0, world: 8 },
        { tileIndex: 0, x: 16, y: 0, layer: 0, eye: 1, world: 9 },
      ],
    };
    const member = groupDrawMembership(state, 0, { criteria: { layers: [0] } });
    expect(Array.from(member)).toEqual([1, 0, 0]); // index 2 is the other eye
  });

  it('is empty for a frame with no draws', () => {
    expect(groupDrawMembership(null, 0, { criteria: {} }).length).toBe(0);
  });
});
