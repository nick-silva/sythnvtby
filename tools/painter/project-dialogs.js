/**
 * The Project tool's project dialogs: Check project (the health list, its examples and fixes),
 * Project storage, and Game states (questions answered from recorded frames). Split out of tools/painter.js, which passes in the state and functions it shares
 * (initProjectDialogs).
 */
import { createHealthScan } from '../../src/project-health.js';
import { renderHealthList } from './health-panel.js';
import { groupsForScreen } from '../../src/screen-gate.js';
import { projectGameStates, groupConditionsOf, withoutGameState } from '../../src/game-states.js';
import { decodeRecording, encodeRecording, questionsOf, recordingsOf, newQuestion, analyseQuestion, gameStatesFromQuestion } from '../../src/memory-questions.js';
import { renderGameStatesPanel } from './game-states-panel.js';
import { storageBreakdown, recordingsByQuestion, withoutRecordings } from '../../src/project-storage.js';
import { renderStoragePanel } from './storage-panel.js';
import { normalizeGroup } from '../../src/group-schema.js';
import { runMemoryAnalysisOnLoadedPack, wramForFrameIndex } from './frame-data.js';
import { matchedScreensForFrame, recognisableScreens, setGameStates } from './screens-ui.js';
import { formatByteSize } from './paint-inventory-ui.js';
import { HEALTH_DELAY_MS, HEALTH_FRAMES_PER_STEP, frameStatesByIndex, reorderGroup, setGroupWorlds, updateGroupDetail } from './group-detail.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initProjectDialogs(context) {
  ctx = context;
}

let healthTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
let healthRun = 0;
/** The run going through the frames now, if any (0: none). */
let healthRunning = 0;
export const healthDialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('health-dialog'));

export function scheduleHealthCheck(delay = HEALTH_DELAY_MS) {
  clearTimeout(healthTimer);
  healthTimer = setTimeout(() => void runHealthCheck(), delay);
  // What is listed is from before the change until the check runs again.
  if (!ctx.health.checking) {
    ctx.health = { ...ctx.health, checking: true };
    syncHealthUi();
  }
}

async function runHealthCheck() {
  clearTimeout(healthTimer);
  const run = ++healthRun;
  if (!ctx.loadedPackParts || !ctx.availableFrames.length) {
    ctx.health = { issues: null, frames: 0, checking: false };
    syncHealthUi();
    return;
  }
  ctx.health = { ...ctx.health, checking: true };
  healthRunning = run;
  syncHealthUi();
  const projectGroups = ctx.groups;
  const scan = createHealthScan({ groups: projectGroups, pack: ctx.pack });
  const states = frameStatesByIndex();
  let frames = 0;
  for (let i = 0; i < states.length; i++) {
    if (states[i]) {
      const screens = recognisableScreens().length ? matchedScreensForFrame(i) : null;
      scan.addFrame(i, states[i], groupsForScreen(projectGroups, ctx.gameStatePools, wramForFrameIndex(i)), screens);
      frames++;
    }
    if (i % HEALTH_FRAMES_PER_STEP === HEALTH_FRAMES_PER_STEP - 1) {
      await new Promise((r) => setTimeout(r, 0));
      if (run !== healthRun) return;
    }
  }
  if (run !== healthRun) return;
  healthRunning = 0;
  ctx.health = { issues: scan.issues(), frames, checking: false };
  syncHealthUi();
}

export function syncHealthUi() {
  const n = ctx.health.issues ? ctx.health.issues.filter((i) => i.problem).length : 0;
  const btn = document.getElementById('btn-health-count');
  if (btn) {
    btn.hidden = !n;
    btn.textContent = `${n} to check`;
  }
  const item = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-check-project'));
  if (item) item.disabled = !ctx.loadedPackParts;
  const box = document.getElementById('health-list');
  if (box && healthDialog?.open) renderHealthList(box, ctx.health, { onFix: applyHealthFix, onShow: showHealthExample });
}

export function openHealthDialog() {
  if (!healthDialog) return;
  if (!healthDialog.open) healthDialog.showModal();
  syncHealthUi();
  // Not checked yet, or a check waiting for changes to settle: run it now.
  if ((!ctx.health.issues || ctx.health.checking) && !healthRunning) void runHealthCheck();
}

