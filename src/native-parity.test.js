import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildFixturePack } from '../tests/fixtures/fixture-pack.mjs';

/**
 * Browser vs native colour parity on the synthetic fixture pack (native/README.md, "Colour parity
 * with the browser"): the JS compositor renders every frame, the C++ colour layer renders the same
 * frames from the play pack, and every pixel of both eyes must match. Runs where the native build
 * exists (`native/build`); skipped elsewhere, e.g. in CI.
 */
const ROOT = resolve(import.meta.dirname, '..');
const PARITY = ['native/build/tests/Release/vbcolor-parity.exe', 'native/build/tests/vbcolor-parity']
  .map((p) => resolve(ROOT, p))
  .find((p) => existsSync(p));

describe.skipIf(!PARITY)('native colour parity (fixture pack)', () => {
  it('the C++ colour layer draws every frame exactly like the browser', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vbc-parity-'));
    try {
      const pack = join(dir, 'fixture.vbpack');
      writeFileSync(pack, await buildFixturePack());
      const golden = join(dir, 'golden');
      const make = spawnSync(process.execPath, [resolve(ROOT, 'native/tests/parity/make-golden.mjs'), pack, golden], { encoding: 'utf8' });
      expect(make.status, make.stderr || make.stdout).toBe(0);
      const run = spawnSync(PARITY, [golden], { encoding: 'utf8' });
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toMatch(/\b0 differ\b/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
