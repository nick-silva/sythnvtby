/**
 * SpriteStudio's cards: each pose (or captured frame) of the selected group resolved to a frame,
 * the card strip and its thumbnails, selecting a group and a card, and keeping, renaming, moving
 * and deleting poses. Split out of tools/sprite-studio.js, which passes in the state and functions
 * it shares (initPoses).
 */
import { frameState, frameIndexForFrameId, posesOf, locatePose, poseBounds, bgGroupViews, affinePoseView, affineBaseView, frameLabel, liveGroupTileColors } from '../shared/pack-session.js';
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { findRepeatSet } from '../../src/pattern-set.js';
import { shadeRampFromPaint } from '../../src/shade-ramp.js';
import { animationPhases, patternBytesFinder } from '../shared/animated-tiles.js';
import { isObjGroup, removePoseFromGroup, patternsInNoPose, patternsOnlyInPose, withoutPatterns, unclaimedPatterns, poseMoveTargets, movePoseBetweenGroups, updatePose, addPoseToGroup, buildPoseFromView, nextPoseId, LEGACY_POSE_ID } from '../../src/obj-sprite-profiles.js';
import { layerArtOf } from '../../src/layer-art.js';
import { artTarget, overpaintMode, posePictureCanStart, posePictureForView, resetPaintOn, selectedArt, syncPaintOnUi } from './overpaint.js';
import { markActiveRow, renderSpriteLists } from './group-list.js';
import { currentTracks, renderTracksPanel } from './tracks.js';
import { refreshActiveReference } from './reference.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initPoses(context) {
  ctx = context;
}

/* ------------------------------------------------------------------ poses */

/** Resolve each pose to a frame and an anchor position in that frame. */
export function buildPoseViews(group) {
  ctx.el('base-tiles-label').hidden = true;
  if (!isObjGroup(group)) {
    // An animated group gets one card per phase of its animation, like a sprite's poses.
    if (isAnimatedGroup(group)) {
      const phases = phaseViews(group);
      if (phases.length) return phases;
    }
    // A BG group shows the poses it kept, else one card per captured frame that shows something
    // new of it. A repeating pattern also gets its one set, the smallest block it repeats by; a
    // scaled (affine) group is one picture drawn through the VIP's sampling, so it has none.
    const kept = posesOf(group);
    const views = kept.length
      ? kept.map((pose) => (pose.affine ? affinePoseView(ctx.session, group, pose, ctx.eye()) : locatedPoseView(pose))).filter(Boolean)
      : bgGroupViews(ctx.session, group, ctx.eye());
    // Base tiles: a scaled card shows its tiles unscaled instead (src/affine-base.js).
    const scaled = views.some((v) => v.pose.affineWorlds);
    ctx.el('base-tiles-label').hidden = !scaled;
    const shown = scaled && ctx.el('toggle-base-tiles').checked ? views.map((v) => (v.pose.affineWorlds && affineBaseView(ctx.session, v, ctx.eye())) || v) : views;
    return shown.map((v) => ({ ...v, set: v.pose.affineWorlds || v.base || !v.origin ? null : findRepeatSet(v.pose.tiles) }));
  }
  // A sprite group with no poses yet (made from a tile selection) would only have its tile list,
  // which has no position to draw at: show it on each captured frame instead, like a background
  // group, and let a card be kept as its first pose.
  if (!(Array.isArray(group.poses) && group.poses.length)) {
    const cards = bgGroupViews(ctx.session, group, ctx.eye());
    if (cards.length) return cards.map((v) => ({ ...v, set: null }));
  }
  return posesOf(group).map(locatedPoseView);
}

