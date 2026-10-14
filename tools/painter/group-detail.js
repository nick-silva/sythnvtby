/**
 * The Project tool's group details: the pool summary, the new-group membership banner, and the
 * details panel (shade ramp, animated tiles, follow palette, worlds, who wins shared tiles). Split out of tools/painter.js, which passes in the state and functions it shares
 * (initGroupDetail).
 */
import { deserializeVIPState } from '../../src/vip-dump.js';
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { decodeGroupTileColors } from '../../src/group-tile-colors.js';
import { otherWorldsShowingGroup, withWorlds } from '../../src/group-worlds.js';
import { groupLabel } from '../../src/pixel-explain.js';
import { moveGroupBefore, sharedTileWins, picturesOnFrame, coveredByPictures } from '../../src/group-order.js';
import { slotsForGroup, patternBytesFinder } from '../shared/animated-tiles.js';
import { shadeRampFromPaint } from '../../src/shade-ramp.js';
import { layerArtOf } from '../../src/layer-art.js';
import { touchUpOf } from '../../src/touch-up.js';
import { normalizeGroup } from '../../src/group-schema.js';
import { renderPoseSectionHtml, bindPoseSectionEvents } from './sprite-profiles-ui.js';
import { drawEye, getEye } from './view-filters.js';
import { drawMatchesGroup, useVipOverlayForZoomPaint } from './zoom-target.js';
import { bindGroupScreenSetting, filedUnderHtml, groupScreenSettingHtml, groupScreensHtml, groupsOnThisFrame } from './screens-ui.js';
import { drawSelectionOverlay, enterZoomToGroup, filterViewToGroup } from './world-grid.js';
import { clearPaintForGroup } from './paint-inventory-ui.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initGroupDetail(context) {
  ctx = context;
}

export function manifestHasMemoryAnalysis() {
  const m = ctx.loadedPackParts?.manifest;
  return !!(m && typeof m === 'object' && m.memoryAnalysis != null && typeof m.memoryAnalysis === 'object');
}

export function poolSummaryText() {
  if (!ctx.gameStatePools.length) {
    const chunks = [];
    if (!ctx.packHadGroupsJsonOnLoad) {
      chunks.push(
        '<span class="muted"><strong>New colorization pack</strong> — no <code>groups.json</code> in the zip yet (normal for a fresh emulator export or memory-tool annotation). When <code>manifest.memoryAnalysis.topCandidatesByState</code> has entries, Painter <strong>auto-seeds</strong> <code>gameStatePools</code>: one pool per state key, <strong>short UI title</strong> (segment before <code>/</code> or dash), full key kept for frame matching, variant <code>__default__</code> with the first WRAM candidate. <strong>Save .vbpack</strong> writes <code>groups.json</code>.</span>',
      );
    } else {
      chunks.push(
        '<span class="muted">No <code>gameStatePools</code> in <code>groups.json</code> — memory pool rows are optional until you define them (v1 paint, merge, or hand-edit).</span>',
      );
    }
    if (manifestHasMemoryAnalysis() && !ctx.memoryAnalysisSeededPools) {
      if (!ctx.packHadGroupsJsonOnLoad) {
        chunks.push(
          ' <span style="color:var(--accent-warm)"><code>memoryAnalysis</code> did not produce seedable <code>topCandidatesByState</code> rows — run analysis with enough frames/states, or define pools manually later.</span>',
        );
      } else {
        chunks.push(
          ' <span style="color:var(--accent-warm)"><code>manifest.memoryAnalysis</code> is present; add <code>gameStatePools</code> inside <code>groups.json</code> for pool dropdowns.</span>',
        );
      }
    }
    return chunks.join('');
  }
  let n = 0;
  for (const p of ctx.gameStatePools) {
    const v = p?.variants;
    if (Array.isArray(v)) n += v.length;
  }
  const base = `<strong>${ctx.gameStatePools.length}</strong> pool(s) · <strong>${n}</strong> variant(s) <span class="muted">(preview uses full composite; WRAM gates off)</span>`;
  const seedNote = ctx.memoryAnalysisSeededPools
    ? ' <span class="muted" style="opacity:0.88">Auto-seeded from <code>manifest.memoryAnalysis</code>; <strong>Save .vbpack</strong> writes <code>groups.json</code>.</span>'
    : '';
  const def = ctx.findDefaultPoolVariantForFrame();
  if (def == null || def.poolIndex < 0 || def.poolIndex >= ctx.gameStatePools.length) return base + seedNote;
  const pool = ctx.gameStatePools[def.poolIndex];
  const vars = Array.isArray(pool?.variants) ? pool.variants : [];
  const v = vars[def.variantIndex];
  if (!v) return base + seedNote;
  const poolLabel =
    typeof pool?.label === 'string' && pool.label.trim() ? pool.label.trim() : String(pool?.id || `pool-${def.poolIndex}`);
  const vLabel = typeof v?.label === 'string' && v.label.trim() ? v.label.trim() : String(v?.id || '');
  const vId = typeof v?.id === 'string' ? v.id.trim() : '';
  const single = vars.length === 1;
  const hint = single
    ? `<div class="frame-variant-hint">This frame → <strong>${ctx.escapeHtml(poolLabel)}</strong> · <strong>${ctx.escapeHtml(vLabel)}</strong> <span class="muted">(only variant in this pool)</span></div>`
    : `<div class="frame-variant-hint">This frame → <strong>${ctx.escapeHtml(poolLabel)}</strong> · variant <strong>${ctx.escapeHtml(vLabel)}</strong> <code class="muted" style="font-size:0.62rem">${ctx.escapeHtml(vId)}</code></div>`;
  return base + hint + seedNote;
}

