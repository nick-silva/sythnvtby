---
status: current
last-reviewed: 2026-10-13
covers: src/overpaint.js, src/picture-store.js, src/overpaint-switch.js, src/pose-overpaint.js, src/screen-gate.js, src/layer-art.js, src/color-layer.js, src/affine-base.js, src/affine-world.js, tools/sprite-studio.js, tools/sprite-studio/, tools/shared/pack-session.js, tools/painter.js, tools/painter/, native/core/src/colorizer.cpp, native/core/src/play_pack.cpp
---

# Overpaint: how it works

Overpaint is the second kind of paint in a project, next to tile paint. This page is the
reference: what it is, what turns it on, where it draws, and how that differs between sprite,
plain background and scaled background groups. For step-by-step painting see the
[user guide](../guide/user-guide.md#overpaint-paint-over-a-background-layer); for why it was built
and what is still open, [overpaint-redesign.md](../design/overpaint-redesign.md).

## 1. The idea in one paragraph

**Tile paint** colours *patterns*: paint a tile once and every copy of it, everywhere, takes those
colours — and pixels the game draws blank or see-through never get any. **Overpaint** is a
*picture*: a transparent sheet laid over one background **layer**, fixed to that layer's own
background map (the big image the Virtual Boy scrolls a window across). Wherever you paint on the
sheet, that spot of the map is coloured, whatever tile is there, and the sheet moves exactly as the
layer does — scrolling, zooming, rotating, in both eyes. Each background group can own one sheet.

Two rules explain almost everything else:

1. **The layer is the canvas.** The picture is not clipped to the group's own tiles. Paint can go
   anywhere on the layer: over the group's tiles, over blank and transparent pixels, over tiles
   that belong to other groups, above and below the layer's strip.
2. **The group is the switch.** The picture is drawn on a frame only when its group is on screen
   on that layer (it has a tile there). No group tile on screen, no picture.

## 2. Sprite, plain background and scaled background groups

| | **Sprite group** (OBJ) | **Background group on a plain layer** (BG) | **Background group on a scaled layer** (affine) |
|---|---|---|---|
| Can it have overpaint? | **No.** Sprite paint is per tile pattern only (the shared pack). | Yes | Yes |
| Where the picture lives | — | The layer's background map, in map pixels | The layer's background map, in map pixels (same coordinates; see §6) |
| How it reaches the screen | — | Through the layer's scroll: each screen pixel shows the map pixel the game's window is over, per eye | Through the Virtual Boy's affine sampling: each screen pixel shows the map pixel the zoom/rotation reads |
| What turns it on (per frame) | — | One of the group's tiles is drawn on that layer, on that eye (and the layer is in the group's worlds, when it has any) | One of the group's patterns is read by that layer this frame (and the layer is in the group's worlds, when it has any) |
| Where on screen it can draw | — | Inside the layer's window across; any row, so a picture can reach above and below a strip layer | Wherever the layer is sampled (the zoomed shape on screen) |
| Scrolling | — | Follows it; covers the map's whole loop, so any start column is painted | Follows it |
| Zoom / rotation | — | — | Scales and rotates with the tiles; one picture pixel covers several screen pixels when zoomed in |
| Stereo (3D) | — | Each eye maps through its own scroll and parallax, so it keeps the layer's depth. A right-eye copy layer (a *twin*) shows the same picture as the left — flat in 3D | Each eye samples its own way. A right-eye twin takes its colours from the left eye pixel by pixel, keeping the game's 3D shift |
| **Hide the tiles under it** | — | Yes: the layer's tiles are not drawn at all, only the picture | **No** (the box is not offered; the picture is always drawn over the tiles) |
| Painting it in SpriteStudio | — | On the card, through the scroll. Cards are split by scroll position, so every part of the loop the captures show is reachable | On the zoomed card, through the zoom, or on **Base tiles** (the same picture on the unscaled tiles) |
| Area while you paint | — | The layer's whole map loop × the screen's height | The group's cells on this card plus a 16 px margin, joined with what is already painted (it grows as you visit cards) |

