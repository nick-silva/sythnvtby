/**
 * A small, fast zip reader for opening `.vbpack` files: reads the central directory, then inflates
 * entries with the platform's native `DecompressionStream('deflate-raw')` and decodes text with
 * `TextDecoder`. JSZip did both in JavaScript, which was most of the time opening a large project
 * took (docs/planning/tool-performance.md). Entries are inflated only when asked for, so one entry
 * can be read without the rest.
 *
 * It offers the part of JSZip's reading API that src/art-pack.js uses — `file(name)`, `files`,
 * `filter(fn)`, and entries with `name` and `async('string' | 'arraybuffer' | 'uint8array')` — and
 * reads what JSZip writes (stored or deflated, no zip64, no encryption). Anything else throws
 * {@link ZipUnsupported}, and the caller falls back to JSZip.
 */

import { inflateSync } from 'fflate';

export class ZipUnsupported extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
/** The end record is at most 22 bytes plus a 64 KiB comment from the end. */
const EOCD_SEARCH = 22 + 0xffff;

const utf8 = new TextDecoder('utf-8');

/** @returns {boolean} whether this platform can inflate natively */
export function canReadZipNatively() {
  try {
    return typeof DecompressionStream === 'function' && !!new DecompressionStream('deflate-raw');
  } catch {
    return false;
  }
}

/** @param {Uint8Array} bytes */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {{ files: Record<string, ZipEntry>, file: (name: string) => ZipEntry | null, filter: (fn: (path: string, entry: ZipEntry) => boolean) => ZipEntry[] }}
 */
export function openZip(input) {
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) throw new ZipUnsupported('not bytes');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - EOCD_SEARCH); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipUnsupported('not a zip (no end record)');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new ZipUnsupported('zip64');
  /** @type {Record<string, ZipEntry>} */
  const files = {};
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== CEN_SIG) throw new ZipUnsupported('bad central directory');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // a folder
    if (flags & 1) throw new ZipUnsupported(`encrypted entry ${name}`);
    if (method !== 0 && method !== 8) throw new ZipUnsupported(`compression ${method} in ${name}`);
    files[name] = new ZipEntry(bytes, view, name, method, local, compressedSize, size, crc);
  }
  return {
    files,
    file: (name) => files[name] || null,
    filter: (fn) => Object.values(files).filter((e) => fn(e.name, e)),
  };
}

class ZipEntry {
  constructor(bytes, view, name, method, local, compressedSize, size, crc) {
    this.name = name;
    this.dir = false;
    this._bytes = bytes;
    this._view = view;
    this._method = method;
    this._local = local;
    this._compressedSize = compressedSize;
    this._size = size;
    this._crc = crc;
  }

  /** The entry as stored — what src/zip-write.js copies into a new zip without recompressing. */
  stored() {
    return { method: this._method, crc32: this._crc, size: this._size, raw: this.raw() };
  }

  /** The entry's stored (compressed) bytes, a view into the zip. */
  raw() {
    const v = this._view;
    const at = this._local;
    if (v.getUint32(at, true) !== LOC_SIG) throw new ZipUnsupported(`bad local header for ${this.name}`);
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    return this._bytes.subarray(start, start + this._compressedSize);
  }

  /** The entry's bytes, inflated (natively, off the JS thread's critical path). */
  async bytes() {
    const raw = this.raw();
    return this._checked(this._method === 0 ? raw.slice() : await inflateRaw(raw));
  }

  /** The entry's bytes, inflated right now (fflate), for readers that cannot wait. */
  bytesSync() {
    const raw = this.raw();
    return this._checked(this._method === 0 ? raw.slice() : inflateSync(raw, { out: new Uint8Array(this._size) }));
  }

  /** @param {Uint8Array} out */
  _checked(out) {
    if (out.length !== this._size) throw new ZipUnsupported(`${this.name}: ${out.length} bytes, expected ${this._size}`);
    return out;
  }

  /** Inflated size in bytes. */
  get size() {
    return this._size;
  }

  /** @param {'string' | 'text' | 'arraybuffer' | 'uint8array'} type */
  async async(type) {
    const out = await this.bytes();
    if (type === 'string' || type === 'text') return utf8.decode(out);
    if (type === 'uint8array') return out;
    if (type === 'arraybuffer') return out.buffer.byteLength === out.length ? out.buffer : out.slice().buffer;
    throw new ZipUnsupported(`async(${type})`);
  }
}
