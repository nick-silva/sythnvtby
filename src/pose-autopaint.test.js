import { describe, expect, it } from 'vitest';
import { autopaint, paintedShare } from './pose-autopaint.js';

const G = [0, 255, 0];
const EYE = [255, 255, 255];
const BELLY = [255, 200, 0];

// A body (shade 2) with a one-pixel eye and a belly patch, both shade 3: the same shade, two
// colours, told apart only by what is around them.
const SHAPE = [
  '............',
  '...2222.....',
  '..222222....',
  '..223222....',
  '..222222....',
  '..222222....',
  '..233332....',
  '..233332....',
  '..233332....',
  '..222222....',
  '............',
];

/**
 * A pose grid from rows of shades. Each pixel is its own pattern unless `hashOf` says otherwise;
 * `colourOf(x, y, shade)` paints it.
 */
function grid(id, rows, { colourOf = () => null, hashOf = (x, y) => `${id}:${x},${y}` } = {}) {
  const w = rows[0].length;
  const px = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return px.push(null);
      const s = Number(ch);
      px.push({ s, h: hashNumber(hashOf(x, y)), o: 0, c: colourOf(x, y, s) });
    });
  });
  return { id, w, h: rows.length, px };
}

function hashNumber(key) {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));
const paintRef = (x, y, s) => (s === 2 ? G : y < 5 ? EYE : BELLY);
const colourAt = (pose, x, y, fills) => {
  const q = pose.px[y * pose.w + x];
  return q.c || fills.get(q.h)?.get(q.o) || null;
};

describe('paintedShare', () => {
  it('counts painted lit pixels', () => {
    const pose = grid('p', ['22', '2.'], { colourOf: (x) => (x === 0 ? G : null) });
    expect(paintedShare(pose)).toBeCloseTo(2 / 3);
  });
});

describe('autopaint', () => {
  it('tells two areas of one shade apart by their surroundings, in a mirrored pose', async () => {
    const ref = grid('ref', SHAPE, { colourOf: paintRef });
    const target = grid('t', mirror(SHAPE));
    const { fills, posesPainted } = await autopaint({ poses: [ref, target], referenceIds: ['ref'], targetIds: ['t'] });
    expect(posesPainted).toBe(1);
    // Mirrored: the eye sits at x = 11 - 4 = 7, the belly spans x = 5…8.
    expect(colourAt(target, 7, 3, fills)).toEqual(EYE);
    expect(colourAt(target, 6, 7, fills)).toEqual(BELLY);
    expect(colourAt(target, 7, 4, fills)).toEqual(G);
  });

  it('keeps painted pixels and leaves pattern pixels a reference shows alone', async () => {
    const ref = grid('ref', SHAPE, { colourOf: paintRef });
    // The target reuses the reference's pattern at the eye; one body pixel is already painted.
    const red = [200, 0, 0];
    const target = grid('t', SHAPE, {
      hashOf: (x, y) => (x === 4 && y === 3 ? 'ref:4,3' : `t:${x},${y}`),
      colourOf: (x, y) => (x === 3 && y === 4 ? red : null),
    });
    const { fills } = await autopaint({ poses: [ref, target], referenceIds: ['ref'], targetIds: ['t'] });
    expect(fills.get(target.px[3 * target.w + 4].h)).toBeUndefined();
    expect(fills.get(target.px[4 * target.w + 3].h)).toBeUndefined();
    expect(fills.size).toBeGreaterThan(0);
  });

  it('gives a pattern shared by several poses the colour most of them chose', async () => {
    const ref = grid('ref', SHAPE, { colourOf: paintRef });
    // Three targets share one pattern pixel: twice where the belly is, once on the body.
    const shared = (bx, by) => (x, y) => (x === bx && y === by ? 'shared' : `${bx}${by}:${x},${y}`);
    const a = grid('a', SHAPE, { hashOf: shared(4, 7) });
    const b = grid('b', SHAPE, { hashOf: shared(5, 7) });
    const c = grid('c', SHAPE, { hashOf: shared(4, 4) });
    const { fills } = await autopaint({ poses: [ref, a, b, c], referenceIds: ['ref'], targetIds: ['a', 'b', 'c'] });
    expect(fills.get(hashNumber('shared')).get(0)).toEqual(BELLY);
  });

  it('reports progress and stops when asked', async () => {
    const ref = grid('ref', SHAPE, { colourOf: paintRef });
    const targets = ['a', 'b', 'c'].map((id) => grid(id, SHAPE));
    const seen = [];
    const done = await autopaint({ poses: [ref, ...targets], referenceIds: ['ref'], targetIds: ['a', 'b', 'c'], onProgress: (p) => seen.push(p) });
    expect(seen[0].done).toBe(0);
    expect(seen.at(-1)).toMatchObject({ done: 4, total: 4 });
    expect(done.fills.size).toBeGreaterThan(0);
    let calls = 0;
    const stopped = await autopaint({ poses: [ref, ...targets], referenceIds: ['ref'], targetIds: ['a', 'b', 'c'], shouldStop: () => ++calls > 1 });
    expect(stopped.stopped).toBe(true);
    expect(stopped.fills.size).toBe(0);
  });

  it('does nothing without a reference or a target', async () => {
    const ref = grid('ref', SHAPE, { colourOf: paintRef });
    const target = grid('t', SHAPE);
    expect((await autopaint({ poses: [ref, target], referenceIds: [], targetIds: ['t'] })).fills.size).toBe(0);
    // A pose picked as both is a reference.
    expect((await autopaint({ poses: [ref, target], referenceIds: ['ref', 't'], targetIds: ['t'] })).posesPainted).toBe(0);
  });
});
