import { describe, it, expect, beforeEach } from 'vitest';
import { checkProject } from './project-health.js';
import { withGroupTileColor } from './group-tile-colors.js';
import { setLayerArtPixels, clearLayerArtPixels } from './layer-art.js';
import { getTileBytes, hashTile } from './vip-state.js';

// Tiles 1–8: distinct lit patterns.
const PT = new Uint8Array(2048 * 16);
for (let t = 1; t <= 8; t++) PT.fill(t * 17, t * 16, t * 16 + 16);
const h = (t) => hashTile(getTileBytes(PT, t)) >>> 0;

const solid = (rgba) => {
  const out = new Uint8Array(256);
  for (let i = 0; i < 64; i++) out.set(rgba, i * 4);
  return out;
};
const RED = solid([255, 0, 0, 255]);
const BLUE = solid([0, 0, 255, 255]);

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}
/** Plain BG worlds over the whole screen, both eyes, map 5; END below the last. */
function windows(worlds) {
  const win = new Uint8Array(1024);
  for (const w of worlds) {
    wr16(win, w * 32, 0xc005);
    wr16(win, w * 32 + 14, 383);
    wr16(win, w * 32 + 16, 223);
  }
  wr16(win, (Math.min(...worlds) - 1) * 32, 0x40);
  return win;
}

/** A frame drawing tiles on `world`, a row along the top. */
const frame = (world, tiles, extra = {}) => ({
  patternTable: PT,
  windows: windows([world]),
  drawList: tiles.map((t, i) => ({ tileIndex: t, x: i * 8, y: 0, eye: 0, layer: 0, world, ...extra })),
});

const painted = (g, tiles, paint = RED) => tiles.reduce((acc, t) => withGroupTileColor(acc, h(t), paint), g);
const group = (id, tiles, criteria = {}) => ({ id, name: id, criteria: { layers: [0], hashes: tiles.map(h), ...criteria } });
const run = (groups, states, pack) => checkProject({ groups, pack }, states.map((state, frameIndex) => ({ frameIndex, state })));

beforeEach(() => clearLayerArtPixels('Crowd'));

