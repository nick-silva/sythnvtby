import { describe, expect, it } from 'vitest';
import {
  summarizeFrameForPack,
  savedSummaryFor,
  toPatternSummary,
  toGroupIndex,
  brightnessLevelsFor,
  frameSummariesJson,
  parseFrameSummaries,
} from './frame-summary.js';
import { frameGroupIndex } from './group-screens.js';
import { getTileBytes, hashTile } from './vip-state.js';
import { buildArtPack, parseArtPack, artPackPartsFromParsed } from './art-pack.js';

/** Four tiles: 0 blank, 1–3 distinct patterns. */
const patternTable = new Uint8Array(16 * 4);
patternTable.fill(0x11, 16, 32);
patternTable.fill(0x22, 32, 48);
patternTable.fill(0x33, 48, 64);
const hash = (slot) => hashTile(getTileBytes(patternTable, slot)) >>> 0;
const state = {
  patternTable,
  masterBrightness: 0.5,
  drawList: [
    { tileIndex: 1, world: 3, layer: 0, eye: 0 },
    { tileIndex: 2, world: 3, layer: 0, eye: 0 },
    { tileIndex: 2, world: 5, layer: 2, eye: 0 },
    { tileIndex: 0, world: 3, layer: 0, eye: 0 }, // blank: not in the index
    { tileIndex: 3, world: 4, layer: 0, eye: 1 }, // right eye: in the patterns only
    { tileIndex: 1, eye: 0 }, // no world or layer
  ],
};

describe('summarizeFrameForPack', () => {
  const s = summarizeFrameForPack(state, 1234);

  it('rebuilds exactly the Project tool’s screen index', () => {
    const a = toGroupIndex(s).byWorldLayer;
    const b = frameGroupIndex(state, 0).byWorldLayer;
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [k, v] of b) {
      expect([...a.get(k).hashes].sort()).toEqual([...v.hashes].sort());
      expect([...a.get(k).slots].sort()).toEqual([...v.slots].sort());
    }
  });

  it('keeps every pattern any draw uses, the brightness and the fingerprint', () => {
    const p = toPatternSummary(s);
    expect(p.hashes).toEqual(new Set([hash(0), hash(1), hash(2), hash(3)]));
    expect(p.affine).toBe(false);
    expect(p.standIns).toEqual(new Set());
    expect(s.b).toBe(0.5);
    expect(s.n).toBe(1234);
  });

  it('survives a trip through JSON', () => {
    expect(toGroupIndex(JSON.parse(JSON.stringify(s)))).toEqual(toGroupIndex(s));
  });
});

describe('saved summaries', () => {
  const s = summarizeFrameForPack(state, 100);
  const saved = { 'f-a.json': s };

  it('are used only while the frame still matches', () => {
    expect(savedSummaryFor(saved, 'f-a.json', 100)).toBe(s);
    expect(savedSummaryFor(saved, 'f-a.json', 101)).toBe(null);
    expect(savedSummaryFor(saved, 'f-b.json', 100)).toBe(null);
    expect(savedSummaryFor(null, 'f-a.json', 100)).toBe(null);
  });

  it('give the brightness levels, reading only frames without one', () => {
    const read = [];
    const levels = brightnessLevelsFor(
      [
        { vipFile: 'f-a.json', jsonSize: 100, json: 'never read' },
        { vipFile: 'f-b.json', jsonSize: 7, json: '{"masterBrightness":0.25}' },
      ],
      saved,
      (texts) => {
        read.push(...texts);
        return texts.map(() => 0.25);
      },
    );
    expect(levels).toEqual([0.5, 0.25]);
    expect(read).toEqual(['{"masterBrightness":0.25}']);
  });

  it('save one summary per frame still there, this session’s first', () => {
    const newer = { ...s, b: 0.75 };
    const json = frameSummariesJson(
      [
        { vipFile: 'f-a.json', jsonSize: 100 },
        { vipFile: 'f-c.json', jsonSize: 9 },
      ],
      { ...saved, 'f-gone.json': s },
      new Map([['f-a.json', newer]]),
    );
    const doc = parseFrameSummaries(json);
    expect(Object.keys(doc)).toEqual(['f-a.json']);
    expect(doc['f-a.json'].b).toBe(0.75);
    expect(frameSummariesJson([], null, new Map())).toBe(null);
  });

  it('ignore a file from another version or one that does not parse', () => {
    expect(parseFrameSummaries(JSON.stringify({ version: 99, frames: {} }))).toBe(null);
    expect(parseFrameSummaries('{not json')).toBe(null);
    expect(parseFrameSummaries(undefined)).toBe(null);
  });

  it('round-trip through a pack', async () => {
    const text = frameSummariesJson([{ vipFile: 'f-a.json', jsonSize: 100 }], saved, new Map());
    const blob = await buildArtPack({ manifest: { gameId: 't' }, frameSummaries: text });
    const parsed = await parseArtPack(await blob.arrayBuffer());
    expect(parsed.frameSummaries).toBe(text);
    expect(artPackPartsFromParsed(parsed).frameSummaries).toBe(text);
  });
});
