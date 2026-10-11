import { describe, it, expect } from 'vitest';
import { createSaveProgress, VBPACK_SAVE_STEPS } from './save-progress.js';

/** A clock the test moves by hand, so timings are exact rather than flaky. */
function fakeClock() {
  let t = 1000;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

const STEPS = [
  { id: 'a', label: 'First', weight: 1 },
  { id: 'b', label: 'Second', weight: 3 },
];

describe('createSaveProgress', () => {
  it('starts with everything pending and nothing done', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    const s = p.snapshot();
    expect(s.percent).toBe(0);
    expect(s.running).toBeNull();
    expect(s.done).toBe(false);
    expect(s.steps.map((x) => x.status)).toEqual(['pending', 'pending']);
  });

  it('reports the step that is running', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    p.begin('a');
    expect(p.snapshot().running).toMatchObject({ id: 'a', label: 'First', status: 'running' });
  });

  it('records how long each step took', () => {
    const now = fakeClock();
    const p = createSaveProgress(STEPS, now);
    p.begin('a');
    now.advance(250);
    p.finish('a');
    now.advance(1000);
    p.begin('b');
    now.advance(90);
    p.finish('b');
    p.complete();
    const s = p.snapshot();
    expect(s.steps.map((x) => x.ms)).toEqual([250, 90]);
    expect(s.elapsedMs).toBe(1340);
    expect(s.done).toBe(true);
  });

  it('weights the bar, so a heavy step dominates', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    p.begin('a');
    p.finish('a');
    // 'a' is 1 of 4 total weight.
    expect(p.snapshot().percent).toBe(25);
  });

  it('moves the bar inside a step that reports percent', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    p.finish('a');
    p.begin('b');
    p.setPercent('b', 50);
    // 1/4 done, plus half of the remaining 3/4.
    expect(p.snapshot().percent).toBe(63);
  });

  it('clamps and ignores nonsense percents', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    p.begin('b');
    p.setPercent('b', 500);
    expect(p.snapshot().steps[1].percent).toBe(100);
    p.setPercent('b', -10);
    expect(p.snapshot().steps[1].percent).toBe(0);
    p.setPercent('b', Number.NaN);
    expect(p.snapshot().steps[1].percent).toBe(0);
  });

  it('only accepts percent for a step that is running', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    p.setPercent('b', 50);
    expect(p.snapshot().steps[1].percent).toBeNull();
    expect(p.snapshot().percent).toBe(0);
  });

  it('keeps later steps pending when one fails, and says why', () => {
    const now = fakeClock();
    const p = createSaveProgress(STEPS, now);
    p.begin('a');
    now.advance(40);
    p.fail('a', 'The disk said no.');
    const s = p.snapshot();
    expect(s.failed).toBe(true);
    expect(s.failure).toBe('The disk said no.');
    expect(s.done).toBe(false);
    expect(s.steps.map((x) => x.status)).toEqual(['failed', 'pending']);
    expect(s.steps[0].ms).toBe(40);
    expect(s.steps[0].note).toBe('The disk said no.');
  });

  it('stops the clock when it fails, so the total does not keep counting', () => {
    const now = fakeClock();
    const p = createSaveProgress(STEPS, now);
    p.begin('a');
    now.advance(40);
    p.fail('a');
    now.advance(5000);
    expect(p.snapshot().elapsedMs).toBe(40);
  });

  it('will not resurrect a finished or failed step', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    p.finish('a');
    p.begin('a');
    expect(p.snapshot().steps[0].status).toBe('done');
  });

  it('shrugs at an unknown step id', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    expect(() => {
      p.begin('nope');
      p.setPercent('nope', 10);
      p.finish('nope');
    }).not.toThrow();
    expect(p.snapshot().percent).toBe(0);
  });

  it('changes a running step’s note without losing its progress', () => {
    // The zip reports a filename per entry. Routing that through begin() reset percent, so
    // the bar sat still for the longest step of the save.
    const p = createSaveProgress(STEPS, fakeClock());
    p.begin('b');
    p.setPercent('b', 40);
    p.setNote('b', 'screenshots/f-abc123.png');
    const s = p.snapshot();
    expect(s.steps[1].note).toBe('screenshots/f-abc123.png');
    expect(s.steps[1].percent).toBe(40);
  });

  it('ignores a note for a step that is not running', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    p.setNote('b', 'nope');
    expect(p.snapshot().steps[1].note).toBe('');
  });

  it('carries a note onto the step it belongs to', () => {
    const p = createSaveProgress(STEPS, fakeClock());
    p.begin('a');
    p.finish('a', '153.5 MB');
    expect(p.snapshot().steps[0].note).toBe('153.5 MB');
  });

  it('survives being given no steps at all', () => {
    const p = createSaveProgress(null, fakeClock());
    const s = p.snapshot();
    expect(s.steps).toEqual([]);
    expect(s.percent).toBe(0);
    expect(s.done).toBe(false);
  });
});

describe('VBPACK_SAVE_STEPS', () => {
  it('runs in the order a save actually happens, with the zip weighted heaviest', () => {
    expect(VBPACK_SAVE_STEPS.map((s) => s.id)).toEqual(['check', 'collect', 'zip', 'write', 'sync']);
    const heaviest = VBPACK_SAVE_STEPS.reduce((a, b) => (b.weight > a.weight ? b : a));
    expect(heaviest.id).toBe('zip');
  });

  it('reaches exactly 100% once every step is done', () => {
    const p = createSaveProgress(VBPACK_SAVE_STEPS, fakeClock());
    for (const s of VBPACK_SAVE_STEPS) {
      p.begin(s.id);
      p.finish(s.id);
    }
    expect(p.snapshot().percent).toBe(100);
    expect(p.snapshot().done).toBe(true);
  });
});