describe('checkProject', () => {
  it('is quiet when everything on screen is painted', () => {
    const g = painted(group('Mario', [1, 2, 3]), [1, 2, 3]);
    expect(run([g], [frame(30, [1, 2, 3])])).toEqual([]);
  });

  it('a group moved to another world: names the world and offers to add it', () => {
    const g = painted(group('LUIGI text', [1, 2, 3, 4, 5, 6], { windowIds: [17] }), [1, 2, 3, 4, 5, 6]);
    const issues = run([g], [frame(17, [1, 2, 3, 4, 5, 6]), frame(18, [1, 2, 3, 4, 5, 6]), frame(18, [1, 2, 3, 4, 5])]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'world',
      problem: true,
      frames: 2,
      sentence: 'LUIGI text: its tiles are drawn on world 18 on 2 frames, and its paint drops out there — it only paints world 17.',
      fix: { kind: 'add-world', groupId: 'LUIGI text', world: 18, label: 'Add world 18' },
      example: { frameIndex: 1, x: 0, y: 0 },
    });
  });

  it('a couple of shared tiles on another world, or a world another group paints, is not a move', () => {
    const g = painted(group('Mario', [1, 2, 3, 4, 5, 6], { windowIds: [17] }), [1, 2, 3, 4, 5, 6]);
    const other = painted(group('Mario far', [1, 2, 3, 4, 5, 6], { windowIds: [18] }), [1, 2, 3, 4, 5, 6], BLUE);
    expect(run([g], [frame(18, [1, 2])])).toEqual([]);
    expect(run([g, other], [frame(18, [1, 2, 3, 4, 5, 6])])).toEqual([]);
  });

  describe('two groups painting the same tiles (the first listed wins)', () => {
    const mario = painted(group('Mario-PlayingAs', [1, 2, 4]), [1, 2, 4]);
    const luigi = painted(group('Luigi-PlayingAs', [1, 2, 3]), [1, 2, 3], BLUE);
    const LUIGI_ONLY = [1, 2, 3];
    const MARIO_ONLY = [1, 2, 4];
    // Tiles 16 px apart: nothing next to a shared tile says whose it is, so the list order decides.
    const apart = (world, tiles) => {
      const st = frame(world, tiles);
      st.drawList.forEach((d, i) => { d.x = i * 16; });
      return st;
    };

    it('the other group on screen alone, taking the first one’s colours: offers to let it win', () => {
      const [issue, ...rest] = run([mario, luigi], [apart(30, LUIGI_ONLY), apart(30, LUIGI_ONLY)]);
      expect(rest).toEqual([]);
      expect(issue).toMatchObject({
        kind: 'order',
        problem: true,
        groupId: 'Luigi-PlayingAs',
        tiles: 2,
        frames: 2,
        example: { frameIndex: 0, x: 0, y: 0 },
        sentence: 'Luigi-PlayingAs: on 2 frames it is on screen without Mario-PlayingAs, and 2 of its tiles take Mario-PlayingAs’s colours — Mario-PlayingAs also paints them and is listed first.',
        fix: { kind: 'move-before', groupId: 'Luigi-PlayingAs', beforeId: 'Mario-PlayingAs', label: 'Let Luigi-PlayingAs win' },
      });
    });

    it('each on screen alone somewhere: the order cannot suit both, so it offers to tell them apart by a game state', () => {
      const [issue] = run([mario, luigi], [apart(30, MARIO_ONLY), apart(30, LUIGI_ONLY)]);
      expect(issue).toMatchObject({
        kind: 'order',
        problem: true,
        frames: 1,
        fix: { kind: 'new-question', groupId: 'Luigi-PlayingAs', name: 'Which is it: Mario-PlayingAs or Luigi-PlayingAs?', sides: ['Mario-PlayingAs', 'Luigi-PlayingAs'], label: 'Tell them apart…' },
      });
      expect(issue.sentence).toContain('on 1 frame Mario-PlayingAs is on screen without it — changing the order would only swap which one looks wrong');
    });

    it('always on screen together: worth knowing, not a problem', () => {
      const [issue] = run([mario, luigi], [apart(30, [1, 2, 3, 4])]);
      expect(issue).toMatchObject({ kind: 'order', problem: false, frames: 1 });
      expect(issue.sentence).toBe('Mario-PlayingAs and Luigi-PlayingAs are on screen together on 1 frame and both paint 2 tiles: one pattern on one layer takes one group’s colour, so they show Mario-PlayingAs’s (listed first).');
    });

    it('a shared tile next to the group’s own tiles goes to that group: nothing to say', () => {
      expect(run([mario, luigi], [frame(30, LUIGI_ONLY)])).toEqual([]);
    });

    it('only the first one on screen: its colours are right, nothing to say', () => {
      expect(run([mario, luigi], [apart(30, MARIO_ONLY)])).toEqual([]);
    });
  });

  it('tiles in a group with no paint yet: a to-do, listed after problems', () => {
    const court = painted(group('Court', [1, 2, 3]), [1]);
    const g = painted(group('LUIGI', [4, 5, 6, 7], { windowIds: [17] }), [4, 5, 6, 7]);
    const issues = run([court, g], [frame(30, [1, 2, 3]), frame(18, [4, 5, 6, 7])]);
    expect(issues.map((i) => i.kind)).toEqual(['world', 'unpainted']);
    expect(issues[1]).toMatchObject({ problem: false, tiles: 2, sentence: 'Court: 2 of its tiles are not painted yet (seen on 1 frame).', fix: { kind: 'select-group', groupId: 'Court' } });
  });

  it('shared paint counts as painted', () => {
    expect(run([group('Court', [1, 2])], [frame(30, [1, 2])], new Map([[h(1), RED], [h(2), RED]]))).toEqual([]);
  });

  it('a layer scrolling past its overpaint: the group’s tiles outside the picture', () => {
    const crowd = { ...group('Crowd', [1, 2], { windowIds: [30] }), overpaint: { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 16, height: 8, png: '' } };
    setLayerArtPixels('Crowd', { width: 16, height: 8, data: new Uint8ClampedArray(16 * 8 * 4).fill(255) });
    const state = frame(30, [1, 2]);
    state.drawList.push({ tileIndex: 2, x: 200, y: 40, eye: 0, layer: 0, world: 30 });
    const issues = run([crowd], [state]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'overpaint', tiles: 1, example: { frameIndex: 0, x: 200, y: 40 }, fix: { kind: 'select-group', groupId: 'Crowd' } });
    expect(issues[0].sentence).toBe("Crowd: on 1 frame its layer scrolls past its overpaint, and 1 of its tiles shows past the picture's edge uncoloured. SpriteStudio's Cover the whole map widens the picture.");
  });

  it('a backdrop scrolled past its picture is listed even where its tiles are painted — they do not match the picture', () => {
    const crowd = { ...painted(group('Crowd', [1, 2], { windowIds: [30] }), [1, 2]), overpaint: { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 16, height: 8, png: '' } };
    setLayerArtPixels('Crowd', { width: 16, height: 8, data: new Uint8ClampedArray(16 * 8 * 4).fill(255) });
    const state = frame(30, [1, 2]);
    state.drawList.push({ tileIndex: 2, x: 200, y: 0, eye: 0, layer: 0, world: 30 }); // beside the picture, in its rows
    state.drawList.push({ tileIndex: 1, x: 200, y: 100, eye: 0, layer: 0, world: 30 }); // well away from it: not a scroll
    const [issue, ...rest] = run([crowd], [state]);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ kind: 'overpaint', tiles: 1, example: { frameIndex: 0, x: 200, y: 0 } });
    expect(issue.sentence).toMatch(/1 of its tiles shows past the picture's edge in their plain tile paint, not the picture/);
  });

  it('shared tiles under a picture are not a problem: the picture shows there, not either group’s paint', () => {
    const mario = painted(group('Mario-PlayingAs', [1, 2, 4]), [1, 2, 4]);
    const luigi = { ...painted(group('Luigi-PlayingAs', [1, 2, 3]), [1, 2, 3], BLUE), overpaint: { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 384, height: 8, png: '' } };
    setLayerArtPixels('Luigi-PlayingAs', { width: 384, height: 8, data: new Uint8ClampedArray(384 * 8 * 4).fill(255) });
    expect(run([mario, luigi], [frame(30, [1, 2, 3])]).filter((i) => i.kind === 'order')).toEqual([]);
    clearLayerArtPixels('Luigi-PlayingAs');
  });

  it('a condition naming a game state the project does not have is listed', () => {
    const g = { ...group('Mario', [1]), conditions: [{ state: 'gone', is: false }] };
    const [issue] = run([g], []);
    expect(issue).toMatchObject({ kind: 'condition', problem: true, groupId: 'Mario', fix: { kind: 'select-group' } });
    expect(issue.sentence).toBe('Mario: its condition on “gone” is ignored — the project has no game state by that id. Select the group to remove it or pick another.');
  });

  it('frames no screen recognises: a to-do with Analyze memory', () => {
    const g = painted(group('Mario', [1]), [1]);
    const issues = checkProject({ groups: [g] }, [
      { frameIndex: 0, state: frame(30, [1]), screens: new Set() },
      { frameIndex: 1, state: frame(30, [1]), screens: new Set(['pool-game']) },
      { frameIndex: 2, state: frame(30, [1]), screens: null },
    ]);
    expect(issues).toEqual([expect.objectContaining({ kind: 'screen', problem: false, frames: 1, fix: { kind: 'analyze-memory', groupId: '', label: 'Analyze memory…' } })]);
    expect(issues[0].sentence).toMatch(/^1 captured frame is not recognised as any screen/);
  });

  it('a damaged picture is a problem, whatever the frames show', () => {
    const g = { ...group('Crowd', [1]), overpaint: { world: 30, mapX: 0, mapY: 0, width: 16, height: 8, png: 'not a png' } };
    const [issue] = run([g], []);
    expect(issue).toMatchObject({ kind: 'picture', problem: true, groupId: 'Crowd' });
    expect(issue.sentence).toMatch(/^Crowd: its overpaint is damaged/);
  });

  it('respects screen limits: only the groups shown on a frame count there', () => {
    const mario = painted(group('Mario', [1]), [1]);
    const luigi = painted(group('Luigi', [1]), [1], BLUE);
    expect(checkProject({ groups: [mario, luigi] }, [{ frameIndex: 0, state: frame(30, [1]), shown: [luigi] }])).toEqual([]);
  });
});
