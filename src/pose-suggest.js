/**
 * Pose suggestions for a background character (SpriteStudio's Find poses): the poses its captured
 * frames show that are not kept yet, and kept poses that duplicate one another. A pose is its
 * layout — which tile pattern sits where, relative to the pose's top-left tile — so the same pose
 * captured on two frames, or kept twice, is one layout.
 */

/**
 * A pose's layout as text: sorted `hash@dx,dy`, offsets from its top-left tile.
 * @param {Array<{ hash: number, dx?: number, dy?: number }>} tiles
 */
export function poseLayoutKey(tiles) {
  if (!Array.isArray(tiles) || !tiles.length) return '';
  let minX = Infinity;
  let minY = Infinity;
  for (const t of tiles) {
    minX = Math.min(minX, t.dx || 0);
    minY = Math.min(minY, t.dy || 0);
  }
  return tiles
    .map((t) => `${t.hash >>> 0}@${(t.dx || 0) - minX},${(t.dy || 0) - minY}`)
    .sort()
    .join(';');
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Layouts the frames show that no kept pose has, each once, from the first frame showing it.
 * Fragments are left out: a layout with fewer tiles than `minShare` of the usual pose (the kept
 * poses' median size, or the frames' when none is kept) is part of the character — half off
 * screen, or the few tiles it shares with another character — not a pose of its own.
 * @param {{ hits: Array<{ frameIndex: number, tiles: any[], view?: any }>, kept: Array<{ tiles: any[] }>, minShare?: number }} args
 * @returns {Array<{ key: string, tiles: number, frames: number[], view: any }>}
 */
export function findNewPoses({ hits, kept, minShare = 0.6 }) {
  const keptKeys = new Set(kept.map((p) => poseLayoutKey(p.tiles)));
  const usual = median((kept.length ? kept : hits).map((p) => (p.tiles || []).length));
  const smallest = Math.max(1, Math.ceil(usual * minShare));
  /** @type {Map<string, { key: string, tiles: number, frames: number[], view: any }>} */
  const found = new Map();
  for (const hit of [...hits].sort((a, b) => a.frameIndex - b.frameIndex)) {
    const key = poseLayoutKey(hit.tiles);
    if (!key || keptKeys.has(key) || hit.tiles.length < smallest) continue;
    const had = found.get(key);
    if (had) had.frames.push(hit.frameIndex);
    else found.set(key, { key, tiles: hit.tiles.length, frames: [hit.frameIndex], view: hit.view });
  }
  return [...found.values()];
}

/** A pose name someone chose: not "Pose 12" and not a frame's label ("#353 · InGame – f-…"). */
const chosenName = (name) => typeof name === 'string' && !!name && !/^Pose \d+$/.test(name) && !/^#\d+ · /.test(name) && !/ – f-[a-z0-9-]+$/.test(name);

/**
 * Kept poses that share a layout. In each set one is kept — the one with a pose picture, else a name
 * someone chose, else one an animation uses, else the first — and the rest can go. A set where more
 * than one pose has a picture is listed but not offered (`safe: false`): removing either would lose
 * a picture. `named` says a pose that would go has a name someone chose (the same art used in two
 * animations, say), so it is better asked about than assumed.
 * @param {any} group
 * @returns {Array<{ keep: string, drop: string[], safe: boolean, named: boolean }>}
 */
export function findDuplicatePoses(group) {
  const poses = Array.isArray(group?.poses) ? group.poses : [];
  const pictured = new Set((Array.isArray(group?.poseOverpaints) ? group.poseOverpaints : []).map((p) => p?.poseId).filter(Boolean));
  const inTracks = new Set();
  for (const s of Array.isArray(group?.track) ? group.track : []) inTracks.add(s?.poseId);
  for (const t of Array.isArray(group?.tracks) ? group.tracks : []) for (const s of t?.steps || []) inTracks.add(s?.poseId);
  /** @type {Map<string, any[]>} */
  const byKey = new Map();
  for (const p of poses) {
    if (p?.affine) continue;
    const key = poseLayoutKey(p.tiles);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  const out = [];
  for (const same of byKey.values()) {
    if (same.length < 2) continue;
    const rank = (p) => (pictured.has(p.poseId) ? 4 : 0) + (chosenName(p.name) ? 2 : 0) + (inTracks.has(p.poseId) ? 1 : 0);
    const keep = same.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    const drop = same.filter((p) => p !== keep);
    out.push({
      keep: keep.poseId,
      drop: drop.map((p) => p.poseId),
      safe: same.filter((p) => pictured.has(p.poseId)).length <= 1,
      named: drop.some((p) => chosenName(p.name)),
    });
  }
  return out;
}

/**
 * The group with pose `dropId` folded into its twin `keepId`: animation steps that used it use the
 * twin, its pose picture becomes the twin's when the twin has none, and the pose goes. The tiles
 * stay (the twin has the same ones). The group passed in is not changed.
 * @param {any} group @param {string} dropId @param {string} keepId
 */
export function mergeDuplicatePose(group, dropId, keepId) {
  const swap = (s) => (s?.poseId === dropId ? { ...s, poseId: keepId } : s);
  const next = { ...group, poses: (group.poses || []).filter((p) => p.poseId !== dropId) };
  if (Array.isArray(group.track)) next.track = group.track.map(swap);
  if (Array.isArray(group.tracks)) next.tracks = group.tracks.map((t) => ({ ...t, steps: (t.steps || []).map(swap) }));
  if (Array.isArray(group.poseOverpaints)) {
    const keepHas = group.poseOverpaints.some((p) => p?.poseId === keepId);
    next.poseOverpaints = group.poseOverpaints
      .map((p) => (p?.poseId === dropId && !keepHas ? { ...p, poseId: keepId } : p))
      .filter((p) => p?.poseId !== dropId);
    if (!next.poseOverpaints.length) delete next.poseOverpaints;
  }
  return next;
}