/** "Show me": the example frame, with This pixel explaining the spot. */
function showHealthExample(issue) {
  const ex = issue.example;
  if (healthDialog?.open) healthDialog.close();
  if (!ex || !ctx.frameSelect || !ctx.availableFrames[ex.frameIndex]) return;
  if (ctx.frameSelect.value !== String(ex.frameIndex)) {
    ctx.frameSelect.value = String(ex.frameIndex);
    ctx.frameSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  ctx.inspectPoint = { x: ex.x, y: ex.y };
  ctx.explainInspectPoint();
  document.getElementById('inspector-answer')?.scrollIntoView({ block: 'nearest' });
  ctx.setStatus(`${ctx.availableFrames[ex.frameIndex].label}: This pixel says what happens at the spot.`);
}

/** @param {import('../../src/project-health.js').HealthIssue} issue */
function applyHealthFix(issue) {
  const fix = issue.fix;
  if (fix.kind === 'analyze-memory') {
    healthDialog?.close();
    void runMemoryAnalysisOnLoadedPack();
    return;
  }
  if (fix.kind === 'new-question') {
    healthDialog?.close();
    askQuestion(fix.name, fix.sides);
    return;
  }
  const g = ctx.groups.find((x) => x.id === fix.groupId);
  if (!g) return;
  if (fix.kind === 'select-group') {
    showHealthExample(issue);
    const point = ctx.inspectPoint;
    ctx.selectGroupFromTree(g);
    ctx.inspectPoint = point;
    ctx.explainInspectPoint();
    return;
  }
  if (fix.kind === 'add-world') {
    setGroupWorlds(g.id, [...(g.criteria?.windowIds || []).map(Number), fix.world]);
  } else if (fix.kind === 'move-before') {
    reorderGroup(fix.groupId, fix.beforeId);
  }
  void runHealthCheck();
}

/**
 * Project ▸ Project storage…: what the project's space is used for (src/project-storage.js,
 * tools/painter/storage-panel.js), and deleting a question's recordings.
 */
export const storageDialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('storage-dialog'));

function renderStorageDialog() {
  const box = document.getElementById('storage-body');
  if (!box || !storageDialog?.open || !ctx.loadedPackParts) return;
  renderStoragePanel(box, { fileBytes: ctx.packFileBytes, rows: storageBreakdown(ctx.loadedPackParts), questions: recordingsByQuestion(ctx.loadedPackParts) }, {
    format: formatByteSize,
    cleanUpFrames: () => {
      storageDialog.close();
      void ctx.cleanUpFrames();
    },
    deleteRecordings: (questionId) => {
      const q = recordingsByQuestion(ctx.loadedPackParts).find((x) => x.id === questionId);
      if (!q || !window.confirm(`Delete the ${q.recordings} recording${q.recordings === 1 ? '' : 's'} of “${q.name}” (${formatByteSize(q.bytes)})? The question and the game states it made stay.`)) return;
      const out = withoutRecordings(ctx.loadedPackParts, questionId);
      ctx.loadedPackParts.manifest = out.manifest;
      ctx.loadedPackParts.memoryRecordingsFolder = out.memoryRecordingsFolder;
      ctx.recordingSamplesCache = new Map();
      ctx.markGroupsDirty();
      renderStorageDialog();
      ctx.setStatus(`Deleted ${out.removed} recording${out.removed === 1 ? '' : 's'} of “${q.name}”. Save .vbpack to keep it.`);
    },
  });
}

export function openStorageDialog() {
  if (!storageDialog || !ctx.loadedPackParts) return;
  if (!storageDialog.open) storageDialog.showModal();
  renderStorageDialog();
}

/**
 * Project ▸ Game states…: the project's game states, and the questions that find them
 * (src/memory-questions.js, tools/painter/game-states-panel.js). Questions and recordings live in
 * the pack's manifest, recordings' samples in memoryrecordings/; a captured frame added to a side
 * is read from its own memory dump.
 */
export const gameStatesDialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('game-states-dialog'));

function projectManifest() {
  if (!ctx.loadedPackParts.manifest || typeof ctx.loadedPackParts.manifest !== 'object') ctx.loadedPackParts.manifest = {};
  return ctx.loadedPackParts.manifest;
}

/** The frame index a captured frame's id belongs to, or -1. */
function frameIndexOfId(frameId) {
  return ctx.availableFrames.findIndex((_, i) => ctx.getRegistryFrameIdForFrameIndex(i) === frameId);
}

