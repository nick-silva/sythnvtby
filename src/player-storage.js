/**
 * The sythnvtby player remembers the last ROM and play pack (IndexedDB), so Continue starts the
 * game again without picking files. Its own database: the authoring tools' last ROM and pack
 * (src/rom-storage.js, src/vbpack-storage.js) are left alone.
 */

const DB_NAME = 'vb-color-player';
const DB_VERSION = 1;
const STORE = 'files';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @param {'rom' | 'pack'} key
 * @param {string} name
 * @param {ArrayBuffer} buffer
 * @returns {Promise<void>}
 */
export async function savePlayerFile(key, name, buffer) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ name, blob: new Blob([buffer]), savedAt: new Date().toISOString() }, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Saving was aborted')); };
  });
}

/**
 * @param {'rom' | 'pack'} key
 * @returns {Promise<{ name: string, buffer: ArrayBuffer } | null>}
 */
export async function loadPlayerFile(key) {
  const db = await openDb();
  const rec = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
  if (!rec?.blob) return null;
  return { name: rec.name, buffer: await rec.blob.arrayBuffer() };
}
