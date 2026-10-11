import { getTileBytes, hashTile } from '../../src/vip-state.js';

/**
 * @param {{
 *   groups: Array<any>,
 *   currentState: any,
 *   setStatus: (msg: string) => void,
 *   setAnchorPickGroupId: (id: string|null) => void,
 *   drawSelectionOverlay: () => void,
 * }} deps
 * @param {string} groupId
 */
export function startAnchorPickForGroupAction(deps, groupId) {
  const { groups, currentState, setStatus, setAnchorPickGroupId, drawSelectionOverlay } = deps;
  const g = groups.find((x) => x.id === groupId);
  if (!g || !currentState?.drawList?.length) {
    setStatus('Load a frame and select a group first.');
    return;
  }
  setAnchorPickGroupId(groupId);
  setStatus(
    'Anchor pick: cyan outlines show this group’s draws — click one tile. Hash must appear only once in that VIP world+layer on this eye (Esc to cancel).',
  );
  drawSelectionOverlay();
}

/**
 * @param {{
 *   groups: Array<any>,
 *   currentState: any,
 *   selectedDrawFullIndices: Set<number>,
 *   normalizeGroup: (g: any) => any,
 *   markGroupsDirty: () => void,
 *   updateGroupsPanel: () => void,
 *   updateGroupDetail: (g: any|null) => void,
 *   render: () => void,
 *   setStatus: (msg: string) => void,
 * }} deps
 * @param {string} groupId
 * @returns {Array<any>}
 */
export function addSelectedHashesToGroupCriteriaAction(deps, groupId) {
  const {
    groups,
    currentState,
    selectedDrawFullIndices,
    normalizeGroup,
    markGroupsDirty,
    updateGroupsPanel,
    updateGroupDetail,
    render,
    setStatus,
  } = deps;
  const g = groups.find((x) => x.id === groupId);
  if (!g || !currentState?.patternTable) {
    setStatus('Load a frame first.');
    return groups;
  }
  if (selectedDrawFullIndices.size === 0) {
    window.alert('Select one or more tiles on the canvas, then click again to add their hashes to this group.');
    return groups;
  }
  const pt = currentState.patternTable;
  const curHashes = new Set((g.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  let added = 0;
  for (const fi of selectedDrawFullIndices) {
    const d = currentState.drawList[fi];
    if (!d) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex)) >>> 0;
    if (curHashes.has(h)) continue;
    curHashes.add(h);
    added++;
  }
  if (!added) {
    setStatus('Selected tiles already exist in this group’s criteria hashes.');
    return groups;
  }
  const nextHashes = [...curHashes];
  const win = Array.isArray(g.criteria?.windowIds) ? [...g.criteria.windowIds] : [];
  const layers = Array.isArray(g.criteria?.layers) ? [...g.criteria.layers] : [];
  const nextGroups = groups.map((x) =>
    x.id !== groupId
      ? x
      : normalizeGroup(
          /** @type {any} */ ({
            ...x,
            criteria: { windowIds: win, hashes: nextHashes, layers },
          }),
        ),
  );
  markGroupsDirty();
  const gn = nextGroups.find((x) => x.id === groupId);
  updateGroupsPanel();
  if (gn) updateGroupDetail(gn);
  render();
  setStatus(`Added ${added} hash(es) to group criteria (${nextHashes.length} total). Save .vbpack to persist.`);
  return nextGroups;
}

/**
 * @param {{
 *   groups: Array<any>,
 *   currentState: any,
 *   selectedDrawFullIndices: Set<number>,
 *   normalizeGroup: (g: any) => any,
 *   markGroupsDirty: () => void,
 *   updateGroupsPanel: () => void,
 *   updateGroupDetail: (g: any|null) => void,
 *   render: () => void,
 *   setStatus: (msg: string) => void,
 * }} deps
 * @param {string} groupId
 * @returns {Array<any>}
 */
export function removeSelectedHashesFromGroupCriteriaAction(deps, groupId) {
  const {
    groups,
    currentState,
    selectedDrawFullIndices,
    normalizeGroup,
    markGroupsDirty,
    updateGroupsPanel,
    updateGroupDetail,
    render,
    setStatus,
  } = deps;
  const g = groups.find((x) => x.id === groupId);
  if (!g || !currentState?.patternTable) {
    setStatus('Load a frame first.');
    return groups;
  }
  if (selectedDrawFullIndices.size === 0) {
    window.alert('Select one or more tiles on the canvas, then click again to remove their hashes from this group.');
    return groups;
  }
  const pt = currentState.patternTable;
  const curHashes = new Set((g.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  if (!curHashes.size) {
    setStatus('This group has no hashes in criteria.');
    return groups;
  }
  let removed = 0;
  /** What the selection actually holds, so a failure can name it rather than just refuse. */
  const selectedHashes = new Set();
  for (const fi of selectedDrawFullIndices) {
    const d = currentState.drawList[fi];
    if (!d) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex)) >>> 0;
    selectedHashes.add(h);
    if (curHashes.has(h)) {
      curHashes.delete(h);
      removed++;
    }
  }
  if (!removed) {
    const hex = (h) => `#${h.toString(16).toUpperCase()}`;
    const list = [...selectedHashes].slice(0, 6).map(hex).join(', ');
    const more = selectedHashes.size > 6 ? ` (+${selectedHashes.size - 6} more)` : '';
    window.alert(
      `Nothing removed. The ${selectedDrawFullIndices.size} selected tile(s) use pattern(s) ${list}${more}, `
        + `and this group's criteria holds ${curHashes.size} other pattern(s).\n\n`
        + 'Cyan outlines mark every draw of a pattern this group owns — including copies under other sprites, '
        + 'because membership is by pattern, not screen position. Select one of those outlined tiles to remove its pattern.',
    );
    return groups;
  }
  const nextHashes = [...curHashes];
  if (nextHashes.length === 0) {
    const ok = window.confirm(
      'This will leave criteria.hashes empty — the group may match every draw in its worlds/layers. Continue?',
    );
    if (!ok) return groups;
  }
  const win = Array.isArray(g.criteria?.windowIds) ? [...g.criteria.windowIds] : [];
  const layers = Array.isArray(g.criteria?.layers) ? [...g.criteria.layers] : [];
  const nextGroups = groups.map((x) => {
    if (x.id !== groupId) return x;
    /** @type {any} */
    const raw = {
      ...x,
      criteria: { windowIds: win, hashes: nextHashes, layers },
    };
    if (typeof x.anchorHash === 'number' && Number.isFinite(x.anchorHash) && !nextHashes.includes(x.anchorHash >>> 0)) {
      delete raw.anchorHash;
    }
    return normalizeGroup(raw);
  });
  markGroupsDirty();
  const gn = nextGroups.find((x) => x.id === groupId);
  updateGroupsPanel();
  if (gn) updateGroupDetail(gn);
  render();
  setStatus(`Removed ${removed} hash(es) from group criteria (${nextHashes.length} left). Save .vbpack to persist.`);
  return nextGroups;
}
