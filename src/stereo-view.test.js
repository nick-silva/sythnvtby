import { describe, it, expect } from 'vitest';
import { coreStereoOptions, leftEyeRect } from './stereo-view.js';

describe('coreStereoOptions', () => {
  it('maps the View menu to the core’s own 3D output', () => {
    expect(coreStereoOptions('2d')).toEqual({ vb_3dmode: 'anaglyph', vb_anaglyph_preset: 'disabled' });
    expect(coreStereoOptions('sidebyside')).toEqual({ vb_3dmode: 'side-by-side', vb_anaglyph_preset: 'disabled' });
    expect(coreStereoOptions('anaglyph')).toEqual({ vb_3dmode: 'anaglyph', vb_anaglyph_preset: 'red & cyan' });
  });

  it('keeps Palette on one eye in Anaglyph (it remaps by brightness), but side-by-side works', () => {
    expect(coreStereoOptions('anaglyph', { palette: true }).vb_anaglyph_preset).toBe('disabled');
    expect(coreStereoOptions('sidebyside', { palette: true }).vb_3dmode).toBe('side-by-side');
  });
});

describe('leftEyeRect', () => {
  it('is the left half of the side-by-side frame fitted in the canvas', () => {
    expect(leftEyeRect(768, 224)).toEqual({ x: 0, y: 0, w: 384, h: 224 });
    // A tall canvas: the 768×224 frame is fitted across and centred down.
    expect(leftEyeRect(1536, 1000)).toEqual({ x: 0, y: 276, w: 768, h: 448 });
    // A wide canvas: centred across.
    expect(leftEyeRect(2000, 448)).toEqual({ x: 232, y: 0, w: 768, h: 448 });
  });
});
