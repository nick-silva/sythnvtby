/**
 * The Project tool's state, carried through SpriteStudio and back.
 *
 * The Project tool hands its pack to SpriteStudio through IndexedDB. This is what rides along
 * so the return trip lands where you left: the same frame, eye, layer, group, isolate filter
 * and zoom, the same file for Save to write to, and whether anything is unsaved. It comes back
 * out of browser storage, so it is read defensively — a field of the wrong type is dropped.
 */
import { vipMatchKey } from '../painter/frame-registry.js';

export const RETURN_STATE_VERSION = 1;

/** IndexedDB keys: Project tool → SpriteStudio, and SpriteStudio → Project tool. */
export const HANDOFF_KEY_PROJECT_STATE = 'sprite-studio-pack-return';
export const HANDOFF_KEY_RETURN_PACK = 'project-tool-return-pack';
export const HANDOFF_KEY_RETURN_STATE = 'project-tool-return-state';

const FRAME_W = 384;
const FRAME_H = 224;

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** A zoom rectangle that fits in the frame, or null. */
function zoomRect(z) {
  if (!z || typeof z !== 'object') return null;
  const { x, y, w, h } = z;
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > FRAME_W || y + h > FRAME_H) return null;
  return { x, y, w, h };
}

/** A file handle Save can write through (a FileSystemFileHandle survives IndexedDB). */
const writableHandle = (v) => (v && typeof v === 'object' && typeof v.createWritable === 'function' ? v : null);

/**
 * @param {{
 *   packName?: string, displayName?: string, fileHandle?: any, frameVipFile?: string|null,
 *   eye?: string, layer?: string, selectedGroupId?: string|null, viewGroupFilterId?: string|null,
 *   zoomViewport?: { x: number, y: number, w: number, h: number }|null, unsaved?: boolean,
 * }} s
 */
export function buildReturnState(s) {
  return {
    v: RETURN_STATE_VERSION,
    packName: str(s.packName),
    displayName: str(s.displayName),
    fileHandle: writableHandle(s.fileHandle),
    frameVipFile: str(s.frameVipFile),
    eye: str(s.eye),
    layer: str(s.layer),
    selectedGroupId: str(s.selectedGroupId),
    viewGroupFilterId: str(s.viewGroupFilterId),
    zoomViewport: zoomRect(s.zoomViewport),
    unsaved: s.unsaved === true,
  };
}

/**
 * @param {unknown} raw what came back out of IndexedDB
 * @returns {(ReturnType<typeof buildReturnState> & { spriteStudioChanged: boolean }) | null}
 */
export function readReturnState(raw) {
  if (!raw || typeof raw !== 'object' || /** @type {any} */ (raw).v !== RETURN_STATE_VERSION) return null;
  const r = /** @type {any} */ (raw);
  return { ...buildReturnState(r), spriteStudioChanged: r.spriteStudioChanged === true };
}

/**
 * Where the frame the Project tool was on sits in the reloaded frame list, matched the way
 * frame files are matched everywhere else; -1 when it is gone.
 * @param {Array<{ vipFile?: string }>} frames @param {string|null} vipFile
 */
export function frameIndexForReturn(frames, vipFile) {
  const want = vipMatchKey(vipFile || '');
  if (!want) return -1;
  return (frames || []).findIndex((f) => vipMatchKey(f?.vipFile || '') === want);
}
