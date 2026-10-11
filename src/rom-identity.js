/**
 * Which ROM a pack belongs to: SHA-1 and CRC32 of the ROM file, so a player can check the ROM it
 * is given matches the play pack (src/play-pack.js) without the pack carrying the ROM.
 */

let crcTable = null;

/** @param {Uint8Array} bytes @returns {string} 8 lowercase hex digits */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/** @param {Uint8Array} bytes @returns {Promise<string>} 40 lowercase hex digits */
export async function sha1(bytes) {
  // Browsers give `crypto.subtle` only to secure pages (https, or localhost): opened at a plain
  // http:// name on the LAN, Colorize! failed here. The JavaScript version gives the same digest.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha1Js(bytes);
  const digest = await subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-1 in JavaScript (FIPS 180-4), for pages without `crypto.subtle`. A ROM (1–2 MB) takes a few
 * milliseconds.
 * @param {Uint8Array} bytes @returns {string} 40 lowercase hex digits
 */
export function sha1Js(bytes) {
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * @param {ArrayBuffer | Uint8Array} rom
 * @returns {Promise<{ size: number, sha1: string, crc32: string }>}
 */
export async function romIdentity(rom) {
  const bytes = rom instanceof Uint8Array ? rom : new Uint8Array(rom);
  return { size: bytes.length, sha1: await sha1(bytes), crc32: crc32(bytes) };
}

/**
 * Whether a ROM is the one recorded (SHA-1 when both have it, else CRC32 and size).
 * @param {{ sha1?: string, crc32?: string, size?: number } | null | undefined} recorded
 * @param {{ sha1: string, crc32: string, size: number }} actual
 */
export function sameRom(recorded, actual) {
  if (!recorded) return false;
  if (recorded.sha1) return recorded.sha1.toLowerCase() === actual.sha1;
  if (recorded.crc32) return recorded.crc32.toLowerCase() === actual.crc32 && (recorded.size == null || recorded.size === actual.size);
  return false;
}
