/**
 * One project model for every app (refactor plan C1, docs/planning/refactor-plan.md). The emulator,
 * the sythnvtby Player, the Project tool and SpriteStudio each open a `.vbpack` and draw frames in
 * colour; this is the one way they turn a pack into colour inputs ({@link projectFromParsed}) and
 * the one way they drive the compositor ({@link colourOptions}, {@link renderProjectFrame}), so a
 * colour rule added once reaches all of them.
 *
 * A *view* names how a frame is being drawn — played, previewed in a tool, or measured — which is
 * what used to differ, call site by call site.
 */
import { parseVBColorPack } from './vbcolor-pack.js';
// color-layer.js imports this module too: nothing here may use it while modules load.
import { parsePositionOverrides, compositeColorFrameForEye } from './color-layer.js';
import { FADE_RESPONSE_DEFAULT } from './fade.js';
import { normalizeGroup } from './group-schema.js';
import { withFrameNumbers } from './frame-numbers.js';
import { packPaintsTransparent, withPaintOnTransparent, withoutTransparentPaint, patternBytesFromFrames } from './transparent-paint.js';
import { decodeGroupTileColors } from './group-tile-colors.js';

/**
 * @typedef {{
 *   label: string,
 *   gameId: string,
 *   manifest: any,
 *   frameRegistry: any[],
 *   pack: Map<number, Uint8Array>,
 *   overrides: any[],
 *   groups: any[],
 *   gameStatePools: any[],
 *   gameStates: any[],
 *   painterV2Rules: Record<string, unknown> | null,
 *   paintsTransparent: boolean,
 * }} Project
 */

/**
 * The colour project in a parsed pack (src/art-pack.js `parseArtPack`): pack colours, position
 * overrides, groups through the group schema, screens (pools), game states, the older paint rules,
 * and whether paint on transparent pixels is intentional. Frames without a short number get one.
 * Pure: the parsed pack is not changed.
 * @param {any} parsed
 * @param {{ label?: string }} [opts]
 * @returns {Project}
 */
export function projectFromParsed(parsed, { label = 'pack.vbpack' } = {}) {
  const numbered = withFrameNumbers(Array.isArray(parsed?.manifest?.frameRegistry) ? parsed.manifest.frameRegistry : null);
  const manifest = parsed?.manifest ? (numbered.added ? { ...parsed.manifest, frameRegistry: numbered.registry } : parsed.manifest) : null;
  let pack = new Map();
  let gameId = (typeof manifest?.gameId === 'string' && manifest.gameId.trim()) || label.replace(/\.vbpack$/i, '');
  if (parsed?.vbcolor && parsed.vbcolor.byteLength > 0) {
    const vb = parseVBColorPack(parsed.vbcolor);
    if (vb) {
      pack = new Map(vb.entries);
      if (typeof vb.gameId === 'string' && vb.gameId.trim()) gameId = vb.gameId.trim();
    }
  }
  const rules = parsed?.painterV2Rules;
  return {
    label,
    gameId,
    manifest,
    frameRegistry: numbered.registry,
    pack,
    overrides: (parsed?.overrides != null ? parsePositionOverrides(parsed.overrides) : []).filter((o) => o.rgba).map((o) => ({ ...o })),
    groups: (Array.isArray(parsed?.groups) ? parsed.groups : []).map(normalizeGroup),
    gameStatePools: Array.isArray(parsed?.gameStatePools) ? parsed.gameStatePools : [],
    gameStates: Array.isArray(parsed?.gameStates) ? parsed.gameStates : [],
    painterV2Rules: rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : null,
    paintsTransparent: packPaintsTransparent(manifest),
  };
}

/**
 * A pack saved before paint on transparent pixels was drawn (src/transparent-paint.js) may hold
 * stray strokes there that never showed. The authoring tools clear them once, so nothing changes on
 * screen, and flag the manifest so such paint is intentional from then on. Returns the new pack,
 * groups and manifest, and what was cleared (null when the pack was already flagged).
 * @param {{ pack: Map<number, Uint8Array>, groups: any[], manifest: any }} project
 * @param {number} frameCount @param {(i: number) => any} frameAt a captured frame's VIP state
 */
