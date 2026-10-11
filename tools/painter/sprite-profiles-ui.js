/**
 * Painter v2 UI for poses: capture them from a tile selection and manage a group's poses in the
 * inspector. Sprite groups get sprite poses; background groups may keep BG or affine poses too.
 * See docs/design/obj-sprite-profiles-design.md §3–§4, §6.
 */
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import {
  LEGACY_POSE_ID,
  addPoseToGroup,
  buildPoseFromCapture,
  chooseAnchorIndex,
  countAnchorTiles,
  findAnchorAmbiguity,
  getEffectivePoses,
  isObjGroup,
  isPoseMacroEligible,
  nextPoseId,
  normalizePose,
  reanchorPose,
  removePoseFromGroup,
  patternsOnlyInPose,
  withoutPatterns,
  suggestProfileIdForHashes,
  updatePose,
} from '../../src/obj-sprite-profiles.js';
import { filterGroups, orderByRecent } from '../../src/group-search.js';
import { folderOf } from '../../src/group-folders.js';
import { recentGroupIds } from '../shared/recent-groups.js';

const OBJ_LAYER = 2;
const AFFINE_LAYER = 1;
const NEW_GROUP_VALUE = '__new_sprite_group__';

/**
 * What a selection captures: sprite (OBJ) tiles become a sprite pose; failing that, scaled
 * (affine) tiles become an affine pose (just the patterns shown); else background tiles become a
 * BG pose (positions kept, like a sprite's).
 * @typedef {'obj'|'affine'|'bg'} CaptureKind
 */

/** Wording per capture kind for the dialog and its status lines. */
const KIND_TEXT = {
  obj: {
    title: 'New sprite pose from selection',
    target: 'Add to sprite group',
    newOption: '+ New sprite group…',
    newName: 'New sprite group name',
    tiles: 'sprite',
    help: 'Only <strong>sprite (OBJ)</strong> tiles on the current eye are captured. Positions are stored relative to the <strong>anchor</strong> (the frontmost selected tile whose pattern appears only once in the pose), so the pose can be found wherever the sprite moves. Change the anchor later from the inspector.',
  },
  bg: {
    title: 'New background pose from selection',
    target: 'Add to background group',
    newOption: '+ New background group…',
    newName: 'New background group name',
    tiles: 'background',
    help: 'The selected <strong>background</strong> tiles on the current eye are captured with their positions, like a sprite pose. SpriteStudio shows a group’s poses as its cards, so pick the frames you want to paint the group on.',
  },
  affine: {
    title: 'New scaled (affine) pose from selection',
    target: 'Add to background group',
    newOption: '+ New background group…',
    newName: 'New background group name',
    tiles: 'scaled (affine)',
    help: 'A scaled layer has no fixed tile positions, so the pose keeps the <strong>patterns</strong> the selection shows and the frame it was taken on. SpriteStudio draws it through the game’s scaling.',
  },
};

/**
 * @typedef {Object} CaptureDeps
 * @property {any} currentState
 * @property {Set<number>} selectedDrawFullIndices
 * @property {number} eye
 * @property {(d: any) => number} drawEye
 * @property {number|null} topFullIndex
 */

/**
 * @typedef {Object} PoseCapture
 * @property {CaptureKind} kind
 * @property {Array<{ hash: number, x: number, y: number, flipH: boolean, flipV: boolean }>} draws
 * @property {number} anchorIndex
 * @property {number[]} windowIds
 * @property {number} skipped - Selected draws ignored (other eye or another kind of tile).
 */

/** @type {PoseCapture|null} */
let pendingCapture = null;

/**
 * The group picker's list: the groups a capture can go to, most recently used first, and the
 * filter box over it (src/group-search.js). `autoName` is the new-group name the filter filled in.
 */
const picker = { candidates: /** @type {any[]} */ ([]), newOption: '', escapeHtml: (/** @type {string} */ s) => s, autoName: '' };

/**
 * Fill the list with the groups matching `query`, keeping `keep` selected when it is still shown.
 * No match selects the new-group entry, named after what was typed.
 * @param {string} query @param {string} keep
 */