/** A captured pose resolved to its frame (or the frame holding most of it) and anchor position. */
function locatedPoseView(pose) {
  let frameIndex = pose.sourceFrameId ? frameIndexForFrameId(ctx.session, pose.sourceFrameId) : -1;
  let origin = null;
  let matched = 0;
  if (frameIndex >= 0) {
    const hit = locatePose(frameState(ctx.session, frameIndex), pose, ctx.eye());
    if (hit) {
      origin = { x: hit.x, y: hit.y };
      matched = hit.matched;
    }
  }
  if (!origin) {
    // The recorded frame is gone (or the anchor is not on this eye): fall back
    // to the frame that contains the most of this pose.
    for (let i = 0; i < ctx.session.frames.length; i++) {
      const hit = locatePose(frameState(ctx.session, i), pose, ctx.eye());
      if (hit && hit.matched > matched) {
        frameIndex = i;
        origin = { x: hit.x, y: hit.y };
        matched = hit.matched;
        if (matched === pose.tiles.length) break;
      }
    }
  }
  return { pose, frameIndex, origin, matched, total: pose.tiles.length };
}

/** @param {any} group */
export function isAnimatedGroup(group) {
  return !!group && !isObjGroup(group) && Array.isArray(group.criteria?.tileSlots) && group.criteria.tileSlots.length > 0;
}

/**
 * One view per phase of an animated BG group: the captured frames grouped by what the game had
 * written into the group's tile slots. Every phase is drawn in the same place, so each view is
 * anchored on the same screen position and the cards line up as the animation plays.
 */
function phaseViews(group) {
  const frames = ctx.session.frames.map((_, frameIndex) => ({ frameIndex, state: frameState(ctx.session, frameIndex) }));
  const phases = animationPhases(frames, group, ctx.eye());
  return phases.map((phase, n) => {
    const state = frameState(ctx.session, phase.frameIndex);
    const anchor = [...phase.draws].sort((a, b) => a.y - b.y || a.x - b.x)[0];
    const hashOf = (d) => hashTile(getTileBytes(state.patternTable, d.tileIndex)) >>> 0;
    const tiles = phase.draws.map((d) => ({ hash: hashOf(d), dx: d.x - anchor.x, dy: d.y - anchor.y }));
    const k = phase.frameIndices.length;
    return {
      pose: { poseId: `__phase${n + 1}`, name: `Phase ${n + 1} · ${k} frame${k === 1 ? '' : 's'}`, anchorHash: hashOf(anchor), tiles },
      frameIndex: phase.frameIndex,
      origin: { x: anchor.x, y: anchor.y },
      matched: tiles.length,
      total: tiles.length,
      set: findRepeatSet(tiles),
      phase: { number: n + 1, frames: k },
    };
  });
}

/**
 * An animated group's shade colours, from what is painted on it now: the renderer colours every
 * step of the animation nobody painted with these.
 */
export function refreshShadeRamp(group) {
  if (!isAnimatedGroup(group)) return;
  // The phases' own frames hold the painted patterns: look there before the rest of the pack.
  const first = [...new Set(ctx.poseViews.map((v) => v.frameIndex).filter((i) => i >= 0))];
  const order = [...first, ...ctx.session.frames.map((_, i) => i).filter((i) => !first.includes(i))];
  const bytesOf = patternBytesFinder(order.length, (k) => frameState(ctx.session, order[k]));
  group.shadeRamp = shadeRampFromPaint(liveGroupTileColors(group), bytesOf);
}

