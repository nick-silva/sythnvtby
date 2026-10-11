/**
 * Project health: the questions "This pixel" answers for one spot, asked of every captured frame,
 * and summed up as a short list — each issue named once however many frames show it, with one fix
 * and an example frame and pixel to look at.
 *
 * Checks (left eye; the right eye mostly repeats it):
 *  - world: a group's tiles are drawn on a world it does not paint, and come out uncoloured there
 *    (the game moved them; src/group-worlds.js has the rule for when a world counts as the group).
 *  - order: two groups paint the same tiles in different colours; the one listed first wins
 *    (src/group-order.js). Only a problem where the other is on screen without it; when both are
 *    always on screen together the order cannot help, and the list just says so.
 *  - overpaint: a layer scrolls past its group's picture and the group's tiles show uncoloured.
 *  - picture: an overpaint picture is damaged (src/recovery.js).
 *  - condition: a group's condition names a game state the project does not have (it is ignored).
 *  - screen: captured frames no screen recognises (a to-do: screen limits treat them as other screens).
 *  - unpainted: tiles in a group that are not painted yet — a to-do rather than a problem.
 *
 * Nothing here changes anything; the Project tool shows the list (File ▸ Check project…).
 */

import { buildGroupTileColorIndex, resolveGroupTileMatch } from './color-layer.js';
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { decodeGroupTileColors } from './group-tile-colors.js';
import { groupMiss, groupLabel } from './pixel-explain.js';
import { sharedTileWins, litPixelOfDraw, picturesOnFrame, pictureCovers, pictureBeside, coveredByPictures } from './group-order.js';
import { MIN_SHARE, minTilesForGroup } from './group-worlds.js';
import { damagedPictures } from './recovery.js';
import { groupConditionsOf, projectGameStates } from './game-states.js';

const W = 384;
const H = 224;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * @typedef {{ kind: 'select-group', groupId: string, label: string }
 *   | { kind: 'add-world', groupId: string, world: number, label: string }
 *   | { kind: 'move-before', groupId: string, beforeId: string, label: string }
 *   | { kind: 'new-question', groupId: string, name: string, sides: string[], label: string }
 *   | { kind: 'analyze-memory', groupId: string, label: string }} HealthFix
 *
 * @typedef {{
 *   key: string,
 *   kind: 'world' | 'order' | 'overpaint' | 'picture' | 'condition' | 'screen' | 'unpainted',
 *   problem: boolean,
 *   groupId: string,
 *   sentence: string,
 *   frames: number,
 *   tiles: number,
 *   example: { frameIndex: number, x: number, y: number } | null,
 *   fix: HealthFix,
 * }} HealthIssue
 */

/**
 * @param {{ groups: any[], pack?: Map<number, Uint8Array> }} project
 */