function fillTargetOptions(query, keep) {
  const target = /** @type {HTMLSelectElement|null} */ (el('new-pose-target'));
  if (!target) return;
  const esc = picker.escapeHtml;
  const shown = filterGroups(picker.candidates, query);
  const typed = query.trim();
  const newLabel = typed && !shown.length ? `+ New group “${esc(typed)}”` : picker.newOption;
  target.innerHTML = [
    ...shown.map((g) => {
      const folder = folderOf(g);
      return `<option value="${esc(g.id)}">${esc(g.name || g.id)}${folder ? ` · ${esc(folder)}` : ''}</option>`;
    }),
    `<option value="${NEW_GROUP_VALUE}">${newLabel}</option>`,
  ].join('');
  // A group still shown stays picked. Typing otherwise picks the first match (so Enter adds to
  // what was typed), or the new-group entry when nothing matches; with no text, the new-group entry
  // stays picked if it was.
  const kept = shown.some((g) => g.id === keep) ? keep : null;
  target.value = kept ?? (!typed && keep === NEW_GROUP_VALUE ? NEW_GROUP_VALUE : shown[0]?.id ?? NEW_GROUP_VALUE);
  // A new group gets the typed name, unless one was written by hand.
  const groupName = /** @type {HTMLInputElement|null} */ (el('new-pose-group-name'));
  if (groupName && (groupName.value === '' || groupName.value === picker.autoName)) {
    picker.autoName = target.value === NEW_GROUP_VALUE ? typed : '';
    groupName.value = picker.autoName;
  }
  syncNewGroupNameRow();
}

/** @param {any} d */
function captureKindOf(d) {
  const layer = Number(d.layer);
  return layer === OBJ_LAYER ? 'obj' : layer === AFFINE_LAYER ? 'affine' : 'bg';
}

/**
 * @param {CaptureDeps} deps
 * @returns {PoseCapture|null}
 */
function collectPoseCapture({ currentState, selectedDrawFullIndices, eye, drawEye, topFullIndex }) {
  const pt = currentState?.patternTable;
  if (!pt || !currentState.drawList) return null;
  const onEye = [...selectedDrawFullIndices].filter((fi) => {
    const d = currentState.drawList[fi];
    return d && drawEye(d) === eye;
  });
  const kinds = new Set(onEye.map((fi) => captureKindOf(currentState.drawList[fi])));
  /** @type {CaptureKind} */
  const kind = kinds.has('obj') ? 'obj' : kinds.has('affine') ? 'affine' : 'bg';
  const draws = [];
  const worlds = new Set();
  let anchorIndex = 0;
  for (const fi of onEye) {
    const d = currentState.drawList[fi];
    if (captureKindOf(d) !== kind) continue;
    if (fi === topFullIndex) anchorIndex = draws.length;
    draws.push({
      hash: hashTile(getTileBytes(pt, d.tileIndex)) >>> 0,
      x: d.x,
      y: d.y,
      flipH: d.flipH === true,
      flipV: d.flipV === true,
    });
    if (Number.isFinite(d.world)) worlds.add(Number(d.world));
  }
  return {
    kind,
    draws,
    anchorIndex: chooseAnchorIndex(draws, anchorIndex),
    windowIds: [...worlds],
    skipped: selectedDrawFullIndices.size - draws.length,
  };
}

/** Groups a capture of this kind can go to: sprite groups for sprite tiles, the rest otherwise. */
function groupsForKind(groups, kind) {
  return groups.filter((g) => isObjGroup(g) === (kind === 'obj'));
}

/** @param {string} id */
function el(id) {
  return document.getElementById(id);
}

function syncNewGroupNameRow() {
  const target = /** @type {HTMLSelectElement|null} */ (el('new-pose-target'));
  const row = el('new-pose-group-name-row');
  if (target && row) row.hidden = target.value !== NEW_GROUP_VALUE;
}

/** @param {CaptureKind} kind */
function setDialogText(kind) {
  const text = KIND_TEXT[kind];
  const set = (id, value, html = false) => {
    const node = el(id);
    if (node) node[html ? 'innerHTML' : 'textContent'] = value;
  };
  set('new-pose-dialog-title', text.title);
  set('new-pose-target-label', text.target);
  set('new-pose-group-name-label', text.newName);
  set('new-pose-help', text.help, true);
}

