/**
 * The one group schema (groups.json `groups[]`, docs/reference/art-pack-file-format.md §6.4) every
 * tool reads groups through. {@link normalizeGroup} tidies the fields it knows and keeps every
 * other field as it is, so a field one tool adds survives a save in another (the Project tool used
 * to keep only the fields it knew, and dropped SpriteStudio's `folder` that way).
 */
import { normalizeObjProfileFields } from './obj-sprite-profiles.js';
import { groupScreensOf } from './screen-gate.js';
import { groupConditionsOf } from './game-states.js';
import { layerArtOf } from './layer-art.js';
import { touchUpOf } from './touch-up.js';
import { folderOf } from './group-folders.js';

/**
 * Every group field the tools know. `play: false` fields are authoring state and are left out of a
 * play pack (src/play-pack.js); `internal` fields are not part of the documented format.
 * @type {ReadonlyArray<{ key: string, play?: false, internal?: true }>}
 */
export const GROUP_FIELDS = Object.freeze([
  { key: 'id' },
  { key: 'name' },
  { key: 'criteria' },
  { key: 'statePoolId' },
  { key: 'stateVariantId' },
  { key: 'ramConditions' },
  { key: 'screens' },
  { key: 'conditions' },
  { key: 'authoringKind' },
  { key: 'overpaint' },
  { key: 'anchorHash' },
  { key: 'tileColors' },
  { key: 'layerArt' },
  { key: 'touchUp' },
  { key: 'folder' },
  { key: 'shadeRamp' },
  { key: 'poseOverpaints' },
  { key: 'wholePose' },
  { key: 'poseOf' },
  { key: 'followPalette' },
  { key: 'poses' },
  { key: 'tracks' },
  { key: 'track' },
  { key: 'visible' },
  { key: 'expanded', play: false },
  { key: '_authoringRamOff', internal: true },
]);

/** Fields a play pack leaves out. */
export const AUTHORING_ONLY_GROUP_FIELDS = Object.freeze(GROUP_FIELDS.filter((f) => f.play === false).map((f) => f.key));

const KNOWN = new Set(GROUP_FIELDS.map((f) => f.key));
// `worldIds` is the old name of `windowIds`, folded into it.
const KNOWN_CRITERIA = new Set(['windowIds', 'worldIds', 'hashes', 'layers', 'tileSlots']);

/** @param {Record<string, any>} obj @param {Set<string>} known */
function unknownFields(obj, known) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!known.has(k)) out[k] = v;
  return out;
}

/** @param {any} paint */
function hasTileColors(paint) {
  if (paint instanceof Map) return paint.size > 0;
  return !!paint && typeof paint === 'object' && Object.keys(paint).length > 0;
}

/**
 * A group with its known fields checked and given defaults, and its other fields kept. A known
 * field that is malformed is dropped. Returns a new object; the input is not changed.
 * @param {any} g
 * @returns {any}
 */
export function normalizeGroup(g) {
  const inCrit = g.criteria && typeof g.criteria === 'object' ? g.criteria : {};
  const windowIds = Array.isArray(inCrit.windowIds) ? inCrit.windowIds : Array.isArray(inCrit.worldIds) ? inCrit.worldIds : [];
  /** @type {Record<string, any>} */
  const criteria = {
    ...unknownFields(inCrit, KNOWN_CRITERIA),
    windowIds: [...windowIds],
    hashes: Array.isArray(inCrit.hashes) ? [...inCrit.hashes] : [],
    layers: Array.isArray(inCrit.layers) ? [...inCrit.layers] : [],
  };
  /** @type {Record<string, any>} */
  const out = {
    ...unknownFields(g, KNOWN),
    id: g.id || 'group-' + Math.random().toString(36).slice(2, 9),
    name: g.name || g.id || 'Group',
    criteria,
    visible: g.visible !== false,
    expanded: g.expanded === true,
  };
  if (Array.isArray(g.ramConditions)) out.ramConditions = g.ramConditions.map((rc) => ({ ...rc }));
  if (typeof g.statePoolId === 'string' && g.statePoolId.trim()) out.statePoolId = g.statePoolId.trim();
  if (typeof g.stateVariantId === 'string' && g.stateVariantId.trim()) out.stateVariantId = g.stateVariantId.trim();
  if (g._authoringRamOff === true) out._authoringRamOff = true;
  if (g.authoringKind === 'bg' || g.authoringKind === 'obj') out.authoringKind = g.authoringKind;
  if (typeof g.anchorHash === 'number' && Number.isFinite(g.anchorHash)) out.anchorHash = g.anchorHash;
  // SpriteStudio's folder for the group (src/group-folders.js).
  if (folderOf(g)) out.folder = folderOf(g);
  // Which screens the group's paint shows on (src/screen-gate.js); absent = every screen.
  if (groupScreensOf(g)) out.screens = groupScreensOf(g);
  // Conditions on the project's game states (src/game-states.js); absent = whatever the state.
  if (groupConditionsOf(g).length) out.conditions = groupConditionsOf(g);
  // Paint brightens and dims with the game's palette (paletteFollowFactors, src/color-layer.js).
  if (g.followPalette === true) out.followPalette = true;
  // One pose of a character, made in SpriteStudio for a picture of its own (src/overpaint-switch.js).
  if (g.wholePose === true) out.wholePose = true;
  if (typeof g.poseOf === 'string' && g.poseOf) out.poseOf = g.poseOf;
  // Pictures for single poses, painted in SpriteStudio (src/pose-overpaint.js); kept as saved.
  if (Array.isArray(g.poseOverpaints) && g.poseOverpaints.length) out.poseOverpaints = g.poseOverpaints.map((p) => ({ ...p, hashes: [...(p.hashes || [])] }));
  // Overpaint (src/overpaint.js: a picture in the group's layer's map), painted in SpriteStudio;
  // kept as saved. An older pack's layer art stays layer art until SpriteStudio converts it.
  if (g.overpaint && layerArtOf(g)) out.overpaint = { ...g.overpaint };
  else if (layerArtOf(g)) {
    const { hideTiles: _hide, ...art } = layerArtOf(g);
    out.layerArt = art;
  }
  // Touch-up: "this spot only" paint anchored to the group's tiles (src/touch-up.js).
  if (touchUpOf(g)) out.touchUp = { ...touchUpOf(g) };
  // Animated tiles: the slots the group claims, and the shade colours for steps nobody painted.
  if (Array.isArray(inCrit.tileSlots) && inCrit.tileSlots.length > 0) {
    criteria.tileSlots = inCrit.tileSlots.map(Number).filter(Number.isFinite);
    if (Array.isArray(g.shadeRamp)) out.shadeRamp = [...g.shadeRamp];
  }
  // Painted colours, in whichever form they are in: a live Map while a stroke is in progress, the
  // stored base64 map once saved.
  if (hasTileColors(g.tileColors)) out.tileColors = g.tileColors;
  return { ...out, ...normalizeObjProfileFields(g) };
}