export function selectGroup(group) {
  ctx.hideExplainBubble();
  // Rows and buttons keep the group object they were drawn with; Save and edits replace it in the
  // session. Selecting an old copy brought back an old picture place: the paint moved.
  if (group && ctx.session) group = ctx.session.groups.find((g) => g.id === group.id) || group;
  ctx.stopPlayback();
  ctx.freeView = null;
  // A mirrored track step belongs to the sprite it was on; it must not flip the next group.
  ctx.stageMirror = false;
  ctx.selectedGroup = group;
  // Every group starts on tile paint: touch-up painting is always a deliberate switch. A pose's
  // group (Overpaint just this pose) is there for its picture, so it starts on that.
  resetPaintOn(group?.wholePose === true && layerArtOf(group) ? 'overpaint' : 'tiles');
  syncPaintOnUi();
  markActiveRow();
  ctx.poseViews = group && ctx.session ? buildPoseViews(group) : [];
  ctx.poseIndex = 0;
  renderStrip();
  syncPoseScrub();
  ctx.activeTrackId = null;
  ctx.trackFrame = 0;
  ctx.pinnedFrameIndex = ctx.poseViews[0]?.frameIndex ?? -1;
  ctx.referencePalette = [];
  refreshActiveReference();
  renderTracksPanel();
  ctx.renderPalette();
  ctx.drawStage();
  ctx.renderDetail();
  if (group && !ctx.poseViews.length) {
    ctx.setStatus(
      isObjGroup(group)
        ? `${group.name || group.id} has no poses — capture them in the Project tool.`
        : `No frame in this pack shows ${group.name || group.id} (on this eye).`,
    );
  } else if (group && (!isObjGroup(group) || isFrameCard(ctx.poseViews[0].pose))) {
    const v = ctx.poseViews[0];
    ctx.setStatus(`${group.name || group.id}: ${v.matched} tile(s) on ${frameLabel(ctx.session, v.frameIndex) || 'its frame'}.`);
  }
}

/**
 * A group with no captured poses shows stand-ins (a sprite's tile list, a BG group's frames); they
 * are not stored, so they cannot go. Their ids start with `__` or are the legacy id.
 */
export function isDeletablePose(pose) {
  return pose.poseId !== LEGACY_POSE_ID && !pose.poseId.startsWith('__');
}

const BASE_TILES_VIEW_PREFIX = '__base:';

/**
 * The stored pose a filmstrip card stands for. With Base tiles on, a scaled pose's card is a
 * stand-in (src/affine-base.js) — Rename, Delete and Move still act on the pose behind it.
 */
export function storedPose(pose) {
  if (!pose?.poseId?.startsWith(BASE_TILES_VIEW_PREFIX) || !ctx.selectedGroup) return pose;
  const id = pose.poseId.slice(BASE_TILES_VIEW_PREFIX.length);
  return posesOf(ctx.selectedGroup).find((p) => p.poseId === id) || pose;
}

/** A BG group's frame card not yet kept as a pose. */
export function isFrameCard(pose) {
  return pose.poseId.startsWith('__frame:');
}

/** The frame registry id a kept pose records, so it reopens on the same frame. */
function frameIdForIndex(frameIndex) {
  const f = ctx.session.frames[frameIndex];
  return f ? String(f.registryEntry?.frameId || f.vipFile || '') : '';
}

/**
 * Keep a BG group's frame card as a pose. Once a group has poses its filmstrip shows just those,
 * so you choose which frames to paint on.
 */
export function keepFrameAsPose(view) {
  if (!ctx.selectedGroup || !isFrameCard(view.pose)) return;
  const sourceFrameId = frameIdForIndex(view.frameIndex);
  const pose = buildPoseFromView({
    poseId: nextPoseId(ctx.selectedGroup),
    name: view.pose.name,
    view,
    ...(sourceFrameId && { sourceFrameId }),
  });
  if (!pose) return;
  ctx.stopPlayback();
  const first = posesOf(ctx.selectedGroup).length === 0;
  ctx.replaceSelectedGroup(addPoseToGroup(ctx.selectedGroup, pose));
  ctx.poseViews = buildPoseViews(ctx.selectedGroup);
  ctx.poseIndex = Math.max(0, ctx.poseViews.findIndex((v) => v.pose.poseId === pose.poseId));
  renderStrip();
  syncPoseScrub();
  refreshActiveReference();
  ctx.drawStage();
  ctx.renderDetail();
  const note = first ? ' The filmstrip now shows kept poses only — delete them all to see every frame again.' : '';
  ctx.setStatus(`Kept “${pose.name}” as a pose of ${ctx.selectedGroup.name || ctx.selectedGroup.id}.${note} Save to keep it.`);
}

export function syncPoseScrub() {
  const scrub = ctx.el('pose-scrub');
  scrub.max = String(Math.max(0, ctx.poseViews.length - 1));
  scrub.value = String(ctx.poseIndex);
  scrub.disabled = ctx.poseViews.length < 2;
  ctx.el('btn-play').disabled = ctx.poseViews.length < 2;
}

