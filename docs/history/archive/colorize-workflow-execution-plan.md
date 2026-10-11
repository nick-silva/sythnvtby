# Colorize! workflow — execution plan

**Status: Archived.** Phases A–D are largely done. See [colorize-workflow-vision.md](../../design/colorize-workflow-vision.md) for current vision. Kept for reference. See [README.md](../../README.md).

---

Phased plan to implement the vision in **docs/design/colorize-workflow-vision.md**: Colorize! (emulator) → Painter (edit art + overrides) → Save and Play (updated vbpack, back to same frame, paused).

---

## Phase A: Fixes and painter foundation

| # | Task | Notes |
|---|------|--------|
| A1 | **Fix Export .vbpack** | Store ROM buffer when loading (don’t rely on blob URL fetch). **Done:** `currentRomBuffer` in main.js, Export uses it. |
| A2 | **Override art editing in painter** | “Apply to: Everywhere (pack) \| This position only (override)”; commit to override list; scene uses overrides when rendering; “Overrides: N” in status. See paint-tool-overrides-flow.md. |
| A3 | **Override highlighting in painter** | Toggle “Highlight override tiles” — outline or tint on scene for cells that have an override. |
| A4 | **Painter: Load pack** | In paint tool, file input “Load pack” (.vbpack) → parse, load vbcolor + overrides (and optional VIP state) into painter. No ROM needed for painting. |
| A5 | **Painter: Export pack** | “Export .vbpack” in painter: vbcolor + overrides + manifest (+ optional VIP/save state if present). If the painter has ROM loaded, the export also includes `rom` and `manifest.romFileName` (and may include `art_exports/*.png` scene exports). “Save and Play” (below) returns a full vbpack (including ROM + save state) via handoff. |

**Outcome:** Painter can load/export vbpack and edit both pack and position overrides with clear feedback. Export .vbpack from main app works reliably.

---

## Phase B: VIP state and save state in pack

| # | Task | Notes |
|---|------|--------|
| B1 | **Art-pack format: VIP state** | Add optional entry `vipstate.json` (or `vipstate-current.json`). manifest.currentVipStateRef. Read in art-pack.js; write when exporting. |
| B2 | **Art-pack format: save state** | Add optional entry for core save state (e.g. `save-state.state`). manifest.currentSaveStateRef. **Done:** entry `save-state.state`, parse/build in art-pack; main app and painter include when exporting. Save state is **captured at Export .vbpack** (no separate button). |
| B3 | **Main app: include VIP/save state in Export** | When exporting .vbpack, if we have last VIP state (and later save state), add to zip and set manifest refs. **Done:** main app calls `EJS_emulator.gameManager.getState()` when building the pack; if unavailable, pack is exported without save state. |
| B4 | **Painter: load VIP state from pack** | When loading .vbpack in painter, if vipstate.json present, use it as the frame to display/edit (instead of requiring separate “Load vbstate” file). |
| B5 | **Painter: optional export of VIP state** | When exporting from painter, can include current VIP state in the pack (so emulator or next open has “current frame” ref). |

**Outcome:** vbpack can carry VIP state (and later save state). Painter can open a pack and get the frame from it; painter can export pack with VIP state.

---

## Phase C: Colorize! and handoff to painter

| # | Task | Notes |
|---|------|--------|
| C1 | **Emulator: “Colorize!” button** | **Done:** Button pauses emulation (best-effort) and starts the handoff. |
| C2 | **Capture save state** | **Done:** main app calls `EJS_emulator.gameManager.getState()` at Colorize time (best-effort). |
| C3 | **Capture VIP state** | **Done:** current VIP state is included in the handoff pack. |
| C4 | **Navigate to painter with context** | **Done:** build a vbpack and store it in IndexedDB, then navigate to `tools/paint.html?from=emulator`. |
| C5 | **Painter: “from=emulator” entry** | **Done:** painter auto-loads the vbpack from IndexedDB on startup. |

**Outcome:** One click “Colorize!” takes user to painter with current frame (VIP state), current art (vbcolor + overrides), and save state for later restore.

---

## Phase D: Save and Play and return to emulator

| # | Task | Notes |
|---|------|--------|
| D1 | **Painter: “Save and Play” button** | **Done:** painter builds updated vbpack including ROM + save state (if present) and returns to the emulator. |
| D2 | **Pass updated vbpack back** | **Done:** IndexedDB handoff + same-window navigation back to `/?from=painter`. |
| D3 | **Emulator: load updated pack on return** | **Done:** main app reads handoff vbpack, applies ROM + vbcolor + overrides. |
| D4 | **Emulator: restore save state** | **Done:** main app calls `gameManager.loadState(...)` after emulator initializes. |
| D5 | **Emulator: paused until input** | **Done (best-effort):** pause before/after restore; can refine UX with an explicit Resume button later. |

**Outcome:** “Save and Play” updates the pack and returns user to the same frame in the emulator with new art applied, paused until they continue.

---

## Phase E: Polish and backlog

| # | Task | Notes |
|---|------|--------|
| E1 | **Cleanup: old save states** | UI or script to remove old save state entries from vbpack; manifest points only to “current”. |
| E2 | **Cleanup: old VIP states** | UI to remove old VIP state snapshots from pack to keep size down. |
| E3 | **ROM in painter for Save and Play** | **Done for Colorize!/Save-and-Play flow:** painter receives ROM via vbpack handoff and includes it when returning. Backlog: optional “Load ROM” UI for standalone painter sessions. |
| E4 | **Fade in/out for color layer** | Screen transitions use fade effects in the monochrome render; colorized sprites do not follow that fade. Backlog: make the color layer respect the same fade in/out so colorization matches transition behavior. |
| E5 | **Disable monochrome in color mode** | Monochrome and color render are not perfectly aligned (close but not pixel-perfect). Backlog: option to disable drawing the monochrome layer when in color mode so only the color layer is shown (avoids double-draw and alignment visibility). |
| E6 | **Color mode by default when vbpack has vbcolor** | **Done:** When loading a vbpack that contains a color pack, the main app switches to **Color** mode so the user sees the colorized view immediately. |

---

## Dependency order (summary)

1. **A (done/first):** Export fix, override art in painter, override highlighting, painter load/export vbpack.
2. **B:** VIP/save state in pack format and in painter/main app load/export.
3. **C:** Colorize! button, capture state, navigate to painter with context.
4. **D:** Save and Play, pass pack back, emulator restore and paused state.
5. **E:** Cleanup and ROM handling for fully self-contained pack.

Override art editing (A2, A3) is required for the full vision; Phase B–D can be done in parallel or after A.