export function countDrawsMatchingGroup(g) {
  if (!ctx.currentState?.drawList || !ctx.currentState.patternTable) return 0;
  const pt = ctx.currentState.patternTable;
  let c = 0;
  for (const d of ctx.currentState.drawList) {
    if (drawEye(d) !== getEye()) continue;
    const tb = getTileBytes(pt, d.tileIndex);
    const h = hashTile(tb);
    if (drawMatchesGroup(d, g, h)) c++;
  }
  return c;
}

/**
 * Preview what “New group from selection” would match on the current eye/frame.
 * Selection is positions; membership is unique pattern hashes (+ world/layer from kind).
 * @param {'bg'|'obj'} [kind]
 */
function summarizeSelectionAsGroupMembership(kind) {
  const k = kind === 'bg' || kind === 'obj' ? kind : ctx.readNewGroupKind();
  const selected = ctx.selectedDrawFullIndices.size;
  if (!ctx.currentState?.drawList || !ctx.currentState.patternTable || selected === 0) {
    return { selected: 0, uniqueHashes: 0, matchingDraws: 0, hasCopies: false, kind: k };
  }
  const pt = ctx.currentState.patternTable;
  const eye = getEye();
  const hashSet = new Set();
  const windowSet = new Set();
  for (const fi of ctx.selectedDrawFullIndices) {
    const d = ctx.currentState.drawList[fi];
    if (!d || drawEye(d) !== eye) continue;
    hashSet.add(hashTile(getTileBytes(pt, d.tileIndex)) >>> 0);
    if (d.world !== undefined && d.world !== null) windowSet.add(Number(d.world));
  }
  /** @type {{ criteria: { hashes: number[], windowIds: number[], layers: number[] } }} */
  const draft = {
    criteria: {
      hashes: [...hashSet],
      windowIds: [...windowSet].sort((a, b) => a - b),
      layers: k === 'bg' ? [0] : [2],
    },
  };
  let matchingDraws = 0;
  for (const d of ctx.currentState.drawList) {
    if (!d || drawEye(d) !== eye) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex)) >>> 0;
    if (drawMatchesGroup(d, draft, h)) matchingDraws++;
  }
  const uniqueHashes = hashSet.size;
  return {
    selected,
    uniqueHashes,
    matchingDraws,
    hasCopies: matchingDraws > selected,
    kind: k,
  };
}

export function refreshNewGroupMembershipBanner() {
  if (!ctx.newGroupMembership) return;
  const s = summarizeSelectionAsGroupMembership();
  if (s.selected === 0) {
    ctx.newGroupMembership.hidden = true;
    ctx.newGroupMembership.innerHTML = '';
    ctx.newGroupMembership.classList.remove('warn');
    return;
  }
  ctx.newGroupMembership.hidden = false;
  ctx.newGroupMembership.classList.toggle('warn', s.hasCopies);
  const copyNote = s.hasCopies
    ? ` <strong>Same patterns appear elsewhere</strong> — all <strong>${s.matchingDraws}</strong> instances on this eye are included, not only your <strong>${s.selected}</strong> selected draw(s).`
    : ` No extra copies on this eye.`;
  ctx.newGroupMembership.innerHTML =
    `This group will match <strong>${s.uniqueHashes}</strong> pattern hash(es) → <strong>${s.matchingDraws}</strong> draw(s) on this frame (eye).` +
    copyNote +
    ` <span class="muted">Membership is by tile content (+ world/layer), not screen position.</span>`;
}

/** @param {Array<string|null>|undefined} ramp */
function shadeRampSwatches(ramp) {
  return [1, 2, 3]
    .map((s) => {
      const c = Array.isArray(ramp) ? ramp[s] : null;
      return c
        ? `<span title="shade ${s}: ${ctx.escapeHtml(c)}" style="display:inline-block;width:0.8rem;height:0.8rem;border-radius:2px;border:1px solid var(--border-strong);vertical-align:-2px;background:${ctx.escapeHtml(c)}"></span>`
        : `<span title="shade ${s}: not painted yet" class="muted" style="display:inline-block;width:0.8rem;text-align:center">·</span>`;
    })
    .join(' ');
}

