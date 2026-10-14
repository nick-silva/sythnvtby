---
status: proposed
last-reviewed: 2026-10-13
covers: src/main.js, src/color-layer.js, src/uncoloured.js, src/screen-gate.js, tools/painter.js, tools/painter/, tools/sprite-studio.js, tools/sprite-studio/, tools/shared/pack-session.js, native/core/src/colorizer.cpp, tests/e2e/harness.mjs
---

# Refactor plan: easier to maintain and understand

An analysis of the whole codebase (Oct 9 2026, branch `affine-mario-tennis`) and a plan to compare
with the backlog ([priorities-and-next.md](priorities-and-next.md), *Code health*). Nothing here is
scheduled yet. Sizes: S (a day or less), M (a few days), L (a week or more).

## In short

The core is in good shape: `src/` is 88 small, mostly pure modules, 83 of them with tests next to
them, and the docs are kept honest by `docs:check`. What makes the project hard to work on is
around it:

1. **Three apps each load a pack and drive the compositor their own way** — the emulator, the
   Project tool and SpriteStudio — plus the C++ copy of every colour rule. A new rule (a screen
   limit, a game-state condition, pose pictures) has to be wired into each of them.
2. **The compositor is one 568-line function** (until Oct 10 with 22 positional arguments; now an options object), called from five
   places that each assemble those arguments by hand.
3. **The Project tool is one 10,400-line file** with 107 module-level variables and a 777-line
   `wireEvents`. SpriteStudio was the same until today's split (5,740 → 3,064 lines so far).
4. **Old formats are still read everywhere** (touch-ups, layer art, VIP overlays), so every
   feature has to consider them.
5. **No CI.** Lint, unit tests, build and the docs check run only when someone remembers; the
   browser suite needs a local ROM and real packs, takes ~15 minutes, and has a flaky test.

