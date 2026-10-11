/**
 * Persist last-loaded ROM in IndexedDB so "Load last ROM" can reload it without picking the file again.
 */

const DB_NAME = 'colorized-vb';
const DB_VERSION = 1;
const STORE = 'rom';
const KEY_LAST = 'last';

/**
 * @param {string} name
 * @param {ArrayBuffer} data
 * @returns {Promise<void>}
 */
export function saveLastRom(name, data) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(STORE)) {
        e.target.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put({ name, data: data }, KEY_LAST);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/**
 * @returns {Promise<{ name: string, data: ArrayBuffer } | null>}
 */
export function loadLastRom() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const getReq = store.get(KEY_LAST);
      getReq.onsuccess = () => {
        db.close();
        resolve(getReq.result || null);
      };
      getReq.onerror = () => reject(getReq.error);
    };
  });
}