export function withoutStrayTransparentPaint(project, frameCount, frameAt) {
  const { pack, groups, manifest } = project;
  if (packPaintsTransparent(manifest)) return { pack, groups, manifest, cleared: null };
  const wanted = new Set(pack.keys());
  for (const g of groups) for (const h of decodeGroupTileColors(g).keys()) wanted.add(h >>> 0);
  const bytesOf = patternBytesFromFrames(frameCount, frameAt, wanted);
  const shared = withoutTransparentPaint(pack, bytesOf);
  const cleared = { pixels: shared.pixels, tiles: shared.tiles, unknown: shared.unknown };
  const nextGroups = groups.map((g) => {
    const own = decodeGroupTileColors(g);
    if (!own.size) return g;
    const r = withoutTransparentPaint(own, bytesOf);
    cleared.unknown += r.unknown;
    if (!r.pixels) return g;
    cleared.pixels += r.pixels;
    cleared.tiles += r.tiles;
    return { ...g, tileColors: r.entries };
  });
  return { pack: shared.pixels ? shared.entries : pack, groups: nextGroups, manifest: withPaintOnTransparent(manifest), cleared };
}

/**
 * How each kind of drawing calls the compositor:
 * - `play` — the emulator and the player: unpainted pixels stay transparent over the monochrome
 *   frame; paint on transparent pixels only when the pack says it is intentional.
 * - `toolPreview` — the Project tool and SpriteStudio: no monochrome picture underneath, so an
 *   unpainted tile draws its VIP shade (the Project tool asks for its red ramp with
 *   `diagnosticMonoFallback`); paint on transparent pixels always shows.
 * - `measure` — how much of a frame is uncoloured (src/uncoloured.js): plain shades, no fades.
 */
export const VIEWS = Object.freeze({
  play: Object.freeze({ unpackedMinCoverage: 2, diagnosticMonoFallback: false, renderUnpackedFallback: false, monoFallbackGain: 1 }),
  toolPreview: Object.freeze({ unpackedMinCoverage: 1, diagnosticMonoFallback: false, renderUnpackedFallback: true, monoFallbackGain: 1, drawTransparentPaint: true, brightnessScale: FADE_RESPONSE_DEFAULT }),
  measure: Object.freeze({ unpackedMinCoverage: 1, diagnosticMonoFallback: false, renderUnpackedFallback: true, monoFallbackGain: 1, drawTransparentPaint: true, brightnessScale: 1 }),
});

/**
 * The compositor's options (src/color-layer.js `compositeColorFrame`) for drawing a frame of this
 * project in this view. `frame` is what belongs to the one frame — `eye`, `wram` (the frame's or
 * the game's memory, for screens, game states and RAM-gated overrides), `painterV2VariantId` — and
 * anything a caller must set differently (e.g. `groups` without touch-ups, a preview brightness).
 * @param {Pick<Project, 'overrides' | 'groups' | 'gameStatePools' | 'painterV2Rules'> & { paintsTransparent?: boolean }} project
 * @param {keyof typeof VIEWS} view
 * @param {Record<string, any>} [frame]
 */
export function colourOptions(project, view, frame = {}) {
  const preset = VIEWS[view];
  if (!preset) throw new Error(`unknown view "${view}"`);
  return {
    eye: 0,
    overrides: project.overrides || [],
    groups: project.groups || [],
    gameStatePools: project.gameStatePools || null,
    wram: null,
    painterV2Rules: project.painterV2Rules || null,
    painterV2VariantId: null,
    drawTransparentPaint: !!project.paintsTransparent,
    ...preset,
    ...frame,
  };
}

/**
 * Draw one eye of a frame of this project into `imageData` (384×224 RGBA), in this view. The right
 * eye of a layer the game draws twice takes colour from the left eye (compositeColorFrameForEye).
 * @param {Project} project
 * @param {any} state a VIP state (src/vip-dump.js)
 * @param {{ data: Uint8ClampedArray }} imageData
 * @param {keyof typeof VIEWS} view
 * @param {Record<string, any>} [frame] see {@link colourOptions}
 */
export function renderProjectFrame(project, state, imageData, view, frame = {}) {
  return compositeColorFrameForEye(state, project.pack, imageData, colourOptions(project, view, frame));
}
