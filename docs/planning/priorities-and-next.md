---
status: living
last-reviewed: 2026-10-17
---

# Priorities and what's next

The backlog: what to build next, and why. Only open work lives here — for what has
shipped, see `git log` and [development-journey.md](../history/development-journey.md).
Rendering problems have their own deeper plan in
[graphics-next-investigations.md](graphics-next-investigations.md).

---

## Ranked: what to do next (Oct 7 2026)

One order across features, UX and code health, so refactors are weighed against the UX work
rather than parked beside it. Details live in the sections linked. Ranking rule: **work that has
lost or silently hidden the user's paint first**, then what makes the tools explain themselves
(fewer "why isn't this coloured?" investigations), then what slows painting down with a large
project, then code health, then big features (which go faster on cleaner code). Size: S (an
afternoon), M (a day or two), L (a week or more). Items 1–10 come from the Oct 7 review of the
toolset ([below](#toolset-review-oct-7-2026)).

| # | What | Kind | Size | Why here |
|---|------|------|------|----------|
| 0 | **Never lose work: the rest of recovery mode** ([Recovery mode](#recovery-mode-never-lose-work-oct-7-2026)) — the four main cases are built (Oct 7), and the Project tool's journal (Oct 8, `src/project-journal.js`); left: handoff fallback, malformed groups, corrupt zip entries, unreadable frames | Safety | S–M | Oct 7: a Save refused over pose pictures an undo had put out of step, and the only way out was clearing work. Fixed at the cause, but any future inconsistency should cost one picture, not the session. |
| 0b | **Snappy tools on big projects** ([tool-performance.md](tool-performance.md)) — measured Oct 8 on Mario's Tennis (264 frames): Project tool frame switch / select / stroke 1.2–2.5 s (a per-group screen recount on every panel rebuild), SpriteStudio strokes 0.65 s on Luigi (all 82 thumbnails redrawn, paint index rebuilt per composite), open 3–8 s, Save 5+ s, 850 MB heap. **Phase 1 built Oct 9:** frame switch 45–65 ms, strokes ~100 ms (Luigi 110–160 ms), open 1.3–1.9 s, heap 520 MB; checked by `tests/e2e/s9-performance.mjs`. **Phase 2 built Oct 9:** frames and per-frame files stay compressed until read, decoded frames kept for the ones being worked on, frame summaries skip frames a group is not on — memory about halved (Project tool 397 → 210 MB open, SpriteStudio 1.3 GB → 317 MB after a scaled background). **Phase 3 built Oct 9 (keeping the `.vbpack`):** a save copies unchanged entries as stored — Save 5 s → 0.8 s (Project tool), 0.5 s (SpriteStudio). Next: load frames when needed, a project folder while working, archive by evidence | Performance | S → L | Painting has slowed to a crawl at 264 frames; finishing the game needs hundreds more. |
| 0c | **Big projects, Phase 4: annotate frames, then archive harder** ([tool-performance.md](tool-performance.md#phase-4--1000-frames-annotate-then-archive-harder-m--item-1-built-oct-13)) — frame summaries saved in the pack (patterns per world/layer, screen, game states, uncoloured counts, poses captured), annotations at capture (screen, game states, the auto-capture reason, new patterns; searchable), Clean up frames archiving every frame whose evidence is on frames kept while keeping its summary, one frame back on demand, a compact draw list (frames ~6× smaller) | Performance | M | **Item 1 built Oct 13: frame summaries saved in the pack** — at 1,000 frames, open 3.1 → 0.8 s (Project tool) and 2.7 → 0.6 s (SpriteStudio), no blocking pass over every frame ([tool-performance.md](tool-performance.md#phase-4--1000-frames-annotate-then-archive-harder-m--item-1-built-oct-13)). Left: annotations, archive by evidence, the compact draw list, Check project's background decode. |
| 1 | ~~**"Why isn't this coloured?" inspector**~~ — **built Oct 7** (`src/pixel-explain.js`): the Project tool's *This pixel* and SpriteStudio's Pick answer in one line with one fix; raw tile data and the draw stack moved under *Details*, developer notes behind *Project ▸ Developer details*, reference and pool controls shown only when they apply. Left: the same answer while playing in the emulator, and teaching it about affine overpaint and position-override rectangles | UX | — | Every investigation of Oct 5–7 needed a hand-written probe. |
| 2 | ~~**Project health list with one-click fixes**~~ — **built Oct 8** (`src/project-health.js`, *Project ▸ Check project…*): groups moved to another world (**Add world**), tiles taking another group's colours (**Let … win**), layers scrolling past their overpaint, damaged pictures; unpainted tiles and always-together shared tiles folded away. Runs by itself after changes, a few frames at a time; *N to check* next to File only when something is found. First run on Mario's Tennis (237 frames, ~3 s): 8 problems, among them Luigi's backdrop scrolling past its overpaint on 27 frames and Luigi's tiles taking Mario's colours (which no order fixes — see #16); tiles under a pose picture or overpaint are left out of the shared-tile check (Oct 8). Left: pose tiles not painted, pictures out of step, the right eye | UX | — | Layer swaps, backdrops past their picture, first-group-wins conflicts: found by luck or by probe until now. |
| 3 | ~~**Show which group wins a shared tile**, and let the order change~~ — **built Oct 7–8** (`src/group-order.js`): *This pixel* says which group wins and offers **Let … win**; a group row says **behind …** when its tiles take another group's colours on the frame you're on; its details list *Shared tiles* both ways with a button to swap. Left: the same in SpriteStudio's lists, and a general move up / down for the group list | UX | — | "The group listed first wins" decides colours and was invisible. |
| 4 | ~~**Frames you can name, find and refer to**~~ — **built Oct 8** (`src/frame-numbers.js`): every frame gets a short number (`frameRegistry[].number`, never reused), shown first in the Frame list; *Frame ▸ Copy reference* and *Go to frame…* (number, name, or an id with up to two typos). Frame names now show in the list when a pack opens (they used to show only right after renaming) | UX | — | Random ids (`f-muyv6xyw-2nehcx`) get mistyped (twice on Oct 7). |
| 5 | **Finding your way in a big project**: ~~Project tool group search~~ (**built Oct 8**: *Search groups* at the top of the right rail, Ctrl+K) + ~~*On this frame* filter~~ (**built Oct 8**); keep the selected group across frame changes; paint progress per group ([Managing groups 1–3](#managing-groups-as-a-project-grows-sep-28-2026)) | UX | S each | ~80 groups in Mario's Tennis; SpriteStudio has search, the Project tool doesn't. |
| 6 | ~~**Painting basics**: eraser, redo, undo for deleting a group~~ — **built Oct 9**: an **Eraser** in both tools (Project tool button next to Brush; SpriteStudio **E**) that takes paint off — a tile erased to nothing is unpainted again; **redo** (Ctrl+Shift+Z / Ctrl+Y, and a Redo button in SpriteStudio) for every undoable change, each undo entry returning its inverse; **Delete group** undoable in the Project tool (group, place in the list, overlays, overrides and the shared paint only it used) Also Oct 9: SpriteStudio's **Only this group's paint** (on by default) shows a group only its own paint while you paint it, and **Move to** no longer copies the paint of patterns the old group's other poses share — the copy is how Mario's red reached Luigi-PlayingAs, whose pose pictures were then cleaned up (IntroMario limited to the Intro screen, inherited red repainted, 12 pictures removed) | UX | — | Small, expected, and their absence made mistakes expensive. |
| 7 | **Parked Oct 13: a group follows its art when the game moves it** — the current system copes with Mario's Tennis; pick it up only if another game shows the pattern. — to any layer drawing it from the same map, and across scrolls ([Graphics 8](#graphics), [Managing groups 5](#managing-groups-as-a-project-grows-sep-28-2026)) | UX / rendering | M | Three paint drop-outs in one week (text swapping worlds 17 ↔ 18, clouds swapping even ↔ odd worlds, the crowd scrolling 112 px). Replaces the **+ world** buttons and most uses of *Cover the whole map*. |
| 8 | ~~**Coverage while playing**~~ — **built Oct 8** (`src/paint-gaps.js`): auto-capture's *Where paint doesn't cover yet* stops on tiles with no paint at all and on a backdrop's tiles beside its overpaint picture (the layer scrolled past what was painted), each once a session. Left: a group's tiles on a world it doesn't paint (Check project's *moved to another world*, live), unpainted pose tiles | UX | — | Learn about the next background break while playing, not after painting. |
| 9 | **One group details panel in both tools** — worlds, screen limits, palette follow and overpaint shown everywhere | UX / code | L | Settings live in one tool or the other today. Pairs with #12. |
| 10 | ~~**Memory sub-states for groups**~~ — **built Oct 8** as **game states** ([design/memory-states.md](../design/memory-states.md)): named memory conditions, and groups' **Paint shows when…** conditions on them (is / is not) next to screens, in every reader including the native player; *Only while it's on screen* learns one from captures; **questions** answered from **recordings** made while playing (emulator **Memory** panel: timed or until stopped, side keys) or from captured frames, analysed in **Project ▸ Game states…** (bytes that still fit, near misses, *enough*), checked live (**Now**, *Looks right*), saved as game states; **Project ▸ Project storage…**; Check project's *Tell them apart…*. It does not fix Mario vs Luigi in Mario's Tennis (no memory byte separates their frames — see #16). Left: re-learning a screen from recordings, a pair of bytes when one is not enough, archiving recordings | UX | — | Paint that depends on which character is played, not just which screen. |
| 11 | ~~**One group schema** and **one owner for a SpriteStudio picture's state**~~ — **built Oct 9** ([Code health 1–2](#code-health-review-oct-7-2026)): `src/group-schema.js` (`normalizeGroup`, `GROUP_FIELDS`) is how the Project tool, SpriteStudio and the play pack read groups, and it keeps fields it does not know; a test checks every field has a row in the format doc. `src/picture-store.js` is SpriteStudio's only writer of a picture's settings, pixels and edited mark, and refuses pixels that are not the size the settings say | Code | M | Unknown fields dropped on save (`folder`); a picture's settings and pixels drifting apart moved Luigi's paint twice. |
| 12 | ~~**Split `tools/sprite-studio.js` and `tools/painter.js`**~~ — **built Oct 9** ([Code health 3](#code-health-review-oct-7-2026)): SpriteStudio 5,740 → 1,772 lines with 12 parts in `tools/sprite-studio/`; the Project tool 10,434 → 2,457 lines with 23 new parts in `tools/painter/` and `wireEvents` broken up. Both follow one pattern (docs/README.md, *How the two tools are built*). Renaming `painter` → `project` is left for later ([refactor-plan.md](refactor-plan.md) B2) | Code | L | Before the big features below and with #9; seams listed there. |
| 13 | ~~**Add a linter**, **`compositeColorFrame` options object**, **routine browser-vs-native parity**~~ — **built Oct 9–10**: ESLint (`npm run lint`, run by `npm test`); the options object; parity on the synthetic fixture pack in `npm test` where the native build exists (`src/native-parity.test.js`) ([Code health 4, 5, 8](#code-health-review-oct-7-2026)) | Code | S–M | Cheap hygiene; parity keeps every colour rule's two copies equal. |
| 14 | ~~**Recognise mirrored poses**~~ — **built Oct 13** (`src/pose-mirror.js`): `locatePose` tries a pose mirrored left–right, upside down or both when it is not whole as captured, unless *Mirror OK* is off; every tile placement goes through `placePoseTile`; Find poses and Find sprites treat mirror images as one pose. Mario Clash: kept sprite poses found whole on 288 more frames (420 → 708), 26 of 84 poses. Not needed for background characters (Mario's Tennis) | Feature | — | For sprites (Wario Land, Mario Clash). |
| 15 | **Pose suggestions** ([Up next 1](#1-pose-suggestions-turn-captured-frames-into-poses)) — ~~for background characters~~ **built Oct 13** (`src/pose-suggest.js`, SpriteStudio *Find poses…*): the poses a character's frames show that are not kept (its unscaled layers, frames where its conditions hold, fragments left out) and poses kept twice, folded into their twin with animation steps and pictures moved. On Mario's Tennis: Luigi 85 → 63 poses, Mario 1 new + 10 duplicates, Toad/Princess/Yoshi complete. ~~Sprites~~ **built Oct 13** (`src/sprite-suggest.js`): SpriteStudio *Find sprites…* (characters from every frame's OBJ tiles, as new sprite groups or poses of one) and *Find poses…* for a sprite group. Wario Land capture (30 frames, no groups): 138 sprites → 29 characters, 63 poses. Mario Clash (158 frames): 499 of 690 sprites are kept poses; Mario offered 28 (mostly carrying a shell, unticked). Left: moving a suggested pose to another character inside the window, a split for clusters the data cannot explain | Feature | — | Sprites before Wario Land. |
| 16 | ~~**Pose-aware rendering in the emulator**~~ — **built Oct 14 as a neighbour rule** ([design/pose-aware-rendering.md](../design/pose-aware-rendering.md), `src/shared-tile-owner.js`, native `SharedTileOwners`): a tile two groups paint differently takes the colours of the group whose own tiles are next to it (on a scaled layer, next to it in the map); the list order only where nothing next to it tells. Mario's Tennis: 1,462 of 1,553 contested draws settled, 665 change winner (the far player's corner tile, words sharing letters); Mario Clash: all 14,031 settled. Poses were measured Oct 9 at 4% and dropped. *This pixel*, **behind …** and Check project follow the rule | Feature | L | Sprite paint stops leaking onto unrelated art that reuses a tile. Oct 8: also the fix for Mario's Tennis's biggest remaining problem — Mario and Luigi share 26 tiles, and on 27 frames Luigi's take Mario's colours; neither group order nor memory can tell them apart, only which pose the tiles are part of. |
| 17 | **Palette as a group criterion**; **SpriteStudio stage rethink** ([SpriteStudio — rethink the UX](#spritestudio--rethink-the-ux-sep-2026)) | UX | M | Only when a case needs it / a design question to settle first. |
| 18 | **Retire old formats** and **one per-frame pattern cache** ([Code health 6–7](#code-health-review-oct-7-2026)) | Code | M | Worth it once 11 exists. |
| 19 | **Libretro compatibility** — the whole system usable with the libretro project: a sythnvtby libretro core that colours inside the core, packs found the libretro way, our core patches upstream-ready ([Libretro compatibility](#libretro-compatibility-backlogged-oct-10-2026)) — **planned Oct 14** in [design/libretro-core.md](../design/libretro-core.md), with packs found by ROM SHA-1 and published in a packs repo; not started | Feature | M–L | The licence blocker is gone (GPL-3.0-or-later, Oct 10). Best after C1 ([refactor-plan.md](refactor-plan.md)), so the core and the browser share one session model and one compositor. |

| 20 | **Colour a group's poses from the ones you painted** ([Auto-colouring](#auto-colouring-backlogged-oct-11-2026)) — the Oct 10 whole-game try (capture bot + rules-based colourer) was not good enough; ~~**Auto-paint**~~ **built Oct 11** (`src/pose-autopaint.js`, SpriteStudio *Auto-paint (A)*): paint a few poses, pick which to learn from and which to paint, and each unpainted pixel takes the colour of the reference pixels whose surroundings match best (Yoshi-PlayingAs: 35 poses from 2 in ~4 s). With it: **Original** (hold O) to check against the game's monochrome. Left: the capture bot as a tool, suggesting which pose to paint next | Feature | M | Built Oct 11 for sprite and character poses; backgrounds and menus are not covered. |

The rest of this file keeps its own order inside each section; this table decides between them.

### Toolset review (Oct 7 2026)

Since the [Sep 26 use-case review](use-case-review.md): packs are compressed, there is a player
format and a native player, all three pages warn before closing with unsaved work, and overpaint
replaced the hidden three-store choice for background paint. Still open from it: no undo for
deleting a group, no redo, no eraser, no beginner/developer mode switch, some internal ids in
status lines. The week of painting Mario's Tennis (Oct 5–7) added the theme behind items 1–3 and
7–8: **the tools know why a tile is or isn't coloured, but only a probe script could ask them** —
each answer (a world swap, a shared tile, a palette change, a scroll past a picture, an unpainted
pose) was a few lines of data the UI could show.

---

## Up next

### 0. Overpaint: replace touch-ups and layer art (built Oct 4–5 2026)

**Done** — see [overpaint-redesign.md §9](../design/overpaint-redesign.md#9-built-oct-45-2026) for what
was built and what is still open (HBias layers, a whole-map view, Follow its tiles). The original
problem, kept for the record: touch-ups fail silently when a layer scrolls: Mario's
Tennis's crowd backdrop (*DonkeyKongJrBacklog*, world 30) has a full-screen touch-up that fits on
18 captured frames and drops out on 4 where the backdrop has scrolled 112 px (60 of 207 tiles line
up, under the 60% rule). SpriteStudio then opens the group on those frames, so the touch-up can
neither be seen nor edited there. With tile paint, touch-ups, scaled-layer touch-ups, layer art and
converted overlays, plus anchor / Base tiles / poses / frame cards, there are too many overlapping
ideas. The plan: **two kinds of paint** — tiles, and **overpaint**, one picture per group placed in
its layer's map (like layer art) so it follows scrolling and scaling, with "hide the tiles under
it" standing in for layer art. Touch-ups and layer art convert on open. Full proposal, data model,
migration and open questions: [overpaint-redesign.md](../design/overpaint-redesign.md).

**Follow-ups built Oct 5–7 2026** (details in [overpaint.md](../reference/overpaint.md) and the
[user guide](../guide/user-guide.md#overpaint-paint-over-a-background-layer)):
- **Only a group's own tiles switch its picture on** (`src/overpaint-switch.js`): a tile another
  group on the same layers also has (a black-out tile two characters share) no longer brings the
  picture along — Toad's paint over Mario.
- **Paint shows on** (`group.screens`, `src/screen-gate.js`): limit a group to some memory-pool
  screens. **Follow the game's palette** (`followPalette`): menu text dims with the game's
  unselected palette.
- **Pose pictures** (`group.poseOverpaints`, `src/pose-overpaint.js`): overpaint for one pose,
  kept in the group, tied to its saved pose, shown only when that whole pose is on screen. A
  character (2+ kept poses) paints this pose only by default; the badge says which picture
  strokes go to. Older one-group-per-pose packs fold in on open. Choosing pictures uses a
  one-pass pattern index per frame (≈1.3 ms for 109 pose pictures, from ≈9 ms).
- **SpriteStudio Save stored a cropped PNG under the widened picture's size** when saved in
  Overpaint mode, and **row clicks reselected a stale group copy** — both moved paint to the
  map's corner. Fixed; Save now refuses a picture whose size and pixels disagree.

**Open:** a pose picture can't hide the layer's tiles; HBias layers; paste into part of a picture.

### 1. Pose suggestions: turn captured frames into poses

**Built Oct 13 2026** for background characters and sprites (`src/pose-suggest.js`, `src/sprite-suggest.js`): see #15 above. The plan below is kept for the open points at its end.

Auto-capture makes frames cheap, but turning them into poses is still one hand-drawn box
per sprite per frame in the Project tool. Most of the structure is already in the data.

- **Measured on `marioclash-annotated.vbpack` (30 frames):** 60 on-screen sprite instances
  collapse to **30 distinct poses** once deduplicated across frames with mirrored copies
  treated as the same pose; those group into **12 characters** by linking poses that share
  ≥ 2 tile patterns (largest 10 poses, then 5 and 4, then a tail). Of the 4 clusters of 20+
  tile patterns, **3 are exactly the union of smaller poses seen elsewhere** — sprites that
  were touching, not real poses. The 4th (28 patterns, nothing inside it) is either a
  genuinely large sprite or two sprites never captured apart. Method: cluster each frame's
  left-eye non-blank OBJ tiles (`objTilesByHash` + `clusterTilePositions`), key each cluster
  by sorted `hash@dx,dy` taking the smaller of the plain and mirrored keys, then union-find
  on shared patterns.
- **Pipeline:** (1) *extract* — cluster each captured frame's OBJ tiles into on-screen
  sprites; (2) *split collisions* — a cluster fully covered by smaller poses seen elsewhere
  is split into them; (3) *deduplicate* — same layout, mirrored or not, is one pose, sourced
  from its clearest frame (not mid-fade); (4) *group into characters* by shared tile
  patterns; (5) *review* in a **Suggestions** section of SpriteStudio's left rail — one row
  of pose thumbnails per suggested character: name it and accept (creates the OBJ group and
  its poses), untick poses that do not belong, move a pose to another character, or mark
  **not a sprite** (HUD digits, debris); suggestions matching existing poses are hidden;
  (6) *paint progress* — paint is per tile pattern, so each character can show "*x* of *y*
  patterns painted".
- **Decided:** suggest-and-review, not auto-create — grouping will sometimes join two
  characters that share a generic tile. Lives in SpriteStudio.
- **Needs item 2 first.**
- **Open:** the manual split UI for clusters the data cannot explain; the exact "clearest
  frame" rule (brightness, fewest overlaps); whether the ≥ 2 shared-pattern threshold needs
  tuning on a larger capture set.

### 2. Recognise mirrored poses

**Built Oct 13 2026** (`src/pose-mirror.js`): see #14 above.

Tile hashes are over the raw pattern and the compositor flips per draw, so *paint* on a
pattern shows correctly in both orientations. But pose matching (`locatePose` in
`tools/shared/pack-session.js`) compares literal `dx/dy` offsets, so a sprite facing the
other way — whose tile positions are mirrored — is not found as the same pose.
`pose.allowFlipMacro` is stored and toggleable in the Project tool but **nothing reads
it**. Fix: in `locatePose`, also try the layout with `dx → -dx` (tile flips inverted) when
`allowFlipMacro` is set, and report which orientation matched. SpriteStudio's per-step
**mirror** already covers the authoring side of animation.

### 3. Pose-aware rendering in the emulator

**Done Oct 14 2026 another way:** a shared tile takes the colours of the group whose own tiles are
next to it (`src/shared-tile-owner.js`, [design/pose-aware-rendering.md](../design/pose-aware-rendering.md)).
The pose-matching plan below is kept for its reasoning.

SpriteStudio stores sprite paint per tile pattern, so the emulator colors that pattern
wherever it appears — including outside the sprite, if unrelated art reuses the tile.
The studio itself renders pose by pose. The emulator needs the same: match a group's poses
against the live draw list and color only those draws. This is step 3 of
[obj-sprite-profiles-design.md](../design/obj-sprite-profiles-design.md) §7.

---

## Graphics

Details and history in [graphics-next-investigations.md](graphics-next-investigations.md).

1. **Palette registers (GPLT) are never applied** — the renderer maps a tile's 2-bit pixel
   value straight to a shade (`monoPx === 1 ? 0 : 2 ? 96 : 192` in `compositeColorFrame`),
   but the VIP remaps those values through the palette the draw selects, and games use that
   for fades, flashes and hiding elements. `paletteSelector` is captured per draw and the
   four BG palettes are captured as `state.gplt`; only the `occlude_black` special case reads
   either. **Measured** on `marioclash-annotated.vbpack`: on the Title frame (`gplt`
   `[228, 192, 144, 108]`, i.e. palette 1 sends pixel values 1 and 2 to black and palette 2
   drops everything a shade, with 1390 of 2850 draws using them) a re-render lights up
   **32.9% of the screen that the capture shows black**. Apply the palette when reading a
   tile pixel, both in the mono fallback and when choosing a painted colour's shade. Note the
   OBJ palettes (JPLT) are *not* captured yet, so sprites need a dump-format addition first.
   Until this is fixed, treat captured screenshots as the truth for what was on screen —
   `src/screenshot-frame.js` reads them back to exact frame pixels.
2. **Anchor paint ignores fades** — **fixed Sep 2026.** Painted tiles dim with the scene
   (`masterBrightness` in `compositeColorFrame`), but BG anchor paint was blended afterwards at
   full brightness, so an anchored group stayed lit through a fade.

   The painted-tiles inventory made it legible on the Safety screen, where the two groups are
   painted differently and behaved differently:

   | Group | Shared pack | Anchored overlay | Faded in? |
   | --- | --- | --- | --- |
   | `EnglishSafetyText` | 0 of 19 patterns | 61 tile cells | no — full brightness at once |
   | `JapaneseSafetyText` | 14 of 35 patterns | 28 tile cells | the pack half did, the overlay half did not |

   Exactly the reported symptom: one screen where "only roughly half" of a group faded
   correctly, and nothing anywhere else — because everywhere else the paint is all overlay.
   `blendPainterV2VipOverlaysIntoImageData` now takes the same `brightnessScale` the composite
   was given and applies `overlayBrightness` (the same `masterBrightness × scale`, clamped),
   in the emulator and in both authoring previews.

3. **Anchor paint ignored depth** — **fixed Sep 2026.** An overlay is blended after the frame
   is composited, so it painted over whatever was in front of it: a sprite walking behind a
   foreground platform came out hidden by the platform's paint. Reported as a draw-order bug;
   the draw order was fine.

   **The rule, for the record:** the VIP draws each strip from world 31 down to world 0, so a
   **lower world-id renders in front**, regardless of BG or OBJ. `compareDrawCallOrderByWorld`
   already implements that, and world beats layer — layer only breaks ties inside one world and
   strip. Checked against the core's own draw list (hardware order, since the core appends as it
   draws) on `Leve01` frame 104: of 12,113 pixels where Mario and the foreground platform
   compete, the two orders differ on **80**, and those are an artefact of the core pushing one
   entry per sprite tile at its top strip — a sprite spanning two strips is really drawn again in
   the second one, where its world wins. Our sort is the more faithful of the two there.

   `compositeColorFrame` now records the front-most lit draw per pixel while it composites (the
   loop already visits every lit pixel back-to-front, so it is a single store), exposed as
   `getCompositeDrawOwners()`. `blendPainterV2VipOverlaysIntoImageData` takes it and paints only
   where the overlay's own group is what you can actually see. Measured on frames 103/104/105:
   86/110/152 Mario pixels were being covered, now **0**, while legitimate overlay paint is
   untouched (Safety screen 1429 → 1429 px; frame 104 keeps 97.7%, losing exactly Mario's
   pixels). Cost on the real pack's four overlay groups: **+0.01 to +0.06 ms** a frame.

   **SpriteStudio's stage deliberately does not mask** — it is an isolation view that shows a
   group's background context even when other worlds cover it.

4. **Animated BG tiles** — some BG tiles move like sprites and show artifacts. Reproduce,
   characterize, fix.
5. **Color layer sits a hair off the mono frame** (user report) — a sliver of the red mono
   frame shows behind the colored render, **mostly below it**. That asymmetry points at a
   sub-pixel / one-row offset or a rounding difference where the color canvas is scaled
   over the emulator output, not at tile addressing. Check the scale and letterbox math for
   both canvases, `Math.round` vs truncation in the destination rect, and whether device
   pixel ratio is applied to one layer and not the other. A pixel diff of the two layers on
   a fixed frame should pin it down.
6. **Affine layer** — not supported (e.g. Mario Tennis court lines). Deep dive into how the
   core handles affine and what it means for HD art. Below sprite work in priority.
   **Mario Clash uses it too** (found Sep 28): about 78 s into the attract intro, the "Clash
   Tower" doorway zoom is drawn by worlds 28–29 in **affine** mode (1,684 affine draws a
   frame), not by sprites — the VB cannot scale sprites. HBias (per-scanline horizontal
   offsets: wobble and skew, not scaling) never appeared in 2½ minutes of intro. The draw list
   records affine tiles as if they were rigid 8×8 tiles, so colouring a scaled layer needs its
   own renderer: sample each screen pixel through the world's affine parameters (DRAM at
   `PARAM_BASE`, already in `segments`), the way `DrawAffine` does.
   **Phases 1–2 done (Sep 30 2026):** `src/affine-world.js` is a line-for-line port of Beetle's
   `DrawAffine`. On the eight IntroCinPart02 captures it reproduces the core's own affine draw
   records exactly (1,700–1,807 per eye per frame, none missing or extra). `compositeColorFrame`
   now skips the rigid affine records and samples affine worlds pixel by pixel at their depth, so
   the Project tool's mono preview and the colour layer scale with the layer; tile paint is looked
   up per texel (a group painted while the world was a plain background still applies once it
   zooms). About 1.5–2.7 ms per eye per frame.
   **Phase 3 done (Sep 30 2026):** the Project tool hit-tests, paints and outlines affine worlds by
   what each screen pixel reads (`affinePixelMap`): click and hover pick the scaled tile, Brush,
   Fill and Pick write the texel under the pointer, the marquee catches tiles any pixel in the box
   reads, selections and group members are shaded over the tile's real footprint, and Zoom to
   selection / group frame one scaled copy. **A background group now covers its worlds' affine
   mode too** (layers `[0]` match affine draws, layer 1), so a group made on the tower before the
   zoom follows it; before this, a group made from affine tiles matched nothing. Also fixed: the
   start-up handoff check overwrote the status line of a pack opened by hand meanwhile.
   Not built: a flat 1:1 map view — painting the zoomed frame (texels are large) and the frames
   before the zoom covered the need. **Next:** phase 4 — optional higher-resolution layer art
   sampled through the transform; HBias worlds; SpriteStudio's background view of affine frames.
   **Parked (Sep 30 2026), until more affine-heavy games are tried (Mario Tennis next):** the
   authoring UX. Confirmed for Mario Clash: the zoom reuses the pre-zoom worlds (28/29), the same
   BG map to the byte and only patterns already drawn before it, so tile paint made on the normal
   frame scales correctly — the user painted the tower that way and it holds up through the zoom.
   Open questions to revisit with real examples: (1) the unit of work for affine layers — the
   whole map as one picture, with each captured frame a "transform" of it (a name like poses for
   sprites; "transforms" suggested, undecided); (2) a flat 1:1 source-map view to paint on, which
   games without a normal frame will need; (3) a transforms list / scrubber on scaled groups;
   (4) transition overrides (art or colours per transform range) and HD pictures through the
   transform. Faithfulness still unproven on real data: the rotation path (DY ≠ 0), overplane
   outside the map, HBias worlds. Worth checking whether Red Alarm draws with affine tiles at
   all — its wireframe may be drawn into the frame buffer by the CPU.
   **Mario's Tennis (Sep 30 2026, branch `affine-mario-tennis`):** the court (world 28) is a
   perspective floor — one zoom per scanline, 0.6× at the far baseline to 2.9× at the near edge,
   no rotation; the port matches the core's records on every affine world of an InGame frame. Its
   23 tiles never appear as plain tiles in any capture, and use only pixel values 1 (lines) and 3
   (surface). Fixed: the Project tool dropped the world table under a world filter, so an isolated
   affine world fell back to rigid tiles (a jumbled court); and the preview's grey fallback now
   goes through the game's BG palettes (GPLT) — this game inverts palette 0, so the white lines are
   value 1. Sprite palettes (JPLT) are not in the frame data, so sprites keep raw values.
   **Backlogged (Sep 30 2026): scene backdrop and layer fill colours.** Where no world draws a
   pixel the VB shows its backdrop shade (BKCOL), and there is nothing to paint there. Idea: two
   colours on a group, set in SpriteStudio and applied while the group's tiles are on screen —
   a *scene backdrop* (every pixel no world draws, behind everything) and a *layer fill* (a
   world's window rectangle, behind that world's tiles, at its depth — e.g. sky behind Mario's
   Tennis's stands, worlds 30/31, a left/right-eye pair). Not needed yet: a full-screen layer-art
   paint of world 30 covers the in-game screen.
   **Characters on Mario's Tennis (Sep 30 2026):** the near player (world 22) is a BG layer whose
   tile slots the game rewrites — an Animated tiles group. The far player (world 26) is a scaled
   layer with a distinct slot per drawing, so SpriteStudio now shows a BG or affine group as one
   card per captured frame that shows something new of it, any card can be kept as a pose, and the
   Project tool can make background and affine poses. Auto-capture asks what to watch for
   (background, sprite, scaled, or all), so the far player's drawings can be collected by playing.
   **Not yet:** tracks (animation preview) for BG groups with poses.
7. **Colour vanished a tile early at the top of the screen** — **fixed Sep 2026** (BG).
   Reported on IntroCin: clouds scrolling up past the top lost their colour while the red
   picture still showed them. Cause: the core's draw-list hook records a BG tile only on the
   scanline of its source row 0 (and the pixel of its source column 0), so a tile cut by the
   top — or left — of its window is never recorded, though its visible rows are drawn. World 3
   there has `GY −73`, `MY 64`: screen row 0 is 1 px into a tile, so a whole row of 48 tiles
   at y = −1 was missing. `src/vip-edge-tiles.js` rebuilds exactly the unrecorded cells from
   the world table and BG maps each frame (≈7 µs per eye), and the compositor draws them. On
   `Mario Clash (Japan, USA).vbpack`, across 122 captures, 840 tiles recovered with no
   duplicates; the IntroCin cloud frame goes from 2,447 red-only pixels in the top rows to 0.
   Details in [vip-state.md](../reference/vip-state.md).
   **Fixed at the source too (Sep 28), sprites included:** core patch level 3
   (`patches/beetle-vb-vip-draw-list-edge-tiles.patch`, built with `scripts/build-core.sh` —
   see [core-build.md](../core/core-build.md)) records every BG and sprite tile on its first
   drawn scanline/pixel. Live over 2½ minutes of intro, all 7,765 tiles the old rule dropped
   were in the draw list, no duplicates, plus sprite tiles above the top edge. The JS recovery
   now only repairs frames from older cores (existing captures). **Still open:** HBias worlds
   in that JS path (none seen in Mario Clash).
8. **Cloud layers swap between even and odd worlds** (found Sep 28). In the live intro the
   same cloud layers are drawn in worlds 26, 24 … 6 on some frames and 25, 21 … 11 on others —
   the game double-buffers its world table. The IntroCin cloud groups name only the even worlds
   (`criteria.windowIds`), so on odd-world frames their colours do not apply and the red shows
   through. Quick fix for a pack: add each group's twin world. Better: let a group match a world
   *and its double-buffer twin*, or match by BG map (`BGMAP_BASE` + map position) instead of
   world number, which is what actually identifies a layer's art.

---

## Tools

### The same tile, a different colour per world (Sep 2026)

Reported on the intro cinematic: a solid "black-out" tile fills several layers at once and
needs a different colour in each. What the data says, measured on `IntroCin` frame 6 of
`Mario-Clash-Japan-USA-v3-annotated.vbpack`:

- **17 world/layer combinations**, all layer 0. The solid shade-3 tile `#360779f5` is drawn in
  **12 worlds** — w2, w3, w4, w5, w6, w10, w12, w14, w16, w20, w24, w26 — 166 to 286 copies
  each.
- **Group criteria already scope by world and layer** (`criteria.windowIds` + `criteria.layers`
  in `drawMatchesGroup`), so one group per world already selects and outlines correctly.
- **Paint does not follow that scope.** Colour is stored per tile pattern in `.vbcolor`, so
  painting `#360779f5` in a world-scoped group colours it in all twelve. This is why a plain
  per-pattern group cannot express "black-out tile, different per layer".
- **Anchoring cannot rescue those worlds.** VIP-overlay (position-scoped) paint needs the
  anchor pattern to be drawn exactly once within its world+layer+eye
  (`useVipOverlayForZoomPaint` → `countSameHashWorldLayerEye === 1`). In the fill worlds
  **no pattern is drawn exactly once** — they are pure repeats. Only the detail worlds have
  candidates: w18 has 11, w9 has 29.

**Built (Sep 2026) — group-scoped paint.** A group holds its own per-pattern colours in
`groups.json` as `tileColors`, applied only to draws matching its criteria (world + layer +
hashes), falling back to the global `.vbcolor` when the group has none. It needs no anchor and
handles hundreds of repeats for free. Anchored overlays keep their narrower job: different
colours for the same pattern *within* one group, on a screen that does not scroll.
Code: `src/group-tile-colors.js`, `resolveGroupTileRgba` in `src/color-layer.js`, both tools.

Two decisions worth remembering:

- **Sprite patterns stay shared.** Painting an OBJ pattern still writes the global pack, because
  SpriteStudio's model is that every pose using that pattern updates together. Only BG groups
  keep colours to themselves.
- **Tile colours are not gated on game state**, unlike position overrides. The Project tool
  stamps the active pool variant onto every new group, so gating would make paint vanish as
  soon as the game left that state — including right after Save and Play. An override swaps
  artwork and must be state-aware; a colour is appearance.

**Built (Sep 2026) — the painted-tiles inventory.** *Painted tiles…* in the Groups panel lists
every colour with its swatch, where it is stored, which groups can reach it, and how many draws
use it on the current frame. It defaults to **shows on this frame**; the other filters are
everything / no group can reach it / shared pack / owned by a group. Each row has **Clear**,
which is the only way to remove a shared-pack colour that no group's criteria name — the group
panel's *Clear paint* works through a group's hash list and is blind to those. Ctrl+Z undoes a
clear. All three stores are represented: a group's own `tileColors`, the shared pack, and an
anchored group's positioned overlay. An overlay has no per-pattern structure — it is one image
— so it gets a group row that **expands into one row per painted 8×8 tile**, each with its
screen position, the group it belongs to, the pattern drawn under it, and its own Clear. Rows
that stand for a whole group sort above the long tail of individual patterns, so a group
painted entirely by overlay is not buried under its neighbours' per-pattern rows.
Code: `src/paint-inventory.js`, `renderPaintInventory` / `clearPaintedPattern` in `tools/painter/paint-inventory-ui.js`.

**Built (Sep 2026) — moving paint into a group.** A shared-pack row in the inventory has a
**→ *group*** button that hands that colour to the selected BG group: it moves into the group's
`tileColors`, the pattern joins the group's criteria so the group actually claims it (without
that the moved paint would simply vanish), and every other copy of the pattern goes back to
unpainted. One undo step. This is the fix for art that is already painted — move the intro
cinematic's shared black-out tile into `CloudLayer26`, then paint it differently in the other
eleven layers.

**Built (Sep 2026) — the save progress window.** Saving a real project is several seconds: on
`Mario-Clash-Japan-USA-v3-annotated.vbpack` (153 MB, 106 captured frames with their RAM dumps
and screenshots) the zip alone is most of it. A modal window now shows the five steps —
checking, collecting, packing, writing, tidying — with a weighted bar, the file being packed as
JSZip reports it, and how long each step took. It stays up with the message when a step fails,
and closes itself when the save succeeds. Save and Play and the SpriteStudio handoff use the
same window. Model in `src/save-progress.js` (pure, injectable clock); `buildArtPack` takes an
`onUpdate` that forwards JSZip's progress.

**SpriteStudio shows the same window** (Sep 2026), through the shared
`tools/shared/save-progress-ui.js` so the two cannot drift apart.

**Decided: the window is modal on purpose.** A save you would want to keep working through
means something else is wrong and should be fixed there, not worked around by letting the tool
drift out of sync with the file being written. Blocking also means that if a save does get
stuck, the previous version is still on disk — Save keeps a `.bak` when it overwrites through a
project home — so the recovery story is "reopen the backup", not "hope the half-written state in
memory is sound".

**Built (Sep 2026) — one group, one store.** *Fill selection from reference* used to write to
the shared pack even on an anchored group, while the brush on that same group wrote to its
overlay; that is how `JapaneseSafetyText` ended up split across two stores. Reference fill now
follows the same routing as the brush. On an anchored group it samples **each copy where it
sits** rather than averaging the copies into one pattern — positional paint has no reason to
make them agree (`referencePixelsForPlacements` in `src/reference-fill.js`). *Clear paint* on a
group now reaches its overlay too, which it never did.

**Alternative considered — anchor to the world instead of a tile.** Derive the world's
bounding box from its own draws and store the overlay relative to that. Survives scrolling and
needs no unique tile, but it is a bigger change and only buys per-position colour, which these
flat fills do not need.

#### What each approach actually costs (measured Sep 2026)

The worry that layer/world filtering is what made the intro cinematic drop frames turns out to
be wrong: the cost was in how the compositor was written, not in the data model. Benchmarked on
`IntroCin` frame 6 (4794 draws on one eye, 122 patterns, 12 world-scoped groups), before and
after the Sep 2026 optimisation:

| Strategy | Before | After |
| --- | --- | --- |
| Per-pattern paint only, no groups | 5.29 ms | 5.36 ms |
| 12 world+layer scoped groups, no overrides | 4.55 ms | 4.43 ms |
| 157 group-scoped position overrides | 12.24 ms | **5.93 ms** |
| 12 anchored VIP overlays, full-frame paint | 8.58 ms | 9.57 ms |
| 12 anchored VIP overlays, realistic sparse paint | — | **5.45 ms** |

What was slow: `resolveOverrideRgba` rebuilt a group lookup `Map` for every draw,
`drawMatchesGroup` ran `Array.includes()` scans and allocated arrays per draw, and
`anchorDrawPresentForGroupEye` re-hashed the whole draw list once per group. Fixed by building
the group index and normalised criteria sets once per frame, hashing draws once per blend, and
blending only an overlay's painted bounding box.

**Conclusion: anchors are not the cheap path.** World/layer criteria matching is the cheapest
thing here — it is a couple of integer set lookups per draw and does not even clear the noise
floor. Anchored overlays are the most expensive, because each one costs a presence scan plus a
blend pass, and that cost scales with the number of groups whatever the criteria say. So there
is no compute argument for combining anchors with layer filters: add criteria to narrow *which*
draws a group owns, and add an anchor only when a group genuinely needs position-scoped colour.

**One more constraint on anchors, from the same frame.** The overlay is stored in fixed screen
space and the anchor only gates whether it draws — `blendPainterV2VipOverlaysIntoImageData`
never repositions it. So an anchored overlay is only correct on a layer that does not scroll,
which rules it out for the parallax cloud layers in this cinematic. That, plus the "no pattern
is drawn exactly once" finding above, means group-scoped paint is the only approach that
actually solves the black-out tile for these worlds.

### Layer art: a picture replaces a BG group's layer (Sep 28 2026)

**Built.** Asked for the Level 1 backdrop (world 30, `Backwall`): a 296×160 window built from
only 9 repeated patterns, whose edge colours blended into the scene because tile paint colours
every copy of a pattern alike.
- **Model:** a BG group's `layerArt` — an image in its layer's **BG-map coordinates**
  (`world`, `bgmapBase`, `mapX/mapY/width/height`, base64 `png` in groups.json).
- **Renderer** (`src/layer-art.js`): for each screen pixel of the world's window, maps screen →
  map → art with the VIP's own `DrawBG` arithmetic, so scroll and per-eye parallax line up.
  `compositeColorFrame` skips the world's tiles and draws the art at the world's depth
  (front worlds still cover it; transparent art shows what is behind; dims with fades).
- **When it applies:** only while the group has a tile on screen in that world, and only if the
  world draws from the art's BG map — a double-buffer twin showing another part of the map is
  left alone (Level 1's worlds 26/27 use different map regions).
- **Authoring in SpriteStudio:** Replace layer with art (seeded from the layer's current look),
  Brush with sizes 1–16, Fill, Pick, Clone and Undo on the picture; **Import image**, **Paste**
  / Ctrl+V, **Copy**, **Export PNG** (exact size), Remove. Pixel ops in `src/layer-art-edit.js`,
  PNG and clipboard in `src/layer-art-png.js`.
- **Everywhere:** the emulator and the Project tool decode the PNG and draw it; the Project tool
  keeps `layerArt` when it saves and will not paint tiles on such a group.
- **Checked:** unit tests against the VIP mapping (scroll, parallax, depth, fades), and in the
  browser: import → stage → brush → undo → save → PNG of the right size → Project tool preview
  (all 6,048 px of a 378×16 test layer) → live emulator title screen (all 6,048 px).
- **Size:** a PNG per layer — far smaller than an anchored overlay (raw full-frame RGBA per
  group per eye).
- **Fixed the same day — other screens' overlays baked into new art.** Enabling it on
  `Backwall` produced a picture containing the Safety text and the VIRTUAL BOY splash (2,279 px,
  every one exactly where those groups' overlays are painted). SpriteStudio drew *every*
  overlay on *every* frame (`blendOverlays` in `tools/shared/pack-session.js`), and new art is
  seeded from a render. Now overlays appear only on frames showing their group's anchor
  (`overlayGroupsOnScreen` in `src/painter-v2-vip-overlay.js`, the emulator's rule), and seeding
  renders the layer's own tiles with no overlays at all. Art made before the fix keeps what was
  copied in: Remove it and Replace again.

**Phase 2:**
1. **Affine and HBias layers** — sample the same map-space art through the world's affine
   parameters or per-line offsets (both in `segments`). This is the way to colour the Clash
   Tower zoom (worlds 28–29, ~78 s into the intro).
2. **Keep animated tiles alive on top of layer art** (starfield-style twinkles in a replaced
   layer freeze today).
3. **Paste into a box** rather than always replacing the whole picture, for touching up one
   area from a paint program.
4. **A matte that reaches outside a window** (the IntroCin top-row letterbox) — layer art stops
   at the layer's window by design.

### Touch-ups: "this spot only" paint anchored to tiles (Sep 28 2026)

**Built.** Asked while painting the pipes (`PipeLowerRight`, world 14): some black-out pixels
could not be painted, because tile paint lives on patterns (reused by every copy) and never
colours blank tiles or transparent pixels. The old answer, a screen-pinned overlay painted when
the anchor tile was unique on screen, did not follow scrolling, was per eye, silently switched
the Project tool's brush, and cost a full 384×224 RGBA frame per group per eye.
- **Model** (`src/touch-up.js`): a BG group's `touchUp` = `{ anchorHash, box, layout, png }`
  relative to the anchor tile. `layout` records the group's tiles around the anchor. The
  touch-up is drawn where an anchor tile has ≥ 60% of that layout around it
  (`TOUCH_UP_MIN_MATCH`), so the same corner piece in another pipe layout keeps plain tile
  paint. The user chose **required arrangement matching** for now ("seems prudent to require
  per-level touch-ups"). Relaxing it (anchor alone, or a per-touch-up threshold) is a later
  option.
- **Renderer:** `compositeColorFrame` runs touch-ups and layer art as one back-to-front queue of
  per-world "passes". A touch-up goes at its world's depth over the tiles, placed per eye from
  the anchor's own draw, dimmed with fades; its box is its only limit (it may reach past the
  window, up to the whole screen). On a scaled (affine) world it is placed among the map cells the
  VIP reads and drawn through the scaling (`affineTouchUps`, Oct 1 2026). Pixels share the
  layer-art picture store under `touchUpKey(id)`.
- **Known limit (Oct 2 2026):** arrangement matching drops a touch-up wherever its layer scrolls
  far enough to change what surrounds the anchor, and SpriteStudio's frame cards can then all be
  such frames. Superseded by the overpaint plan above (item 0).
- **SpriteStudio:** a **Paint on: Tiles / Touch-up** switch (T) routes Brush / Fill / Pick /
  Clone to the touch-up. Touch-up mode is obvious: amber stage border, a
  "TOUCH-UP · this spot only" badge, a dashed box at each place, the rest dimmed, and the stage
  framing the box. Also **Show touch-up**, a Touch-up panel (Add, Grow/Shrink ±8,
  Import/Paste/Copy/Export, Clear, Remove, where it shows), undo, and PNG on save and hand-back.
- **Project tool:** keeps `touchUp`, shows a **touch-up** pill and a details line. BG painting
  now always goes to tile colours; the automatic overlay switch is retired.
- **Old overlays convert on open**, in both tools: each becomes a touch-up anchored where it
  was painted, on the first captured frame showing the anchor (`convertOverlaysToTouchUps`).
  Overlays whose anchor no frame shows are kept as they were.
- **Fixed on the way:** in the Project tool, undo after the first stroke on an unpainted pattern
  left the starter ramp behind. The snapshot was taken after `getPackRgba256ForHash` had
  created it. Overlay painting had hidden this for anchor groups.

**Next:**
1. Tiles mode: on hover, outline every copy a stroke will change (the plan's "copies" cue).
2. Paste an image into part of the box, not the whole touch-up.
3. ~~Revisit arrangement matching once real packs show where it is too strict.~~ They did
   (Mario's Tennis backdrop, Oct 2 2026): replaced by the overpaint plan, item 0.

### Managing groups as a project grows (Sep 28 2026)

**Built:**
- **Project tool: clicking a group selects all its tiles on the frame,** and turns on any world
  (or clears a layer filter) that hid them — added to the worlds already on, never replacing
  them (`selectGroupFromTree` / `revealGroupOnFrame` in `tools/painter.js`). The old
  "reveal if hidden" could never fire: it compared two counts that both ignored the filters.
- **Project tool: which screens use a group.** Colours are not screen-scoped (a group applies
  wherever its tiles appear), so this is computed from the captured frames, indexed once in the
  background after a pack loads (`src/group-screens.js`; about 0.5 s for 120 frames). Rows get a
  pill ("6 screens", a screen name when it is not the one the group is filed under, or "not in
  captures"); a **Shared by several screens** section heads the tree; details say
  **Shows on: …**. On the Mario Clash pack, 28 of 41 groups are shared. Colorize! frames saved
  for poses ("Current (Colorize!)") are not counted as screens.
- **SpriteStudio: folders.** A group's optional `folder` path in groups.json
  (`src/group-folders.js`), per list (Sprites / Other groups): + Folder, drag rows onto
  folders, a Folder picker in the right panel, rename (✎, can re-nest) and remove (✕, contents
  move up). The Project tool's `normalizeGroup` now keeps `folder` — before, any unknown group
  field was dropped on its next save.
- **SpriteStudio keys:** arrows, Space and Delete no longer act while a text box, dropdown or
  slider has focus, and Ctrl+Z is left to text boxes (a colour well or checkbox still undoes
  paint). From the use-case review.

**Next, in order of payoff:**
1. **Keep the selected group across frame changes** — now that selecting a group selects its
   tiles, stepping frames to see where it appears should keep it (and reselect its tiles).
   Today every frame change deselects it ([use-case-review.md](use-case-review.md) §4).
2. **Type to filter groups** — **SpriteStudio done (Oct 7 2026)**: a search box over both lists
   (Ctrl+K), every word must match the name or folder; the Project tool's New pose list filters
   the same way and lists recently used groups first. **Project tool done (Oct 8 2026)**: *Search
   groups* at the top of the right rail (Ctrl+K), over the group tree, opening the screens and
   variants that hold a match. **Still open:** an **On this frame** filter there that hides groups
   with no tiles on the current frame — the screen index already answers that per frame.
3. **Paint progress per group** in both lists ("12 of 19 patterns painted"), so an unfinished
   group stands out. Also listed under pose suggestions (item 1, step 6).
4. **Folders in the Project tool too**: a "By screen | By folder" switch over the same
   `folder` field, so one organisation serves both tools.
5. **Group double-buffer twins** (Graphics item 8): let a group match a world and its twin, so
   cloud-style layers do not need two groups or hand-edited world lists.
6. From the clean-up backlog: real labels for the group action buttons (D2.10), "Legacy &
   unassigned" renamed and hidden when empty (D2.20), and undo for deleting a group
   ([use-case-review.md](use-case-review.md) §4).

### SpriteStudio — rethink the UX (Sep 2026)

Raised while painting: **the background handling is confusing** — it was unclear what was being
used behind a sprite and why it changed. Two concrete things are already fixed: the stage and
the filmstrip thumbnails now **default to no background** (scenery is noise while painting a
sprite), thumbnails follow the same *Background* toggle as the stage instead of always drawing
scenery, and changing the stage colour rebuilds the strip instead of leaving it stale.

The rest is a **design question, not a bug list**, and wants thinking through as a whole rather
than patched control by control. What is tangled today:

- **Three different "backgrounds" share the word.** The *stage colour* (a flat fill, default hot
  pink so sprite edges show), the *frame* the pose came from, and *pinned* background (one
  frame's scenery reused across a whole animation so it does not jump). The toggle is named for
  the second, the colour picker sets the first, and *Pin bg* is a third control next to them.
- **Which frame a pose is shown over** is implicit — a pose's source frame, or the pinned one,
  or a fallback when neither resolves.
- **The stage is an isolation view in some ways and a faithful preview in others.** It
  deliberately shows a group's background even when other worlds cover it (unlike the emulator
  and the Project tool, which mask by depth), but that intent is invisible in the UI.

Worth deciding first: is the stage meant to show *the sprite as art* (isolated, flat backdrop,
no scenery) or *the sprite in place* (as the game draws it)? Most of the confusion comes from it
trying to be both without saying which it is at any moment.

### SpriteStudio — from painting a real sprite (Sep 2026)

Found while colouring Mario in `Mario-Clash-Japan-USA-v3-annotated.vbpack`. The first two are
bugs; the rest are gaps.

1. **A transparent tile in front swallows the paint** (the "can't paint Mario's shoes" bug).
   `poseTileAtVip` returns the front-most pose draw whose **box** contains the pixel, without
   asking whether that pixel is lit. Measured on Mario / Walk03 at 127,158: the pose holds a
   shadow tile (`#bbc4c058`, 15/64 lit) drawn at 119,194 and 127,194 — 4 px lower than the
   shoe row, and **empty on rows 194–196**, exactly where the shoes show through from the
   tile behind (`#6f9a72a3`, draw index 5551 vs the shadow's 5738). Clicking the shoes paints
   a shade-0 pixel of the shadow pattern, which never renders, so nothing happens.
   **Fix:** prefer the front-most draw whose pixel is actually lit; fall back to the
   front-most only when none are. Worth naming the tile being painted in the status line, so
   an overlap is visible rather than mysterious.
2. **Side by side breaks the pointer mapping** (regression, Sep 2026). `vipFromClient` divides
   by the whole canvas width, which side-by-side doubles, so every click lands at the wrong
   x while that mode is on. **Fix:** map through the painted pane's width (`stagePaneW`),
   and ignore clicks on the reference pane for painting.
3. **DONE (Sep 2026)** — stage background colour, a swatch next to Onion, hot pink by default and remembered per browser. Original note: **nothing separates a sprite from the background it was captured on.** Dark sprite edges
   vanish into a dark scene, and the captured background makes it worse. **Fix:** a stage
   background colour control — a plain swatch, defaulting to something loud (hot pink) so
   edges are unmistakable, remembered per user. Interacts with *Show background*.
4. **A pose framed somewhere it was never captured** (reported for Spiny; **not reproduced**).
   Checked in that pack: every pose locates fully on its own `sourceFrameId` — Spiny / Walk
   12/12 at 167,171, Spiny / Attack 13/13 at 185,173 — and the stage renders the sprite inside
   its outline on both eyes. The failure mode that *would* do this is a pose with no (or a
   stale) `sourceFrameId`: `buildPoseViews` then falls back to the frame with the most
   matching tiles, which for a repeated enemy is happily another copy on the other side of
   the screen. Needs the group and pose name next time it shows, then: prefer the source
   frame, and when falling back say which frame was used and that it is a guess.
   **Update (Sep 25):** the no-source case had a concrete cause: poses captured on the Current
   (Colorize!) frame were saved without one, and went blank when no saved frame showed them
   (Mario / RopeHangUp). Save now gives every such pose a real source frame, promoting Current
   into `vipstates/` when needed, and SpriteStudio also loads the Current frame. A stale id and
   the "say it is a guess" note are still open.
5. **DONE (Sep 2026)** — a reference now counts as aligned only for the frame it was made from, except a state-scoped one over a BG group (backgrounds do not move). Otherwise the panel says "from another frame: colours only, not aligned here" and Side by side, Paste into box and Fill are disabled. Original note: **a reference from the wrong frame is shown as if it fitted.** When a pose's source frame
   has no reference, SpriteStudio falls back to any reference whose source frame shares the
   state name. The image is placed for *that* frame, so a sprite captured elsewhere sits over
   unrelated art — it looks like an empty piece of background, and the ghost box maps oddly.
   **Decided:** keep the fallback as loose colour context, label it "from another frame" in
   the panel, and disable *Side by side*, *Paste into box* and *Fill*, because its placement
   means nothing for this sprite.
6. **DONE (Sep 2026)** — Flip ↔ ↕ for the sprite view and ↔ ↕ for the reference, view only; the pointer is un-flipped to match, and nothing stored changes. Original note: **flip a pose and its reference on X and Y.** Wanted for drawing a mirrored walk cycle
   without recapturing it. Must keep which-is-which: the stored pose and the paint stay in
   the captured orientation, so the emulator still draws it correctly — flipping is a view
   over that, exactly as track steps already do with `flipH` (`stageMirror`, and
   `tileUnderPointer` already un-flips the pointer). **Decided: a view only** — nothing about
   the stored pose or the emulator changes. A flipped **reference** needs the same
   treatment on the sampling side (`screenPixelForPatternPixel` already undoes draw flips).
7. **Painting brightens a tile as you go** — unpainted tiles render dimmed with the scene,
   painted ones at full strength, so a pose lightens tile by tile while you work. Reported as
   "annoying but fine". Fix would be to preview paint at the scene's brightness, or to dim
   nothing while a group is selected.

### SpriteStudio

- **Reorder poses** in the filmstrip (drag).
- **Pair an OBJ group with the BG group it sits on** (`linkedGroupIds`), so eyes-over-a-face
  style assets are colored in context.
- **DONE (Sep 2026)** — BG groups paint here **per tile pattern**, into the group's own
  `tileColors` (not the anchor overlay): a repeating pattern is coloured once and every copy
  follows, including on scrolling layers, where a screen-pinned overlay would not. A group that
  already has overlay paint asks first, since the overlay is blended on top and would hide it;
  clearing it is undoable. Found while doing it: the first stroke on an unpainted tile seeds it
  from a fixed grey ramp, not the shades the game's palette draws it in, so the rest of that
  tile shifts shade on first touch (sprites too). Seed from the displayed shades instead.
- **Eraser** (back to unpainted), alongside the brush, fill, picker and undo in the tool rail.
- **DONE (Sep 2026)** — *Animated tiles* for BG art the game animates by rewriting tile slots
  (IntroCin starfield twinkle, which blinked: each step is a new pattern). Phases in SpriteStudio,
  shade-ramp colour for unpainted steps. **Next:** auto-capture stopping on a phase not seen yet,
  so collecting every step is letting the scene run; and choosing the ramp colours by hand.
- **DONE (Sep 2026)** — handoffs between pages store packs as Blobs: a 180 MB pack failed
  *SpriteStudio →* with "value too large" (Chrome's ~128 MB IndexedDB value limit).
- **DONE (Sep 2026)** — *Carry the pack back*: when SpriteStudio was opened from the Project
  tool, the header link reads **← Project tool** and hands the pack back with SpriteStudio's
  changes; the Project tool reopens on the frame, eye, layer, group, isolate filter and zoom it
  left, still saving to the same file, and marked unsaved when either side changed something
  (`tools/shared/project-return.js`).
- **DONE (Sep 2026)** — paint tools moved to a rail on the stage's right (Look, Brush, Fill,
  Pick, Clone, colour, palette, Undo, Clear; keys V B G I C); the top toolbar keeps view
  settings. **Fill** is 4-connected, crosses tiles within the pose/region unless *Across tiles*
  is off, and skips pixels the game draws transparent.

### Emulator

- **DONE (Sep 2026)** — *Load pack* silently did nothing for packs over ~128 MB (a 189 MB
  project). Storing it as *Last pack* put the whole ArrayBuffer in IndexedDB; Chrome aborts
  that transaction (`UnknownError`), `saveLastVbpack` listened only for complete/error, so
  its promise never settled and the load (and the Save and Play return, which awaits the
  same call) stopped there. Now stored as a Blob, and an abort rejects
  (`src/vbpack-storage.js`).
- **Auto-capture: wait out fades** — it can stop mid-fade on a nearly black frame. Skip
  frames while screen brightness is low, so it stops on the first clear frame (needs a
  threshold decision).
- **Re-apply a `.vbpack` without a full reload** — loading a pack after a session has run
  (restarting the ROM with it, or a failed Save and Play handoff) is unreliable.
- **Find packs by ROM** — `manifest.romFileName` is recorded; look packs up by ROM name or
  hash.

### Standalone pack editor (`tools/editor.html`)

- Load an existing `.vbcolor` to extend it, and batch-color tiles. Low priority: the
  Project tool and SpriteStudio are where colors are made now.

---

## Shipping to players

**Built Oct 17 2026:** the PC player keeps the ROM and the pack apart and finds a ROM's pack by
itself: the player's remembered choice, then `Game.vbcplay` beside the game, then any pack for that
ROM's SHA-1 in a packs folder ([vb-color-player.md](../design/vb-color-player.md#finding-a-play-pack)).
Left: the same in the web player, and offering packs from a packs repo.

Two halves of the same idea, neither started (and a third, backlogged: libretro compatibility, below). A `.vbpack` is a **working project** and is meant
to be big — measured on `Mario-Clash-Japan-USA-v3-annotated.vbpack`, 153 MB across 106 captured
frames. Almost none of that is needed to *play* the result.

### Publish: a player-only pack format

What a colourized game actually needs at runtime, measured on that same pack:

| Part of the pack | Size | Needed to play? |
| --- | --- | --- |
| `vipstates/` (106 captured frames) | 92.5 MB | no — authoring only |
| `savestates/` | 40.0 MB | no |
| `ramdumps/` | 6.6 MB | no — memory *analysis* input; the recipes it produced live in `groups.json` |
| `references/` | 6.2 MB | no |
| `screenshots/` | 3.8 MB | no |
| `painter-v2-vip-overlays.json` | 1.8 MB | **yes** |
| `groups.json` (criteria, `tileColors`, pools, RAM gates) | 144 KB | **yes** |
| `manifest.json` | 108 KB | partly — a published one can be far smaller |
| `color.vbcolor` | 37 KB | **yes** |
| `overrides.json`, `painter-v2-rules.json` | ~0 KB | **yes** |

**About 2 MB of colour data against 153 MB of project** — a published file should be roughly
1–2% of the working one. The runtime reads live VIP state from the core, so captured frames,
save states, RAM dumps, screenshots and references are all authoring scaffolding.

Design notes for when this gets built:

- **Do not embed the ROM.** The pack carries one (1.0 MB above) because the authoring loop needs
  it, but a published colourization is a *patch over a game the player already owns*. It should
  name the ROM it expects (title, size, hash) and refuse to run against the wrong one, not ship it.
- **The overlays are the whole payload** at 1.8 MB, and they are full-frame 384×224 RGBA per
  group and eye, mostly transparent. Cropping each to the box it actually paints would shrink
  this a lot — `paintedBounds` in `src/painter-v2-vip-overlay.js` already computes that box, and
  the painted-tiles inventory already lists overlays per 8×8 cell. As group `tileColors` take
  over from anchored overlays, this shrinks on its own.
- **A published file should be read-only by construction** — no authoring fields, so the player
  build cannot be asked to write one back.
- **Open:** versioning and forward compatibility (a player on an older build meeting a newer
  file); whether one file can hold several games; whether to keep the ZIP container or use
  something flatter.

### A player-only build of the emulator

The app minus the authoring surface: load a ROM and a published colour file, play in
Monochrome / Palette / Color, and nothing else. No capture, no groups, no pools, no tools hub.

- Worth it because the authoring code is most of the app, and a player has no use for any of it
  — smaller download, fewer ways to break a project, and a far smaller thing to make
  presentable for a public release.
- The colour layer (`src/color-layer.js`) is already UI-free and would carry over as-is; this is
  mostly about which entry point and which parts of `src/main.js` a player build includes.
- **Open:** one repo with two Vite entry points or a separate build; whether the player build
  should be able to *open* a full `.vbpack` too (convenient while the format settles, but it
  undermines "published files are read-only").

### Libretro compatibility (backlogged Oct 10 2026)

**Planned Oct 14 2026: [design/libretro-core.md](../design/libretro-core.md)**: the core, what players
see in RetroArch (installing it, loading a game), packs found by ROM SHA-1, and a packs repo on
GitHub, in five phases. The notes below are kept for the scope list.

**Backlogged, not started** (backlog #19). Asked for Oct 10: make the entire system compatible with
the libretro project. First planned Oct 8 as "a sythnvtby libretro core", on hold for the licence;
that is settled — the project is **GPL-3.0-or-later** (Oct 10), compatible with Beetle VB
(GPL-2.0-or-later) and RetroArch (GPL-3.0).

**Scope to agree before starting** — what "compatible" should mean:

1. **A sythnvtby libretro core** (below): colour inside the core, so every libretro frontend plays
   coloured games.
2. **Packs the libretro way:** a play pack found beside the game or in the frontend's system
   folder; core options for colour, 3D mode and per-game settings.
3. **Our Beetle patches upstream-ready:** the VIP draw-list export (`patches/`) offered to
   beetle-vb-libretro, or kept behind a build flag, so the stock core and ours stay one codebase.
4. **The browser emulator on standard libretro pieces:** today it runs a patched EmulatorJS
   RetroArch build; keep it buildable from upstream plus our patches (`scripts/build-core.sh`).
5. *(Open)* whether captures, RAM dumps and authoring should work from RetroArch too, or
   authoring stays browser-only.

The original plan, kept:

Today the colour is added outside the emulator — by the browser page or the SDL player, from the
tile data our Beetle patches export — so a libretro frontend (RetroArch and others) shows only the
red picture. A **dedicated sythnvtby libretro core** would do the colouring inside the core: our
patched Beetle (`patches/`), then the native colour layer (`native/core`, checked pixel for pixel
against the browser) applied to each eye before the core hands its frame over. Every libretro
frontend would then play coloured games — Windows, Mac, Linux, Android, Steam Deck, homebrewed
consoles — with their shaders, rewind, netplay and controller mapping, for less work than a
console-specific port.

- **Reuses:** the colour layer, play-pack reader, stereo layout, screen limits and game-state
  conditions (memory is directly available inside a core) — `native/core` as it is.
- **New:** the libretro wrapper (`retro_run` runs Beetle, then colours its picture); core options
  (colour on/off, 3D mode: 2D / side-by-side / anaglyph, coloured per eye before combining);
  finding the play pack (`Game.vbcplay` beside `Game.vb`, or in the frontend's system folder).
- **Risks:** speed on weak handhelds and phones (measure the colouring per frame); distribution —
  the official libretro build servers may not take a fork, so own builds per platform at first.
- **Size:** M — mostly wrapping and testing on real frontends.
- Only playback moves; the authoring tools stay in the browser (unless item 5 above says otherwise).
- **Order:** after C1 (one project session, [refactor-plan.md](refactor-plan.md)) and ideally C2 (the
  staged compositor mirrored in C++), so the core reuses one well-tested model.

### Auto-colouring (backlogged Oct 11 2026)

**Backlogged, not started** (backlog #20). On Oct 10 the user asked Claude to colour the rest of
Mario's Tennis itself. The attempt, kept outside the repo in `MarioTennis\auto\` (a separate pack;
the user's pack untouched; scripts in `auto\tools\`):

- **Capture bot:** Playwright drives the emulator page — picks matchups in the menu, plays with
  random input, and lets auto-capture stop on new tiles (974 frames in ~1 hour; periodic capture
  once the page slowed at ~1,000 frames).
- **Rules-based colourer:** per character, split each pose into areas along its white outlines, name
  each area by where it sits (crown, hair, dress…), its shade and texture, map shades through that
  area's ramp, and let every pattern pixel take the colour it got most often across all poses.
  Opponents are coloured on their unscaled affine source rebuilt from the map cells sampled.
- **Result:** 94% of lit pixels coloured on new match frames, but the user judged the quality not
  good enough: tinted rackets, faces taking hair colour, shell plates split, no Doubles partner.

**Worth keeping regardless:** the capture bot (as a tool: "play this matchup and capture what is
new"), and one finding — the InGame screen recipe (WRAM byte 0 == 48) matches only ~20% of match
frames, which hid KoopaBackground's paint (fixed in the auto copy only).

**To decide before resuming:** iterate on the rules with the user's eye on each character; or
start from reference art (per-pixel voting, as VBoyColor does); or colour one pose per character
properly and propagate.

**Oct 11 — the last one, built as Auto-paint.** Tested on Yoshi-PlayingAs first (2 painted poses →
35 filled; 64–79% of pixels right when one view predicts the opposite view, much better between
poses facing the same way). It matches each pixel by the mix of shades around it at several sizes,
its depth inside the sprite and its height, lets neighbours vote, folds small specks into what
surrounds them, and gives each pattern pixel the colour most poses chose. It never repaints a
chosen colour or a reference pose's tiles, and one Undo takes a run back.

**Also Oct 11–13 (SpriteStudio):** *Original* view and hold O; the Overpaint panel's *Drawing on
this card*, with Move/Remove for a character's all-poses picture from any card; ◩ on cards with a
pose picture; arriving from the Project tool opens the pose on that frame that still needs paint
(`tools/shared/poses-needing-paint.js`); tool keys work after using the toolbar; Onion and Original
controls show only while on; the default paint colour is blue, not a red that looks unpainted.

---

## Recovery mode: never lose work (Oct 7 2026)

**Why:** a SpriteStudio Save refused (*“the overpaint of … is 512×224 but its pixels are 2×3”*)
over pose pictures nobody had touched. Cause, fixed Oct 7: undoing the start of a pose picture
restored the whole group from before a Save, putting every other pose picture's settings back to
their wide pre-save size over pixels the Save had cropped. The refusal was right — writing would
have misplaced the paint — but it left only one way out: clearing work until Save went through.

**Principle:** a problem with one part of the project costs that part, never the session.
Damaged parts are set aside *with their data* (never dropped silently), everything else saves,
and the tool says what was set aside and how to bring it back.

**Failure states, and the recovery each wants** (most likely first):

| Failure | Today | Recovery |
|---|---|---|
| A picture's settings and pixels disagree at Save (this bug) | Save refuses everything | **Save anyway**: write the pack with those pictures moved to a `recovery/` folder in the pack — their PNG at its real size plus their settings JSON — and list them. On open, SpriteStudio shows *Recovered pictures* per group: drop one on a pose's card to place it (Import image path), or discard it. |
| A picture's stored PNG is not the size its settings say (packs saved by older builds, Oct 6) | Draws in the wrong place | Detect on open, draw nothing for it, list it as *damaged* with the same recovered-picture flow; offer automatic placement where it is provable (an intact `.bak` copy, or an exact fit on its tiles, as done by hand for the Mario's Tennis repair). |
| Browser tab closed, crashed or reloaded with unsaved work | Lost | **Journal**: every few minutes and on each stroke-end, write changed groups and dirty pictures to IndexedDB; on the next open of that pack, offer *Restore unsaved work from 14:32?* |
| Writing the file fails (disk full, permission to the file lost, file locked) | Save fails, status message | Offer **Save as…** (or a download) straight from the failed save window, with the same contents. |
| Handing the pack between the Project tool and SpriteStudio fails (IndexedDB quota or value size) | Handoff fails | Fall back to a download and say so; the other tool opens it from the file. |
| One group in `groups.json` is malformed (bad JSON value, unknown structure) | That group, or the whole open, can fail | Open the rest; keep the bad group's raw JSON in `recovery/` and list it, rather than dropping or rejecting the pack. |
| A zip entry is truncated or corrupt (half-written file, bad copy) | Open fails | Read every entry that is intact, report the rest, offer the `.bak` beside it. |
| A captured frame or RAM dump will not parse | That frame errors | Skip it with a note; the frame registry keeps its row so it can be recaptured. |

**Bringing set-aside work back:** File ▸ Import from another pack (`src/pack-merge.js`) already
merges groups and paint from a second `.vbpack`; extend it to overpaint and pose pictures, and to a
pack's `recovery/` folder, so work saved out of a broken session can be merged into a repaired copy.

**Built (Oct 7 2026)** — `src/recovery.js`, `src/work-journal.js`, user guide *When something goes
wrong: recovery*:
- **Save anyway** in SpriteStudio: out-of-step pictures are set aside (after asking) into the pack's
  `recovery/` folder and the rest saves; listed per group as *Recovered pictures* with Put back
  (best fit on the tiles' drawn pixels, asks when not certain), Export PNG and Discard. The Project
  tool keeps the folder through its saves.
- **Damaged on open**: a picture whose PNG is not its settings' size is set aside the same way.
- **Journal** (SpriteStudio): unsaved work kept in IndexedDB 2 s after each change, cleared by a
  successful save or hand-back; reopening the pack offers it back.
- **Failed write**: the save window offers Save as… and Download a copy (both tools).

**Journal for the Project tool (Oct 8 2026)** — `src/project-journal.js`: groups, paint, overrides,
pools, game states, rules, frame overlays and frame names kept 3 s after the last click or key while
something is unsaved; restored through the normal load path (merged into the opened pack's parts,
then reopened unsaved). Frames, reference images and recordings are not copied (large, and from the
pack or the emulator).

**Left, in order:** handoff fallback to a download → malformed groups kept raw in `recovery/` → reading intact zip
entries around corrupt ones → skipping unreadable frames. Extending *Import from another pack* to
overpaint, pose pictures and `recovery/` is still open.

---

## Code health (review, Oct 7 2026)

Larger refactors suggested by the Oct 2026 review, most useful first. A fuller analysis and a phased plan that includes these: [refactor-plan.md](refactor-plan.md) (Oct 9). None is urgent; each removes a
class of bug that has already happened at least once.

1. **One group schema for every reader** — *built Oct 9* (`src/group-schema.js`). The Project tool's `normalizeGroup` (`tools/painter.js`)
   keeps only the fields it knows, so each new group field — `folder`, `screens`, `followPalette`,
   `wholePose`, `poseOf`, `poseOverpaints` — had to be added there by hand or a Project tool save
   silently dropped it (it happened with `folder`). Move the field list, validation and defaults to
   a new *group schema* module in `src/` with its own tests, and have the Project tool, SpriteStudio, the play
   pack and the docs' format table follow it.
2. **One owner for a picture's state in SpriteStudio** — *built Oct 9* (`src/picture-store.js`). A picture lives in three places: its
   settings on the group (`overpaint` / `poseOverpaints`), its pixels in the layer-art store keyed
   by id, and the `artDirty` set. They drifted apart twice (Save widening the picture before the
   pack was written; a row click reselecting an old copy of the group), each time moving the paint.
   A small *picture store* module next to SpriteStudio that owns all three, and enforces
   "pixels are the size the settings say" on every write, would make those bugs impossible rather
   than caught at Save.
3. **Split the two big tool files** — *built Oct 9* (`tools/painter/`, `tools/sprite-studio/`). `tools/painter.js` is ~9,200 lines and `tools/sprite-studio.js`
   ~5,000, well past the 800-line guideline. Natural seams: SpriteStudio's overpaint (~1,100 lines:
   targets, scope, create/move/remove, panel), group list (tree, folders, search), stage and
   cards, tracks; the Project tool's groups panel, frame list, screens UI, paint inventory and file
   menu. Module-level state (`session`, `selectedGroup`, `poseViews`) becomes a small shared
   context object passed in.
4. **`compositeColorFrame` takes 22 positional arguments** — *built Oct 10*: it takes one options object now. (`src/color-layer.js`; see the call in
   `native/tests/parity/make-golden.mjs`). Pass one options object, so call sites can't put a flag
   in the wrong slot, and new options stop needing every caller touched.
5. **Make parity routine** — *built Oct 10* (`tests/fixtures/fixture-pack.mjs`, `src/native-parity.test.js`). Every colour rule exists twice, in `src/` and in
   `native/core/src/colorizer.cpp`, and the parity check is what keeps them equal — but it needs a
   real project and is run by hand. Check in a small synthetic pack (no ROM: frames, groups,
   pictures) and run browser-vs-native on it from `npm test` when the native build is present, with
   the options (`poses:`, `follow:`, screens) as fixed cases.
6. **Retire old formats on a schedule.** Touch-ups, layer art, screen-pinned overlays and
   one-group-per-pose pictures are converted when SpriteStudio opens a pack, but the Project tool,
   the emulator and both players still read every one. Run the same upgrade in the Project tool on
   open, record it with a `groupsSchemaVersion` bump, and after a release or two drop the old
   rendering paths.
7. **One per-frame pattern cache.** Several modules hash every draw's tile again for themselves
   (`hashOf` in `src/layer-art.js` and `src/overpaint.js`, `hasherFor` in
   `tools/shared/pack-session.js`, the compositor). A shared `framePatterns(state)` (WeakMap per
   state) would remove the repetition and make the next per-frame index — like the pose pictures'
   — a one-liner.
8. **Add a linter** — *built Oct 9* (`eslint.config.js`; its first run found 18 leftovers, all fixed). There was none; the review found six unused imports by script. ESLint with
   `no-unused-vars`, `no-undef` and `eqeqeq`, run with the unit tests, catches that class of
   leftover on every change.

---

## Before a public release

Fewer debug options on screen, quieter console logs, and the rest of
[ship-readiness-cleanup.md](ship-readiness-cleanup.md). (Color mode already switches on when a
loaded pack has colors.)

---

## Done recently (Sep 2026)

For detail, `git log` on `master`.

- **SpriteStudio** — sprite-first page: poses over their captured scene, named animation
  tracks with per-step hold and mirroring, per-pattern sprite painting, palette, onion skin,
  pinned background, reference image; BG groups shown for context.
- **Pause and step** (Oct 1 2026) — P pauses, . and , step a frame (Shift: 10), F8 captures the
  paused frame. Stepping back restores one of the last 150 frames' save states (`src/frame-step.js`,
  ~60 MB of buffers reused in a ring); the frame data after stepping back matches frame for frame.
- **Auto-capture** — the emulator stops on frames showing a tile no captured frame has,
  outlines it, and asks for a label; dismissing turns it off. Since Sep 30 2026 it first asks
  what to watch for: background, sprite and/or scaled (affine) tiles (`src/auto-capture.js`).
- **Project tool** — renamed from Painter v2 and moved to `tools/project.html`; *Analyze
  memory* runs on the open pack; memory pools matched by RAM fingerprint; unique BG anchors;
  zoom to group and the group filter fixed; frame stepping; select matching, selection
  modes, draw-stack panel, frame PNG export.
- **Sprite poses** — data model (`groups.json` schema v3) and capture from the Project tool.
- **Blank tiles** — ignored by selection, skipped when compositing (87–96% of BG draws in
  Mario Clash frames were blank tile 0).
- **Project home** — pickers start in the chosen folder, permission state is honest, and
  Save and Play overwrites the pack you opened, keeping a `.bak`.
- **Paint v1 removed** — the Project tool and SpriteStudio replace it.
- **Docs** reorganized into folders with a master guide and `npm run docs:check`.
