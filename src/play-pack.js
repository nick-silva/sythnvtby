/**
 * Play packs (.vbcplay): what a player needs to show a game in colour, and nothing else.
 *
 * A .vbpack is a working file — the ROM, every captured frame, save state, RAM dump and
 * screenshot (tens of megabytes). A play pack is the colour only:
 *
 *   play.json                    format, title, author, which ROM it is for (SHA-1, CRC32, size),
 *                                the game's normal brightness (fades are measured against it)
 *   color.vbcolor                tile colours, as in the .vbpack
 *   groups.json                  groups (their paint, layer art, touch-ups), pools, presets
 *   overrides.json               position overrides, when there are any
 *   painter-v2-rules.json        Painter v2 rules, when there are any
 *   painter-v2-vip-overlays.json old screen-pinned overlays, when there are any
 *   cover.png                    optional picture for the player's start screen
 *
 * The ROM is never included: the player asks for it and checks it against play.json.
 * See docs/design/vb-color-player.md §3b.
 */

import JSZip from 'jszip';
import { romIdentity } from './rom-identity.js';
import { AUTHORING_ONLY_GROUP_FIELDS } from './group-schema.js';
import { packPaintsTransparent } from './transparent-paint.js';
import { brightnessReference, masterBrightnessLevels } from './fade.js';

export const PLAY_PACK_FORMAT = 'vbcolor-play';
export const PLAY_PACK_VERSION = 1;
export const PLAY_PACK_EXTENSION = '.vbcplay';

export const PLAY_ENTRIES = Object.freeze({
  INFO: 'play.json',
  VBCOLOR: 'color.vbcolor',
  GROUPS: 'groups.json',
  OVERRIDES: 'overrides.json',
  RULES: 'painter-v2-rules.json',
  OVERLAYS: 'painter-v2-vip-overlays.json',
  COVER: 'cover.png',
});

/** Group fields only the authoring tools use (what is folded open in a list). */
/** @param {unknown} v */
const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * What the pack's groups use, for the player to show (and to refuse a pack it cannot draw).
 * @param {any[]} groups
 */
export function playPackFeatures(groups) {
  const out = new Set(['tileColors']);
  for (const g of groups) {
    if (g?.overpaint) out.add('overpaint');
    if (g?.screens) out.add('screens');
    if (Array.isArray(g?.conditions) && g.conditions.length) out.add('conditions');
    if ((g?.wholePose === true && g?.overpaint) || g?.poseOverpaints?.length) out.add('wholePose');
    if (g?.layerArt) out.add('layerArt');
    if (g?.touchUp) out.add('touchUps');
  }
  return [...out];
}

/** @param {Array<{ json: string | Uint8Array }> | undefined} frames @returns {number | null} */
function frameBrightnessReference(frames) {
  if (!Array.isArray(frames) || !frames.length) return null;
  const texts = frames.map((f) => (typeof f?.json === 'string' ? f.json : new TextDecoder().decode(f?.json || new Uint8Array(0))));
  return brightnessReference(masterBrightnessLevels(texts));
}

/**
 * A play pack from a project's parts (the shape buildArtPack takes: artPackPartsFromParsed, or
 * the Project tool's prepared save).
 * @param {{ rom?: ArrayBuffer, vbcolor?: ArrayBuffer, overrides?: unknown, manifest?: Record<string, any>,
 *   groups?: any[], overridePresets?: any[], gameStatePools?: any[], groupsSchemaVersion?: number,
 *   painterV2Rules?: Record<string, unknown>, painterV2VipOverlays?: string }} parts
 * @param {{ title?: string, author?: string, cover?: Uint8Array | ArrayBuffer | null, now?: Date }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, info: Record<string, any> }>}
 */
