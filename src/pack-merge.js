/**
 * Bring work from one project (.vbpack) into another: File ▸ Import from another pack… in the
 * Project tool. Pure functions over pack parts (the shape buildArtPack takes).
 *
 * What comes across from the other pack:
 * - groups the open project does not have (matched by id, else by name);
 * - for groups both have: poses it lacks, tile paint it lacks, the other pack's criteria entries
 *   (world, pattern and layer lists are unioned), and layer art / touch-up / shade ramp it lacks;
 * - captured frames it lacks (snapshot, save state, RAM dump, screenshot, registry entry),
 *   reference pictures it lacks, sprite colours (color.vbcolor) it lacks, position overrides.
 * Where both packs have something different under the same key — a tile painted differently, a
 * sprite colour, a group's layer art — `clash` decides: 'mine' keeps the open project's (the
 * default), 'theirs' takes the other pack's. Two different poses that happen to share an id are
 * both kept; the incoming one gets a new id.
 */

import { decodeGroupTileColors, encodeGroupTileColors } from './group-tile-colors.js';
import { parseVBColorPack, buildVBColorPack } from './vbcolor-pack.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const GROUP_PICTURES = ['overpaint', 'layerArt', 'touchUp', 'shadeRamp'];

/** Match each of their groups to one of mine: same id, else same name (one-to-one). */
function matchGroups(mine, theirs) {
  const byId = new Map(mine.map((g) => [g.id, g]));
  const byName = new Map(mine.filter((g) => g.name).map((g) => [g.name, g]));
  const used = new Set();
  /** @type {Map<any, any>} their group → my group */
  const out = new Map();
  for (const t of theirs) {
    let m = byId.get(t.id);
    if (!m || used.has(m)) m = t.name ? byName.get(t.name) : undefined;
    if (m && !used.has(m)) {
      out.set(t, m);
      used.add(m);
    }
  }
  return out;
}

/** Union of two lists, mine first, by value. */
function unionList(a = [], b = []) {
  const seen = new Set(a.map((v) => JSON.stringify(v)));
  return [...a, ...b.filter((v) => !seen.has(JSON.stringify(v)))];
}

function freePoseId(poses, id) {
  let candidate = `${id}-imported`;
  for (let n = 2; poses.some((p) => p.poseId === candidate); n++) candidate = `${id}-imported-${n}`;
  return candidate;
}

const posesOf = (g) => (Array.isArray(g.poses) ? g.poses : []);
/** The pose without its id: two packs can hold the same pose under different ids. */
const poseBody = ({ poseId: _id, ...rest }) => JSON.stringify(rest);

/**
 * Their poses this group lacks: not there by id, nor (under another id) by content. `clashing`
 * are the ones whose id this group uses for a different pose.
 */
function newPoses(mine, theirs) {
  const pm = posesOf(mine);
  const ids = new Map(pm.map((p) => [p.poseId, p]));
  const bodies = new Set(pm.map(poseBody));
  const fresh = [];
  const clashing = [];
  for (const p of posesOf(theirs)) {
    const twin = ids.get(p.poseId);
    if ((twin && same(twin, p)) || bodies.has(poseBody(p))) continue;
    fresh.push(p);
    if (twin) clashing.push(p);
  }
  return { fresh, clashing };
}

/** hash → RGBA entries of `theirs` that `mine` lacks, and those it paints differently. */
function colourDelta(mine, theirs) {
  const only = [];
  const clashing = [];
  for (const [h, rgba] of theirs) {
    const m = mine.get(h);
    if (!m) only.push(h);
    else if (!bytesEqual(m, rgba)) clashing.push(h);
  }
  return { only, clashing };
}