/** The Animated tiles row of a BG group's inspector. */
function animatedTilesHtml(g) {
  const slots = Array.isArray(g.criteria?.tileSlots) ? g.criteria.tileSlots : [];
  const on = slots.length > 0;
  const note = on
    ? `Claims <strong>${slots.length}</strong> tile slot(s): whatever the game draws in them is this group's. Steps you have not painted use your shade colours ${shadeRampSwatches(g.shadeRamp)} — paint each phase in SpriteStudio.`
    : 'For art the game animates by redrawing its tiles in place (a twinkling starfield): every step becomes this group’s, and steps you have not painted take your colours by shade.';
  return `
    <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.72rem;margin-top:0.35rem;cursor:pointer">
      <input type="checkbox" id="toggle-group-animated" ${on ? 'checked' : ''} /> <strong>Animated tiles</strong>
    </label>
    <div class="muted" style="font-size:0.65rem;margin-top:0.15rem;line-height:1.4">${note}</div>`;
}

/**
 * "Follow the game's palette" (group.followPalette): paint brightens and dims with the palette the
 * game draws each tile with — for menus that show the selected option in a brighter palette.
 */
function followPaletteHtml(g) {
  const on = g.followPalette === true;
  const worlds = (g.criteria?.windowIds || []).map(Number);
  const others = worlds.length
    ? ctx.groups.filter((x) => x.id !== g.id && (x.criteria?.windowIds || []).map(Number).some((w) => worlds.includes(w)) && (x.followPalette === true) !== on)
    : [];
  const all = others.length
    ? `<button type="button" class="btn-ghost" id="btn-follow-palette-all" style="font-size:0.66rem;padding:0.1rem 0.35rem;margin-left:0.35rem" title="Turn it ${on ? 'on' : 'off'} for the ${others.length} other group(s) on world ${worlds.join(', ')} too">Same for ${others.length} more on world ${worlds.join(', ')}</button>`
    : '';
  return `
    <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.72rem;margin-top:0.35rem;cursor:pointer">
      <input type="checkbox" id="toggle-follow-palette" ${on ? 'checked' : ''} /> <strong>Follow the game's palette</strong>${all}
    </label>
    <div class="muted" style="font-size:0.65rem;margin-top:0.15rem;line-height:1.4">Paint keeps its colour where the game draws the layer brightest and dims where the game dims it with another palette — e.g. a menu's selected option bright, the rest dim. Only on layers drawn with more than one palette.</div>`;
}

/** Turn "Follow the game's palette" on or off for these groups. */
function setFollowPalette(ids, on) {
  const want = new Set(ids);
  ctx.groups = ctx.groups.map((x) => {
    if (!want.has(x.id)) return x;
    const { followPalette: _f, ...rest } = x;
    return normalizeGroup(on ? { ...rest, followPalette: true } : rest);
  });
  ctx.markGroupsDirty();
  ctx.updateGroupsPanel();
  const sel = ctx.groups.find((x) => x.id === ctx.selectedGroupId) || ctx.groups.find((x) => want.has(x.id));
  if (sel) updateGroupDetail(sel);
  ctx.render();
  ctx.setStatus(`Follow the game's palette ${on ? 'on' : 'off'} for ${ids.length} group(s). Save .vbpack to keep it.`);
}

/**
 * The colour each shade carries in a group's paint, for the steps of its animation nobody
 * painted. Pattern pixels come from the frame on screen first, then the pack's other frames.
 * @param {any} g
 */
function shadeRampForGroup(g) {
  const others = ctx.availableFrames.filter((_, i) => i !== ctx.getCurrentFrameSelectIndex());
  const bytesOf = patternBytesFinder(others.length + 1, (i) => {
    if (i === 0) return ctx.currentState;
    try {
      return deserializeVIPState(JSON.parse(others[i - 1].json));
    } catch {
      return null;
    }
  });
  return shadeRampFromPaint(decodeGroupTileColors(g), bytesOf);
}

/** Turn Animated tiles on (claim the slots this group's tiles sit in on this frame) or off. */
function setGroupAnimatedTiles(groupId, on) {
  const g = ctx.groups.find((x) => x.id === groupId);
  if (!g) return;
  let next;
  if (on) {
    const slots = ctx.currentState ? slotsForGroup(ctx.currentState, g, getEye()) : [];
    if (!slots.length) {
      ctx.setStatus('None of this group’s tiles are on this frame — pick a frame that shows it, then turn Animated tiles on.');
      updateGroupDetail(g);
      return;
    }
    next = { ...g, criteria: { ...g.criteria, tileSlots: slots }, shadeRamp: shadeRampForGroup(g) };
  } else {
    const { tileSlots: _drop, ...criteria } = g.criteria || {};
    const { shadeRamp: _ramp, ...rest } = g;
    next = { ...rest, criteria };
  }
  ctx.groups = ctx.groups.map((x) => (x.id === groupId ? next : x));
  ctx.markGroupsDirty();
  ctx.updateGroupsPanel();
  updateGroupDetail(next);
  ctx.render();
  ctx.setStatus(
    on
      ? `“${next.name}” is animated: it claims ${next.criteria.tileSlots.length} tile slot(s). Paint its phases in SpriteStudio; unpainted steps use its shade colours.`
      : `“${next.name}” is no longer animated — it matches its own patterns only.`,
  );
}

