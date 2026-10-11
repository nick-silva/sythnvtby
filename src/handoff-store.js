/**
 * Simple IndexedDB handoff store for passing large blobs/buffers between pages.
 * (sessionStorage is same-tab only and has size limits; query params are too small)
 */

const DB_NAME = 'vb-handoff';
const DB_VERSION = 1;
const STORE = 'handoff';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Binary data goes in as a Blob. Chrome refuses an IndexedDB value over ~128 MB ("The serialized
 * keys and/or value are too large"), and a project with a hundred frames packs to more than that;
 * a Blob is stored outside that limit. Everything else is stored as it is.
 * @param {unknown} value
 */
export function toStorable(value) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return new Blob([value]);
  return value;
}

/**
 * What callers get back: a stored Blob comes out as the ArrayBuffer they put in.
 * @param {unknown} value
 */
export async function fromStored(value) {
  if (value instanceof Blob) return value.arrayBuffer();
  return value ?? null;
}

export async function putHandoff(key, value) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(toStorable(value), key);
  await txDone(tx);
  db.close();
}

export async function getHandoff(key) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).get(key);
  const value = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
  });
  await txDone(tx);
  db.close();
  return fromStored(value);
}

export async function deleteHandoff(key) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(key);
  await txDone(tx);
  db.close();
}

