/**
 * Free zoom and pan for SpriteStudio's stage. The stage normally fits itself to what is being
 * worked on; once the wheel or a pan takes over, the view is a whole-pixel scale and a centre
 * in frame pixels. Whole pixels keep pixel art crisp at every zoom level.
 */

export const MAX_STAGE_SCALE = 48;
/** Each wheel notch changes the scale by about this share of itself (at least one step). */
const ZOOM_STEP_SHARE = 0.2;

/**
 * @typedef {{ scale: number, cx: number, cy: number }} StageView
 * @typedef {{ w: number, h: number }} Size
 * @typedef {{ x: number, y: number, w: number, h: number }} Crop
 */

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** @param {number} scale @param {Size} avail @param {Size} frame */
function windowSize(scale, avail, frame) {
  return {
    w: clamp(Math.floor(avail.w / scale), 1, frame.w),
    h: clamp(Math.floor(avail.h / scale), 1, frame.h),
  };
}

/**
 * The frame region the stage shows for a free view: as much as fits at that scale, centred on
 * the view and kept inside the frame.
 * @param {StageView} view @param {Size} avail stage pixels available @param {Size} frame
 * @returns {Crop}
 */
export function freeCrop(view, avail, frame) {
  const { w, h } = windowSize(view.scale, avail, frame);
  return {
    x: clamp(Math.round(view.cx - w / 2), 0, frame.w - w),
    y: clamp(Math.round(view.cy - h / 2), 0, frame.h - h),
    w,
    h,
  };
}

/**
 * One wheel notch in (direction 1) or out (-1), keeping the frame pixel under the pointer where
 * it is. `fx`/`fy` is that frame pixel; `px`/`py` is the pointer in stage pixels.
 * @param {StageView} view @param {Size} avail
 * @param {{ fx: number, fy: number, px: number, py: number }} at
 * @param {1|-1} direction
 * @param {Size} [frame]
 * @returns {StageView}
 */
export function zoomAt(view, avail, at, direction, frame = { w: 384, h: 224 }) {
  const step = Math.max(1, Math.round(view.scale * ZOOM_STEP_SHARE));
  const scale = clamp(view.scale + direction * step, 1, MAX_STAGE_SCALE);
  if (scale === view.scale) return view;
  const { w, h } = windowSize(scale, avail, frame);
  const x = at.fx - at.px / scale;
  const y = at.fy - at.py / scale;
  return { scale, cx: x + w / 2, cy: y + h / 2 };
}

/**
 * Drag the view by stage pixels: the picture follows the pointer.
 * @param {StageView} view @param {number} dx @param {number} dy
 * @returns {StageView}
 */
export function panBy(view, dx, dy) {
  return { scale: view.scale, cx: view.cx - dx / view.scale, cy: view.cy - dy / view.scale };
}

/**
 * A free view that shows what the fitted stage was showing, so taking over does not jump.
 * @param {Crop} crop @param {number} scale
 * @returns {StageView}
 */
export function viewFromCrop(crop, scale) {
  return { scale, cx: crop.x + crop.w / 2, cy: crop.y + crop.h / 2 };
}
