/**
 * The Project tool's painting: hit-testing the canvas, the zoomed brush and fill (on the pack, on
 * a group's tile colours, or on a VIP overlay), group anchors and criteria edits. Split out of tools/painter.js, which passes in the state and functions it shares
 * (initZoomPaint).
 */
import { getTileBytes, hashTile, isBlankTile } from '../../src/vip-state.js';
import { tileToRgba } from '../../src/vb-2bpp.js';
import { compositeColorFrameForEye, compareDrawCallOrderByWorld } from '../../src/color-layer.js';
import { decodeGroupTileColors, groupTileColorCount } from '../../src/group-tile-colors.js';
import { startAnchorPickForGroupAction, addSelectedHashesToGroupCriteriaAction, removeSelectedHashesFromGroupCriteriaAction } from './groups.js';
import { affinePixelMap } from '../../src/affine-world.js';
import { normalizeGroup } from '../../src/group-schema.js';
import { getActiveV2VariantId, updatePaintV2TopButton } from './pack-rules.js';
import { fullDrawIndexFromDraw, normWorldKey, updateSelectionUi } from './selection.js';
import { drawEye, filterStateForView, getEye, stateForComposite } from './view-filters.js';
import { drawMatchesGroup, findAnchorDrawForGroup, findFrontmostGroupDrawAtVip, getSelectedPaintGroupOrNull, getZoomPaintBlockedReason, resolveZoomPaintTileContext, useVipOverlayForZoomPaint } from './zoom-target.js';
import { currentFrameWram } from './screens-ui.js';
import { colourOptions } from '../../src/project.js';
import { drawSelectionOverlay } from './world-grid.js';
import { updateGroupDetail } from './group-detail.js';
import { updateGroupsPanel } from './groups-panel.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initZoomPaint(context) {
  ctx = context;
}

export function collectVisibleIndicesForHit(state) {
  if (!state?.drawList?.length) return [];
  const drawList = state.drawList;
  const idx = [];
  for (let i = 0; i < drawList.length; i++) idx.push(i);
  idx.sort((ia, ib) => compareDrawCallOrderByWorld(drawList[ia], drawList[ib], ia, ib));
  return idx;
}

/** @param {number} px @param {number} py VIP pixel coords */
/**
 * True when this draw's tile is entirely palette 0 (paints nothing). Most BG cells in a frame are
 * blank and share one pattern hash, so selecting them pollutes groups; selection skips them unless
 * "Blank tiles" is on.
 * @param {{ tileIndex: number }} d
 */
export function isBlankDraw(d) {
  if (!d || !ctx.currentState?.patternTable) return false;
  return isBlankTile(getTileBytes(ctx.currentState.patternTable, d.tileIndex));
}

/**
 * Affine (scaled or rotated) worlds on this frame and eye, as what each screen pixel reads
 * (src/affine-world.js); null when there are none. Their draw-list records are rigid 8×8
 * stand-ins, so hit tests, painting and outlines go by this map instead.
 */
export function affineMapForEye() {
  if (!ctx.currentState) return null;
  const map = affinePixelMap(ctx.currentState, getEye());
  return map.size ? map : null;
}

/** A draw-list record of an affine world the frame samples, rather than a real 8×8 tile. */
export function isAffineRecord(d, map = affineMapForEye()) {
  return !!map && !!d && Number(d.layer) === 1 && map.has(d.world) && drawEye(d) === getEye();
}

/**
 * The screen pixels of the one scaled copy an affine record belongs to: the core records a tile
 * where a pixel reads its top-left texel, so start there and take the connected pixels reading
 * the same character. `seen` lets several records of one copy (zoomed in, there are many)
 * share the work.
 * @returns {number[]} pixel indices (empty when the record's pixel does not read its tile)
 */
