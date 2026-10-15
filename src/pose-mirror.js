/**
 * Mirrored poses: a sprite facing the other way (or knocked upside down) is the same pose drawn
 * mirrored. Its tiles are the same patterns — tile hashes are over the raw pattern and the VIP
 * flips per draw — but each sits on the other side of the anchor tile: a tile `dx` right of the
 * anchor is `dx` left of it, so the anchor stays put. A located pose's origin says which way it
 * was found (`mirrorH`, `mirrorV`), and every placement of its tiles goes through
 * {@link placePoseTile}.
 */

/** The ways a pose can be drawn: as captured, mirrored left–right, upside down, or both. */
export const POSE_ORIENTATIONS = Object.freeze([
  Object.freeze({ mirrorH: false, mirrorV: false }),
  Object.freeze({ mirrorH: true, mirrorV: false }),
  Object.freeze({ mirrorH: false, mirrorV: true }),
  Object.freeze({ mirrorH: true, mirrorV: true }),
]);

/**
 * The orientations a pose may be found in: all of them, unless the pose says its art is not a true
 * mirror image (*Mirror OK* off, `allowFlipMacro: false`). A scaled (affine) pose has no layout.
 * @param {any} pose
 */
export function poseOrientations(pose) {
  if (pose?.allowFlipMacro === false || pose?.affine === true) return POSE_ORIENTATIONS.slice(0, 1);
  return POSE_ORIENTATIONS;
}

/**
 * Where a pose tile's 8×8 draw sits on screen, for a pose located at `origin`.
 * @param {{ dx?: number, dy?: number }} tile
 * @param {{ x: number, y: number, mirrorH?: boolean, mirrorV?: boolean }} origin
 * @returns {{ x: number, y: number }}
 */
export function placePoseTile(tile, origin) {
  const dx = Number(tile?.dx) || 0;
  const dy = Number(tile?.dy) || 0;
  return {
    x: (Number(origin?.x) || 0) + (origin?.mirrorH ? -dx : dx),
    y: (Number(origin?.y) || 0) + (origin?.mirrorV ? -dy : dy),
  };
}

/** True when the origin draws its pose mirrored either way. */
export function isMirrored(origin) {
  return !!(origin?.mirrorH || origin?.mirrorV);
}