/** What one group both packs have would gain. */
function groupDelta(mine, theirs) {
  const { fresh, clashing: posesSharingAnId } = newPoses(mine, theirs);
  const posesOnlyTheirs = fresh.filter((p) => !posesSharingAnId.includes(p));
  const tiles = colourDelta(decodeGroupTileColors(mine), decodeGroupTileColors(theirs));
  let criteriaAdds = 0;
  const crm = mine.criteria || {};
  for (const [key, list] of Object.entries(theirs.criteria || {})) {
    if (!Array.isArray(list)) continue;
    const have = new Set((Array.isArray(crm[key]) ? crm[key] : []).map((v) => JSON.stringify(v)));
    criteriaAdds += list.filter((v) => !have.has(JSON.stringify(v))).length;
  }
  const pictures = GROUP_PICTURES.filter((k) => theirs[k] != null && !same(mine[k], theirs[k])).map((k) => ({
    key: k,
    clash: mine[k] != null,
  }));
  const tracksMine = Array.isArray(mine.tracks) ? mine.tracks : [];
  const tracksOnlyTheirs = (Array.isArray(theirs.tracks) ? theirs.tracks : []).filter(
    (t) => t && !tracksMine.some((m) => m.id === t.id || (t.name && m.name === t.name)),
  ).length;
  return { posesOnlyTheirs, posesSharingAnId, tiles, criteriaAdds, pictures, tracksOnlyTheirs };
}

function vbcolorEntries(buf) {
  return (buf && buf.byteLength ? parseVBColorPack(buf)?.entries : null) || new Map();
}

const names = (list) => new Set((list || []).map((x) => x.name));
const referenceItems = (parts) => (Array.isArray(parts.manifest?.references?.items) ? parts.manifest.references.items : []);

/**
 * What importing `theirs` into `mine` would bring, for the dialog.
 * @param {any} mine @param {any} theirs pack parts
 */
export function comparePacks(mine, theirs) {
  const gm = Array.isArray(mine.groups) ? mine.groups : [];
  const gt = Array.isArray(theirs.groups) ? theirs.groups : [];
  const matched = matchGroups(gm, gt);
  const groupsOnlyTheirs = gt
    .filter((t) => !matched.has(t))
    .map((t) => ({ name: t.name || t.id, poses: posesOf(t).length, tiles: decodeGroupTileColors(t).size }));
  const groups = [];
  for (const [t, m] of matched) {
    const d = groupDelta(m, t);
    const changes =
      d.posesOnlyTheirs.length + d.posesSharingAnId.length + d.tiles.only.length + d.tiles.clashing.length + d.criteriaAdds + d.pictures.length + d.tracksOnlyTheirs;
    if (!changes) continue;
    groups.push({
      name: m.name || m.id,
      posesOnlyTheirs: d.posesOnlyTheirs.map((p) => p.name || p.poseId),
      posesSharingAnId: d.posesSharingAnId.map((p) => p.name || p.poseId),
      tilesOnlyTheirs: d.tiles.only.length,
      tileClashes: d.tiles.clashing.length,
      criteriaAdds: d.criteriaAdds,
      tracksOnlyTheirs: d.tracksOnlyTheirs,
      pictures: d.pictures,
    });
  }
  const framesMine = names(mine.vipStatesFolder);
  const framesOnlyTheirs = (theirs.vipStatesFolder || []).filter((f) => !framesMine.has(f.name)).length;
  const refIds = new Set(referenceItems(mine).map((r) => r.refId));
  const referencesOnlyTheirs = referenceItems(theirs).filter((r) => !refIds.has(r.refId)).length;
  const sprites = colourDelta(vbcolorEntries(mine.vbcolor), vbcolorEntries(theirs.vbcolor));
  const ovMine = Array.isArray(mine.overrides) ? mine.overrides : [];
  const overridesOnlyTheirs = (Array.isArray(theirs.overrides) ? theirs.overrides : []).filter((o) => !ovMine.some((x) => same(x, o))).length;
  const shaMine = mine.manifest?.romSha1;
  const shaTheirs = theirs.manifest?.romSha1;
  const clashes =
    groups.reduce((n, g) => n + g.tileClashes + g.pictures.filter((p) => p.clash).length, 0) + sprites.clashing.length;
  return {
    sameRom: shaMine && shaTheirs ? shaMine === shaTheirs : null,
    groupsOnlyTheirs,
    groups,
    framesOnlyTheirs,
    referencesOnlyTheirs,
    spriteColoursOnlyTheirs: sprites.only.length,
    spriteColourClashes: sprites.clashing.length,
    overridesOnlyTheirs,
    clashes,
    nothingToImport:
      !groupsOnlyTheirs.length &&
      !groups.length &&
      !framesOnlyTheirs &&
      !referencesOnlyTheirs &&
      !sprites.only.length &&
      !sprites.clashing.length &&
      !overridesOnlyTheirs,
  };
}

