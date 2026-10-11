/**
 * What each colorization strategy costs to composite, on the same frame.
 *
 * The question this answers: when a heavily layered screen drops frames, is it the strategy
 * (per-pattern paint / world-scoped groups / position overrides / anchored overlays /
 * group-scoped colour) or the implementation? Run it before and after a compositor change.
 *
 *   npm run bench
 *   BENCH_FRAME=Title npm run bench
 */
import { loadBenchFrame, time, budgetNote, repoModule, W, H } from './harness.mjs';

const { compositeColorFrame, DEFAULT_FADE_RESPONSE } = await import(repoModule('src/color-layer.js'));
const { blendPainterV2VipOverlaysIntoImageData } = await import(repoModule('src/painter-v2-vip-overlay.js'));
const { withGroupTileColor } = await import(repoModule('src/group-tile-colors.js'));
const { getTileBytes, hashTile, isBlankTile } = await import(repoModule('src/vip-state.js'));

const { index: frameIndex, state, draws } = await loadBenchFrame();

// Every distinct pattern on this frame, and which worlds draw it.
const worlds = new Map();
const patterns = new Map();
for (const d of draws) {
  const bytes = getTileBytes(state.patternTable, d.tileIndex);
  if (!bytes || isBlankTile(bytes)) continue;
  const h = hashTile(bytes) >>> 0;
  patterns.set(h, (patterns.get(h) || 0) + 1);
  if (!worlds.has(d.world)) worlds.set(d.world, new Set());
  worlds.get(d.world).add(h);
}
// Worlds with enough distinct patterns to be worth grouping, which is what a person would do.
const bigWorlds = [...worlds].filter(([, hs]) => hs.size >= 4).slice(0, 12);

console.log(
  `frame ${frameIndex} · ${draws.length} draws (left eye) · ${patterns.size} patterns · `
  + `${bigWorlds.length} worlds grouped`,
);

const pack = new Map();
for (const h of patterns.keys()) pack.set(h, new Uint8Array(256).fill(180));
const img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };

const composite = (groups, overrides) =>
  compositeColorFrame(
    state, pack, img,
    {
      eye: 0,
      overrides,
      groups,
      brightnessScale: DEFAULT_FADE_RESPONSE,
      stripClip: false,
      objXOffset: 0,
      applyOffsetToAllDraws: false,
      bgXOffset: 0,
      deduplicateDraws: false,
      gameStatePools: [],
      wram: null,
      unpackedMode: 'transparent',
      sortDrawsByWorld: true,
      painterV2Rules: null,
      painterV2VariantId: null,
      unpackedMinCoverage: 1,
      diagnosticMonoFallback: false,
      renderUnpackedFallback: true,
      monoFallbackGain: 1,
    },
  );

console.log('\n--- strategies ---');
time('1. per-pattern paint only (no groups)', () => composite([], []));

// World+layer scoped groups with no colour of their own: the membership test on its own.
const worldGroups = bigWorlds.map(([world, hs], i) => ({
  id: `g${i}`,
  name: `world ${world}`,
  authoringKind: 'bg',
  criteria: { windowIds: [world], layers: [0], hashes: [...hs] },
}));
time(`2. + ${worldGroups.length} world-scoped groups (no colour)`, () => composite(worldGroups, []));

// One position override per pattern per world, each tied to its group.
const overrides = [];
for (const [i, [, hs]] of bigWorlds.entries()) {
  for (const h of hs) {
    overrides.push({
      hash: h, xMin: 0, xMax: W, yMin: 0, yMax: H, layer: 0, groupId: `g${i}`,
      rgba: new Uint8Array(256).fill(90 + i),
    });
  }
}
time(`3. + ${overrides.length} group-scoped position overrides`, () => composite(worldGroups, overrides));

// Anchored overlays, worst case: every pixel of every overlay is painted.
const anchored = worldGroups.map((g) => ({ ...g, anchorHash: g.criteria.hashes[0] }));
const overlayFull = new Map();
for (const g of anchored) {
  const buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 120; buf[i + 1] = 60; buf[i + 2] = 200; buf[i + 3] = 255;
  }
  overlayFull.set(g.id, new Map([[0, buf]]));
}
time(`4. + ${anchored.length} anchored overlays (full-frame paint)`, () => {
  composite(anchored, []);
  blendPainterV2VipOverlaysIntoImageData(state, img, 0, anchored, overlayFull);
});

// Anchored overlays, realistic: each covers only the cells its own group draws.
const overlaySparse = new Map();
for (const [i, g] of anchored.entries()) {
  const hs = new Set(g.criteria.hashes);
  const buf = new Uint8Array(W * H * 4);
  for (const d of draws) {
    if (d.world !== bigWorlds[i][0]) continue;
    const bytes = getTileBytes(state.patternTable, d.tileIndex);
    if (!bytes || isBlankTile(bytes) || !hs.has(hashTile(bytes) >>> 0)) continue;
    for (let py = 0; py < 8; py++) {
      const y = d.y + py;
      if (y < 0 || y >= H) continue;
      for (let px = 0; px < 8; px++) {
        const x = d.x + px;
        if (x < 0 || x >= W) continue;
        const o = (y * W + x) * 4;
        buf[o] = 120; buf[o + 1] = 60; buf[o + 2] = 200; buf[o + 3] = 255;
      }
    }
  }
  overlaySparse.set(g.id, new Map([[0, buf]]));
}
time(`5. + ${anchored.length} anchored overlays (own tiles only)`, () => {
  composite(anchored, []);
  blendPainterV2VipOverlaysIntoImageData(state, img, 0, anchored, overlaySparse);
});
time('   (that overlay blending alone)', () =>
  blendPainterV2VipOverlaysIntoImageData(state, img, 0, anchored, overlaySparse));

// Group-scoped colour: each group carries colours for the patterns it owns.
let painted = 0;
const groupPainted = worldGroups.map((g, i) => {
  let out = g;
  for (const h of g.criteria.hashes) {
    out = withGroupTileColor(out, h, new Uint8Array(256).fill(60 + i));
    painted++;
  }
  return out;
});
time(`6. + ${painted} group-scoped tile colours (${groupPainted.length} groups)`, () =>
  composite(groupPainted, []));

budgetNote();
