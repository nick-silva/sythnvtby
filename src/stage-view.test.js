import { describe, it, expect } from 'vitest';
import { freeCrop, zoomAt, panBy, viewFromCrop, MAX_STAGE_SCALE } from '../tools/shared/stage-view.js';

const FRAME = { w: 384, h: 224 };
const AVAIL = { w: 768, h: 448 };

describe('stage view (free zoom and pan)', () => {
  it('crops a window the stage can show at that scale, centred on the view', () => {
    expect(freeCrop({ scale: 8, cx: 100, cy: 100 }, AVAIL, FRAME)).toEqual({ x: 52, y: 72, w: 96, h: 56 });
  });

  it('keeps the window inside the frame', () => {
    expect(freeCrop({ scale: 8, cx: 5, cy: 220 }, AVAIL, FRAME)).toEqual({ x: 0, y: 168, w: 96, h: 56 });
    expect(freeCrop({ scale: 1, cx: 0, cy: 0 }, AVAIL, FRAME)).toEqual({ x: 0, y: 0, w: 384, h: 224 });
  });

  it('zooms in around the pixel under the pointer, which stays put', () => {
    const view = { scale: 4, cx: 100, cy: 100 };
    const before = freeCrop(view, AVAIL, FRAME);
    const pointer = { px: 200, py: 80 }; // pane pixels
    const fx = before.x + pointer.px / view.scale;
    const fy = before.y + pointer.py / view.scale;
    const next = zoomAt(view, AVAIL, { fx, fy, ...pointer }, 1);
    expect(next.scale).toBeGreaterThan(4);
    const after = freeCrop(next, AVAIL, FRAME);
    expect(Math.abs(after.x + pointer.px / next.scale - fx)).toBeLessThan(1);
    expect(Math.abs(after.y + pointer.py / next.scale - fy)).toBeLessThan(1);
  });

  it('steps in whole pixels, faster when already zoomed in, within limits', () => {
    const at = (scale, dir) => zoomAt({ scale, cx: 192, cy: 112 }, AVAIL, { fx: 192, fy: 112, px: 0, py: 0 }, dir).scale;
    expect(at(2, 1)).toBe(3);
    expect(at(20, 1)).toBe(24);
    expect(at(1, -1)).toBe(1);
    expect(at(MAX_STAGE_SCALE, 1)).toBe(MAX_STAGE_SCALE);
  });

  it('pans by pane pixels, in frame pixels at the current scale', () => {
    expect(panBy({ scale: 4, cx: 100, cy: 100 }, 40, -20)).toEqual({ scale: 4, cx: 90, cy: 105 });
  });

  it('starts a free view from wherever the fitted view was', () => {
    expect(viewFromCrop({ x: 10, y: 20, w: 100, h: 50 }, 6)).toEqual({ scale: 6, cx: 60, cy: 45 });
  });
});
