/**
 * Durable source frames for poses.
 *
 * A pose records the registry frame it was captured on (`sourceFrameId`) so SpriteStudio can
 * show it. The live "Current" frame that Colorize! hands over has no registry row, and the next
 * Colorize! replaces it — so a pose captured there used to be saved with no source at all, and
 * went blank in SpriteStudio unless some saved frame happened to show the same pose.
 *
 * On save, the Project tool gives each such pose a real frame: a saved frame that shows all of
 * it, or else the Current frame itself, promoted into `vipstates/` as an ordinary frame.
 */

/** Stands in for "the Current frame" until it is promoted and has a frame id. */
export const CURRENT_FRAME = Symbol('current-frame');

const EYES = [0, 1];
const WRAM_BYTES = 0x10000;

/** @param {any} group */
function posesOfGroup(group) {
  return Array.isArray(group?.poses) ? group.poses : [];
}

/** @param {any} pose */
function hasSource(pose) {
  return typeof pose?.sourceFrameId === 'string' && pose.sourceFrameId.trim() !== '';
}

/**
 * @param {any[]} groups
 * @returns {Array<{ groupId: string, poseId: string }>}
 */
export function posesMissingSource(groups) {
  const out = [];
  for (const g of groups || []) {
    for (const p of posesOfGroup(g)) {
      if (!hasSource(p) && p?.poseId) out.push({ groupId: g.id, poseId: p.poseId });
    }
  }
  return out;
}

/**
 * True when the frame shows every tile of the pose, on either eye. Partial matches do not
 * count: a source frame is where the pose is drawn, not where it resembles something.
 * @param {(state: any, pose: any, eye: number) => ({ matched: number } | null)} locate
 */
function showsWholePose(locate, state, pose) {
  const total = Array.isArray(pose?.tiles) ? pose.tiles.length : 0;
  if (!state || total === 0) return false;
  return EYES.some((eye) => locate(state, pose, eye)?.matched === total);
}

/**
 * Pick a source frame for every pose that lacks one. The Current frame is tried first — a
 * source-less pose was captured there — then saved frames in the order given. Saved frames
 * are only read (deserialized) while some pose is still unresolved.
 *
 * @param {{
 *   groups: any[],
 *   currentState: any,
 *   savedFrames: Iterable<{ frameId: string, getState: () => any, patterns?: Set<number> | null }>,
 *   locate: (state: any, pose: any, eye: number) => ({ matched: number } | null),
 * }} args
 * @returns {Map<string, Map<string, string | typeof CURRENT_FRAME>>} groupId → poseId → source
 */
export function findPoseSourceFrames({ groups, currentState, savedFrames, locate }) {
  /** @type {Map<string, Map<string, string | typeof CURRENT_FRAME>>} */
  const found = new Map();
  const assign = (groupId, poseId, source) => {
    if (!found.has(groupId)) found.set(groupId, new Map());
    found.get(groupId).set(poseId, source);
  };

  const byId = new Map((groups || []).map((g) => [g.id, g]));
  let pending = posesMissingSource(groups).map(({ groupId, poseId }) => ({
    groupId,
    poseId,
    pose: posesOfGroup(byId.get(groupId)).find((p) => p.poseId === poseId),
  }));

  pending = pending.filter(({ groupId, poseId, pose }) => {
    if (!showsWholePose(locate, currentState, pose)) return true;
    assign(groupId, poseId, CURRENT_FRAME);
    return false;
  });

  for (const frame of savedFrames || []) {
    if (pending.length === 0) break;
    // A frame's pattern list, when given, says no missing pose can be whole on it without decoding it.
    if (frame.patterns && !pending.some(({ pose }) => (pose?.tiles || []).every((t) => frame.patterns.has(t.hash >>> 0)))) continue;
    const state = frame.getState();
    if (!state) continue;
    pending = pending.filter(({ groupId, poseId, pose }) => {
      if (!showsWholePose(locate, state, pose)) return true;
      assign(groupId, poseId, frame.frameId);
      return false;
    });
  }
  return found;
}

/**
 * New groups with the found sources written onto their poses. Poses found on the Current frame
 * get `currentFrameId` — the id it was promoted under — and are left alone without one.
 * Groups and poses that do not change keep their identity.
 *
 * @param {any[]} groups
 * @param {Map<string, Map<string, string | typeof CURRENT_FRAME>>} found
 * @param {string|null} currentFrameId
 */
export function withPoseSourceFrames(groups, found, currentFrameId) {
  return (groups || []).map((g) => {
    const sources = found.get(g.id);
    if (!sources) return g;
    let changed = false;
    const poses = posesOfGroup(g).map((p) => {
      const source = sources.get(p.poseId);
      const frameId = source === CURRENT_FRAME ? currentFrameId : source;
      if (!frameId || hasSource(p)) return p;
      changed = true;
      return { ...p, sourceFrameId: frameId };
    });
    return changed ? { ...g, poses } : g;
  });
}

/** @param {ArrayBuffer|Uint8Array} src */
function copyBuffer(src) {
  const u8 = src instanceof Uint8Array ? src : new Uint8Array(src);
  const out = new ArrayBuffer(u8.byteLength);
  new Uint8Array(out).set(u8);
  return out;
}

/**
 * The files and registry row that make the Current frame an ordinary saved frame, laid out
 * exactly like a Capture Frame from the emulator. The save state is the one Colorize! took
 * with this frame; the WRAM (for memory fingerprints) comes out of that save state.
 *
 * @param {{ frameId: string, vipJson: string, saveState: ArrayBuffer|Uint8Array|null, wram: Uint8Array|null }} args
 */
/** Screen label given to a Colorize! frame saved for a pose: not a place in the game. */
export const PROMOTED_FRAME_STATE_NAME = 'Current (Colorize!)';

export function currentFramePromotion({ frameId, vipJson, saveState, wram }) {
  const stem = frameId;
  const hasState = !!saveState && saveState.byteLength > 0;
  const hasWram = !!wram && wram.byteLength >= WRAM_BYTES;
  return {
    vipFile: { name: `${stem}.json`, json: vipJson },
    saveStateFile: hasState ? { name: `${stem}.state`, buffer: copyBuffer(saveState) } : null,
    ramdumpFile: hasWram ? { name: `${stem}.wram.bin`, buffer: copyBuffer(wram.subarray(0, WRAM_BYTES)) } : null,
    registryEntry: {
      frameId,
      stateName: PROMOTED_FRAME_STATE_NAME,
      subStateName: '',
      note: 'Saved from the Colorize! frame because a pose was captured on it.',
      vipStateFile: `vipstates/${stem}.json`,
      screenshotFile: null,
      ramdumpFile: hasWram ? `ramdumps/${stem}.wram.bin` : null,
      saveStateFile: hasState ? `savestates/${stem}.state` : null,
      wramBytes: hasWram ? WRAM_BYTES : 0,
      wramCaptureOk: hasWram,
      ...(hasWram && { wramSource: 'savestate' }),
    },
  };
}
