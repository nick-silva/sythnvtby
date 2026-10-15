/**
 * The emulator's Poses panel: which characters' kept poses the frame on screen shows and which pose
 * pictures were drawn (src/frame-poses.js), live while it plays and as you step frame by frame — to
 * track down the frame where the wrong picture, or none, shows. **Copy** puts the report on the
 * clipboard with the frame number, for a bug note.
 *
 * The list is rebuilt only when its text changes, so it holds still on a paused frame.
 */
import { describeFramePoses, posesOnFrame } from './frame-poses.js';
import { groupsForScreen } from './screen-gate.js';

/** How often the panel reads the last frame coloured. */
const LIVE_MS = 250;

/**
 * @param {{
 *   root: HTMLElement,
 *   read: () => ({ state: any, wram: Uint8Array | null, groups: any[], gameStatePools: unknown[], drawn: Set<string> } | null),
 *   colourOn: () => boolean,
 * }} deps `read`: the last frame the colour layer drew (src/color-layer.js lastFrame)
 */
export function createPosesPanel({ root, read, colourOn }) {
  const head = document.createElement('div');
  head.className = 'poses-head';
  const title = document.createElement('strong');
  title.textContent = 'Poses on this frame';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn-secondary';
  copy.textContent = 'Copy';
  copy.title = 'Copy this report, with the frame number, as text';
  const note = document.createElement('span');
  note.className = 'poses-note';
  head.append(title, copy, note);
  const list = document.createElement('div');
  list.className = 'poses-list';
  root.replaceChildren(head, list);
  let shownText = '';
  let lines = /** @type {string[]} */ ([]);
  let timer = null;

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      note.textContent = 'Copied.';
    } catch {
      note.textContent = 'The browser would not copy; select the text instead.';
    }
  });

  /** The report's lines for the last frame, or why there is none. */
  function report() {
    if (!colourOn()) return ['Switch the display to Color: the panel reports what the colour layer draws.'];
    const frame = read();
    if (!frame?.state) return ['No frame coloured yet. Load a pack with groups and play.'];
    const shownGroups = groupsForScreen(frame.groups, frame.gameStatePools, frame.wram);
    const shown = shownGroups === frame.groups ? null : new Set(shownGroups.map((g) => g.id));
    const characters = posesOnFrame({ state: frame.state, groups: frame.groups, eye: 0, shown, drawn: frame.drawn });
    return describeFramePoses(characters, { frame: frame.state.frameNumber ?? null, eye: 0 });
  }

  function render() {
    if (root.hidden) return;
    lines = report();
    const text = lines.join('\n');
    if (text === shownText) return;
    shownText = text;
    note.textContent = '';
    list.replaceChildren(
      ...lines.map((line, i) => {
        const row = document.createElement('div');
        row.className = i === 0 ? 'poses-frame' : line.startsWith('  ') ? 'poses-pose' : 'poses-character';
        row.textContent = line.trim();
        return row;
      }),
    );
  }

  return {
    render,
    toggle() {
      root.hidden = !root.hidden;
      if (root.hidden) {
        clearInterval(timer);
        timer = null;
        return;
      }
      shownText = '';
      render();
      timer = setInterval(render, LIVE_MS);
    },
  };
}
