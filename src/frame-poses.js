/**
 * Which poses a frame shows, for the emulator's Poses panel: per character, its kept poses found
 * whole on the frame and whether each one's pose picture was drawn — to track down a frame where the
 * wrong picture (or none) shows.
 *
 * A background character's pose is whole the way its pose picture decides (src/overpaint-switch.js,
 * src/pose-overpaint.js): every one of its own patterns on one of its layers. Of two whole poses on a
 * layer, the one whose patterns the other has all of loses — its picture is not drawn. A sprite's
 * pose is found by its layout, mirrored too (src/pose-mirror.js).
 */
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { isObjGroup } from './obj-sprite-profiles.js';
import { posePictureKey, savedPoseHashes } from './pose-overpaint.js';
import { placePoseTile, poseOrientations } from './pose-mirror.js';

const OBJ_LAYER = 2;

/** Pattern hash per tile index, null for a blank tile, worked out once per frame. */
function hasherFor(patternTable) {
  const cache = new Map();
  return (tileIndex) => {
    let h = cache.get(tileIndex);
    if (h === undefined) {
      const bytes = getTileBytes(patternTable, tileIndex);
      h = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
      cache.set(tileIndex, h);
    }
    return h;
  };
}

/** world → patterns on that plain background layer, on one eye. */
function backgroundPatterns(drawList, hashOf, eye) {
  /** @type {Map<number, Set<number>>} */
  const byWorld = new Map();
  for (const d of drawList) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== eye || (d.layer ?? 0) !== 0 || d.world == null) continue;
    const h = hashOf(d.tileIndex);
    if (h === null) continue;
    if (!byWorld.has(d.world)) byWorld.set(d.world, new Set());
    byWorld.get(d.world).add(h);
  }
  return byWorld;
}

/** The sprite tiles on one eye: patterns at each "x,y", and the draws of each pattern. */
function spritePatterns(drawList, hashOf, eye) {
  /** @type {Map<string, Set<number>>} */
  const at = new Map();
  /** @type {Map<number, any[]>} */
  const anchors = new Map();
  for (const d of drawList) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== eye || Number(d.layer) !== OBJ_LAYER) continue;
    const h = hashOf(d.tileIndex);
    if (h === null) continue;
    const k = `${d.x},${d.y}`;
    if (!at.has(k)) at.set(k, new Set());
    at.get(k).add(h);
    if (!anchors.has(h)) anchors.set(h, []);
    anchors.get(h).push(d);
  }
  return { at, anchors };
}

/** Where a sprite pose sits whole on the frame (any way round its Mirror OK allows), or null. */
function findSpritePose(pose, sprites) {
  const tiles = Array.isArray(pose?.tiles) ? pose.tiles : [];
  if (typeof pose?.anchorHash !== 'number' || !tiles.length) return null;
  for (const o of poseOrientations(pose)) {
    for (const d of sprites.anchors.get(pose.anchorHash >>> 0) || []) {
      const origin = { x: d.x, y: d.y, ...o };
      const whole = tiles.every((t) => {
        const p = placePoseTile(t, origin);
        return sprites.at.get(`${p.x},${p.y}`)?.has(t.hash >>> 0);
      });
      if (whole) return origin;
    }
  }
  return null;
}

/**
 * @typedef {{ id: string, name: string, drawn: boolean }} PictureState
 * @typedef {{ poseId: string, name: string, where: string, mirrored: boolean, coveredBy: string | null, sameAs: string | null, picture: PictureState | null }} PoseOnFrame
 *   `coveredBy`: a whole pose with all its patterns and more (its picture wins); `sameAs`: a whole
 *   pose with exactly its patterns (both pictures draw)
 * @typedef {{ groupId: string, name: string, sprite: boolean, shown: boolean, poses: PoseOnFrame[], pictures: PictureState[], overpaintDrawn: boolean }} CharacterOnFrame
 */

/**
 * Every character with a kept pose whole on the frame, or a picture drawn.
 * @param {{
 *   state: { drawList?: any[], patternTable?: Uint8Array } | null,
 *   groups: any[],
 *   eye?: number,
 *   shown?: Set<string> | null,
 *   drawn?: Set<string>,
 * }} args `shown`: ids of the groups this screen and the game states let draw (src/screen-gate.js),
 *   null when all may; `drawn`: ids of the pictures the compositor drew (a pose picture's is
 *   posePictureKey, a group's overpaint its group id)
 * @returns {CharacterOnFrame[]}
 */