So for the person painting, plain and scaled layers behave the same way — "a sheet on the layer" —
and the differences are in how the sheet gets to the screen (scroll vs zoom) and that only plain
layers can hide their tiles.

## 3. When it shows, and when it doesn't

The picture is drawn on a frame and eye when all of these hold:

- **The group is on that layer.** For a plain layer: one of its tiles is drawn there (a tile matching
  its criteria — its patterns, or its animated tile slots). For a scaled layer: one of its patterns is
  read there this frame. Blank tiles don't count, and neither do **shared patterns**: ones another
  group on an overlapping world and layer also lists (a fill or "black-out" tile two characters
  have). Only the group's own patterns switch the picture on — unless all its patterns are shared,
  then any of them does (`src/overpaint-switch.js`). Tile colours are not affected.
  A **pose picture** (`group.poseOverpaints`, made by SpriteStudio's *Overpaint just this pose* from
  the card on stage; `src/pose-overpaint.js`) is drawn as a **whole-pose** group placed right after
  its group, with the group's worlds, layers and screens and the pose's patterns. A whole-pose group
  (`wholePose`; older packs had one per pose, folded into their group when SpriteStudio opens them)
  is one pose of a character: its picture needs **every** one of its (non-blank) patterns on
  the layer, and when two whole-pose pictures are picked for one world and one's patterns all belong
  to the other, only the fuller one is drawn. Whole-pose groups never count as sharing a pattern, so
  they do not change which patterns switch their character's own picture on.
  A pose picture painted on a **saved pose** records it (`poseId`): while the group still has that
  pose, the picture's patterns are the pose's tiles (those that are the group's), not the list it
  stored, so recapturing or editing the pose keeps the picture with it; deleting the pose
  (`removePoseFromGroup`) deletes the picture. Choosing the pictures for a frame builds one index
  per eye of the patterns on each plain layer, and each whole-pose picture checks its own patterns
  against it (≈1.3 ms a frame with 109 pose pictures on Mario's Tennis, against ≈0.7 ms without).
  **In SpriteStudio**, a *character* (a BG group with 2+ saved poses, not animated, not hiding its
  tiles) paints this pose only by default; *Paint all N poses* switches to the group's picture for
  the session (`overpaintScope`, `artTarget` in `tools/sprite-studio/overpaint.js`). A character's
  own (group) picture still shows on **every** pose — usually left from before pose pictures, and
  painting one pose's look over all the others (Toad-PlayingAs's, Oct 12 2026, was moved to its
  IdleReady pose). The Overpaint panel's *Drawing on this card* (`onThisPosePart`) lists what draws
  on the card on stage, flags such a picture, and moves it to the pose on stage or removes it
  (`removePicture`) whichever scope the panel is in.
- **The layer is one of the group's worlds**, if the group lists worlds.
- **The layer draws from the same background map** the picture was made on. A game that double
  buffers (two layers taking turns, each with its own part of map memory) only shows the picture on
  the one it was made on.
- **The screen allows it**, if the group has a **Paint shows on** setting (`group.screens`,
  `src/screen-gate.js`): the frame's memory must match one of its screens (*Only on…*), or none of
  them (*Every screen except…*). Frames without memory always pass.
- **Show overpaint** is on (SpriteStudio only; the emulator, Project tool and player always draw it).

It **isn't** drawn — and tile paint still is — when:

- the group has no tile on screen on that layer (it moved to another layer the picture isn't on
  and that layer draws a different map; a group whose objects hop between layers drawing the same
  map, like Mario's Tennis's players on worlds 21 and 22, keeps its picture on either);
- the game redraws an object at **another place in its map** instead of scrolling it (some score
  digits, a character drawn into different map cells per frame): the picture stays at the old map
  place, which now shows something else — or nothing of this group, so it is off;
- the layer is an **HBias** layer (each row shifted separately) — not supported yet.

Because rule 2 makes the group the switch, overpaint painted *outside* the group's tiles shows
whenever the group is on screen. That is what lets a sky above a crowd appear with the crowd — and
also why a stroke over another group's tiles shows only while this group is on screen too.

## 4. Depth, and groups that share a layer

- **Depth:** the picture is drawn at its layer's place in the Virtual Boy's back-to-front order,
  right after that layer's tiles. Layers in front (including sprites in front) still cover it; it
  covers layers behind. Partly transparent picture pixels blend with what is under them.
- **Fades:** it dims with the game's brightness, like tile paint.
- **Several groups on one layer:** each group's picture is drawn. Where they overlap, **the group
  higher in the group list is on top** — the same group that supplies a shared tile's colours.
- **Hide the tiles** hides *every* tile of that layer, not just the group's, while the group is on
  screen; the layer then shows only pictures. Only **one** picture per layer can hide its tiles (the
  first such group in the list); other groups' overpaint still draws over it.

## 5. Painting and storing

- **Paint on: Tiles | Overpaint** (T) in SpriteStudio decides where strokes go. In Overpaint mode,
  Brush, Fill, Swap, Pick and Clone work on the picture. **Fill** stops where the picture you see
  changes (overpaint, then tile paint, then the scene when Background is on), so it never floods the
  whole clear sheet.
- **While you paint**, SpriteStudio holds the picture at its full working area (§2's last row), so
  any stroke on the layer lands. **Save crops it** to the painted pixels and stores that as a PNG on
  the group; opening it again widens it back. A picture that hides tiles is stored whole (its clear
  pixels mean "see-through", which matters when the tiles are hidden).
- **Import image / Paste** stretch the image to the current working area; **Export PNG** gives the
  exact size to paint at in another program.
- **Hide the tiles under it** (plain layers): turning it on widens the picture to the whole map loop
  at the layer's own rows and fills every clear pixel from how the tiles look, so nothing goes
  blank; you then paint over that. Turning it off keeps the picture, drawn over the tiles again.
- **The Project tool** shows overpaint (an *overpaint* pill and a details line) but doesn't edit it.
  You can still paint a group's tiles there — under opaque overpaint they won't be visible — unless
  the picture hides the tiles, in which case tile painting on that group is refused.
- **The Frame list's uncoloured filters** and **Clean up frames** count overpaint pixels as coloured.

## 6. Coordinates (for the curious)

The picture's `mapX`/`mapY` are pixels of the layer's whole background map plane — the same numbers
whether the layer is plain or scaled, because both read the same map memory.

- A **plain** layer shows map pixel `(MX ± MP + x − GX, MY + y − GY)` at screen `(x, y)` — the
  layer's scroll (MX, MY), per-eye parallax (MP) and screen position (GX, GY) — wrapping at the map's
  size, or showing one filler tile past an *overplane* map's edge. That is why the editing area is
  the map's whole loop: 512 px or more when it wraps, or the map plus one window of filler.
- A **scaled** layer reads map cell `(cellX, cellY)` and texel `(tx, ty)` at each screen pixel; the
  map pixel is `(cellX·8 + tx, cellY·8 + ty)` with the tile's flips undone. **Base tiles** lays those
  cells out unscaled, so one Base-tiles pixel is one map pixel.

Stored as `group.overpaint = { world, bgmapBase, mapX, mapY, width, height, png, hideTiles }` — see
[art-pack-file-format.md](art-pack-file-format.md) (groups.json). Play packs carry it unchanged, and
the native player draws it exactly as the browser does.

## 7. Older pictures: touch-ups and layer art

Overpaint replaced two older kinds of picture. SpriteStudio converts them when it opens a pack
(save to keep the result):

- **Layer art** (a picture replacing a whole layer) → overpaint with **Hide the tiles under it** on.
  Same picture, same place.
- **Touch-up** (a picture pinned to an anchor tile, drawn only where the tiles around it matched) →
  overpaint at the map place where a captured frame shows it, same pixels. It now shows wherever the
  layer is on screen instead of only where the tiles lined up — on the Mario's Tennis project the
  title's touch-up went from 2 frames to 11. A touch-up **no captured frame shows** can't be placed,
  so it stays a touch-up (still drawn where its tiles line up); the Overpaint panel offers to remove it.
- **Overlays** (older screen-pinned paint) become touch-ups first, then overpaint.

Until a pack is opened in SpriteStudio, the emulator and the Project tool keep drawing its touch-ups
and layer art as before.

## 8. Questions

**Why does my overpaint show on a screen where I didn't paint it?** It shows wherever its group is on
screen on that layer, at the same map place. If another screen scrolls that part of the map into view
while the group is there, the picture shows there too — that's the point (it follows scrolling).
Shared tiles no longer switch it on (§3), so a fill tile the group shares with a menu strip, or a
black-out tile shared with another character, doesn't bring the picture along. If it still shows
somewhere it shouldn't, set the group's **Paint shows on** to *Every screen except* that screen
(Project tool, group details; needs File → Analyze memory) — see the
[user guide](../guide/user-guide.md#limiting-a-group-to-some-screens).

**Why did a stroke over another group's tiles disappear on some frames?** It belongs to *your*
group's picture, so it shows only while your group is on screen. Paint it in the other group's
overpaint instead, if it belongs to that group.

**Why can't I give a sprite (OBJ) group overpaint?** Sprites aren't drawn from a background map: they
are placed one tile at a time anywhere on screen, so there's no map to pin a picture to. Sprite paint
stays per tile pattern.

**Why isn't Hide the tiles offered on a scaled group?** Not built yet: on a scaled layer the picture
is always drawn over the tiles.

**My overpaint vanished after I renamed or regrouped tiles.** It's switched on by the group's tiles: if
the group no longer has a tile on that layer (or lists other worlds), the picture is off. Check the
group's worlds and tiles in the Project tool.

**Two groups paint the same spot — which wins?** The one higher in the group list.

## 9. Code map

| Piece | Where |
|---|---|
| Reading a group's picture (overpaint, or old layer art as overpaint that hides tiles) | `layerArtOf`, `src/layer-art.js` |
| Plain layers: which pictures are active, and drawing through the scroll | `activeLayerArts`, `paintLayerArt`, `src/layer-art.js` |
| Scaled layers: which pictures are active, and drawing through the sampling | `affineOverpaints`, `paintAffineOverpaint`, `src/overpaint.js` |
| Base tiles view | `paintOverpaintOnCells`, `cellMapPixelAt`, `src/overpaint.js`; base draws carry `cellX/cellY` (`src/affine-base.js`) |
| Depth order and Hide the tiles in the compositor | `compositeColorFrame`, `src/color-layer.js` |
| Which patterns switch a picture on (the group's own, not shared ones) | `overpaintSwitchHashes`, `src/overpaint-switch.js`; native `build_switches`, `native/core/src/colorizer.cpp` |
| Pose pictures kept in the group: expanded to whole-pose groups to draw; folding old pose groups | `expandPoseOverpaints`, `posePictureGroups`, `foldPoseGroups`, `src/pose-overpaint.js`; native `parse_groups_json`, `native/core/src/play_pack.cpp`; SpriteStudio `artTarget`; every write of a picture's settings, pixels and edited mark through `src/picture-store.js`, which refuses pixels that are not the size the settings say |
| One pose's picture (whole-pose groups): all of its patterns, the fullest pose wins | `wholePoseHashes`, `wholePoseOn`, `dropCoveredPoses`, `src/overpaint-switch.js`; native `whole_pose_on`, `drop_covered_poses`; made by `overpaintThisPose`, `tools/sprite-studio/overpaint.js` |
| Screen limits (`group.screens`): groups left out on other screens | `groupsForScreen`, `src/screen-gate.js`; native `group_shown_on_screen`, `native/core/src/play_pack.cpp` |
| Converting touch-ups and layer art | `convertToOverpaint`, `touchUpMapArea`, `src/overpaint.js` |
| Crop on save, widen while editing | `cropOverpaint`, `placeOverpaint`, `src/overpaint.js`; `ensureOverpaintArea`, `tools/sprite-studio/overpaint.js` |
| Editing UI | the overpaint section of `tools/sprite-studio.js` |
| Native player | `active_layer_arts`, `affine_overpaints`, `native/core/src/colorizer.cpp`; parsing in `native/core/src/play_pack.cpp` |