/**
 * Duplicates tend to show up only once the poses sit side by side here, so they can be
 * deleted here too. The pose's painted tiles stay: paint belongs to tile patterns, not poses.
 * @param {string} poseId
 */
/**
 * Replace the selected group with `next` minus `hashes` (its list and own paint), and drop the
 * shared paint of any of them no group claims any more (a sprite's patterns live in the shared
 * pack). Undo cannot bring these back: the group itself changed.
 */
function dropPatternsFromSelectedGroup(next, hashes) {
  ctx.replaceSelectedGroup(withoutPatterns(next, hashes));
  for (const h of unclaimedPatterns(ctx.session.groups, hashes)) ctx.session.pack.delete(h >>> 0);
  ctx.undoStack.length = 0;
  ctx.redoStack.length = 0;
  ctx.syncUndoButtons();
  ctx.seedShadeCache.clear();
  ctx.invalidateRender();
  ctx.renderPalette();
}

/** Where these patterns show: the labels of captured frames that draw any of them. */
function framesShowing(hashes) {
  const want = new Set(hashes.map((h) => h >>> 0));
  const labels = [];
  for (let i = 0; i < ctx.session.frames.length; i++) {
    const st = frameState(ctx.session, i);
    if (!st?.drawList || !st.patternTable) continue;
    if (st.drawList.some((d) => want.has(hashTile(getTileBytes(st.patternTable, d.tileIndex)) >>> 0))) labels.push(ctx.session.frames[i].label);
  }
  return labels;
}

/**
 * The patterns no pose uses may be a real frame of the animation — the game drawing the character
 * with its own tiles — painted once and then left without a pose. Keep the frames that show them
 * as poses (the fewest that cover them), so they get cards and can be repainted.
 */
export function keepPatternsInNoPoseAsPoses() {
  if (!ctx.selectedGroup || isObjGroup(ctx.selectedGroup)) return;
  const remaining = new Set(patternsInNoPose(ctx.selectedGroup));
  if (!remaining.size) return;
  const cards = bgGroupViews(ctx.session, ctx.selectedGroup, ctx.eye());
  const added = [];
  while (remaining.size) {
    let best = null;
    let bestN = 0;
    for (const v of cards) {
      const n = (v.patterns || []).filter((h) => remaining.has(h >>> 0)).length;
      if (n > bestN) {
        best = v;
        bestN = n;
      }
    }
    if (!best) break;
    const sourceFrameId = frameIdForIndex(best.frameIndex);
    const pose = buildPoseFromView({ poseId: nextPoseId(ctx.selectedGroup), name: best.pose.name, view: best, ...(sourceFrameId && { sourceFrameId }) });
    if (!pose) break;
    ctx.replaceSelectedGroup(addPoseToGroup(ctx.selectedGroup, pose));
    added.push(pose);
    for (const h of best.patterns || []) remaining.delete(h >>> 0);
    cards.splice(cards.indexOf(best), 1);
  }
  if (!added.length) {
    ctx.setStatus('No captured frame shows those patterns on this eye, so there is nothing to make a pose from.');
    return;
  }
  ctx.stopPlayback();
  ctx.poseViews = buildPoseViews(ctx.selectedGroup);
  ctx.poseIndex = Math.max(0, ctx.poseViews.findIndex((v) => v.pose.poseId === added[0].poseId));
  renderStrip();
  syncPoseScrub();
  refreshActiveReference();
  ctx.invalidateRender();
  ctx.drawStage();
  ctx.renderDetail();
  const left = remaining.size ? ` ${remaining.size} pattern(s) are on no captured frame of this eye and stay as they were.` : '';
  ctx.setStatus(`Kept ${added.length} frame${added.length === 1 ? '' : 's'} as pose${added.length === 1 ? '' : 's'} (${added.map((p) => `“${p.name}”`).join(', ')}) — repaint ${added.length === 1 ? 'it' : 'them'} here.${left} Save to keep it.`);
}

