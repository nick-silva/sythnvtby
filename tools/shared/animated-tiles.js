/**
 * Animated tiles: BG art the game animates by rewriting tile slots in place (IntroCin's
 * twinkling starfield). The group claims the slots (`criteria.tileSlots`), so every step of the
 * animation is its own — each step's patterns can be painted as a phase, and the renderer
 * colours any unpainted step from the group's shade ramp (`src/shade-ramp.js`).
 */
import { getTileBytes, hashTile } from '../../src/vip-state.js';

/** Of the group's reference layout, the share of positions a frame must also draw to count. */
const MIN_LAYOUT_OVERLAP = 0.5;

/** @param {any} group */
function criteriaSets(group) {
  const c = group?.criteria || {};
  const set = (arr) => (Array.isArray(arr) && arr.length ? new Set(arr.map(Number)) : null);
  return {
    worlds: set(c.windowIds) ?? set(c.worldIds),
    layers: set(c.layers),
    hashes: set(c.hashes),
    slots: set(c.tileSlots),
  };
}

const drawEye = (d) => (Number(d.eye) === 1 ? 1 : 0);

/** @param {any} d @param {{ worlds: Set<number>|null, layers: Set<number>|null }} c */
function inScope(d, c, eye) {
  return drawEye(d) === eye && (!c.worlds || c.worlds.has(Number(d.world))) && (!c.layers || c.layers.has(Number(d.layer)));
}

/**
 * The tile slots the group's own tiles occupy on this frame: what "Animated tiles" records.
 * @param {any} state @param {any} group @param {number} [eye]
 * @returns {number[]}
 */
export function slotsForGroup(state, group, eye = 0) {
  const c = criteriaSets(group);
  if (!state?.drawList || !state.patternTable || !c.hashes) return [];
  const slots = new Set();
  for (const d of state.drawList) {
    if (!inScope(d, c, eye)) continue;
    if (c.hashes.has(hashTile(getTileBytes(state.patternTable, d.tileIndex)) >>> 0)) slots.add(Number(d.tileIndex));
  }
  return [...slots].sort((a, b) => a - b);
}

/**
 * The animation's phases among captured frames: frames whose claimed slots hold the same
 * patterns form one phase. Only frames laid out like the group's own screen count, so another
 * scene that reuses the same slots is not mistaken for a phase.
 * @param {Array<{ frameIndex: number, state: any }>} frames
 * @param {any} group @param {number} [eye]
 * @returns {Array<{ frameIndices: number[], frameIndex: number, draws: any[], hashes: number[] }>}
 */
export function animationPhases(frames, group, eye = 0) {
  const c = criteriaSets(group);
  if (!c.slots) return [];
  const seen = [];
  for (const { frameIndex, state } of frames) {
    if (!state?.drawList || !state.patternTable) continue;
    const draws = state.drawList.filter((d) => inScope(d, c, eye) && c.slots.has(Number(d.tileIndex)));
    if (!draws.length) continue;
    const hashes = draws.map((d) => hashTile(getTileBytes(state.patternTable, d.tileIndex)) >>> 0);
    const signature = [...new Set(draws.map((d, i) => `${d.tileIndex}:${hashes[i]}`))].sort().join('|');
    seen.push({ frameIndex, draws, hashes, signature, positions: new Set(draws.map((d) => `${d.x},${d.y}`)) });
  }
  if (!seen.length) return [];
  // The layout with the most claimed draws is the group's own screen.
  const reference = seen.reduce((a, b) => (b.positions.size > a.positions.size ? b : a)).positions;
  const phases = new Map();
  for (const f of seen) {
    let shared = 0;
    for (const p of f.positions) if (reference.has(p)) shared++;
    if (shared < reference.size * MIN_LAYOUT_OVERLAP) continue;
    const phase = phases.get(f.signature);
    if (phase) phase.frameIndices.push(f.frameIndex);
    else phases.set(f.signature, { frameIndices: [f.frameIndex], frameIndex: f.frameIndex, draws: f.draws, hashes: [...new Set(f.hashes)] });
  }
  return [...phases.values()];
}

/**
 * Look up a pattern's 16 bytes in whichever frame draws it, reading frames only until found.
 * @param {number} frameCount @param {(i: number) => any} stateAt
 * @returns {(hash: number) => Uint8Array|null}
 */
export function patternBytesFinder(frameCount, stateAt) {
  /** @type {Map<number, Uint8Array>} */
  const found = new Map();
  let next = 0;
  return (hash) => {
    const want = hash >>> 0;
    while (!found.has(want) && next < frameCount) {
      const st = stateAt(next++);
      if (!st?.drawList || !st.patternTable) continue;
      for (const d of st.drawList) {
        const bytes = getTileBytes(st.patternTable, d.tileIndex);
        const h = hashTile(bytes) >>> 0;
        if (!found.has(h)) found.set(h, Uint8Array.from(bytes));
      }
    }
    return found.get(want) || null;
  };
}
