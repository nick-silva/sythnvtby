/** Picks stable test targets (mirrored sprite tile, plain BG tile, edge sprite) from PACK_ANNOTATED's frames. */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArtPack } from '../../src/art-pack.js';
import { deserializeVIPState } from '../../src/vip-dump.js';
import { getTileBytes, hashTile, isBlankTile } from '../../src/vip-state.js';
import { OUT, PACK_ANNOTATED } from './harness.mjs';

const res = await parseArtPack((await readFile(PACK_ANNOTATED)).buffer);
const frames = (res.vipStatesFolder || []).map((f) => ({
  name: f.name,
  json: typeof f.json === 'string' ? f.json : new TextDecoder().decode(f.json),
}));
const registry = res.manifest?.frameRegistry || [];

function inkMask(pt, d) {
  const tb = getTileBytes(pt, d.tileIndex);
  const px = [];
  for (let ly = 0; ly < 8; ly++) {
    const w = tb[ly * 2] | (tb[ly * 2 + 1] << 8);
    for (let lx = 0; lx < 8; lx++) px.push(((w >> (lx * 2)) & 3) !== 0);
  }
  return px;
}

const out = { frameCount: frames.length };
const inBounds = (d) => d.x >= 8 && d.y >= 8 && d.x <= 368 && d.y <= 208;
for (const f of frames) {
  const state = deserializeVIPState(JSON.parse(f.json));
  const pt = state.patternTable;
  const draws = state.drawList
    .filter((d) => (d.eye ?? 0) === 0)
    .map((d) => ({ ...d, hash: hashTile(getTileBytes(pt, d.tileIndex)) >>> 0 }));
  const count = new Map();
  for (const d of draws) count.set(`${d.layer}:${d.hash}`, (count.get(`${d.layer}:${d.hash}`) || 0) + 1);
  const unique = (d) => count.get(`${d.layer}:${d.hash}`) === 1;
  const stem = f.name.replace(/\.json$/, '');
  const reg = registry.find((r) => String(r.vipStateFile || '').includes(stem));

  if (!out.flippedObj) {
    const d = draws.find((d) => d.layer === 2 && d.flipH && !d.flipV && inBounds(d) && unique(d));
    if (d && reg?.frameId) out.flippedObj = { frame: stem, frameId: reg.frameId, x: d.x, y: d.y, world: d.world, ink: inkMask(pt, d) };
  }
  if (!out.edgeObj) {
    const d = draws.find((d) => d.layer === 2 && !inBounds(d) && d.x >= 0 && d.y >= 0 && d.x <= 376 && d.y <= 216);
    if (d) out.edgeObj = { frame: stem, x: d.x, y: d.y };
  }
  if (!out.blankDraw) {
    const d = draws.find((d) => inBounds(d) && isBlankTile(getTileBytes(pt, d.tileIndex)));
    if (d) {
      const blanks = draws.filter((x) => isBlankTile(getTileBytes(pt, x.tileIndex))).length;
      out.blankDraw = { frame: stem, x: d.x, y: d.y, blanks, total: draws.length };
    }
  }
  if (!out.bgTile) {
    const d = draws.find((d) => d.layer === 0 && !d.flipH && !d.flipV && inBounds(d) && unique(d) && inkMask(pt, d).filter(Boolean).length > 20);
    if (d) out.bgTile = { frame: stem, x: d.x, y: d.y, world: d.world, ink: inkMask(pt, d) };
  }
}

const missing = ['flippedObj', 'edgeObj', 'bgTile', 'blankDraw'].filter((k) => !out[k]);
if (missing.length) {
  console.error(`targets: pack has no frame with ${missing.join(', ')} — use a pack with gameplay captures (VB_PACK_ANNOTATED)`);
  process.exit(1);
}
await writeFile(`${OUT}/vbstate-sample.json`, frames[frames.length - 1].json);
await writeFile(`${OUT}/targets.json`, JSON.stringify(out));
console.log(`targets: ${frames.length} frames · mirrored OBJ ${out.flippedObj.frame} · BG ${out.bgTile.frame} · edge ${out.edgeObj.frame}`);