The plan, most useful first: **CI and test fixtures** → **finish splitting the tool files** → **one
project session for all three apps** → **a staged compositor** → **retire old formats** → **names
and folders**. The first two are already on the backlog (#12, #13); the session, the staged
compositor and CI are new.

## What was measured

| | |
|---|---|
| JavaScript | 41,200 lines in 116 files (`src/` 19,600 in 88 modules; `tools/` 21,600); tests 10,100 lines; C++ 3,000 |
| Biggest files | `tools/painter.js` 10,434 · `src/main.js` 3,395 · `tools/sprite-studio.js` 3,064 (was 5,740) · `src/color-layer.js` 1,629 · `tools/shared/pack-session.js` 1,258 |
| Functions | 2,220; **109 over 50 lines**, 10 over 150 |
| Longest | `wireEvents` (painter.js) 777 · `compositeColorFrame` 568 · `createHealthScan` 301 · `loadVbpackBuffer` 235 · `wireColorLayer` 189 · `createMemoryPanel` 180 |
| Module-level `let` | painter.js 107 · main.js 75 · sprite-studio.js 42 · color-layer.js 12 |
| Most imported | `vip-state.js` (33 files) · `layer-art.js` 16 · `vip-world-clip.js` 14 · `game-states.js` 12 · `color-layer.js` 11 |
| Imports most | painter.js 65 modules · sprite-studio.js 36 · main.js 30 · pack-session.js 30 |
| `src/` without a test file | 17, among them `color-layer.js` (tested through other files), `main.js`, `player.js`, `vip-dump.js`, `vbcolor-pack.js`, `vbpack-storage.js` |
| Lint (new today) | 18 leftovers on the first run, all fixed |
| "Painter v2" in code | 305 mentions (`painterV2Rules`, `painter-v2-vip-overlay.js`, …) for what is now the Project tool |
| CI | none |

## What is healthy (keep it)

- **Plain ES modules, no framework** — cheap to read and to load; the project rule stands.
- **Pure logic in `src/` with a test beside it** — formats, colour rules, groups, game states,
  memory. New work lands here first; keep doing that.
- **Immutable updates of groups and packs** — the tools replace objects instead of editing them,
  which the undo stacks and the journal depend on.
- **Docs with a header and a check** — status, review date and the code each doc covers.
- **Today's groundwork:** one group schema (`src/group-schema.js`), one picture store
  (`src/picture-store.js`), ESLint, and a codemod that splits a tool file safely (it moves a
  section, passes the tool's shared state in through one `ctx` object, and the linter proves
  nothing was missed).

## Findings

### 1. Three pack loaders, three ways to drive the compositor

| App | Loads a pack | Renders a frame |
|---|---|---|
| Emulator | `applyVbpackResult` (`src/main.js`) | `wireColorLayer` → `compositeColorFrame` (`src/color-layer.js`) |
| Project tool | `loadVbpackBuffer`, 235 lines (`tools/painter.js`) | two hand-built calls to `compositeColorFrameForEye` (painter.js) |
| SpriteStudio | `loadPackSession` (`tools/shared/pack-session.js`) | `renderFrame` → `compositeColorFrameForEye` |
| Coverage, gaps | — | `src/uncoloured.js` builds the 22 arguments positionally |
| Native player | `play_pack.cpp` | `colorizer.cpp` |

Each call site applies `groupsForScreen`, picks the frame's WRAM and brightness and passes the
pose pictures itself, so a rule added to one path can be missing from another. A report like this
week's MarioOpp one (coloured in the Project tool, plain in the emulator) is the kind of
difference this allows; its cause is not confirmed yet. Each app also holds the project
differently: the Project tool in loose module variables (`groups`, `gameStatePools`,
`loadedPackParts`, …), SpriteStudio in a `session` object, the emulator in its own variables in
`main.js`.

**Done Oct 10 (C1).** `src/project.js`: every app opens a pack with `projectFromParsed` and draws
with `colourOptions(project, view, frame)` / `renderProjectFrame`. Behaviour that changed on purpose,
so the apps agree: the emulator and the player now put groups through the group schema (as the
tools did); the tools pass the frame's memory to the compositor, so RAM-gated position overrides
show in the tools when their condition holds (they were always left out there, while the emulator
drew them); the Project tool keeps an override's `alternateHash` instead of dropping it. Each app
still keeps its own UI state (the per-tool store is D2).

**Fix — one project session in `src/`** (L): `openProject(buffer)` returns one object with the
manifest, frames (lazy, as now), groups, pools, game states, pictures and the paint; and
`renderProjectFrame(session, frameIndex, { eye, brightness, … })` is the only way to draw a frame
with colour. The three apps keep their own UI state but read the project through it.
`pack-session.js` is most of the way there and becomes this module. Native parity then has one JS
entry point to compare against.

### 2. The compositor is one function

`compositeColorFrame` is 568 lines and took 22 positional arguments until Oct 10 (`state, packEntries,
imageData, eye, overrides, groups, brightness, false, 0, false, 0, false, …`). It resolves which
group owns each draw, applies tile paint, pose pictures and overpaint, fades, and handles stereo
twins and affine stand-ins, all inline. Its C++ twin is organised differently, so parity bugs are
hard to trace.

**Fix — a staged compositor** (M): an options object first (backlog #13), then stages with their
own tests: *who owns this draw* → *tile paint* → *pictures* → *brightness*. Mirror the same stages
in `colorizer.cpp` so a parity difference points at one stage.

### 3. Tool files too big to hold in your head

`painter.js` has 363 functions in one scope, with six section markers in 10,400 lines. Its
`wireEvents` binds every button in one 777-line function, so finding what a button does means
searching. SpriteStudio is now seven files (overpaint, group list, tracks, recovery, reference,
cards and the rest); render, painting, Pick, the ghost box and undo history can follow.

**Fix — finish backlog #12 with the codemod** (L, mostly mechanical): SpriteStudio first (half
done), then the Project tool by panel: groups panel, frame list and frame menu, screens and game
states, paint inventory, file menu and save, zoom painting, the inspector. Split `wireEvents` so
each panel binds its own controls.

### 4. Shared mutable state with no owner

After splitting, the `ctx` object makes the shared state visible: SpriteStudio's overpaint part
reads 32 of the tool's names, its render part would read 54. Writes happen from anywhere, and a
redraw is whatever the caller remembers to call: SpriteStudio's files call `drawStage()` 52 times
and `invalidateRender()` 30 times.

**Fix — a small store per tool** (M, after #3): one object holding the tool's state with
`update(change)` and a single "something changed → redraw what depends on it" step. No framework;
a plain object and a list of listeners. This is what makes the bug "I changed X and the panel
didn't update" go away.

### 5. Old formats read everywhere

Touch-ups, layer art, screen-pinned VIP overlays (`painter-v2-vip-overlay.js`, 315 lines) and
one-group-per-pose pictures are converted when SpriteStudio opens a pack, but 14 modules still
read them, including the compositor and the native player.

**Fix — upgrade on open everywhere, then delete** (M; backlog #18): run SpriteStudio's upgrade in
the Project tool and the emulator too, bump `groupsSchemaVersion`, and after a release drop the
old paths. Fewer cases in every feature from then on.

### 6. Names that no longer match

The Project tool is `tools/painter.js`, its data is `painterV2Rules`, its overlay module is
`painter-v2-vip-overlay.js`; the app is now *sythnvtby* but ids say `vb-colorize`.
CLAUDE.md has to explain the mapping.

**Fix — rename while splitting** (S–M): `tools/project/…` for the Project tool's modules (keep the
URL redirect), `project-rules` for `painterV2Rules` in code (the file format keeps its key).

### 7. `src/` is flat

88 modules in one folder; related ones are found by name only.

**Fix — folders by domain** (S, mechanical): `format/` (art-pack, zip, lazy entries, schema),
`render/` (color-layer, affine, overpaint, layer-art, palette), `groups/` (group-*, screen-gate,
game-states, poses), `memory/`, `emulator/`, `player/`. Tests move with their module.

### 8. Tests and CI

Unit tests are good and fast (804 in ~5 s). Gaps:

- **No CI** — nothing stops a commit that fails lint, tests, build or the docs check.
- **The browser suite needs private files** (a ROM and real packs), so only this machine can run
  it, ~15 minutes for all of it. Waits are fixed timeouts; `selectGroup` failed once today because
  the row re-rendered under it, and passed on a re-run.
- **Parity is manual** (backlog #13).

**Fix** (S–M): a GitHub Actions workflow for lint + unit + build + docs check; a small synthetic
pack (frames, groups, pictures, no ROM) checked in for parity and for the e2e tests that don't need
the emulator; harness helpers that wait for a condition instead of a fixed time.

### 9. Per-frame work done several times

Frame caches each have their own key and limit (decoded states, affine pixel maps, draws with
stand-ins, frame summaries, pattern hashes), and several modules hash every draw's tile again
(backlog #18, item 7). Today's Base tiles slowdown was one of these caches being too small for a
loop that walked every frame.

**Fix — one frame index** (M): per decoded frame, built once: the pattern of every draw, stand-ins,
summary, affine maps. Every reader uses it; one memory budget for all of it.

## Plan

| Step | What | Size | Backlog | Risk |
|---|---|---|---|---|
| **A1** | ~~CI: lint, unit, build, docs check on every push~~ — **done Oct 9** (`.github/workflows/ci.yml`, GitHub Actions) | S | new | none |
| **A2** | ~~Synthetic test pack; harness waits for conditions; parity on the fixture~~ — **done Oct 10**: `tests/fixtures/fixture-pack.mjs`, its unit test, `src/native-parity.test.js` (where the native build exists), browser suite `s0` in CI, `waitUntil` in the harness | M | #13 (parity) | low |
| **A3** | ~~`compositeColorFrame` options object~~ — **done Oct 10** | S | #13 | low (tests cover it) |
| **B1** | ~~Finish SpriteStudio split~~ — **done Oct 9**: 12 files in `tools/sprite-studio/`, entry point 5,740 → 1,772 lines | M | #12 | low (codemod + lint + e2e) |
| **B2** | ~~Split the Project tool by panel; break up `wireEvents`~~ — **done Oct 9**: 23 new parts in `tools/painter/`, entry point 10,434 → 2,457 lines. Still to do: rename to `tools/project/` | L | #12, new (names) | medium: biggest file, most e2e |
| **C1** | ~~One project session for all three apps, one `renderProjectFrame`~~ — **done Oct 10**: `src/project.js` (`projectFromParsed`, `colourOptions` + views, `renderProjectFrame`); the emulator, the player, both tools, the uncoloured measure and the parity golden all use it | L | new | medium: touches every render path; parity and e2e guard it |
| **C2** | Staged compositor, mirrored in C++ | M | new | medium |
| **C3** | One frame index | M | #18 (item 7) | low |
| **D1** | Upgrade old formats on open everywhere; drop old paths a release later | M | #18 | low once C1 exists |
| **D2** | A store per tool (state + redraw) | M | new | medium |
| **D3** | `src/` folders by domain | S | new | none (mechanical) |

**Order:** A (a few days) pays back on every later step. B is mechanical and makes C reviewable. C1
is the change that removes a whole class of bug; C2 and C3 are easier after it. D can be done
whenever, one at a time.

### How it fits the backlog

- **#12 (split the tool files)** = B1 + B2. Both done Oct 9 (the `painter` → `project` rename is left).
- **#13 (linter, options object, parity)** — all done Oct 9–10 (A2, A3).
- **#18 (retire old formats, one pattern cache)** = D1 + C3.
- **#9 (one group details panel in both tools)** gets much easier after C1 + B2: both tools would
  read the same session and could share the panel's module.
- **#14, #15 (mirrored poses, pose suggestions)** — new features that land in SpriteStudio; they
  want B1 done, nothing else from this plan.
- **New here:** CI (A1), one project session (C1), staged compositor (C2), a store per tool (D2),
  names and folders (B2, D3).

### Not recommended

- A framework or TypeScript (the project's rule; JSDoc types and the linter cover most of it).
- A rewrite. Every step above keeps the tools working and is checked by the unit and browser
  tests before the next.

## Questions to decide

1. Do A1–A3 now (about a week)? They make everything after cheaper.
2. Finish B1 (SpriteStudio) before pose features (#14, #15)? Recommended.
3. Is C1 (one session) worth a week of work against features? It is the item that stops
   "coloured in one tool, not the other" for good.
