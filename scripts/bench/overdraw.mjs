/**
 * How much of a frame's pixel work is overdrawn, and whether culling it would pay.
 *
 * A heavily layered screen looks like it should benefit from occlusion culling: most of what
 * the back layers draw is hidden. This measures the overdraw, then races a front-to-back pass
 * that skips already-claimed pixels against the back-to-front pass the compositor does today.
 * Also times the coverage prepass, which is pure overhead whenever every tile is painted.
 *
 *   npm run bench:overdraw
 */
import { loadBenchFrame, time, repoModule, W, H } from './harness.mjs';

const { getTileBytes, hashTile, isBlankTile } = await import(repoModule('src/vip-state.js'));

const { index: frameIndex, state, draws } = await loadBenchFrame();

const coverage = new Uint16Array(W * H);
let litWrites = 0;
let blankDraws = 0;
for (const d of draws) {
  const bytes = getTileBytes(state.patternTable, d.tileIndex);
  if (!bytes || isBlankTile(bytes)) {
    blankDraws++;
    continue;
  }
  for (let py = 0; py < 8; py++) {
    const word = bytes[py * 2] | (bytes[py * 2 + 1] << 8);
    for (let px = 0; px < 8; px++) {
      if (((word >> (px * 2)) & 3) === 0) continue;
      const ix = d.x + px;
      const iy = d.y + py;
      if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;
      litWrites++;
      coverage[iy * W + ix]++;
    }
  }
}
let touched = 0;
let deepest = 0;
for (let i = 0; i < coverage.length; i++) {
  if (coverage[i] > 0) touched++;
  if (coverage[i] > deepest) deepest = coverage[i];
}

console.log(`frame ${frameIndex}: ${draws.length} draws (${blankDraws} blank, ${draws.length - blankDraws} live)`);
console.log(`lit pixel writes:        ${litWrites}`);
console.log(`distinct pixels touched: ${touched} of ${W * H} (${((touched / (W * H)) * 100).toFixed(1)}% of screen)`);
console.log(`overdraw factor:         ${(litWrites / Math.max(1, touched)).toFixed(2)}x · deepest stack ${deepest}`);
console.log(`a perfect cull would skip ${litWrites - touched} writes (${(((litWrites - touched) / litWrites) * 100).toFixed(1)}%)`);
console.log(`\nthe coverage prepass walks ${draws.length * 64} cells before the real pass`);

console.log('\n--- isolated costs ---');

const cov = new Uint16Array(W * H);
time('coverage prepass alone', () => {
  cov.fill(0);
  for (const d of draws) {
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const ix = d.x + px;
        const iy = d.y + py;
        if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;
        cov[iy * W + ix]++;
      }
    }
  }
});

const pack = new Map();
for (const d of draws) {
  const bytes = getTileBytes(state.patternTable, d.tileIndex);
  if (bytes && !isBlankTile(bytes)) pack.set(hashTile(bytes) >>> 0, true);
}
time('deciding whether that prepass is needed at all', () => {
  const seen = new Set();
  let allPainted = true;
  for (const d of draws) {
    if (seen.has(d.tileIndex)) continue;
    seen.add(d.tileIndex);
    const bytes = getTileBytes(state.patternTable, d.tileIndex);
    if (!bytes || isBlankTile(bytes)) continue;
    if (!pack.has(hashTile(bytes) >>> 0)) allPainted = false;
  }
  return allPainted;
});

const claimed = new Uint8Array(W * H);
const out = new Uint8ClampedArray(W * H * 4);
time('front-to-back cull + write', () => {
  claimed.fill(0);
  for (let k = draws.length - 1; k >= 0; k--) {
    const d = draws[k];
    const bytes = getTileBytes(state.patternTable, d.tileIndex);
    if (!bytes || isBlankTile(bytes)) continue;
    for (let py = 0; py < 8; py++) {
      const word = bytes[py * 2] | (bytes[py * 2 + 1] << 8);
      for (let px = 0; px < 8; px++) {
        if (((word >> (px * 2)) & 3) === 0) continue;
        const ix = d.x + px;
        const iy = d.y + py;
        if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;
        const p = iy * W + ix;
        if (claimed[p]) continue;
        claimed[p] = 1;
        out[p * 4] = 120;
        out[p * 4 + 3] = 255;
      }
    }
  }
});

time('back-to-front write (what the compositor does)', () => {
  for (let k = 0; k < draws.length; k++) {
    const d = draws[k];
    const bytes = getTileBytes(state.patternTable, d.tileIndex);
    if (!bytes || isBlankTile(bytes)) continue;
    for (let py = 0; py < 8; py++) {
      const word = bytes[py * 2] | (bytes[py * 2 + 1] << 8);
      for (let px = 0; px < 8; px++) {
        if (((word >> (px * 2)) & 3) === 0) continue;
        const ix = d.x + px;
        const iy = d.y + py;
        if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;
        const p = iy * W + ix;
        out[p * 4] = 120;
        out[p * 4 + 3] = 255;
      }
    }
  }
});

console.log(
  '\nRead the last two together: culling only pays if it beats the write it replaces.\n'
  + 'A typed-array store is about as cheap as the mask test that would skip it.',
);
