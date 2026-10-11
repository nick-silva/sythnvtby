/**
 * Extract the 64 KiB CPU WRAM from a Mednafen/Beetle VB **full** save state
 * (`MDFNSVST` header + preview + sections).
 *
 * **RetroArch / EmulatorJS:** `gameManager.getState()` returns **`RASTATE1`** (see
 * `task_save.c` `content_write_serialized_state`): 8-byte `RASTATE` + version, then
 * block headers; the core blob (`MDFNSVST…`) lives inside the **`MEM `** block — not at offset 0.
 *
 * Layout (see mednafen `state.cpp` / beetle `libretro.cpp`):
 * - 32-byte header: magic "MDFNSVST", version, total_len, width, height, …
 * - preview: width * height * 3 bytes
 * - sections: repeat [32-byte padded name][u32 LE size][payload]
 * - "MAIN" payload: SubWrite format — [u8 nameLen][name][u32 LE dataSize][data] …
 * - First array is SFARRAY(WRAM, 65536) → variable name "WRAM".
 *
 * @param {Uint8Array|ArrayBuffer} stateBytes
 * @returns {Uint8Array | null} 65536 bytes or null
 */
/** @param {Uint8Array} u8 */
function tryExtractCorePayloadFromRastate1(u8) {
  if (u8.byteLength < 24) return null;
  // "RASTATE" + 1-byte version (RetroArch RASTATE_VERSION, usually 1)
  if (
    u8[0] !== 0x52 ||
    u8[1] !== 0x41 ||
    u8[2] !== 0x53 ||
    u8[3] !== 0x54 ||
    u8[4] !== 0x41 ||
    u8[5] !== 0x54 ||
    u8[6] !== 0x45
  ) {
    return null;
  }
  let input = 8;
  const stop = u8.byteLength;
  while (input + 8 <= stop) {
    const b0 = u8[input];
    const b1 = u8[input + 1];
    const b2 = u8[input + 2];
    const b3 = u8[input + 3];
    const blockSize = u8[input + 4] | (u8[input + 5] << 8) | (u8[input + 6] << 16) | (u8[input + 7] << 24);
    const bs = blockSize >>> 0;
    input += 8;
    const isMem = b0 === 0x4d && b1 === 0x45 && b2 === 0x4d && b3 === 0x20; // "MEM "
    if (isMem) {
      if (input + bs > stop) return null;
      return u8.subarray(input, input + bs);
    }
    const aligned = (bs + 7) & ~7;
    input += aligned;
  }
  return null;
}

export function tryExtractWramFromMednafenSavestate(stateBytes) {
  if (!stateBytes) return null;
  let u8 = stateBytes instanceof Uint8Array ? stateBytes : new Uint8Array(stateBytes);
  if (u8.byteLength < 64) return null;

  const corePayload = tryExtractCorePayloadFromRastate1(u8);
  if (corePayload) u8 = corePayload;

  const magic = String.fromCharCode(...u8.subarray(0, 8));
  if (magic !== 'MDFNSVST') {
    return null;
  }

  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const width = dv.getUint32(24, true) >>> 0;
  const height = dv.getUint32(28, true) >>> 0;
  const previewLen = width * height * 3;
  let off = 32 + previewLen;
  if (off > u8.byteLength) return null;
  // Scan remaining file for sections; total_len can disagree with actual zip size.
  const bound = u8.byteLength;

  while (off + 36 <= bound) {
    const nameBytes = u8.subarray(off, off + 32);
    off += 32;
    const secSize = dv.getUint32(off, true) >>> 0;
    off += 4;
    if (off + secSize > u8.byteLength) return null;

    const secName = nullTerminatedString(nameBytes);
    if (secName === 'MAIN') {
      const wram = extractWramFromMainSection(u8.subarray(off, off + secSize));
      if (wram && wram.byteLength >= 0x10000) return wram.subarray(0, 0x10000);
    }
    off += secSize;
  }

  return null;
}

function nullTerminatedString(buf) {
  const i = buf.indexOf(0);
  const len = i === -1 ? buf.length : i;
  try {
    return new TextDecoder('ascii', { fatal: false }).decode(buf.subarray(0, len)).trim();
  } catch (_) {
    let s = '';
    for (let j = 0; j < len; j++) s += String.fromCharCode(buf[j]);
    return s.trim();
  }
}

/**
 * Parse MAIN section body (SubWrite / ReadStateChunk record stream).
 * @param {Uint8Array} main
 * @returns {Uint8Array | null}
 */
function extractWramFromMainSection(main) {
  if (!main || main.byteLength < 8) return null;
  const dv = new DataView(main.buffer, main.byteOffset, main.byteLength);
  let o = 0;
  while (o < main.byteLength) {
    const slen = main[o];
    if (slen === undefined || slen === 0) break;
    if (o + 1 + slen + 4 > main.byteLength) break;
    const name = new TextDecoder('ascii', { fatal: false }).decode(main.subarray(o + 1, o + 1 + slen));
    o += 1 + slen;
    const recSize = dv.getUint32(o, true) >>> 0;
    o += 4;
    if (o + recSize > main.byteLength) break;
    if (name === 'WRAM' && recSize >= 0x10000) {
      return main.subarray(o, o + 0x10000);
    }
    o += recSize;
  }
  return null;
}
