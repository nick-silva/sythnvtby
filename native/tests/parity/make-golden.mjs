// Golden images for tests/parity.cpp: renders every captured frame of a .vbpack with the browser's
// colour layer exactly as the emulator and web player call it, both eyes, and writes them next to
// the frames and the project's play pack. Frames with a RAM dump are rendered with it, and it is
// written next to them (<stem>.wram.bin), so groups limited to some screens are compared too.
//   node native/tests/parity/make-golden.mjs <project.vbpack> <out-dir> [<group name>=<only|except>:<pool id>[,<pool id>…] | when:<group name>=<offset>:<value>[:not] | follow:<world> | poses:<group name> | posegroups:<group name>]
// The optional last argument changes the exported copy (the project file is not changed) to check
// a feature matches: limit one group to some screens, make every group on a world follow the
// game's palette, or give each pose of a group (each set of its patterns a frame shows) a
// whole-pose group with a solid picture of its own colour.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { parseArtPack, artPackPartsFromParsed } from '../../../src/art-pack.js';
import { buildPlayPack, parsePlayPack } from '../../../src/play-pack.js';
import { deserializeVIPState } from '../../../src/vip-dump.js';
import { compositeColorFrame, getCompositePixelInfo, DEFAULT_FADE_RESPONSE } from '../../../src/color-layer.js';
import { colourOptions } from '../../../src/project.js';
import { parseVBColorPack } from '../../../src/vbcolor-pack.js';
import { setLayerArtDecoder, loadArtPixelsFor, layerArtOf } from '../../../src/layer-art.js';
import { touchUpOf, touchUpKey } from '../../../src/touch-up.js';
import { withGroupScreens } from '../../../src/screen-gate.js';
import { setProjectGameStates, withGroupConditions } from '../../../src/game-states.js';
import { frameStem } from '../../../src/frame-wram.js';
import { getTileBytes, hashTile, isBlankTile } from '../../../src/vip-state.js';
import { getWindowsTableBytesFromState } from '../../../src/vip-world-clip.js';
import { encodePng } from '../../../scripts/png.mjs';
import { foldPoseGroups, expandPoseOverpaints, linkPosePictures } from '../../../src/pose-overpaint.js';

const [packPath, outDir, screensArg] = process.argv.slice(2);
if (!packPath || !outDir) {
  console.error('Usage: node native/tests/parity/make-golden.mjs <project.vbpack> <out-dir> [<group name>=<only|except>:<pool id>,…]');
  process.exit(2);
}

/** PNG → RGBA (8-bit grey/RGB/RGBA, not interlaced: what the tools write). Exact, like stb_image. */
function decodePng(bytes) {
  const u8 = new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let depth = 0;
  const idat = [];
  while (off < u8.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...u8.subarray(off + 4, off + 8));
    const body = u8.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(off + 8);
      height = dv.getUint32(off + 12);
      depth = body[8];
      colorType = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNG');
    } else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG depth ${depth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    if (channels === 4) data.set(px.subarray(s, s + 4), i * 4);
    else if (channels === 3) data.set([px[s], px[s + 1], px[s + 2], 255], i * 4);
    else if (channels === 2) data.set([px[s], px[s], px[s], px[s + 1]], i * 4);
    else data.set([px[s], px[s], px[s], 255], i * 4);
  }
  return { width, height, data };
}

setLayerArtDecoder(async (png) => decodePng(Buffer.from(png, 'base64')));

/**
 * One whole-pose group per distinct set of `base`'s patterns a frame shows on one of its plain
 * worlds (left eye), each with a solid 512×512 picture of its own colour from map 0,0.
 */
