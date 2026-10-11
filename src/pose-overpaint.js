/**
 * Pose pictures: overpaint for one pose of a BG character, kept inside the character's group.
 *
 * `group.poseOverpaints` lists them: `{ id, name, hashes, world, bgmapBase, mapX, mapY, width,
 * height, png, hideTiles }` — `hashes` are the pose's patterns (the card it was painted on), the
 * rest an overpaint (src/overpaint.js). Each is drawn exactly like a whole-pose group
 * (src/overpaint-switch.js): only when every one of its patterns is on the layer, and of two poses
 * there only the fuller. To draw them, the compositor expands each into such a group, placed right
 * after its character ({@link expandPoseOverpaints}); its pixels live under
 * {@link posePictureKey}. Before this, SpriteStudio made a separate group per pose
 * (`wholePose` + `poseOf`); {@link foldPoseGroups} turns those into pose pictures.
 */

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** The picture's key in the pixel store, and its drawn group's id. */
export const posePictureKey = (groupId, poseId) => `${groupId}#pose:${poseId}`;

/**
 * The patterns of a group's saved pose (its tiles that are the group's), or null when the group has
 * no such pose. A pose picture painted on a saved pose (`poseId`) follows that pose: recapturing it
 * or moving its tiles cannot leave the picture waiting for tiles the pose no longer has.
 * @param {any} group @param {unknown} poseId
 * @returns {number[] | null}
 */
export function savedPoseHashes(group, poseId) {
  if (typeof poseId !== 'string' || !Array.isArray(group?.poses)) return null;
  const pose = group.poses.find((p) => p?.poseId === poseId);
  if (!pose || !Array.isArray(pose.tiles)) return null;
  const own = new Set((Array.isArray(group.criteria?.hashes) ? group.criteria.hashes : []).map((h) => Number(h) >>> 0));
  const hashes = [...new Set(pose.tiles.map((t) => Number(t?.hash) >>> 0))].filter((h) => !own.size || own.has(h));
  return hashes.length ? hashes : null;
}

/** A pose picture's patterns: its saved pose's while the pose exists, else its own list. */
function pictureHashes(group, p) {
  return savedPoseHashes(group, p?.poseId) || (Array.isArray(p?.hashes) ? p.hashes.map((h) => Number(h) >>> 0) : []);
}

/** @param {any} p a poseOverpaints entry @param {any} group @returns {boolean} */
function validEntry(p, group) {
  return (
    !!p &&
    typeof p.id === 'string' &&
    !!p.id &&
    pictureHashes(group, p).length > 0 &&
    isInt(p.world, 0, 31) &&
    isInt(p.mapX, 0, 0x1fff) &&
    isInt(p.mapY, 0, 0x1fff) &&
    isInt(p.width, 1, 4096) &&
    isInt(p.height, 1, 4096)
  );
}

/** group object → its drawn pose groups, worked out once per group object. */
const _byGroup = new WeakMap();

/**
 * A group's pose pictures as whole-pose groups to draw (no tile colours, the character's worlds,
 * layers and screens). The same objects come back for the same group object.
 * @param {any} group
 * @returns {any[]}
 */
export function posePictureGroups(group) {
  if (!group || !Array.isArray(group.poseOverpaints) || !group.poseOverpaints.length) return [];
  const cached = _byGroup.get(group);
  if (cached) return cached;
  const c = group.criteria || {};
  const out = group.poseOverpaints.filter((p) => validEntry(p, group)).map((p) => ({
    id: posePictureKey(group.id, p.id),
    name: `${group.name || group.id} · ${p.name || p.id}`,
    poseName: p.name || p.id,
    wholePose: true,
    poseOf: group.id,
    posePictureId: p.id,
    criteria: {
      windowIds: Array.isArray(c.windowIds) ? [...c.windowIds] : [],
      layers: Array.isArray(c.layers) ? [...c.layers] : [0],
      hashes: pictureHashes(group, p),
    },
    ...(group.screens && { screens: group.screens }),
    overpaint: {
      world: p.world,
      bgmapBase: isInt(p.bgmapBase, 0, 15) ? p.bgmapBase : null,
      mapX: p.mapX,
      mapY: p.mapY,
      width: p.width,
      height: p.height,
      png: typeof p.png === 'string' ? p.png : '',
      hideTiles: p.hideTiles === true,
    },
  }));
  _byGroup.set(group, out);
  return out;
}

/** groups array → the list with pose pictures, worked out once per array. */
const _expanded = new WeakMap();

/**
 * The groups with each character's pose pictures right after it (src/layer-art.js and
 * src/overpaint.js draw them). The list itself when no group has any.
 * @param {any[]} groups
 * @returns {any[]}
 */
export function expandPoseOverpaints(groups) {
  if (!Array.isArray(groups)) return groups;
  const cached = _expanded.get(groups);
  if (cached) return cached;
  let out = groups;
  if (groups.some((g) => Array.isArray(g?.poseOverpaints) && g.poseOverpaints.length)) {
    out = [];
    for (const g of groups) {
      out.push(g);
      out.push(...posePictureGroups(g));
    }
  }
  _expanded.set(groups, out);
  return out;
}

