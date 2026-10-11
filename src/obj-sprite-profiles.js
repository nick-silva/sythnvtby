/**
 * OBJ sprite profiles: pose/track data model for OBJ groups in groups.json.
 * See docs/design/obj-sprite-profiles-design.md.
 */

import { decodeGroupTileColors, encodeGroupTileColors } from './group-tile-colors.js';

export const OBJ_PROFILES_GROUPS_SCHEMA_VERSION = 3;
export const LEGACY_POSE_ID = 'pose_legacy';

const EYE_WIDTH_PX = 384;
const EYE_HEIGHT_PX = 224;
const TILE_PX = 8;

/**
 * @typedef {Object} PoseTile
 * @property {number} hash - Unsigned 32-bit tile hash.
 * @property {number} [dx] - Px offset from the anchor tile; absent until captured from a live frame.
 * @property {number} [dy]
 */

/**
 * @typedef {Object} Pose
 * @property {string} poseId
 * @property {string} name
 * @property {PoseTile[]} tiles
 * @property {number} [anchorHash]
 * @property {boolean} allowFlipMacro
 * @property {boolean} anchorFlipH - Anchor draw's flipH when captured.
 * @property {boolean} anchorFlipV
 * @property {boolean} clippedAtCapture
 * @property {string} [sourceFrameId] - frameRegistry id the pose was captured from.
 */

/**
 * @typedef {Object} TrackStep
 * @property {string} poseId
 * @property {number} durationMs
 */

/** @param {unknown} v */
function toHash(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v >>> 0 : null;
}

