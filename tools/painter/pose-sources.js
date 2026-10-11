/**
 * Save-time glue for src/pose-source-frames.js: gives every pose a lasting source frame,
 * promoting the Current (Colorize!) frame into vipstates/ when a pose is drawn only there.
 * Takes the painter's state as arguments and returns what changed; the painter applies it.
 */
import { deserializeVIPState } from '../../src/vip-dump.js';
import { tryExtractWramFromMednafenSavestate } from '../../src/mednafen-savestate-wram.js';
import {
  CURRENT_FRAME,
  posesMissingSource,
  findPoseSourceFrames,
  withPoseSourceFrames,
  currentFramePromotion,
} from '../../src/pose-source-frames.js';
import { locatePose } from '../shared/pack-session.js';

/** @param {string} json */
function parseState(json) {
  try {
    return deserializeVIPState(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   groups: any[],
 *   frames: Array<{ json: string }>,
 *   frameIdAt: (i: number) => string|null,
 *   isCurrentAt: (i: number) => boolean,
 *   saveState: ArrayBuffer|null|undefined,
 *   newFrameId: () => string,
 *   patternsAt?: (i: number) => Set<number> | null,
 * }} args `patternsAt`: the patterns a frame shows (left eye), when known — frames that cannot hold a
 *   missing pose are not decoded
 * @returns {null | {
 *   groups: any[],
 *   resolved: number,
 *   promotion: ReturnType<typeof currentFramePromotion> | null,
 * }} null when no pose needed a source
 */
export function resolvePoseSourcesForSave({ groups, frames, frameIdAt, isCurrentAt, saveState, newFrameId, patternsAt = () => null }) {
  const missingBefore = posesMissingSource(groups).length;
  if (missingBefore === 0) return null;

  const currentIndex = frames.findIndex((_, i) => isCurrentAt(i) && !frameIdAt(i));
  const current = currentIndex >= 0 ? frames[currentIndex] : null;
  // Newest captures sit at the end of the list, and are the likeliest to show a new pose.
  // Rows, not their JSON: a frame is read only if it is looked at (src/lazy-entries.js).
  const saved = frames
    .map((row, i) => ({ row, frameId: frameIdAt(i), patterns: patternsAt(i) }))
    .filter((f) => !!f.frameId)
    .reverse();

  const found = findPoseSourceFrames({
    groups,
    currentState: current ? parseState(current.json) : null,
    savedFrames: saved.map((f) => ({ frameId: f.frameId, patterns: f.patterns, getState: () => parseState(f.row.json) })),
    locate: locatePose,
  });
  const onCurrent = [...found.values()].some((byPose) => [...byPose.values()].includes(CURRENT_FRAME));

  let promotion = null;
  let currentFrameId = null;
  if (onCurrent && current) {
    // After a Save the Current snapshot can be a copy of a saved frame: point at that one.
    const copyOf = saved.find((f) => f.row.jsonSize === current.json.length && f.row.json === current.json);
    if (copyOf) {
      currentFrameId = copyOf.frameId;
    } else {
      const frameId = newFrameId();
      const wram = saveState ? tryExtractWramFromMednafenSavestate(new Uint8Array(saveState)) : null;
      promotion = currentFramePromotion({ frameId, vipJson: current.json, saveState: saveState || null, wram });
      currentFrameId = frameId;
    }
  }

  const next = withPoseSourceFrames(groups, found, currentFrameId);
  return { groups: next, resolved: missingBefore - posesMissingSource(next).length, promotion };
}