/**
 * @param {CaptureDeps & {
 *   groups: any[],
 *   selectedGroupId: string|null,
 *   setStatus: (msg: string) => void,
 *   escapeHtml: (s: string) => string,
 * }} deps
 */
export function openNewPoseDialog(deps) {
  const dialog = /** @type {HTMLDialogElement|null} */ (el('new-pose-dialog'));
  const target = /** @type {HTMLSelectElement|null} */ (el('new-pose-target'));
  if (!dialog || !target) return;
  const capture = collectPoseCapture(deps);
  if (!capture || capture.draws.length === 0) {
    deps.setStatus('Select one or more tiles on this eye, then try New pose from selection again.');
    return;
  }
  pendingCapture = capture;
  const text = KIND_TEXT[capture.kind];
  setDialogText(capture.kind);

  // Most recently used groups first (tools/shared/recent-groups.js), then the rest by name.
  const candidates = orderByRecent(groupsForKind(deps.groups, capture.kind), recentGroupIds());
  const selected = candidates.find((g) => g.id === deps.selectedGroupId);
  const hashes = capture.draws.map((d) => d.hash);
  const suggestedId =
    selected?.id ?? suggestProfileIdForHashes(candidates, hashes, () => true) ?? NEW_GROUP_VALUE;
  Object.assign(picker, { candidates, newOption: text.newOption, escapeHtml: deps.escapeHtml, autoName: '' });
  const filter = /** @type {HTMLInputElement|null} */ (el('new-pose-target-filter'));
  if (filter) filter.value = '';
  const nameBox = /** @type {HTMLInputElement|null} */ (el('new-pose-group-name'));
  if (nameBox) nameBox.value = '';
  fillTargetOptions('', suggestedId);

  const summary = el('new-pose-summary');
  if (summary) {
    const skippedNote = capture.skipped
      ? ` <span class="muted">(${capture.skipped} other-eye or other-kind tile(s) ignored)</span>`
      : '';
    const anchorNote =
      capture.kind === 'affine'
        ? ` ${new Set(hashes).size} pattern(s).`
        : ' Anchor: frontmost selected tile with a unique pattern.';
    summary.innerHTML = `<strong>${capture.draws.length}</strong> ${text.tiles} tile(s) captured.${anchorNote}${skippedNote}`;
  }
  const warning = el('new-pose-warning');
  if (warning) {
    // Only a sprite can be cut off by the screen edge; a background runs past it by design.
    const preview =
      capture.kind === 'obj' ? buildPoseFromCapture({ poseId: 'preview', draws: capture.draws, anchorIndex: capture.anchorIndex }) : null;
    warning.hidden = !preview?.clippedAtCapture;
    warning.textContent =
      'This sprite touches the screen edge, so some tiles may be missing. You can still add it; capture again once it is fully on screen if it looks incomplete.';
  }
  const poseName = /** @type {HTMLInputElement|null} */ (el('new-pose-name'));
  const groupName = /** @type {HTMLInputElement|null} */ (el('new-pose-group-name'));
  if (poseName) poseName.value = '';
  if (groupName) groupName.value = '';
  dialog.showModal();
  // Typing finds the group; with none to pick from, name the new one.
  queueMicrotask(() => (candidates.length ? filter : groupName)?.focus());
}

/**
 * The pose a capture makes. A BG pose is a sprite pose that is never "clipped"; an affine pose is
 * the set of patterns shown.
 * @param {PoseCapture} capture
 * @param {{ poseId: string, name: string, sourceFrameId?: string }} meta
 */
function poseFromCapture(capture, meta) {
  if (capture.kind === 'affine') {
    const tiles = [...new Set(capture.draws.map((d) => d.hash))].map((hash) => ({ hash }));
    return normalizePose({ ...meta, tiles, affine: true });
  }
  const pose = buildPoseFromCapture({ ...meta, draws: capture.draws, anchorIndex: capture.anchorIndex });
  return pose && capture.kind === 'bg' ? { ...pose, clippedAtCapture: false } : pose;
}

