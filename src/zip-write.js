/**
 * Writes `.vbpack` zips, copying entries that come unchanged from the pack that was opened as the
 * compressed bytes they already are (Phase 3 of docs/planning/tool-performance.md). Saving used to
 * recompress every frame, save state and recording each time — 5 s for a 264-frame project, though
 * a save usually changes only `groups.json`, the paint and the manifest.
 *
 * Plain zip: one local header per entry, a central directory, no data descriptors, no zip64 (under
 * 65,535 entries and 4 GB), UTF-8 names. New entries are deflated natively
 * (`CompressionStream('deflate-raw')`) where the platform has it, else with fflate.
 */
import { deflateSync } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** @param {Uint8Array} bytes */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function canDeflateNatively() {
  try {
    return typeof CompressionStream === 'function' && !!new CompressionStream('deflate-raw');
  } catch {
    return false;
  }
}

/** @param {Uint8Array} bytes */
async function deflateRaw(bytes) {
  if (canDeflateNatively()) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return deflateSync(bytes, { level: 1 });
}

const utf8 = new TextEncoder();

/** @param {unknown} data */
async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return utf8.encode(data);
  if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
  throw new TypeError('zip entry data must be bytes, a string or a Blob');
}

/**
 * @typedef {{ method: number, crc32: number, size: number, raw: Uint8Array }} StoredEntry an entry
 *   as it sits in a zip (src/zip-read.js `stored()`): copied as is
 */

export class ZipWriter {
  constructor() {
    /** @type {Array<{ name: string, data?: unknown, store?: boolean, stored?: StoredEntry }>} */
    this.entries = [];
  }

  /**
   * @param {string} name
   * @param {unknown} data bytes, a string or a Blob
   * @param {{ store?: boolean }} [opts] `store`: keep uncompressed (PNGs are compressed already)
   */
  add(name, data, opts = {}) {
    this.entries.push({ name, data, store: !!opts.store });
  }

  /** An entry copied from another zip as its compressed bytes. @param {string} name @param {StoredEntry} stored */
  addStored(name, stored) {
    this.entries.push({ name, stored });
  }

  /**
   * @param {(p: { percent: number, currentFile: string | null }) => void} [onUpdate]
   * @returns {Promise<Blob>}
   */
  async toBlob(onUpdate) {
    const parts = [];
    const central = [];
    let offset = 0;
    const { time, date } = dosDateTime(new Date());
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      onUpdate?.({ percent: (i / this.entries.length) * 100, currentFile: e.name });
      let method;
      let crc;
      let size;
      let body;
      if (e.stored) {
        ({ method, size, raw: body } = e.stored);
        crc = e.stored.crc32;
      } else {
        const bytes = await toBytes(e.data);
        crc = crc32(bytes);
        size = bytes.length;
        if (e.store || bytes.length === 0) {
          method = 0;
          body = bytes;
        } else {
          method = 8;
          body = await deflateRaw(bytes);
        }
      }
      const name = utf8.encode(e.name);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, method, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(local.buffer, name, body);
      central.push({ name, method, crc, csize: body.length, size, offset });
      offset += 30 + name.length + body.length;
    }
    const cdStart = offset;
    for (const c of central) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 20, true);
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, c.method, true);
      h.setUint16(12, time, true);
      h.setUint16(14, date, true);
      h.setUint32(16, c.crc, true);
      h.setUint32(20, c.csize, true);
      h.setUint32(24, c.size, true);
      h.setUint16(28, c.name.length, true);
      h.setUint32(42, c.offset, true);
      parts.push(h.buffer, c.name);
      offset += 46 + c.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, central.length, true);
    end.setUint16(10, central.length, true);
    end.setUint32(12, offset - cdStart, true);
    end.setUint32(16, cdStart, true);
    parts.push(end.buffer);
    onUpdate?.({ percent: 100, currentFile: null });
    return new Blob(parts, { type: 'application/zip' });
  }
}

/** @param {Date} d */
function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
