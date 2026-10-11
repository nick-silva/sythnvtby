import { describe, it, expect } from 'vitest';
import { ramConditionsSatisfied, normalizeGroupRamConditionsList, resolveEffectiveRamConditionsForGroup } from './color-layer.js';

describe('ramConditionsSatisfied', () => {
  it('returns true when there are no conditions', () => {
    const wram = new Uint8Array(0x10000);
    expect(ramConditionsSatisfied(wram, null)).toBe(true);
    expect(ramConditionsSatisfied(wram, [])).toBe(true);
  });

  it('returns false when conditions exist but wram is null', () => {
    expect(ramConditionsSatisfied(null, [{ offset: 0, expectedValue: 0 }])).toBe(false);
  });

  it('returns false when wram is shorter than 64K', () => {
    const wram = new Uint8Array(0x100);
    expect(ramConditionsSatisfied(wram, [{ offset: 0, expectedValue: 1 }])).toBe(false);
  });

  it('matches expected bytes', () => {
    const wram = new Uint8Array(0x10000);
    wram[0x0500] = 0x03;
    wram[0x0400] = 0xff;
    expect(ramConditionsSatisfied(wram, [{ offset: 0x0500, expectedValue: 3 }])).toBe(true);
    expect(ramConditionsSatisfied(wram, [{ offset: 0x0500, expectedValue: 4 }])).toBe(false);
    expect(
      ramConditionsSatisfied(wram, [
        { offset: 0x0500, expectedValue: 3 },
        { offset: 0x0400, expectedValue: 0xff },
      ]),
    ).toBe(true);
  });
});

describe('normalizeGroupRamConditionsList', () => {
  it('parses array form', () => {
    const g = { id: 'a', ramConditions: [{ offset: 10, expectedValue: 0xab }] };
    expect(normalizeGroupRamConditionsList(g)).toEqual([{ offset: 10, expectedValue: 0xab }]);
  });

  it('parses legacy record with hex key', () => {
    const g = { id: 'a', ramConditions: { '0x500': 3 } };
    expect(normalizeGroupRamConditionsList(g)).toEqual([{ offset: 0x500, expectedValue: 3 }]);
  });
});

describe('resolveEffectiveRamConditionsForGroup', () => {
  const pools = [
    {
      id: 'pool-a',
      label: 'A',
      variants: [
        { id: 'var-1', label: 'One', ramConditions: [{ offset: 0x200, expectedValue: 7 }] },
        { id: 'var-2', label: 'Two', ramConditions: [] },
      ],
    },
  ];

  it('prefers variant recipe when statePoolId + stateVariantId resolve', () => {
    const g = { id: 'g', statePoolId: 'pool-a', stateVariantId: 'var-1' };
    expect(resolveEffectiveRamConditionsForGroup(g, pools)).toEqual([{ offset: 0x200, expectedValue: 7 }]);
  });

  it('treats empty variant ramConditions as no gate', () => {
    const g = { id: 'g', statePoolId: 'pool-a', stateVariantId: 'var-2' };
    expect(resolveEffectiveRamConditionsForGroup(g, pools)).toBeNull();
  });

  it('falls back to legacy group.ramConditions when pool path not set', () => {
    const g = { id: 'g', ramConditions: [{ offset: 0x50, expectedValue: 1 }] };
    expect(resolveEffectiveRamConditionsForGroup(g, pools)).toEqual([{ offset: 0x50, expectedValue: 1 }]);
  });

  it('fail closed when pool or variant missing', () => {
    const g = { id: 'g', statePoolId: 'pool-a', stateVariantId: 'missing' };
    const out = resolveEffectiveRamConditionsForGroup(g, pools);
    expect(out).toHaveLength(1);
    expect(out[0].offset).toBe(-1);
    const wram = new Uint8Array(0x10000);
    wram[0] = 0xff;
    expect(ramConditionsSatisfied(wram, out)).toBe(false);
  });
});