export function affineCopyPixels(affine, d, seen = new Set()) {
  const chars = affine.get(d.world)?.char;
  if (!chars) return [];
  const sx = d.x + (d.flipH ? 7 : 0);
  const sy = d.y + (d.flipV ? 7 : 0);
  if (sx < 0 || sy < 0 || sx >= ctx.W || sy >= ctx.H) return [];
  const start = sy * ctx.W + sx;
  if (chars[start] !== d.tileIndex || seen.has(start)) return [];
  const out = [];
  const stack = [start];
  seen.add(start);
  while (stack.length) {
    const p = stack.pop();
    out.push(p);
    const x = p % ctx.W;
    for (const q of [x > 0 ? p - 1 : -1, x < ctx.W - 1 ? p + 1 : -1, p - ctx.W, p + ctx.W]) {
      if (q < 0 || q >= ctx.W * ctx.H || seen.has(q) || chars[q] !== d.tileIndex) continue;
      seen.add(q);
      stack.push(q);
    }
  }
  return out;
}

export function hitDrawIndices(px, py) {
  if (!ctx.currentState?.drawList?.length) return [];
  const state = filterStateForView(ctx.currentState);
  const drawList = state.drawList;
  const eye = getEye();
  const sorted = collectVisibleIndicesForHit(state).filter((i) => drawEye(drawList[i]) === eye);
  const affine = affineMapForEye();
  const p = py * ctx.W + px;
  /** @type {Set<string>} affine tiles already hit: one record stands for each */
  const affineHit = new Set();
  const hits = [];
  for (let k = sorted.length - 1; k >= 0; k--) {
    const i = sorted[k];
    const d = drawList[i];
    if (!ctx.includeBlankTiles && isBlankDraw(d)) continue;
    if (isAffineRecord(d, affine)) {
      // A scaled tile covers whatever pixels read it — one record per tile, not per copy.
      const key = `${d.world}|${d.tileIndex}`;
      if (affine.get(d.world).char[p] === d.tileIndex && !affineHit.has(key)) {
        affineHit.add(key);
        hits.push(i);
      }
      continue;
    }
    if (px >= d.x && px < d.x + 8 && py >= d.y && py < d.y + 8) hits.push(i);
  }
  return hits;
}

/**
 * @param {string} hex
 * @returns {string|null} normalized #rrggbb or null
 */
