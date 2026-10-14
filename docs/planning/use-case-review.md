---
status: living
last-reviewed: 2026-10-13
covers: index.html, src/main.js, src/color-layer.js, src/art-pack.js, tools/project.html, tools/painter.js, tools/painter/, tools/sprite-studio.js, tools/sprite-studio/, tools/shared/pack-session.js
---

# Use-case review: an honest look at the core workflows

> **A snapshot from Sep 26 2026.** Much of what it asks for has been built since (game states, Check
> project, frame numbers, group search, recovery, the Eraser and redo, both tools split into parts),
> and its file and line references are to the code as it was then. What is still open lives in the
> [backlog](priorities-and-next.md) and the [debug clean-up backlog](debug-cleanup-backlog.md).

This review asks one question: **how well does the tool suite serve someone who wants to
color a sprite-based Virtual Boy game, and what would make it better?** It is deliberately
blunt. The engineering underneath is careful and well measured. Most of what follows is
about what the user sees, and about the places where that engineering reaches the screen
without a filter.

**Method.** I read the three main pages in full (`src/main.js`, `tools/painter.js`,
`tools/sprite-studio.js`) plus their supporting modules. I drove the real app in headless
Chrome, doing a screenshot tour and a from-scratch run on Mario Clash: ROM → capture →
Colorize! → group → paint → Save and Play. I measured the sample packs and ran the checks:
unit tests 404/404, build passes, and the last browser-suite run on record is 66/66. Serious
claims were checked against the code and are marked *verified*.

Companion documents: the [user guide](../guide/user-guide.md) (how to use the suite today)
and the [debug clean-up backlog](debug-cleanup-backlog.md) (concrete tasks).

---

## The verdict in one paragraph

The core loop works and is clever. You **play → capture → Colorize! → paint → Save and Play
→ see it in the game**, and the loop carries your exact frame, game state, file and even zoom
level between pages. It's the best thing in the project. Around that loop, though, the suite
is **an expert's debugging console wearing a UI**. A new user is shown internal identifiers
on nearly every screen: pattern hashes, world numbers, `compositeColorFrame`,
`manifest.frameRegistry`, `__default__`. They need about fifteen concepts before they can
paint a pixel, and the tool stores their paint in one of three places by a rule they can't
see. There are several ways to **lose work without a warning**. There's no way to share the
result with a player. Project files are **14× bigger than they need to be** because they're
saved uncompressed. None of this is deep, and most of it is a week or two of focused work.
The foundations are good enough to deserve that work.

### Scorecard

Scores are out of 5, from the point of view of a basic user coloring a sprite game.

| # | Use case | Score | One-line summary |
|---|----------|:-----:|------------------|
| 1 | Get started (install, first run) | 2 | Needs Node and a terminal. The first screen buries four needed buttons among ~15 controls and a paragraph of jargon. |
| 2 | Capture the game | 4 | F8, named captures and Auto-capture are good. Captures silently vanish if you do the wrong thing next. |
| 3 | Color a sprite | 3 | SpriteStudio is pleasant. Getting poses into it means drawing boxes by hand, and sprite paint leaks everywhere. |
| 4 | Color backgrounds | 2 | Works, but where paint goes depends on hidden per-frame rules, and one of those paths throws away unsaved paint. |
| 5 | Same tile, different color | 2 | Solved for experts (group colors, inventory, "→ group"), but needs a mental model the UI never teaches. |
| 6 | Iterate (the loop) | 4 | Genuinely good. Let down by a dropped file handle and slow, huge saves. |
| 7 | Keep and share the result | 1 | No player format. Packs contain the ROM, run 40–150 MB, and are uncompressed. |
| 8 | Play someone's colorized game | 2 | Possible with their pack and a Node setup, but the player then sees the whole authoring UI and debug panel. |

---

## 1. Get started

**What works.** `npm install && npm run dev` works first time. The patched core ships in
the repo. The splash screen says "Load a Virtual Boy ROM (.vb) to start."

**What hurts.**

- **The setup is aimed at the wrong audience.** Needing Node and a terminal filters out most
  people who want to color a game. Yet the app is **already a static site**:
  `npm run build` produces 3.5 MB of files that run a game with full frame export. I served
  `dist/` and booted Mario Clash (*verified*). The only thing preventing hosting is that the
  paths assume the site root (`/data/`, `/tools/project.html`).