export async function buildPlayPack(parts, opts = {}) {
  if (!parts?.vbcolor && !(Array.isArray(parts?.groups) && parts.groups.length)) {
    throw new Error('This project has no colour yet: paint something before exporting for the player.');
  }
  const manifest = isObject(parts.manifest) ? parts.manifest : {};
  let rom = null;
  if (parts.rom && parts.rom.byteLength > 0) rom = await romIdentity(parts.rom);
  else if (manifest.romSha1 || manifest.romCrc32) rom = { size: manifest.romSize, sha1: manifest.romSha1, crc32: manifest.romCrc32 };
  if (!rom) throw new Error('The project has no ROM to identify the game by: open it from its .vbpack first.');
  const groups = (Array.isArray(parts.groups) ? parts.groups : []).map((g) => {
    if (!isObject(g)) return g;
    const copy = { ...g };
    for (const k of AUTHORING_ONLY_GROUP_FIELDS) delete copy[k];
    return copy;
  });
  const info = {
    format: PLAY_PACK_FORMAT,
    version: PLAY_PACK_VERSION,
    title: String(opts.title || manifest.name || manifest.gameId || 'Untitled').slice(0, 200),
    ...(opts.author && { author: String(opts.author).slice(0, 200) }),
    createdAt: (opts.now || new Date()).toISOString(),
    rom: { ...(manifest.romFileName && { fileName: manifest.romFileName }), size: rom.size, sha1: rom.sha1, crc32: rom.crc32 },
    paintOnTransparent: packPaintsTransparent(manifest),
    // The level most captured frames show (src/fade.js): the player has no frames to measure it from.
    brightnessReference: frameBrightnessReference(parts.vipStatesFolder),
    features: playPackFeatures(groups),
    ...(opts.cover && { cover: PLAY_ENTRIES.COVER }),
  };
  const zip = new JSZip();
  zip.file(PLAY_ENTRIES.INFO, JSON.stringify(info, null, 2));
  if (parts.vbcolor && parts.vbcolor.byteLength > 0) zip.file(PLAY_ENTRIES.VBCOLOR, parts.vbcolor);
  zip.file(
    PLAY_ENTRIES.GROUPS,
    JSON.stringify({
      ...(typeof parts.groupsSchemaVersion === 'number' && { groupsSchemaVersion: parts.groupsSchemaVersion }),
      gameStatePools: Array.isArray(parts.gameStatePools) ? parts.gameStatePools : [],
      ...(Array.isArray(parts.gameStates) && parts.gameStates.length > 0 && { gameStates: parts.gameStates }),
      groups,
      ...(Array.isArray(parts.overridePresets) && parts.overridePresets.length > 0 && { overridePresets: parts.overridePresets }),
    }),
  );
  if (Array.isArray(parts.overrides) && parts.overrides.length > 0) zip.file(PLAY_ENTRIES.OVERRIDES, JSON.stringify(parts.overrides));
  if (isObject(parts.painterV2Rules)) zip.file(PLAY_ENTRIES.RULES, JSON.stringify(parts.painterV2Rules));
  if (typeof parts.painterV2VipOverlays === 'string' && parts.painterV2VipOverlays.length > 0) {
    zip.file(PLAY_ENTRIES.OVERLAYS, parts.painterV2VipOverlays);
  }
  if (opts.cover) zip.file(PLAY_ENTRIES.COVER, opts.cover, { compression: 'STORE' });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, info };
}

/**
 * Read a play pack. Throws an Error with a message for the player's user when it is not one.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {Promise<{ info: Record<string, any>, vbcolor: ArrayBuffer | null, groups: any[], gameStatePools: any[],
 *   groupsSchemaVersion?: number, overridePresets: any[], overrides: any[], painterV2Rules: Record<string, unknown> | null,
 *   painterV2VipOverlays: string | null, cover: Uint8Array | null }>}
 */
export async function parsePlayPack(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('This file is not a play pack (it could not be opened as one).');
  }
  const read = (name, type) => zip.file(name)?.async(type) ?? Promise.resolve(null);
  const infoText = await read(PLAY_ENTRIES.INFO, 'string');
  if (!infoText) {
    const hint = zip.file('manifest.json') ? ' It looks like a .vbpack project: export it for the player from the Project tool.' : '';
    throw new Error(`This file is not a play pack (no ${PLAY_ENTRIES.INFO}).${hint}`);
  }
  let info;
  try {
    info = JSON.parse(infoText);
  } catch {
    throw new Error(`This play pack is damaged (${PLAY_ENTRIES.INFO} is not valid JSON).`);
  }
  if (!isObject(info) || info.format !== PLAY_PACK_FORMAT) throw new Error('This file is not a sythnvtby play pack.');
  if (!(Number(info.version) >= 1) || Number(info.version) > PLAY_PACK_VERSION) {
    throw new Error(`This play pack needs a newer player (pack version ${info.version}, player reads ${PLAY_PACK_VERSION}).`);
  }
  if (!isObject(info.rom) || !(info.rom.sha1 || info.rom.crc32)) throw new Error('This play pack does not say which ROM it is for.');
  const json = async (name, fallback) => {
    const text = await read(name, 'string');
    if (text == null) return fallback;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`This play pack is damaged (${name} is not valid JSON).`);
    }
  };
  const groupsDoc = await json(PLAY_ENTRIES.GROUPS, {});
  const rules = await json(PLAY_ENTRIES.RULES, null);
  const overrides = await json(PLAY_ENTRIES.OVERRIDES, []);
  return {
    info,
    vbcolor: await read(PLAY_ENTRIES.VBCOLOR, 'arraybuffer'),
    groups: Array.isArray(groupsDoc?.groups) ? groupsDoc.groups : [],
    gameStatePools: Array.isArray(groupsDoc?.gameStatePools) ? groupsDoc.gameStatePools : [],
    gameStates: Array.isArray(groupsDoc?.gameStates) ? groupsDoc.gameStates : [],
    ...(typeof groupsDoc?.groupsSchemaVersion === 'number' && { groupsSchemaVersion: groupsDoc.groupsSchemaVersion }),
    overridePresets: Array.isArray(groupsDoc?.overridePresets) ? groupsDoc.overridePresets : [],
    overrides: Array.isArray(overrides) ? overrides : [],
    painterV2Rules: isObject(rules) ? rules : null,
    painterV2VipOverlays: await read(PLAY_ENTRIES.OVERLAYS, 'string'),
    cover: await read(PLAY_ENTRIES.COVER, 'uint8array'),
  };
}
