/**
 * SpriteStudio's animation tracks: named tracks of poses with per-step holds and mirroring, the
 * tracks panel and its timeline. Split out of tools/sprite-studio.js, which passes in the state and
 * functions it shares (initTracks).
 */
import { posesOf } from '../shared/pack-session.js';
import { isObjGroup, getEffectiveTracks, updateTrack, trackLengthFrames, trackStepAtFrame } from '../../src/obj-sprite-profiles.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initTracks(context) {
  ctx = context;
}

/* ----------------------------------------------------------------- tracks */

export function currentTracks() {
  return ctx.selectedGroup ? getEffectiveTracks(ctx.selectedGroup) : [];
}

export function currentTrack() {
  const tracks = currentTracks();
  return tracks.find((t) => t.id === ctx.activeTrackId) || tracks[0] || null;
}

/** Tracks are an OBJ idea — a BG group has no poses to sequence. */
export function renderTracksPanel() {
  const panel = ctx.el('tracks-panel');
  const show = !!ctx.selectedGroup && isObjGroup(ctx.selectedGroup);
  panel.hidden = !show;
  if (!show) {
    ctx.stopPlayback();
    return;
  }

  const tracks = currentTracks();
  const select = ctx.el('track-select');
  select.textContent = '';
  for (const t of tracks) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.name} (${trackLengthFrames(t)}f)`;
    select.append(o);
  }
  if (!tracks.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'No tracks yet';
    select.append(o);
  }
  const track = currentTrack();
  ctx.activeTrackId = track?.id || null;
  if (ctx.activeTrackId) select.value = ctx.activeTrackId;

  ctx.el('btn-track-rename').disabled = !track;
  ctx.el('btn-track-delete').disabled = !track;
  ctx.el('btn-track-add-pose').disabled = !track || !ctx.poseViews.length;
  ctx.el('btn-track-play').disabled = !track || !track.steps.length;
  ctx.el('track-length').textContent = track ? `${trackLengthFrames(track)} frame(s) · ${track.steps.length} step(s)` : '—';
  renderTimeline(track);
}

export function renderTimeline(track) {
  const host = ctx.el('timeline');
  host.textContent = '';
  if (!track || !track.steps.length) {
    const p = document.createElement('p');
    p.className = 'timeline-empty';
    p.textContent = track
      ? 'Empty track — show a pose in the filmstrip and press “+ Pose”.'
      : 'No animation track yet. “New…” creates one.';
    host.append(p);
    return;
  }
  const at = trackStepAtFrame(track, ctx.trackFrame);
  const minHold = Math.min(...track.steps.map((st) => Math.max(1, st.holdFrames)));
  const unitRem = Math.min(ctx.STEP_MAX_UNIT_REM, Math.max(ctx.STEP_MIN_UNIT_REM, ctx.STEP_MIN_REM / minHold));
  track.steps.forEach((step, i) => {
    const pose = posesOf(ctx.selectedGroup).find((p) => p.poseId === step.poseId);
    const cell = document.createElement('div');
    cell.className = `timeline-step${at && at.index === i ? ' active' : ''}`;
    cell.setAttribute('role', 'listitem');
    cell.dataset.stepIndex = String(i);
    // Width carries the hold: a pose held twice as long is twice as wide. The
    // shortest step still has to fit its controls, so the frame unit scales per track.
    cell.style.width = `${Math.max(ctx.STEP_MIN_REM, step.holdFrames * unitRem)}rem`;
    const name = document.createElement('span');
    name.className = 'step-name';
    name.textContent = `${step.flipH ? '⇋ ' : ''}${pose?.name || step.poseId}`;

    const controls = document.createElement('span');
    controls.className = 'hold';
    // Edit the hold in place — no need to remove and re-add the step.
    const holdInput = document.createElement('input');
    holdInput.type = 'number';
    holdInput.min = '1';
    holdInput.max = '600';
    holdInput.step = '1';
    holdInput.value = String(step.holdFrames);
    holdInput.className = 'step-hold';
    holdInput.title = 'Frames this pose holds';
    holdInput.addEventListener('click', (e) => e.stopPropagation());
    holdInput.addEventListener('change', () => {
      const next = Math.max(1, Math.min(600, Math.round(Number(holdInput.value) || 1)));
      setTrackSteps(track.steps.map((s, j) => (j === i ? { ...s, holdFrames: next } : s)));
    });
    const unit = document.createElement('span');
    unit.textContent = 'f';

    const mirror = document.createElement('button');
    mirror.type = 'button';
    mirror.className = `step-mirror${step.flipH ? ' active' : ''}`;
    mirror.textContent = '⇋';
    mirror.title = step.flipH ? 'Mirrored — click to face the captured way' : 'Mirror this step';
    mirror.setAttribute('aria-pressed', step.flipH ? 'true' : 'false');
    mirror.addEventListener('click', (e) => {
      e.stopPropagation();
      setTrackSteps(
        track.steps.map((s, j) => {
          if (j !== i) return s;
          const { flipH, ...rest } = s;
          return flipH ? rest : { ...rest, flipH: true };
        }),
      );
      showStep(track.steps[i] ? { ...track.steps[i], flipH: !track.steps[i].flipH } : null);
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'step-delete';
    del.textContent = '✕';
    del.title = 'Remove this step';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      setTrackSteps(track.steps.filter((_, j) => j !== i));
    });
    controls.append(holdInput, unit, mirror, del);
    cell.append(name, controls);
    cell.addEventListener('click', () => {
      ctx.stopPlayback();
      // Move the playhead to this step so the highlight and playback start here.
      ctx.trackFrame = track.steps.slice(0, i).reduce((n, st) => n + Math.max(1, st.holdFrames), 0);
      showStep(step);
      renderTimeline(track);
    });
    cell.addEventListener('wheel', (e) => {
      // Scrub the hold without leaving the timeline.
      e.preventDefault();
      const next = Math.max(1, step.holdFrames + (e.deltaY < 0 ? 1 : -1));
      setTrackSteps(track.steps.map((s, j) => (j === i ? { ...s, holdFrames: next } : s)));
    });
    host.append(cell);
  });
}

/** Show a track step's pose, mirrored if the step says so. */
function showStep(step) {
  if (!step) return;
  const idx = ctx.poseViews.findIndex((v) => v.pose.poseId === step.poseId);
  if (idx >= 0) ctx.setPoseIndex(idx, { keepTrackFrame: true, mirror: step.flipH === true });
}

export function setTrackSteps(steps) {
  const track = currentTrack();
  if (!track || !ctx.selectedGroup) return;
  ctx.replaceSelectedGroup(updateTrack(ctx.selectedGroup, track.id, { steps }));
  ctx.setStatus(`Track “${track.name}”: ${steps.length} step(s), ${steps.reduce((n, s) => n + s.holdFrames, 0)} frame(s).`);
}
