import { describe, it, expect } from 'vitest';
import { overpaintSwitchHashes, wholePoseHashes, wholePoseOn, dropCoveredPoses } from './overpaint-switch.js';
import { hashTile } from './vip-state.js';

const BLANK = hashTile(new Uint8Array(16)) >>> 0;

const g = (id, hashes, windowIds = [21, 22], layers = [0]) => ({ id, criteria: { windowIds, layers, hashes } });

describe('overpaintSwitchHashes', () => {
  it('leaves out patterns another group on the same layers claims (a shared black-out tile)', () => {
    const mario = g('mario', [1, 2, 3, 900]);
    const toad = g('toad', [900, 10, 11]);
    const groups = [mario, toad];
    expect([...overpaintSwitchHashes(toad, groups)].sort()).toEqual([10, 11]);
    expect([...overpaintSwitchHashes(mario, groups)].sort()).toEqual([1, 2, 3]);
  });

  it('keeps every pattern when all are shared, or none are (null = any)', () => {
    const a = g('a', [5, 6]);
    const b = g('b', [5, 6, 7]);
    expect(overpaintSwitchHashes(a, [a, b])).toBeNull();
    const solo = g('solo', [5]);
    expect(overpaintSwitchHashes(solo, [solo])).toBeNull();
  });

  it('ignores groups on other worlds or other layers', () => {
    const toad = g('toad', [900, 10]);
    const elsewhere = g('menu', [900], [30]);
    const sprite = g('sprite', [900], [21], [2]);
    expect(overpaintSwitchHashes(toad, [toad, elsewhere, sprite])).toBeNull();
    // A group with no worlds listed is on every world.
    const toad2 = g('toad', [900, 10]);
    expect([...overpaintSwitchHashes(toad2, [toad2, g('any', [900], [])])]).toEqual([10]);
  });

  it('counts a BG group as covering its worlds’ scaled (affine) draws', () => {
    const bg = g('bg', [900, 10], [26], [0]);
    const affine = g('affine', [900], [26], [1]);
    expect([...overpaintSwitchHashes(bg, [bg, affine])]).toEqual([10]);
  });

  it('does not count a pose group’s patterns as shared (it is a part of its character)', () => {
    const luigi = g('luigi', [1, 2, 3, 900]);
    const mario = g('mario', [900, 50]);
    const pose = { ...g('luigi-pose', [1, 2]), wholePose: true };
    expect([...overpaintSwitchHashes(luigi, [luigi, mario, pose])].sort()).toEqual([1, 2, 3]);
  });
});

describe('whole-pose groups', () => {
  const pose = (id, hashes) => ({ ...g(id, hashes), wholePose: true });

  it('needs every one of its patterns, blank ones left out (they are never on screen)', () => {
    const p = pose('p', [1, 2, BLANK]);
    expect([...wholePoseHashes(p)].sort()).toEqual([1, 2]);
    expect(wholePoseOn(p, new Set([1, 2, 77]))).toBe(true);
    expect(wholePoseOn(p, new Set([1, 77]))).toBe(false);
  });

  it('is off for groups without the setting or without patterns', () => {
    expect(wholePoseHashes(g('plain', [1, 2]))).toBeNull();
    expect(wholePoseHashes(pose('empty', []))).toBeNull();
    expect(wholePoseHashes(pose('blank', [BLANK]))).toBeNull();
  });

  it('drops a pose whose patterns another pose shown on the same world holds too', () => {
    const small = pose('small', [1, 2]);
    const big = pose('big', [1, 2, 3]);
    const other = pose('other', [1, 2]);
    const plain = g('plain', [1]);
    const entries = [
      { world: 21, group: small },
      { world: 21, group: big },
      { world: 22, group: other },
      { world: 21, group: plain },
    ];
    expect(dropCoveredPoses(entries).map((e) => e.group.id)).toEqual(['big', 'other', 'plain']);
  });
});