export function createHealthScan({ groups, pack = new Map() }) {
  const all = Array.isArray(groups) ? groups : [];
  /** @type {Map<string, { kind: HealthIssue['kind'], groupId: string, frames: Set<number>, hashes: Set<number>, example: HealthIssue['example'], data: any }>} */
  const acc = new Map();
  const note = (key, kind, groupId, frameIndex, hash, at, data = null) => {
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { kind, groupId, frames: new Set(), hashes: new Set(), example: null, data }));
    a.frames.add(frameIndex);
    if (hash != null) a.hashes.add(hash);
    if (!a.example && at) a.example = { frameIndex, ...at };
  };
  // Groups whose paint can drop out on another world: pinned to worlds, with paint.
  /** @type {Map<number, any[]>} hash → pinned, painted groups including it */
  const pinnedByHash = new Map();
  for (const g of all) {
    const c = g?.criteria || {};
    if (!Array.isArray(c.windowIds) || !c.windowIds.length || !Array.isArray(c.hashes) || !decodeGroupTileColors(g).size) continue;
    for (const h of c.hashes) {
      const k = Number(h) >>> 0;
      if (!pinnedByHash.has(k)) pinnedByHash.set(k, []);
      pinnedByHash.get(k).push(g);
    }
  }
  const parentOf = (g) => all.find((x) => x.id === (g.poseOf || g.id)) || g;
  /** @type {Map<string, { winnerId: string, loserId: string, hashes: Set<number>, loserOnly: Set<number>, winnerOnly: Set<number>, together: Set<number>, example: HealthIssue['example'], togetherExample: HealthIssue['example'] }>} */
  const orders = new Map();

  /** Shared tiles on this frame (not under a picture), sorted by which group is really on screen. */
  function noteOrders(frameIndex, state, shown, covered) {
    for (const p of sharedTileWins(state, shown, 0, covered)) {
      const key = `order:${p.winner.id}:${p.loser.id}`;
      let o = orders.get(key);
      if (!o) {
        o = { winnerId: p.winner.id, loserId: p.loser.id, hashes: new Set(), loserOnly: new Set(), winnerOnly: new Set(), together: new Set(), example: null, togetherExample: null };
        orders.set(key, o);
      }
      if (!p.loserElsewhere) {
        // Only the winner is here, and its colours are the right ones — but letting the other
        // group win would break this frame.
        if (p.winnerElsewhere) o.winnerOnly.add(frameIndex);
        continue;
      }
      for (const h of p.hashes) o.hashes.add(h);
      const at = p.example ? { frameIndex, ...p.example } : null;
      if (p.winnerElsewhere) {
        o.together.add(frameIndex);
        o.togetherExample ||= at;
      } else {
        o.loserOnly.add(frameIndex);
        o.example ||= at;
      }
    }
  }

  /** Per group: the patterns past its picture's edge that showed uncoloured. */
  const overpaintBare = new Map();

  /** Overpaint on this draw's layer: whether a picture covers it, and the pictures it is outside. */
  function artsAround(artsByWorld, d, cx, cy) {
    let inside = false;
    const outside = [];
    for (const e of artsByWorld.get(Number(d.world)) || []) {
      if (pictureCovers(e, cx, cy)) inside = true;
      else outside.push(e);
    }
    return { inside, outside };
  }

  /** The worlds each pinned group's tiles are drawn on, this frame. */
  function countWorlds(worldsOf, shownSet, d, hash, coloured, state) {
    if (d.world == null) return;
    const sprite = Number(d.layer) === 2;
    for (const g of pinnedByHash.get(hash) || []) {
      if (!shownSet.has(g)) continue;
      if ((Array.isArray(g.criteria.layers) && g.criteria.layers.map(Number).includes(2)) !== sprite) continue;
      if (!worldsOf.has(g.id)) worldsOf.set(g.id, new Map());
      const byWorld = worldsOf.get(g.id);
      const w = Number(d.world);
      if (!byWorld.has(w)) byWorld.set(w, { all: new Set(), bare: new Set(), at: null });
      const slot = byWorld.get(w);
      slot.all.add(hash);
      if (!coloured) {
        slot.bare.add(hash);
        if (!slot.at) slot.at = litPixelOfDraw(state, d);
      }
    }
  }

  /** A world counts as the group's when it draws enough of it (src/group-worlds.js), uncoloured. */
  function noteMovedWorlds(worldsOf, frameIndex) {
    for (const [id, byWorld] of worldsOf) {
      const g = all.find((x) => x.id === id);
      const own = new Set(g.criteria.windowIds.map(Number));
      const minTiles = minTilesForGroup(g);
      const busiest = Math.max(0, ...[...byWorld.values()].map((s) => s.all.size));
      for (const [w, s] of byWorld) {
        if (own.has(w) || s.bare.size < minTiles || s.all.size < busiest * MIN_SHARE) continue;
        for (const h of s.bare) note(`world:${id}:${w}`, 'world', id, frameIndex, h, s.at, { world: w });
      }
    }
  }

  /** Frames whose memory no screen recognises, while the project has screens. */
  const unrecognised = [];

  /**
   * @param {number} frameIndex
   * @param {any} state a VIP frame
   * @param {any[]} shown the groups shown on this frame (screen limits applied), in list order
   * @param {Set<string> | null} [screens] the screens its memory matches (null: unknown, or no screens)
   */
  function addFrame(frameIndex, state, shown, screens = null) {
    if (screens && !screens.size) unrecognised.push(frameIndex);
    if (!state?.drawList || !state.patternTable) return;
    const index = buildGroupTileColorIndex(shown);
    const pictures = picturesOnFrame(state, shown, all, 0);
    /** @type {Map<number, Array<{ group: any, art: any, world: number, geo: any }>>} */
    const artsByWorld = new Map();
    for (const p of pictures) {
      if (!artsByWorld.has(p.world)) artsByWorld.set(p.world, []);
      // A pose's picture is sized to the pose; only a group's own picture scrolls with the map.
      artsByWorld.get(p.world).push({ ...p, group: parentOf(p.group), pose: p.group !== parentOf(p.group) || p.group.wholePose === true });
    }
    const shownSet = new Set(shown);
    const worldsOf = new Map();
    /** @type {Map<number, number | null>} */
    const hashBySlot = new Map();
    for (const d of state.drawList) {
      if ((Number(d.eye) === 1 ? 1 : 0) !== 0) continue;
      let hash = hashBySlot.get(d.tileIndex);
      if (hash === undefined) {
        const bytes = getTileBytes(state.patternTable, d.tileIndex);
        hash = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
        hashBySlot.set(d.tileIndex, hash);
      }
      if (hash === null) continue;
      const cx = d.x + 4;
      const cy = d.y + 4;
      if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
      const coloured = pack.has(hash) || !!resolveGroupTileMatch(index, d, hash);
      // Inside a picture the picture paints it; outside, the picture's own group's tiles left
      // uncoloured are the picture not reaching.
      // A group's tiles past its picture's edge: uncoloured, or (beside a backdrop, scrolled past
      // its painted part) in their plain tile paint, which does not match the picture.
      let gap = false;
      if (Number(d.layer ?? 0) === 0) {
        const around = artsAround(artsByWorld, d, cx, cy);
        if (around.inside) continue;
        for (const e of around.outside) {
          if (groupMiss(d, e.group, hash)) continue;
          if (coloured && (e.pose || !pictureBeside(e, cx, cy))) continue;
          if (!coloured) gap = true;
          note(`overpaint:${e.group.id}`, 'overpaint', e.group.id, frameIndex, hash, litPixelOfDraw(state, d));
          if (!coloured) {
            if (!overpaintBare.has(e.group.id)) overpaintBare.set(e.group.id, new Set());
            overpaintBare.get(e.group.id).add(hash);
          }
        }
      }
      countWorlds(worldsOf, shownSet, d, hash, coloured, state);
      if (coloured || gap) continue;
      const member = shown.find((g) => !groupMiss(d, g, hash));
      if (member && !decodeGroupTileColors(member).has(hash)) {
        note(`unpainted:${member.id}`, 'unpainted', member.id, frameIndex, hash, litPixelOfDraw(state, d));
      }
    }
    noteMovedWorlds(worldsOf, frameIndex);
    noteOrders(frameIndex, state, shown, coveredByPictures(pictures));
  }

  /** @param {(id: string) => string} name @returns {HealthIssue[]} */
  function orderIssues(name) {
    const out = [];
    for (const [key, o] of orders) {
      const W = name(o.winnerId);
      const L = name(o.loserId);
      const t = o.hashes.size;
      const tiles = plural(t, 'tile');
      const base = { key, kind: /** @type {const} */ ('order'), groupId: o.loserId, tiles: t };
      const select = { kind: /** @type {const} */ ('select-group'), groupId: o.loserId, label: `Select ${L}` };
      if (o.loserOnly.size && !o.winnerOnly.size) {
        out.push({
          ...base,
          problem: true,
          frames: o.loserOnly.size,
          example: o.example,
          sentence: `${L}: on ${plural(o.loserOnly.size, 'frame')} it is on screen without ${W}, and ${t} of its tiles ${t === 1 ? 'takes' : 'take'} ${W}’s colours — ${W} also paints ${t === 1 ? 'it' : 'them'} and is listed first.`,
          fix: { kind: 'move-before', groupId: o.loserId, beforeId: o.winnerId, label: `Let ${L} win` },
        });
      } else if (o.loserOnly.size) {
        out.push({
          ...base,
          problem: true,
          frames: o.loserOnly.size,
          example: o.example,
          sentence: `${L}: on ${plural(o.loserOnly.size, 'frame')} ${t} of its tiles ${t === 1 ? 'takes' : 'take'} ${W}’s colours (${W} also paints ${t === 1 ? 'it' : 'them'} and is listed first), but on ${plural(o.winnerOnly.size, 'frame')} ${W} is on screen without it — changing the order would only swap which one looks wrong. Tell them apart by a game state (a question answered from recordings), or limit one to its own screens.`,
          fix: { kind: 'new-question', groupId: o.loserId, name: `Which is it: ${W} or ${L}?`, sides: [W, L], label: 'Tell them apart…' },
        });
      } else if (o.together.size) {
        out.push({
          ...base,
          problem: false,
          frames: o.together.size,
          example: o.togetherExample,
          sentence: `${W} and ${L} are on screen together on ${plural(o.together.size, 'frame')} and both paint ${tiles}: one pattern on one layer takes one group’s colour, so ${t === 1 ? 'it shows' : 'they show'} ${W}’s (listed first).`,
          fix: select,
        });
      }
    }
    return out;
  }

  /** @returns {HealthIssue[]} problems first, then by frames */
  function issues() {
    const byId = new Map(all.map((g) => [g.id, g]));
    const name = (id) => groupLabel(byId.get(id) || { id });
    const select = (id) => ({ kind: /** @type {const} */ ('select-group'), groupId: id, label: `Select ${name(id)}` });
    /** @type {HealthIssue[]} */
    const out = [];
    for (const p of damagedPictures(all)) {
      out.push({
        key: `picture:${p.key}`,
        kind: 'picture',
        problem: true,
        groupId: p.group.id,
        sentence: `${groupLabel(p.group)}: its ${p.pictureId ? 'pose picture' : 'overpaint'} is damaged — ${p.reason}. Opening the project in SpriteStudio sets it aside so it can be put back.`,
        frames: 0,
        tiles: 0,
        example: null,
        fix: select(p.group.id),
      });
    }
    const states = new Set(projectGameStates().map((x) => x.id));
    for (const g of all) {
      for (const c of groupConditionsOf(g).filter((x) => !states.has(x.state))) {
        out.push({
          key: `condition:${g.id}:${c.state}`,
          kind: 'condition',
          problem: true,
          groupId: g.id,
          sentence: `${groupLabel(g)}: its condition on “${c.state}” is ignored — the project has no game state by that id. Select the group to remove it or pick another.`,
          frames: 0,
          tiles: 0,
          example: null,
          fix: select(g.id),
        });
      }
    }
    for (const [key, a] of acc) {
      const g = byId.get(a.groupId);
      if (!g) continue;
      const n = a.frames.size;
      const t = a.hashes.size;
      const base = { key, kind: a.kind, groupId: g.id, frames: n, tiles: t, example: a.example };
      if (a.kind === 'world') {
        const own = g.criteria.windowIds.map(Number).sort((x, y) => x - y);
        out.push({
          ...base,
          problem: true,
          sentence: `${name(g.id)}: its tiles are drawn on world ${a.data.world} on ${plural(n, 'frame')}, and its paint drops out there — it only paints world${own.length === 1 ? '' : 's'} ${own.join(', ')}.`,
          fix: { kind: 'add-world', groupId: g.id, world: a.data.world, label: `Add world ${a.data.world}` },
        });
      } else if (a.kind === 'overpaint') {
        out.push({
          ...base,
          problem: true,
          sentence: (() => {
            const bare = overpaintBare.get(g.id)?.size || 0;
            const how = bare === t ? 'uncoloured' : bare ? `in their plain tile paint (${bare} uncoloured)` : 'in their plain tile paint, not the picture';
            return `${name(g.id)}: on ${plural(n, 'frame')} its layer scrolls past its overpaint, and ${t} of its tiles ${t === 1 ? 'shows' : 'show'} past the picture's edge ${how}. SpriteStudio's Cover the whole map widens the picture.`;
          })(),
          fix: select(g.id),
        });
      } else {
        out.push({
          ...base,
          problem: false,
          sentence: `${name(g.id)}: ${t} of its tiles ${t === 1 ? 'is' : 'are'} not painted yet (seen on ${plural(n, 'frame')}).`,
          fix: select(g.id),
        });
      }
    }
    out.push(...orderIssues(name).filter((i) => byId.has(i.groupId)));
    if (unrecognised.length) {
      out.push({
        key: 'screen:unrecognised',
        kind: 'screen',
        problem: false,
        groupId: '',
        sentence: `${plural(unrecognised.length, 'captured frame')} ${unrecognised.length === 1 ? 'is' : 'are'} not recognised as any screen: screen limits treat ${unrecognised.length === 1 ? 'it' : 'them'} as some other screen. Analyze memory again with more frames of each screen.`,
        frames: unrecognised.length,
        tiles: 0,
        example: { frameIndex: unrecognised[0], x: 192, y: 112 },
        fix: { kind: 'analyze-memory', groupId: '', label: 'Analyze memory…' },
      });
    }
    return out.sort((x, y) => Number(y.problem) - Number(x.problem) || y.frames - x.frames || y.tiles - x.tiles || x.key.localeCompare(y.key));
  }

  return { addFrame, issues };
}

/**
 * Every check over a list of frames at once (the tools run createHealthScan a few frames at a
 * time so a big project does not freeze the page).
 * @param {{ groups: any[], pack?: Map<number, Uint8Array> }} project
 * @param {Array<{ frameIndex: number, state: any, shown?: any[], screens?: Set<string> | null }>} frames `shown` defaults to every group
 */
export function checkProject(project, frames) {
  const scan = createHealthScan(project);
  for (const f of frames) scan.addFrame(f.frameIndex, f.state, f.shown || project.groups || [], f.screens ?? null);
  return scan.issues();
}
