---
status: current
last-reviewed: 2026-10-09
covers: src/vip-state.js, src/vip-edge-tiles.js, src/affine-world.js, src/fade.js
---

# VIP state: what the core sends each frame

The Virtual Boy's video chip (the **VIP**) builds each frame from 8×8 tiles. Our patched
Beetle VB core reports, every frame and for each eye, what it drew — the **VIP state**.
Everything color-related runs on it: the color layer, frame capture, auto-capture, the
Project tool and SpriteStudio.

The stock EmulatorJS CDN core sends none of this; the app runs the patched core in
`public/data/` (see [core-build.md](../core/core-build.md)). Without it the app still plays
in monochrome and palette mode.

For the end-to-end picture, see [art-pipeline.md](art-pipeline.md); for how the VIP orders
its drawing, [vip-rendering-validated.md](vip-rendering-validated.md).

## How it arrives

The core calls `globalThis.__VB_PUSH_VIP_STATE__(state)`, which `src/main.js` points at
`pushVIPState` in `src/vip-state.js`. That hands the state to the consumer `main.js`
registers with `setVIPStateConsumer`. The core also sets `__VB_VIP_STATE_AVAILABLE__` so
the page knows VIP features can be offered.

Some pushes are **partial** — frame number and eye only. Only a state with a pattern
table and a draw list is used for rendering (`isRenderableVIPState` in `main.js`).

## The state

| Field | What it is |
|-------|-----------|
| `patternTable` | 32 KB: 2048 tiles × 16 bytes, 8×8 at 2 bits per pixel. |
| `drawList` | **The important part.** Every tile the VIP drew this frame, in the order it drew them — see below. |
| `eye` | 0 = left, 1 = right. |
| `frameNumber` | Increments each frame. |
| `oam` | 8 KB of sprite attribute memory (1024 entries × 8 bytes). |
| `segments`, `windows` | All of display RAM (16 × 8 KB: BG maps and affine/HBias parameter tables) and the 32 world ("window") descriptors, 32 bytes each. Affine worlds are drawn from these, not from the draw list: `src/affine-world.js` samples them the way the VIP does, because the draw list only holds rigid 8×8 stand-ins for a scaled layer (one record per screen pixel that reads a tile's top-left texel). |
| `masterBrightness` | Optional, 0..1 — the core's current brightness (the mean of the three lit shades' levels), used to follow fades. Games differ in their normal level (Mario Clash ≈ 0.75, Mario's Tennis 0.39), so colour is dimmed by the level relative to `brightnessReference` (`src/fade.js`). |
| `brightnessReference` | Not from the core and never saved: the level most of the pack's frames show, set by the emulator and tools before compositing. Without it the old rule applies (`masterBrightness × 1.34`, clamped). |
| `gplt`, `masterColors` | Optional — the VIP's palettes, used for palette-accurate shades. |

### A draw

Each entry in `drawList` is one 8×8 tile placed on screen:

| Field | What it is |
|-------|-----------|
| `tileIndex` | Which tile in `patternTable`. |
| `x`, `y` | Screen position in pixels (the left eye is 384×224). |
| `flipH`, `flipV` | Whether the tile is drawn mirrored. |
| `eye` | 0 = left, 1 = right. |
| `layer` | 0 = background, 1 = affine, 2 = sprite (OBJ). |
| `world` | 0..31, the VIP world it belongs to. Worlds draw from 31 (back) to 0 (front); the color layer sorts by this. |
| `strip` | 0..27, the 8-row band it was drawn in. |
| `paletteSelector` | 0..3, which of the four palettes it uses. |

## Things worth knowing

- **Colors key on the tile's pixels, not its slot.** `hashTile` hashes the 16 pattern bytes
  (32-bit FNV-1a). Two slots holding the same pixels hash the same, and so do the same
  pixels drawn flipped — the flip is applied when drawing (`tileLocalFromVip`), which is
  why one painted tile shows correctly in both orientations.
- **Most draws are blank.** A world's window is walked cell by cell, and empty cells point
  at tile 0. In Mario Clash, 87–96% of background draws are blank; tools ignore them and
  the color layer skips them.
- **One sprite entry is one tile.** Each OAM entry draws a single 8×8 character; a sprite
  on screen is many entries. Grouping them into a sprite is our job (poses, clusters).
- **Tiles cut by an edge: patch level 3 records them, older cores did not.** State from the
  current core carries `corePatchLevel: 3` (kept when a frame is captured). Level 3 records
  every BG and sprite tile on its first drawn scanline and pixel, with its true top-left —
  which is negative for a tile hanging off the top or left. Before that, the hook recorded a
  BG tile only where its source row 0 and column 0 were drawn
  (`char_sub_y == 0 && (SourceX & 7) == 0`) and a sprite only on its top row
  (`tile_y == 0`), so a tile cut by the top (or left) of its window was never recorded though
  the mono frame showed its visible part: colour vanished up to a tile early as layers
  scrolled off the top (IntroCin's clouds). See [core-build.md](../core/core-build.md).
  **Frames from older cores** — every capture made before Sep 28 2026 — are repaired for BG
  tiles by `src/vip-edge-tiles.js`, which rebuilds exactly the unrecorded cells from
  `windows` + `segments` with the core's own BG-map arithmetic (checked against a port of the
  core loop in `src/vip-edge-tiles.test.js`); `compositeColorFrame` draws them after the
  core's list, and skips this for level-3 frames. Not covered there: HBias worlds, and
  sprites (the page cannot tell which OAM range each OBJ world draws). Tools that read
  `drawList` directly (selection, groups) see only the core's draws for old frames.
- **Scaled tiles the core never recorded** (shrunk, or on rotated lines) get stand-in draws from
  `affineStandInDraws` (`src/affine-world.js`): one per eye, world and character, at the first
  screen pixel that reads it, marked `standIn: true`. Tools add them when matching groups to a
  frame, so a group shown only that way still finds its frame.
- **A captured frame is this state serialized** — see [vip-dump-format.md](vip-dump-format.md).
