import { describe, it, expect } from 'vitest';
import {
  normalizeVbpackFileName,
  formatHomeDirectoryLabel,
  getCachedHomeDirectoryName,
  backupFileName,
  resolveSaveTarget,
  formatHomeStatusLabel,
} from './project-home.js';

describe('normalizeVbpackFileName', () => {
  it('adds .vbpack when missing', () => {
    expect(normalizeVbpackFileName('mario')).toBe('mario.vbpack');
  });

  it('keeps .vbpack / .zip', () => {
    expect(normalizeVbpackFileName('a.vbpack')).toBe('a.vbpack');
    expect(normalizeVbpackFileName('a.ZIP')).toBe('a.ZIP');
  });

  it('strips path-ish characters', () => {
    expect(normalizeVbpackFileName('foo/bar:baz')).toBe('foo-bar-baz.vbpack');
  });

  it('falls back for empty input', () => {
    expect(normalizeVbpackFileName('')).toBe('pack.vbpack');
    expect(normalizeVbpackFileName('   ')).toBe('pack.vbpack');
  });
});

describe('formatHomeDirectoryLabel', () => {
  it('prefers handle name', () => {
    expect(formatHomeDirectoryLabel({ name: 'ColorVB' })).toBe('ColorVB');
  });

  it('falls back to Not set when nothing cached', () => {
    try {
      localStorage.removeItem('vb-project-home-name');
    } catch {
      /* ignore */
    }
    // In node vitest, localStorage may be missing — still expect a string.
    const label = formatHomeDirectoryLabel(null);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    // When no cache, Not set; if env injected a cache, label matches getCached…
    const cached = getCachedHomeDirectoryName();
    expect(label).toBe(cached || 'Not set');
  });
});

describe('backupFileName', () => {
  it('replaces the extension with .bak.vbpack', () => {
    expect(backupFileName('mario.vbpack')).toBe('mario.bak.vbpack');
    expect(backupFileName('mario.zip')).toBe('mario.bak.vbpack');
  });

  it('normalizes odd names first', () => {
    expect(backupFileName('foo/bar')).toBe('foo-bar.bak.vbpack');
    expect(backupFileName('')).toBe('pack.bak.vbpack');
  });
});

describe('resolveSaveTarget', () => {
  const fileHandle = { createWritable: () => {} };
  const home = { getFileHandle: () => {} };

  it('writes to the known pack file when there is one', () => {
    expect(resolveSaveTarget({ fileHandle, home })).toBe('file');
    expect(resolveSaveTarget({ fileHandle })).toBe('file');
  });

  it('falls back to project home, then to a download', () => {
    expect(resolveSaveTarget({ home })).toBe('home');
    expect(resolveSaveTarget({})).toBe('download');
    expect(resolveSaveTarget()).toBe('download');
  });

  it('ignores a handle that cannot be written', () => {
    expect(resolveSaveTarget({ fileHandle: { name: 'stale.vbpack' }, home })).toBe('home');
  });

  it('uses a picker for Save as (download when pickers are unavailable)', () => {
    expect(resolveSaveTarget({ fileHandle, home, saveAs: true })).toBe('download');
  });
});

describe('formatHomeStatusLabel', () => {
  it('describes each state', () => {
    expect(formatHomeStatusLabel({ state: 'granted', name: 'ColorVB' })).toBe('ColorVB');
    expect(formatHomeStatusLabel({ state: 'needs-permission', name: 'ColorVB' })).toBe('ColorVB — needs permission');
    expect(formatHomeStatusLabel({ state: 'unset', name: '' })).toBe('Not set');
    expect(formatHomeStatusLabel({ state: 'unsupported', name: '' })).toBe('Unsupported in this browser');
  });

  it('falls back to Not set without a status', () => {
    expect(formatHomeStatusLabel(null)).toBe('Not set');
    expect(formatHomeStatusLabel()).toBe('Not set');
  });
});
