/**
 * Project home directory — a user-chosen folder for .vbpack open/save.
 *
 * Uses the Chromium File System Access API (`showDirectoryPicker` + persisted
 * `FileSystemDirectoryHandle`). Other browsers keep download / `<input type=file>` fallbacks.
 * Last pack (IndexedDB) and Colorize! / Save and Play handoff are unchanged.
 */

const DB_NAME = 'colorized-vb-settings';
const DB_VERSION = 1;
const STORE = 'settings';
const KEY_HOME = 'projectHomeDirectory';
/** localStorage mirror of folder name for UI when the handle is not yet permitted. */
const LS_HOME_NAME = 'vb-project-home-name';

export const VBPACK_FILE_TYPES = [
  { description: 'VB pack', accept: { 'application/zip': ['.vbpack', '.zip'] } },
];

/**
 * @returns {boolean}
 */
export function isDirectoryPickerSupported() {
  return typeof globalThis !== 'undefined' && typeof globalThis.showDirectoryPicker === 'function';
}

/**
 * @returns {boolean}
 */
export function isOpenFilePickerSupported() {
  return typeof globalThis !== 'undefined' && typeof globalThis.showOpenFilePicker === 'function';
}

/**
 * @returns {boolean}
 */
export function isSaveFilePickerSupported() {
  return typeof globalThis !== 'undefined' && typeof globalThis.showSaveFilePicker === 'function';
}

/**
 * @returns {string} Cached display name, or empty string.
 */
export function getCachedHomeDirectoryName() {
  try {
    return (localStorage.getItem(LS_HOME_NAME) || '').trim();
  } catch {
    return '';
  }
}

/**
 * @param {string} name
 */
function setCachedHomeDirectoryName(name) {
  try {
    const n = String(name || '').trim();
    if (n) localStorage.setItem(LS_HOME_NAME, n);
    else localStorage.removeItem(LS_HOME_NAME);
  } catch {
    /* ignore */
  }
}

/**
 * Ensure a usable .vbpack file name (with extension).
 * @param {string} name
 * @returns {string}
 */
export function normalizeVbpackFileName(name) {
  let base = String(name || '').trim() || 'pack.vbpack';
  base = base.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
  if (!base) base = 'pack.vbpack';
  if (!/\.(vbpack|zip)$/i.test(base)) base = `${base}.vbpack`;
  return base;
}

/**
 * Name for the rolling backup copy written before a silent overwrite.
 * @param {string} name
 * @returns {string}
 */
export function backupFileName(name) {
  const base = normalizeVbpackFileName(name).replace(/\.(vbpack|zip)$/i, '');
  return `${base}.bak.vbpack`;
}

/**
 * Where a pack save should go, without touching the filesystem.
 *
 * @param {{ fileHandle?: unknown, home?: unknown, saveAs?: boolean }} ctx
 * @returns {'picker' | 'file' | 'home' | 'download'}
 */
export function resolveSaveTarget({ fileHandle, home, saveAs } = {}) {
  const canWriteFile = !!fileHandle && typeof (/** @type {any} */ (fileHandle).createWritable) === 'function';
  if (saveAs) return isSaveFilePickerSupported() ? 'picker' : 'download';
  if (canWriteFile) return 'file';
  if (home) return 'home';
  return 'download';
}

function openSettingsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function loadHomeDirectoryHandle() {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openSettingsDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY_HOME);
      const value = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
      });
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      if (value && typeof value === 'object' && typeof value.getFileHandle === 'function') {
        return /** @type {FileSystemDirectoryHandle} */ (value);
      }
      return null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<void>}
 */
export async function saveHomeDirectoryHandle(handle) {
  const db = await openSettingsDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY_HOME);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    setCachedHomeDirectoryName(handle?.name || 'Home');
  } finally {
    db.close();
  }
}

/**
 * @returns {Promise<void>}
 */
export async function clearHomeDirectoryHandle() {
  setCachedHomeDirectoryName('');
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openSettingsDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY_HOME);
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {FileSystemHandle} handle
 * @param {'read' | 'readwrite'} [mode]
 * @returns {Promise<'granted' | 'denied' | 'prompt' | 'unknown'>}
 */