function wholePoseGroupsFor(base, frames) {
  const hashes = new Set((base.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  const worlds = new Set((base.criteria?.windowIds || []).map(Number));
  /** @type {Map<string, { world: number, bgmapBase: number, hashes: number[] }>} */
  const poses = new Map();
  for (const { json } of frames) {
    const state = deserializeVIPState(JSON.parse(json));
    const win = getWindowsTableBytesFromState(state);
    /** @type {Map<number, Set<number>>} */
    const perWorld = new Map();
    for (const d of state.drawList || []) {
      if ((d.eye ?? 0) !== 0 || (d.layer ?? 0) !== 0 || (worlds.size && !worlds.has(d.world))) continue;
      const bytes = getTileBytes(state.patternTable, d.tileIndex);
      if (isBlankTile(bytes)) continue;
      const h = hashTile(bytes) >>> 0;
      if (!hashes.has(h)) continue;
      if (!perWorld.has(d.world)) perWorld.set(d.world, new Set());
      perWorld.get(d.world).add(h);
    }
    for (const [world, set] of perWorld) {
      const list = [...set].sort((a, b) => a - b);
      const key = `${world}:${list.join(',')}`;
      if (!poses.has(key) && win) poses.set(key, { world, bgmapBase: win[world * 32] & 0xf, hashes: list });
    }
  }
  return [...poses.values()].map((p, i) => {
    const rgba = new Uint8Array(512 * 512 * 4);
    const colour = [(i * 67) & 0xff, (i * 151 + 80) & 0xff, (i * 29 + 160) & 0xff, 255];
    for (let j = 0; j < rgba.length; j += 4) rgba.set(colour, j);
    return {
      id: `${base.id}-pose-${i}`,
      name: `${base.name} pose ${i}`,
      wholePose: true,
      poseOf: base.id,
      criteria: { windowIds: [...worlds], layers: [0], hashes: p.hashes },
      overpaint: { world: p.world, bgmapBase: p.bgmapBase, mapX: 0, mapY: 0, width: 512, height: 512, hideTiles: false, png: Buffer.from(encodePng(512, 512, rgba)).toString('base64') },
    };
  });
}

await mkdir(outDir, { recursive: true });
const parsed = await parseArtPack((await readFile(packPath)).buffer);
const parts = artPackPartsFromParsed(parsed);
const follow = /^follow:(\d+)$/.exec(screensArg || '');
const posesOfGroup = /^(poses|posegroups):(.+)$/.exec(screensArg || '');
// when:<group>=<offset>:<value>[:not] — a game state of that one byte, and a condition on it for the group.
const when = /^when:(.+)=(0x[0-9a-f]+|\d+):(\d+)(:not)?$/i.exec(screensArg || '');
if (posesOfGroup) {
  const base = parts.groups?.find((g) => g.name === posesOfGroup[2]);
  if (!base) {
    console.error(`No group named ${posesOfGroup[2]}`);
    process.exit(2);
  }
  // poses: pictures inside the group (group.poseOverpaints); posegroups: one group per pose.
  const added = [...parts.groups, ...wholePoseGroupsFor(base, parsed.vipStatesFolder || [])];
  // Folded pictures that match a saved pose are tied to it (as SpriteStudio does on open), so the
  // saved-pose rule is checked too.
  parts.groups = posesOfGroup[1] === 'poses' ? foldPoseGroups(added).groups.map(linkPosePictures) : added;
} else if (when) {
  if (!parts.groups?.some((g) => g.name === when[1])) {
    console.error(`No group named ${when[1]}`);
    process.exit(2);
  }
  parts.gameStates = [...(parts.gameStates || []), { id: 'parity-state', name: 'Parity state', conditions: [{ offset: Number(when[2]), value: Number(when[3]) }] }];
  parts.groups = parts.groups.map((g) => (g.name === when[1] ? withGroupConditions(g, [{ state: 'parity-state', is: !when[4] }]) : g));
} else if (follow) {
  // Every group on that world follows the game's palette (group.followPalette), to check it matches.
  const w = Number(follow[1]);
  parts.groups = parts.groups.map((g) => ((g.criteria?.windowIds || []).map(Number).includes(w) ? { ...g, followPalette: true } : g));
} else if (screensArg) {
  const m = /^(.+)=(only|except):(.+)$/.exec(screensArg);
  if (!m || !parts.groups?.some((g) => g.name === m[1])) {
    console.error(`No group to limit: ${screensArg}`);
    process.exit(2);
  }
  parts.groups = parts.groups.map((g) => (g.name === m[1] ? withGroupScreens(g, { mode: m[2], pools: m[3].split(',') }) : g));
}
const { bytes } = await buildPlayPack(parts, { title: 'parity' });
await writeFile(`${outDir}/game.vbcplay`, bytes);

// What the player gets: the play pack's contents, read back.
const pack = await parsePlayPack(bytes);
setProjectGameStates(pack.gameStates);
const entries = pack.vbcolor ? parseVBColorPack(pack.vbcolor).entries : new Map();
for (const g of expandPoseOverpaints(pack.groups)) {
  if (layerArtOf(g)) await loadArtPixelsFor(g.id, layerArtOf(g).png);
  if (touchUpOf(g)) await loadArtPixelsFor(touchUpKey(g.id), touchUpOf(g).png);
}
const ref = Number(pack.info.brightnessReference);

const W = 384;
const H = 224;
const composite = (state, eye, stereoSource, wram) => {
  const img = { data: new Uint8ClampedArray(W * H * 4) };
  // Exactly as the emulator and the player draw (src/project.js, view `play`).
  const project = { overrides: pack.overrides, groups: pack.groups, gameStatePools: pack.gameStatePools, painterV2Rules: pack.painterV2Rules, paintsTransparent: !!pack.info.paintOnTransparent };
  compositeColorFrame(state, entries, img, colourOptions(project, 'play', { eye, wram, stereoSource, brightnessScale: DEFAULT_FADE_RESPONSE }));
  return img;
};
// The RAM dump captured with each frame, by frame stem.
const ramDumps = new Map();
for (const r of parsed.ramdumpsFolder || []) {
  const bytes = new Uint8Array(r.buffer);
  if (bytes.byteLength >= 0x10000) ramDumps.set(frameStem(r.name), bytes.subarray(0, 0x10000));
}

let n = 0;
for (const { name, json } of parsed.vipStatesFolder || []) {
  const stem = name.replace(/^.*\//, '').replace(/\.json$/, '');
  const state = deserializeVIPState(JSON.parse(json));
  if (Number.isFinite(ref) && ref > 0) state.brightnessReference = ref;
  const wram = ramDumps.get(frameStem(stem)) || null;
  const left = composite(state, 0, null, wram);
  const info = getCompositePixelInfo();
  const source = { data: left.data, shade: info.shade.slice(0, W * H), world: info.world.slice(0, W * H), art: info.art.slice(0, W * H), touched: new Set(info.touched) };
  const right = composite(state, 1, source, wram);
  await writeFile(`${outDir}/${stem}.json`, json);
  if (wram) await writeFile(`${outDir}/${stem}.wram.bin`, wram);
  await writeFile(`${outDir}/${stem}.left.rgba`, left.data);
  await writeFile(`${outDir}/${stem}.right.rgba`, right.data);
  n++;
}
console.log(`${n} frames -> ${outDir}`);
