import { describe, it, expect, beforeAll } from 'vitest';
import { buildFixturePack, FIXTURE } from '../tests/fixtures/fixture-pack.mjs';
import { parseArtPack } from './art-pack.js';
import { parseVBColorPack } from './vbcolor-pack.js';
import { deserializeVIPState } from './vip-dump.js';
import { compositeColorFrame } from './color-layer.js';
import { setProjectGameStates } from './game-states.js';

const W = 384;

/** The synthetic pack, opened with the real reader and drawn with the real compositor. */
describe('the fixture pack, end to end', () => {
  let parsed;
  let pack;
  /** @type {Array<{ data: Uint8ClampedArray }>} */
  const frames = [];

  beforeAll(async () => {
    parsed = await parseArtPack((await buildFixturePack()).buffer);
    pack = parseVBColorPack(parsed.vbcolor);
    setProjectGameStates(parsed.gameStates);
    for (const f of FIXTURE.frames) {
      const state = deserializeVIPState(JSON.parse(parsed.vipStatesFolder.find((x) => x.name === `${f.id}.json`).json));
      const wram = new Uint8Array(parsed.ramdumpsFolder.find((x) => x.name === `${f.id}.wram.bin`).buffer);
      const imageData = { data: new Uint8ClampedArray(W * 224 * 4) };
      compositeColorFrame(state, pack.entries, imageData, {
        groups: parsed.groups,
        gameStatePools: parsed.gameStatePools,
        wram,
        renderUnpackedFallback: false,
      });
      frames.push(imageData);
    }
  });

  const pixel = (frame, x, y) => [...frames[frame].data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];
  /** Which colour a pixel is: the channels that are lit, or 'none' when see-through. */
  const hue = ([r, g, b, a]) => (a === 0 ? 'none' : `${r > 0 ? 'r' : ''}${g > 0 ? 'g' : ''}${b > 0 ? 'b' : ''}`);
  const inside = (box, dx = 4, dy = 4) => [box.x + dx, box.y + dy];

  it('reads back as written: frames, RAM dumps, groups, screens and the game state', () => {
    expect(parsed.manifest.frameRegistry.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(parsed.vipStatesFolder).toHaveLength(3);
    expect(parsed.ramdumpsFolder).toHaveLength(3);
    expect(parsed.groups.map((g) => g.name)).toEqual(['Hero', 'Sign']);
    expect(parsed.gameStatePools.map((p) => p.id)).toEqual(['pool-title', 'pool-play']);
    expect(parsed.gameStates[0].id).toBe('hero-red');
    expect(pack.entries.has(FIXTURE.hashes.background)).toBe(true);
  });

  it('colours the background from the pack on every frame', () => {
    for (const f of [0, 1, 2]) expect(hue(pixel(f, 2, 200)), `frame ${f}`).toBe('b');
  });

  it('colours the sign green on the Title screen only (its screen limit)', () => {
    expect(hue(pixel(0, ...inside(FIXTURE.sign)))).toBe('g');
    expect(hue(pixel(1, ...inside(FIXTURE.sign)))).toBe('g');
    expect(hue(pixel(2, ...inside(FIXTURE.sign)))).toBe('none');
  });

  it('colours the hero red and yellow while its game state holds, and not otherwise', () => {
    const [h0, h1, h2] = FIXTURE.hero;
    expect(hue(pixel(0, ...inside(h0)))).toBe('r');
    expect(hue(pixel(0, h0.x + 12, h0.y + 4))).toBe('rg');
    expect(hue(pixel(1, ...inside(h1)))).toBe('none');
    expect(hue(pixel(2, ...inside(h2)))).toBe('r');
  });
});
