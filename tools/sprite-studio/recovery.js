/**
 * SpriteStudio's recovered pictures (src/recovery.js) — pictures Save set aside, listed to put back
 * or remove — and the body of a BG group's Overpaint panel, which lists them. Split out of
 * tools/sprite-studio.js, which passes in the state and functions it shares (initRecovery).
 */import { frameState, posesOf } from '../shared/pack-session.js';
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { downloadBlob } from '../../src/art-pack.js';
import { layerArtOf, layerArtPixels, layerArtLoop, layerArtFullHeight, loadArtPixelsFor, layerGeometry } from '../../src/layer-art.js';
import { paintedBounds } from '../../src/overpaint.js';
import { posePictureGroups, savedPoseHashes } from '../../src/pose-overpaint.js';
import { restorePicture, bestPlacement, confidentPlacement, pngSize } from '../../src/recovery.js';
import { touchUpOf, touchUpKey } from '../../src/touch-up.js';
import { copyPixels } from '../../src/layer-art-edit.js';
import { getWindowsTableBytesFromState } from '../../src/vip-world-clip.js';
import { artTarget, clearOverpaint, copyPicture, coverWholeLoop, exportPicture, fillArtScreenHeight, framesPastPicture, groupScreensNote, isPoseCharacter, overpaintMode, overpaintPosePart, overpaintScope, overpaintThisPose, pastePictureFromClipboard, pictureStore, removeOverpaint, setHideTiles, setOverpaintScope, setPaintOn, sourceState, stagePosePatterns, usePictureImage } from './overpaint.js';
import { renderSpriteLists } from './group-list.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initRecovery(context) {
  ctx = context;
}

/* -------------------------------------------------------------- recovery */
// Pictures set aside instead of saved or drawn in the wrong place (src/recovery.js): listed in their
// group's Overpaint panel to put back, export or discard. They live in session.recovered and the
// pack's recovery/ folder until then.