/** Take the patterns none of the group's poses uses out of it, with their paint (Pose details). */
export function removePatternsInNoPose() {
  if (!ctx.selectedGroup) return;
  const stray = patternsInNoPose(ctx.selectedGroup);
  if (!stray.length) return;
  const painted = stray.filter((h) => ctx.colourForHash(h)).length;
  const where = framesShowing(stray);
  const whereNote = where.length ? `\n\nThey show on ${where.length} captured frame${where.length === 1 ? '' : 's'}: ${where.slice(0, 6).join(', ')}${where.length > 6 ? ', …' : ''}.` : '';
  const ok = window.confirm(
    `Remove ${stray.length} tile pattern${stray.length === 1 ? '' : 's'} from “${ctx.selectedGroup.name || ctx.selectedGroup.id}”?\n\n`
      + `None of its poses use them${painted ? `; ${painted} are painted and lose that paint` : ''}. `
      + `They were left by a deleted pose, or by the frame the group was first made from.${whereNote}\n\n`
      + 'This cannot be undone, except by not saving.',
  );
  if (!ok) return;
  ctx.stopPlayback();
  dropPatternsFromSelectedGroup(ctx.selectedGroup, stray);
  ctx.poseViews = buildPoseViews(ctx.selectedGroup);
  ctx.poseIndex = Math.max(0, Math.min(ctx.poseIndex, ctx.poseViews.length - 1));
  renderStrip();
  syncPoseScrub();
  ctx.drawStage();
  ctx.renderDetail();
  ctx.setStatus(`Removed ${stray.length} tile pattern(s) no pose uses from ${ctx.selectedGroup.name || ctx.selectedGroup.id}${painted ? `, and their paint (${painted})` : ''}. Save to keep it.`);
}

export function deletePose(poseId) {
  if (!ctx.selectedGroup) return;
  const pose = posesOf(ctx.selectedGroup).find((p) => p.poseId === poseId);
  if (!pose || !isDeletablePose(pose)) return;
  const name = pose.name || pose.poseId;
  const usedBy = currentTracks()
    .filter((t) => t.steps.some((s) => s.poseId === poseId))
    .map((t) => `“${t.name}”`);
  const trackNote = usedBy.length ? `\n\nAnimation ${usedBy.join(', ')} use${usedBy.length === 1 ? 's' : ''} it; those steps go too.` : '';
  // The tiles only this pose used leave the group with it, and their paint with them: left behind,
  // they would keep painting wherever the game shows them, with no pose to paint them on.
  const only = patternsOnlyInPose(ctx.selectedGroup, poseId);
  const paintedOnly = only.filter((h) => ctx.colourForHash(h)).length;
  const tileNote = only.length
    ? `\n\n${only.length} tile pattern${only.length === 1 ? '' : 's'} only this pose uses leave${only.length === 1 ? 's' : ''} the group${paintedOnly ? `, with their paint (${paintedOnly} painted)` : ''}. Tiles other poses share keep their paint.`
    : '\n\nIts painted tiles stay: other poses use them, or it is the group’s last pose.';
  if (!window.confirm(`Delete pose “${name}”?${tileNote}${trackNote}`)) return;

  ctx.stopPlayback();
  const at = ctx.poseViews.findIndex((v) => v.pose.poseId === poseId);
  dropPatternsFromSelectedGroup(removePoseFromGroup(ctx.selectedGroup, poseId), only);
  ctx.poseViews = buildPoseViews(ctx.selectedGroup);
  // Stay where the deleted pose was, so the next duplicate is one click away.
  ctx.poseIndex = Math.max(0, Math.min(at, ctx.poseViews.length - 1));
  ctx.trackFrame = 0;
  renderStrip();
  syncPoseScrub();
  refreshActiveReference();
  ctx.drawStage();
  ctx.renderDetail();
  ctx.setStatus(`Deleted pose “${name}” — ${ctx.poseViews.length} left in ${ctx.selectedGroup.name || ctx.selectedGroup.id}. Save to keep it.`);
}

