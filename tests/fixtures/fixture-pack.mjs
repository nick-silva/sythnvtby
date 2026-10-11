/**
 * A small synthetic .vbpack for tests that must not depend on a ROM or a real project: three
 * captured frames of a made-up game, painted through each kind of colour rule. Built with the
 * project's own writer (src/art-pack.js), so it is a real pack. No ROM inside — only a ROM
 * identity in the manifest, which is all a play pack needs.
 *
 * What it holds (FIXTURE describes it for tests):
 * - World 31: a full-screen background of one pattern — painted blue in the pack colours.
 * - World 30: a 64×32 sign — the "Sign" group paints it green, only on the Title screen.
 * - World 29: a two-tile sprite — the "Hero" group paints it red and yellow while the game state
 *   "Hero is red" holds; the group keeps one pose, "Stand".
 * - Frames: #1 Title (hero red), #2 Title with the state off (hero unpainted), #3 Play screen (sign
 *   left out by its screen limit, hero red). Screens and the state come from each frame's RAM dump.
 *
 *   node tests/fixtures/fixture-pack.mjs <out.vbpack>   writes it to a file
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildArtPack } from '../../src/art-pack.js';
import { buildVBColorPack } from '../../src/vbcolor-pack.js';
import { serializeVIPState } from '../../src/vip-dump.js';
import { hashTile } from '../../src/vip-state.js';
import { encodeGroupTileColors } from '../../src/group-tile-colors.js';

const TILE = { background: 1, sign: 2, heroLeft: 3, heroRight: 4 };
/** 8 rows × 2 bytes; each 2-bit pixel value is 1, 2 or 3, so no pixel is see-through. */
const ROWS = {
  [TILE.background]: Array(16).fill(0x55),
  [TILE.sign]: Array(16).fill(0xaa),
  [TILE.heroLeft]: Array(16).fill(0xff),
  [TILE.heroRight]: Array.from({ length: 16 }, (_, i) => ((i >> 1) % 2 ? 0x55 : 0xff)),
};
const SIGN = { x: 160, y: 96, w: 64, h: 32 };
const RAM = { screen: 0, heroState: 100 };

function patternTable() {
  const pt = new Uint8Array(2048 * 16);
  for (const [tile, rows] of Object.entries(ROWS)) pt.set(rows, Number(tile) * 16);
  return pt;
}
const PT = patternTable();
const hashOf = (tile) => hashTile(PT.subarray(tile * 16, tile * 16 + 16)) >>> 0;

/** An 8×8 tile of one colour. */
const solid = (r, g, b) => {
  const out = new Uint8Array(256);
  for (let i = 0; i < 64; i++) out.set([r, g, b, 255], i * 4);
  return out;
};

export const FIXTURE = {
  hashes: { background: hashOf(TILE.background), sign: hashOf(TILE.sign), heroLeft: hashOf(TILE.heroLeft), heroRight: hashOf(TILE.heroRight) },
  colors: { background: [0, 0, 255], sign: [0, 200, 0], heroLeft: [255, 0, 0], heroRight: [255, 255, 0] },
  sign: SIGN,
  /** Where the hero's left tile is on each frame. */
  hero: [{ x: 40, y: 40 }, { x: 40, y: 40 }, { x: 64, y: 48 }],
  frames: [
    { id: 'f-fixture-title-1', name: 'Title', screen: 1, heroRed: 1 },
    { id: 'f-fixture-title-2', name: 'Title', screen: 1, heroRed: 0 },
    { id: 'f-fixture-play-1', name: 'Play', screen: 2, heroRed: 1 },
  ],
};

/** The world table: background, sign, sprite world, then END. */
function windowsTable() {
  const w = new Uint8Array(1024);
  const put = (world, half, v) => {
    const off = world * 32 + half * 2;
    w[off] = v & 0xff;
    w[off + 1] = (v >> 8) & 0xff;
  };
  put(31, 0, 0xc000); // both eyes, normal BG, map segment 0
  put(31, 7, 383);
  put(31, 8, 223);
  put(30, 0, 0xc000);
  put(30, 1, SIGN.x);
  put(30, 3, SIGN.y);
  put(30, 7, SIGN.w - 1);
  put(30, 8, SIGN.h - 1);
  put(29, 0, 0xc000 | 0x3000); // sprite (OBJ) world
  put(28, 0, 0x40); // END
  return w;
}