/**
 * @param {{
 *   groups: any[],
 *   sourceFrameId: string|null,
 *   normalizeGroup: (g: any) => any,
 *   createSpriteGroup: (name: string, windowIds: number[]) => any,
 *   createBgGroup: (name: string, windowIds: number[]) => any,
 * }} deps
 * @returns {{ groups: any[], group: any, pose: any } | { error: string, focusId: string } | null}
 */
export function submitNewPoseDialog(deps) {
  const target = /** @type {HTMLSelectElement|null} */ (el('new-pose-target'));
  const poseName = /** @type {HTMLInputElement|null} */ (el('new-pose-name'));
  const groupName = /** @type {HTMLInputElement|null} */ (el('new-pose-group-name'));
  if (!pendingCapture || !target) return null;

  const { kind } = pendingCapture;
  const isNew = target.value === NEW_GROUP_VALUE;
  const newName = groupName?.value.trim() ?? '';
  if (isNew && !newName) return { error: `Name the new ${kind === 'obj' ? 'sprite' : 'background'} group.`, focusId: 'new-pose-group-name' };
  const worlds = [...pendingCapture.windowIds].sort((a, b) => a - b);
  const create = kind === 'obj' ? deps.createSpriteGroup : deps.createBgGroup;
  const base = isNew ? create(newName, worlds) : deps.groups.find((g) => g.id === target.value);
  if (!base) return null;

  const count = Array.isArray(base.poses) ? base.poses.length : 0;
  const pose = poseFromCapture(pendingCapture, {
    poseId: nextPoseId(base),
    name: poseName?.value.trim() || `Pose ${count + 1}`,
    ...(deps.sourceFrameId && { sourceFrameId: deps.sourceFrameId }),
  });
  if (!pose) return null;
  const group = deps.normalizeGroup(addPoseToGroup(base, pose, { windowIds: pendingCapture.windowIds }));
  const groups = isNew ? [...deps.groups, group] : deps.groups.map((g) => (g.id === group.id ? group : g));
  pendingCapture = null;
  return { groups, group, pose };
}

/** @param {{ onSubmit: () => void }} handlers */
export function bindNewPoseDialogEvents({ onSubmit }) {
  el('new-pose-target')?.addEventListener('change', syncNewGroupNameRow);
  const target = /** @type {HTMLSelectElement|null} */ (el('new-pose-target'));
  const filter = /** @type {HTMLInputElement|null} */ (el('new-pose-target-filter'));
  // The filter box: every keystroke narrows the list; ↑/↓ move through it; Enter adds the pose to
  // the highlighted group (the form's submit); Esc clears the text before it closes the dialog.
  filter?.addEventListener('input', () => fillTargetOptions(filter.value, target?.value || ''));
  filter?.addEventListener('keydown', (e) => {
    if (!target) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = target.options.length;
      if (!n) return;
      const i = target.selectedIndex < 0 ? 0 : target.selectedIndex + (e.key === 'ArrowDown' ? 1 : -1);
      target.selectedIndex = Math.max(0, Math.min(n - 1, i));
      syncNewGroupNameRow();
    } else if (e.key === 'Escape' && filter.value) {
      e.preventDefault();
      filter.value = '';
      fillTargetOptions('', target.value);
    }
  });
  // Double-clicking a group adds the pose to it.
  target?.addEventListener('dblclick', () => {
    /** @type {HTMLFormElement|null} */ (el('new-pose-form'))?.requestSubmit();
  });
  el('new-pose-cancel')?.addEventListener('click', () => {
    pendingCapture = null;
    /** @type {HTMLDialogElement|null} */ (el('new-pose-dialog'))?.close();
  });
  el('new-pose-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit();
  });
}

/**
 * @param {any} pose
 * @param {any} group
 * @param {(s: string) => string} escapeHtml
 */