- **The first screen is crowded and uninformative:**
  - It is one wrapping row of ~15 controls.
  - It has two "pack" pickers side by side: **Load pack** and **Color pack (optional)**.
  - It has two lines of text about "VIP-exporting core … VIP compositor … VIP-style 2bpp
    shade … 'Palette 0 holes' is experimental".
  - Once a game runs, **a debug panel appears under it for everyone** (*verified*:
    `src/main.js:1434-1441` shows it whenever the core sends a draw list, which the bundled
    core always does).
  - Nothing on the page shows a beginner the order of operations: Load ROM → play → capture
    → Colorize!.
- **Three names for one product** (since renamed: sythnvtby): one on the emulator and hub, another
  (Project tool, SpriteStudio) and `colorized-vb` (package).
- There is no help in the app. The README's quick start stops at "load a ROM and play".

**Improve.**

1. **Host the static build** on Cloudflare Pages, Netlify, or GitHub Pages with a `base`
   fix. ROMs never leave the user's machine anyway. This one change removes the biggest
   barrier.
2. **Give the header a beginner layout**: *1 Load ROM or project · 2 Play & capture · 3
   Colorize!*, with everything else under **Advanced**. Hide the debug surfaces behind one
   Developer-mode switch (backlog Step 0).
3. **Add a first-run card** in the Project tool for packs with no groups: "Pick a frame → set
   Layer to OBJ → drag around a sprite → New pose from selection". The empty state is the
   natural place to teach.

## 2. Capture the game

**What works.**

- F8 quick capture.
- The capture dialog remembers state names.
- Each capture bundles a VIP frame, a RAM dump, a screenshot and a save state, so every
  frame can be revisited.
- **Auto-capture** is the smartest feature in the suite. It stops on sprite tiles you
  haven't captured, outlines them, and suggests the screen name from memory. That directly
  targets the hard part of coloring a sprite game: finding every pose.

**What hurts.**

- **Captures live only in memory, and three buttons silently discard them:** Load ROM, Load
  pack, and **Last pack** (which even reloads the page). The emulator also has no
  `beforeunload` guard (*verified*: `src/main.js:1704, 1813, 1869-1872`). The status line
  says "unsaved vbpack (N frames)" but never says what would save them.
- The capture dialog talks in the memory analyzer's terms: "Game state (high-level) /
  Sub-state … for RAM analysis". That means nothing to a user.
- Auto-capture can stop mid-fade on a near-black frame. This is already in the backlog.
- Capture failures (WRAM, screenshot) are reported only in the console.

**Improve.** Guard unsaved captures, and say "N frames not saved — Colorize! or Export to
keep them". Relabel the dialog fields **Screen** and **Detail**. Make Auto-capture skip dark
frames.

## 3. Color a sprite

**What works.** SpriteStudio is the most pleasant page in the suite:

- A loud backdrop, so sprite edges show.
- A filmstrip of poses, with onion skin.
- Single-key tools (V B G I C).
- A palette of the colors you've used.
- Reference images with "fill from reference".
- Poses that share tiles update together as you paint, which makes a whole animation fast
  to color.
- The handoff back to the Project tool restores exactly where you were.

**What hurts.**

- **Getting poses in is the bottleneck.** Every pose is a box drawn by hand in the Project
  tool, one per sprite per frame, and SpriteStudio can't create poses at all. The backlog
  has already measured the opportunity: 60 sprite instances automatically collapse to 30
  poses and 12 characters. *Pose suggestions* is the right next feature.
- **Sprite paint is global, and the UI doesn't say so.** OBJ paint is written per tile
  pattern into the shared pack. It therefore colors that pattern *everywhere*, including
  unrelated art that reuses the tile (*verified*: `paintTargetGroupFor` returns null for OBJ
  groups, `tools/shared/pack-session.js:425-429`). The status line says "every pose using
  them updates together", which is true but incomplete. **Clear…** also wipes the pattern
  across the whole game.
- **Tracks don't reach the game.** Animation tracks are preview-only; the emulator never
  reads them. The UI doesn't say this.
- **Mirrored poses aren't matched.** `allowFlipMacro` is stored, but nothing reads it.
- **Input and state bugs:**
  - In side-by-side mode, ← / → both change pose *and* nudge the reference box.
  - Arrow keys and Space still act while you type in number fields.
  - Changing **Eye** or **Brightness** resets your pose, track and zoom.
  - The flip buttons show no pressed state.
  - A legacy single-track animation silently ignores edits while reporting success.