function frameState(i) {
  const hero = FIXTURE.hero[i];
  const drawList = [];
  for (const eye of [0, 1]) {
    for (let y = 0; y < 224; y += 8) for (let x = 0; x < 384; x += 8) drawList.push({ tileIndex: TILE.background, x, y, eye, world: 31, layer: 0, strip: y >> 3 });
    for (let y = SIGN.y; y < SIGN.y + SIGN.h; y += 8) for (let x = SIGN.x; x < SIGN.x + SIGN.w; x += 8) drawList.push({ tileIndex: TILE.sign, x, y, eye, world: 30, layer: 0, strip: y >> 3 });
    drawList.push({ tileIndex: TILE.heroLeft, x: hero.x, y: hero.y, eye, world: 29, layer: 2, strip: hero.y >> 3 });
    drawList.push({ tileIndex: TILE.heroRight, x: hero.x + 8, y: hero.y, eye, world: 29, layer: 2, strip: hero.y >> 3 });
  }
  return {
    eye: 0,
    frameNumber: 100 + i,
    patternTable: PT,
    oam: new Uint8Array(8192),
    segments: Array.from({ length: 16 }, () => new Uint8Array(0x2000)),
    windows: windowsTable(),
    drawList,
    masterBrightness: 0.5,
    corePatchLevel: 3,
  };
}

function wram(frame) {
  const ram = new Uint8Array(65536);
  ram[RAM.screen] = frame.screen;
  ram[RAM.heroState] = frame.heroRed;
  return ram;
}

/** The pack's parts, as buildArtPack takes them. */
export function fixtureParts() {
  const { hashes, colors } = FIXTURE;
  const frameRegistry = FIXTURE.frames.map((f, i) => ({
    frameId: f.id,
    number: i + 1,
    stateName: f.name,
    vipStateFile: `vipstates/${f.id}.json`,
    ramdumpFile: `ramdumps/${f.id}.wram.bin`,
  }));
  const groups = [
    {
      id: 'g-hero',
      name: 'Hero',
      authoringKind: 'obj',
      criteria: { windowIds: [29], hashes: [hashes.heroLeft, hashes.heroRight], layers: [2] },
      tileColors: encodeGroupTileColors(new Map([[hashes.heroLeft, solid(...colors.heroLeft)], [hashes.heroRight, solid(...colors.heroRight)]])),
      conditions: [{ state: 'hero-red', is: true }],
      poses: [{ poseId: 'p-stand', name: 'Stand', sourceFrameId: FIXTURE.frames[0].id, tiles: [{ hash: hashes.heroLeft, dx: 0, dy: 0 }, { hash: hashes.heroRight, dx: 8, dy: 0 }] }],
      visible: true,
    },
    {
      id: 'g-sign',
      name: 'Sign',
      authoringKind: 'bg',
      criteria: { windowIds: [30], hashes: [hashes.sign], layers: [0] },
      tileColors: encodeGroupTileColors(new Map([[hashes.sign, solid(...colors.sign)]])),
      screens: { mode: 'only', pools: ['pool-title'] },
      visible: true,
    },
  ];
  const pool = (id, label, value) => ({ id, label, variants: [{ id: '__default__', label: 'Default', ramConditions: [{ offset: RAM.screen, expectedValue: value }] }] });
  return {
    manifest: {
      version: 1,
      gameId: 'fixture',
      name: 'Fixture',
      romSize: 1048576,
      romSha1: '0'.repeat(40),
      romCrc32: '00000000',
      frameRegistry,
    },
    vbcolor: buildVBColorPack('fixture', new Map([[hashes.background, solid(...colors.background)]])),
    groups,
    groupsSchemaVersion: 3,
    gameStatePools: [pool('pool-title', 'Title', 1), pool('pool-play', 'Play', 2)],
    gameStates: [{ id: 'hero-red', name: 'Hero is red', conditions: [{ offset: RAM.heroState, value: 1 }], source: 'manual' }],
    vipStatesFolder: FIXTURE.frames.map((f, i) => ({ name: `${f.id}.json`, json: JSON.stringify(serializeVIPState(frameState(i))) })),
    ramdumpsFolder: FIXTURE.frames.map((f) => ({ name: `${f.id}.wram.bin`, buffer: wram(f).buffer })),
  };
}

/** The pack's bytes. */
export async function buildFixturePack() {
  const blob = await buildArtPack(fixtureParts());
  return new Uint8Array(await blob.arrayBuffer());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: node tests/fixtures/fixture-pack.mjs <out.vbpack>');
    process.exit(2);
  }
  writeFileSync(out, await buildFixturePack());
  console.log(`wrote ${out}`);
}
