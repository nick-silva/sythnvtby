/**
 * The state behind the save progress window.
 *
 * Saving a `.vbpack` is several seconds of work — a project with a hundred captured frames
 * carries their RAM dumps and screenshots, so the zip alone is most of it. A single status
 * line at the end cannot say whether it is nearly finished or stuck, so this tracks the steps
 * and what each one cost.
 *
 * Pure state: no DOM and no clock of its own, so a test can drive it frame by frame.
 */

/** @typedef {'pending'|'running'|'done'|'failed'} StepStatus */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   status: StepStatus,
 *   percent: number|null,
 *   ms: number|null,
 *   note: string,
 * }} SaveProgressStep
 */

/**
 * @param {Array<{ id: string, label: string, weight?: number }>} steps in the order they run
 * @param {() => number} [now] injectable clock, in milliseconds
 */
export function createSaveProgress(steps, now = () => Date.now()) {
  const defs = (Array.isArray(steps) ? steps : [])
    .filter((s) => s && typeof s.id === 'string' && s.id)
    .map((s) => ({ id: s.id, label: s.label || s.id, weight: s.weight > 0 ? s.weight : 1 }));
  const totalWeight = defs.reduce((a, s) => a + s.weight, 0) || 1;

  /** @type {Map<string, SaveProgressStep & { weight: number, startedAt: number|null }>} */
  const state = new Map();
  for (const d of defs) {
    state.set(d.id, {
      id: d.id,
      label: d.label,
      weight: d.weight,
      status: 'pending',
      percent: null,
      ms: null,
      note: '',
      startedAt: null,
    });
  }

  let startedAt = null;
  let finishedAt = null;
  let failure = '';

  const get = (id) => state.get(id) || null;

  return {
    /** Mark a step as running. */
    begin(id, note = '') {
      const s = get(id);
      if (!s || s.status === 'done' || s.status === 'failed') return;
      if (startedAt === null) startedAt = now();
      s.status = 'running';
      s.startedAt = now();
      s.percent = null;
      if (note) s.note = note;
    },

    /**
     * Update what a running step is working on, without disturbing its progress. `begin`
     * resets percent, so a per-file callback must not use it to change the label.
     */
    setNote(id, note) {
      const s = get(id);
      if (!s || s.status !== 'running') return;
      s.note = typeof note === 'string' ? note : '';
    },

    /** Progress inside one step, 0..100. Only meaningful for steps that can report it. */
    setPercent(id, percent) {
      const s = get(id);
      if (!s || s.status !== 'running') return;
      const n = Number(percent);
      if (!Number.isFinite(n)) return;
      s.percent = Math.max(0, Math.min(100, n));
    },

    finish(id, note = '') {
      const s = get(id);
      if (!s || s.status === 'done' || s.status === 'failed') return;
      s.ms = s.startedAt === null ? 0 : Math.max(0, now() - s.startedAt);
      s.status = 'done';
      s.percent = 100;
      if (note) s.note = note;
    },

    /** The step that broke, and why. Everything after it stays pending. */
    fail(id, message = '') {
      failure = message || 'Save failed.';
      finishedAt = now();
      const s = get(id);
      if (!s) return;
      s.ms = s.startedAt === null ? 0 : Math.max(0, now() - s.startedAt);
      s.status = 'failed';
      s.note = failure;
    },

    /** Called when every step is through, so the window can show a total. */
    complete() {
      if (finishedAt === null) finishedAt = now();
    },

    /**
     * What to render. `percent` is weighted across steps so a long zip does not make the bar
     * sit still: a running step contributes its own percent when it reports one.
     */
    snapshot() {
      let weighted = 0;
      for (const s of state.values()) {
        if (s.status === 'done') weighted += s.weight;
        else if (s.status === 'running' && s.percent !== null) weighted += (s.weight * s.percent) / 100;
      }
      const steps = [...state.values()].map(({ weight, startedAt: _started, ...rest }) => ({ ...rest }));
      const running = steps.find((s) => s.status === 'running') || null;
      return {
        steps,
        percent: Math.round((weighted / totalWeight) * 100),
        running,
        failed: failure !== '',
        failure,
        done: failure === '' && steps.length > 0 && steps.every((s) => s.status === 'done'),
        elapsedMs: startedAt === null ? 0 : Math.max(0, (finishedAt ?? now()) - startedAt),
      };
    },
  };
}

/**
 * The same steps, for a save that hands the pack to another page instead of writing a file.
 * Save and Play and the SpriteStudio handoff are just as slow, and were just as silent.
 */
export const VBPACK_HANDOFF_STEPS = [
  { id: 'check', label: 'Checking the project', weight: 1 },
  { id: 'collect', label: 'Collecting colours, groups and frames', weight: 2 },
  { id: 'zip', label: 'Packing the .vbpack', weight: 12 },
  { id: 'write', label: 'Handing it over', weight: 4 },
  { id: 'sync', label: 'Tidying up', weight: 1 },
];

/** The steps a `.vbpack` save goes through, weighted by how long each tends to take. */
export const VBPACK_SAVE_STEPS = [
  { id: 'check', label: 'Checking the project', weight: 1 },
  { id: 'collect', label: 'Collecting colours, groups and frames', weight: 2 },
  { id: 'zip', label: 'Packing the .vbpack', weight: 12 },
  { id: 'write', label: 'Writing to disk', weight: 4 },
  { id: 'sync', label: 'Tidying up', weight: 1 },
];
