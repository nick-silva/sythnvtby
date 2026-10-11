import { describe, it, expect } from 'vitest';
import { slotsForGroup, animationPhases, patternBytesFinder } from '../tools/shared/animated-tiles.js';
import { hashTile } from './vip-state.js';

/** A frame whose tile slots hold the given one-byte patterns, drawn where `draws` say. */
function frame(slotBytes, draws) {
  const patternTable = new Uint8Array(2048 * 16);
  for (const [slot, b] of Object.entries(slotBytes)) patternTable[Number(slot) * 16] = b;
  return { patternTable, drawList: draws.map((d) => ({ eye: 0, layer: 0, world: 30, ...d })) };
}
const hashOf = (b) => {
  const t = new Uint8Array(16);
  t[0] = b;
  return hashTile(t) >>> 0;
};
const STARS = [
  { tileIndex: 5, x: 8, y: 8 },
  { tileIndex: 6, x: 40, y: 8 },
  { tileIndex: 5, x: 80, y: 40 },
];
const group = (extra = {}) => ({
  id: 'stars',
  criteria: { windowIds: [30], layers: [0], hashes: [hashOf(0x03), hashOf(0x0c)], ...extra },
});

describe('slotsForGroup', () => {
  it('lists the tile slots the group’s tiles sit in on this frame', () => {
    const st = frame({ 5: 0x03, 6: 0x0c, 7: 0x03 }, [...STARS, { tileIndex: 7, x: 0, y: 0, world: 4 }]);
    expect(slotsForGroup(st, group())).toEqual([5, 6]);
  });
});

describe('animationPhases', () => {
  const g = group({ tileSlots: [5, 6] });
  const bright = frame({ 5: 0x03, 6: 0x0c }, STARS);
  const dim = frame({ 5: 0x02, 6: 0x08 }, STARS);

  it('puts frames whose slots hold the same patterns in one phase', () => {
    const phases = animationPhases([bright, dim, bright].map((state, frameIndex) => ({ frameIndex, state })), g);
    expect(phases.map((p) => p.frameIndices)).toEqual([[0, 2], [1]]);
    expect(phases[1].draws).toHaveLength(3);
  });

  it('ignores another screen that reuses the same slots somewhere else', () => {
    const elsewhere = frame({ 5: 0x01, 6: 0x01 }, [{ tileIndex: 5, x: 200, y: 200 }]);
    const phases = animationPhases([{ frameIndex: 0, state: bright }, { frameIndex: 1, state: elsewhere }], g);
    expect(phases).toHaveLength(1);
  });

  it('finds no phases for a group that claims no slots', () => {
    expect(animationPhases([{ frameIndex: 0, state: bright }], group())).toEqual([]);
  });
});

describe('patternBytesFinder', () => {
  it('finds a pattern’s bytes in whichever frame draws it, reading frames only as needed', () => {
    let reads = 0;
    const states = [frame({ 5: 0x03 }, [STARS[0]]), frame({ 6: 0x0c }, [STARS[1]])];
    const find = patternBytesFinder(states.length, (i) => (reads++, states[i]));
    expect(find(hashOf(0x03))?.[0]).toBe(0x03);
    expect(reads).toBe(1);
    expect(find(hashOf(0x0c))?.[0]).toBe(0x0c);
    expect(find(hashOf(0x7f))).toBeNull();
  });
});