- **Missing basics:** no eraser, a 1-px brush only, and no redo.
- **SpriteStudio's Save** writes to the project home with no `.bak`. When you've arrived
  from the Project tool, that's a second, less safe way to save. Its handoff is never
  deleted, so a later visit from the hub reopens a stale pack.

**Improve.**

1. Pose suggestions with mirror-aware matching. This is already planned items 1 and 2, and
   correctly prioritized.
2. **Pose-aware rendering** in the emulator, coloring a sprite's tiles only when its pose is
   present. That stops the paint leaking. Until it lands, **say so**: "These colors apply to
   this tile everywhere in the game (used in N other places)".
3. Eraser, brush sizes, and redo.
4. Label tracks **Animation preview**.
5. When you've arrived from the Project tool, make **← Project tool** the only way to save.

## 4. Color backgrounds

**What works.**

- Selection is flexible: Replace / Add / Subtract, Select matching, and Layer and world
  filters.
- The **Stack** panel shows what sits under a pixel.
- **Painted tiles…** is excellent. It's the one place that shows every color, where it
  lives, and lets you move it.
- **Save and Play** shows the result in the game immediately.

**What hurts. This is the weakest part of the suite.**

- **Three paint stores, chosen for you.** When you paint a background group, the tool picks
  one of two stores by checking **whether the group's anchor tile is unique on the current
  frame and eye**:
  - A positional overlay, which is pinned to screen coordinates, doesn't follow scrolling,
    is stored separately per eye, and appears only while the anchor is on screen.
  - The group's own per-pattern colors, which follow the tiles wherever the group's layer
    draws them.

  The two behave completely differently. The only sign of which one you got is a status
  line that says "VIP paint layer" or "vbcolor tile8". The same group can land in different
  stores on different frames. That is exactly the split-store problem the "one group, one
  store" change set out to fix, brought back through anchor uniqueness.
- **The overlay path loses unsaved paint** (*verified*). On frame change and on **Reload
  frame**, `loadVipFromJson` calls `clearVipAuthoringOverlay()`. Overlays are then restored
  from `loadedPackParts`, which only `syncLoadedPackPartsAfterSave` updates
  (`tools/painter.js:388-391, 1831-1837, 5954, 5238-5260`). On top of that, **Reload frame**
  is styled as a primary button next to Save and Play.
- **The "anchor" doesn't actually anchor.** The overlay is a fixed full-screen buffer. The
  anchor only decides *whether* it shows; it's never used to reposition the paint.
- **The New group dialog is confusing.** It asks for a **memory pool + variant**, which has no
  effect on color, surrounded by text like "pattern hash(es) → draw(s) … registry / VIP /
  selection did not resolve; v2 variant did not single out one row … anchorHash … VIP
  overlay / macro placement" (seen in the from-scratch run).
- **Painting is blocked until a group is selected**, and Fill and Brush go grey without
  saying why. The Brush also needs zoom, zoom disables Select and clears the selection, and
  changing frame deselects the group.
- The first stroke on an unpainted tile turns the whole 8×8 **red** (the "default ramp").
- A group made from **Affine** tiles, or from a mixed BG+OBJ selection, silently matches none
  (or only half) of what was selected.
- **Undo covers paint only.** Deleting a group warns that it "cannot be undone until you
  reload the pack".
- The Project tool has no palette or swatch strip. SpriteStudio does.

**Improve.**

1. **Make the store an explicit, visible choice per group**: **Every copy** (group colors,
   the default) or **Just this screen spot** (overlay, opt-in, with a note that it won't
   scroll). Never switch automatically on anchor uniqueness.
2. Fix the overlay loss by keeping overlay buffers across frame switches; they're per group
   and eye, not per frame. Demote **Reload frame** to a secondary button.
3. Cut the New group dialog down to Name + Sprite/Background. Move screen/pool under
   Advanced and fill it in silently.
4. Say *why* a tool is disabled ("Select a group to paint"). Allow the brush without
   zooming. Keep the selected group across frames.
5. Seed first strokes from the shades on screen, not a red ramp.
6. Undo for structural edits (creating, deleting and changing groups), not just paint.

## 5. Same tile, different color

**What works.** The data model eventually got this right:

