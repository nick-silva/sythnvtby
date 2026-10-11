/**
 * VIP state dump: serialize/deserialize for saving and for tile extractor input.
 */

/**
 * Serialize VIP state to a JSON-friendly object (base64 for binary).
 *
 * @param {import('./vip-state.js').VIPState} state
 * @returns {Object}
 */
export function serializeVIPState(state) {
  const b64 = (u8) => {
    let b = '';
    for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
    return typeof btoa !== 'undefined' ? btoa(b) : Buffer.from(u8).toString('base64');
  };
  const drawList = state.drawList || [];
  const out = {
    version: 1,
    eye: state.eye ?? 0,
    frameNumber: state.frameNumber ?? 0,
    patternTableBase64: state.patternTable ? b64(state.patternTable) : '',
    oamBase64: state.oam ? b64(state.oam) : '',
    segmentCount: state.segments?.length ?? 0,
    segmentsBase64: (state.segments || []).map(b64),
    windowsBase64: state.windows ? b64(state.windows) : '',
    drawList: drawList.map((d) => ({
      tileIndex: d.tileIndex,
      x: d.x,
      y: d.y,
      ...(d.flipH != null && { flipH: !!d.flipH }),
      ...(d.flipV != null && { flipV: !!d.flipV }),
      eye: (d.eye !== undefined && d.eye !== null) ? Number(d.eye) : 0,
      ...(d.layer !== undefined && d.layer !== null && { layer: Number(d.layer) }),
      ...(d.paletteSelector !== undefined && d.paletteSelector !== null && { paletteSelector: Number(d.paletteSelector) & 3 }),
      ...(d.strip !== undefined && d.strip !== null && { strip: Number(d.strip) & 0x1F }),
      ...(d.world !== undefined && d.world !== null && { world: Number(d.world) & 0x1F }),
    })),
  };
  if (state.gplt && Array.isArray(state.gplt) && state.gplt.length >= 4) out.gplt = state.gplt.slice(0, 4);
  if (state.masterColors && Array.isArray(state.masterColors) && state.masterColors.length >= 4) out.masterColors = state.masterColors.slice(0, 4).map((c) => (Array.isArray(c) && c.length >= 3) ? [Number(c[0]), Number(c[1]), Number(c[2])] : [0, 0, 0]);
  if (state.masterBrightness != null && typeof state.masterBrightness === 'number') out.masterBrightness = Math.max(0, Math.min(1, Number(state.masterBrightness)));
  // Which core patch made this frame: level 3+ draw lists already include tiles cut by an edge.
  if (typeof state.corePatchLevel === 'number') out.corePatchLevel = state.corePatchLevel;
  return out;
}

/**
 * Validate a vbstate JSON object (raw or already deserialized). Use when loading vbstate in tools to fail fast.
 *
 * @param {Object} obj - Raw vbstate (base64 fields) or deserialized (patternTable, drawList, etc.)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateVIPState(obj) {
  const errors = [];
  const warnings = [];

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Not an object'], warnings: [] };
  }

  // Pattern table: required for extraction and viewer
  const hasPatternTable =
    (obj.patternTable && obj.patternTable.byteLength > 0) ||
    (typeof obj.patternTableBase64 === 'string' && obj.patternTableBase64.length > 0);
  if (!hasPatternTable) {
    errors.push('Missing or empty pattern table (patternTableBase64 or patternTable)');
  } else if (obj.patternTable && obj.patternTable.byteLength !== 32768) {
    warnings.push(`Pattern table length ${obj.patternTable.byteLength}, expected 32768`);
  }

  // Draw list: required for viewer/paint-on-game; optional for extraction only
  const hasDrawList = Array.isArray(obj.drawList);
  if (!hasDrawList) {
    warnings.push('Missing or invalid drawList (array required for frame viewer and paint-on-game)');
  } else if (obj.drawList.length === 0) {
    warnings.push('drawList is empty; viewer will show blank frame');
  }

  if (obj.segmentCount !== undefined && obj.segmentCount !== 16) {
    warnings.push(`segmentCount is ${obj.segmentCount}, expected 16 for full VIP state`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Deserialize from JSON object (e.g. from manifest.json).
 *
 * @param {Object} obj
 * @returns {{ patternTable: Uint8Array, oam: Uint8Array, segments: Uint8Array[], windows: Uint8Array, eye: number, frameNumber: number, drawList: import('./vip-state.js').DrawCall[] }}
 */
export function deserializeVIPState(obj) {
  const fromB64 = (s) => {
    if (!s) return new Uint8Array(0);
    const bin = typeof atob !== 'undefined' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  const segments = [];
  for (let i = 0; i < (obj.segmentCount || 0); i++) {
    segments.push(fromB64(obj.segmentsBase64?.[i]));
  }
  const rawList = obj.drawList || [];
  const hasAnyEye = rawList.some((d) => d.eye !== undefined && d.eye !== null);
  const drawList = rawList.map((d, i) => {
    let eye = (d.eye !== undefined && d.eye !== null) ? Number(d.eye) : null;
    if (eye === null && !hasAnyEye) {
      // Legacy vbstate with no per-draw eye: assume interleaved L/R (core often pushes left then right per tile).
      eye = i % 2;
    }
    return {
      tileIndex: Number(d.tileIndex),
      x: Number(d.x),
      y: Number(d.y),
      flipH: !!d.flipH,
      flipV: !!d.flipV,
      eye: eye ?? 0,
      layer: d.layer !== undefined && d.layer !== null ? Number(d.layer) : undefined,
      paletteSelector: d.paletteSelector !== undefined && d.paletteSelector !== null ? (Number(d.paletteSelector) & 3) : undefined,
      strip: d.strip !== undefined && d.strip !== null ? (Number(d.strip) & 0x1F) : undefined,
      world: d.world !== undefined && d.world !== null ? (Number(d.world) & 0x1F) : undefined,
    };
  });

  const result = {
    patternTable: fromB64(obj.patternTableBase64),
    oam: fromB64(obj.oamBase64),
    segments,
    windows: fromB64(obj.windowsBase64),
    eye: obj.eye ?? 0,
    frameNumber: obj.frameNumber ?? 0,
    drawList,
  };
  if (obj.gplt && Array.isArray(obj.gplt) && obj.gplt.length >= 4) result.gplt = obj.gplt.slice(0, 4).map(Number);
  if (obj.masterColors && Array.isArray(obj.masterColors) && obj.masterColors.length >= 4) result.masterColors = obj.masterColors.slice(0, 4).map((c) => (Array.isArray(c) && c.length >= 3) ? [Number(c[0]), Number(c[1]), Number(c[2])] : [0, 0, 0]);
  if (obj.masterBrightness != null && typeof obj.masterBrightness === 'number') result.masterBrightness = Math.max(0, Math.min(1, Number(obj.masterBrightness)));
  if (typeof obj.corePatchLevel === 'number') result.corePatchLevel = obj.corePatchLevel;
  return result;
}