function renderPoseRow(pose, group, escapeHtml) {
  const sprite = isObjGroup(group);
  const ambiguous = sprite ? findAnchorAmbiguity(group, pose.poseId) : [];
  const notes = [];
  if (sprite && !isPoseMacroEligible(pose)) notes.push('No anchor at (0,0) — renders per tile.');
  const anchorCopies = countAnchorTiles(pose);
  if (anchorCopies > 1) {
    notes.push(`Anchor pattern appears ${anchorCopies} times in this pose — use Set anchor on a tile that appears once.`);
  }
  if (pose.clippedAtCapture) notes.push('Captured at the screen edge — tiles may be missing.');
  if (ambiguous.length) {
    notes.push(`Anchor tile also appears in: ${ambiguous.map((p) => escapeHtml(p.name)).join(', ')}.`);
  }
  const anchor = typeof pose.anchorHash === 'number' ? `#${pose.anchorHash.toString(16).toUpperCase()}` : '—';
  const detail = pose.affine ? `${pose.tiles.length} pattern(s) · scaled` : `${pose.tiles.length} tile(s) · anchor ${anchor}`;
  const anchorButton = pose.affine
    ? ''
    : `<button type="button" class="btn-ghost" data-pose-action="anchor" title="Select exactly one tile of this pose on the canvas, then click to make it the anchor">Set anchor</button>`;
  const mirror = sprite
    ? `<label class="pose-mirror" title="Allow drawing this pose mirrored when the game flips the sprite. Turn off for art that is not a true mirror image."><input type="checkbox" data-pose-action="mirror" ${pose.allowFlipMacro ? 'checked' : ''} /> Mirror OK</label>`
    : '';
  return `
    <li class="pose-row" data-pose-id="${escapeHtml(pose.poseId)}">
      <div class="pose-row-main">
        <span class="pose-name">${escapeHtml(pose.name)}</span>
        <span class="muted">${detail}</span>
      </div>
      ${notes.map((n) => `<div class="pose-note">${n}</div>`).join('')}
      <div class="pose-row-actions">
        <button type="button" class="btn-ghost" data-pose-action="select" title="Select this pose's tiles on the current frame (by pattern hash, so copies are included)">Select</button>
        ${anchorButton}
        <button type="button" class="btn-ghost" data-pose-action="rename">Rename</button>
        ${mirror}
        <button type="button" class="btn-ghost pose-delete" data-pose-action="delete">Delete</button>
      </div>
    </li>`;
}

/**
 * Inspector section listing a group's poses. A background group without poses gets none: its
 * cards in SpriteStudio come from the captured frames until it keeps some.
 * @param {any} group
 * @param {(s: string) => string} escapeHtml
 * @returns {string}
 */
export function renderPoseSectionHtml(group, escapeHtml) {
  const sprite = isObjGroup(group);
  if (!sprite && !(Array.isArray(group?.poses) && group.poses.length)) return '';
  const poses = getEffectivePoses(group);
  const explicit = poses.filter((p) => p.poseId !== LEGACY_POSE_ID);
  const legacyNote = poses.length && !explicit.length ? ` — this sprite group's ${poses[0].tiles.length} tile hash(es) paint per tile` : '';
  const body = explicit.length
    ? `<ul class="pose-list">${explicit.map((p) => renderPoseRow(p, group, escapeHtml)).join('')}</ul>`
    : `<div class="muted pose-empty">No poses yet${legacyNote}. Select the sprite on the canvas and use <strong>New pose from selection…</strong> to capture one.</div>`;
  return `
    <div class="pose-section" id="group-pose-section">
      <div class="pose-section-head"><strong>${sprite ? 'Sprite poses' : 'Poses'}</strong> <span class="muted">${explicit.length}</span></div>
      ${body}
    </div>`;
}

/**
 * @param {{
 *   group: any,
 *   poseId: string,
 *   action: string,
 *   checked: boolean,
 *   currentState: any,
 *   selectedDrawFullIndices: Set<number>,
 *   eye: number,
 *   drawEye: (d: any) => number,
 * }} ctx
 * @returns {{ group?: any, selectIndices?: number[], dropPatterns?: number[], message: string }}
 *   `dropPatterns`: patterns that left the group; their shared paint is the caller's to clear
 */
