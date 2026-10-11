/**
 * The Project tool's File ▸ Clean up frames… window: every captured frame with a thumbnail, its
 * size and why it stays or can go (src/frame-cleanup.js). It only picks frames; the Project tool
 * takes them out and reloads.
 */
import { deserializeVIPState } from '../../src/vip-dump.js';
import { framesInParts, frameBytes, frameContentKeys, planFrameCleanup } from '../../src/frame-cleanup.js';
import { describeUncoloured } from '../../src/uncoloured.js';

/** The window's Show filter: which rows each choice keeps, by the frame's uncoloured counts. */
const SHOW = {
  all: () => true,
  done: (m) => !!m && m.pixels === 0,
  tiles: (m) => !!m && m.tiles > 0,
  pixels: (m) => !!m && m.pixels > 0,
};

const leaf = (name) => String(name || '').replace(/^.*[\\/]/, '').toLowerCase();

/** The screenshot blob for a frame, by its registry file name or its id. */
function screenshotFor(parts, frame) {
  const want = leaf(frame.entry?.screenshotFile) || `${String(frame.frameId).toLowerCase()}.png`;
  return (parts?.screenshotsFolder || []).find((f) => leaf(f.name) === want)?.blob || null;
}

/**
 * Look through the frames in pack parts.
 * @param {Record<string, any>} parts the project as it would be saved
 * @param {(entry: any, vipFile: string) => string} labelOf the frame's name as the Frame list shows it
 * @param {(state: any) => { tiles: number, pixels: number }} [measure] how uncoloured a frame is (src/uncoloured.js)
 */
export function analyzeFrames(parts, labelOf, measure) {
  const frames = framesInParts(parts).map((f) => {
    const screen = (f.entry?.stateName && String(f.entry.stateName).trim()) || '(no state name)';
    let state = null;
    try {
      state = deserializeVIPState(JSON.parse(f.json));
    } catch {
      state = null;
    }
    let uncoloured = null;
    try {
      uncoloured = measure && state ? measure(state) : null;
    } catch {
      uncoloured = null;
    }
    return { ...f, screen, keys: frameContentKeys(state, screen), uncoloured };
  });
  const { rows, suggested } = planFrameCleanup({ frames, groups: parts?.groups || [], references: parts?.manifest?.references });
  const labels = new Map(frames.map((f) => [f.frameId, labelOf(f.entry, f.name)]));
  const items = frames.map((f, i) => ({
    frameId: f.frameId,
    label: labels.get(f.frameId),
    screen: f.screen,
    bytes: frameBytes(parts, f.frameId),
    shot: screenshotFor(parts, f),
    row: rows[i],
    suggested: suggested.has(f.frameId),
    uncoloured: f.uncoloured,
  }));
  return { items, suggested, labels };
}

/** Why a frame stays, or why it can go, in a few words. */
function whyText(item, labels) {
  const { row } = item;
  if (row.poses.length) return `Kept: a pose was captured here (${row.poses[0]}${row.poses.length > 1 ? ` and ${row.poses.length - 1} more` : ''})`;
  if (row.hasReference) return 'Kept: it has a reference picture';
  if (row.duplicateOf) return `Identical to ${labels.get(row.duplicateOf) || row.duplicateOf}`;
  if (item.suggested) return 'Everything it shows is on other frames of this screen';
  if (row.unique) return `${row.unique} tile pattern${row.unique === 1 ? '' : 's'} no other ${item.screen} frame shows`;
  return 'The last frame left showing some of what it shows';
}

/**
 * Show the window; resolves to what to do with which frames, or null when cancelled.
 * @param {ReturnType<typeof analyzeFrames>} analysis
 * @param {(bytes: number) => string} formatBytes
 * @returns {Promise<{ action: 'archive' | 'delete', ids: string[] } | null>}
 */
