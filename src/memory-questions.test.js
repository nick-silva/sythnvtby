import { describe, it, expect } from 'vitest';
import {
  encodeRecording,
  decodeRecording,
  distinctSamples,
  newQuestion,
  analyseQuestion,
  gameStatesFromQuestion,
  questionsOf,
  recordingsOf,
  WRAM_SIZE,
} from './memory-questions.js';

const PLAYER = 0x2014; // 2: Luigi, 0: Mario
let tick = 1;
/** A memory sample: the player byte, and bytes that move all the time (positions, a counter). */
function sample(player, extra = {}) {
  const w = new Uint8Array(WRAM_SIZE);
  w[PLAYER] = player;
  w[0x100] = (tick * 7) & 0xff; // ball x
  w[0x101] = (tick * 13) & 0xff; // ball y
  w[0x3000] = tick++ & 0xff; // frame counter
  for (const [k, v] of Object.entries(extra)) w[Number(k)] = v;
  return w;
}
const rec = (id, side, player, n = 4, session = `s-${id}`, extra = {}) => ({ id, side, session, samples: Array.from({ length: n }, () => sample(player, extra)) });
const Q = newQuestion([], 'Who is the player?', ['Luigi is the player', 'Mario is the player'], () => new Date('2026-10-09T13:10:00Z'));

describe('the recording file', () => {
  it('round-trips samples, delta-coded', () => {
    const samples = [sample(2), sample(2), sample(0)];
    const bytes = encodeRecording(samples);
    expect(bytes.byteLength).toBe(12 + 3 * WRAM_SIZE);
    expect(bytes.slice(12 + WRAM_SIZE, 12 + 2 * WRAM_SIZE).filter((b) => b !== 0).length).toBeLessThan(5); // mostly zeros
    const back = decodeRecording(bytes);
    expect(back.map((s) => s[0x3000])).toEqual(samples.map((s) => s[0x3000]));
    expect(back[2][PLAYER]).toBe(0);
  });

  it('refuses something that is not a recording, or is cut short', () => {
    expect(decodeRecording(new Uint8Array(20))).toBeNull();
    expect(decodeRecording(encodeRecording([sample(2)]).slice(0, 100))).toBeNull();
  });

  it('drops a sample identical to the one before', () => {
    const a = sample(2);
    expect(distinctSamples([a, a.slice(), sample(2)]).length).toBe(2);
  });
});

describe('questions', () => {
  it('a question needs two different sides; ids come from the names', () => {
    expect(Q).toEqual({
      id: 'q-who-is-the-player',
      name: 'Who is the player?',
      sides: [{ id: 'luigi-is-the-player', name: 'Luigi is the player' }, { id: 'mario-is-the-player', name: 'Mario is the player' }],
      createdAt: '2026-10-09T13:10:00.000Z',
      status: 'collecting',
    });
    expect(newQuestion([], 'x', ['Same', 'Same'])).toBeNull();
    expect(newQuestion([Q], 'Who is the player?', ['a', 'b']).id).toBe('q-who-is-the-player-2');
  });

  it('reads the valid questions and recordings from a manifest', () => {
    const manifest = { memoryQuestions: [Q, { id: 'bad', sides: [] }], memoryRecordings: [{ id: 'r1', question: Q.id, side: 'x' }, { id: 'r2' }] };
    expect(questionsOf(manifest).map((q) => q.id)).toEqual([Q.id]);
    expect(recordingsOf(manifest).map((r) => r.id)).toEqual(['r1']);
  });
});