export function normalizeColorInputHex(hex) {
  const t = hex.trim();
  const m6 = /^#([0-9a-f]{6})$/i.exec(t);
  if (m6) return `#${m6[1].toLowerCase()}`;
  const m3 = /^#([0-9a-f]{3})$/i.exec(t);
  if (m3) {
    const s = m3[1];
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`.toLowerCase();
  }
  return null;
}

/** @param {string} hex from EyeDropper or elsewhere */
export function applyHexToZoomPaintColorInput(hex) {
  const el = /** @type {HTMLInputElement|null} */ (document.getElementById('zoom-paint-color'));
  if (!el) return;
  const n = normalizeColorInputHex(hex);
  if (n) el.value = n;
}

/** @param {number} r @param {number} g @param {number} b */
export function applyRgbToZoomPaintColorInput(r, g, b) {
  const clamp = (x) => Math.max(0, Math.min(255, x | 0));
  applyHexToZoomPaintColorInput(
    `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`,
  );
}

/**
 * RGBA from the main preview canvas at a pointer event (what you see under the cursor).
 * @param {PointerEvent|MouseEvent} e
 * @returns {{ r: number, g: number, b: number, a: number } | null}
 */
export function readMainCanvasPixelAtPointer(e) {
  if (!ctx.canvas || !ctx.ctx) return null;
  const rect = ctx.canvas.getBoundingClientRect();
  const sx = ctx.canvas.width / Math.max(1, rect.width);
  const sy = ctx.canvas.height / Math.max(1, rect.height);
  const ix = Math.max(0, Math.min(ctx.canvas.width - 1, Math.floor((e.clientX - rect.left) * sx)));
  const iy = Math.max(0, Math.min(ctx.canvas.height - 1, Math.floor((e.clientY - rect.top) * sy)));
  try {
    const d = ctx.ctx.getImageData(ix, iy, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  } catch {
    return null;
  }
}

/** @returns {{ r: number, g: number, b: number, a: number }} */
export function readZoomPaintColor() {
  const el = /** @type {HTMLInputElement|null} */ (document.getElementById('zoom-paint-color'));
  if (!el?.value) return { r: 255, g: 68, b: 136, a: 255 };
  const m = /^#([0-9a-f]{6})$/i.exec(el.value.trim());
  if (!m) return { r: 255, g: 68, b: 136, a: 255 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
}

/**
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {(x: number, y: number) => void} fn VIP pixel integer coords
 */
function bresenhamLine(x0, y0, x1, y1, fn) {
  let x = x0 | 0;
  let y = y0 | 0;
  const x1i = x1 | 0;
  const y1i = y1 | 0;
  const dx = Math.abs(x1i - x);
  const sx = x < x1i ? 1 : -1;
  const dy = -Math.abs(y1i - y);
  const sy = y < y1i ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x, y);
    if (x === x1i && y === y1i) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Where a zoom-paint stroke writes.
 *
 * A selected BG group keeps its colours to itself, so the same pattern can be a different
 * colour in each layer that draws it — the whole point of grouping a repeating background.
 * Returns null when paint belongs in the global per-pattern pack instead: no group selected,
 * an OBJ group (sprite patterns are shared across poses on purpose, as in SpriteStudio), or
 * an anchored group whose paint goes to its position-scoped VIP overlay.
 *
 * @returns {typeof groups[0] | null}
 */
export function paintTargetGroupOrNull() {
  const g = getSelectedPaintGroupOrNull();
  if (!g || g.authoringKind !== 'bg') return null;
  if (useVipOverlayForZoomPaint(g)) return null;
  return g;
}

/**
 * The group's live colour buffers, converting the stored base64 form on first paint. The
 * returned Map is mutated in place by brush strokes; {@link groupWithEncodedTileColors}
 * turns it back into the stored form on save.
 *
 * @param {string} groupId
 * @returns {Map<number, Uint8Array>}
 */
export function ensureGroupTileColorMap(groupId) {
  const existing = ctx.groups.find((x) => x.id === groupId);
  if (existing?.tileColors instanceof Map) return existing.tileColors;
  const live = new Map(decodeGroupTileColors(existing));
  ctx.groups = ctx.groups.map((x) => (x.id === groupId ? { ...x, tileColors: live } : x));
  return live;
}

/**
 * The compositor caches its group-colour index against the groups array, so hand it a new
 * array whenever a pattern is painted for the first time. Mutating an existing buffer needs
 * no such nudge — the index already points at it.
 */
export function invalidateGroupColorIndex() {
  ctx.groups = [...ctx.groups];
}

/**
 * @param {number} hash
 * @param {Uint8Array} tileBytes
 * @returns {Uint8Array} mutable 256-byte RGBA, in the selected BG group or the global pack
 */
export function getPackRgba256ForHash(hash, tileBytes) {
  const h = hash >>> 0;
  const target = paintTargetGroupOrNull();
  // Created on demand below: during a stroke, undo must know the pattern had no paint before,
  // which the snapshot taken after this call can no longer see.
  if (ctx.activePaintUndoMap && !ctx.activePaintUndoMap.has(h) && !paintTargetHasHash(h)) {
    if (ctx.activePaintUndoGroupId === undefined) ctx.activePaintUndoGroupId = target?.id ?? null;
    ctx.activePaintUndoMap.set(h, null);
  }
  if (target) {
    const live = ensureGroupTileColorMap(target.id);
    let buf = live.get(h);
    if (!buf || buf.length < 256) {
      buf = tileToRgba(tileBytes, ctx.ZOOM_DEFAULT_RAMP);
      live.set(h, buf);
      invalidateGroupColorIndex();
      ctx.markGroupsDirty();
    }
    return buf;
  }
  let buf = ctx.pack.get(h);
  if (!buf || buf.length < 256) {
    buf = tileToRgba(tileBytes, ctx.ZOOM_DEFAULT_RAMP);
    ctx.pack.set(h, buf);
  }
  return buf;
}

/**
 * A line in the group panel saying where this group's paint goes and how much it holds, so
 * "why is my colour on every layer" is answerable without opening the pack.
 */
export function paintStoreNote(g) {
  const own = groupTileColorCount(g);
  const shared = (g?.criteria?.hashes || []).map((h) => Number(h) >>> 0).filter((h) => ctx.pack.has(h)).length;
  const sharedNote = shared
    ? ` · <strong>${shared}</strong> more painted in the shared pack, which colours every copy on every frame`
    : '';
  if (g?.authoringKind !== 'bg') {
    return `<div class="muted" style="font-size:0.65rem;margin-top:0.3rem;line-height:1.35">`
      + `Paint goes to the shared pack: a sprite pattern keeps one colour across every pose.${shared ? ` <strong>${shared}</strong> painted.` : ''}</div>`;
  }
  if (useVipOverlayForZoomPaint(g)) {
    return `<div class="muted" style="font-size:0.65rem;margin-top:0.3rem;line-height:1.35">`
      + `Paint goes to this group's <strong>VIP overlay</strong> (anchored, fixed to screen position).${sharedNote}</div>`;
  }
  return `<div class="muted" style="font-size:0.65rem;margin-top:0.3rem;line-height:1.35">`
    + `Paint belongs to this group alone — <strong>${own}</strong> tile colour(s). The same pattern can be`
    + ` a different colour in another group.${sharedNote}</div>`;
}