export function applyPoseAction(ctx) {
  const { group, poseId, action } = ctx;
  const pose = (group.poses || []).find((p) => p.poseId === poseId);
  if (!pose) return { message: 'That pose no longer exists.' };
  const pt = ctx.currentState?.patternTable;

  if (action === 'select') {
    if (!pt) return { message: 'Load a frame first.' };
    const hashes = new Set(pose.tiles.map((t) => t.hash));
    const layer = isObjGroup(group) ? OBJ_LAYER : pose.affine ? AFFINE_LAYER : 0;
    const selectIndices = [];
    ctx.currentState.drawList.forEach((d, fi) => {
      if (!d || ctx.drawEye(d) !== ctx.eye || Number(d.layer) !== layer) return;
      if (hashes.has(hashTile(getTileBytes(pt, d.tileIndex)) >>> 0)) selectIndices.push(fi);
    });
    return { selectIndices, message: `Selected ${selectIndices.length} draw(s) matching pose “${pose.name}”.` };
  }

  if (action === 'anchor') {
    if (!pt || ctx.selectedDrawFullIndices.size !== 1) {
      return { message: 'Select exactly one tile of this pose on the canvas, then click Set anchor.' };
    }
    const [fi] = [...ctx.selectedDrawFullIndices];
    const hash = hashTile(getTileBytes(pt, ctx.currentState.drawList[fi].tileIndex)) >>> 0;
    const matches = pose.tiles.flatMap((t, i) => (t.hash === hash ? [i] : []));
    if (matches.length === 0) return { message: 'That tile is not part of this pose.' };
    if (matches.length > 1) {
      return {
        message: `That tile's pattern appears ${matches.length} times in this pose, so it can't be a reliable anchor. Pick a tile whose pattern appears only once.`,
      };
    }
    const next = reanchorPose(pose, matches[0]);
    if (!next) return { message: 'This pose has no tile offsets to re-anchor; capture it again.' };
    return {
      group: { ...group, poses: group.poses.map((p) => (p.poseId === poseId ? next : p)) },
      message: `Anchor for “${pose.name}” set to #${hash.toString(16).toUpperCase()}. Save .vbpack to persist.`,
    };
  }

  if (action === 'rename') {
    const name = window.prompt('Pose name', pose.name);
    if (name == null || !name.trim() || name.trim() === pose.name) return { message: '' };
    return { group: updatePose(group, poseId, { name }), message: `Renamed pose to “${name.trim()}”.` };
  }

  if (action === 'mirror') {
    return {
      group: updatePose(group, poseId, { allowFlipMacro: ctx.checked }),
      message: `“${pose.name}” ${ctx.checked ? 'may' : 'will not'} be drawn mirrored.`,
    };
  }

  if (action === 'delete') {
    // Tiles only this pose used leave the group with it, with their paint: left behind they would
    // keep painting wherever the game shows them. (Its last pose takes nothing: the group falls
    // back to its tile list.)
    const only = patternsOnlyInPose(group, poseId);
    const note = only.length
      ? ` Its ${only.length} tile pattern${only.length === 1 ? '' : 's'} no other pose uses leave the group, with their paint.`
      : ' Its tile hashes stay in the group.';
    if (!window.confirm(`Delete pose “${pose.name}”?${note}`)) return { message: '' };
    return {
      group: withoutPatterns(removePoseFromGroup(group, poseId), only),
      dropPatterns: only,
      message: `Deleted pose “${pose.name}”${only.length ? ` and ${only.length} tile pattern(s) only it used` : ''}.`,
    };
  }

  return { message: '' };
}

/**
 * @param {(poseId: string, action: string, checked: boolean) => void} onAction
 */
export function bindPoseSectionEvents(onAction) {
  const section = el('group-pose-section');
  if (!section) return;
  const dispatch = (/** @type {Event} */ e) => {
    const t = /** @type {HTMLInputElement|null} */ (e.target);
    const action = t?.dataset?.poseAction;
    const row = /** @type {HTMLElement|null} */ (t?.closest?.('[data-pose-id]') ?? null);
    if (!action || !row) return;
    const isToggle = action === 'mirror';
    if ((e.type === 'change') !== isToggle) return;
    onAction(row.dataset.poseId || '', action, t.checked === true);
  };
  section.addEventListener('click', dispatch);
  section.addEventListener('change', dispatch);
}
