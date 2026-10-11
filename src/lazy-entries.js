/**
 * Pack folder items that stay compressed until read (Phase 2 of docs/planning/tool-performance.md).
 *
 * A `.vbpack` holds every captured frame (~630 KB of JSON each), its save state, RAM dump and
 * screenshot; the tools used to inflate all of it when a pack opened and keep it, 300+ MB for a
 * 264-frame project. Here an item keeps only its place in the zip (a view into the bytes already in
 * memory, ~16 MB for those frames) and inflates on access — synchronously, so every reader that
 * does `item.json` or `item.buffer` keeps working — into a small shared cache of recent reads.
 *
 * Items look like the eager ones (`{ name, json }`, `{ name, buffer }`) with getters, plus `size`
 * (the inflated byte count, known without inflating). `buffer` is a fresh copy each time, so a
 * reader may keep, change or transfer it; `json` strings are shared.
 */

/** Inflated bytes kept for recent reads, newest last. */
const cache = new Map();
let cachedBytes = 0;
/** A few dozen frames' worth: a frame switch or a scan rereads its neighbours without inflating. */
export const LAZY_CACHE_BYTES = 48 * 1024 * 1024;

/** @param {{ bytesSync: () => Uint8Array }} entry */
function inflated(entry) {
  const hit = cache.get(entry);
  if (hit) {
    cache.delete(entry);
    cache.set(entry, hit);
    return hit;
  }
  const bytes = entry.bytesSync();
  const value = { bytes, text: null };
  cache.set(entry, value);
  cachedBytes += bytes.length;
  for (const [k, v] of cache) {
    if (cachedBytes <= LAZY_CACHE_BYTES || k === entry) break;
    cache.delete(k);
    cachedBytes -= v.bytes.length;
  }
  return value;
}

const utf8 = new TextDecoder('utf-8');

/**
 * @param {string} name
 * @param {{ bytesSync: () => Uint8Array, size: number }} entry from src/zip-read.js
 * @returns {{ name: string, json: string, size: number }}
 */
export function lazyJsonItem(name, entry) {
  return withZipEntry(
    {
      name,
      size: entry.size,
      get json() {
        const v = inflated(entry);
        if (v.text == null) v.text = utf8.decode(v.bytes);
        return v.text;
      },
    },
    entry,
  );
}

/**
 * The zip entry an unchanged item was read from, so saving can copy it without recompressing
 * (src/zip-write.js). Not enumerable: a copy of an item (`{ ...item }`) is its content only.
 * @template T @param {T} item @param {any} entry @returns {T}
 */
export function withZipEntry(item, entry) {
  if (entry && typeof entry.stored === 'function') Object.defineProperty(item, 'zipEntry', { value: entry, enumerable: false });
  return item;
}

/**
 * @param {string} name
 * @param {{ bytesSync: () => Uint8Array, size: number }} entry from src/zip-read.js
 * @returns {{ name: string, buffer: ArrayBuffer, size: number }}
 */
export function lazyBufferItem(name, entry) {
  return withZipEntry(
    {
      name,
      size: entry.size,
      get buffer() {
        return inflated(entry).bytes.slice().buffer;
      },
    },
    entry,
  );
}

/** Whether an item reads lazily (its content is a getter). */
export function isLazyItem(item) {
  if (!item || typeof item !== 'object') return false;
  const d = Object.getOwnPropertyDescriptor(item, 'json') || Object.getOwnPropertyDescriptor(item, 'buffer');
  return !!d?.get;
}

/**
 * A Map of pack folder items that answers `get` with `read(item)` — the item's bytes, say — so a
 * lookup table over a whole folder (save states by frame) reads only the entries asked for.
 * `set` stores items; iteration gives the items.
 * @template V
 */
export class ReadOnGetMap extends Map {
  /** @param {(item: any) => V} read */
  constructor(read) {
    super();
    this._read = read;
  }

  /** @returns {V | undefined} */
  get(key) {
    const item = super.get(key);
    return item === undefined ? undefined : this._read(item);
  }
}

/**
 * A Map that keeps only its `limit` most recently used entries — for caches of decoded frames,
 * which are large and only worth keeping for the frames being worked on.
 */
export class RecentMap extends Map {
  /** @param {number} limit */
  constructor(limit) {
    super();
    this.limit = limit;
  }

  get(key) {
    if (!super.has(key)) return undefined;
    const value = super.get(key);
    super.delete(key);
    super.set(key, value);
    return value;
  }

  set(key, value) {
    super.delete(key);
    super.set(key, value);
    while (this.size > this.limit) super.delete(this.keys().next().value);
    return this;
  }
}

/** For tests: how much the cache holds. */
export function lazyCacheStats() {
  return { entries: cache.size, bytes: cachedBytes };
}