/** A recording's memory samples: its file's, or (added from a frame) that frame's memory. */
function recordingSamples(r) {
  if (ctx.recordingSamplesCache.has(r.id)) return ctx.recordingSamplesCache.get(r.id);
  let samples = [];
  const file = (ctx.loadedPackParts?.memoryRecordingsFolder || []).find((f) => f.name === `${r.id}.bin`);
  if (file) samples = decodeRecording(file.buffer) || [];
  else if (r.frameId) {
    const i = frameIndexOfId(r.frameId);
    const w = i >= 0 ? wramForFrameIndex(i) : null;
    samples = w ? [w] : [];
  }
  ctx.recordingSamplesCache.set(r.id, samples);
  return samples;
}

/** What the Game states window shows. */
function gameStatesPanelData() {
  const manifest = projectManifest();
  const recordings = recordingsOf(manifest);
  const cur = ctx.getCurrentFrameSelectIndex();
  return {
    states: projectGameStates(),
    usedBy: (id) => ctx.groups.filter((g) => groupConditionsOf(g).some((c) => c.state === id)).map((g) => g.name || g.id),
    questions: questionsOf(manifest).map((question) => {
      const recs = recordings.filter((r) => r.question === question.id);
      const loaded = recs.map((r) => ({ id: r.id, side: r.side, session: r.session, samples: recordingSamples(r) }));
      return {
        question,
        recordings: recs.map((r, i) => ({ ...r, samples: loaded[i].samples.length })),
        analysis: analyseQuestion(question, loaded),
      };
    }),
    frameLabel: cur != null && wramForFrameIndex(cur) ? ctx.availableFrames[cur]?.label || `frame ${cur}` : null,
  };
}

function renderGameStatesDialog() {
  const box = document.getElementById('game-states-body');
  if (!box || !gameStatesDialog?.open) return;
  renderGameStatesPanel(box, gameStatesPanelData(), gameStatesActions);
}

export function openGameStatesDialog() {
  if (!gameStatesDialog || !ctx.loadedPackParts) return;
  if (!gameStatesDialog.open) gameStatesDialog.showModal();
  renderGameStatesDialog();
}

/** After a change: keep it, and show it everywhere it appears. */
function gameStatesChanged(message) {
  ctx.markGroupsDirty();
  ctx.updateGroupsPanel();
  const sel = ctx.groups.find((x) => x.id === ctx.selectedGroupId);
  if (sel) updateGroupDetail(sel);
  ctx.render();
  renderGameStatesDialog();
  if (message) ctx.setStatus(message);
}

function setQuestions(questions, recordings) {
  const m = projectManifest();
  m.memoryQuestions = questions;
  m.memoryRecordings = recordings;
}

/**
 * A new question, its name and sides typed in (pre-filled when Check project suggests one), then
 * the Game states window to add to it.
 */
function askQuestion(suggestedName, suggestedSides) {
  const name = (window.prompt('The question (e.g. "Who is the player?"):', suggestedName) || '').trim();
  if (!name) return;
  const sides = window.prompt('Its sides — the game states to tell apart — separated by commas (e.g. "Luigi is the player, Mario is the player"):', suggestedSides.join(', '));
  if (sides == null) return;
  const manifest = projectManifest();
  const q = newQuestion(questionsOf(manifest), name, sides.split(','));
  if (!q) {
    ctx.setStatus('A question needs at least two different sides. Nothing was added.');
    return;
  }
  setQuestions([...(manifest.memoryQuestions || []), q], recordingsOf(manifest));
  openGameStatesDialog();
  gameStatesChanged(`Added “${q.name}”. Record each side while playing (the emulator's Memory panel), or add captured frames to a side.`);
}