/** The recovered pictures of a group, as a panel section; null when it has none. */
export function recoveredPicturesPart(group) {
  const items = (ctx.session.recovered || []).filter((i) => i.groupId === group.id);
  if (!items.length) return null;
  const wrap = document.createElement('div');
  wrap.id = 'recovered-pictures';
  wrap.className = 'recovered-pictures';
  const h = document.createElement('h4');
  h.textContent = `Recovered pictures (${items.length})`;
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = 'Set aside instead of being saved or drawn in the wrong place. Put back finds where one belongs on this group’s tiles; Export PNG keeps a copy.';
  wrap.append(h, p);
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'recovered-row';
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${item.png}`;
    img.alt = '';
    const size = pngSize(item.png);
    const label = document.createElement('span');
    label.className = 'recovered-label';
    label.textContent = `${item.pictureId ? `Pose “${item.settings.name || item.pictureId}”` : 'All poses'} · ${size ? `${size.width}×${size.height}` : '?'} · ${new Date(item.setAsideAt).toLocaleString()}`;
    label.title = item.reason;
    const button = (text, title, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', onClick);
      return b;
    };
    row.append(
      img,
      label,
      button('Put back', 'Find where it belongs on this group’s tiles and put it back', () => void putBackRecovered(item)),
      button('Export PNG', 'Download its paint as a PNG', () => exportRecovered(item)),
      button('Discard', 'Delete it from the pack (asks first)', () => discardRecovered(item)),
    );
    wrap.append(row);
  }
  return wrap;
}

function exportRecovered(item) {
  const bytes = Uint8Array.from(atob(item.png), (c) => c.charCodeAt(0));
  const name = `${item.groupName}-${item.settings.name || 'picture'}-recovered`.replace(/[^\w.-]+/g, '_');
  downloadBlob(new Blob([bytes], { type: 'image/png' }), `${name}.png`);
  ctx.setStatus('Exported the recovered picture as a PNG.');
}

function discardRecovered(item) {
  if (!window.confirm(`Delete this recovered picture of “${item.groupName}” from the pack? Its paint is gone once you save.`)) return;
  ctx.session.recovered = ctx.session.recovered.filter((x) => x !== item);
  ctx.markDirty();
  renderSpriteLists();
  ctx.renderDetail();
  ctx.setStatus('Recovered picture discarded — Save to make it final.');
}

/**
 * Where a recovered picture belongs. A screen-sized backdrop: where the screen starts in the map on
 * most frames showing its layer. Anything smaller: the place where its paint lands on the most of
 * its group's drawn tile pixels (its pose's tiles, for a pose picture) across the captured frames.
 * @returns {{ mapX: number, mapY: number, confident: boolean, how: string } | null}
 */
function findPlaceFor(item, pixels) {
  const group = ctx.session.groups.find((g) => g.id === item.groupId);
  if (!group) return null;
  const { world, bgmapBase } = item.settings;
  const pose = item.pictureId ? savedPoseHashes(group, item.settings.poseId) || item.settings.hashes : null;
  const want = new Set((pose || group.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  if (!want.size) return null;
  const big = pixels.width >= 300;
  const origins = new Map();
  /** @type {Map<number, number>} map pixel (y * 8192 + x) → 2 drawn / 1 blank */
  const plane = new Map();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < ctx.session.frames.length; i++) {
    const st = frameState(ctx.session, i);
    if (!st?.drawList) continue;
    const win = getWindowsTableBytesFromState(st);
    const g = layerGeometry(win, world, 0);
    if (!g || (bgmapBase != null && g.bgmapBase !== bgmapBase)) continue;
    // Every frame showing any of its tiles on that layer: the fit decides where the paint belongs
    // (a pose captured across layers is never whole on one).
    const mine = st.drawList.filter((d) => !(d.eye ?? 0) && d.world === world && want.has(hashTile(getTileBytes(st.patternTable, d.tileIndex)) >>> 0));
    if (!mine.length) continue;
    if (big) {
      const k = `${g.sx(g.startX)},${g.sy(0)}`;
      origins.set(k, (origins.get(k) || 0) + 1);
      continue;
    }
    for (const d of mine) {
      const tile = getTileBytes(st.patternTable, d.tileIndex);
      const mx = g.sx(d.x);
      const my = g.sy(d.y);
      x0 = Math.min(x0, mx); y0 = Math.min(y0, my); x1 = Math.max(x1, mx + 8); y1 = Math.max(y1, my + 8);
      for (let ty = 0; ty < 8; ty++) {
        for (let tx = 0; tx < 8; tx++) {
          const sx = d.flipH ? 7 - tx : tx;
          const sy = d.flipV ? 7 - ty : ty;
          const word = tile[sy * 2] | (tile[sy * 2 + 1] << 8);
          const k = (my + ty) * 8192 + mx + tx;
          if ((word >> (sx * 2)) & 3) plane.set(k, 2);
          else if (!plane.has(k)) plane.set(k, 1);
        }
      }
    }
  }
  if (big) {
    const best = [...origins].sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const [mapX, mapY] = best[0].split(',').map(Number);
    return { mapX, mapY, confident: false, how: `where the screen starts on ${best[1]} captured frame(s)` };
  }
  if (!Number.isFinite(x0)) return null;
  const w = x1 - x0;
  const h = y1 - y0;
  const data = new Uint8Array(w * h);
  for (const [k, v] of plane) data[(Math.floor(k / 8192) - y0) * w + ((k % 8192) - x0)] = v;
  const box = { x0: x0 - pixels.width + 1, y0: y0 - pixels.height + 1, x1: x1 - 1, y1: y1 - 1 };
  if ((box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1) * pixels.width * pixels.height > 6e7) return null;
  const r = bestPlacement(pixels, { x0, y0, w, h, data }, box);
  if (!r) return null;
  return { mapX: r.mapX, mapY: r.mapY, confident: confidentPlacement(r), how: `${Math.round(r.score * 100)}% of its paint on the group’s tiles` };
}

async function putBackRecovered(item) {
  const pixels = await loadArtPixelsFor(`recovered:${item.id}`, item.png).catch(() => null);
  if (!pixels) {
    ctx.setStatus('Its image could not be read; Export PNG keeps a copy.');
    return;
  }
  const place = findPlaceFor(item, pixels);
  if (!place) {
    ctx.setStatus(`Couldn't find where this picture of “${item.groupName}” belongs (no captured frame shows its tiles). Export PNG keeps a copy.`);
    return;
  }
  if (!place.confident && !window.confirm(`Not sure where this belongs. Best guess: map ${place.mapX}, ${place.mapY} (${place.how}).\n\nPut it back there? You can Remove it from the Overpaint panel if it's wrong.`)) return;
  const r = restorePicture(ctx.session.groups, item, place);
  if ('error' in r) {
    ctx.setStatus(`Couldn't put it back: ${r.error}. Export PNG keeps a copy.`);
    return;
  }
  ctx.session.groups = r.groups;
  if (ctx.selectedGroup) ctx.selectedGroup = ctx.session.groups.find((g) => g.id === ctx.selectedGroup.id) || ctx.selectedGroup;
  pictureStore.replacePixels(r.key, copyPixels(pixels));
  ctx.session.recovered = ctx.session.recovered.filter((x) => x !== item);
  ctx.markDirty();
  ctx.invalidateRender();
  renderSpriteLists();
  ctx.renderStrip();
  ctx.drawStage();
  ctx.renderDetail();
  ctx.setStatus(`Put back at map ${place.mapX}, ${place.mapY} (${place.how}). Check it on a frame that shows it, then Save.`);
}

