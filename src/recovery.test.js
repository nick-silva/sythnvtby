import { describe, it, expect } from 'vitest';
import { encodePng } from '../scripts/png.mjs';
import {
  pngSize,
  listPictures,
  damagedPictures,
  setAside,
  recoveryFolderFrom,
  itemsFromRecoveryFolder,
  restorePicture,
  bestPlacement,
  confidentPlacement,
} from './recovery.js';

const png = (w, h) => Buffer.from(encodePng(w, h, new Uint8Array(w * h * 4).fill(255))).toString('base64');
const op = (w, h, extra = {}) => ({ world: 30, bgmapBase: 1, mapX: 10, mapY: 20, width: w, height: h, hideTiles: false, png: png(w, h), ...extra });
const groups = () => [
  { id: 'g1', name: 'Backdrop', overpaint: op(4, 2) },
  { id: 'g2', name: 'Luigi', poseOverpaints: [{ id: 'p1', name: 'Idle', poseId: 'pose-a', hashes: [1, 2], ...op(3, 3) }, { id: 'p2', name: 'Walk', hashes: [3], ...op(2, 2, { width: 512, height: 224 }) }] },
];

describe('finding damaged pictures', () => {
  it('reads a PNG’s size and lists every picture, the group’s and each pose’s', () => {
    expect(pngSize(png(7, 5))).toEqual({ width: 7, height: 5 });
    expect(pngSize('not a png')).toBeNull();
    expect(listPictures(groups()).map((p) => p.key)).toEqual(['g1', 'g2#pose:p1', 'g2#pose:p2']);
  });

  it('flags a picture whose stored image is not the size its settings say', () => {
    const d = damagedPictures(groups());
    expect(d.map((p) => p.key)).toEqual(['g2#pose:p2']);
    expect(d[0].reason).toMatch(/512×224.*2×2/);
  });
});

describe('setting a picture aside', () => {
  it('takes it out of its group and keeps it, with its settings, image and why', () => {
    const now = () => new Date('2026-10-07T12:00:00Z');
    const { groups: next, item } = setAside(groups(), { key: 'g2#pose:p2', png: png(2, 2), reason: 'out of step at Save', now });
    expect(next[1].poseOverpaints.map((p) => p.id)).toEqual(['p1']);
    expect(item).toMatchObject({ version: 1, groupId: 'g2', groupName: 'Luigi', pictureId: 'p2', reason: 'out of step at Save', setAsideAt: '2026-10-07T12:00:00.000Z' });
    expect(item.settings).toMatchObject({ name: 'Walk', hashes: [3], width: 512 });
    expect(item.settings.png).toBeUndefined();
    const g = setAside(groups(), { key: 'g1', png: png(4, 2), reason: 'x', now });
    expect(g.groups[0].overpaint).toBeUndefined();
    expect(g.item.pictureId).toBeNull();
  });

  it('round-trips through the pack’s recovery folder, skipping files it cannot read', () => {
    const { item } = setAside(groups(), { key: 'g1', png: png(4, 2), reason: 'x' });
    const folder = recoveryFolderFrom([item]);
    expect(folder[0].name).toBe(`${item.id}.json`);
    const { items, unreadable, unreadableFiles } = itemsFromRecoveryFolder([...folder, { name: 'bad.json', json: '{nope' }]);
    expect(items).toEqual([item]);
    expect(unreadable).toBe(1);
    expect(unreadableFiles).toEqual([{ name: 'bad.json', json: '{nope' }]);
  });
});

describe('putting a picture back', () => {
  it('restores a pose picture at the place given, sized to its image', () => {
    const { groups: gs, item } = setAside(groups(), { key: 'g2#pose:p2', png: png(2, 2), reason: 'x' });
    const r = restorePicture(gs, item, { mapX: 40, mapY: 50 });
    const back = r.groups[1].poseOverpaints.find((p) => p.id === 'p2');
    expect(r.key).toBe('g2#pose:p2');
    expect(back).toMatchObject({ mapX: 40, mapY: 50, width: 2, height: 2, name: 'Walk', hashes: [3] });
  });

  it('will not put a group picture back over one the group has now, nor into a group that is gone', () => {
    const { item } = setAside(groups(), { key: 'g1', png: png(4, 2), reason: 'x' });
    expect(restorePicture(groups(), item, { mapX: 0, mapY: 0 }).error).toMatch(/already has/);
    expect(restorePicture([], item, { mapX: 0, mapY: 0 }).error).toMatch(/no longer/);
  });
});

describe('finding where a picture belongs', () => {
  // A 10×6 map region; tiles are drawn (2) in a 3×2 block at 5,3 and blank (1) elsewhere.
  const plane = { x0: 0, y0: 0, w: 10, h: 6, data: new Uint8Array(60).fill(1) };
  for (let y = 3; y < 5; y++) for (let x = 5; x < 8; x++) plane.data[y * 10 + x] = 2;
  const pic = { width: 3, height: 2, data: new Uint8ClampedArray(3 * 2 * 4).fill(255) };

  it('scores each place by how much paint lands on drawn tile pixels', () => {
    const r = bestPlacement(pic, plane, { x0: 0, y0: 0, x1: 7, y1: 4 });
    expect(r).toMatchObject({ mapX: 5, mapY: 3, score: 1 });
    expect(confidentPlacement(r)).toBe(true);
  });

  it('is not confident when another place far away fits as well', () => {
    plane.data.fill(2);
    const r = bestPlacement(pic, plane, { x0: 0, y0: 0, x1: 7, y1: 4 });
    expect(r.score).toBe(1);
    expect(confidentPlacement(r)).toBe(false);
  });
});
