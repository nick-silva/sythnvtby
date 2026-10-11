/**
 * How a frame is split across worlds and layers, and whether each can take an anchor.
 *
 * Use this before deciding how to colourize a screen. It answers:
 *  - which world/layer combinations exist, and how many patterns each draws
 *  - which patterns are shared across worlds (those cannot take a per-pattern colour)
 *  - whether a world contains a pattern drawn exactly once, which is what an anchored
 *    overlay requires; a world with none can only be coloured by a group of its own
 *
 *   npm run bench:worlds
 *   BENCH_FRAME=Title npm run bench:worlds
 */
import { loadBenchFrame, repoModule } from './harness.mjs';

const { getTileBytes, hashTile, isBlankTile } = await import(repoModule('src/vip-state.js'));

const { index: frameIndex, state, draws } = await loadBenchFrame();

/** The single shade of a solid tile, or null when it has more than one. */
function solidShade(bytes) {
  const v = [];
  for (let py = 0; py < 8; py++) {
    const w = bytes[py * 2] | (bytes[py * 2 + 1] << 8);
    for (let px = 0; px < 8; px++) v.push((w >> (px * 2)) & 3);
  }
  return v.every((x) => x === v[0]) ? v[0] : null;
}

const byWorld = new Map();
const patternWorlds = new Map();
const bytesOf = new Map();
for (const d of draws) {
  const bytes = getTileBytes(state.patternTable, d.tileIndex);
  if (!bytes || isBlankTile(bytes)) continue;
  const h = hashTile(bytes) >>> 0;
  bytesOf.set(h, bytes);
  const key = `w${d.world}/l${d.layer}`;
  if (!byWorld.has(key)) byWorld.set(key, new Map());
  byWorld.get(key).set(h, (byWorld.get(key).get(h) || 0) + 1);
  if (!patternWorlds.has(h)) patternWorlds.set(h, new Set());
  patternWorlds.get(h).add(key);
}

console.log(`frame ${frameIndex} — ${byWorld.size} world/layer combination(s), ${patternWorlds.size} patterns\n`);
for (const [key, counts] of [...byWorld].sort((a, b) => b[1].size - a[1].size)) {
  const total = [...counts.values()].reduce((a, c) => a + c, 0);
  const onlyHere = [...counts].filter(([h]) => patternWorlds.get(h).size === 1);
  const anchors = onlyHere.filter(([, n]) => n === 1);
  console.log(
    `  ${key.padEnd(9)} ${String(total).padStart(4)} tiles · ${String(counts.size).padStart(3)} pattern(s)`
    + ` · ${onlyHere.length} only here · ${anchors.length} anchor candidate(s)`,
  );
}

const shared = [...patternWorlds].filter(([, ws]) => ws.size > 1);
console.log(`\npatterns drawn in more than one world/layer: ${shared.length}`);
for (const [h, ws] of shared.sort((a, b) => b[1].size - a[1].size).slice(0, 8)) {
  const sh = solidShade(bytesOf.get(h));
  console.log(`  #${h.toString(16)}${sh !== null ? ` (SOLID shade ${sh})` : ''} in ${ws.size}: ${[...ws].join(' ')}`);
}

console.log(
  '\nA world with 0 anchor candidates cannot use an anchored overlay: no pattern in it is\n'
  + 'drawn exactly once. Give it a group with its own tileColors instead.',
);
