/**
 * Which saved poses on a frame still need paint: every group's poses found whole on the frame, with
 * how many of their lit pixels nothing colours. Measured on the same composite the Project tool's
 * uncoloured count uses (src/uncoloured.js), so tile paint, overpaint and pose pictures all count.
 * SpriteStudio opens the neediest when the Project tool hands a frame over, so "SpriteStudio →"
 * lands on what is left to paint there.
 */
import { frameState, frameWram, locatePose, poseBounds, poseTileLookup, posesOf, renderFrame, shadeAt, FRAME_W, FRAME_H } from './pack-session.js';
import { getCompositePixelInfo } from '../../src/color-layer.js';
import { loadLayerArtPixels } from '../../src/layer-art.js';
import { posePictureGroups } from '../../src/pose-overpaint.js';
import { uncolouredMasks } from '../../src/uncoloured.js';

/** Wait for every picture (overpaint, pose pictures) to decode: an undecoded one colours nothing yet. */
async function loadPictures(session) {
  const pending = [];
  for (const g of session.groups || []) {
    pending.push(loadLayerArtPixels(g));
    for (const p of posePictureGroups(g)) pending.push(loadLayerArtPixels(p));
  }
  await Promise.all(pending.map((p) => p.catch(() => null)));
}

/** Lit pixels of a located pose, and how many of them the mask marks uncoloured. */
function poseNeed(state, pose, origin, eye, mask) {
  const bounds = poseBounds(pose, origin);
  if (!bounds) return { lit: 0, unpainted: 0 };
  const lookup = poseTileLookup(state, pose, origin, eye);
  let lit = 0;
  let unpainted = 0;
  for (let y = Math.max(0, bounds.y0); y < Math.min(FRAME_H, bounds.y1); y++) {
    for (let x = Math.max(0, bounds.x0); x < Math.min(FRAME_W, bounds.x1); x++) {
      const hit = lookup(x, y);
      if (!hit || !shadeAt(hit.tileBytes, hit.lx, hit.ly)) continue;
      lit++;
      if (mask[y * FRAME_W + x]) unpainted++;
    }
  }
  return { lit, unpainted };
}

/**
 * Saved poses whole on this frame (left eye) that still have uncoloured pixels, neediest first.
 * @param {any} session @param {number} frameIndex
 * @returns {Promise<Array<{ group: any, pose: any, lit: number, unpainted: number }>>}
 */
export async function posesNeedingPaint(session, frameIndex) {
  const state = frameIndex >= 0 ? frameState(session, frameIndex) : null;
  if (!state) return [];
  await loadPictures(session);
  const image = { width: FRAME_W, height: FRAME_H, data: new Uint8ClampedArray(FRAME_W * FRAME_H * 4) };
  renderFrame({ session, state, imageData: /** @type {any} */ (image), eye: 0, wram: frameWram(session, frameIndex) });
  const { pixelMask } = uncolouredMasks(state, getCompositePixelInfo());
  const out = [];
  for (const group of session.groups || []) {
    if (!group || group.wholePose === true || !Array.isArray(group.poses) || !group.poses.length) continue;
    for (const pose of posesOf(group)) {
      if (pose?.affineWorlds?.length) continue; // located through their scaled layer, not by anchor
      const origin = locatePose(state, pose, 0);
      if (!origin || origin.matched < origin.total) continue;
      const need = poseNeed(state, pose, origin, 0, pixelMask);
      if (need.unpainted > 0) out.push({ group, pose, ...need });
    }
  }
  return out.sort((a, b) => b.unpainted - a.unpainted);
}

/**
 * The pose to open: the neediest of the group you came from when it has one there, else the
 * neediest on the frame. Null when every pose on it is coloured.
 * @param {Awaited<ReturnType<typeof posesNeedingPaint>>} needs @param {string | null} preferGroupId
 */
export function pickPoseNeedingPaint(needs, preferGroupId) {
  return needs.find((n) => n.group.id === preferGroupId) || needs[0] || null;
}
