---
status: living
last-reviewed: 2026-10-13
covers: package.json, vite.config.js
---

# sythnvtby — project guide

Start here. This page explains what the project is, how the pieces fit, and where
every document lives. If you only read one doc, read this one.

> **Just want to color a game?** Read the **[user guide](guide/user-guide.md)** instead.
> Its TL;DR quick start takes you from a ROM to a colored sprite in about 20 minutes, and
> its glossary translates the jargon the tools show on screen.

## What it is

A **browser Virtual Boy emulator that plays games in color.** A patched
[Beetle VB](https://github.com/libretro/beetle-vb-libretro) core runs in the page and,
every frame, hands JavaScript a description of what it drew. A **color layer** redraws
that frame from colored art, tile by tile, wherever colored art exists — and the
original monochrome frame shows through wherever it does not. You can play in
**Monochrome**, remap the four VB shades with a **Palette**, or turn on **Color**.

The rest of the project is the **authoring tools** that make that colored art, and a
file format, the **`.vbpack`**, that holds one game's whole colorization project.

No ROMs or `.vbpack` projects live in this repo. Bring your own `.vb` ROM.

## How it works, in five pieces

1. **The core reports each frame.** The Virtual Boy's video chip (the *VIP*) draws a
   frame as a list of 8×8 tiles placed on screen, grouped into 32 layered *worlds*.
   Our patched core exports that **draw list** plus the tile **pattern table** — the
   *VIP state* — to JavaScript every frame.
   → [reference/vip-state.md](reference/vip-state.md),
   [reference/vip-rendering-validated.md](reference/vip-rendering-validated.md),
   [core/](#core--building-and-patching-the-emulator-core)
2. **Colors are keyed by tile pattern.** A tile's 16 bytes of pixel data hash to a
   32-bit key. The color pack (`.vbcolor`) maps that key to an 8×8 RGBA tile, so every
   place the game draws that pattern gets the same colors, flipped as the game flips it.
   → [reference/vbcolor-format.md](reference/vbcolor-format.md)
3. **Groups add context.** When one pattern needs different colors in different places, a
   *group* gathers the tiles of one thing on screen and carries its own paint. A background
   group can also have **overpaint**, a picture pinned to its layer's map. *Paint shows on*
   limits a group to some game screens (memory pools, recognized by bytes in the game's RAM)
   and *Paint shows when…* to some **game states** (e.g. "Luigi is the player"). Where two
   groups share a tile, the one listed first wins.
   → [design/group-override-design.md](design/group-override-design.md),
   [reference/overpaint.md](reference/overpaint.md),
   [design/memory-states.md](design/memory-states.md)
4. **Sprites have poses.** A sprite (OBJ) is many tiles that move and change together.
   A *pose* records one arrangement of them; *tracks* play poses as an animation.
   → [design/obj-sprite-profiles-design.md](design/obj-sprite-profiles-design.md)
5. **The color layer composites it all** over the monochrome frame, in the VIP's own
   world order. → [reference/color-layer-z-order-and-performance.md](reference/color-layer-z-order-and-performance.md),
   [reference/vip-color-layer-parallax-learnings.md](reference/vip-color-layer-parallax-learnings.md)

Everything for one game — ROM, colors, groups, poses, captured frames, RAM dumps,
memory analysis — travels in one `.vbpack` (a ZIP).
→ [reference/art-pack-file-format.md](reference/art-pack-file-format.md)

## The workflow

| Step | Where | What you do |
|------|-------|-------------|
| 1. Capture | **Emulator** (`/`) | Play. **Capture Frame** (or **F8**) saves the current frame; **Auto-capture** stops on any frame showing a sprite tile you have not captured yet. |
| 2. Analyze | **Project tool** (`/tools/project.html`) → *File → Analyze memory* | Finds the RAM bytes that identify each game screen and turns them into memory pools. |
| 3. Isolate | **Project tool** | Select tiles, make groups, pick anchors, capture sprite poses, paint backgrounds. **Colorize!** in the emulator opens this page on the current frame. |
| 4. Sprites | **SpriteStudio** (`/tools/sprite-studio.html`) | Step through a sprite's poses over the scene they came from, build named animations, paint the sprite. |
| 5. Play it | **Save and Play** | Writes the `.vbpack` and returns to the emulator on the same frame, in color. |

The **tools hub** (`/tools/`) links every page, plus a tile extractor, pack validator
and frame viewer. A **project home** folder (Chromium only) is where open and save
dialogs start.

## Code map

Plain ES modules, no framework. **`src/`** is the logic — formats, colour rules, groups, memory —
mostly pure functions, each with a Vitest `.test.js` file beside it. **`tools/`** is the two
authoring tools and the smaller pages; each tool is an entry file plus a folder of parts (see
[How the two tools are built](#how-the-two-tools-are-built)). Every colour rule also exists in C++
under `native/` for the PC player.

### `src/` — the emulator page

| Module | What it does |
|--------|--------------|
| `main.js` | The emulator page (`index.html`): ROM and pack loading, display modes, Capture Frame, Colorize! and Save and Play hand-offs. |
| `frame-capture.js`, `frame-step.js` | Capture ids and labels; Pause and step (step back by save state to land on an exact frame). |
| `auto-capture.js`, `tile-clusters.js`, `paint-gaps.js` | Auto-capture: which sprite tiles are captured, grouping tiles into on-screen clusters, and *Where paint doesn't cover yet* (unpainted tiles; a backdrop's tiles past its overpaint). |
| `display-hotkeys.js`, `stereo-view.js`, `stereo-output.js` | F9/F10 before/after keys; the monochrome picture's 3D view (core option); both eyes of the colour layer as side-by-side or anaglyph. |
| `memory-recorder.js`, `memory-panel.js` | The Memory panel: recording a question's sides while playing; which screen and game states hold right now. |
| `vb-emulator-ram.js`, `mednafen-savestate-wram.js` | The game's 64 KB WRAM from the running core, or from a save state. |
| `rom-storage.js`, `vbpack-storage.js`, `project-home.js`, `handoff-store.js`, `unsaved-work.js` | The last ROM and pack (IndexedDB), the project home folder, passing a pack between pages, and the shared wording for unsaved work. |
| `palette-layer.js`, `palette-diagnostics.js` | Palette mode (remap the four shades) and its self-check. |

### `src/` — the `.vbpack` and its frames

| Module | What it does |
|--------|--------------|
| `project.js` | **The one project model** every app opens a pack through (`projectFromParsed`: colours, overrides, groups through the schema, screens, game states, the transparent-paint flag) and **the one way to drive the compositor** (`colourOptions` / `renderProjectFrame` with a *view*: `play` for the emulator and player, `toolPreview` for the tools, `measure` for uncoloured counts). Also the authoring clean-up of stray transparent paint. |
| `art-pack.js` | Reading and writing a `.vbpack` (format: [art-pack-file-format.md](reference/art-pack-file-format.md)). |
| `zip-read.js`, `zip-write.js`, `lazy-entries.js` | Fast zip reading (native inflate), fast saves (unchanged entries copied as stored), and pack items kept compressed until read. |
| `group-schema.js` | **The group schema**: the fields every tool reads `groups.json` groups through (`normalizeGroup`, `GROUP_FIELDS`); unknown fields are kept. Add a group field here and to the format doc (a test checks they match). |
| `vbcolor-pack.js` | The `.vbcolor` colour table (pattern hash → 8×8 RGBA). |
| `vip-state.js`, `vip-dump.js`, `vip-world-clip.js`, `vip-edge-tiles.js` | VIP state from the core: tiles, hashing, flips, serialization, world clipping, and the edge tiles the draw list leaves out. |
| `frame-numbers.js`, `frame-metadata.js`, `frame-wram.js`, `screenshot-frame.js` | A frame's short number (`#57`), its name, tags and reference images, its WRAM, and its screenshot read back to exact pixels. |
| `frame-cleanup.js`, `pack-merge.js` | File ▸ Clean up frames (what can go, the archive pack) and File ▸ Import from another pack. |
| `rom-identity.js`, `play-pack.js` | The ROM's SHA-1/CRC32, and the play pack (`.vbcplay`) the player reads. |
| `pack-validator.js`, `tile-extractor.js`, `vb-2bpp.js` | The tools hub's validator, tile extractor and frame viewer helpers. |

### `src/` — drawing in colour

| Module | What it does |
|--------|--------------|
| `color-layer.js` | **The compositor** (`compositeColorFrame`, one options object): pack colours, overrides, groups, pictures, fades, both eyes. Apps call it through `src/project.js`, never with hand-built options. |
| `fade.js` | Dimming colour with the game's brightness. |
| `affine-world.js`, `affine-base.js` | Scaled and rotated (affine) layers sampled pixel by pixel, and their base tiles laid out 1:1. |
| `stereo-twin.js` | Layers drawn twice, once per eye, in neighbouring worlds. |
| `overpaint.js`, `overpaint-switch.js`, `pose-overpaint.js` | Overpaint (a picture pinned to a layer's map), when a picture switches on, and pose pictures. How they behave: [overpaint.md](reference/overpaint.md). |
| `layer-art.js`, `layer-art-edit.js`, `layer-art-png.js` | The picture store's pixels, painting on them, and PNG/clipboard. (Layer art itself is an older kind, converted to overpaint on open.) |
| `touch-up.js`, `painter-v2-vip-overlay.js` | Older paint kinds still read: touch-ups and screen-pinned VIP overlays. |
| `transparent-paint.js`, `starter-paint.js`, `shade-ramp.js` | Paint on see-through pixels, the starter shades a tile begins with, and colour by shade for tiles the game rewrites. |
| `uncoloured.js`, `pixel-explain.js` | How much of a frame is uncoloured; "what colours this pixel, or why not" (*This pixel*, Pick). |
| `pose-autopaint.js`, `original-view.js` | Auto-paint: a group's unpainted poses coloured from its painted ones, pixel by pixel from what surrounds each; a pose's original monochrome picture (SpriteStudio's *Original*). |

### `src/` — groups, poses and when paint shows

| Module | What it does |
|--------|--------------|
| `group-tile-colors.js`, `paint-inventory.js` | A group's own `tileColors`, and the inventory of every painted tile across all stores. |
| `group-order.js`, `group-worlds.js` | Which group wins a shared tile (the first listed), and groups that move between worlds. |
| `screen-gate.js`, `group-screens.js`, `game-states.js` | *Paint shows on* (screens) and *Paint shows when…* (game-state conditions): `groupsForScreen` decides which groups take part on a frame. |
| `group-folders.js`, `group-search.js` | Group folders and the quick search (both tools). |
| `obj-sprite-profiles.js`, `pose-source-frames.js`, `pose-clear.js`, `pattern-set.js` | Poses and animation tracks, moving a pose between groups, a pose's lasting source frame, clearing one pose's paint, and the smallest repeating set of a pattern. |
| `reference-fill.js`, `flood-fill.js` | Colours taken from a reference image; flood fill over screen pixels. |

### `src/` — game memory, project safety, the player

| Module | What it does |
|--------|--------------|
| `pool-match-by-ram.js`, `seed-game-state-pools-from-memory-analysis.js` | Memory pools (screens): built from Analyze memory, matched to a frame by its RAM. |
| `sub-state-learn.js`, `memory-questions.js` | Learning a game state from frames, and questions answered by recordings. |
| `recovery.js`, `work-journal.js`, `project-journal.js` | Pictures set aside instead of saved wrong, and both tools' journals of unsaved work. |
| `picture-store.js` | **One owner for a SpriteStudio picture**: its settings, live pixels and edited mark, written together; refuses pixels the wrong size. |
| `project-health.js`, `project-storage.js`, `save-progress.js` | Check project, Project storage, and the save progress model. |
| `player.js`, `player-flow.js`, `player-storage.js` | The sythnvtby Player (`player.html`). |

### `tools/` — the Project tool

`tools/project.html` + **`tools/painter.js`** (the code kept its old *painter* name) is the entry
point: the tool's state, the journal, opening a pack (`loadVbpackBuffer`), the menu wiring
(`wireMenus`) and `render()`. Its parts live in **`tools/painter/`**:

| Part | What it does |
|------|--------------|
| `frame-list.js`, `frame-data.js`, `frame-actions.js`, `frame-registry.js` | The frame dropdown, filters and stepping; screenshots, RAM dumps and Analyze memory; Frame menu actions; frame labels. |
| `view-filters.js`, `world-grid.js` | Eye, layer and world filters; filtering the view to a group, the world grid and the canvas overlay. |
| `selection.js`, `zoom-target.js`, `zoom-paint.js`, `canvas-input.js` | Tile selection; which group a draw belongs to and where a stroke goes; the zoomed brush and fill; canvas pointer, tool buttons and keyboard. |
| `paint-history.js`, `vip-overlay-paint.js`, `pack-rules.js` | Undo/redo; VIP overlay painting; older paint kinds read from the pack and written back at Save. |
| `groups-panel.js`, `group-detail.js`, `group-dialogs.js`, `groups.js`, `screens-ui.js`, `pools.js` | The groups tree; the group details panel; New group, New pose, rename, duplicate, delete; anchor pick and adding or removing selected tiles; Paint shows on / when; pools and variants. |
| `sprite-profiles-ui.js`, `pose-sources.js` | Poses from a selection and in the inspector; giving poses a lasting source frame at Save. |
| `paint-inventory-ui.js`, `reference-images.js`, `inspector.js` | Painted tiles…; reference images; This pixel and the inspector. |
| `file-menu.js`, `save.js`, `events.js` | File and Frame menus (export, import, clean up, write to disk); Save, Save and Play and the hand-offs; binding of the non-canvas controls. |
| `project-dialogs.js`, `health-panel.js`, `storage-panel.js`, `game-states-panel.js`, `frame-cleanup-ui.js` | Check project, Project storage, Game states and Clean up frames windows. |

### `tools/` — SpriteStudio

`tools/sprite-studio.html` + **`tools/sprite-studio.js`** is the entry point: state, opening a pack,
the journal, palette, playback and event wiring. It builds on **`tools/shared/pack-session.js`**, a
UI-free view of a loaded pack (frames, groups, paint, a frame renderer). Its parts live in
**`tools/sprite-studio/`**:

| Part | What it does |
|------|--------------|
| `poses.js`, `render.js` | The cards (each pose or frame resolved to a frame), the strip and its thumbnails, selecting a group; drawing the stage, the pose layer and the detail panel. |
| `painting.js`, `history.js`, `paint-scope.js`, `pick.js` | Brush, Eraser, Fill, Swap, Clone; undo/redo; Only this group's paint and clearing paint; Pick. |
| `overpaint.js`, `recovery.js` | Overpaint and pose pictures (through `src/picture-store.js`); recovered pictures and the Overpaint panel. |
| `group-list.js`, `tracks.js` | The group lists, folders and search; animation tracks. |
| `reference.js`, `ghost-box.js` | Reference images; side by side and the ghost box. |
| `autopaint.js` | The Auto-paint window: which poses to learn from and which to paint, progress, one undo step (`src/pose-autopaint.js`). |

### `tools/` — shared and other pages

| Where | What |
|-------|------|
| `tools/shared/` | `pack-session.js` (above), `save-progress-ui.js` (the save window), `project-return.js` (the Project tool's view carried through SpriteStudio), `recent-groups.js`, `animated-tiles.js`, `stage-view.js` (SpriteStudio's zoom and pan), `poses-needing-paint.js` (the poses on a frame that still need paint, which SpriteStudio opens on arriving from the Project tool). |
| `tools/memory-analysis*` | The standalone memory-analysis page and the analyzer it shares with the Project tool. |
| `tools/index.html`, `editor.*`, `viewer.*`, `extract.js` | The tools hub, tile extractor, pack validator and frame viewer. |

### Everything else

| Where | What |
|-------|------|
| `native/` | The C++ core library (every colour rule's twin, `colorizer.cpp`), Beetle VB behind `vbc::Emulator`, the SDL2 PC player, and the browser-vs-native parity tool. See `native/README.md`. |
| `player.html` | The sythnvtby Player page (`src/player.js`). |
| `public/data/` | The prebuilt, patched core the app actually runs. |
| `patches/`, `scripts/build-core.sh` | The core's patches and the script that rebuilds it reproducibly ([core-build.md](core/core-build.md)). |
| `tests/e2e/` | Browser regression suite (`s0` runs on the fixture pack, the rest need local files); `tests/e2e/manual-checks.md` lists what needs a human. |
| `tests/fixtures/` | The synthetic fixture pack, built in code. |
| `scripts/` | `check-docs.mjs` (the docs check), `bench/` (colorization benchmarks), `png.mjs` (PNG for Node), `readme-shots.mjs` (the README's before/after images, both halves from one captured frame). |
| `eslint.config.js` | The linter's rules (`npm run lint`, run by `npm test`). |

### How the two tools are built

Both tools follow one pattern, so code is easy to find and parts can't quietly reach into each
other:

- **The entry file owns the state.** `tools/painter.js` and `tools/sprite-studio.js` hold the
  tool's module-level state (the open pack, the selected group, the frame on screen…), open a pack,
  and hook up the controls. Helpers that change core state live there too (`markDirty`,
  `replaceSelectedGroup`, `markGroupsDirty`), so every change goes through one place.
- **A part is a module with an `init…` function.** The entry file calls `initX({ … })` once, at the
  point where the part's code used to sit, passing the state and functions the part uses:
  functions directly, state as getters (and setters where the part changes it). Inside the part
  they are `ctx.name`. A part never imports the entry file; parts may import each other.
- **Adding to a part:** use `ctx.something` for tool state; if the part needs something new from
  the entry file, add it to that part's `init…` call. Don't name a local variable `ctx`.
- **Adding a part:** create the module with `let ctx; export function initX(context) { ctx = context; }`,
  move the code, import what the entry file still calls, and call `initX` from the entry file.
  `npm run lint` lists anything left undefined or unused.
- **Pure logic belongs in `src/`** with a test beside it; a part should mostly be UI glue.

### Where to change what

| To change… | Look in |
|------------|---------|
| How a pixel is coloured | `src/color-layer.js` (and `native/core/src/colorizer.cpp`; check parity) |
| How an app draws a frame (fallbacks, transparent paint, which memory) | `src/project.js` — the views |
| Which groups take part on a frame | `src/screen-gate.js` (`groupsForScreen`), `src/game-states.js` |
| A group field | `src/group-schema.js` and [art-pack-file-format.md §6.4](reference/art-pack-file-format.md) |
| Opening or saving a pack | `src/art-pack.js` and `src/project.js` (`projectFromParsed`, used by every app); the Project tool's `loadVbpackBuffer` and `tools/painter/save.js`; SpriteStudio's `tools/shared/pack-session.js` |
| Overpaint and pose pictures | `src/overpaint*.js`, `src/pose-overpaint.js`; SpriteStudio `tools/sprite-studio/overpaint.js` |
| Project tool painting | `tools/painter/zoom-paint.js`, `zoom-target.js`, `canvas-input.js` |
| Project tool group details | `tools/painter/group-detail.js`, `screens-ui.js` |
| SpriteStudio cards and stage | `tools/sprite-studio/poses.js`, `render.js` |
| Check project | `src/project-health.js`, `tools/painter/project-dialogs.js`, `health-panel.js` |

## Working on it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # lint (ESLint, eslint.config.js), then unit tests (src/*.test.js, Vitest)
npm run lint         # lint only: unused imports and variables, undefined names, loose ==
npm run test:e2e     # browser suite; needs a local ROM and packs, see tests/e2e/harness.mjs
npm run docs:check   # the documentation check described below
npm run bench        # colorization cost on one frame; see reference/colorization-performance.md
npm run build
```

**CI:** GitHub Actions (`.github/workflows/ci.yml`) runs lint, the unit tests, the build, the docs
check and browser suite `s0` on every push and pull request. The other browser suites need a local
ROM and packs, so run them yourself before pushing work that touches the pages.

**The fixture pack** (`tests/fixtures/fixture-pack.mjs`) is a small synthetic `.vbpack` built in code —
three frames, a screen limit, a game state, a sprite pose, no ROM — for tests that must run
anywhere: its unit test, browser suite `s0` (`npm run test:e2e -- s0`), and native colour parity
(`src/native-parity.test.js`, part of `npm test` where `native/build` exists). Write
`node tests/fixtures/fixture-pack.mjs out.vbpack` to open it in the tools. Browser tests should wait
for a condition (`waitUntil` in `tests/e2e/harness.mjs`) rather than a fixed time.

Plain ES modules — no framework, no TypeScript. Rebuilding the emulator core is rare
and only needed for C/C++ changes: see [core/core-build.md](core/core-build.md).

## Documentation map

Docs are grouped by what they are for. Each one outside `history/` opens with a small
header saying whether it is **current** (describes how things work now), **partial**
(a design that is partly built — the doc says which parts), **proposed** (not built),
or **living** (a plan that changes as work moves).

### guide/ — using the tools

| Doc | What it covers |
|-----|----------------|
| [user-guide.md](guide/user-guide.md) | **For colorists, not developers.** TL;DR quick start, how coloring works, a tour of the emulator, Project tool and SpriteStudio, where your paint goes, a workflow for sprite games, gotchas, troubleshooting, shortcuts and a glossary. |

### reference/ — how things work now

| Doc | What it covers |
|-----|----------------|
| [art-pack-file-format.md](reference/art-pack-file-format.md) | The `.vbpack` ZIP: every file inside it and what reads it. |
| [play-pack-format.md](reference/play-pack-format.md) | The `.vbcplay` play pack the sythnvtby Player opens: the colour without the ROM or captures. |
| [vbcolor-format.md](reference/vbcolor-format.md) | The `.vbcolor` binary color pack. |
| [vip-state.md](reference/vip-state.md) | What the core exports each frame. |
| [vip-dump-format.md](reference/vip-dump-format.md) | How a captured frame is serialized to JSON. |
| [vip-rendering-validated.md](reference/vip-rendering-validated.md) | How the VIP really draws (strips, worlds, order), checked against hardware docs and the Beetle source. |
| [color-layer-z-order-and-performance.md](reference/color-layer-z-order-and-performance.md) | Compositor draw order, the monochrome fallback, and performance. |
| [colorization-performance.md](reference/colorization-performance.md) | What each colorization strategy costs, how to measure it (`npm run bench`), and what was tried and rejected. |
| [vip-color-layer-parallax-learnings.md](reference/vip-color-layer-parallax-learnings.md) | Scrolling, parallax and occlusion: what we learned debugging them. |
| [art-pipeline.md](reference/art-pipeline.md) | From a captured frame to a coloured pixel, end to end: what the core sends, capture into a `.vbpack`, where paint lives, which groups take part, and what the colour layer does. |
| [memory-analysis-tool-spec.md](reference/memory-analysis-tool-spec.md) | How memory analysis finds the RAM bytes that identify a game screen. |
| [game-memory-locations.md](reference/game-memory-locations.md) | Known RAM addresses for specific games. |
| [palette-rendering-plan.md](reference/palette-rendering-plan.md) | The palette display mode's pipeline and how it was verified. |
| [rollback-palette.md](reference/rollback-palette.md) | Palette mode troubleshooting and how to switch it off. |
| [vbcolor-loading-notes.md](reference/vbcolor-loading-notes.md) | When a loaded color pack does and does not take effect. |

### core/ — building and patching the emulator core

| Doc | What it covers |
|-----|----------------|
| [core-build.md](core/core-build.md) | **Start here** for rebuilding the WASM core: what is prebuilt, what the patches do, how to build. |
| [core-patch-add-world.md](core/core-patch-add-world.md) | The patch that adds the world index to each draw. |
| [core-patch-proposal.md](core/core-patch-proposal.md) | The original phased plan for exporting VIP state from the core. |
| [core-build-phase0-phase1-runbook.md](core/core-build-phase0-phase1-runbook.md) | Step-by-step early build runbook (Linux toolchain). |

### design/ — how features are meant to work

| Doc | What it covers |
|-----|----------------|
| [pose-aware-rendering.md](design/pose-aware-rendering.md) | Which group colours a tile two groups share: today the first listed; proposed, the group whose pose the draw is part of (backlog #16), with what is left after game states fixed Mario vs Luigi. |
| [obj-sprite-profiles-design.md](design/obj-sprite-profiles-design.md) | Sprite poses and animation tracks. |
| [overpaint.md](reference/overpaint.md) | **Current:** how overpaint works — what turns it on, where it draws, depth, stereo, groups sharing a layer, and sprite vs plain vs scaled groups side by side. Start here for overpaint. |
| [overpaint-redesign.md](design/overpaint-redesign.md) | **Partial (built Oct 2026):** replace touch-ups and layer art with one picture per group placed in its layer's map (so it survives scrolling); why touch-ups drop out today. |
| [vb-color-player.md](design/vb-color-player.md) | **Partial:** a standalone sythnvtby player (PC, later VR) and its play-pack format — proposed. Phase 0, 3D in both eyes (stereo twins, the core's side-by-side mono), is done. |
| [memory-states.md](design/memory-states.md) | **Proposed:** questions asked of the game's memory ("who is the player?"), answered from many cheap labelled memory samples collected while playing, checked live in the emulator, saved as named sub-states that groups' paint can depend on (is / is not); plus project storage awareness and control. |
| [reference-images.md](design/reference-images.md) | **Proposed:** export a frame, colorize it in any external tool, bring it back as a per-state reference — overlay it on the frame and fill tile patterns from it in the Project tool and SpriteStudio. |
| [painter-v2-spec.md](design/painter-v2-spec.md) | The Project tool's product spec (written when it was called Painter v2). |
| [colorize-workflow-vision.md](design/colorize-workflow-vision.md) | The Colorize! → edit → Save and Play loop. |
| [group-override-design.md](design/group-override-design.md) | Groups and group-scoped colors. |
| [tile-groups-requirements.md](design/tile-groups-requirements.md) | Why groups exist and what they must do. |
| [conditional-overrides-design.md](design/conditional-overrides-design.md) | Colors that apply only on some screens (RAM conditions). |
| [color-pack-overrides-design.md](design/color-pack-overrides-design.md) | Position-based overrides for a reused tile. |

### planning/ — what is next

| Doc | What it covers |
|-----|----------------|
| [priorities-and-next.md](planning/priorities-and-next.md) | **The backlog.** What to build next and why, including pose suggestions. |
| [tool-performance.md](planning/tool-performance.md) | Why the Project tool and SpriteStudio slow down on a big project (measured on Mario's Tennis, 264 frames) and the plan: stop redoing work, load frames when needed, a project folder while working, archive by evidence. |
| [refactor-plan.md](planning/refactor-plan.md) | Whole-codebase analysis (Oct 9 2026) and a refactor plan to compare with the backlog: CI and fixtures, finish splitting the tool files, one project session for all three apps, a staged compositor, retiring old formats. Proposed. |
| [graphics-next-investigations.md](planning/graphics-next-investigations.md) | Rendering problems still to investigate (fades, animated BG, affine). |
| [ship-readiness-cleanup.md](planning/ship-readiness-cleanup.md) | Checklist for before a public release. |
| [use-case-review.md](planning/use-case-review.md) | A blunt review of the core workflows from a basic user's point of view: a scorecard, what hurts, how to improve it, and a two-week plan. |
| [debug-cleanup-backlog.md](planning/debug-cleanup-backlog.md) | Task list for hiding or removing debug information a basic user doesn't need, page by page, with file:line references, starting with one Developer-mode switch. |

### history/ — how we got here

[development-journey.md](history/development-journey.md) is the story of the plans,
bugs and pivots so far — the best answer to *why* something looks the way it does.

[history/archive/](history/archive/) holds documents that are no longer true but are
kept for their reasoning. They may describe code that no longer exists:

- **Paint v1** (the first authoring page, removed Sep 2026): every `paint-tool-*` file,
  [paint-on-game-editor-design.md](history/archive/paint-on-game-editor-design.md),
  [paint-editor-use-cases.md](history/archive/paint-editor-use-cases.md),
  [override-panel-design.md](history/archive/override-panel-design.md). The memory-pool
  design that Painter v2 built on started here:
  [paint-tool-game-state-pools-ux-plan.md](history/archive/paint-tool-game-state-pools-ux-plan.md).
- **Superseded plans and snapshots:** [art-pipeline-plan.md](history/archive/art-pipeline-plan.md),
  [phase2-and-next-detailed-plan.md](history/archive/phase2-and-next-detailed-plan.md),
  [current-state-and-next-steps.md](history/archive/current-state-and-next-steps.md),
  [colorize-workflow-execution-plan.md](history/archive/colorize-workflow-execution-plan.md),
  [phase1-readiness-risks-debugging.md](history/archive/phase1-readiness-risks-debugging.md),
  [title-screen-background-plan.md](history/archive/title-screen-background-plan.md),
  [painter-v2-design-brief-for-stitch.md](history/archive/painter-v2-design-brief-for-stitch.md).
- **Resolved investigations:** [palette-mode-bug-investigation.md](history/archive/palette-mode-bug-investigation.md)
  (the `preserveDrawingBuffer` fix), [sprite-alignment-investigation.md](history/archive/sprite-alignment-investigation.md),
  [strip-clip-testing.md](history/archive/strip-clip-testing.md) (strip clip causes banding — leave it off).
- **Old tooling notes:** [cursor-web-testing.md](history/archive/cursor-web-testing.md), superseded by `tests/e2e/`.

## Keeping the docs accurate

Documentation drifts when code changes and nobody looks back. Three things keep that
visible instead of silent:

1. **Every doc outside `history/` has a header** like:

   ```yaml
   ---
   status: current
   last-reviewed: 2026-09-18
   covers: src/art-pack.js, src/vbcolor-pack.js
   ---
   ```

   `covers` names the code the doc describes; `last-reviewed` is the last time
   someone checked the doc against that code.
2. **`npm run docs:check`** (`scripts/check-docs.mjs`) fails on broken links, on
   mentions of files that no longer exist, and on current docs this page cannot reach.
   It also lists **docs that need review**: any whose covered code has changed since
   its review date, any never reviewed, and any planning doc untouched for 60 days.
3. **A review is a routine, not an event.** Run `docs:check` when you finish a feature
   and at least monthly. For each doc it lists, read it against the code, fix what is
   wrong, and set `last-reviewed` to today. When a doc stops being true and is not
   worth fixing, move it to `history/archive/` and drop its row from this page.

When you add a doc, give it a header, put it in the right folder, and add a row here.
