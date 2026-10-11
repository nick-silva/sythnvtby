/**
 * The Project tool's VIP overlay painting (an older paint kind kept per group and eye): the
 * buffers, the authoring overlay, and the group's footprint mask blended into the frame. Split out of tools/painter.js, which passes in the state and functions it shares
 * (initVipOverlayPaint).
 */
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { DEFAULT_FADE_RESPONSE, getCompositeDrawOwners } from '../../src/color-layer.js';
import { overlayBrightness, groupDrawMembership } from '../../src/painter-v2-vip-overlay.js';
import { getBgAffineWorldClipRect, getWindowsTableBytesFromState } from '../../src/vip-world-clip.js';
import { drawEye, getEye, getLayer } from './view-filters.js';
import { drawMatchesGroup, legacyOverlayShowing } from './zoom-target.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initVipOverlayPaint(context) {
  ctx = context;
}

/**
 * @param {string} groupId
 * @param {number} eye 0 | 1
 * @returns {Uint8Array}
 */
export function ensureVipOverlayBufferForGroupEye(groupId, eye) {
  const e = eye & 1;
  let byEye = ctx.vipAuthoringByGroupAndEye.get(groupId);
  if (!byEye) {
    byEye = new Map();
    ctx.vipAuthoringByGroupAndEye.set(groupId, byEye);
  }
  const n = ctx.W * ctx.H * 4;
  let buf = byEye.get(e);
  if (!buf || buf.length !== n) {
    buf = new Uint8Array(n);
    byEye.set(e, buf);
  }
  return buf;
}

/** @returns {Uint8Array | null} */
export function ensureVipAuthoringOverlay() {
  if (!ctx.selectedGroupId) return null;
  return ensureVipOverlayBufferForGroupEye(ctx.selectedGroupId, getEye());
}

export function clearVipAuthoringOverlay() {
  ctx.vipAuthoringByGroupAndEye.clear();
  ctx.activeVipOverlayUndoSnapshot = null;
}

/** @returns {{ groupId: string; eye: number; prev: Uint8Array } | null} */
export function snapshotVipOverlayForStrokeUndo() {
  const gid = ctx.selectedGroupId;
  if (!gid) return null;
  const eye = getEye();
  const buf = ensureVipOverlayBufferForGroupEye(gid, eye);
  return { groupId: gid, eye, prev: new Uint8Array(buf) };
}

/** @type {Uint8Array|null} */
let vipOverlayFootprintMaskScratch = null;

/** A frame-sized mask buffer, reused by every footprint mask (the caller clears it). */
export function footprintMaskScratch() {
  if (!vipOverlayFootprintMaskScratch || vipOverlayFootprintMaskScratch.length !== ctx.W * ctx.H) vipOverlayFootprintMaskScratch = new Uint8Array(ctx.W * ctx.H);
  return vipOverlayFootprintMaskScratch;
}

/** When any of these narrow the draw list, anchor VIP overlays must not paint outside the same footprint as {@link compositeColorFrame}. */
function needsVipAuthoringFootprintMask() {
  return ctx.worldFilter !== 'all' || getLayer() !== 'all' || !!ctx.viewGroupFilterId;
}

/**
 * Set `outMask[pidx]` to 1 for VIP pixels covered by `group` draws in `viewState` for `eye`
 * (same window-clip rules as {@link compositeColorFrame} with stripClip off).
 *
 * @param {import('../../src/vip-dump.js').VIPStateObject} viewState
 * @param {typeof groups[0]} group
 * @param {number} eye
 * @param {Uint8Array} outMask length W*H, should be zeroed by caller
 */