const newRecordingId = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const gameStatesActions = {
  renameState(id) {
    const s = ctx.gameStates.find((x) => x.id === id);
    if (!s) return;
    const name = (window.prompt('New name for this game state:', s.name || id) || '').trim();
    if (!name || name === s.name) return;
    setGameStates(ctx.gameStates.map((x) => (x.id === id ? { ...x, name } : x)));
    gameStatesChanged(`Renamed to “${name}”. Save .vbpack to keep it.`);
  },
  forgetState(id) {
    const s = ctx.gameStates.find((x) => x.id === id);
    const users = ctx.groups.filter((g) => groupConditionsOf(g).some((c) => c.state === id));
    if (users.length && !window.confirm(`Forget “${s?.name || id}”? ${users.length} group${users.length === 1 ? ' uses' : 's use'} it (${users.map((g) => g.name || g.id).join(', ')}); its condition comes off ${users.length === 1 ? 'it' : 'them'}.`)) return;
    const out = withoutGameState(ctx.gameStates, ctx.groups, id);
    ctx.groups = out.groups.map((g, i) => (g === ctx.groups[i] ? g : normalizeGroup(g)));
    setGameStates(out.states);
    gameStatesChanged(`Forgot “${s?.name || id}”. Save .vbpack to keep it.`);
  },
  newQuestion() {
    askQuestion('', []);
  },
  deleteQuestion(questionId) {
    const manifest = projectManifest();
    const q = questionsOf(manifest).find((x) => x.id === questionId);
    const recs = recordingsOf(manifest).filter((r) => r.question === questionId);
    if (!q || !window.confirm(`Delete “${q.name}” and its ${recs.length} recording${recs.length === 1 ? '' : 's'}? The game states it made stay.`)) return;
    const gone = new Set(recs.map((r) => `${r.id}.bin`));
    ctx.loadedPackParts.memoryRecordingsFolder = (ctx.loadedPackParts.memoryRecordingsFolder || []).filter((f) => !gone.has(f.name));
    setQuestions((manifest.memoryQuestions || []).filter((x) => x.id !== questionId), recordingsOf(manifest).filter((r) => r.question !== questionId));
    gameStatesChanged(`Deleted “${q.name}”. Save .vbpack to keep it.`);
  },
  addFrame(questionId, sideId) {
    const cur = ctx.getCurrentFrameSelectIndex();
    const wram = cur == null ? null : wramForFrameIndex(cur);
    if (!wram) {
      ctx.setStatus('This frame has no memory captured with it, so it cannot be added.');
      return;
    }
    const manifest = projectManifest();
    const frameId = ctx.getRegistryFrameIdForFrameIndex(cur);
    const recs = recordingsOf(manifest);
    if (frameId && recs.some((r) => r.question === questionId && r.frameId === frameId)) {
      ctx.setStatus('This frame is already in that question — Move or Drop it in its Recordings.');
      return;
    }
    const id = newRecordingId();
    // A captured frame is read from its own dump; the Colorize! frame (no id) is copied in.
    if (!frameId) ctx.loadedPackParts.memoryRecordingsFolder = [...(ctx.loadedPackParts.memoryRecordingsFolder || []), { name: `${id}.bin`, buffer: encodeRecording([wram]).buffer }];
    const rec = { id, question: questionId, side: sideId, startedAt: new Date().toISOString(), seconds: 0, samples: 1, session: `frame-${frameId || id}`, source: 'frame', ...(frameId && { frameId }) };
    setQuestions(manifest.memoryQuestions || [], [...recs, rec]);
    gameStatesChanged(`Added ${ctx.availableFrames[cur]?.label || 'this frame'} to the question.`);
  },
  moveRecording(recordingId, sideId) {
    const manifest = projectManifest();
    setQuestions(manifest.memoryQuestions || [], recordingsOf(manifest).map((r) => (r.id === recordingId ? { ...r, side: sideId } : r)));
    gameStatesChanged('Moved the recording.');
  },
  dropRecording(recordingId) {
    const manifest = projectManifest();
    ctx.loadedPackParts.memoryRecordingsFolder = (ctx.loadedPackParts.memoryRecordingsFolder || []).filter((f) => f.name !== `${recordingId}.bin`);
    ctx.recordingSamplesCache.delete(recordingId);
    setQuestions(manifest.memoryQuestions || [], recordingsOf(manifest).filter((r) => r.id !== recordingId));
    gameStatesChanged('Dropped the recording.');
  },
  save(questionId, offsets) {
    const data = gameStatesPanelData().questions.find((x) => x.question.id === questionId);
    const out = data && gameStatesFromQuestion(data.question, data.analysis, offsets, ctx.gameStates);
    if (!out) {
      ctx.setStatus('Tick at least one byte to save the sides as game states.');
      return;
    }
    setGameStates(out.states);
    const manifest = projectManifest();
    setQuestions((manifest.memoryQuestions || []).map((q) => (q.id === questionId ? { ...q, status: 'saved' } : q)), recordingsOf(manifest));
    const names = out.ids.map((id) => ctx.gameStates.find((s) => s.id === id)?.name || id);
    gameStatesChanged(`Saved ${names.length} game states: ${names.join(', ')}. Add them to groups in Paint shows when… Save .vbpack to keep them.`);
  },
};