export function chooseFramesToRemove(analysis, formatBytes) {
  const dialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('frame-cleanup-dialog'));
  const list = document.getElementById('frame-cleanup-list');
  if (!dialog || !list) return Promise.resolve(null);
  const intro = document.getElementById('frame-cleanup-intro');
  const count = document.getElementById('frame-cleanup-count');
  const archiveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('frame-cleanup-archive'));
  const deleteBtn = /** @type {HTMLButtonElement} */ (document.getElementById('frame-cleanup-delete'));
  const { items, labels } = analysis;
  const selected = new Set(analysis.suggested);
  const urls = [];

  const kept = items.filter((it) => it.row.protected).length;
  const total = items.reduce((n, it) => n + it.bytes, 0);
  if (intro) {
    intro.textContent = `${items.length} captured frame${items.length === 1 ? '' : 's'} (${formatBytes(total)} before compression). `
      + `${kept} stay because a pose was captured on them or they have a reference picture. `
      + `${analysis.suggested.size} are suggested: everything they show is on other frames of the same screen, so no tile pattern or screen is lost.`;
  }

  /** @type {Map<string, HTMLInputElement>} */
  const boxes = new Map();
  /** @type {Array<{ head: HTMLElement, rows: Array<{ el: HTMLElement, item: any }> }>} */
  const sections = [];
  const filterSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('frame-cleanup-filter'));
  if (filterSelect) filterSelect.value = 'all';
  /** Hide rows the Show filter leaves out; frames you can't see are unticked so nothing goes unseen. */
  const applyShow = () => {
    const keep = SHOW[filterSelect?.value || 'all'] || SHOW.all;
    for (const sec of sections) {
      let any = false;
      for (const { el, item } of sec.rows) {
        const show = keep(item.uncoloured);
        el.hidden = !show;
        if (show) any = true;
        else selected.delete(item.frameId);
      }
      sec.head.hidden = !any;
    }
  };
  const sync = () => {
    const bytes = items.filter((it) => selected.has(it.frameId)).reduce((n, it) => n + it.bytes, 0);
    if (count) count.textContent = `${selected.size} selected · ${formatBytes(bytes)}`;
    archiveBtn.disabled = deleteBtn.disabled = selected.size === 0;
    for (const [id, box] of boxes) box.checked = selected.has(id);
  };

  list.textContent = '';
  const screens = [...new Set(items.map((it) => it.screen))];
  for (const screen of screens) {
    const inScreen = items.filter((it) => it.screen === screen);
    const head = document.createElement('div');
    head.className = 'frame-cleanup-screen';
    head.textContent = `${screen} · ${inScreen.length} frame${inScreen.length === 1 ? '' : 's'}`;
    list.append(head);
    const section = { head, rows: [] };
    sections.push(section);
    for (const it of inScreen) {
      const row = document.createElement('label');
      row.className = `frame-cleanup-row${it.row.protected ? ' kept' : ''}`;
      row.dataset.frameId = it.frameId;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.disabled = it.row.protected;
      box.addEventListener('change', () => {
        if (box.checked) selected.add(it.frameId);
        else selected.delete(it.frameId);
        sync();
      });
      boxes.set(it.frameId, box);
      let pic;
      if (it.shot) {
        pic = document.createElement('img');
        const url = URL.createObjectURL(it.shot);
        urls.push(url);
        pic.src = url;
        pic.loading = 'lazy';
        pic.alt = '';
      } else {
        pic = document.createElement('span');
        pic.className = 'no-shot';
      }
      const text = document.createElement('span');
      const name = document.createElement('span');
      name.textContent = it.label;
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = it.uncoloured ? `${whyText(it, labels)} · ${describeUncoloured(it.uncoloured)}` : whyText(it, labels);
      text.append(name, document.createElement('br'), why);
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = formatBytes(it.bytes);
      row.append(box, pic, text, size);
      list.append(row);
      section.rows.push({ el: row, item: it });
    }
  }
  sync();

  return new Promise((resolve) => {
    const suggestedBtn = document.getElementById('frame-cleanup-suggested');
    const noneBtn = document.getElementById('frame-cleanup-none');
    const cancelBtn = document.getElementById('frame-cleanup-cancel');
    const onSuggested = () => {
      selected.clear();
      for (const id of analysis.suggested) selected.add(id);
      applyShow();
      sync();
    };
    const onNone = () => {
      selected.clear();
      sync();
    };
    const onShow = () => {
      applyShow();
      sync();
    };
    const done = (value) => {
      suggestedBtn?.removeEventListener('click', onSuggested);
      filterSelect?.removeEventListener('change', onShow);
      noneBtn?.removeEventListener('click', onNone);
      cancelBtn?.removeEventListener('click', onCancel);
      archiveBtn.removeEventListener('click', onArchive);
      deleteBtn.removeEventListener('click', onDelete);
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      for (const url of urls) URL.revokeObjectURL(url);
      list.textContent = '';
      resolve(value);
    };
    const onCancel = () => done(null);
    const onArchive = () => done({ action: 'archive', ids: [...selected] });
    const onDelete = () => {
      const ok = window.confirm(
        `Delete ${selected.size} frame${selected.size === 1 ? '' : 's'}? Once you Save they are gone for good — Archive keeps a copy you can import back.`,
      );
      if (ok) done({ action: 'delete', ids: [...selected] });
    };
    suggestedBtn?.addEventListener('click', onSuggested);
    filterSelect?.addEventListener('change', onShow);
    noneBtn?.addEventListener('click', onNone);
    cancelBtn?.addEventListener('click', onCancel);
    archiveBtn.addEventListener('click', onArchive);
    deleteBtn.addEventListener('click', onDelete);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
  });
}