export function overpaintPanelBody(group) {
  const box = document.createElement('section');
  box.className = 'touch-up-panel overpaint-panel';
  const h = document.createElement('h3');
  h.textContent = 'Overpaint';
  const note = document.createElement('p');
  note.className = 'muted';
  const button = (id, label, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  box.append(h, note);
  const character = isPoseCharacter(group);
  const scopeButton = () =>
    overpaintScope(group) === 'pose'
      ? button('btn-overpaint-scope-all', `Paint all ${posesOf(group).length} poses instead`, 'Paint the group’s own picture, which shows on every pose of this group', () => setOverpaintScope('all'))
      : button('btn-overpaint-scope-pose', 'Back to this pose only', 'Each pose gets a picture of its own, shown only when that whole pose is on screen', () => setOverpaintScope('pose'));
  // Painting this pose only, on a pose with no picture yet: say so, and offer the rest.
  if (overpaintScope(group) === 'pose' && !artTarget() && stagePosePatterns().length) {
    const poses = posePictureGroups(group).length;
    h.textContent = 'Overpaint · this pose';
    note.textContent = `This pose has no overpaint yet. Paint (T) to start one: it shows only when all ${stagePosePatterns().length} tiles of this pose are on screen. ${poses} pose${poses === 1 ? ' has' : 's have'} one of their own.`;
    const row = document.createElement('div');
    row.className = 'layer-art-actions';
    row.append(button('btn-overpaint-create', 'Paint this pose', 'Start this pose’s own picture and switch to Overpaint painting (T)', () => setPaintOn('overpaint')));
    if (layerArtOf(group)) {
      const also = document.createElement('p');
      also.className = 'muted';
      also.textContent = 'The group also has a picture for all its poses; it shows on this one too.';
      box.append(also);
      row.append(button('btn-overpaint-move-pose', 'Move the all-poses overpaint to this pose', 'Make the group’s picture this pose’s own, so it stops showing on the other poses', () => overpaintThisPose(true)));
    }
    row.append(scopeButton());
    box.append(row);
    const screensNote = groupScreensNote(group);
    if (screensNote) box.append(screensNote);
    return box;
  }
  if (character) {
    const scope = document.createElement('div');
    scope.className = 'layer-art-actions';
    scope.id = 'overpaint-scope';
    const what = document.createElement('span');
    what.className = 'muted';
    what.textContent = overpaintScope(group) === 'pose' ? 'Painting this pose only.' : `Painting all ${posesOf(group).length} poses at once.`;
    scope.append(what, scopeButton());
    box.append(scope);
  }
  // On a card whose pose has its own picture, the panel is about that picture.
  const target = artTarget() || group;
  const isPose = !!target.posePictureId;
  if (isPose) h.textContent = `Overpaint · this pose (${target.poseName})`;
  const art = layerArtOf(target);
  const posePart = overpaintPosePart(group, target, button);
  if (!art) {
    const old = touchUpOf(group);
    note.textContent = old
      ? 'This group has an old touch-up that no captured frame shows, so it could not be pinned to the layer. It still draws where its tiles line up. Add overpaint to paint this group the new way; Remove drops the old touch-up.'
      : 'A picture pinned to this group’s layer: paint over its tiles, and blank or transparent pixels, for what tile paint cannot do. It scrolls and zooms with the layer and shows on every frame where the layer is on screen.';
    box.append(button('btn-overpaint-create', 'Add overpaint', 'Start a clear picture on this layer and switch to Overpaint painting (T)', () => setPaintOn('overpaint')));
    if (posePart) box.append(posePart);
    if (old) {
      box.append(button('btn-touchup-remove', 'Remove old touch-up', 'Drop the old touch-up; the tile paint stays', () => {
        if (!window.confirm(`Remove “${group.name || group.id}”’s old touch-up? Its tile paint stays.`)) return;
        const { touchUp: _drop, ...rest } = group;
        pictureStore.forget(touchUpKey(group.id));
        ctx.replaceSelectedGroup(rest);
        ctx.markDirty();
        ctx.invalidateRender();
        ctx.drawStage();
        ctx.renderDetail();
      }));
    }
    return box;
  }
  const ready = !!layerArtPixels(target);
  const scaled = !layerGeometry(getWindowsTableBytesFromState(sourceState() || {}), art.world, ctx.eye());
  const painted = ready ? paintedBounds(layerArtPixels(target)) : null;
  const size = painted ? `${painted.x1 - painted.x0}×${painted.y1 - painted.y0} px painted` : 'nothing painted yet';
  const where = isPose || group.wholePose === true ? 'shows only on this pose' : 'shows wherever this layer is on screen';
  note.textContent = `${size} on world ${art.world}${scaled ? ' (scaled)' : ''} · ${art.hideTiles ? 'shown instead of the layer’s tiles' : 'over the tiles'} · ${where}${pictureStore.isEdited(target.id) ? ' · not saved yet' : ''}${ready ? '' : ' · loading…'}.`;
  const screensNote = groupScreensNote(group);
  if (screensNote) box.append(screensNote);
  if (posePart) box.append(posePart);
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  file.id = 'art-file-input';
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) void usePictureImage(f, `Imported ${f.name}`);
    file.value = '';
  });
  const row = document.createElement('div');
  row.className = 'layer-art-actions';
  if (!art.hideTiles) {
    row.append(button('btn-overpaint-mode', overpaintMode() ? 'Paint tiles' : 'Paint overpaint', 'Switch where strokes go (T)', () => setPaintOn(overpaintMode() ? 'tiles' : 'overpaint')));
  }
  row.append(
    button('btn-art-import', 'Import image…', 'Replace the picture with an image file (scaled to it; Export PNG gives the exact size)', () => file.click()),
    button('btn-art-paste', 'Paste', 'Replace the picture with the image on the clipboard (or press Ctrl+V)', () => void pastePictureFromClipboard()),
    button('btn-art-copy', 'Copy', 'Copy the picture to the clipboard, to edit in a paint program', () => void copyPicture()),
    button('btn-art-export', 'Export PNG', 'Download the picture at its exact size, to edit and import back', () => void exportPicture()),
    button('btn-overpaint-clear', 'Clear', 'Erase the overpaint, keeping it ready to paint', clearOverpaint),
    button('btn-art-remove', 'Remove', 'Drop the overpaint; the tile paint stays', removeOverpaint),
  );
  for (const b of row.querySelectorAll('button')) if (!['btn-art-remove', 'btn-overpaint-mode'].includes(b.id)) b.disabled = !ready;
  box.append(row, file);
  if (!scaled && !isPose) {
    const hide = document.createElement('label');
    hide.className = 'tool-option';
    hide.title = 'The layer shows only the picture: for backdrops built from a few repeated tiles, where tile paint blends together';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'toggle-hide-tiles';
    cb.checked = art.hideTiles;
    cb.disabled = !ready;
    cb.addEventListener('change', () => setHideTiles(cb.checked));
    hide.append(cb, ' Hide the tiles under it');
    box.append(hide);
  }
  // A tile-hiding picture keeps its own size: offer to widen it, seeded from the tiles.
  const stage = art.hideTiles ? sourceState() : null;
  const windows = stage ? getWindowsTableBytesFromState(stage) : null;
  const loop = windows ? layerArtLoop(windows, art.world, ctx.eye()) : null;
  const full = windows ? layerArtFullHeight(windows, art.world, ctx.eye()) : null;
  if (full && art.height < full.height) {
    const tallBtn = button('btn-art-fill-height', "Fill the screen's height", 'Add rows above and below the layer so the space there can be painted (they start see-through — Fill them)', fillArtScreenHeight);
    tallBtn.disabled = !ready;
    box.append(tallBtn);
  }
  if (loop && (art.width < loop.width || art.mapX !== loop.mapX)) {
    const warn = document.createElement('p');
    warn.className = 'muted';
    warn.id = 'art-loop-note';
    warn.textContent = `This picture covers ${art.width} of the layer's ${loop.width} px map loop. If the game starts the layer at another column, the rest shows as plain tiles.`;
    const cover = button('btn-art-cover-loop', 'Cover the whole map', `Widen the picture to the whole ${loop.width} px loop; the new part starts as the tiles look now`, coverWholeLoop);
    cover.disabled = !ready;
    box.append(warn, cover);
  }
  // A backdrop drawn over the tiles: when captured frames scroll its layer past the painted part,
  // say so, and offer the same Cover the whole map (new columns copy painted twins).
  const past = !art.hideTiles && !isPose && ready && !scaled ? framesPastPicture(target, art) : 0;
  if (past) {
    const st = sourceState();
    const wloop = st ? layerArtLoop(getWindowsTableBytesFromState(st), art.world, ctx.eye()) : null;
    const warn = document.createElement('p');
    warn.className = 'muted';
    warn.id = 'art-loop-note';
    warn.textContent = `${past} captured frame${past === 1 ? '' : 's'} scroll this layer past the painted part of the picture, where the plain tiles show. Cover the whole map widens it${wloop ? ` to the ${wloop.width} px map` : ''}; columns showing the same tiles as painted ones start as copies of them.`;
    const cover = button('btn-art-cover-loop', 'Cover the whole map', 'Widen the picture to the whole map; new columns start as copies of painted columns that show the same tiles, the rest clear', coverWholeLoop);
    box.append(warn, cover);
  }
  return box;
}