export async function queryHandlePermission(handle, mode = 'readwrite') {
  if (!handle || typeof handle.queryPermission !== 'function') return 'unknown';
  try {
    const state = await handle.queryPermission({ mode });
    if (state === 'granted' || state === 'denied' || state === 'prompt') return state;
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * @param {FileSystemHandle} handle
 * @param {'read' | 'readwrite'} [mode]
 * @returns {Promise<boolean>}
 */
export async function ensureHandlePermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  let state = await queryHandlePermission(handle, mode);
  if (state === 'granted') return true;
  if (typeof handle.requestPermission === 'function') {
    try {
      state = await handle.requestPermission({ mode });
      return state === 'granted';
    } catch {
      return false;
    }
  }
  // Older / incomplete handles: try using the handle and let callers catch.
  return state !== 'denied';
}

/**
 * Prompt the user to choose a home folder and persist the handle.
 * @returns {Promise<{ status: 'ok', handle: FileSystemDirectoryHandle } | { status: 'aborted' } | { status: 'unsupported' } | { status: 'error', error: unknown }>}
 */
export async function pickAndStoreHomeDirectory() {
  if (!isDirectoryPickerSupported()) return { status: 'unsupported' };
  try {
    const handle = await globalThis.showDirectoryPicker({
      id: 'vb-colorize-home',
      mode: 'readwrite',
      startIn: 'documents',
    });
    await saveHomeDirectoryHandle(handle);
    setCachedHomeDirectoryName(handle.name || 'Home');
    return { status: 'ok', handle };
  } catch (e) {
    const name = e && /** @type {{ name?: string }} */ (e).name;
    if (name === 'AbortError' || name === 'NotAllowedError') return { status: 'aborted' };
    return { status: 'error', error: e };
  }
}

/**
 * Load stored home without prompting. Returns handle even if permission is still `prompt`.
 * @returns {Promise<{ handle: FileSystemDirectoryHandle | null, permitted: boolean }>}
 */
export async function peekHomeDirectory() {
  const handle = await loadHomeDirectoryHandle();
  if (!handle) return { handle: null, permitted: false };
  const state = await queryHandlePermission(handle, 'read');
  if (handle.name) setCachedHomeDirectoryName(handle.name);
  return { handle, permitted: state === 'granted' || state === 'unknown' };
}

/**
 * Load stored home and ensure permission. Returns null if unset / denied / unavailable.
 * May show a browser permission prompt.
 * @param {'read' | 'readwrite'} [mode]
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function getUsableHomeDirectory(mode = 'readwrite') {
  const handle = await loadHomeDirectoryHandle();
  if (!handle) return null;
  const ok = await ensureHandlePermission(handle, mode);
  if (!ok) return null;
  if (handle.name) setCachedHomeDirectoryName(handle.name);
  return handle;
}

/**
 * @param {FileSystemFileHandle} handle
 * @param {Blob} blob
 */
export async function writeBlobToFileHandle(handle, blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/**
 * Write an exported file (tile manifest, .vbcolor, overrides…) into the project home.
 * Returns null when there is no usable home, so callers fall back to a download.
 *
 * @param {Blob} blob
 * @param {string} fileName
 * @returns {Promise<string | null>} file name written, or null
 */
export async function saveExportToHome(blob, fileName) {
  const name = String(fileName || '').trim();
  if (!name) return null;
  try {
    const home = await getUsableHomeDirectory('readwrite');
    if (!home) return null;
    const handle = await home.getFileHandle(name, { create: true });
    await writeBlobToFileHandle(handle, blob);
    return name;
  } catch (err) {
    console.warn('[project home] Could not write export, falling back to download:', err);
    return null;
  }
}

/**
 * Copy a file's current bytes into the home directory as `<name>.bak.vbpack` before an overwrite.
 * Best effort: a file handle can't reach its own folder, so backups need the home directory.
 *
 * @param {FileSystemFileHandle} fileHandle
 * @param {FileSystemDirectoryHandle | null} homeHandle
 * @returns {Promise<string | null>} backup file name, or null when no backup was written
 */
export async function writeBackupCopy(fileHandle, homeHandle) {
  if (!fileHandle || !homeHandle) return null;
  try {
    const file = await fileHandle.getFile();
    if (!file || file.size === 0) return null;
    const name = backupFileName(fileHandle.name || file.name || 'pack.vbpack');
    const backupHandle = await homeHandle.getFileHandle(name, { create: true });
    await writeBlobToFileHandle(backupHandle, file);
    return name;
  } catch (err) {
    console.warn('[project home] Could not write backup copy:', err);
    return null;
  }
}

/**
 * Write `blob` into the home directory under `fileName` (create or overwrite).
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {Blob} blob
 * @param {string} fileName
 * @returns {Promise<FileSystemFileHandle>}
 */
export async function writeBlobToHomeDirectory(dirHandle, blob, fileName) {
  const name = normalizeVbpackFileName(fileName);
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  await writeBlobToFileHandle(fileHandle, blob);
  return fileHandle;
}

/**
 * Open-file picker, preferring the project home as `startIn` when available.
 * @returns {Promise<
 *   | { status: 'ok', buffer: ArrayBuffer, name: string, fileHandle: FileSystemFileHandle }
 *   | { status: 'aborted' }
 *   | { status: 'unsupported' }
 *   | { status: 'error', error: unknown }
 * >}
 */
export async function pickOpenVbpackFile() {
  if (!isOpenFilePickerSupported()) return { status: 'unsupported' };
  try {
    const home = await getUsableHomeDirectory('read');
    /** @type {OpenFilePickerOptions} */
    const opts = {
      multiple: false,
      types: VBPACK_FILE_TYPES,
    };
    if (home) opts.startIn = home;
    const handles = await globalThis.showOpenFilePicker(opts);
    const fileHandle = handles?.[0];
    if (!fileHandle) return { status: 'aborted' };
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return { status: 'ok', buffer, name: file.name || 'pack.vbpack', fileHandle };
  } catch (e) {
    const name = e && /** @type {{ name?: string }} */ (e).name;
    if (name === 'AbortError' || name === 'NotAllowedError') return { status: 'aborted' };
    return { status: 'error', error: e };
  }
}

/**
 * Open-file picker for any file type, preferring the project home as `startIn`.
 *
 * @param {{ types?: unknown[] }} [options]
 * @returns {Promise<
 *   | { status: 'ok', buffer: ArrayBuffer, name: string, fileHandle: FileSystemFileHandle }
 *   | { status: 'aborted' }
 *   | { status: 'unsupported' }
 *   | { status: 'error', error: unknown }
 * >}
 */
export async function pickOpenFile({ types } = {}) {
  if (!isOpenFilePickerSupported()) return { status: 'unsupported' };
  try {
    const home = await getUsableHomeDirectory('read');
    /** @type {any} */
    const opts = { multiple: false };
    if (types) opts.types = types;
    if (home) opts.startIn = home;
    const handles = await globalThis.showOpenFilePicker(opts);
    const fileHandle = handles?.[0];
    if (!fileHandle) return { status: 'aborted' };
    const file = await fileHandle.getFile();
    return { status: 'ok', buffer: await file.arrayBuffer(), name: file.name || 'file', fileHandle };
  } catch (e) {
    const name = e && /** @type {{ name?: string }} */ (e).name;
    if (name === 'AbortError' || name === 'NotAllowedError') return { status: 'aborted' };
    return { status: 'error', error: e };
  }
}

/**
 * Save-file picker, preferring the project home as `startIn` when available.
 * @param {string} suggestedName
 * @returns {Promise<
 *   | { status: 'ok', handle: FileSystemFileHandle }
 *   | { status: 'aborted' }
 *   | { status: 'unsupported' }
 *   | { status: 'error', error: unknown }
 * >}
 */
export async function pickSaveVbpackFile(suggestedName) {
  if (!isSaveFilePickerSupported()) return { status: 'unsupported' };
  try {
    const home = await getUsableHomeDirectory('readwrite');
    /** @type {SaveFilePickerOptions} */
    const opts = {
      suggestedName: normalizeVbpackFileName(suggestedName),
      types: VBPACK_FILE_TYPES,
    };
    if (home) opts.startIn = home;
    const handle = await globalThis.showSaveFilePicker(opts);
    return { status: 'ok', handle };
  } catch (e) {
    const name = e && /** @type {{ name?: string }} */ (e).name;
    if (name === 'AbortError' || name === 'NotAllowedError') return { status: 'aborted' };
    return { status: 'error', error: e };
  }
}

/**
 * @typedef {Object} HomeStatus
 * @property {'unsupported'|'unset'|'granted'|'needs-permission'} state
 * @property {string} name - Folder name when one is stored, else ''.
 */

/**
 * Real state of the project home, without prompting. Chrome drops folder permission between
 * sessions (unless installed as a PWA), so a stored handle often needs one click to re-grant.
 * @returns {Promise<HomeStatus>}
 */
export async function getHomeStatus() {
  if (!isDirectoryPickerSupported()) return { state: 'unsupported', name: '' };
  const handle = await loadHomeDirectoryHandle();
  if (!handle) return { state: 'unset', name: '' };
  const name = handle.name || getCachedHomeDirectoryName() || 'Home';
  setCachedHomeDirectoryName(name);
  const permission = await queryHandlePermission(handle, 'readwrite');
  // 'unknown' means the browser gives no queryPermission — assume usable and let writes fail loudly.
  const usable = permission === 'granted' || permission === 'unknown';
  return { state: usable ? 'granted' : 'needs-permission', name };
}

/**
 * Re-grant access to the stored home. Must be called from a user gesture (click).
 * @returns {Promise<boolean>}
 */
export async function requestHomeAccess() {
  const handle = await loadHomeDirectoryHandle();
  if (!handle) return false;
  return ensureHandlePermission(handle, 'readwrite');
}

/**
 * @param {HomeStatus | null | undefined} status
 * @returns {string}
 */
export function formatHomeStatusLabel(status) {
  if (!status || status.state === 'unset') return 'Not set';
  if (status.state === 'unsupported') return 'Unsupported in this browser';
  if (status.state === 'needs-permission') return `${status.name} — needs permission`;
  return status.name;
}

/**
 * Short label for settings UI.
 * @param {FileSystemDirectoryHandle | null | undefined} [handle]
 * @returns {string}
 */
export function formatHomeDirectoryLabel(handle) {
  const fromHandle = handle && typeof handle.name === 'string' ? handle.name.trim() : '';
  if (fromHandle) return fromHandle;
  const cached = getCachedHomeDirectoryName();
  if (cached) return cached;
  return 'Not set';
}
