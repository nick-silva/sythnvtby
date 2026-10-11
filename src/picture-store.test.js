import { describe, it, expect } from 'vitest';
import { createPictureStore, pictureKeyParts, pictureSettingsIn, withPictureSettings } from './picture-store.js';
import { artPixelsFor, clearLayerArtPixels } from './layer-art.js';

const px = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
const op = (width, height) => ({ world: 3, bgmapBase: 0, mapX: 0, mapY: 0, width, height, png: '', hideTiles: false });

function setup(groups) {
  const state = { groups };
  const store = createPictureStore({ getGroups: () => state.groups, setGroups: (g) => (state.groups = g) });
  return { state, store };
}

describe('picture keys', () => {
  it('splits a pose picture key into its group and picture', () => {
    expect(pictureKeyParts('g1')).toEqual({ groupId: 'g1', pictureId: null });
    expect(pictureKeyParts('g1#pose:p2')).toEqual({ groupId: 'g1', pictureId: 'p2' });
  });

  it('reads and writes a pose picture inside its group, keeping its name and patterns', () => {
    const groups = [{ id: 'g', poseOverpaints: [{ id: 'p', name: 'Serve', hashes: [5], ...op(2, 2) }] }];
    const next = withPictureSettings(groups, 'g#pose:p', op(4, 4));
    expect(pictureSettingsIn(next, 'g#pose:p')).toMatchObject({ name: 'Serve', hashes: [5], width: 4, height: 4 });
    expect(groups[0].poseOverpaints[0].width).toBe(2);
    expect(withPictureSettings(groups, 'missing', op(1, 1))).toBe(groups);
  });
});

describe('createPictureStore', () => {
  it('puts settings and pixels together and marks the picture edited', () => {
    const { state, store } = setup([{ id: 'g' }]);
    store.put('g', op(4, 2), px(4, 2));
    expect(state.groups[0].overpaint).toMatchObject({ width: 4, height: 2 });
    expect(store.pixels('g').width).toBe(4);
    expect(store.isEdited('g')).toBe(true);
    clearLayerArtPixels('g');
  });

  it('refuses pixels that are not the size the settings say, changing nothing', () => {
    const { state, store } = setup([{ id: 'g', overpaint: op(4, 2) }]);
    expect(() => store.put('g', op(8, 2), px(4, 2))).toThrow(/4×2.*8×2/);
    expect(() => store.replacePixels('g', px(3, 3))).toThrow(/3×3/);
    expect(state.groups[0].overpaint.width).toBe(4);
    expect(artPixelsFor('g', '')).toBeNull();
    expect(store.isEdited('g')).toBe(false);
  });

  it('removes a picture with null settings: pixels and edited mark go too', () => {
    const { state, store } = setup([{ id: 'g', overpaint: op(1, 1) }]);
    store.replacePixels('g', px(1, 1));
    store.put('g', null, null);
    expect(state.groups[0]).not.toHaveProperty('overpaint');
    expect(store.pixels('g')).toBeNull();
    expect(store.isEdited('g')).toBe(false);
  });

  it('Save stores what it encoded without marking it edited again', () => {
    const { store } = setup([{ id: 'g', overpaint: op(2, 2) }]);
    store.replacePixels('g', px(2, 2));
    expect(store.takeEdited()).toEqual(['g']);
    store.put('g', op(1, 1), px(1, 1), { edited: false });
    expect(store.editedKeys()).toEqual([]);
    clearLayerArtPixels('g');
  });

  it('adopts a stored picture as decoded, and forgets one without touching its settings', () => {
    const { state, store } = setup([{ id: 'g', overpaint: op(2, 2) }]);
    store.adopt('g', px(5, 5));
    expect(store.pixels('g').width).toBe(5);
    expect(store.isEdited('g')).toBe(false);
    store.markEdited('g');
    store.forget('g');
    expect(store.pixels('g')).toBeNull();
    expect(store.isEdited('g')).toBe(false);
    expect(state.groups[0].overpaint.width).toBe(2);
  });

  it('settings without pixels draw from the stored PNG; a key no group owns changes nothing', () => {
    const { state, store } = setup([{ id: 'g' }]);
    expect(store.put('g', op(2, 2), null)).toBe(true);
    expect(state.groups[0].overpaint.width).toBe(2);
    expect(store.pixels('g')).toBeNull();
    expect(store.isEdited('g')).toBe(false);
    expect(store.put('nobody', op(1, 1), px(1, 1))).toBe(false);
    expect(store.pixels('nobody')).toBeNull();
  });

  it('a pose picture is written into its group', () => {
    const { state, store } = setup([{ id: 'g', poseOverpaints: [{ id: 'p', name: 'Serve', hashes: [5], ...op(1, 1) }] }]);
    store.put('g#pose:p', op(3, 3), px(3, 3));
    expect(state.groups[0].poseOverpaints[0]).toMatchObject({ id: 'p', name: 'Serve', width: 3 });
    store.put('g#pose:p', null, null);
    expect(state.groups[0]).not.toHaveProperty('poseOverpaints');
  });
});
