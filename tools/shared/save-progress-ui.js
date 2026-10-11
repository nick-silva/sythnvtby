/**
 * The save progress window, shared by the Project tool and SpriteStudio.
 *
 * Both write the same `.vbpack` through the same zip, and both take seconds on a real project,
 * so both show the same thing: the steps, which one is running, how long each took, and the
 * file being packed. The state model is `src/save-progress.js`; this is only its rendering.
 *
 * Expects the markup in each page: `#save-progress-dialog` containing `#save-progress-title`,
 * `#save-progress-bar` > `#save-progress-fill`, `#save-progress-now`, `#save-progress-steps`
 * and `#save-progress-close`.
 */

import { createSaveProgress, VBPACK_SAVE_STEPS } from '../../src/save-progress.js';

const MARK = { pending: '·', running: '▸', done: '✓', failed: '✕' };

function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/** A duration the way a person reads it. */
function formatMs(ms) {
  if (ms === null || ms === undefined) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/**
 * Let the browser paint. Saving is synchronous JavaScript between the async steps, so without
 * yielding the window would go straight from empty to finished.
 */
const yieldToPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

export function createSaveProgressUi() {
  const el = (id) => document.getElementById(id);
  const dialog = /** @type {HTMLDialogElement|null} */ (el('save-progress-dialog'));
  let progress = null;

  function render() {
    if (!progress || !dialog) return;
    const snap = progress.snapshot();
    const fill = el('save-progress-fill');
    const bar = el('save-progress-bar');
    const now = el('save-progress-now');
    const list = el('save-progress-steps');
    if (fill) fill.style.width = `${snap.percent}%`;
    if (bar) bar.setAttribute('aria-valuenow', String(snap.percent));
    if (now) {
      now.textContent = snap.failed
        ? snap.failure
        : snap.done
          ? `Saved in ${(snap.elapsedMs / 1000).toFixed(1)}s.`
          : `${snap.running?.label ?? 'Starting'}…${snap.running?.note ? ` ${snap.running.note}` : ''}`;
    }
    if (list) {
      list.innerHTML = snap.steps
        .map((st) => {
          const note = st.status !== 'running' && st.note ? ` <span class="muted">${escapeHtml(st.note)}</span>` : '';
          return `<li class="is-${st.status}"><span class="mark">${MARK[st.status]}</span>`
            + `<span>${escapeHtml(st.label)}${note}</span><span class="ms">${formatMs(st.ms)}</span></li>`;
        })
        .join('');
    }
    const close = /** @type {HTMLButtonElement|null} */ (el('save-progress-close'));
    if (close) close.hidden = !(snap.done || snap.failed);
  }

  el('save-progress-close')?.addEventListener('click', () => dialog?.close());

  /** Buttons for a failure's ways out, just before Close; none clears them. */
  function showActions(actions) {
    const close = el('save-progress-close');
    if (!close) return;
    let box = el('save-progress-actions');
    if (!box) {
      box = document.createElement('span');
      box.id = 'save-progress-actions';
      box.style.display = 'inline-flex';
      box.style.gap = '0.35rem';
      box.style.marginRight = '0.35rem';
      close.before(box);
    }
    box.replaceChildren(
      ...actions.map((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        if (a.id) b.id = a.id;
        b.textContent = a.label;
        if (a.title) b.title = a.title;
        b.addEventListener('click', () => {
          dialog?.close();
          void a.run();
        });
        return b;
      }),
    );
  }

  return {
    /** Open the window for one save. */
    async begin(title, steps = VBPACK_SAVE_STEPS) {
      showActions([]);
      progress = createSaveProgress(steps, () => performance.now());
      const h = el('save-progress-title');
      if (h) h.textContent = title;
      render();
      if (dialog && !dialog.open) dialog.showModal();
      await yieldToPaint();
    },

    /** Move to the next step, giving the window a chance to show the one just finished. */
    async step(id, note = '') {
      if (!progress) return;
      progress.begin(id, note);
      render();
      await yieldToPaint();
    },

    finish(id, note = '') {
      if (!progress) return;
      progress.finish(id, note);
      render();
    },

    /** Progress inside the running step, and what it is working on. */
    update(id, percent, note) {
      if (!progress) return;
      progress.setPercent(id, percent);
      if (note) progress.setNote(id, note);
      render();
    },

    /**
     * Leave the window up on failure so the message can be read; close it on success. `actions`
     * are ways out of a failure (Save as…, Download a copy): buttons beside Close, each closing
     * the window and running its `run`.
     * @param {{ failedAt?: string | null, message?: string, actions?: Array<{ id?: string, label: string, title?: string, run: () => unknown }> }} [opts]
     */
    end({ failedAt = null, message = '', actions = [] } = {}) {
      if (!progress) return;
      if (failedAt) progress.fail(failedAt, message);
      else progress.complete();
      render();
      showActions(failedAt ? actions : []);
      if (!failedAt) dialog?.close();
      progress = null;
    },

    /** Close without recording a failure — the save simply did not happen. */
    abandon() {
      if (!progress) return;
      progress = null;
      dialog?.close();
    },

    /** The running step's id, for reporting a failure against whatever was in flight. */
    runningStepId() {
      return progress?.snapshot().running?.id ?? null;
    },

    isOpen() {
      return !!dialog?.open;
    },
  };
}