export function renamePose(poseId) {
  if (!ctx.selectedGroup) return;
  const pose = posesOf(ctx.selectedGroup).find((p) => p.poseId === poseId);
  if (!pose || !isDeletablePose(pose)) return;
  const old = pose.name || pose.poseId;
  const raw = window.prompt(`Rename pose “${old}” to:`, old);
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name === old) return;
  ctx.replaceSelectedGroup(updatePose(ctx.selectedGroup, poseId, { name }));
  ctx.poseViews = buildPoseViews(ctx.selectedGroup);
  renderStrip();
  ctx.renderDetail();
  ctx.setStatus(`Pose “${old}” is now “${name}”. Save to keep it.`);
}

/** Worlds that draw any of the view's tiles on its frame (this eye): the target group must match them. */
function worldsShowingView(view) {
  const state = frameState(ctx.session, view.frameIndex);
  if (!state?.drawList || !state.patternTable) return [];
  const want = new Set(view.pose.tiles.map((t) => t.hash >>> 0));
  const worlds = new Set();
  for (const d of state.drawList) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== ctx.eye() || d.world == null) continue;
    if (want.has(hashTile(getTileBytes(state.patternTable, d.tileIndex)) >>> 0)) worlds.add(Number(d.world));
  }
  return [...worlds];
}

function movePoseToGroup(poseId, toId) {
  if (!ctx.selectedGroup) return;
  const from = ctx.selectedGroup;
  const pose = posesOf(from).find((p) => p.poseId === poseId);
  const to = ctx.session.groups.find((g) => g.id === toId);
  if (!pose || !to) return;
  const name = pose.name || pose.poseId;
  const fromName = from.name || from.id;
  const toName = to.name || to.id;
  const view = ctx.poseViews.find((v) => v.pose.poseId === poseId);
  const windowIds = view && view.frameIndex >= 0 ? worldsShowingView(view) : [];
  const result = movePoseBetweenGroups(ctx.session.groups, from.id, to.id, poseId, { windowIds });
  if (!result) {
    ctx.setStatus(`“${name}” cannot move to ${toName}.`);
    return;
  }
  const usedBy = currentTracks().filter((t) => t.steps.some((s) => s.poseId === poseId)).map((t) => `“${t.name}”`);
  const lines = [`Move pose “${name}” from ${fromName} to ${toName}?`];
  if (result.left) lines.push(`${result.left} tile pattern(s) only this pose uses leave ${fromName}, with their paint.`);
  if (result.shared) lines.push(`${result.shared} pattern(s) other poses in ${fromName} share stay there too.`);
  if (result.carried) lines.push(`${toName} gets the paint of ${result.carried} pattern(s) it had not painted.`);
  if (usedBy.length) lines.push(`Animation ${usedBy.join(', ')} in ${fromName} lose${usedBy.length === 1 ? 's' : ''} its steps.`);
  if ((from.statePoolId || '') !== (to.statePoolId || '')) lines.push(`Note: the two groups are in different game-state pools.`);
  if (!window.confirm(lines.join('\n\n'))) return;

  ctx.stopPlayback();
  ctx.session.groups = result.groups;
  // Paint moved between groups: what the undo stack remembers no longer applies.
  ctx.undoStack.length = 0;
  ctx.redoStack.length = 0;
  ctx.syncUndoButtons();
  ctx.seedShadeCache.clear();
  ctx.invalidateRender();
  const target = ctx.session.groups.find((g) => g.id === to.id);
  ctx.markDirty();
  selectGroup(target);
  const at = ctx.poseViews.findIndex((v) => storedPose(v.pose).poseId === result.poseId);
  if (at >= 0) {
    ctx.poseIndex = at;
    ctx.pinnedFrameIndex = ctx.poseViews[at].frameIndex;
    renderStrip();
    syncPoseScrub();
    ctx.drawStage();
    ctx.renderDetail();
  }
  renderSpriteLists();
  markActiveRow();
  ctx.setStatus(`Moved “${name}” from ${fromName} to ${toName}${result.carried ? ` with ${result.carried} painted tile(s)` : ''}. Save to keep it.`);
}