- Groups can own per-pattern colors, scoped by world and layer, with no anchor needed.
- The inventory flags colors that no group can reach.
- **→ group** moves already-painted shared colors into a group in one undo step.

The performance work behind this is exemplary: measured, benchmarked and written down.

**What hurts.**

- To even know this is possible, the user must understand patterns versus positions,
  groups, worlds and layers, and the three stores.
- **Memory pools are compulsory in the UI yet have no effect on color.** Group colors are
  deliberately not gated on game state (`src/color-layer.js`, comment near line 461); only
  the legacy position overrides are. Pools look like the "screen-specific color" feature a
  user would expect, and they aren't. That's a large cognitive cost for no painting payoff.

**Improve.** Teach this in one sentence, at the moment it matters. Add a **"This tile is also
used in: Level 2 floor, HUD…"** readout in the tile inspector, with a **Give this group its
own color** button. Hide pools entirely until the user runs Analyze memory, or until pools
gain a real coloring purpose.

## 6. Iterate: the Colorize! → paint → Save and Play loop

**What works.** This is the heart of the product, and it's good:

- Colorize! opens the Project tool on the exact frame.
- Save and Play restores the save state and resumes playing, in color.
- The SpriteStudio round trip restores frame, eye, layer, group, filter and zoom.
- Saves show a progress window.
- The Project tool keeps a `.bak`.

**What hurts.**

- **The file handle is dropped** when a pack is opened through the emulator's picker
  (*verified*). `pickOpenVbpackFile` returns `fileHandle`, but
  `openVbpackWithHomePreference` ignores it (`src/main.js:1727-1744`; the comment at `1705`
  is stale). As a result, Colorize! → Save and Play writes into the project home by name,
  or downloads, instead of overwriting the file you opened. This is invisible when your
  packs live in the project home and confusing when they don't.
- **Saves are slow and huge because packs are stored uncompressed** (*verified*).
  `buildArtPack` calls `generateAsync({ type: 'blob' })` with no compression, so JSZip uses
  STORE. All 133 entries of `marioclash-annotated.vbpack` are stored, and re-deflating that
  pack takes it from **42.5 MB to 3.0 MB**. A 153 MB project would plausibly drop to around
  10–15 MB, and every IndexedDB handoff would shrink with it.
- The loop relies on blocking `alert`/`confirm` chains, and on a fixed 400 ms sleep before
  verifying the handoff.

**Improve.**

1. Add `compression: 'DEFLATE'`. It's the best effort-to-payoff ratio in the codebase.
   Measure save time on the largest pack and choose the compression level to suit.
2. Keep the picked file handle.
3. Replace `alert`/`confirm` with dialogs in the existing style.

## 7. Keep and share the result

**What hurts. This is the gap between "a tool I use" and "a thing people can enjoy".**

- A `.vbpack` is a *project*. It embeds the ROM, so it can't legally be shared. About 98%
  of it is authoring scaffolding: frames, save states, RAM dumps, screenshots. The backlog's
  own measurement is 153 MB of project for about 2 MB of color.
- There is no publish step, no player build, and no hosted player. The design notes in
  [priorities-and-next.md](priorities-and-next.md) ("Shipping to players") are right: no
  ROM, identify the ROM by hash, read-only, cropped overlays. None of it has been started.
- In both sample packs the saved `color.vbcolor` is 19–36 bytes, i.e. effectively empty.
  All the paint lives in groups and overlays, so the `.vbcolor` format on its own no longer
  works for sharing colors either.

**Improve.** Build a **Publish** command in the Project tool that writes a small colors-only
file: the `groups.json` colors, the overlays, the `.vbcolor` and a ROM hash. Add a player
entry point that accepts that file alongside the user's own ROM. Together with the hosted
static build from §1, the project becomes something people can share.

## 8. Play someone's colorized game

**What hurts.**

- Today a player needs the author's `.vbpack` (which includes the ROM) and a Node setup.
- They then see the full authoring UI, including the debug panel.
- The status line says "Pack: vb-pack (0 tiles)" even for a fully painted pack. "vb-pack" is
  the default game ID, and the paint is in groups, which the count ignores.
- Display mode and view aren't remembered, so every reload returns to Monochrome.

**Improve.** Build the player-only build from the backlog. Until then, remember the display
mode, and fix the status line to show the pack's real name and a meaningful "colored"
measure.

---

