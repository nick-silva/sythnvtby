import { describe, it, expect } from 'vitest';
import { brightnessReference, masterBrightnessLevels, fadeFactor, FADE_RESPONSE_DEFAULT } from './fade.js';

describe('brightnessReference', () => {
  it('is the level most frames show, so short fades do not win', () => {
    expect(brightnessReference([0.39, 0.39, 0.39, 0.1, 0.2])).toBe(0.39);
  });

  it('breaks a tie towards the brighter level and ignores black or missing values', () => {
    expect(brightnessReference([0.5, 0.75])).toBe(0.75);
    expect(brightnessReference([0, 0.01, null, undefined, 'x'])).toBeNull();
    expect(brightnessReference([])).toBeNull();
  });
});

describe('masterBrightnessLevels', () => {
  it('reads the level out of serialized frames without parsing them', () => {
    const json = [JSON.stringify({ drawList: [], masterBrightness: 0.3934 }), '{"drawList":[]}', null];
    expect(masterBrightnessLevels(json)).toEqual([0.3934]);
  });
});

describe('fadeFactor', () => {
  it('shows paint at full strength on a game that always runs dim (Mario’s Tennis)', () => {
    expect(fadeFactor({ masterBrightness: 0.3935, brightnessReference: 0.3935 }, FADE_RESPONSE_DEFAULT)).toBe(1);
  });

  it('dims by how far the frame has faded from the game’s normal level', () => {
    expect(fadeFactor({ masterBrightness: 0.2, brightnessReference: 0.4 }, FADE_RESPONSE_DEFAULT)).toBeCloseTo(0.5);
    expect(fadeFactor({ masterBrightness: 0.8, brightnessReference: 0.4 }, FADE_RESPONSE_DEFAULT)).toBe(1);
  });

  it('keeps the old rule without a reference', () => {
    expect(fadeFactor({ masterBrightness: 0.3935 }, FADE_RESPONSE_DEFAULT)).toBeCloseTo(0.527, 3);
    expect(fadeFactor({ masterBrightness: 1 }, 1)).toBe(1);
    expect(fadeFactor({}, FADE_RESPONSE_DEFAULT)).toBe(1);
    expect(fadeFactor(null)).toBe(1);
  });
});