/** True when this pattern already has colour in whichever store the next stroke writes to. */
export function paintTargetHasHash(hash) {
  const target = paintTargetGroupOrNull();
  if (target) return decodeGroupTileColors(target).has(hash >>> 0);
  return ctx.pack.has(hash >>> 0);
}

/**
 * @param {number} vx @param {number} vy VIP pixels
 * @param {{ r: number, g: number, b: number, a: number }} color
 */
function paintBrushVipOverlay(vx, vy, color) {
  if (vx < 0 || vx >= ctx.W || vy < 0 || vy >= ctx.H) {
    if (ctx.painterPaintDebug) console.debug('[painter paint] overlay skip: out of VIP', { vx, vy });
    return;
  }
  const o = ctx.ensureVipAuthoringOverlay();
  if (!o) return;
  const i = (vy * ctx.W + vx) * 4;
  o[i] = color.r;
  o[i + 1] = color.g;
  o[i + 2] = color.b;
  o[i + 3] = color.a;
}

/**
 * VIP underlay (composite without authoring overlay) for flood-fill connectivity.
 * @param {number} eye
 * @returns {Uint8ClampedArray}
 */
function compositeVipUnderlayBytesForFill(eye) {
  if (!ctx.scratchCompositeCtx) return new Uint8ClampedArray(0);
  if (!ctx.vipUnderlayScratchForFill || ctx.vipUnderlayScratchForFill.width !== ctx.W)
    ctx.vipUnderlayScratchForFill = ctx.scratchCompositeCtx.createImageData(ctx.W, ctx.H);
  const imageData = ctx.vipUnderlayScratchForFill;
  const viewState = stateForComposite(ctx.currentState);
  // The tools' preview (src/project.js), as the canvas shows it, for the fill to read.
  compositeColorFrameForEye(viewState, ctx.pack, imageData, colourOptions(ctx, 'toolPreview', {
    eye,
    wram: currentFrameWram(),
    painterV2VariantId: getActiveV2VariantId(),
    diagnosticMonoFallback: true,
  }));

  return imageData.data;
}

/**
 * Bucket on VIP authoring layer: expand by **composited underlay** color (same as full-frame preview),
 * writes opaque fill into the overlay.
 * @param {number} vx @param {number} vy
 * @param {{ r: number, g: number, b: number, a: number }} fill
 * @param {{ x0: number, y0: number, x1: number, y1: number } | null} [rect]
 *   Inclusive VIP pixel bounds; null = full frame (still gated by optional mask).
 * @param {Uint8Array | null} [footprintMask] length W*H; when set, only pixels with mask≠0 are filled.
 */
