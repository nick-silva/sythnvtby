/**
 * What a project's space is used for (Project ▸ Project storage…; docs/design/memory-states.md §6):
 * each kind of thing the pack holds, how many and how big (before the pack's compression), what it
 * is for and what goes without it; and the memory recordings per question, the kind that piles up
 * fastest while answering one.
 */

import { fileBytes } from './frame-cleanup.js';
import { questionsOf, recordingsOf } from './memory-questions.js';

const sum = (list) => (list || []).reduce((n, f) => n + fileBytes(f), 0);
const jsonBytes = (v) => (v == null ? 0 : JSON.stringify(v).length);

/**
 * @typedef {{ kind: string, label: string, count: number, bytes: number, purpose: string, without: string }} StorageRow
 */

/**
 * The pack's contents by kind, biggest first (kinds it does not have are left out).
 * @param {any} parts the loaded pack (parseArtPack's shape)
 * @returns {StorageRow[]}
 */
export function storageBreakdown(parts) {
  const p = parts || {};
  const rows = [
    { kind: 'frames', label: 'Frames: picture data', list: p.vipStatesFolder, purpose: 'Seeing and painting each captured frame.', without: 'The frame is gone — Clean up frames decides which.' },
    { kind: 'screenshots', label: 'Frames: screenshots', list: p.screenshotsFolder, purpose: 'The capture overlay; exporting a frame to colour elsewhere.', without: 'No screenshot overlay for that frame.' },
    { kind: 'savestates', label: 'Frames: save states', list: p.saveStatesFolder, purpose: 'Opening the game at that moment; the memory of older captures.', without: 'Only the memory dump remains.' },
    { kind: 'ramdumps', label: 'Frames: memory dumps', list: p.ramdumpsFolder, purpose: 'Which screen and game states hold on each frame.', without: 'The frame cannot be checked against screens or game states.' },
    { kind: 'recordings', label: 'Memory recordings', list: p.memoryRecordingsFolder, purpose: 'Answering and re-checking questions about game states.', without: 'Re-checking a question needs new recordings; the game states it made stay.' },
    { kind: 'references', label: 'Reference pictures', list: p.referencesFolder, purpose: 'Painting from a colourised picture of a frame.', without: 'Nothing to paint from on those frames.' },
    { kind: 'recovery', label: 'Recovered pictures', list: p.recoveryFolder, purpose: 'Putting a picture back that was set aside.', without: 'The pictures set aside are gone.' },
  ].map(({ list, ...r }) => ({ ...r, count: (list || []).length, bytes: sum(list) }));
  const groupsBytes = jsonBytes(p.groups) + jsonBytes(p.gameStatePools) + jsonBytes(p.gameStates);
  if (groupsBytes) rows.push({ kind: 'groups', label: 'Groups and paint', count: (p.groups || []).length, bytes: groupsBytes, purpose: 'Your groups, their paint and pictures, screens and game states.', without: '— (this is the work itself)' });
  const rom = fileBytes({ buffer: p.rom });
  if (rom) rows.push({ kind: 'rom', label: 'The game (ROM)', count: 1, bytes: rom, purpose: 'Playing the game; Save and Play.', without: 'Each tool asks for the ROM file.' });
  const current = (typeof p.vipState === 'string' ? p.vipState.length : 0) + fileBytes({ buffer: p.saveState });
  if (current) rows.push({ kind: 'current', label: 'The Colorize! frame', count: 1, bytes: current, purpose: 'Where Save and Play picks up the game.', without: 'Save and Play starts the game from the beginning.' });
  const colours = fileBytes({ buffer: p.vbcolor });
  if (colours) rows.push({ kind: 'colours', label: 'Shared paint (color.vbcolor)', count: 1, bytes: colours, purpose: 'Paint on patterns no group owns.', without: '— (this is the work itself)' });
  return rows.filter((r) => r.count > 0 || r.bytes > 0).sort((a, b) => b.bytes - a.bytes);
}

/**
 * Memory recordings per question: how many, how big (their files; recordings added from a frame
 * read its dump and cost nothing more).
 * @param {any} parts
 * @returns {Array<{ id: string, name: string, recordings: number, bytes: number }>}
 */
export function recordingsByQuestion(parts) {
  const files = new Map((parts?.memoryRecordingsFolder || []).map((f) => [f.name, fileBytes(f)]));
  const recs = recordingsOf(parts?.manifest);
  return questionsOf(parts?.manifest).map((q) => {
    const mine = recs.filter((r) => r.question === q.id);
    return { id: q.id, name: q.name, recordings: mine.length, bytes: mine.reduce((n, r) => n + (files.get(`${r.id}.bin`) || 0), 0) };
  });
}

/**
 * The pack without a question's recordings (their files and their entries); the question and the
 * game states it made stay.
 * @param {any} parts @param {string} questionId
 * @returns {{ manifest: any, memoryRecordingsFolder: any[], removed: number }}
 */
export function withoutRecordings(parts, questionId) {
  const recs = recordingsOf(parts?.manifest);
  const gone = recs.filter((r) => r.question === questionId);
  const names = new Set(gone.map((r) => `${r.id}.bin`));
  return {
    manifest: { ...(parts?.manifest || {}), memoryRecordings: recs.filter((r) => r.question !== questionId) },
    memoryRecordingsFolder: (parts?.memoryRecordingsFolder || []).filter((f) => !names.has(f.name)),
    removed: gone.length,
  };
}
