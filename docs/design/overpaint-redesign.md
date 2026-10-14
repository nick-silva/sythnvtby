---
status: partial
last-reviewed: 2026-10-13
covers: src/overpaint.js, src/touch-up.js, src/layer-art.js, src/affine-base.js, src/affine-world.js, src/color-layer.js, tools/sprite-studio.js, tools/sprite-studio/, tools/shared/pack-session.js, tools/painter.js, tools/painter/, native/core/src/colorizer.cpp, native/core/src/play_pack.cpp
---

# Overpaint: one picture per group, pinned to its layer

**Status:** built Oct 4–5 2026 (see §9 for what was built and how it differs from this plan); HBias
layers, a whole-map view and Follow its tiles are still open. How to use it: the
[user guide](../guide/user-guide.md#overpaint-paint-over-a-background-layer).

## 1. Why

SpriteStudio grew several ways to put colour on a group, each added for one case. Together they
are hard to reason about, and the newest of them (touch-ups) fails silently in a common case.

| Concept | What it is | Positioned by | Where it shows |
|---|---|---|---|
| **Tile paint** | Colours per tile pattern (a group's own, or the shared pack for sprites) | Nothing — every copy of the pattern | Wherever the group's tiles are drawn |
| **Touch-up** (`src/touch-up.js`) | A picture box over a BG group | Its **anchor tile** plus the arrangement of the tiles around it (screen space) | Only where ≥ 60% of that arrangement is on screen around a copy of the anchor |
| **Touch-up on a scaled layer** | The same, painted on Base tiles | Map cells (the layer's BG map) | Through the layer's scaling, where ≥ 60% of the arrangement's map cells are read |
| **Layer art** (`src/layer-art.js`) | A picture that *replaces* a whole layer's tiles | The layer's BG map (`mapX`/`mapY`), sampled through the VIP's scroll mapping | Wherever the group is on screen on that world (normal BG worlds only) |
| **Old overlays** | Screen-pinned pictures (`painter-v2-vip-overlays.json`) | Exact screen position | Converted to touch-ups when a pack opens |

Around them sit helpers that change where the others show: the group's **anchor hash**, **Base
tiles**, **poses**, **frame cards**, **One set**. A user has to know which of these is in play
to predict what a stroke will do and where it will appear.

## 2. The failure that prompted this (Mario's Tennis, DonkeyKongJrBacklog)

DonkeyKongJrBacklog is a BG group on world 30 (the crowd backdrop) with a full-screen touch-up
(384 × 224) pinned to an anchor tile and 207 tiles around it.

- On 18 captured frames the arrangement matches 207/207 and the touch-up draws.
- On 4 frames world 30 has scrolled: its map X goes from 112 to 0, the anchor tile moves from
  x = 354 to x = 34, and most of the recorded arrangement is off screen. The best match anywhere
  is 60/207, under the 60% threshold, so **the touch-up is not drawn on those frames**.
- Those 4 frames show more of the group (214 tiles against 207), so SpriteStudio's frame cards
  lead with them, and the 207-tile frames fold into them (their tiles are a subset). Every card
  is a frame where the touch-up is not placed: it neither shows nor can be edited in SpriteStudio,
  though the emulator and the Project tool still draw it on the 18 frames where it fits.

Screen-space arrangement matching breaks whenever a layer scrolls far enough to change what is
around the anchor, and whenever the game redraws the surroundings. A full-screen touch-up on a
backdrop is really doing layer art's job, positioned the fragile way.

## 3. Proposal

Two kinds of paint instead of four:

1. **Tiles** — unchanged: colours per tile pattern.
2. **Overpaint** — one picture per group, stored in the **map coordinates of the group's layer**
   and drawn over the group's tiles at the layer's depth:
   - **Normal BG worlds:** sampled through the same mapping layer art uses (`worldGeometry` in
     `src/layer-art.js`: screen x → MX ± MP + x − DestX, screen y → MY + y − GY), so it scrolls,
     keeps stereo parallax and stays put however far the layer scrolls.
   - **Scaled (affine) worlds:** drawn through the VIP's sampling, as touch-ups made on Base tiles
     already are (`affineTouchUps` / `paintAffineTouchUp` in `src/touch-up.js`, map cell per
     pixel from `sampleAffineWorld`).
   - **HBias worlds:** per-row offset added to the normal mapping (not done anywhere yet).
   - **Hide the tiles under it** (a per-group switch) turns overpaint into today's layer art: the
     layer's tiles are skipped where the picture is opaque, or everywhere when the picture covers
     the whole layer.

What goes away:

- The **anchor + arrangement** placement, and with it the 60% threshold and "not on this frame".
- The **touch-up box** (Grow / Shrink / Fill screen): overpaint covers the layer; you paint where
  you want and it keeps what you paint (stored cropped to the painted area).
- **Layer art** as a separate concept: it becomes overpaint with "hide the tiles under it".
- **Base tiles as a requirement for touch-ups on scaled layers:** overpaint on a scaled card is
  painted through the scaling, like tile paint already is. (Base tiles stays as a view.)

## 4. UX sketch (SpriteStudio)

- **Paint on:** **Tiles** | **Overpaint** (T toggles). Overpaint mode keeps today's amber cues.
- Overpaint shows on **every card** whose frame shows the group's layer — no "this spot only".
- Tools: Brush, Fill, Swap, Pick, Clone, Import / Paste / Copy / Export PNG, Clear.
- One switch in the Overpaint panel: **Hide the tiles under it** (today's "Replace layer with art").
- The Project tool keeps a read-only line and pill, as for touch-ups now; the emulator draws it.

## 5. Data and migration

- New group field, replacing `touchUp` and `layerArt`:
  `overpaint: { world, bgmapBase, mapX, mapY, width, height, png, hideTiles }` — the shape layer
  art already has, plus `hideTiles`. For a scaled world, `mapX`/`mapY` are map pixels as the
  Base tiles view lays them out.
- **Layer art** converts directly (`hideTiles: true`).
- **Touch-ups** convert on open: find a captured frame where the touch-up is placed, map its box
  from screen to the layer's map with that frame's scroll (the inverse of `worldGeometry`), and
  copy the pixels. A touch-up placed on no captured frame is kept as is and reported, so nothing
  is lost silently. Old overlays already convert to touch-ups, so they take the same path.
- Bump the groups schema version; old tools ignore `overpaint` and would show tile paint only.

## 6. Trade-offs and open questions

- **Objects the game redraws at a different map position** (rather than scrolling) — some score
  digits, a character drawn into different map cells per frame — lose their overpaint where they
  move. Tile paint still covers them. If that matters, a per-group **Follow its tiles** option could
  keep today's arrangement placement for those groups only.
- **Groups that hop worlds** (Mario's Tennis moves its players between worlds 21 and 22 to keep the
  depth order right): overpaint is per world map. If both worlds draw the same BG map region, one
  picture can serve both; if not, the group needs one overpaint per world, or the hop has to be
  resolved first (the **Worlds** suggestions in the Project tool handle the tile-paint side).
- **A group whose tiles appear in several places in one map** (repeated scenery): overpaint is one
  picture in the map, so each place gets its own paint — which is usually what "this spot only"
  meant anyway.
- **Sprites (OBJ):** out of scope. Sprite paint stays per tile pattern.

## 7. Done already: layer art covers the whole map loop (Oct 2 2026)

Mario's Tennis starts its crowd backdrop (world 30) at a different column per match: its BG map is
512 px wide, the window about 415 px, and captures show starts at map X 0 and 112. The world has
the **OVER** flag, so past map X 512 the VIP draws one filler (overplane) tile rather than
wrapping. Layer art made from one frame covered only that frame's view (map X 14–398), so at
start 112 the right ~130 px of the backdrop was a hole (frame `f-muq8h8ni-awxi6e`).

- `layerArtLoop` (`src/layer-art.js`): new layer art covers every column the game can scroll to,
  from map X 0 — the map's width when it wraps, or the map plus one window of overplane filler
  (896 px here).
- `mapCellDraws`: the map cells under an area (wrapping, or overplane filler past an OVER map's
  edge) as ordinary background draws; SpriteStudio renders them through the compositor in
  screen-sized slices to seed the parts of the loop no captured frame shows.
- Sampling is wrap-aware, and `placeArtColumns` moves existing paint into a widened picture per
  column, keeping its place in the map. **Cover the whole map** in the Layer art panel does this
  for older art.
- SpriteStudio gives a group with layer art or a touch-up **one card per scroll position**
  (`bgViewOnFrame` records the anchor world's MX/MY), so each part of the loop can be reached.

Also done: **Fill the screen's height** (`layerArtFullHeight`, `placeArtRows`): layer art may be
taller than the layer's window, so the space above and below a strip layer (the sky over the
crowd) can be coloured — touch-ups, the other way to paint there, are ignored with layer art.
Rows outside the window are sampled with the same mapping (screen y → MY + y − GY).

Overpaint should keep all of this: store it across the whole loop, and add a **whole-map view**
(the layer's full map strip at once, like Base tiles does for scaled layers) so the loop can be
painted in one place. SpriteStudio's 384-px stage cannot show an 896-px strip yet; that view needs
a wider stand-in frame.

## 8. Until then

- If a touch-up seems to vanish in SpriteStudio, the card's frame is probably one where it isn't
  placed (the panel says *not on this frame*). The emulator and the Project tool still draw it on
  frames where the arrangement fits.
- For a backdrop that scrolls, or that the game starts at different columns, prefer **layer
  art** to a full-screen touch-up: it is positioned in the layer's map, covers the whole loop
  (§7), and does not drop out.
- A stop-gap was considered and deferred in favour of this redesign: always giving SpriteStudio a
  card on a frame where the group's touch-up is placed.

## 9. Built (Oct 4–5 2026)

- **Data** as §5: `group.overpaint = { world, bgmapBase, mapX, mapY, width, height, png, hideTiles }`,
  `mapX`/`mapY` in pixels of the layer's whole map plane (up to 0x1fff), the same for plain and
  scaled layers. `layerArtOf` (src/layer-art.js) reads it, and reads an old `layerArt` as overpaint
  with `hideTiles`, so everything that drew layer art draws overpaint. Old `touchUp` stays readable
  and drawn until converted. The groups schema version was not bumped: old tools simply ignore
  `overpaint` and show tile paint, as §5 wanted.
- **Compositor** (src/color-layer.js): only a picture with `hideTiles` skips its world's tiles; plain
  overpaint is drawn after them at the world's depth. Scaled worlds get their own pass
  (`affineOverpaints` / `paintAffineOverpaint`, src/overpaint.js): applied where the group's worlds
  and tiles are read and the BG map matches. The native player does the same
  (`affine_overpaints`, `hide_tiles`); its colour parity with the browser is exact on overpaint frames.
- **Conversion on open** (SpriteStudio, `convertToOverpaint`): layer art → `hideTiles` overpaint;
  a touch-up → overpaint at the map place a captured frame shows it (`touchUpMapArea`: the box's
  screen corner through that frame's scroll, or its anchor cell on a scaled layer; parts left of or
  above the map's origin are trimmed). A touch-up no frame places stays a touch-up. On the Mario's
  Tennis project every touch-up converted; two (title, intro ball) now show on 11 frames instead of
  2 and 9.
- **Editing** (SpriteStudio): Paint on **Tiles | Overpaint** (T); strokes, Fill (bounded by what is
  seen), Swap, Pick, Clone, Import/Paste/Copy/Export, Clear, Remove, Undo. While editing, the
  picture covers the layer's whole map loop and the screen's height (plain layers) or the group's
  cells plus a margin, joined with what is painted (scaled layers); Save crops it to what is painted
  (`cropOverpaint`), and editing widens it again (`placeOverpaint`). Scaled layers are painted
  through the zoom (the affine pixel map now records each pixel's map position) or on Base tiles
  (base draws carry their map cell). **Hide the tiles under it** widens the picture to the whole
  loop at the window's rows and seeds clear pixels from the tiles, so the layer never empties.
- **Several groups on one world** (Oct 5): every group's overpaint is drawn, the group higher in
  the list on top; only one picture per world can hide its tiles. (Layer art's one-picture-per-world
  rule was dropped: it made a second group's overpaint vanish silently.) How it all behaves is
  documented in [reference/overpaint.md](../reference/overpaint.md).
- **Differences from the plan:** no Follow its tiles option; Hide the tiles is for plain layers
  only; a tile-hiding picture keeps layer art's explicit Fill the screen's height / Cover the whole
  map buttons; the whole-map view (§7) is not built — the loop is reached through the per-scroll
  cards, as before.