## Cross-cutting themes

1. **Internals leak into the UI.** This is the biggest single usability problem. Status
   lines, dialogs and panels show:
   - function names (`compositeColorFrame`)
   - file names from inside the pack (`painter-v2-rules.json`, `manifest.frameRegistry`)
   - internal IDs (`f-mtkckd7v-cj0v9t`, `pool-title·__default__`)
   - tile hashes

   Each one helped the developer at the time. Together they make the tools feel hostile.
   The fix is mechanical (see the [clean-up backlog](debug-cleanup-backlog.md)) but needs
   one shared vocabulary; the [user guide glossary](../guide/user-guide.md#glossary) is a
   starting point.
2. **Hidden rules decide important outcomes.** Where paint goes (anchor uniqueness), whether
   sprite paint leaks (global patterns), and whether a pool matters (not for color) are all
   real, all consequential, and all invisible. Prefer an explicit choice with a good default
   over a clever automatic one.
3. **Work can be lost silently.** There are six verified ways:
   - unsaved captures lost on Load ROM, Load pack or Last pack
   - no close-tab guard on the emulator or the Project tool
   - Open pack… with no confirmation
   - overlay paint wiped on frame change
   - deleting a group can't be undone
   - failures reported only in the console

   A tool that asks for hours of careful painting has to be paranoid about this.
4. **The same job is done two ways on two pages.** Both tools paint backgrounds, but into
   different stores (SpriteStudio always uses group colors; the Project tool sometimes uses
   overlays), with a confirmation dialog papering over the difference. Both have Save, with
   different levels of safety. Overlapping features with different rules is how work gets
   lost.
5. **Legacy features are still on show.** A first-time user sees all of these, and needs
   none of them:
   - the "Developer — v2 tile8 rules" panel
   - the Color pack and Overrides inputs
   - the Frame viewer
   - the pack editor, which also decodes tiles wrongly
   - the tile extractor
   - the standalone memory-analysis page
   - the Python analyzer download
6. **The code is hard to change safely.** `tools/painter.js` is 7,754 lines of top-level
   mutable state, about 10× the project's own 800-line ceiling. `src/main.js` is 2,757 lines
   and `tools/sprite-studio.js` is 2,342. There are three hand-rolled flood fills alongside
   `src/flood-fill.js`. Every UX fix above is harder because of this. Splitting selection,
   paint stores, references, inventory and saving out of `painter.js` would pay for itself
   quickly.
7. **What deserves praise.**
   - The measurement culture: benchmarks in the repo, numbers in the docs, and "measure
     before redesigning".
   - The docs discipline: headers, `docs:check`, review dates.
   - The test suite: 404 unit tests and a 66-test browser suite driving the real emulator.
   - The Save and Play loop, Auto-capture, how SpriteStudio feels, and the painted-tiles
     inventory.

   Nearly all the problems are on the surface, which is the cheapest place to have them.

---

## If there were two weeks

In priority order. Each item is small, and together they transform the first hour.

| Days | Work | Why first |
|------|------|-----------|
| 0.5 | Compress packs (DEFLATE); keep the picked file handle | 14× smaller files and faster saves, for one line of code |
| 1 | Data-safety guards: unsaved captures, close-tab guards, Open pack confirmation, overlays kept across frame switches, visible errors | Stops the ways users lose hours of work |
| 1.5 | Developer-mode switch; hide the debug panel, palette debug, developer panels and hub utilities | The first screen becomes calm |
| 2 | Plain-language copy pass (status lines, New group dialog, inspector) using one glossary | Removes most of the "hostile" feel |
| 1.5 | Explicit paint target per BG group ("Every copy" / "Just this spot"); "used in N other places" readout; "Select a group to paint" hints | Makes the hidden rules visible |
| 1 | Beginner header on the emulator; first-run card in the Project tool | The UI itself teaches the loop |
| 1 | Host the static build (fix absolute paths, or deploy at a domain root) | Removes the Node requirement |
| 1.5 | SpriteStudio fixes: arrow/Space focus handling, Eye/Brightness no longer resetting, flip pressed state, one save path, delete the handoff key | Fewer "it did something weird" moments on the nicest page |

**After that**, in line with the existing backlog: mirror-aware pose matching, then pose
suggestions, then pose-aware emulator rendering. Then a Publish format and a player build,
and palette registers (GPLT) in the compositor so fades work.