/** The Move to… picker: groups this pose can go to. */
export function poseMovePicker(pose) {
  const targets = poseMoveTargets(ctx.session.groups, ctx.selectedGroup.id, pose.poseId);
  const label = document.createElement('label');
  label.className = 'folder-picker';
  label.textContent = 'Move to ';
  const select = document.createElement('select');
  select.id = 'pose-move-select';
  select.title = targets.length
    ? 'Move this pose to another group of the same kind, with its tiles and their paint'
    : 'No other group can take this pose (it needs a group of the same kind: sprite or background)';
  const opt = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };
  select.append(opt('', targets.length ? 'group…' : 'no compatible group'), ...targets.map((g) => opt(g.id, g.name || g.id)));
  select.disabled = !targets.length;
  select.addEventListener('change', () => {
    const id = select.value;
    select.value = '';
    if (id) movePoseToGroup(pose.poseId, id);
  });
  label.append(select);
  return label;
}

export function renderStrip() {
  // The whole strip is drawn fresh: cards waiting for a thumbnail are gone.
  staleThumbCards.clear();
  ctx.renderOnionOptions();
  const host = ctx.el('pose-strip');
  host.textContent = '';
  const canDelete = !!ctx.selectedGroup;
  ctx.poseViews.forEach((view, i) => {
    const card = document.createElement('div');
    card.className = `pose-card${i === ctx.poseIndex ? ' active' : ''}`;
    card.dataset.poseIndex = String(i);
    const thumb = document.createElement('canvas');
    drawPoseThumb(thumb, view);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = view.pose.name || view.pose.poseId;
    card.append(thumb, label);
    if (posePictureForView(view)) {
      const mark = document.createElement('span');
      mark.className = 'pose-picture-mark';
      mark.textContent = '◩';
      mark.title = 'This pose has its own overpaint, shown only when this whole pose is on screen';
      mark.setAttribute('aria-label', mark.title);
      card.append(mark);
    }
    const stored = storedPose(view.pose);
    if (canDelete && isDeletablePose(stored)) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'pose-delete';
      del.textContent = '×';
      del.title = `Delete pose “${stored.name || stored.poseId}”`;
      del.setAttribute('aria-label', del.title);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePose(stored.poseId);
      });
      card.append(del);
    }
    card.addEventListener('click', () => {
      ctx.stopPlayback();
      setPoseIndex(i);
    });
    host.append(card);
  });
  ctx.el('pose-counter').textContent = ctx.poseViews.length ? `${ctx.poseIndex + 1} / ${ctx.poseViews.length}` : '—';
}

/** Pose cards waiting for a fresh thumbnail after a stroke, drawn a few per frame. */
const staleThumbCards = new Set();
let thumbRefreshTimer = 0;
/** Thumbnails drawn per slice; each is a composite, so the page stays responsive between slices. */
const THUMB_SLICE_MS = 8;

/**
 * Redraw the thumbnails of the strip's poses that show any of these patterns, in small slices
 * after the stroke rather than all of them inside it (Luigi has 82 poses; redrawing every card
 * made each stroke take most of a second).
 * @param {Set<number>} hashes painted pattern hashes
 */
export function refreshPoseThumbs(hashes) {
  for (const card of ctx.el('pose-strip').querySelectorAll('.pose-card')) {
    const view = ctx.poseViews[Number(card.dataset.poseIndex)];
    if (view && (view.pose.tiles || []).some((t) => hashes.has(t.hash >>> 0))) staleThumbCards.add(card);
  }
  if (!staleThumbCards.size || thumbRefreshTimer) return;
  const step = () => {
    thumbRefreshTimer = 0;
    const until = performance.now() + THUMB_SLICE_MS;
    for (const card of staleThumbCards) {
      if (performance.now() >= until) break;
      staleThumbCards.delete(card);
      const view = card.isConnected ? ctx.poseViews[Number(card.dataset.poseIndex)] : null;
      const thumb = card.querySelector('canvas');
      if (view && thumb) drawPoseThumb(thumb, view);
    }
    if (staleThumbCards.size) thumbRefreshTimer = setTimeout(step, 16);
  };
  thumbRefreshTimer = setTimeout(step, 0);
}

