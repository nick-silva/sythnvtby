import { describe, it, expect, beforeAll } from 'vitest';
import { buildFixturePack, FIXTURE } from '../tests/fixtures/fixture-pack.mjs';
import { parseArtPack } from './art-pack.js';
import { deserializeVIPState } from './vip-dump.js';
import { compositeColorFrameForEye, DEFAULT_FADE_RESPONSE } from './color-layer.js';
import { setProjectGameStates } from './game-states.js';
import { withPaintOnTransparent } from './transparent-paint.js';
import { projectFromParsed, colourOptions, renderProjectFrame, withoutStrayTransparentPaint, VIEWS } from './project.js';

let parsed;
let project;
beforeAll(async () => {
  parsed = await parseArtPack((await buildFixturePack()).buffer);
  project = projectFromParsed(parsed, { label: 'fixture.vbpack' });
  setProjectGameStates(project.gameStates);
});

describe('projectFromParsed', () => {
  it('reads the colour project out of a parsed pack', () => {
    expect(project.gameId).toBe('fixture');
    expect(project.pack.has(FIXTURE.hashes.background)).toBe(true);
    expect(project.groups.map((g) => g.name)).toEqual(['Hero', 'Sign']);
    expect(project.gameStatePools.map((p) => p.id)).toEqual(['pool-title', 'pool-play']);
    expect(project.gameStates.map((s) => s.id)).toEqual(['hero-red']);
    expect(project.frameRegistry.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(project.paintsTransparent).toBe(false);
  });

  it('puts groups through the group schema (defaults filled in, unknown fields kept)', () => {
    const p = projectFromParsed({ groups: [{ id: 'g', criteria: { worldIds: [3] }, futureField: 1 }] });
    expect(p.groups[0]).toMatchObject({ visible: true, futureField: 1, criteria: { windowIds: [3] } });
  });

  it('numbers frames that have no number, without changing the parsed pack', () => {
    const input = { manifest: { frameRegistry: [{ frameId: 'a' }, { frameId: 'b' }] } };
    const p = projectFromParsed(input);
    expect(p.frameRegistry.map((r) => r.number)).toEqual([1, 2]);
    expect(input.manifest.frameRegistry[0].number).toBeUndefined();
  });

  it('copes with an empty parse', () => {
    const p = projectFromParsed({}, { label: 'Game.vbpack' });
    expect(p).toMatchObject({ gameId: 'Game', groups: [], overrides: [], gameStates: [], painterV2Rules: null });
    expect(p.pack.size).toBe(0);
  });
});

describe('colourOptions', () => {
  it('fills in the project and the view, and lets the frame override', () => {
    const o = colourOptions(project, 'play', { eye: 1, wram: new Uint8Array(4) });
    expect(o).toMatchObject({ eye: 1, groups: project.groups, gameStatePools: project.gameStatePools, renderUnpackedFallback: false, unpackedMinCoverage: 2, drawTransparentPaint: false });
    expect(o.wram).toBeInstanceOf(Uint8Array);
  });

  it('previews in the tools with fallbacks and transparent paint on', () => {
    expect(colourOptions(project, 'toolPreview')).toMatchObject({ renderUnpackedFallback: true, unpackedMinCoverage: 1, drawTransparentPaint: true, brightnessScale: DEFAULT_FADE_RESPONSE });
    expect(colourOptions(project, 'toolPreview', { diagnosticMonoFallback: true }).diagnosticMonoFallback).toBe(true);
  });

  it('plays transparent paint only when the pack says so', () => {
    expect(colourOptions({ ...project, paintsTransparent: true }, 'play').drawTransparentPaint).toBe(true);
  });

  it('refuses a view it does not know', () => {
    expect(() => colourOptions(project, 'nope')).toThrow(/unknown view/);
    expect(Object.keys(VIEWS)).toEqual(['play', 'toolPreview', 'measure']);
  });
});

describe('renderProjectFrame', () => {
  it('draws exactly what the compositor draws with the same options', () => {
    const f = FIXTURE.frames[0];
    const state = deserializeVIPState(JSON.parse(parsed.vipStatesFolder.find((x) => x.name === `${f.id}.json`).json));
    const wram = new Uint8Array(parsed.ramdumpsFolder.find((x) => x.name === `${f.id}.wram.bin`).buffer);
    const a = { data: new Uint8ClampedArray(384 * 224 * 4) };
    const b = { data: new Uint8ClampedArray(384 * 224 * 4) };
    renderProjectFrame(project, state, a, 'play', { wram });
    compositeColorFrameForEye(state, project.pack, b, {
      eye: 0, overrides: project.overrides, groups: project.groups, gameStatePools: project.gameStatePools, wram,
      painterV2Rules: project.painterV2Rules, unpackedMinCoverage: 2, renderUnpackedFallback: false, drawTransparentPaint: false,
    });
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(a.data.some((v) => v !== 0)).toBe(true);
  });
});

describe('withoutStrayTransparentPaint', () => {
  it('leaves a pack alone that already says its transparent paint is intentional', () => {
    const flagged = { ...project, manifest: withPaintOnTransparent(project.manifest) };
    const r = withoutStrayTransparentPaint(flagged, 0, () => null);
    expect(r.cleared).toBeNull();
    expect(r.pack).toBe(flagged.pack);
  });

  it('flags the manifest once it has looked, and keeps paint on lit pixels', () => {
    const r = withoutStrayTransparentPaint(project, 0, () => null);
    expect(r.cleared).toMatchObject({ pixels: 0 });
    expect(r.manifest).not.toBe(project.manifest);
    expect(r.pack.size).toBe(project.pack.size);
  });
});
