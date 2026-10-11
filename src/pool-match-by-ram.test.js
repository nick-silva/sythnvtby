import { describe, it, expect } from 'vitest';
import { matchPoolVariantsByRam, bestPoolVariantByRam, comparePoolSuggestions } from './pool-match-by-ram.js';

const wramWith = (bytes) => {
  const w = new Uint8Array(0x10000);
  for (const [off, val] of Object.entries(bytes)) w[Number(off)] = val;
  return w;
};

const pools = [
  {
    id: 'pool-splash',
    label: 'Splash',
    variants: [{ id: '__default__', label: 'Default', ramConditions: [{ offset: 0x0500, expectedValue: 3 }] }],
  },
  {
    id: 'pool-level01',
    label: 'Level01',
    variants: [
      {
        id: '__default__',
        label: 'Default',
        ramConditions: [
          { offset: 0x0500, expectedValue: 7 },
          { offset: 0x0a12, expectedValue: 1 },
        ],
      },
    ],
  },
];

describe('matchPoolVariantsByRam', () => {
  it('finds the pool whose fingerprint holds for this WRAM', () => {
    const hits = matchPoolVariantsByRam(pools, wramWith({ 0x0500: 3 }));
    expect(hits.map((h) => h.poolId)).toEqual(['pool-splash']);
    expect(hits[0].conditionCount).toBe(1);
  });

  it('requires every condition of a multi-byte fingerprint', () => {
    expect(matchPoolVariantsByRam(pools, wramWith({ 0x0500: 7 })).length).toBe(0);
    const both = matchPoolVariantsByRam(pools, wramWith({ 0x0500: 7, 0x0a12: 1 }));
    expect(both.map((h) => h.poolId)).toEqual(['pool-level01']);
  });

  it('returns nothing for a frame with no WRAM dump or a short one', () => {
    expect(matchPoolVariantsByRam(pools, null)).toEqual([]);
    expect(matchPoolVariantsByRam(pools, new Uint8Array(0x100))).toEqual([]);
  });

  it('ignores variants with no conditions — matching everything proves nothing', () => {
    const open = [{ id: 'pool-any', label: 'Any', variants: [{ id: '__default__', label: 'Default' }] }];
    expect(matchPoolVariantsByRam(open, wramWith({}))).toEqual([]);
  });

  it('tolerates malformed pools', () => {
    expect(matchPoolVariantsByRam(null, wramWith({}))).toEqual([]);
    expect(matchPoolVariantsByRam([{ variants: [{ id: 'v' }] }, { id: 'p' }], wramWith({}))).toEqual([]);
  });
});

describe('bestPoolVariantByRam', () => {
  it('prefers the most specific fingerprint when several match', () => {
    const overlapping = [
      pools[0],
      {
        id: 'pool-splash-intro',
        label: 'Splash intro',
        variants: [
          {
            id: '__default__',
            label: 'Default',
            ramConditions: [
              { offset: 0x0500, expectedValue: 3 },
              { offset: 0x0600, expectedValue: 9 },
            ],
          },
        ],
      },
    ];
    const { match, all, ambiguous } = bestPoolVariantByRam(overlapping, wramWith({ 0x0500: 3, 0x0600: 9 }));
    expect(match.poolId).toBe('pool-splash-intro');
    expect(all.length).toBe(2);
    expect(ambiguous).toBe(false);
  });

  it('reports ambiguity when equally specific fingerprints both match', () => {
    const twins = [
      pools[0],
      {
        id: 'pool-twin',
        label: 'Twin',
        variants: [{ id: '__default__', label: 'Default', ramConditions: [{ offset: 0x0500, expectedValue: 3 }] }],
      },
    ];
    const { match, ambiguous } = bestPoolVariantByRam(twins, wramWith({ 0x0500: 3 }));
    expect(match).not.toBeNull();
    expect(ambiguous).toBe(true);
  });

  it('reports no match rather than guessing', () => {
    expect(bestPoolVariantByRam(pools, wramWith({ 0x0500: 99 }))).toEqual({ match: null, all: [], ambiguous: false });
  });
});

describe('comparePoolSuggestions', () => {
  const byRam = { poolId: 'pool-splash', variantId: '__default__' };
  it('classifies agreement and disagreement', () => {
    expect(comparePoolSuggestions({ poolId: 'pool-splash', variantId: '__default__' }, byRam)).toBe('agree');
    expect(comparePoolSuggestions({ poolId: 'pool-level01', variantId: '__default__' }, byRam)).toBe('conflict');
    expect(comparePoolSuggestions(null, byRam)).toBe('ram-only');
    expect(comparePoolSuggestions({ poolId: 'pool-splash', variantId: '__default__' }, null)).toBe('name-only');
    expect(comparePoolSuggestions(null, null)).toBe('none');
  });
});
