/**
 * VIP (Virtual Image Processor) state — structure and provider.
 * The emulator core (when built with VIP state export) should call
 * setVIPStateProvider() or push state each frame so the color layer can re-render.
 *
 * VB: 384×224 per eye, 8×8 tiles @ 2bpp = 16 bytes/tile. Pattern table holds up to 2048 tiles.
 * OAM: 8 bytes per sprite, up to 1024 sprites. Background segments: 8KB each, 2-byte tile refs.
 */

/** 16 bytes per tile (8×8, 2bpp) */
const BYTES_PER_TILE = 16;

/** Pattern table: up to 2048 tiles = 32KB */
const PATTERN_TABLE_SIZE = 2048 * BYTES_PER_TILE;

/** OAM entry: 8 bytes */
const OAM_ENTRY_SIZE = 8;

/** Max sprites */
const OAM_SIZE = 1024 * OAM_ENTRY_SIZE;

/** Segment: 64×64 tile refs × 2 bytes = 8KB */
const SEGMENT_SIZE = 8 * 1024;

/** 32 windows, 32 bytes each */
const WINDOW_SIZE = 32;

/**
 * @typedef {Uint8Array} PatternTable
 * Length PATTERN_TABLE_SIZE. Each tile is 16 consecutive bytes.
 */

/**
 * @typedef {Uint8Array} OAMData
 * Length OAM_SIZE. Each sprite is 8 bytes (tile index, x, y, parallax, etc.).
 */

/**
 * @typedef {Object} DrawCall
 * @property {number} tileIndex - Index into pattern table
 * @property {number} x - Screen X (pixels)
 * @property {number} y - Screen Y (pixels)
 * @property {boolean} [flipH]
 * @property {boolean} [flipV]
 * @property {number} [eye] - 0 = left, 1 = right (stereo); omit or 0 for legacy = left
 * @property {number} [layer] - 0 = BG (tiles), 1 = Affine, 2 = OBJ (sprites); omit for legacy vbstate
 * @property {number} [strip] - 0..27, strip (8-row band) this draw was emitted in; for strip-clip debug
 * @property {number} [world] - 0..31, VIP world (window) index; draw order is world 31 (back) to 0 (front). Omit if core does not send it. The color compositor may sort draws by this id (see `compositeColorFrame` `sortDrawsByWorld`).
 */

/**
 * @typedef {Object} VIPState
 * @property {Uint8Array} patternTable - Pattern table (tile bitmaps), 32KB
 * @property {Uint8Array} oam - Object Attribute Memory, 8KB
 * @property {Uint8Array[]} segments - Background segments (each 8KB), indices used by windows
 * @property {Uint8Array} windows - 32 windows × 32 bytes
 * @property {number} eye - 0 = left, 1 = right (for stereo)
 * @property {number} frameNumber - Increments each frame
 * @property {DrawCall[]} [drawList] - Optional: ordered list of tile draws (from patched core)
 * @property {number} [masterBrightness] - Optional 0..1; when set, color layer multiplies output to match core fade/brightness
 */

/**
 * @type {((state: VIPState) => void)|null}
 */
let stateConsumer = null;

/**
 * Register a consumer to receive VIP state each frame.
 * The core (when modified) should call pushVIPState() every frame after rendering.
 *
 * @param {(state: VIPState) => void} fn
 */
export function setVIPStateConsumer(fn) {
  stateConsumer = fn;
}

/**
 * Push VIP state from the emulator core. No-op if no consumer or if core doesn't support it.
 * Call this from the core after each frame (for each eye when stereo).
 *
 * @param {VIPState} state
 */
export function pushVIPState(state) {
  if (stateConsumer && state) stateConsumer(state);
}

/**
 * Check if the current runtime has a way to provide VIP state (e.g. patched core).
 * With EmulatorJS + CDN core, this is false.
 *
 * @returns {boolean}
 */
export function hasVIPStateExport() {
  return typeof window !== 'undefined' && window.__VB_VIP_STATE_AVAILABLE__ === true;
}

/**
 * Stub: provide a single tile's 16-byte data from pattern table.
 *
 * @param {Uint8Array} patternTable
 * @param {number} tileIndex - 0..2047
 * @returns {Uint8Array} 16 bytes (copy)
 */
export function getTileBytes(patternTable, tileIndex) {
  const start = tileIndex * BYTES_PER_TILE;
  if (start + BYTES_PER_TILE > patternTable.length) return new Uint8Array(BYTES_PER_TILE);
  return patternTable.slice(start, start + BYTES_PER_TILE);
}

/**
 * Compute a 32-bit hash of tile data for pack lookup.
 *
 * @param {Uint8Array} tileBytes - 16 bytes
 * @returns {number}
 */
export function hashTile(tileBytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < tileBytes.length; i++) {
    h ^= tileBytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * True when every pixel of the tile is palette index 0, which the VIP draws as nothing.
 * Most BG cells in a frame are this (a world draws its whole window; empty cells point at
 * character 0), so tools skip them and the compositor can ignore their draws entirely.
 *
 * @param {Uint8Array} tileBytes - 16 bytes
 * @returns {boolean}
 */
export function isBlankTile(tileBytes) {
  if (!tileBytes) return true;
  for (let i = 0; i < tileBytes.length; i++) {
    if (tileBytes[i] !== 0) return false;
  }
  return true;
}

/**
 * Screen pixel → tile-local 8×8 coords, undoing the draw's flips the same way
 * `compositeColorFrame` applies them.
 *
 * @param {{ x: number, y: number, flipH?: boolean, flipV?: boolean }} draw
 * @param {number} vx
 * @param {number} vy
 * @returns {{ lx: number, ly: number } | null} null when the pixel is outside the tile
 */
export function tileLocalFromVip(draw, vx, vy) {
  const px = (vx - draw.x) | 0;
  const py = (vy - draw.y) | 0;
  if (px < 0 || px > 7 || py < 0 || py > 7) return null;
  return { lx: draw.flipH ? 7 - px : px, ly: draw.flipV ? 7 - py : py };
}

export {
  BYTES_PER_TILE,
  PATTERN_TABLE_SIZE,
  OAM_ENTRY_SIZE,
  OAM_SIZE,
  SEGMENT_SIZE,
  WINDOW_SIZE,
};
