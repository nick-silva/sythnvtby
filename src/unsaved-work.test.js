import { describe, it, expect } from 'vitest';
import { discardCapturesPrompt, unsavedCapturesNote, captureGapsNote, discardProjectChangesPrompt } from './unsaved-work.js';

describe('discardCapturesPrompt', () => {
  it('names the count, the action and how to keep the captures', () => {
    const text = discardCapturesPrompt(3, 'Load ROM');
    expect(text).toMatch(/^3 captured frames are not saved yet\. Load ROM will throw them away\./);
    expect(text).toMatch(/Colorize! or Export \.vbpack/);
    expect(text).toMatch(/Load ROM anyway\?$/);
  });

  it('uses the singular for one capture', () => {
    expect(discardCapturesPrompt(1, 'Load pack')).toMatch(/^1 captured frame is not saved yet\. Load pack will throw it away\./);
  });
});

describe('unsavedCapturesNote', () => {
  it('is empty with nothing unsaved', () => {
    expect(unsavedCapturesNote(0)).toBe('');
  });

  it('says how many and what keeps them', () => {
    expect(unsavedCapturesNote(2)).toBe('2 captures not saved — Colorize! or Export .vbpack to keep them');
    expect(unsavedCapturesNote(1)).toBe('1 capture not saved — Colorize! or Export .vbpack to keep it');
  });
});

describe('captureGapsNote', () => {
  it('is empty for a complete capture', () => {
    expect(captureGapsNote({ wram: true, screenshot: true })).toBe('');
  });

  it('warns that a capture without memory is skipped by Analyze memory', () => {
    expect(captureGapsNote({ wram: false, screenshot: true })).toBe('Saved without its memory snapshot (Analyze memory will skip it).');
    expect(captureGapsNote({ wram: false, screenshot: false })).toMatch(/memory snapshot .* or a screenshot\.$/);
  });
});

describe('discardProjectChangesPrompt', () => {
  it('names the action twice: what it does and the question', () => {
    expect(discardProjectChangesPrompt('Open pack')).toBe(
      'This project has unsaved changes. Open pack will throw them away.\n\nSave first to keep them. Open pack anyway?',
    );
  });
});