describe('analyseQuestion', () => {
  const L = 'luigi-is-the-player';
  const M = 'mario-is-the-player';

  it('finds the byte that follows the state; everything that moves drops out', () => {
    const a = analyseQuestion(Q, [rec('l1', L, 2), rec('l2', L, 2), rec('m1', M, 0), rec('m2', M, 0)]);
    expect(a.candidates).toEqual([{ offset: PLAYER, values: { [L]: 2, [M]: 0 } }]);
    expect(a.sides.map((s) => [s.recordings, s.samples, s.sessions])).toEqual([[2, 8, 2], [2, 8, 2]]);
  });

  it('with few recordings, a byte that happens to differ fits too; more recordings rule it out', () => {
    const few = analyseQuestion(Q, [rec('l1', L, 2, 4, 's', { 0x500: 9 }), rec('m1', M, 0, 4, 's', { 0x500: 4 })]);
    expect(few.candidates.map((c) => c.offset)).toEqual([0x500, PLAYER]);
    const more = analyseQuestion(Q, [rec('l1', L, 2, 4, 's', { 0x500: 9 }), rec('l2', L, 2, 4, 's', { 0x500: 4 }), rec('m1', M, 0, 4, 's', { 0x500: 4 })]);
    expect(more.candidates.map((c) => c.offset)).toEqual([PLAYER]);
  });

  it('a recording made with the wrong side picked: a near miss that points at it', () => {
    const a = analyseQuestion(Q, [rec('l1', L, 2), rec('l2', L, 2), rec('oops', L, 0), rec('m1', M, 0)]);
    expect(a.candidates).toEqual([]);
    expect(a.nearMisses).toContainEqual({ offset: PLAYER, side: L, recording: 'oops', values: { [L]: 2, [M]: 0 } });
    expect(a.advice.join(' ')).toMatch(/near misses/);
  });

  it('says what would help, and when it is enough', () => {
    const none = analyseQuestion(Q, [rec('l1', L, 2)]);
    expect(none.advice).toContain('Record “Mario is the player”.');
    expect(none.enough).toBe(false);
    const oneSession = [1, 2, 3, 4, 5].flatMap((i) => [rec(`l${i}`, L, 2, 2, 'same'), rec(`m${i}`, M, 0, 2, `m${i}`)]);
    const a = analyseQuestion(Q, oneSession);
    expect(a.enough).toBe(false);
    expect(a.advice.join(' ')).toMatch(/All of “Luigi is the player”'s recordings come from one session/);
    const plenty = [1, 2, 3, 4, 5].flatMap((i) => [rec(`l${i}`, L, 2, 2, `l${i}`), rec(`m${i}`, M, 0, 2, `m${i}`)]);
    expect(analyseQuestion(Q, plenty).enough).toBe(true);
  });

  it('three sides need a different value each', () => {
    const q3 = newQuestion([], 'Who', ['Luigi', 'Mario', 'Toad']);
    const a = analyseQuestion(q3, [rec('l', 'luigi', 2), rec('m', 'mario', 0), rec('t', 'toad', 5)]);
    expect(a.candidates.map((c) => c.offset)).toEqual([PLAYER]);
    const same = analyseQuestion(q3, [rec('l', 'luigi', 2), rec('m', 'mario', 0), rec('t', 'toad', 0)]);
    expect(same.candidates).toEqual([]);
  });
});

describe('gameStatesFromQuestion', () => {
  const L = 'luigi-is-the-player';
  const M = 'mario-is-the-player';
  const a = analyseQuestion(Q, [rec('l1', L, 2), rec('l2', L, 2), rec('m1', M, 0), rec('m2', M, 0)]);

  it('makes a game state per side from the chosen byte', () => {
    const out = gameStatesFromQuestion(Q, a, [PLAYER], []);
    expect(out.ids).toEqual(['luigi-is-the-player', 'mario-is-the-player']);
    expect(out.states[0]).toEqual({ id: 'luigi-is-the-player', name: 'Luigi is the player', conditions: [{ offset: PLAYER, value: 2 }], source: 'learned', question: Q.id, side: L });
    expect(gameStatesFromQuestion(Q, a, [0x9999], [])).toBeNull();
  });

  it('saving again updates the same game states, and drops "checked live" only when the bytes changed', () => {
    const first = gameStatesFromQuestion(Q, a, [PLAYER], []).states.map((s) => ({ ...s, checkedLive: '2026-10-09T14:00:00Z' }));
    const again = gameStatesFromQuestion(Q, a, [PLAYER], first);
    expect(again.states.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(again.states[0].checkedLive).toBe('2026-10-09T14:00:00Z');
    const b = { ...a, candidates: [...a.candidates, { offset: 0x77, values: { [L]: 1, [M]: 3 } }] };
    const changed = gameStatesFromQuestion(Q, b, [PLAYER, 0x77], first);
    expect(changed.states[0].checkedLive).toBeUndefined();
    expect(changed.states[0].conditions).toHaveLength(2);
  });
});