/** Before a save: each animated group's shade colours follow whatever was painted since. */
export function refreshAnimatedShadeRamps() {
  let changed = false;
  ctx.groups = ctx.groups.map((g) => {
    if (!Array.isArray(g.criteria?.tileSlots) || !g.criteria.tileSlots.length) return g;
    const ramp = shadeRampForGroup(g);
    if (JSON.stringify(ramp) === JSON.stringify(g.shadeRamp)) return g;
    changed = true;
    return { ...g, shadeRamp: ramp };
  });
  if (changed) ctx.markGroupsDirty();
}

export function updateGroupDetail(g) {
  if (!ctx.groupDetail) return;
  if (!g) {
    ctx.groupDetail.innerHTML =
      '<span class="muted">Select a group in the tree — use <strong>Filter view</strong> / <strong>Zoom to group</strong> in the inspector to match the canvas strip to that group.</span>';
    drawSelectionOverlay();
    return;
  }
  const layers = g.criteria?.layers || [];
  const isObj = Array.isArray(layers) && layers.includes(2);
  const isBg = Array.isArray(layers) && layers.includes(0) && !layers.includes(2);
  const showBgAnchorUi = g.authoringKind === 'bg' || (isBg && !isObj);
  const hashes = Array.isArray(g.criteria?.hashes) ? g.criteria.hashes : [];
  const nHashes = hashes.length;
  const n = countDrawsMatchingGroup(g);
  const hasCopies = n > nHashes && nHashes > 0;
  const hasAnchor = typeof g.anchorHash === 'number' && Number.isFinite(g.anchorHash);
  const anchorValue = hasAnchor
    ? `${ctx.escapeHtml(String(g.anchorHash))} <span class="muted">(0x${g.anchorHash.toString(16).toUpperCase()})</span>`
    : '<span class="muted">—</span>';
  const anchorSetBtn = showBgAnchorUi
    ? `<button type="button" class="btn-ghost" id="btn-group-anchor-pick" title="Pick anchor hash from a highlighted tile on canvas (Esc cancels). Must be unique in that world+layer on this eye." aria-label="Set anchor hash" style="font-size:0.84rem;padding:0.1rem 0.36rem;line-height:1.1;margin-left:0.35rem">A</button>`
    : '';
  const anchorClearBtn =
    showBgAnchorUi && hasAnchor
      ? `<button type="button" class="btn-ghost" id="btn-group-anchor-clear" title="Clear anchor — zoom paint uses per-hash tile8 so every matching draw gets the same colors." aria-label="Clear anchor" style="font-size:0.84rem;padding:0.1rem 0.36rem;line-height:1.1;margin-left:0.2rem">✕</button>`
      : '';
  const membershipNote = hasCopies
    ? `<div style="font-size:0.68rem;margin-top:0.25rem;color:var(--accent-warm);line-height:1.4">Same pattern(s) appear in more than one place — canvas outlines every matching draw. Selection (magenta) is what you clicked; cyan = group membership; green = anchor-hash copies.</div>`
    : `<div class="muted" style="font-size:0.65rem;margin-top:0.25rem;line-height:1.35">Membership is by pattern hash (+ world/layer), not screen position. Magenta = selection · cyan = group matches${showBgAnchorUi ? ' · green = anchor-hash draws' : ''}.</div>`;
  const anchorNote = showBgAnchorUi
    ? hasAnchor
      ? useVipOverlayForZoomPaint(g)
        ? `<div class="muted" style="font-size:0.65rem;margin-top:0.2rem;line-height:1.35">Paint mode: <strong>VIP overlay</strong> (anchor hash is unique on this eye). Green = that hash’s draw(s).</div>`
        : `<div style="font-size:0.68rem;margin-top:0.2rem;line-height:1.35;color:var(--accent-warm)">Anchor set — hash appears in <strong>multiple</strong> places. Paint uses <strong>tile8</strong> so all matching draws update. Green outlines mark every anchor-hash copy. VIP overlay paint only when the anchor hash is unique.</div>`
      : `<div class="muted" style="font-size:0.65rem;margin-top:0.2rem;line-height:1.35">Paint mode: <strong>per-hash tile8</strong> — colors apply to every matching draw. Use <strong>A</strong> to set an anchor (highlights copies; unique hash → VIP overlay paint).</div>`
    : '';
  ctx.groupDetail.innerHTML = `
    <div class="group-detail-name-row">
      <label for="group-display-name-input">Name</label>
      <input type="text" id="group-display-name-input" maxlength="200" value="${ctx.escapeHtml(g.name || g.id)}" />
      <button type="button" class="btn-ghost" id="btn-group-apply-name" style="font-size:0.68rem;padding:0.22rem 0.4rem">Confirm</button>
    </div>
    <div style="font-size:0.72rem;margin-top:0.35rem"><strong>Group ID</strong> <code title="Stable identifier used by overrides.json; renaming changes the display name only.">${ctx.escapeHtml(g.id)}</code></div>
    <div style="font-size:0.72rem;margin-top:0.35rem;display:flex;align-items:center;flex-wrap:wrap"><strong>Anchor hash</strong>&nbsp;<span>${anchorValue}</span>${anchorSetBtn}${anchorClearBtn}</div>
    ${anchorNote}
    ${showBgAnchorUi ? animatedTilesHtml(g) : ''}
    ${showBgAnchorUi ? followPaletteHtml(g) : ''}
    ${groupScreensHtml(g)}
    ${groupScreenSettingHtml(g)}
    ${filedUnderHtml(g)}
    ${touchUpOf(g) ? `<div style="font-size:0.72rem;margin-top:0.35rem;color:#f0b429"><strong>Touch-up</strong>: a ${touchUpOf(g).box.width}×${touchUpOf(g).box.height} patch painted over this group's tiles, shown only where the ${touchUpOf(g).layout.length} tiles around the anchor are arranged as when it was made. Painting here changes the tile colours everywhere; edit the touch-up in SpriteStudio.</div>` : ''}
    ${layerArtOf(g) ? `<div style="font-size:0.72rem;margin-top:0.35rem;color:var(--cyan)"><strong>Overpaint</strong>: a ${layerArtOf(g).width}×${layerArtOf(g).height} picture pinned to world ${layerArtOf(g).world}'s map, ${layerArtOf(g).hideTiles ? 'shown instead of the layer’s tiles' : 'painted over the group’s tiles'} wherever this group is on screen — it scrolls with the layer. Paint it in SpriteStudio.</div>` : ''}
    ${g.poseOverpaints?.length ? `<div style="font-size:0.72rem;margin-top:0.35rem;color:var(--cyan)" id="pose-overpaint-note"><strong>Pose overpaint</strong>: ${g.poseOverpaints.length} pose${g.poseOverpaints.length === 1 ? ' has' : 's have'} a picture of its own (${g.poseOverpaints.map((p) => ctx.escapeHtml(p.name || p.id)).join(', ')}), shown only when that whole pose is on screen. Paint them on the pose's card in SpriteStudio.</div>` : ''}
    <div style="font-size:0.72rem;margin-top:0.35rem"><strong>Membership</strong>: <strong>${nHashes}</strong> hash(es) → <strong>${n}</strong> draw(s) on this eye${hasCopies ? ' <span style="color:var(--accent-warm)">(includes copies)</span>' : ''}</div>
    ${membershipNote}
    ${groupWorldsHtml(g)}
    ${sharedTilesHtml(g)}
    ${renderPoseSectionHtml(g, ctx.escapeHtml)}
    <div style="display:flex;align-items:center;gap:0.35rem;margin-top:0.45rem">
      <button type="button" class="btn-ghost" id="btn-group-add-selected-hashes" title="Add selected tiles' pattern hashes to this group's criteria (existing hashes stay unchanged)." style="font-size:0.84rem;padding:0.1rem 0.42rem;line-height:1.1">+</button>
      <button type="button" class="btn-ghost" id="btn-group-remove-selected-hashes" title="Remove selected tiles' pattern hashes from this group's criteria." style="font-size:0.84rem;padding:0.1rem 0.42rem;line-height:1.1">-</button>
    </div>
    <div class="group-detail-view-actions" style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-top:0.4rem">
      <button type="button" class="btn-ghost${ctx.viewGroupFilterId === g.id ? ' active' : ''}" id="btn-filter-to-group" aria-pressed="${ctx.viewGroupFilterId === g.id ? 'true' : 'false'}" title="${ctx.viewGroupFilterId === g.id ? 'Showing only this group — click to show every draw again' : 'Filter view to this group'}" aria-label="Filter view to this group" style="font-size:0.68rem;padding:0.2rem 0.34rem;line-height:1.1">
        <img src="${ctx.toolbarImg('toolbar_grid_toggle.png')}" width="16" height="16" alt="" />
      </button>
      <button type="button" class="btn-ghost" id="btn-zoom-to-group" title="Zoom to this group" aria-label="Zoom to this group" style="font-size:0.68rem;padding:0.2rem 0.34rem;line-height:1.1">
        <img src="${ctx.toolbarImg('toolbar_zoom_in.png')}" width="16" height="16" alt="" />
      </button>
      <button type="button" class="btn-ghost" id="btn-select-all-in-group" title="Select all tiles in this group" aria-label="Select all tiles in this group" style="font-size:0.68rem;padding:0.2rem 0.34rem;line-height:1.1">
        <img src="${ctx.toolbarImg('toolbar_selection.png')}" width="16" height="16" alt="" />
      </button>
      <button type="button" class="btn-ghost" id="btn-deselect-group" title="Let go of this group so its outlines stop covering the frame (Esc)" style="font-size:0.68rem;padding:0.2rem 0.4rem;line-height:1.1">Deselect</button>
    </div>
    ${ctx.paintStoreNote(g)}
    <details style="margin-top:0.42rem">
      <summary class="muted" style="font-size:0.68rem;cursor:pointer">Raw criteria (debug)</summary>
      <pre style="margin-top:0.35rem">${ctx.escapeHtml(JSON.stringify(g.criteria || {}, null, 2))}</pre>
    </details>
    <div class="group-detail-actions">
      <button type="button" class="btn-ghost" id="btn-clear-group-paint" title="Throw away the colours painted on this group's tile patterns and start it over" style="font-size:0.72rem;padding:0.28rem 0.45rem">Clear paint</button>
      <button type="button" class="btn-ghost" id="btn-duplicate-group" title="Duplicate group (placeholder icon)" aria-label="Duplicate group" style="font-size:0.72rem;padding:0.28rem 0.45rem">CP</button>
      <button type="button" class="btn-danger" id="btn-delete-selected-group" title="Delete group (placeholder icon)" aria-label="Delete group">DEL</button>
    </div>
  `;
  document.getElementById('btn-clear-group-paint')?.addEventListener('click', () => clearPaintForGroup(g));
  bindGroupScreenSetting(g);
  document.getElementById('toggle-follow-palette')?.addEventListener('change', (e) => setFollowPalette([g.id], /** @type {HTMLInputElement} */ (e.target).checked));
  document.getElementById('btn-follow-palette-all')?.addEventListener('click', (e) => {
    e.preventDefault();
    const on = g.followPalette === true;
    const worlds = (g.criteria?.windowIds || []).map(Number);
    const ids = ctx.groups.filter((x) => (x.criteria?.windowIds || []).map(Number).some((w) => worlds.includes(w))).map((x) => x.id);
    setFollowPalette(ids, on);
  });
  document.getElementById('toggle-group-animated')?.addEventListener('change', (e) =>
    setGroupAnimatedTiles(g.id, /** @type {HTMLInputElement} */ (e.target).checked),
  );
  document.getElementById('btn-deselect-group')?.addEventListener('click', () => ctx.deselectGroup('Group deselected — its outlines are off.'));
  document.getElementById('btn-group-apply-name')?.addEventListener('click', () => ctx.applyRenameGroupFromInspector(g.id));
  document.getElementById('btn-group-anchor-pick')?.addEventListener('click', () => ctx.startAnchorPickForGroup(g.id));
  document.getElementById('btn-group-anchor-clear')?.addEventListener('click', () => ctx.clearGroupAnchor(g.id));
  document.getElementById('btn-group-add-selected-hashes')?.addEventListener('click', () => ctx.addSelectedHashesToGroupCriteria(g.id));
  document.getElementById('btn-group-remove-selected-hashes')?.addEventListener('click', () => ctx.removeSelectedHashesFromGroupCriteria(g.id));
  document.getElementById('btn-filter-to-group')?.addEventListener('click', () => filterViewToGroup(g));
  document.getElementById('btn-zoom-to-group')?.addEventListener('click', () => enterZoomToGroup(g));
  document.getElementById('btn-select-all-in-group')?.addEventListener('click', () => ctx.selectAllDrawsMatchingGroup(g));
  document.getElementById('btn-duplicate-group')?.addEventListener('click', () => ctx.openDuplicateGroupDialog(g.id));
  document.getElementById('btn-delete-selected-group')?.addEventListener('click', () => ctx.deleteGroupById(g.id));
  bindPoseSectionEvents((poseId, action, checked) => ctx.handlePoseAction(g.id, poseId, action, checked));
  ctx.groupDetail.querySelectorAll('[data-order-move]').forEach((b) =>
    b.addEventListener('click', () => reorderGroup(String(/** @type {HTMLElement} */ (b).dataset.orderMove), String(/** @type {HTMLElement} */ (b).dataset.orderBefore))),
  );
  ctx.groupDetail.querySelectorAll('[data-world-add]').forEach((b) =>
    b.addEventListener('click', () => setGroupWorlds(g.id, [...(g.criteria?.windowIds || []), Number(/** @type {HTMLElement} */ (b).dataset.worldAdd)])),
  );
  ctx.groupDetail.querySelectorAll('[data-world-remove]').forEach((b) =>
    b.addEventListener('click', () => {
      const w = Number(/** @type {HTMLElement} */ (b).dataset.worldRemove);
      setGroupWorlds(g.id, (g.criteria?.windowIds || []).map(Number).filter((x) => x !== w));
    }),
  );
  document.getElementById('group-display-name-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ctx.applyRenameGroupFromInspector(g.id);
    }
  });
  drawSelectionOverlay();
}

/** Every captured frame as a VIP state, parsed once per frame list (for whole-pack questions). */
let allFrameStatesFor = /** @type {{ frames: any[], states: any[] } | null} */ (null);
/** Every frame's state by its index in the frame list; null for one that cannot be read. */
export function frameStatesByIndex() {
  if (allFrameStatesFor?.frames !== ctx.availableFrames) {
    const states = ctx.availableFrames.map((f) => {
      try {
        return deserializeVIPState(JSON.parse(f.json));
      } catch {
        return null; // an unreadable frame just does not count
      }
    });
    allFrameStatesFor = { frames: ctx.availableFrames, states };
  }
  return allFrameStatesFor.states;
}
function allFrameStates() {
  return frameStatesByIndex().filter(Boolean);
}

/**
 * The group's worlds, and other worlds its tiles turn up on (src/group-worlds.js): games that
 * draw characters with background worlds move them between worlds as things pass in front of each
 * other, and a group only paints on its own worlds — the picture flickers. One click adds a world.
 */
function groupWorldsHtml(g) {
  const own = (Array.isArray(g.criteria?.windowIds) ? g.criteria.windowIds : []).map(Number);
  if (!own.length) return `<div style="font-size:0.72rem;margin-top:0.35rem"><strong>Worlds</strong>: any</div>`;
  const chips = own
    .map((w) =>
      own.length > 1
        ? `<span class="world-chip">${w}<button type="button" class="btn-ghost" data-world-remove="${w}" title="Stop painting this group on world ${w}" aria-label="Remove world ${w}">×</button></span>`
        : `<span class="world-chip">${w}</span>`,
    )
    .join(' ');
  const hashes = new Set((g.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  const suggestions = otherWorldsShowingGroup(allFrameStates(), g, getEye()).map(({ world, frames }) => {
    // Another group already painting these tiles on that world wins there (first match).
    const rivals = ctx.groups
      .filter((x) => x.id !== g.id && (x.criteria?.windowIds || []).map(Number).includes(world))
      .filter((x) => (x.criteria?.hashes || []).some((h) => hashes.has(Number(h) >>> 0)))
      .map((x) => x.name || x.id);
    const rivalNote = rivals.length ? ` · also ${rivals.join(', ')}` : '';
    const title = `This group's tiles are drawn on world ${world} on ${frames} captured frame(s) — the game moves them between worlds. Add it so the paint follows.${rivals.length ? ` ${rivals.join(', ')} already paint${rivals.length === 1 ? 's' : ''} some of these tiles on world ${world}, and the group listed first wins there.` : ''}`;
    return `<button type="button" class="btn-ghost world-suggest" data-world-add="${world}" title="${ctx.escapeHtml(title)}">+ ${world} <span class="muted">(${frames} frame${frames === 1 ? '' : 's'}${ctx.escapeHtml(rivalNote)})</span></button>`;
  });
  const also = suggestions.length
    ? `<div class="muted" style="font-size:0.65rem;margin-top:0.2rem;line-height:1.35">Its tiles also show on other worlds — the game moves them between worlds, and the group's paint drops out there:</div><div style="display:flex;flex-wrap:wrap;gap:0.25rem;margin-top:0.2rem">${suggestions.join('')}</div>`
    : '';
  return `<div style="font-size:0.72rem;margin-top:0.35rem"><strong>Worlds</strong>: ${chips}</div>${also}`;
}

