import { describe, it, expect } from 'vitest';
import { QUICK_CAPTURE_KEY, isQuickCaptureHotkey } from './frame-capture.js';

function keyEvent(overrides = {}) {
  return {
    key: QUICK_CAPTURE_KEY,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    target: { tagName: 'CANVAS', isContentEditable: false },
    ...overrides,
  };
}

describe('isQuickCaptureHotkey', () => {
  it('accepts a plain F8 press', () => {
    expect(isQuickCaptureHotkey(keyEvent())).toBe(true);
  });

  it('ignores other keys and auto-repeat', () => {
    expect(isQuickCaptureHotkey(keyEvent({ key: 'F9' }))).toBe(false);
    expect(isQuickCaptureHotkey(keyEvent({ repeat: true }))).toBe(false);
  });

  it('ignores F8 with modifiers', () => {
    expect(isQuickCaptureHotkey(keyEvent({ ctrlKey: true }))).toBe(false);
    expect(isQuickCaptureHotkey(keyEvent({ shiftKey: true }))).toBe(false);
  });

  it('ignores F8 while typing in a form field', () => {
    expect(isQuickCaptureHotkey(keyEvent({ target: { tagName: 'INPUT' } }))).toBe(false);
    expect(isQuickCaptureHotkey(keyEvent({ target: { tagName: 'TEXTAREA' } }))).toBe(false);
    expect(isQuickCaptureHotkey(keyEvent({ target: { tagName: 'DIV', isContentEditable: true } }))).toBe(false);
  });
});
