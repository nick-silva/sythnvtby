---
status: current
last-reviewed: 2026-10-10
covers: src/color-layer.js, src/art-pack.js, src/vip-state.js, src/group-tile-colors.js, src/overpaint.js, src/screen-gate.js, src/affine-world.js
---

# Art pipeline: from a captured frame to a coloured pixel

How colour gets onto the screen, end to end: what the core sends, how a project captures and
stores it, where paint lives, and how the colour layer turns all of that into pixels. For the
format details follow the links; for the code, the [code map](../README.md#code-map).

*(The first version of this page, Mar 2026, described a "Save VIP state" button feeding a tile
extractor and a pack editor. That flow was replaced by capture → `.vbpack` → the Project tool and
SpriteStudio; the old page is in git history.)*

## 1. What the core sends

The patched Beetle VB core calls `__VB_PUSH_VIP_STATE__(state)` every frame, per eye, with the
**VIP state**: the 2048-tile pattern table, the **draw list** (every 8×8 tile the VIP drew, with
position, flips, world, layer and palette), OAM, display RAM and the world table, and the current
brightness. The core never sees colour; it only reports what it drew.
→ [vip-state.md](vip-state.md), [vip-rendering-validated.md](vip-rendering-validated.md)

The stock CDN core sends nothing, so colour needs the patched core in `public/data/`.

## 2. Capturing frames into a project

In the emulator, **Capture Frame** (F8) or **Auto-capture** saves the current VIP state with a
save state, a RAM dump and a screenshot. **Colorize!** or **Export .vbpack** writes everything
into the project file, a **`.vbpack`** (a zip): the ROM, every captured frame
(`vipstates/<frameId>.json`), the colour table, `groups.json` and the rest.
→ [art-pack-file-format.md](art-pack-file-format.md), [vip-dump-format.md](vip-dump-format.md)

Frames are why the tools can paint offline: each one is a complete picture of what the game drew,
so the Project tool and SpriteStudio can redraw it exactly, with any paint, without the game.

## 3. Where paint lives

Colour is keyed by **tile pattern**: the 16 bytes of a tile hash to a 32-bit key (`hashTile`,
FNV-1a). Every place the game draws that pattern — any slot, any frame, flipped or not — finds
the same colours, which is why one painted tile shows correctly everywhere it appears.

| Store | What it holds | Where |
|-------|---------------|-------|
| **Pack colours** | pattern → 8×8 RGBA, for every place the pattern is drawn | `color.vbcolor` in the pack ([vbcolor-format.md](vbcolor-format.md)) |
| **Group tile colours** | pattern → 8×8 RGBA, but only for draws matching the group's worlds and layers — one pattern can be a different colour per layer | `groups[].tileColors` ([group-tile-colors.js](../../src/group-tile-colors.js)) |
| **Overpaint** | a picture pinned to a background layer's map, drawn over the group's tiles wherever the layer is on screen | `groups[].overpaint` ([overpaint.md](overpaint.md)) |
| **Pose pictures** | overpaint for one saved pose, shown only when the whole pose is on screen | `groups[].poseOverpaints` |
| Older kinds | position overrides, touch-ups, layer art, screen-pinned VIP overlays | read for old packs; touch-ups and layer art convert to overpaint when SpriteStudio opens a pack |

A `.vbcolor` entry is 260 bytes (hash + 256 bytes of RGBA), so even a few hundred painted
patterns are tens of KB; the captured frames are what make a pack large.

## 4. Which groups take part on a frame

Before drawing, `groupsForScreen` (`src/screen-gate.js`) drops groups that shouldn't paint on this
frame: a group limited to some **screens** (*Paint shows on*, memory pools matched by the frame's
RAM) or to some **game states** (*Paint shows when…*, `src/game-states.js`). Where two remaining
groups both claim a draw and both have paint for its pattern, the group **listed first** wins
(`src/group-order.js`).

## 5. The colour layer

`compositeColorFrame` (`src/color-layer.js`) builds one eye's colour picture, 384×224 RGBA:

1. **Draw order.** Draws are composited in VIP world order, back (31) to front (0), so what the
   game puts in front stays in front.
2. **Each draw's colour.** For each 8×8 draw: a position override if one matches, else the
   winning group's tile colours, else the pack colour; flips applied when sampling.
3. **Scaled layers.** Affine (zooming, rotating) worlds are sampled pixel by pixel from display
   RAM the way the VIP does it (`src/affine-world.js`), so tile paint follows the zoom.
4. **Pictures.** Overpaint and pose pictures are drawn over their group's tiles at the world's
   depth.
5. **Brightness.** Colour dims with the game's fades (`src/fade.js`); a group with *Follow the
   game's palette* also follows palette tricks.
6. **No paint.** In the emulator and the player, pixels nothing colours stay **transparent**, so
   the monochrome frame shows through (`renderUnpackedFallback: false`). The tools' previews have
   no monochrome picture underneath, so there an unpainted tile draws its VIP shade where two or
   more draws overlap, to hide what's behind it
   ([color-layer-z-order-and-performance.md](color-layer-z-order-and-performance.md)).

In the emulator the result goes **over** the monochrome canvas: colour where there is paint, the
original picture everywhere else. In 3D the right eye is composited too, and a layer the game
draws twice (once per eye) takes its colour from the left copy (`src/stereo-twin.js`).

The same function draws the Project tool's canvas, SpriteStudio's stage and cards, the emulator
and the sythnvtby Player, so what you paint is what plays. Every app reaches it through
`src/project.js`: one way to open a pack (`projectFromParsed`) and one way to build the compositor's
options (`colourOptions`), with a *view* for what differs — `play` (unpainted pixels transparent),
`toolPreview` (unpainted tiles drawn in a shade) and `measure`. The native PC player has a C++ twin
of every rule (`native/core/src/colorizer.cpp`), kept equal with the parity tool.

## 6. Playing it

**Save and Play** writes the `.vbpack` and returns to the emulator on the same frame, in colour.
**File ▸ Export for player…** writes a play pack (`.vbcplay`: your colours, groups and pictures —
no ROM, no captures) for the sythnvtby Player ([play-pack-format.md](play-pack-format.md)).

## The older tools

The tools hub still has the **tile extractor** (unique tiles from a VIP dump) and the **pack
editor** (colour a `.vbcolor` tile by tile). They predate the Project tool and work on single
files; the Project tool and SpriteStudio are the way to colour a game.
