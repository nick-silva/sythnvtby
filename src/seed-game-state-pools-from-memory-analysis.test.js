import { describe, it, expect } from 'vitest';
import {
  seedGameStatePoolsFromMemoryAnalysis,
  shortPoolLabelFromAnalysisKey,
} from './seed-game-state-pools-from-memory-analysis.js';

describe('seedGameStatePoolsFromMemoryAnalysis', () => {
  it('returns [] for missing or invalid memoryAnalysis', () => {
    expect(seedGameStatePoolsFromMemoryAnalysis(null)).toEqual([]);
    expect(seedGameStatePoolsFromMemoryAnalysis(undefined)).toEqual([]);
    expect(seedGameStatePoolsFromMemoryAnalysis({})).toEqual([]);
    expect(seedGameStatePoolsFromMemoryAnalysis({ topCandidatesByState: [] })).toEqual([]);
  });

  it('creates one pool per state with __default__ variant from first candidate', () => {
    const ma = {
      topCandidatesByState: {
        Title: [
          { offset: 0x1234, expectedValue: 0xab, score: 5 },
          { offset: 0x5678, expectedValue: 0x01, score: 3 },
        ],
        Menu: [{ offset: 100, expectedValue: 7, score: 2 }],
      },
    };
    const pools = seedGameStatePoolsFromMemoryAnalysis(ma);
    expect(pools.length).toBe(2);
    const menu = pools.find((p) => p.id === 'pool-menu');
    const title = pools.find((p) => p.id === 'pool-title');
    expect(menu?.label).toBe('Menu');
    expect(title?.label).toBe('Title');
    expect(title?.analysisSource).toBe('memoryAnalysis');
    expect(title?.analysisStateKey).toBe('Title');
    const v0 = title?.variants?.[0];
    expect(v0?.id).toBe('__default__');
    expect(v0?.label).toBe('Default');
    expect(v0?.ramConditions?.[0]).toMatchObject({
      offset: 0x1234,
      expectedValue: 0xab,
      stateName: 'Title',
      source: 'memoryAnalysis',
    });
  });

  it('skips rows with invalid offset and uses next candidate', () => {
    const ma = {
      topCandidatesByState: {
        X: [{ offset: -1, expectedValue: 0 }, { offset: 10, expectedValue: 3, score: 1 }],
      },
    };
    const [p] = seedGameStatePoolsFromMemoryAnalysis(ma);
    expect(p.variants[0].ramConditions[0]).toMatchObject({ offset: 10, expectedValue: 3 });
  });

  it('dedupes pool ids when slug collides', () => {
    const ma = {
      topCandidatesByState: {
        'A B': [{ offset: 1, expectedValue: 2 }],
        'A-B': [{ offset: 2, expectedValue: 3 }],
      },
    };
    const pools = seedGameStatePoolsFromMemoryAnalysis(ma);
    const ids = pools.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith('pool-a-b'))).toBe(true);
  });

  it('keeps full analysisStateKey but short label before slash or dash', () => {
    const ma = {
      topCandidatesByState: {
        'Title / attract / f-abc': [{ offset: 1, expectedValue: 2 }],
      },
    };
    const [p] = seedGameStatePoolsFromMemoryAnalysis(ma);
    expect(p.label).toBe('Title');
    expect(p.analysisStateKey).toBe('Title / attract / f-abc');
  });

  it('truncates long single-segment keys for label', () => {
    const long = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    expect(shortPoolLabelFromAnalysisKey(long).length).toBeLessThanOrEqual(28);
    expect(shortPoolLabelFromAnalysisKey(long).endsWith('…')).toBe(true);
  });
});

describe('shortPoolLabelFromAnalysisKey', () => {
  it('takes first segment before en dash', () => {
    expect(shortPoolLabelFromAnalysisKey(`State 001 \u2013 submenu \u2013 frame`)).toBe('State 001');
  });
});
