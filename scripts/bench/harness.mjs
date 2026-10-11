/**
 * Shared setup for the colorization benchmarks (`npm run bench`).
 *
 * These measure the cost of compositing one colourized frame, so a rendering slowdown can be
 * attributed to a strategy (per-pattern paint, group-scoped colour, anchored overlays) rather
 * than guessed at. See docs/reference/colorization-performance.md for the recorded results.
 *
 * Local files: VB_PACK_ANNOTATED (defaults to the parent workspace, like the e2e harness).
 * Pick the frame with BENCH_FRAME (a name to match, default "IntroCin" — the worst case).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const repoModule = (rel) => pathToFileURL(resolve(REPO_ROOT, rel)).href;

const workspace = resolve(REPO_ROOT, '..');
export const PACK = process.env.VB_PACK_ANNOTATED || resolve(workspace, 'marioclash-annotated.vbpack');
export const FRAME_MATCH = process.env.BENCH_FRAME || 'IntroCin';

export const W = 384;
export const H = 224;

/**
 * The VIP state of the first frame whose state name matches, plus its draws for the left eye.
 * Exits with a readable message rather than a stack trace when the pack is missing.
 */
export async function loadBenchFrame() {
  if (!existsSync(PACK)) {
    console.error(`No pack at ${PACK}\nSet VB_PACK_ANNOTATED to a .vbpack with captured frames.`);
    process.exit(1);
  }
  const { loadPackSession, frameState } = await import(repoModule('tools/shared/pack-session.js'));
  const buf = readFileSync(PACK);
  const session = await loadPackSession(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'v3');
  const re = new RegExp(FRAME_MATCH, 'i');
  const index = session.frames.findIndex((f) => re.test(f.registryEntry?.stateName || ''));
  if (index < 0) {
    const names = [...new Set(session.frames.map((f) => f.registryEntry?.stateName).filter(Boolean))];
    console.error(`No frame matching /${FRAME_MATCH}/i. Frames in this pack: ${names.join(', ')}`);
    process.exit(1);
  }
  const state = frameState(session, index);
  const draws = state.drawList.filter((d) => (d.eye ?? 0) === 0);
  return { session, index, state, draws };
}

/**
 * Run `fn` repeatedly and report the mean. Warms up once first, because the first call pays
 * for lazily-built caches that a real frame loop would only pay once.
 *
 * @param {string} label @param {() => unknown} fn @param {number} [iterations]
 */
export function time(label, fn, iterations = 40) {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = (performance.now() - t0) / iterations;
  console.log(`  ${label.padEnd(50)} ${ms.toFixed(2)} ms  (${(1000 / ms).toFixed(0)} fps budget)`);
  return ms;
}

/** A frame budget line, so a number can be read against what the hardware actually needs. */
export function budgetNote() {
  console.log('\nThe Virtual Boy runs at 50 Hz: 20 ms per frame, per eye rendered.');
}
