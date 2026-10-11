import { describe, it, expect } from 'vitest';
import { splitPosePatterns } from './pose-clear.js';

describe('splitPosePatterns', () => {
  it('keeps the patterns only this pose uses apart from the ones it shares', () => {
    const out = splitPosePatterns([1, 2, 3, 4], [
      { name: 'Walk B', patterns: [2, 9] },
      { name: 'Jump', patterns: [2, 3] },
    ]);
    expect(out.own).toEqual([1, 4]);
    expect(out.shared).toEqual([2, 3]);
    expect(out.sharedWith).toEqual([{ name: 'Walk B', count: 1 }, { name: 'Jump', count: 2 }]);
  });

  it('is all its own when nothing else uses its patterns, and all shared when everything does', () => {
    expect(splitPosePatterns([5, 6], [{ name: 'X', patterns: [7] }])).toMatchObject({ own: [5, 6], shared: [], sharedWith: [] });
    expect(splitPosePatterns([5, 6], [{ name: 'X', patterns: [5, 6] }])).toMatchObject({ own: [], shared: [5, 6] });
  });

  it('compares hashes unsigned and drops repeats', () => {
    expect(splitPosePatterns([-1, 0xffffffff], [])).toMatchObject({ own: [0xffffffff] });
  });
});