function zoomFloodFillVipOverlayFromUnderlay(vx, vy, fill, rect = null, footprintMask = null) {
  if (vx < 0 || vx >= ctx.W || vy < 0 || vy >= ctx.H) return;
  if (!ctx.currentState?.drawList?.length || !ctx.currentState.patternTable) return;
  if (footprintMask && !footprintMask[vy * ctx.W + vx]) return;
  if (rect && (vx < rect.x0 || vx > rect.x1 || vy < rect.y0 || vy > rect.y1)) return;
  const eye = getEye();
  const ud = compositeVipUnderlayBytesForFill(eye);
  if (!ud.length) return;
  const o = ctx.ensureVipAuthoringOverlay();
  if (!o) return;
  const idx = (vy * ctx.W + vx) * 4;
  const r0 = ud[idx];
  const g0 = ud[idx + 1];
  const b0 = ud[idx + 2];
  const a0 = ud[idx + 3];
  const { r: fr, g: fg, b: fb, a: fa } = fill;
  const xMin = rect ? Math.max(0, rect.x0) : 0;
  const yMin = rect ? Math.max(0, rect.y0) : 0;
  const xMax = rect ? Math.min(ctx.W - 1, rect.x1) : ctx.W - 1;
  const yMax = rect ? Math.min(ctx.H - 1, rect.y1) : ctx.H - 1;
  /** @type {Array<[number, number]>} */
  const stack = [[vx, vy]];
  const seen = new Set();
  while (stack.length) {
    const pair = stack.pop();
    if (!pair) continue;
    const [x, y] = pair;
    if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
    const k = y * ctx.W + x;
    if (seen.has(k)) continue;
    seen.add(k);
    if (footprintMask && !footprintMask[k]) continue;
    const j = k * 4;
    if (ud[j] !== r0 || ud[j + 1] !== g0 || ud[j + 2] !== b0 || ud[j + 3] !== a0) continue;
    if (o[j] === fr && o[j + 1] === fg && o[j + 2] === fb && o[j + 3] === fa) {
      stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
      continue;
    }
    o[j] = fr;
    o[j + 1] = fg;
    o[j + 2] = fb;
    o[j + 3] = fa;
    stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
}

/**
 * Build / reuse a W×H mask of VIP pixels covered by the paint group's member draws.
 * @param {typeof groups[0]} g
 * @returns {Uint8Array}
 */
function getGroupFootprintMaskForFill(g) {
  const mask = ctx.footprintMaskScratch();
  mask.fill(0);
  const viewState = stateForComposite(ctx.currentState);
  ctx.fillGroupMemberVipFootprintMask(viewState, g, getEye(), mask);
  // Scaled (affine) group tiles cover the pixels that read them, not their 8×8 records.
  const affine = affineMapForEye();
  if (affine && ctx.currentState?.patternTable) {
    const pt = ctx.currentState.patternTable;
    for (const [world, px] of affine) {
      /** @type {Map<number, boolean>} */
      const member = new Map();
      for (let p = 0; p < ctx.W * ctx.H; p++) {
        const ch = px.char[p];
        if (ch < 0) continue;
        let m = member.get(ch);
        if (m === undefined) {
          m = drawMatchesGroup({ world, layer: 1, tileIndex: ch }, g, hashTile(getTileBytes(pt, ch)) >>> 0);
          member.set(ch, m);
        }
        if (m) mask[p] = 1;
      }
    }
  }
  return mask;
}

/**
 * Tile8 bucket that crosses 8×8 boundaries: flood by underlay color inside the group footprint,
 * writing into each hit tile’s pack buffer (same hash updates all copies).
 * @param {number} vx @param {number} vy
 * @param {{ r: number, g: number, b: number, a: number }} fill
 * @param {typeof groups[0]} g
 */
function zoomFloodFillTile8AcrossGroup(vx, vy, fill, g) {
  if (vx < 0 || vx >= ctx.W || vy < 0 || vy >= ctx.H) return;
  if (!ctx.currentState?.drawList?.length || !ctx.currentState.patternTable) return;
  const seedCtx = resolveZoomPaintTileContext(vx, vy, g);
  if (!seedCtx) return;
  const mask = getGroupFootprintMaskForFill(g);
  if (!mask[vy * ctx.W + vx]) return;
  const eye = getEye();
  const ud = compositeVipUnderlayBytesForFill(eye);
  if (!ud.length) return;
  const idx = (vy * ctx.W + vx) * 4;
  const r0 = ud[idx];
  const g0 = ud[idx + 1];
  const b0 = ud[idx + 2];
  const a0 = ud[idx + 3];
  const { r: fr, g: fg, b: fb, a: fa } = fill;
  /** @type {Array<[number, number]>} */
  const stack = [[vx, vy]];
  const seen = new Set();
  while (stack.length) {
    const pair = stack.pop();
    if (!pair) continue;
    const [x, y] = pair;
    if (x < 0 || x >= ctx.W || y < 0 || y >= ctx.H) continue;
    const k = y * ctx.W + x;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!mask[k]) continue;
    const j = k * 4;
    if (ud[j] !== r0 || ud[j + 1] !== g0 || ud[j + 2] !== b0 || ud[j + 3] !== a0) continue;
    const tile = resolveZoomPaintTileContext(x, y, g);
    if (!tile) {
      stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
      continue;
    }
    const buf = getPackRgba256ForHash(tile.hash, tile.tileBytes);
    const o = (tile.ly * 8 + tile.lx) * 4;
    if (buf[o] === fr && buf[o + 1] === fg && buf[o + 2] === fb && buf[o + 3] === fa) {
      stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
      continue;
    }
    ctx.recordPackUndoSnapForHash(tile.hash, buf);
    buf[o] = fr;
    buf[o + 1] = fg;
    buf[o + 2] = fb;
    buf[o + 3] = fa;
    stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
}

/**
 * @param {number} vx @param {number} vy VIP pixels
 * @param {{ r: number, g: number, b: number, a: number }} color
 */
export function paintBrushPixelOnPack(vx, vy, color) {
  if (!ctx.zoomPaintStrokeAllowed) {
    if (ctx.painterPaintDebug) console.debug('[painter paint] skip: zoomPaintStrokeAllowed false', { vx, vy });
    return;
  }
  const g = getSelectedPaintGroupOrNull();
  if (!g) {
    if (ctx.painterPaintDebug) console.debug('[painter paint] skip: no selected group', { vx, vy });
    return;
  }
  if (ctx.zoomViewport && useVipOverlayForZoomPaint(g)) {
    paintBrushVipOverlay(vx, vy, color);
    return;
  }
  const tile = resolveZoomPaintTileContext(vx, vy, g);
  if (!tile) {
    if (ctx.painterPaintDebug) {
      const why = getZoomPaintBlockedReason();
      console.debug('[painter paint] skip: no tile under cursor for paint group', {
        vx,
        vy,
        groupId: g.id,
        paintBlocked: why,
        viewGroupFilterId: ctx.viewGroupFilterId,
      });
    }
    return;
  }
  // Erasing a tile with no paint does nothing (looking it up would seed it with starter shades).
  if (ctx.zoomEraseMode && !paintTargetHasHash(tile.hash)) return;
  const buf = getPackRgba256ForHash(tile.hash, tile.tileBytes);
  ctx.recordPackUndoSnapForHash(tile.hash, buf);
  const i = (tile.ly * 8 + tile.lx) * 4;
  buf[i] = color.r;
  buf[i + 1] = color.g;
  buf[i + 2] = color.b;
  buf[i + 3] = color.a;
}

/**
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 VIP pixels
 * @param {{ r: number, g: number, b: number, a: number }} color
 */
export function paintBrushLineOnPack(x0, y0, x1, y1, color) {
  bresenhamLine(x0, y0, x1, y1, (x, y) => paintBrushPixelOnPack(x, y, color));
}

/**
 * 4-connected flood fill. Default: one 8×8 tile (tile8) or one tile rect (VIP overlay).
 * With {@link fillAcrossTilesEnabled}: crosses tiles inside the paint group footprint.
 * @param {number} vx @param {number} vy
 * @param {{ r: number, g: number, b: number, a: number }} fill
 */
export function zoomFloodFillAtVip(vx, vy, fill) {
  if (getZoomPaintBlockedReason()) return;
  const g = getSelectedPaintGroupOrNull();
  if (!g) return;
  if (useVipOverlayForZoomPaint(g)) {
    if (ctx.fillAcrossTilesEnabled) {
      zoomFloodFillVipOverlayFromUnderlay(vx, vy, fill, null, getGroupFootprintMaskForFill(g));
    } else {
      const d = findFrontmostGroupDrawAtVip(vx, vy, g) || findAnchorDrawForGroup(g);
      if (!d) return;
      if (vx < d.x || vx >= d.x + 8 || vy < d.y || vy >= d.y + 8) return;
      zoomFloodFillVipOverlayFromUnderlay(
        vx,
        vy,
        fill,
        { x0: d.x, y0: d.y, x1: d.x + 7, y1: d.y + 7 },
        null,
      );
    }
    return;
  }
  if (ctx.fillAcrossTilesEnabled) {
    zoomFloodFillTile8AcrossGroup(vx, vy, fill, g);
    return;
  }
  const tile = resolveZoomPaintTileContext(vx, vy, g);
  if (!tile) return;
  const buf = getPackRgba256ForHash(tile.hash, tile.tileBytes);
  const idx = (tile.ly * 8 + tile.lx) * 4;
  const r0 = buf[idx];
  const g0 = buf[idx + 1];
  const b0 = buf[idx + 2];
  const a0 = buf[idx + 3];
  const { r: fr, g: fg, b: fb, a: fa } = fill;
  if (r0 === fr && g0 === fg && b0 === fb && a0 === fa) return;
  ctx.recordPackUndoSnapForHash(tile.hash, buf);
  /** @type {Array<[number, number]>} */
  const stack = [[tile.lx, tile.ly]];
  const seen = new Set();
  while (stack.length) {
    const pair = stack.pop();
    if (!pair) continue;
    const [lx, ly] = pair;
    const k = ly * 8 + lx;
    if (seen.has(k)) continue;
    seen.add(k);
    const o = k * 4;
    if (buf[o] !== r0 || buf[o + 1] !== g0 || buf[o + 2] !== b0 || buf[o + 3] !== a0) continue;
    buf[o] = fr;
    buf[o + 1] = fg;
    buf[o + 2] = fb;
    buf[o + 3] = fa;
    if (lx > 0) stack.push([lx - 1, ly]);
    if (lx < 7) stack.push([lx + 1, ly]);
    if (ly > 0) stack.push([lx, ly - 1]);
    if (ly < 7) stack.push([lx, ly + 1]);
  }
}

/**
 * Count draws on the active eye with the same VIP `world`, `layer`, and pattern `hash` (ambiguous anchor if more than one).
 * @param {import('../../src/vip-dump.js').DrawCall} anchorDraw
 * @param {number} hash
 */
export function countSameHashWorldLayerEye(anchorDraw, hash) {
  if (!ctx.currentState?.patternTable) return 0;
  const pt = ctx.currentState.patternTable;
  const eye = getEye();
  const wKey = normWorldKey(anchorDraw.world);
  const L = anchorDraw.layer !== undefined && anchorDraw.layer !== null ? Number(anchorDraw.layer) : NaN;
  if (!Number.isFinite(L)) return 0;
  let c = 0;
  const h = hash >>> 0;
  for (const d of ctx.currentState.drawList) {
    if (!d || drawEye(d) !== eye) continue;
    if (normWorldKey(d.world) !== wKey) continue;
    const dL = d.layer !== undefined && d.layer !== null ? Number(d.layer) : NaN;
    if (dL !== L) continue;
    if ((hashTile(getTileBytes(pt, d.tileIndex)) >>> 0) !== h) continue;
    c++;
  }
  return c;
}

export function startAnchorPickForGroup(groupId) {
  startAnchorPickForGroupAction(
    {
      groups: ctx.groups,
      currentState: ctx.currentState,
      setStatus: ctx.setStatus,
      setAnchorPickGroupId: (id) => {
        ctx.anchorPickGroupId = id;
      },
      drawSelectionOverlay,
    },
    groupId,
  );
}

/**
 * Resolve an in-progress anchor pick against the tile at VIP (vx, vy).
 *
 * Called straight from `pointerdown`, because the paint tools claim the pointer there and
 * would otherwise swallow the pick click before it could ever reach pointerup.
 */
export function handleAnchorPickClick(vx, vy) {
  if (!ctx.anchorPickGroupId || !ctx.currentState) return;
  const hits = hitDrawIndices(vx, vy);
  if (!hits.length) {
    ctx.setStatus('Click a tile inside the cyan outlines (Esc to cancel).');
  } else {
    const view = filterStateForView(ctx.currentState);
    const d = view.drawList[hits[0]];
    const fi = fullDrawIndexFromDraw(d);
    const gPick = ctx.groups.find((x) => x.id === ctx.anchorPickGroupId);
    const pt = ctx.currentState.patternTable;
    if (gPick && fi >= 0 && pt) {
      const h = hashTile(getTileBytes(pt, d.tileIndex)) >>> 0;
      if (!drawMatchesGroup(d, gPick, h)) {
        ctx.setStatus('That tile is not in this group. Cyan outlines show members (Esc to cancel).');
      } else {
        const nSame = countSameHashWorldLayerEye(d, h);
        if (nSame > 1) {
          const cont = window.confirm(
            `This pattern (#${h.toString(16).toUpperCase()}) appears on ${nSame} draws in VIP world ${normWorldKey(d.world)} with layer ${d.layer ?? '?'} (copies at different positions).\n\nSet it as the anchor anyway?\n\n• Green outlines will mark every copy.\n• Zoom paint stays on per-hash tile8 so all copies update together.\n• VIP overlay paint only applies when an anchor hash is unique on this eye.`,
          );
          if (!cont) {
            ctx.setStatus('Anchor pick cancelled (hash not unique).');
            drawSelectionOverlay();
            return;
          }
        }
        ctx.groups = ctx.groups.map((x) => (x.id === ctx.anchorPickGroupId ? normalizeGroup({ ...x, anchorHash: h }) : x));
        ctx.markGroupsDirty();
        ctx.anchorPickGroupId = null;
        const gn = ctx.groups.find((x) => x.id === gPick.id);
        updateGroupsPanel();
        if (gn) updateGroupDetail(gn);
        updatePaintV2TopButton();
        ctx.render();
        ctx.setStatus(
          nSame > 1
            ? `anchorHash #${h.toString(16).toUpperCase()} set (${nSame} copies on this eye — tile8 paint; green = copies). Save .vbpack to persist.`
            : `anchorHash #${h.toString(16).toUpperCase()} set (unique in this world+layer — VIP overlay paint). Save .vbpack to persist.`,
        );
      }
    }
  }
  drawSelectionOverlay();
  updateSelectionUi();
  updatePaintV2TopButton();
}

/** Clear BG anchor so zoom paint uses per-hash tile8 (all matching draws). */
export function clearGroupAnchor(groupId) {
  const g = ctx.groups.find((x) => x.id === groupId);
  if (!g) return;
  if (typeof g.anchorHash !== 'number' || !Number.isFinite(g.anchorHash)) {
    ctx.setStatus('No anchor to clear on this group.');
    return;
  }
  ctx.groups = ctx.groups.map((x) => {
    if (x.id !== groupId) return x;
    /** @type {any} */
    const raw = { ...x };
    delete raw.anchorHash;
    return normalizeGroup(raw);
  });
  ctx.markGroupsDirty();
  const gn = ctx.groups.find((x) => x.id === groupId);
  updateGroupsPanel();
  if (gn) updateGroupDetail(gn);
  updatePaintV2TopButton();
  ctx.render();
  ctx.setStatus(
    `Cleared anchor on “${gn?.name || groupId}”. Zoom paint now uses per-hash tile8 (all matching draws). Save .vbpack to persist.`,
  );
}

export function removeSelectedHashesFromGroupCriteria(groupId) {
  ctx.groups = removeSelectedHashesFromGroupCriteriaAction(
    {
      groups: ctx.groups,
      currentState: ctx.currentState,
      selectedDrawFullIndices: ctx.selectedDrawFullIndices,
      normalizeGroup,
      markGroupsDirty: ctx.markGroupsDirty,
      updateGroupsPanel,
      updateGroupDetail,
      render: ctx.render,
      setStatus: ctx.setStatus,
    },
    groupId,
  );
}

export function addSelectedHashesToGroupCriteria(groupId) {
  ctx.groups = addSelectedHashesToGroupCriteriaAction(
    {
      groups: ctx.groups,
      currentState: ctx.currentState,
      selectedDrawFullIndices: ctx.selectedDrawFullIndices,
      normalizeGroup,
      markGroupsDirty: ctx.markGroupsDirty,
      updateGroupsPanel,
      updateGroupDetail,
      render: ctx.render,
      setStatus: ctx.setStatus,
    },
    groupId,
  );
}