/** @param {unknown} v */
function nonEmptyString(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * @param {any} g
 * @returns {boolean}
 */
export function isObjGroup(g) {
  if (g?.authoringKind === 'obj') return true;
  if (g?.authoringKind === 'bg') return false;
  const layers = g?.criteria?.layers;
  return Array.isArray(layers) && layers.includes(2);
}

/**
 * @param {any} raw
 * @returns {PoseTile|null}
 */
function normalizeTile(raw) {
  const hash = toHash(raw?.hash);
  if (hash === null) return null;
  if (Number.isFinite(raw.dx) && Number.isFinite(raw.dy)) return { hash, dx: raw.dx, dy: raw.dy };
  return { hash };
}

/**
 * @param {any} raw
 * @returns {Pose|null} null when the pose has no id or no valid tiles.
 */
export function normalizePose(raw) {
  const poseId = nonEmptyString(raw?.poseId);
  if (!poseId || !Array.isArray(raw.tiles)) return null;
  const seen = new Set();
  const tiles = [];
  for (const t of raw.tiles) {
    const tile = normalizeTile(t);
    if (!tile) continue;
    const key = `${tile.hash}:${tile.dx ?? ''}:${tile.dy ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tiles.push(tile);
  }
  if (tiles.length === 0) return null;

  const anchorHash = toHash(raw.anchorHash);
  const sourceFrameId = nonEmptyString(raw.sourceFrameId);
  return {
    poseId,
    name: nonEmptyString(raw.name) ?? poseId,
    tiles,
    ...(anchorHash !== null && tiles.some((t) => t.hash === anchorHash) && { anchorHash }),
    allowFlipMacro: raw.allowFlipMacro !== false,
    anchorFlipH: raw.anchorFlipH === true,
    anchorFlipV: raw.anchorFlipV === true,
    clippedAtCapture: raw.clippedAtCapture === true,
    ...(sourceFrameId && { sourceFrameId }),
    // A pose on a scaled (affine) layer: its tiles are the patterns it shows, with no offsets.
    ...(raw.affine === true && { affine: true }),
  };
}

/**
 * @param {unknown} raw
 * @param {Set<string>} poseIds
 * @returns {TrackStep[]}
 */
export function normalizeTrack(raw, poseIds) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => typeof s?.poseId === 'string' && poseIds.has(s.poseId))
    .filter((s) => Number.isFinite(s.durationMs) && s.durationMs > 0)
    .map((s) => ({ poseId: s.poseId, durationMs: Math.max(1, Math.round(s.durationMs)) }));
}

/** A VB frame is ~20 ms; the legacy `track` held durations in ms, `tracks` hold frames. */
export const MS_PER_VB_FRAME = 20;

/**
 * @typedef {{ poseId: string, holdFrames: number, flipH?: boolean }} TrackFrameStep
 * @typedef {{ id: string, name: string, steps: TrackFrameStep[] }} NamedTrack
 */

/**
 * Named animation tracks: an ordered series of poses, each held for a number of
 * VB frames. Steps naming a pose that no longer exists are dropped.
 * @param {unknown} raw
 * @param {Set<string>} poseIds
 * @returns {NamedTrack[]}
 */
export function normalizeTracks(raw, poseIds) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const t of raw) {
    const id = nonEmptyString(t?.id);
    if (!id || seen.has(id)) continue;
    const steps = (Array.isArray(t.steps) ? t.steps : [])
      .filter((s) => typeof s?.poseId === 'string' && poseIds.has(s.poseId))
      .map((s) => ({
        poseId: s.poseId,
        holdFrames: Math.max(1, Math.round(Number(s.holdFrames) > 0 ? Number(s.holdFrames) : 1)),
        // A cycle captured facing one way can play the other way by mirroring.
        ...(s.flipH === true && { flipH: true }),
      }));
    if (steps.length === 0) continue;
    seen.add(id);
    out.push({ id, name: nonEmptyString(t.name) ?? id, steps });
  }
  return out;
}

/**
 * Named tracks, falling back to the legacy single `track` (ms per step) so packs
 * written before named tracks still animate.
 * @param {any} g
 * @returns {NamedTrack[]}
 */
export function getEffectiveTracks(g) {
  if (!isObjGroup(g)) return [];
  if (Array.isArray(g?.tracks) && g.tracks.length > 0) return g.tracks;
  const legacy = Array.isArray(g?.track) ? g.track : [];
  if (legacy.length === 0) return [];
  return [
    {
      id: 'track-legacy',
      name: 'Animation',
      steps: legacy.map((s) => ({
        poseId: s.poseId,
        holdFrames: Math.max(1, Math.round((Number(s.durationMs) || MS_PER_VB_FRAME) / MS_PER_VB_FRAME)),
      })),
    },
  ];
}

/** @param {any} group */
export function nextTrackId(group) {
  const taken = new Set((Array.isArray(group?.tracks) ? group.tracks : []).map((t) => t?.id));
  let n = 1;
  while (taken.has(`track-${n}`)) n++;
  return `track-${n}`;
}

/**
 * @param {any} group
 * @param {{ id?: string, name?: string, steps?: TrackFrameStep[] }} track
 * @returns {any} new group
 */
export function addTrackToGroup(group, track) {
  const id = nonEmptyString(track?.id) ?? nextTrackId(group);
  const existing = Array.isArray(group?.tracks) ? group.tracks : [];
  const row = {
    id,
    name: nonEmptyString(track?.name) ?? id,
    steps: Array.isArray(track?.steps) ? track.steps : [],
  };
  return { ...group, tracks: [...existing.filter((t) => t?.id !== id), row] };
}

/** @param {any} group @param {string} trackId */
export function removeTrackFromGroup(group, trackId) {
  const tracks = (Array.isArray(group?.tracks) ? group.tracks : []).filter((t) => t?.id !== trackId);
  const next = { ...group, tracks };
  if (tracks.length === 0) delete next.tracks;
  return next;
}

/**
 * @param {any} group @param {string} trackId
 * @param {{ name?: string, steps?: TrackFrameStep[] }} patch
 */
export function updateTrack(group, trackId, patch) {
  const tracks = (Array.isArray(group?.tracks) ? group.tracks : []).map((t) =>
    t?.id === trackId
      ? {
          ...t,
          ...(patch?.name !== undefined && { name: nonEmptyString(patch.name) ?? t.name }),
          ...(patch?.steps !== undefined && { steps: patch.steps }),
        }
      : t,
  );
  return { ...group, tracks };
}

/** Total hold of a track, in VB frames. */
export function trackLengthFrames(track) {
  return (Array.isArray(track?.steps) ? track.steps : []).reduce(
    (sum, s) => sum + Math.max(1, Number(s?.holdFrames) || 1),
    0,
  );
}

/**
 * Which step of a track is showing at `frame` (wraps).
 * @param {NamedTrack} track @param {number} frame
 * @returns {{ index: number, step: TrackFrameStep, startFrame: number } | null}
 */
export function trackStepAtFrame(track, frame) {
  const steps = Array.isArray(track?.steps) ? track.steps : [];
  if (steps.length === 0) return null;
  const total = trackLengthFrames(track);
  let f = Math.floor(Number(frame) || 0) % total;
  if (f < 0) f += total;
  let start = 0;
  for (let i = 0; i < steps.length; i++) {
    const hold = Math.max(1, Number(steps[i].holdFrames) || 1);
    if (f < start + hold) return { index: i, step: steps[i], startFrame: start };
    start += hold;
  }
  return { index: steps.length - 1, step: steps[steps.length - 1], startFrame: start };
}

/**
 * Profile fields to merge into a normalized group. Empty for groups without valid
 * poses, so legacy groups round-trip unchanged. BG and affine groups may keep poses
 * too: frames picked to paint the group on.
 * @param {any} g
 * @returns {{ poses?: Pose[], track?: TrackStep[], tracks?: NamedTrack[] }}
 */
export function normalizeObjProfileFields(g) {
  if (!Array.isArray(g?.poses)) return {};
  const poses = [];
  const ids = new Set();
  for (const raw of g.poses) {
    const pose = normalizePose(raw);
    if (!pose || ids.has(pose.poseId)) continue;
    ids.add(pose.poseId);
    poses.push(pose);
  }
  if (poses.length === 0) return {};
  const track = normalizeTrack(g.track, ids);
  const tracks = normalizeTracks(g.tracks, ids);
  return { poses, ...(track.length > 0 && { track }), ...(tracks.length > 0 && { tracks }) };
}

/**
 * Explicit poses, or an in-memory implicit pose wrapping a legacy OBJ group's
 * criteria.hashes. The implicit pose is never persisted and has no offsets or
 * anchor, so it is not macro-eligible. A BG group has only the poses it kept.
 * @param {any} g
 * @returns {Pose[]}
 */
export function getEffectivePoses(g) {
  if (Array.isArray(g?.poses) && g.poses.length > 0) return g.poses;
  if (!isObjGroup(g)) return [];
  const hashes = Array.isArray(g.criteria?.hashes) ? g.criteria.hashes : [];
  const unique = [...new Set(hashes.map(toHash).filter((h) => h !== null))];
  if (unique.length === 0) return [];
  return [
    {
      poseId: LEGACY_POSE_ID,
      name: nonEmptyString(g.name) ?? 'Legacy pose',
      tiles: unique.map((hash) => ({ hash })),
      allowFlipMacro: true,
      anchorFlipH: false,
      anchorFlipV: false,
      clippedAtCapture: false,
    },
  ];
}

/**
 * @param {Pose} pose
 * @returns {boolean}
 */
export function isPoseMacroEligible(pose) {
  const anchor = toHash(pose?.anchorHash);
  if (anchor === null || !Array.isArray(pose.tiles) || pose.tiles.length === 0) return false;
  if (!pose.tiles.every((t) => Number.isFinite(t.dx) && Number.isFinite(t.dy))) return false;
  return pose.tiles.some((t) => t.hash === anchor && t.dx === 0 && t.dy === 0);
}

/**
 * Sibling poses in the same profile whose tiles include this pose's anchor hash.
 * @param {any} group
 * @param {string} poseId
 * @returns {Array<{ poseId: string, name: string }>}
 */
export function findAnchorAmbiguity(group, poseId) {
  const poses = Array.isArray(group?.poses) ? group.poses : [];
  const pose = poses.find((p) => p.poseId === poseId);
  const anchor = toHash(pose?.anchorHash);
  if (anchor === null) return [];
  return poses
    .filter((p) => p.poseId !== poseId && Array.isArray(p.tiles) && p.tiles.some((t) => t.hash === anchor))
    .map((p) => ({ poseId: p.poseId, name: p.name || p.poseId }));
}

/**
 * True when any captured tile sits within one tile of the eye's edge.
 * @param {Array<{ x: number, y: number }>} draws
 * @returns {boolean}
 */
export function isCaptureClipped(draws) {
  return draws.some(
    (d) =>
      d.x < TILE_PX ||
      d.y < TILE_PX ||
      d.x + TILE_PX > EYE_WIDTH_PX - TILE_PX ||
      d.y + TILE_PX > EYE_HEIGHT_PX - TILE_PX,
  );
}

/**
 * Default anchor for a capture: the preferred (frontmost) draw if its hash is
 * unique within the capture, else the first draw with a unique hash. A repeated
 * anchor hash would match more than once per sprite at render time.
 * @param {Array<{ hash: number }>} draws
 * @param {number} preferredIndex
 * @returns {number}
 */
export function chooseAnchorIndex(draws, preferredIndex) {
  const counts = new Map();
  for (const d of draws) counts.set(d.hash, (counts.get(d.hash) ?? 0) + 1);
  if (counts.get(draws[preferredIndex]?.hash) === 1) return preferredIndex;
  const firstUnique = draws.findIndex((d) => counts.get(d.hash) === 1);
  return firstUnique >= 0 ? firstUnique : preferredIndex;
}

/**
 * @param {Pose} pose
 * @returns {number} Tiles in the pose sharing its anchor hash (0 without an anchor).
 */
export function countAnchorTiles(pose) {
  const anchor = toHash(pose?.anchorHash);
  if (anchor === null) return 0;
  return pose.tiles.filter((t) => t.hash === anchor).length;
}

/**
 * Build a pose from one eye's captured OBJ draws. Offsets are relative to the
 * anchor draw; callers pass the frontmost selected draw as the anchor.
 * @param {{
 *   poseId: string,
 *   name?: string,
 *   draws: Array<{ hash: number, x: number, y: number, flipH?: boolean, flipV?: boolean }>,
 *   anchorIndex?: number,
 *   sourceFrameId?: string,
 * }} capture
 * @returns {Pose|null}
 */
export function buildPoseFromCapture({ poseId, name, draws, anchorIndex = 0, sourceFrameId }) {
  if (!Array.isArray(draws) || draws.length === 0) return null;
  const anchor = draws[anchorIndex];
  if (!anchor) return null;
  return normalizePose({
    poseId,
    name,
    tiles: draws.map((d) => ({ hash: d.hash, dx: d.x - anchor.x, dy: d.y - anchor.y })),
    anchorHash: anchor.hash,
    anchorFlipH: anchor.flipH === true,
    anchorFlipV: anchor.flipV === true,
    clippedAtCapture: isCaptureClipped(draws),
    sourceFrameId,
  });
}

/**
 * Keep a BG or affine group's frame view (a card SpriteStudio built from one captured frame) as a
 * pose. A BG view keeps its tile offsets and anchor; an affine view keeps just the patterns it
 * shows, because a scaled layer has no fixed tile positions.
 * @param {{
 *   poseId: string,
 *   name?: string,
 *   view: { pose: { tiles: PoseTile[], anchorHash?: number, affineWorlds?: number[] }, patterns?: number[] },
 *   sourceFrameId?: string,
 * }} options
 * @returns {Pose|null}
 */
export function buildPoseFromView({ poseId, name, view, sourceFrameId }) {
  const pose = view?.pose;
  if (!pose || !Array.isArray(pose.tiles)) return null;
  if (Array.isArray(pose.affineWorlds) && pose.affineWorlds.length) {
    const hashes = Array.isArray(view.patterns) && view.patterns.length ? view.patterns : pose.tiles.map((t) => t.hash);
    return normalizePose({ poseId, name, tiles: hashes.map((hash) => ({ hash })), affine: true, sourceFrameId });
  }
  return normalizePose({ poseId, name, tiles: pose.tiles, anchorHash: pose.anchorHash, sourceFrameId });
}

/**
 * @param {any} group
 * @returns {string}
 */
export function nextPoseId(group) {
  const taken = new Set((Array.isArray(group?.poses) ? group.poses : []).map((p) => p.poseId));
  let n = 1;
  while (taken.has(`pose_${n}`)) n++;
  return `pose_${n}`;
}

/**
 * Append a pose and fold its tile hashes (and captured worlds) into the group's
 * criteria, so per-tile coloring keeps matching those tiles. An empty
 * `windowIds` means "all worlds" and is left empty.
 * @param {any} group
 * @param {Pose} pose
 * @param {{ windowIds?: number[] }} [options]
 * @returns {any}
 */
export function addPoseToGroup(group, pose, { windowIds = [] } = {}) {
  const poses = Array.isArray(group.poses) ? group.poses : [];
  const poseId = poses.some((p) => p.poseId === pose.poseId) ? nextPoseId(group) : pose.poseId;
  const crit = group.criteria || {};
  const oldHashes = Array.isArray(crit.hashes) ? crit.hashes : [];
  const known = new Set(oldHashes.map((h) => Number(h) >>> 0));
  const addedHashes = [...new Set(pose.tiles.map((t) => t.hash))].filter((h) => !known.has(h));
  const oldWindows = Array.isArray(crit.windowIds) ? crit.windowIds : [];
  const nextWindows =
    oldWindows.length === 0 ? [] : [...new Set([...oldWindows, ...windowIds])].sort((a, b) => a - b);
  return {
    ...group,
    criteria: { ...crit, hashes: [...oldHashes, ...addedHashes], windowIds: nextWindows },
    poses: [...poses, { ...pose, poseId }],
  };
}

/**
 * Remove a pose and its track steps. Criteria hashes are left alone because
 * other poses (or legacy per-tile paint) may still use them.
 * @param {any} group
 * @param {string} poseId
 * @returns {any}
 */
export function removePoseFromGroup(group, poseId) {
  const { poses: oldPoses, track: oldTrack, tracks: oldTracks, poseOverpaints: oldPictures, ...rest } = group;
  // The pose's own overpaint goes with it (src/pose-overpaint.js): left behind, nothing could edit it.
  const pictures = (Array.isArray(oldPictures) ? oldPictures : []).filter((p) => p?.poseId !== poseId);
  const poses = (Array.isArray(oldPoses) ? oldPoses : []).filter((p) => p.poseId !== poseId);
  const track = (Array.isArray(oldTrack) ? oldTrack : []).filter((s) => s.poseId !== poseId);
  // Named tracks lose that pose's steps; a track with nothing left goes, as it would on load.
  const tracks = (Array.isArray(oldTracks) ? oldTracks : [])
    .map((t) => ({ ...t, steps: (Array.isArray(t?.steps) ? t.steps : []).filter((s) => s.poseId !== poseId) }))
    .filter((t) => t.steps.length > 0);
  return {
    ...rest,
    ...(poses.length > 0 && { poses }),
    ...(poses.length > 0 && track.length > 0 && { track }),
    ...(poses.length > 0 && tracks.length > 0 && { tracks }),
    ...(pictures.length > 0 && { poseOverpaints: pictures }),
  };
}

/**
 * @param {any} group
 * @param {string} poseId
 * @param {{ name?: string, allowFlipMacro?: boolean }} patch
 * @returns {any}
 */
export function updatePose(group, poseId, patch) {
  const name = nonEmptyString(patch.name);
  const poses = (group.poses || []).map((p) => {
    if (p.poseId !== poseId) return p;
    return (
      normalizePose({
        ...p,
        ...(name && { name }),
        ...(typeof patch.allowFlipMacro === 'boolean' && { allowFlipMacro: patch.allowFlipMacro }),
      }) ?? p
    );
  });
  return { ...group, poses };
}

/**
 * Move the anchor to another tile, rebasing every offset. Capture flip flags
 * describe the whole sprite, so they carry over unchanged.
 * @param {Pose} pose
 * @param {number} tileIndex
 * @returns {Pose|null}
 */
export function reanchorPose(pose, tileIndex) {
  const anchor = pose.tiles[tileIndex];
  if (!anchor || !pose.tiles.every((t) => Number.isFinite(t.dx) && Number.isFinite(t.dy))) return null;
  return normalizePose({
    ...pose,
    tiles: pose.tiles.map((t) => ({ hash: t.hash, dx: t.dx - anchor.dx, dy: t.dy - anchor.dy })),
    anchorHash: anchor.hash,
  });
}

/**
 * Group whose criteria share the most hashes with a selection, or null. Only sprite (OBJ) groups
 * are considered unless `accept` says otherwise.
 * @param {any[]} groups
 * @param {number[]} hashes
 * @param {(g: any) => boolean} [accept]
 * @returns {string|null}
 */
export function suggestProfileIdForHashes(groups, hashes, accept = isObjGroup) {
  const wanted = new Set(hashes.map((h) => h >>> 0));
  let bestId = null;
  let bestCount = 0;
  for (const g of groups) {
    if (!accept(g) || !Array.isArray(g.criteria?.hashes)) continue;
    const own = new Set(g.criteria.hashes.map((h) => Number(h) >>> 0));
    let count = 0;
    for (const h of own) if (wanted.has(h)) count++;
    if (count > bestCount) {
      bestCount = count;
      bestId = g.id;
    }
  }
  return bestId;
}

/**
 * @param {any[]} groups
 * @param {number|undefined} loadedVersion
 * @returns {number|undefined}
 */
export function requiredGroupsSchemaVersion(groups, loadedVersion) {
  const hasPoses = groups.some((g) => Array.isArray(g?.poses) && g.poses.length > 0);
  if (!hasPoses) return loadedVersion;
  return typeof loadedVersion === 'number'
    ? Math.max(loadedVersion, OBJ_PROFILES_GROUPS_SCHEMA_VERSION)
    : OBJ_PROFILES_GROUPS_SCHEMA_VERSION;
}

/**
 * Tile patterns any of the group's explicit poses uses, optionally leaving one pose out.
 * @param {any} group @param {string|null} [exceptPoseId]
 * @returns {Set<number>}
 */
export function patternsInPoses(group, exceptPoseId = null) {
  const out = new Set();
  for (const p of Array.isArray(group?.poses) ? group.poses : []) {
    if (p.poseId === exceptPoseId) continue;
    for (const t of p.tiles || []) out.add(t.hash >>> 0);
  }
  return out;
}

/**
 * The group's patterns that none of its poses uses: left behind by a deleted pose, or by the
 * frame the group was first made from. Empty for a group without poses (its pattern list is the
 * group) and for an animated-tiles group (its phases are not poses).
 * @param {any} group
 * @returns {number[]}
 */
export function patternsInNoPose(group) {
  if (!Array.isArray(group?.poses) || !group.poses.length) return [];
  if (Array.isArray(group.criteria?.tileSlots) && group.criteria.tileSlots.length) return [];
  const used = patternsInPoses(group);
  const hashes = Array.isArray(group.criteria?.hashes) ? group.criteria.hashes : [];
  return [...new Set(hashes.map((h) => Number(h) >>> 0))].filter((h) => !used.has(h));
}

/**
 * Patterns only this pose uses — what should leave the group with it. Empty when it is the
 * group's last pose: the group falls back to its pattern list then, so nothing is dropped.
 * @param {any} group @param {string} poseId
 * @returns {number[]}
 */
export function patternsOnlyInPose(group, poseId) {
  const poses = Array.isArray(group?.poses) ? group.poses : [];
  const pose = poses.find((p) => p.poseId === poseId);
  if (!pose || poses.length < 2) return [];
  const others = patternsInPoses(group, poseId);
  return [...new Set((pose.tiles || []).map((t) => t.hash >>> 0))].filter((h) => !others.has(h));
}

/**
 * The group without these patterns: out of its pattern list and out of its own paint. Paint in
 * the shared pack is the caller's (see {@link unclaimedPatterns}).
 * @param {any} group @param {Iterable<number>} hashes
 * @returns {any} a new group; `tileColors` comes back as a Map when the group had any
 */
export function withoutPatterns(group, hashes) {
  const drop = new Set([...hashes].map((h) => h >>> 0));
  if (!drop.size) return group;
  const crit = group.criteria || {};
  const next = {
    ...group,
    criteria: { ...crit, hashes: (Array.isArray(crit.hashes) ? crit.hashes : []).filter((h) => !drop.has(Number(h) >>> 0)) },
  };
  const paint = decodeGroupTileColors(group);
  if (paint.size) {
    const kept = new Map([...paint].filter(([h]) => !drop.has(h >>> 0)));
    next.tileColors = kept;
  }
  return next;
}

/**
 * Of these patterns, the ones no group lists or uses in a pose: their shared-pack paint belongs to
 * nobody once the group or pose that had them is gone.
 * @param {any[]} groups @param {Iterable<number>} hashes
 * @returns {number[]}
 */
export function unclaimedPatterns(groups, hashes) {
  const claimed = new Set();
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const h of g?.criteria?.hashes || []) claimed.add(Number(h) >>> 0);
    for (const h of patternsInPoses(g)) claimed.add(h);
  }
  return [...new Set([...hashes].map((h) => h >>> 0))].filter((h) => !claimed.has(h));
}

/** A BG group whose tiles are an animation (tile slots), not poses. */
const isTileAnimationGroup = (g) => !isObjGroup(g) && Array.isArray(g?.criteria?.tileSlots) && g.criteria.tileSlots.length > 0;

/**
 * Groups a pose can move to: the same kind (sprite or background), not an animated-tiles group.
 * A background group can hold affine poses (patterns only) and flat ones (placed tiles) side by
 * side — Mario-PlayingAs and IntroMario both do — so the pose's form does not narrow the choice.
 * @param {any[]} groups @param {string} fromId @param {string} poseId
 * @returns {any[]}
 */
export function poseMoveTargets(groups, fromId, poseId) {
  const from = groups.find((g) => g.id === fromId);
  const pose = (Array.isArray(from?.poses) ? from.poses : []).find((p) => p.poseId === poseId);
  if (!from || !pose) return [];
  const obj = isObjGroup(from);
  return groups.filter((g) => g.id !== fromId && isObjGroup(g) === obj && !isTileAnimationGroup(g));
}

/**
 * Move a pose from one group to another. The patterns only it used leave the source group with
 * their group paint, and the target gains them (and that paint, where it has none of its own) —
 * left behind, the source would keep painting them, and the earlier group in the list wins.
 * Patterns the source's other poses share stay there, with their paint: the target gets the
 * patterns but no copy of that paint (Oct 9 2026 — a copy brought one character's colours into
 * another, e.g. Mario's red onto Luigi's tiles, which then had to be painted over).
 * Track steps using the pose are dropped. Sprite paint lives in the shared pack and stays put.
 * @param {any[]} groups @param {string} fromId @param {string} toId @param {string} poseId
 * @param {{ windowIds?: number[] }} [options] worlds the target should also match (the pose's frame)
 * @returns {{ groups: any[], poseId: string, carried: number, left: number, shared: number } | null}
 *   `poseId` is the pose's id in the target (renumbered on a clash); `carried` painted patterns
 *   copied to the target; `left` patterns that left the source; `shared` stayed for other poses.
 */
export function movePoseBetweenGroups(groups, fromId, toId, poseId, { windowIds = [] } = {}) {
  const from = groups.find((g) => g.id === fromId);
  const to = groups.find((g) => g.id === toId);
  if (!from || !to || !poseMoveTargets(groups, fromId, poseId).includes(to)) return null;
  const pose = from.poses.find((p) => p.poseId === poseId);
  const hashes = [...new Set((pose.tiles || []).map((t) => t.hash >>> 0))];
  const others = patternsInPoses(from, poseId);
  const leaving = hashes.filter((h) => !others.has(h));

  const added = addPoseToGroup(to, pose, { windowIds });
  const newId = added.poses[added.poses.length - 1].poseId;
  let carried = 0;
  let target = added;
  if (!isObjGroup(from)) {
    const fromPaint = decodeGroupTileColors(from);
    const paint = new Map(decodeGroupTileColors(to));
    for (const h of leaving) {
      if (paint.has(h) || !fromPaint.has(h)) continue;
      paint.set(h, Uint8Array.from(fromPaint.get(h)));
      carried++;
    }
    // Keep the target's stored form: live buffers while a tool paints it, else the saved one.
    if (carried) target = { ...added, tileColors: to.tileColors instanceof Map ? paint : encodeGroupTileColors(paint) };
  }
  const source = withoutPatterns(removePoseFromGroup(from, poseId), leaving);
  return {
    groups: groups.map((g) => (g.id === fromId ? source : g.id === toId ? target : g)),
    poseId: newId,
    carried,
    left: leaving.length,
    shared: hashes.length - leaving.length,
  };
}