/**
 * An id for a new pose picture in this group, unlike any it has.
 * @param {any} group @param {() => number} [now]
 */
export function newPosePictureId(group, now = Date.now) {
  const taken = new Set((Array.isArray(group?.poseOverpaints) ? group.poseOverpaints : []).map((p) => p.id));
  const base = `p${now().toString(36)}`;
  let id = base;
  for (let n = 1; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The group with one pose picture replaced (`next` an overpaint, plus `hashes`/`name`/`poseId` when
 * it is new), or removed (`next` null). The group passed in is not changed.
 * @param {any} group @param {string} pictureId the picture's own id (not the saved pose's)
 * @param {any | null} next
 */
export function withPosePicture(group, pictureId, next) {
  const list = Array.isArray(group?.poseOverpaints) ? group.poseOverpaints : [];
  const at = list.findIndex((p) => p.id === pictureId);
  let out;
  if (!next) out = list.filter((p) => p.id !== pictureId);
  else {
    const prev = at >= 0 ? list[at] : { id: pictureId, name: next.name || pictureId, hashes: next.hashes || [] };
    const { world, bgmapBase, mapX, mapY, width, height, png, hideTiles } = next;
    // The saved pose it was painted on, kept as it was unless `next` names one.
    const savedPose = typeof next.poseId === 'string' ? next.poseId : prev.poseId;
    const entry = {
      id: prev.id,
      name: next.name || prev.name,
      ...(typeof savedPose === 'string' && { poseId: savedPose }),
      hashes: [...(next.hashes || prev.hashes)].map((h) => Number(h) >>> 0),
      world, bgmapBase: bgmapBase ?? null, mapX, mapY, width, height, png: png || '', hideTiles: hideTiles === true,
    };
    out = at >= 0 ? list.map((p, i) => (i === at ? entry : p)) : [...list, entry];
  }
  const { poseOverpaints: _old, ...rest } = group;
  return out.length ? { ...rest, poseOverpaints: out } : rest;
}

/**
 * The pose picture for a card: the one painted on its saved pose (`poseId`), else the one whose
 * patterns are the card's (a card that is a captured frame, not a saved pose). Null when none.
 * @param {any} group @param {number[]} patterns @param {string} [poseId] the card's saved pose
 */
export function posePictureFor(group, patterns, poseId) {
  const list = Array.isArray(group?.poseOverpaints) ? group.poseOverpaints : [];
  if (typeof poseId === 'string') {
    const linked = list.find((p) => p.poseId === poseId);
    if (linked) return linked;
  }
  const want = new Set(patterns.map((h) => Number(h) >>> 0));
  if (!want.size) return null;
  for (const p of list) {
    const hs = pictureHashes(group, p);
    if (new Set(hs).size === want.size && hs.every((h) => want.has(h))) return p;
  }
  return null;
}

/**
 * Pose pictures made before they were tied to a saved pose get the pose whose patterns they have.
 * The group itself when nothing changes.
 * @param {any} group
 */
export function linkPosePictures(group) {
  const list = Array.isArray(group?.poseOverpaints) ? group.poseOverpaints : [];
  if (!list.some((p) => typeof p.poseId !== 'string') || !Array.isArray(group.poses)) return group;
  let changed = false;
  const next = list.map((p) => {
    if (typeof p.poseId === 'string') return p;
    const want = new Set((p.hashes || []).map((h) => Number(h) >>> 0));
    const pose = group.poses.find((q) => {
      const hs = savedPoseHashes(group, q?.poseId);
      return hs && hs.length === want.size && hs.every((h) => want.has(h));
    });
    if (!pose) return p;
    changed = true;
    return { ...p, poseId: pose.poseId };
  });
  return changed ? { ...group, poseOverpaints: next } : group;
}

/**
 * Whole-pose groups made by the old "Overpaint just this pose" (`wholePose`, `poseOf` naming a
 * group still there) become that group's pose pictures. `moved` says which pixels move to which key.
 * @param {any[]} groups
 * @returns {{ groups: any[], moved: Array<{ from: string, to: string }> }}
 */
export function foldPoseGroups(groups) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const poses = groups.filter((g) => g?.wholePose === true && typeof g.poseOf === 'string' && byId.has(g.poseOf) && g.overpaint && g.poseOf !== g.id);
  if (!poses.length) return { groups, moved: [] };
  /** @type {Map<string, any>} */
  const parents = new Map();
  const moved = [];
  for (const p of poses) {
    const parent = parents.get(p.poseOf) || byId.get(p.poseOf);
    const prefix = `${parent.name || parent.id} · `;
    const name = typeof p.name === 'string' && p.name.startsWith(prefix) ? p.name.slice(prefix.length) : p.name || p.id;
    parents.set(p.poseOf, withPosePicture(parent, p.id, { ...p.overpaint, hashes: p.criteria?.hashes || [], name }));
    moved.push({ from: p.id, to: posePictureKey(p.poseOf, p.id) });
  }
  const gone = new Set(poses.map((p) => p.id));
  return { groups: groups.filter((g) => !gone.has(g.id)).map((g) => parents.get(g.id) || g), moved };
}