export function posesOnFrame({ state, groups, eye = 0, shown = null, drawn = new Set() }) {
  const drawList = state?.drawList;
  if (!Array.isArray(drawList) || !state?.patternTable || !Array.isArray(groups)) return [];
  const hashOf = hasherFor(state.patternTable);
  let bg = null;
  let sprites = null;
  const out = [];
  for (const group of groups) {
    if (!group?.id) continue;
    const sprite = isObjGroup(group);
    const kept = (Array.isArray(group.poses) ? group.poses : []).filter((p) => p?.poseId && !p.affine);
    const pictures = Array.isArray(group.poseOverpaints) ? group.poseOverpaints : [];
    const pictureOf = (poseId) => pictures.find((p) => p?.poseId === poseId) || null;
    const asState = (p) => {
      const id = posePictureKey(group.id, p.id);
      return { id, name: p.name || p.id, drawn: drawn.has(id) };
    };
    /** @type {PoseOnFrame[]} */
    const poses = [];
    if (sprite) {
      sprites = sprites || spritePatterns(drawList, hashOf, eye);
      for (const pose of kept) {
        const at = findSpritePose(pose, sprites);
        if (!at) continue;
        const pic = pictureOf(pose.poseId);
        poses.push({ poseId: pose.poseId, name: pose.name || pose.poseId, where: `at ${at.x},${at.y}`, mirrored: !!(at.mirrorH || at.mirrorV), coveredBy: null, sameAs: null, picture: pic ? asState(pic) : null });
      }
    } else {
      bg = bg || backgroundPatterns(drawList, hashOf, eye);
      const worlds = Array.isArray(group.criteria?.windowIds) && group.criteria.windowIds.length ? new Set(group.criteria.windowIds.map(Number)) : null;
      const whole = [];
      for (const pose of kept) {
        const hashes = savedPoseHashes(group, pose.poseId);
        if (!hashes) continue;
        for (const [world, on] of bg) {
          if (worlds && !worlds.has(Number(world))) continue;
          if (hashes.every((h) => on.has(h))) {
            whole.push({ pose, world, hashes: new Set(hashes) });
            break;
          }
        }
      }
      for (const w of whole) {
        // Of two whole poses on a layer, the one with all of this one's patterns and more wins.
        const fuller = whole.find((o) => o !== w && o.world === w.world && o.hashes.size > w.hashes.size && [...w.hashes].every((h) => o.hashes.has(h)));
        // The same patterns as another whole pose: neither picture wins, so both draw.
        const twin = whole.find((o) => o !== w && o.world === w.world && o.hashes.size === w.hashes.size && [...w.hashes].every((h) => o.hashes.has(h)));
        const pic = pictureOf(w.pose.poseId);
        poses.push({ poseId: w.pose.poseId, name: w.pose.name || w.pose.poseId, where: `world ${w.world}`, mirrored: false, coveredBy: fuller ? fuller.pose.name || fuller.pose.poseId : null, sameAs: twin ? twin.pose.name || twin.pose.poseId : null, picture: pic ? asState(pic) : null });
      }
    }
    // Pictures drawn that no pose found here stands for (a picture whose pose was deleted).
    const listed = new Set(poses.map((p) => p.picture?.id).filter(Boolean));
    const extra = pictures.filter((p) => p?.id).map(asState).filter((p) => p.drawn && !listed.has(p.id));
    const overpaintDrawn = drawn.has(group.id);
    if (!poses.length && !extra.length && !overpaintDrawn) continue;
    out.push({ groupId: group.id, name: group.name || group.id, sprite, shown: !shown || shown.has(group.id), poses, pictures: extra, overpaintDrawn });
  }
  return out;
}

/**
 * The report as plain lines, for the panel and its Copy (pasted into a bug note, say).
 * @param {CharacterOnFrame[]} characters @param {{ frame?: number | null, eye?: number }} [where]
 * @returns {string[]}
 */
export function describeFramePoses(characters, { frame = null, eye = 0 } = {}) {
  const head = `${frame != null ? `Frame ${frame}` : 'This frame'} · ${eye === 1 ? 'right' : 'left'} eye`;
  if (!characters.length) return [head, 'No character has a kept pose whole on this frame, and no picture was drawn.'];
  const lines = [head];
  for (const c of characters) {
    lines.push(`${c.name}${c.sprite ? ' (sprite)' : ''}${c.shown ? '' : ' — hidden here by its screens or game states: none of its paint is drawn'}${c.overpaintDrawn ? ' · its overpaint is drawn' : ''}`);
    for (const p of c.poses) lines.push(`  • ${p.name} — whole, ${p.where}${p.mirrored ? ', mirrored' : ''}${p.sameAs ? ` · same tiles as “${p.sameAs}” (if both have a picture, both draw)` : ''} · ${pictureNote(p, c.shown)}`);
    for (const p of c.pictures) lines.push(`  • picture “${p.name}” drawn (its pose is not kept any more)`);
  }
  return lines;
}

/** Why a pose's picture is or is not on screen. */
function pictureNote(p, shown) {
  if (!p.picture) return 'no pose picture (its tiles show their tile paint)';
  if (p.picture.drawn) return `picture “${p.picture.name}” drawn`;
  if (!shown) return `picture “${p.picture.name}” not drawn (group hidden here)`;
  if (p.coveredBy) return `picture “${p.picture.name}” not drawn: “${p.coveredBy}” has all its tiles and more, so its picture wins`;
  return `picture “${p.picture.name}” not drawn (the layer is not drawing from the picture's map here, or the picture is empty)`;
}