/** Set the group's worlds and redraw. */
export function setGroupWorlds(id, worlds) {
  const g = ctx.groups.find((x) => x.id === id);
  if (!g) return;
  const next = normalizeGroup(withWorlds(g, worlds));
  ctx.groups = ctx.groups.map((x) => (x.id === id ? next : x));
  ctx.markGroupsDirty();
  ctx.updateGroupsPanel();
  updateGroupDetail(next);
  ctx.render();
  ctx.setStatus(`“${next.name || next.id}” now paints on world${next.criteria.windowIds.length === 1 ? '' : 's'} ${next.criteria.windowIds.join(', ')}. Save .vbpack to persist.`);
}

/**
 * Shared tiles on the frame on screen: where two groups paint the same tiles differently, the one
 * listed first wins (src/group-order.js). Worked out once per frame and group list.
 */
let frameWinsMemo = { state: /** @type {any} */ (null), groups: /** @type {any} */ (null), key: '', wins: /** @type {ReturnType<typeof sharedTileWins>} */ ([]) };
function winsOnThisFrame() {
  if (!ctx.currentState?.drawList) return [];
  const shown = groupsOnThisFrame();
  const key = shown.map((g) => g.id).join('\n');
  if (frameWinsMemo.state !== ctx.currentState || frameWinsMemo.groups !== ctx.groups || frameWinsMemo.key !== key) {
    // Tiles a picture covers do not show either group's paint.
    const covered = coveredByPictures(picturesOnFrame(ctx.currentState, shown, ctx.groups, 0));
    frameWinsMemo = { state: ctx.currentState, groups: ctx.groups, key, wins: sharedTileWins(ctx.currentState, shown, 0, covered) };
  }
  return frameWinsMemo.wins;
}