/** `mine`'s colours plus `theirs`' new ones (and clashing ones when `takeTheirs`). */
function mergeColours(mine, theirs, takeTheirs) {
  const { only, clashing } = colourDelta(mine, theirs);
  const taken = takeTheirs ? clashing : [];
  if (!only.length && !taken.length) return { map: mine, added: 0, taken: 0 };
  const map = new Map(mine);
  for (const h of [...only, ...taken]) map.set(h, theirs.get(h));
  return { map, added: only.length, taken: taken.length };
}

function mergeGroup(mine, theirs, clash, log) {
  const name = mine.name || mine.id;
  const out = { ...mine };
  const tiles = mergeColours(decodeGroupTileColors(mine), decodeGroupTileColors(theirs), clash === 'theirs');
  if (tiles.added || tiles.taken) out.tileColors = encodeGroupTileColors(tiles.map);

  const crm = mine.criteria || {};
  const criteria = { ...crm };
  for (const [key, list] of Object.entries(theirs.criteria || {})) {
    if (Array.isArray(list)) criteria[key] = unionList(Array.isArray(crm[key]) ? crm[key] : [], list);
    else if (!(key in crm)) criteria[key] = list;
  }
  if (mine.criteria || theirs.criteria) out.criteria = criteria;

  const poses = [...posesOf(mine)];
  let posesAdded = 0;
  for (const p of newPoses(mine, theirs).fresh) {
    const twin = poses.find((q) => q.poseId === p.poseId);
    if (twin) {
      const id = freePoseId(poses, p.poseId);
      poses.push({ ...p, poseId: id });
      log.push(`“${name}”: poses “${twin.name || twin.poseId}” and “${p.name || p.poseId}” shared an id; both kept.`);
    } else {
      poses.push(p);
    }
    posesAdded++;
  }
  if (posesAdded) out.poses = poses;

  // Their animation tracks this group lacks (by id, else name), pointed at the poses' ids here.
  const tracksMine = Array.isArray(mine.tracks) ? mine.tracks : [];
  const idHere = new Map();
  for (const p of posesOf(theirs)) {
    const match = poses.find((q) => poseBody(q) === poseBody(p));
    if (match) idHere.set(p.poseId, match.poseId);
  }
  const tracksAdded = (Array.isArray(theirs.tracks) ? theirs.tracks : [])
    .filter((t) => t && !tracksMine.some((m) => m.id === t.id || (t.name && m.name === t.name)))
    .map((t) => ({
      ...t,
      steps: (Array.isArray(t.steps) ? t.steps : []).filter((st) => idHere.has(st.poseId)).map((st) => ({ ...st, poseId: idHere.get(st.poseId) })),
    }))
    .filter((t) => t.steps.length > 0);
  if (tracksAdded.length) {
    out.tracks = [...tracksMine, ...tracksAdded];
    log.push(`“${name}”: ${tracksAdded.length} animation(s) added.`);
  }

  for (const key of GROUP_PICTURES) {
    if (theirs[key] == null || same(mine[key], theirs[key])) continue;
    if (mine[key] == null || clash === 'theirs') out[key] = theirs[key];
  }
  if (tiles.added || tiles.taken || posesAdded) {
    const repainted = tiles.taken ? `, ${tiles.taken} repainted from the other pack` : '';
    log.push(`“${name}”: ${posesAdded} pose(s), ${tiles.added} painted tile(s) added${repainted}.`);
  }
  return out;
}