function drawPoseThumb(thumb, view) {
  const bounds = view.origin ? poseBounds(view.pose, view.origin) : null;
  const w = bounds ? bounds.x1 - bounds.x0 : 16;
  const h = bounds ? bounds.y1 - bounds.y0 : 16;
  // Wide BG regions (a full-width text band) would otherwise fill the whole strip.
  const scale = Math.max(1, Math.min(ctx.THUMB_SCALE, ctx.THUMB_MAX_W / Math.max(8, w), ctx.THUMB_MAX_H / Math.max(8, h)));
  thumb.width = Math.round(Math.max(8, w) * scale);
  thumb.height = Math.round(Math.max(8, h) * scale);
  const tctx = /** @type {CanvasRenderingContext2D} */ (thumb.getContext('2d'));
  tctx.imageSmoothingEnabled = false;
  // Follows the same Background toggle as the stage, so a thumbnail shows the sprite the way
  // the canvas does rather than always burying it in scenery.
  const showBackground = !!ctx.el('toggle-background')?.checked;
  tctx.fillStyle = ctx.stageBackgroundColor();
  tctx.fillRect(0, 0, thumb.width, thumb.height);
  if (!bounds || view.frameIndex < 0) return;
  if (showBackground && ctx.composeFrame(view.frameIndex)) {
    tctx.drawImage(ctx.frameCanvas, bounds.x0, bounds.y0, w, h, 0, 0, thumb.width, thumb.height);
  }
  if (ctx.composePoseLayer(view)) {
    tctx.drawImage(ctx.poseCanvas, bounds.x0, bounds.y0, w, h, 0, 0, thumb.width, thumb.height);
  }
}

export function setPoseIndex(i, { keepTrackFrame = false, mirror = false } = {}) {
  if (!ctx.poseViews.length) return;
  const paintingKey = overpaintMode() ? artTarget()?.id : null;
  ctx.poseIndex = ((i % ctx.poseViews.length) + ctx.poseViews.length) % ctx.poseViews.length;
  followPictureToCard(paintingKey);
  ctx.stageMirror = mirror;
  if (!keepTrackFrame) ctx.trackFrame = 0;
  ctx.el('pose-scrub').value = String(ctx.poseIndex);
  ctx.el('pose-counter').textContent = `${ctx.poseIndex + 1} / ${ctx.poseViews.length}`;
  refreshActiveReference();
  for (const card of document.querySelectorAll('.pose-card')) {
    card.classList.toggle('active', Number(card.dataset.poseIndex) === ctx.poseIndex);
  }
  syncPaintOnUi(); // the badge names the picture this card paints
  ctx.drawStage();
  ctx.renderDetail();
}

/**
 * Painting overpaint and moving to another card: the picture strokes go to follows the card (a
 * pose's own picture, or the group's). Say so when it changes; with none here, back to tiles.
 * @param {string | null} paintingKey the picture strokes went to before the move
 */
function followPictureToCard(paintingKey) {
  if (!paintingKey) return;
  const now = artTarget();
  if (now?.id === paintingKey) return;
  if (!selectedArt() && posePictureCanStart()) {
    ctx.setStatus('This pose has no overpaint yet: your first stroke starts one, shown only on this pose.');
  } else if (!selectedArt()) {
    resetPaintOn('tiles');
    ctx.setStatus('This pose has no overpaint of its own (and the group has none): back to tile paint. Overpaint just this pose starts one.');
  } else {
    ctx.setStatus(now?.posePictureId ? 'Strokes now go to this pose’s own overpaint.' : 'This pose has no overpaint of its own: strokes now go to the group’s overpaint, which shows on every pose.');
  }
  syncPaintOnUi();
}
