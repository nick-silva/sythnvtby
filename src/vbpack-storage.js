/**
 * Persist last-loaded vbpack in IndexedDB so "Last pack" can reload it without picking the file again.
 */

const DB_NAME = 'colorized-vb';
const DB_VERSION = 2;
const STORE_VBPACK = 'vbpack';
const KEY_LAST = 'last';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_VBPACK)) {
        db.createObjectStore(STORE_VBPACK);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @param {ArrayBuffer} buffer - Full vbpack (ZIP) bytes.
 * @param {string} displayName - Name to show in "Last pack: displayName" (e.g. gameId or romFileName).
 * @returns {Promise<void>}
 */
export function saveLastVbpack(buffer, displayName) {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VBPACK, 'readwrite');
      const store = tx.objectStore(STORE_VBPACK);
      // A Blob, not the ArrayBuffer: Chrome aborts a transaction holding a value over ~128 MB,
      // and real projects pass that (189 MB measured). Blobs are stored outside that limit.
      store.put({ name: displayName || 'pack', blob: new Blob([buffer]) }, KEY_LAST);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      // An oversized value aborts the transaction without an error event; without this the
      // promise never settled and callers awaiting it never loaded the pack.
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Saving the last pack was aborted')); };
    });
  });
}

/**
 * @returns {Promise<{ name: string, buffer: ArrayBuffer } | null>}
 */
export function loadLastVbpack() {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VBPACK, 'readonly');
      const store = tx.objectStore(STORE_VBPACK);
      const req = store.get(KEY_LAST);
      req.onsuccess = () => {
        db.close();
        const rec = req.result;
        if (!rec) return resolve(null);
        // Older records hold the ArrayBuffer directly; newer ones a Blob.
        if (rec.blob instanceof Blob) {
          rec.blob.arrayBuffer().then((buffer) => resolve({ name: rec.name, buffer }), reject);
        } else resolve(rec.buffer ? { name: rec.name, buffer: rec.buffer } : null);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  });
}
