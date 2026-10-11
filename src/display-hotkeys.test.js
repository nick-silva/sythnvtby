import { describe, it, expect } from 'vitest';
import { displayHotkeyAction, nextDisplayState, describeDisplay, SWAP_DISPLAY_KEY, TOGGLE_MONO_KEY } from './display-hotkeys.js';

const key = (k, extra = {}) => ({ key: k, repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, target: { tagName: 'CANVAS' }, ...extra });

describe('displayHotkeyAction', () => {
  it('maps F9 to swap and F10 to toggling Monochrome', () => {
    expect(displayHotkeyAction(key(SWAP_DISPLAY_KEY))).toBe('swap');
    expect(displayHotkeyAction(key(TOGGLE_MONO_KEY))).toBe('toggle-mono');
    expect(displayHotkeyAction(key('F8'))).toBeNull();
  });

  it('ignores key repeat, modifiers and typing in a field', () => {
    expect(displayHotkeyAction(key('F9', { repeat: true }))).toBeNull();
    expect(displayHotkeyAction(key('F9', { shiftKey: true }))).toBeNull();
    expect(displayHotkeyAction(key('F10', { target: { tagName: 'input' } }))).toBeNull();
    expect(displayHotkeyAction(key('F10', { target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull();
  });
});

describe('nextDisplayState', () => {
  const s = (mono, color, palette = false) => ({ mono, color, palette });

  it('swap flips between colour alone and monochrome alone', () => {
    expect(nextDisplayState(s(true, false), 'swap')).toEqual(s(false, true));
    expect(nextDisplayState(s(false, true), 'swap')).toEqual(s(true, false));
  });

  it('swap goes to colour from both-on, palette or nothing', () => {
    expect(nextDisplayState(s(true, true), 'swap')).toEqual(s(false, true));
    expect(nextDisplayState(s(false, false, true), 'swap')).toEqual(s(false, true));
    expect(nextDisplayState(s(false, false), 'swap')).toEqual(s(false, true));
  });

  it('toggle-mono flips only the monochrome picture, and leaves palette for plain monochrome', () => {
    expect(nextDisplayState(s(false, true), 'toggle-mono')).toEqual(s(true, true));
    expect(nextDisplayState(s(true, true), 'toggle-mono')).toEqual(s(false, true));
    expect(nextDisplayState(s(false, false, true), 'toggle-mono')).toEqual(s(true, false));
  });
});

describe('describeDisplay', () => {
  it('names what is on', () => {
    expect(describeDisplay({ mono: true, color: true, palette: false })).toBe('Color over Monochrome');
    expect(describeDisplay({ mono: false, color: true, palette: false })).toBe('Color');
    expect(describeDisplay({ mono: true, color: false, palette: false })).toBe('Monochrome');
  });
});
