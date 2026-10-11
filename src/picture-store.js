/**
 * One owner for a SpriteStudio picture's state. A picture (a group's overpaint, or one of its pose
 * pictures, src/pose-overpaint.js) lives in three places: its settings on the group, its live
 * pixels in the layer-art store (src/layer-art.js) under its key, and whether it changed since it
 * was last encoded. They drifted apart twice — Save widening a picture before the pack was
 * written, a row click reselecting an old copy of the group — each time moving the paint. Every
 * write goes through here, and a write whose pixels are not the size its settings say is refused.
 *
 * Keys: a group's own picture is the group's id; a pose picture is `posePictureKey(group, picture)`.
 */
import { withOverpaint } from './overpaint.js';
import { withPosePicture } from './pose-overpaint.js';
import { setLayerArtPixels, clearLayerArtPixels, artPixelsFor } from './layer-art.js';

const POSE_MARK = '#pose:';

/**
 * @param {string} key
 * @returns {{ groupId: string, pictureId: string | null }}
 */
export function pictureKeyParts(key) {
  const at = key.lastIndexOf(POSE_MARK);
  return at < 0 ? { groupId: key, pictureId: null } : { groupId: key.slice(0, at), pictureId: key.slice(at + POSE_MARK.length) };
}

/**
 * A picture's stored settings in a list of groups: the group's `overpaint`, or its pose entry.
 * A copy; null when there is none.
 * @param {any[]} groups @param {string} key
 */
export function pictureSettingsIn(groups, key) {
  const { groupId, pictureId } = pictureKeyParts(key);
  const group = groups.find((g) => g.id === groupId);
  if (!group) return null;
  if (!pictureId) return group.overpaint ? { ...group.overpaint } : null;
  const entry = (group.poseOverpaints || []).find((p) => p.id === pictureId);
  return entry ? { ...entry, hashes: [...(entry.hashes || [])] } : null;
}

/**
 * The groups with one picture's settings replaced (null removes the picture). A pose picture keeps
 * its name, patterns and pose unless `settings` names them. The same array when no group owns it.
 * @param {any[]} groups @param {string} key @param {any} settings
 */
export function withPictureSettings(groups, key, settings) {
  const { groupId, pictureId } = pictureKeyParts(key);
  const group = groups.find((g) => g.id === groupId);
  if (!group) return groups;
  const next = pictureId ? withPosePicture(group, pictureId, settings) : withOverpaint(group, settings);
  return groups.map((g) => (g === group ? next : g));
}

/** @param {any} settings @param {{ width: number, height: number } | null} pixels */
function sizesAgree(settings, pixels) {
  return !settings || !pixels || (pixels.width === settings.width && pixels.height === settings.height);
}

/** @param {string} key @param {any} settings @param {any} pixels */
function sizeError(key, settings, pixels) {
  return new Error(`picture ${key}: pixels are ${pixels.width}×${pixels.height}, its settings say ${settings.width}×${settings.height}`);
}

/**
 * @param {{ getGroups: () => any[], setGroups: (groups: any[]) => void }} session how the store
 *   reads and replaces the open project's groups
 */
export function createPictureStore({ getGroups, setGroups }) {
  /** Pictures changed since last encoded to PNG. */
  const edited = new Set();

  return {
    /** @param {string} key */
    settings: (key) => pictureSettingsIn(getGroups(), key),

    /** @param {string} key the picture's live pixels, or null */
    pixels: (key) => artPixelsFor(key, ''),

    /**
     * Settings and pixels together. Null settings remove the picture (pixels and edited mark too);
     * null pixels leave it drawn from its stored PNG (an undo before the picture had loaded).
     * `edited: false` is for Save, which stores what it encoded and leaves the picture unmarked.
     * False when no group owns the key (nothing changes).
     * @param {string} key @param {any} settings @param {any} pixels
     * @param {{ edited?: boolean }} [opts]
     */
    put(key, settings, pixels, { edited: mark = true } = {}) {
      if (!sizesAgree(settings, pixels)) throw sizeError(key, settings, pixels);
      const groups = getGroups();
      if (!groups.some((g) => g.id === pictureKeyParts(key).groupId)) return false;
      setGroups(withPictureSettings(groups, key, settings));
      if (!settings || !pixels) {
        clearLayerArtPixels(key);
        edited.delete(key);
        return true;
      }
      setLayerArtPixels(key, pixels);
      if (mark) edited.add(key);
      return true;
    },

    /**
     * New pixels for a picture whose settings stay as they are; refused when the sizes differ.
     * @param {string} key @param {any} pixels
     */
    replacePixels(key, pixels) {
      const settings = pictureSettingsIn(getGroups(), key);
      if (!sizesAgree(settings, pixels)) throw sizeError(key, settings, pixels);
      setLayerArtPixels(key, pixels);
      edited.add(key);
    },

    /** The picture's pixels changed in place (a stroke, Clear). @param {string} key */
    markEdited(key) {
      edited.add(key);
    },

    /**
     * Pixels decoded from a stored PNG, or made by converting an older picture, taken as they are:
     * Save sets a picture aside when they disagree with its settings (src/recovery.js).
     * @param {string} key @param {any} pixels @param {{ edited?: boolean }} [opts]
     */
    adopt(key, pixels, { edited: mark = false } = {}) {
      setLayerArtPixels(key, pixels);
      if (mark) edited.add(key);
    },

    /** Pixels and edited mark gone; the settings stay. @param {string} key */
    forget(key) {
      clearLayerArtPixels(key);
      edited.delete(key);
    },

    /** A project just opened: nothing is edited. */
    reset() {
      edited.clear();
    },

    /** @param {string} key */
    isEdited: (key) => edited.has(key),

    /** @returns {string[]} */
    editedKeys: () => [...edited],

    /** The edited pictures, no longer marked: Save is encoding them. @returns {string[]} */
    takeEdited() {
      const keys = [...edited];
      edited.clear();
      return keys;
    },
  };
}