export function fillGroupMemberVipFootprintMask(viewState, group, eye, outMask) {
  if (!viewState?.drawList?.length || !viewState.patternTable) return;
  const pt = viewState.patternTable;
  const e = eye & 1;
  const windowsTable = getWindowsTableBytesFromState(viewState);
  /** @type {Map<string, ReturnType<typeof getBgAffineWorldClipRect>>} */
  const worldClipCache = new Map();
  for (const call of viewState.drawList) {
    if (drawEye(call) !== e) continue;
    const h = hashTile(getTileBytes(pt, call.tileIndex)) >>> 0;
    if (!drawMatchesGroup(call, group, h)) continue;
    let worldClip = null;
    if (windowsTable && call.world !== undefined && call.world !== null) {
      const wid = call.world | 0;
      if (wid >= 0 && wid <= 31) {
        const ck = `${wid},${e}`;
        let wc = worldClipCache.get(ck);
        if (wc === undefined) {
          wc = getBgAffineWorldClipRect(windowsTable, wid, e);
          worldClipCache.set(ck, wc);
        }
        worldClip = wc;
      }
    }
    if (worldClip && worldClip.x0 > worldClip.x1) continue;
    const x0 = call.x;
    const y0 = call.y;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const ix = x0 + px;
        const iy = y0 + py;
        if (ix < 0 || ix >= ctx.W || iy < 0 || iy >= ctx.H) continue;
        if (worldClip && (ix < worldClip.x0 || ix > worldClip.x1 || iy < worldClip.y0 || iy > worldClip.y1)) continue;
        outMask[iy * ctx.W + ix] = 1;
      }
    }
  }
}

/**
 * Blend VIP authoring overlays from every anchor group that has a buffer for this eye, so switching
 * the selected group does not hide another group’s overlay work (buffers stay in
 * {@link vipAuthoringByGroupAndEye}; the selected group is drawn last).
 *
 * @param {ImageData} imageData
 * @param {import('../../src/vip-dump.js').VIPStateObject} viewState same as passed to {@link compositeColorFrame} (filtered layer/world + preview window table)
 */
export function blendVipAuthoringIntoImageData(imageData, viewState) {
  const eye = getEye();
  const d = imageData.data;
  // Painted tiles dim with the scene inside compositeColorFrame; overlay paint has to follow
  // the same fade or the preview lies about what the game will show.
  const k = overlayBrightness(viewState, DEFAULT_FADE_RESPONSE);
  // What is actually visible at each pixel, so an overlay stops at a sprite drawn in front of
  // it — the preview has to agree with the game about depth.
  const drawOwners = getCompositeDrawOwners();
  const sel = ctx.selectedGroupId;
  const maskFootprints = needsVipAuthoringFootprintMask();
  const maskBuf = maskFootprints ? footprintMaskScratch() : null;
  /** @type {string[]} */
  const ids = [...ctx.vipAuthoringByGroupAndEye.keys()].filter((gid) => {
    const g = ctx.groups.find((x) => x.id === gid);
    return !!(g && legacyOverlayShowing(g) && ctx.vipAuthoringByGroupAndEye.get(gid)?.get(eye));
  });
  ids.sort((a, b) => {
    if (a === sel && b !== sel) return 1;
    if (b === sel && a !== sel) return -1;
    return 0;
  });
  for (const gid of ids) {
    const o = ctx.vipAuthoringByGroupAndEye.get(gid)?.get(eye);
    if (!o) continue;
    const g = ctx.groups.find((x) => x.id === gid);
    if (maskBuf && g) {
      maskBuf.fill(0);
      fillGroupMemberVipFootprintMask(viewState, g, eye, maskBuf);
    }
    const member = drawOwners && g ? groupDrawMembership(viewState, eye, g) : null;
    for (let i = 0, n = ctx.W * ctx.H * 4; i < n; i += 4) {
      if (o[i + 3] === 0) continue;
      if (maskBuf && !maskBuf[i >> 2]) continue;
      if (member) {
        const owner = drawOwners[i >> 2];
        if (owner < 0 || !member[owner]) continue;
      }
      d[i] = k === 1 ? o[i] : (o[i] * k) | 0;
      d[i + 1] = k === 1 ? o[i + 1] : (o[i + 1] * k) | 0;
      d[i + 2] = k === 1 ? o[i + 2] : (o[i + 2] * k) | 0;
      d[i + 3] = o[i + 3];
    }
  }
}