function mergeFrames(mine, theirs, parts, log) {
  let frames = 0;
  for (const key of ['vipStatesFolder', 'saveStatesFolder', 'ramdumpsFolder', 'screenshotsFolder']) {
    const have = names(mine[key]);
    const extra = (theirs[key] || []).filter((x) => !have.has(x.name));
    if (!extra.length) continue;
    parts[key] = [...(mine[key] || []), ...extra];
    if (key === 'vipStatesFolder') frames = extra.length;
  }
  const reg = Array.isArray(mine.manifest?.frameRegistry) ? mine.manifest.frameRegistry : [];
  const regIds = new Set(reg.map((r) => r.frameId));
  const regExtra = (Array.isArray(theirs.manifest?.frameRegistry) ? theirs.manifest.frameRegistry : []).filter(
    (r) => !regIds.has(r.frameId),
  );
  if (regExtra.length) parts.manifest = { ...(parts.manifest || {}), frameRegistry: [...reg, ...regExtra] };
  if (frames) log.push(`${frames} captured frame(s) added.`);
}

function mergeReferences(mine, theirs, parts, log) {
  const refIds = new Set(referenceItems(mine).map((r) => r.refId));
  const extra = referenceItems(theirs).filter((r) => !refIds.has(r.refId));
  if (!extra.length) return;
  const files = names(mine.referencesFolder);
  const extraFiles = (theirs.referencesFolder || []).filter((x) => !files.has(x.name));
  if (extraFiles.length) parts.referencesFolder = [...(mine.referencesFolder || []), ...extraFiles];
  const activeMine = mine.manifest?.references?.active || {};
  const activeTheirs = theirs.manifest?.references?.active || {};
  parts.manifest = {
    ...(parts.manifest || {}),
    references: { items: [...referenceItems(mine), ...extra], active: { ...activeTheirs, ...activeMine } },
  };
  log.push(`${extra.length} reference picture(s) added.`);
}

/**
 * The open project with the other pack's work added. Neither input is changed.
 * @param {any} mine @param {any} theirs pack parts
 * @param {{ clash?: 'mine' | 'theirs' }} [opts]
 * @returns {{ parts: any, log: string[] }}
 */
export function mergePacks(mine, theirs, { clash = 'mine' } = {}) {
  const log = [];
  const gm = Array.isArray(mine.groups) ? mine.groups : [];
  const gt = Array.isArray(theirs.groups) ? theirs.groups : [];
  const matched = matchGroups(gm, gt);
  const theirsFor = new Map([...matched].map(([t, m]) => [m, t]));
  const groups = gm.map((m) => (theirsFor.has(m) ? mergeGroup(m, theirsFor.get(m), clash, log) : m));
  for (const t of gt) {
    if (matched.has(t)) continue;
    let id = t.id;
    for (let n = 2; groups.some((g) => g.id === id); n++) id = `${t.id}-imported${n > 2 ? `-${n}` : ''}`;
    groups.push(id === t.id ? t : { ...t, id });
    log.push(`New group “${t.name || t.id}”.`);
  }

  const parts = { ...mine, groups };
  mergeFrames(mine, theirs, parts, log);
  mergeReferences(mine, theirs, parts, log);

  const sprites = mergeColours(vbcolorEntries(mine.vbcolor), vbcolorEntries(theirs.vbcolor), clash === 'theirs');
  if (sprites.added || sprites.taken) {
    const gameId = (mine.vbcolor?.byteLength && parseVBColorPack(mine.vbcolor)?.gameId) || mine.manifest?.gameId || 'vb-pack';
    parts.vbcolor = buildVBColorPack(gameId, sprites.map);
    const taken = sprites.taken ? `, ${sprites.taken} taken from the other pack` : '';
    log.push(`${sprites.added} sprite colour(s) added${taken}.`);
  }

  const ov = Array.isArray(mine.overrides) ? mine.overrides : [];
  const ovExtra = (Array.isArray(theirs.overrides) ? theirs.overrides : []).filter((o) => !ov.some((x) => same(x, o)));
  if (ovExtra.length) {
    parts.overrides = [...ov, ...ovExtra];
    log.push(`${ovExtra.length} position override(s) added.`);
  }

  if (!log.length) log.push('Nothing new to bring in.');
  return { parts, log };
}
