/**
 * Recovery: when a picture (a group's overpaint or one pose picture, src/pose-overpaint.js) can't be
 * saved or opened correctly, it is **set aside** — taken out of its group and kept, with its
 * settings, its image and why, in the pack's `recovery/` folder — so one damaged picture costs
 * that picture, never the session. SpriteStudio lists set-aside pictures and puts them back:
 * automatically where {@link bestPlacement} finds one clear fit on its group's tiles, else by hand.
 *
 * Damage this catches: a picture whose stored image is not the size its settings say (settings
 * and pixels out of step — their place is then unknown).
 */

import { withOverpaint } from './overpaint.js';
import { posePictureKey, withPosePicture, newPosePictureId } from './pose-overpaint.js';

export const RECOVERY_VERSION = 1;

/**
 * A base64 PNG's size, read from its header; null when it isn't a PNG.
 * @param {string} b64
 * @returns {{ width: number, height: number } | null}
 */
export function pngSize(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  let bytes;
  try {
    bytes = Uint8Array.from(atob(b64.slice(0, 44)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || sig.some((v, i) => bytes[i] !== v)) return null;
  const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/**
 * Every picture in the groups: each group's own and each of its pose pictures, with its raw settings.
 * @param {any[]} groups
 * @returns {Array<{ key: string, group: any, pictureId: string | null, settings: any }>}
 */
export function listPictures(groups) {
  const out = [];
  for (const g of groups || []) {
    if (g?.overpaint && typeof g.overpaint === 'object') out.push({ key: g.id, group: g, pictureId: null, settings: g.overpaint });
    for (const p of Array.isArray(g?.poseOverpaints) ? g.poseOverpaints : []) {
      if (p?.id) out.push({ key: posePictureKey(g.id, p.id), group: g, pictureId: p.id, settings: p });
    }
  }
  return out;
}

/**
 * Pictures whose stored image is not the size their settings say: their place is unknown.
 * @param {any[]} groups
 * @returns {Array<{ key: string, group: any, pictureId: string | null, settings: any, reason: string }>}
 */
export function damagedPictures(groups) {
  const out = [];
  for (const p of listPictures(groups)) {
    if (!p.settings.png) continue;
    const size = pngSize(p.settings.png);
    if (!size) out.push({ ...p, reason: 'its stored image could not be read' });
    else if (size.width !== p.settings.width || size.height !== p.settings.height) {
      out.push({ ...p, reason: `its settings say ${p.settings.width}×${p.settings.height} but its image is ${size.width}×${size.height}, so where it belongs is unknown` });
    }
  }
  return out;
}

/** The groups with one picture (by key) taken out. */
function withoutPicture(groups, key) {
  return groups.map((g) => {
    if (g.id === key) return withOverpaint(g, null);
    const prefix = `${g.id}#pose:`;
    return key.startsWith(prefix) ? withPosePicture(g, key.slice(prefix.length), null) : g;
  });
}

/**
 * Set a picture aside: out of its group, into a recovery item.
 * @param {any[]} groups
 * @param {{ key: string, png: string, reason: string, now?: () => Date }} what `png`: its image as it really is
 * @returns {{ groups: any[], item: any }}
 */
export function setAside(groups, { key, png, reason, now = () => new Date() }) {
  const found = listPictures(groups).find((p) => p.key === key);
  if (!found) throw new Error(`no picture ${key}`);
  const { png: _stored, ...settings } = found.settings;
  const when = now();
  const item = {
    version: RECOVERY_VERSION,
    id: `r-${when.getTime().toString(36)}-${Math.abs(hashString(key)).toString(36)}`,
    setAsideAt: when.toISOString(),
    reason,
    groupId: found.group.id,
    groupName: found.group.name || found.group.id,
    pictureId: found.pictureId,
    settings,
    png,
  };
  return { groups: withoutPicture(groups, key), item };
}

/** @param {string} s */
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** Recovery items as the pack's `recovery/` files. @param {any[]} items */
export function recoveryFolderFrom(items) {
  return (items || []).map((item) => ({ name: `${item.id}.json`, json: JSON.stringify(item) }));
}

/**
 * Recovery items from the pack's `recovery/` files; a file that isn't one is counted, so the caller
 * can say so rather than lose it quietly.
 * @param {Array<{ name: string, json: string }> | undefined} folder
 */
export function itemsFromRecoveryFolder(folder) {
  const items = [];
  /** @type {Array<{ name: string, json: string }>} files to write back untouched */
  const unreadableFiles = [];
  for (const f of folder || []) {
    try {
      const item = JSON.parse(f.json);
      if (item && item.version === RECOVERY_VERSION && typeof item.groupId === 'string' && typeof item.png === 'string' && item.settings) items.push(item);
      else unreadableFiles.push(f);
    } catch {
      unreadableFiles.push(f);
    }
  }
  return { items, unreadable: unreadableFiles.length, unreadableFiles };
}

/**
 * Put a recovered picture back into its group at a map place, sized to its image.
 * @param {any[]} groups @param {any} item @param {{ mapX: number, mapY: number }} place
 * @returns {{ groups: any[], key: string } | { error: string }}
 */
export function restorePicture(groups, item, place) {
  const group = groups.find((g) => g.id === item.groupId);
  if (!group) return { error: `the group “${item.groupName}” is no longer in the project` };
  const size = pngSize(item.png);
  if (!size) return { error: 'its image could not be read' };
  const settings = { ...item.settings, mapX: place.mapX, mapY: place.mapY, width: size.width, height: size.height, png: item.png };
  if (item.pictureId === null) {
    if (group.overpaint) return { error: `“${group.name || group.id}” already has a picture for all its poses` };
    return { groups: groups.map((g) => (g === group ? withOverpaint(g, settings) : g)), key: group.id };
  }
  const taken = (group.poseOverpaints || []).some((p) => p.id === item.pictureId);
  const pictureId = taken ? newPosePictureId(group) : item.pictureId;
  const next = withPosePicture(group, pictureId, settings);
  return { groups: groups.map((g) => (g === group ? next : g)), key: posePictureKey(group.id, pictureId) };
}

/**
 * Where a picture fits best on a map region: each candidate top-left in `box` scored by the share
 * of its painted pixels that land on drawn tile pixels (paint over tiles, as overpaint usually is).
 * `plane.data` per map pixel: 2 drawn, 1 blank, 0 unknown (no captured frame shows it).
 * @param {{ width: number, height: number, data: Uint8ClampedArray | Uint8Array }} pic
 * @param {{ x0: number, y0: number, w: number, h: number, data: Uint8Array }} plane
 * @param {{ x0: number, y0: number, x1: number, y1: number }} box candidate top-left corners (inclusive)
 * @returns {{ mapX: number, mapY: number, score: number, runnerUp: number } | null} runnerUp: the best
 *   score more than 2 px away from the best place
 */
export function bestPlacement(pic, plane, box) {
  const lit = [];
  for (let y = 0; y < pic.height; y++) for (let x = 0; x < pic.width; x++) if (pic.data[(y * pic.width + x) * 4 + 3]) lit.push(x, y);
  if (!lit.length) return null;
  const n = lit.length / 2;
  const scores = [];
  for (let my = box.y0; my <= box.y1; my++) {
    for (let mx = box.x0; mx <= box.x1; mx++) {
      let on = 0;
      for (let i = 0; i < lit.length; i += 2) {
        const px = mx + lit[i] - plane.x0;
        const py = my + lit[i + 1] - plane.y0;
        if (px >= 0 && py >= 0 && px < plane.w && py < plane.h && plane.data[py * plane.w + px] === 2) on++;
      }
      scores.push({ mapX: mx, mapY: my, score: on / n });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const far = scores.find((s) => Math.abs(s.mapX - best.mapX) > 2 || Math.abs(s.mapY - best.mapY) > 2);
  return { ...best, runnerUp: far ? far.score : 0 };
}

/** A placement worth applying without asking: nearly all paint on tiles, and no rival elsewhere. */
export function confidentPlacement(result) {
  return !!result && result.score >= 0.97 && result.runnerUp <= result.score - 0.02;
}
