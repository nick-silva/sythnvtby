import { describe, it, expect } from 'vitest';
import { withFrameNumbers, frameNumberOf, frameTag, frameReference, findFrame } from './frame-numbers.js';

const reg = [
  { frameId: 'f-muytuaaa-eimjli', stateName: 'InGame' },
  { frameId: 'f-mupruxba-ega2in', stateName: 'Intro', number: 4 },
  { frameId: 'f-muytucpx-0mncji', stateName: 'InGame', name: 'Serve' },
];

describe('withFrameNumbers', () => {
  it('numbers the frames that have none after the highest number, in order, keeping existing ones', () => {
    const { registry, added } = withFrameNumbers(reg);
    expect(added).toBe(2);
    expect(registry.map((e) => e.number)).toEqual([5, 4, 6]);
    expect(reg[0].number).toBeUndefined(); // the original is untouched
  });

  it('the same array when every frame has a number; a repeated number keeps the first', () => {
    const numbered = withFrameNumbers(reg).registry;
    expect(withFrameNumbers(numbered).registry).toBe(numbered);
    const twice = withFrameNumbers([{ frameId: 'a', number: 2 }, { frameId: 'b', number: 2 }]).registry;
    expect(twice.map((e) => e.number)).toEqual([2, 3]);
    expect(withFrameNumbers(null).registry).toBeNull();
  });
});

describe('naming a frame', () => {
  const numbered = withFrameNumbers(reg).registry;
  it('a tag and a one-line reference', () => {
    expect(frameNumberOf(numbered[0])).toBe(5);
    expect(frameTag(numbered[0])).toBe('#5');
    expect(frameTag({})).toBe('');
    expect(frameReference(numbered[2])).toBe('#6 · Serve · f-muytucpx-0mncji');
    expect(frameReference(numbered[0])).toBe('#5 · InGame · f-muytuaaa-eimjli');
  });
});

describe('findFrame', () => {
  const numbered = withFrameNumbers(reg).registry;
  it('by number, with or without #', () => {
    expect(findFrame(numbered, '#5')).toMatchObject({ how: 'number', entry: { frameId: 'f-muytuaaa-eimjli' } });
    expect(findFrame(numbered, '4')?.entry.frameId).toBe('f-mupruxba-ega2in');
    expect(findFrame(numbered, '#99')).toBeNull();
  });

  it('by name or id, case ignored', () => {
    expect(findFrame(numbered, 'serve')).toMatchObject({ how: 'name', entry: { frameId: 'f-muytucpx-0mncji' } });
    expect(findFrame(numbered, 'F-MUPRUXBA-EGA2IN')).toMatchObject({ how: 'id' });
  });

  it('an id with a typo or two, when one frame is clearly closest', () => {
    expect(findFrame(numbered, 'f-muyuaaa-eimjli')).toMatchObject({ how: 'near', entry: { frameId: 'f-muytuaaa-eimjli' } });
    expect(findFrame(numbered, 'f-zzzzzzzz-zzzzzz')).toBeNull();
    expect(findFrame(numbered, '')).toBeNull();
  });
});
