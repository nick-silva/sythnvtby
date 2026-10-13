#!/usr/bin/env node
/**
 * README comparison images: one captured frame from a pack, as the game shows it (monochrome red)
 * and coloured, side by side at 2×. Both halves come from the same frame, so they always match.
 *
 *   node scripts/readme-shots.mjs <pack.vbpack> --list [count]
 *       frames ranked by how much of what they light is coloured, with their screen label
 *   node scripts/readme-shots.mjs <pack.vbpack> --frame <number> --out docs/images/compare-x.png
 *       one comparison; <number> is the frame's number in the Project tool's Frame list (#144 → 144)
 *
 * Packs are not in the repo: pass your own. Left eye, the tools' preview composite.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { encodePng, decodePng } from './png.mjs';
import { loadPackSession, frameState, frameWram, frameLabel, renderFrame, FRAME_W, FRAME_H } from '../tools/shared/pack-session.js';
import { setLayerArtDecoder, loadLayerArtPixels } from '../src/layer-art.js';
import { posePictureGroups } from '../src/pose-overpaint.js';
import { getCompositePixelInfo } from '../src/color-layer.js';
import { uncolouredMasks } from '../src/uncoloured.js';

const SCALE = 2;
const GAP = 16;

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: node scripts/readme-shots.mjs <pack.vbpack> (--list [count] | --frame <number> --out <file.png>)');
  process.exit(1);
}

const [packPath, ...rest] = process.argv.slice(2);
if (!packPath || !rest.length) usage();
const arg = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

const bytes = readFileSync(packPath);
const session = await loadPackSession(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), packPath);
// Overpaint and pose pictures are PNGs: decode them all before the first composite.
setLayerArtDecoder(async (png) => decodePng(Buffer.from(png, 'base64')));
for (const g of session.groups) {
  await loadLayerArtPixels(g);
  for (const p of posePictureGroups(g)) await loadLayerArtPixels(p);
}

const blank = () => ({ width: FRAME_W, height: FRAME_H, data: new Uint8ClampedArray(FRAME_W * FRAME_H * 4) });
/** The frame in colour, as the tools preview it. */
const colourOf = (i) => renderFrame({ session, state: frameState(session, i), imageData: blank(), wram: frameWram(session, i) });
/** The frame with no paint at all: every pixel on the red ramp the game's own picture uses. */
const monoOf = (i) =>
  renderFrame({ session: { ...session, groups: [], pack: new Map(), overrides: new Map() }, state: frameState(session, i), imageData: blank(), monoFallback: true, overlayGroupIds: [] });

if (rest.includes('--list')) {
  const count = Number(arg('--list')) || 20;
  const rows = [];
  for (let i = 0; i < session.frames.length; i++) {
    const state = frameState(session, i);
    if (!state) continue;
    colourOf(i);
    const info = getCompositePixelInfo();
    let lit = 0;
    for (const ch of info.char) if (ch >= 0) lit++;
    if (!lit) continue;
    const { pixels } = uncolouredMasks(state, info);
    rows.push({ label: frameLabel(session, i), coloured: 1 - pixels / lit, lit });
  }
  rows.sort((a, b) => b.coloured - a.coloured || b.lit - a.lit);
  for (const r of rows.slice(0, count)) console.log(`${(r.coloured * 100).toFixed(1).padStart(5)}%  ${String(r.lit).padStart(6)} lit  ${r.label}`);
} else {
  const number = arg('--frame');
  const out = arg('--out');
  if (!number || !out) usage('--frame and --out are both needed.');
  const index = session.frames.findIndex((_, i) => (frameLabel(session, i) || '').startsWith(`#${number} `));
  if (index < 0) usage(`No frame #${number} in this pack.`);
  const halves = [monoOf(index), colourOf(index)];
  const W = FRAME_W * SCALE * 2 + GAP;
  const H = FRAME_H * SCALE;
  const img = new Uint8Array(W * H * 4);
  for (let i = 3; i < img.length; i += 4) img[i] = 255;
  halves.forEach((half, h) => {
    const x0 = h * (FRAME_W * SCALE + GAP);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < FRAME_W * SCALE; x++) {
        const s = (((y / SCALE) | 0) * FRAME_W + ((x / SCALE) | 0)) * 4;
        const d = (y * W + x0 + x) * 4;
        // A see-through pixel is the black the screen shows behind everything.
        const a = half.data[s + 3] / 255;
        img[d] = half.data[s] * a;
        img[d + 1] = half.data[s + 1] * a;
        img[d + 2] = half.data[s + 2] * a;
      }
    }
  });
  writeFileSync(out, encodePng(W, H, img));
  console.log(`Wrote ${out}: ${frameLabel(session, index)}`);
}