const tilesIn = (pairs) => new Set(pairs.flatMap((p) => [...p.hashes])).size;

/**
 * "behind Mario" on a group row whose tiles take another group's colours on this frame — it is on
 * screen without that group, which only shares its patterns and comes first; null otherwise.
 */
export function behindPill(g) {
  const lost = winsOnThisFrame().filter((p) => p.loser.id === g.id && p.loserElsewhere && !p.winnerElsewhere);
  if (!lost.length) return null;
  const pill = document.createElement('span');
  pill.className = 'screens-pill behind-pill';
  pill.textContent = lost.length === 1 ? `behind ${groupLabel(lost[0].winner)}` : `behind ${lost.length} groups`;
  const n = tilesIn(lost);
  pill.title = `${n} of this group's painted tile${n === 1 ? '' : 's'} on this frame ${n === 1 ? 'is' : 'are'} also painted by ${lost.map((p) => groupLabel(p.winner)).join(', ')}, listed first in the group list — so that paint shows instead. Select the group to change the order.`;
  return pill;
}

/** The group's details: which groups it shares painted tiles with on this frame, and who wins. */
function sharedTilesHtml(g) {
  const wins = winsOnThisFrame();
  // Only where the losing group is on screen in its own right; otherwise the winner is just
  // sharing a pattern with it, and its colours are the right ones.
  const behind = wins.filter((p) => p.loser.id === g.id && p.loserElsewhere);
  const ahead = wins.filter((p) => p.winner.id === g.id && p.loserElsewhere);
  if (!behind.length && !ahead.length) return '';
  const tiles = (p) => `${p.hashes.size} tile${p.hashes.size === 1 ? '' : 's'}`;
  const rows = [
    ...behind.map((p) => `<li>Behind <strong>${ctx.escapeHtml(groupLabel(p.winner))}</strong> on ${tiles(p)}: its paint shows there${p.winnerElsewhere ? ' (both are on screen, and a pattern takes one colour)' : ''}.<button type="button" class="btn-ghost" data-order-move="${ctx.escapeHtml(g.id)}" data-order-before="${ctx.escapeHtml(p.winner.id)}" title="Move this group just above ${ctx.escapeHtml(groupLabel(p.winner))} in the group list">Put this group first</button></li>`),
    ...ahead.map((p) => `<li>Ahead of <strong>${ctx.escapeHtml(groupLabel(p.loser))}</strong> on ${tiles(p)}: this group's paint shows there.<button type="button" class="btn-ghost" data-order-move="${ctx.escapeHtml(p.loser.id)}" data-order-before="${ctx.escapeHtml(g.id)}" title="Move ${ctx.escapeHtml(groupLabel(p.loser))} just above this group in the group list">Let ${ctx.escapeHtml(groupLabel(p.loser))} win</button></li>`),
  ];
  return `<div class="shared-tiles" id="group-shared-tiles"><strong>Shared tiles</strong> <span class="muted">on this frame — where two groups paint a tile, the one listed first wins</span><ul>${rows.join('')}</ul></div>`;
}

/** Move a group just ahead of another in the group list, so its paint wins their shared tiles. */
export function reorderGroup(id, beforeId) {
  const next = moveGroupBefore(ctx.groups, id, beforeId);
  if (next.every((g, i) => g === ctx.groups[i])) return;
  ctx.groups = next;
  ctx.markGroupsDirty();
  ctx.updateGroupsPanel();
  const sel = ctx.groups.find((x) => x.id === ctx.selectedGroupId);
  if (sel) updateGroupDetail(sel);
  ctx.render();
  const name = (gid) => groupLabel(ctx.groups.find((x) => x.id === gid) || { id: gid });
  ctx.setStatus(`“${name(id)}” now comes before “${name(beforeId)}” in the group list, so its paint wins where both paint a tile. Save to keep it.`);
}

/**
 * Check project (src/project-health.js): every captured frame, a few at a time so the page stays
 * responsive, again a moment after groups or paint change. The count of problems shows next to
 * File only when there are some; the list opens from Project ▸ Check project….
 */
export const HEALTH_DELAY_MS = 1500;
export const HEALTH_PAINT_DELAY_MS = 3000;
export const HEALTH_FRAMES_PER_STEP = 6;
