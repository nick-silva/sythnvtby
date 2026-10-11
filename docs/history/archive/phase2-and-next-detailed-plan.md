# Phase 2 and next: detailed plan

This document gives a **Phase 1 completion checklist**, a **detailed plan for Phase 1C** (paint-on-game editor), **Phase 2** (pack authoring) status and remaining work, and **Phase 3** (runtime validation). Use it to decide what to implement next and what “done” means for each phase.

**See also:** **Colorize! workflow** — [colorize-workflow-vision.md](../../design/colorize-workflow-vision.md) (Colorize! → Painter → Save and Play) and [colorize-workflow-execution-plan.md](colorize-workflow-execution-plan.md) (phased implementation, including override art and vbpack with VIP/save state).

---

## Phase 1: Completion checklist

| Sub-phase | Goal | Status | Notes |
|-----------|------|--------|--------|
| **1A** | Extract tiles from vbstate → tile-manifest.json; merge across dumps | **Done** | Single-file load and export work. Multi-file merge can be added when needed. |
| **1B** | Frame/sprite viewer: load vbstate, render in draw order, 4 colors + presets, captured GPLT, layer/eye, alignment tools | **Done** | Viewer has load vbstate, draw-order render, palette (preset + captured GPLT, Shaded/Exact), Transparent 0, eye/layer toggles, crop/clear/offset/scale, click-to-inspect, export PNG. |
| **1C** | Paint-on-game editor (separate page): vbstate ± pack, render, select, layer filter, zoom, grouping, paint→pack, export, settings | **Largely done** | tools/paint.html: load vbstate/vbpack, render, select, layer filter (BG/Affine/Sprites), paint→pack, overrides, export, Save and Play, Colorize! handoff. Remaining from original 1C: zoom (1x/2x/4x) for frame canvas, sprite grouping (stretch), full settings menu. Next focus: graphics (fading, BG artifacting, affines); see [graphics-next-investigations.md](../../planning/graphics-next-investigations.md). |

### Phase 1: Did we forget anything?

- **1A:** Multi-file merge (load N vbstate → one merged manifest) is optional and can be added when needed. No blocker.
- **1B:** All planned viewer features are in place (including per-draw palette from GPLT, shaded/exact, alignment/debug toggles). Remaining sprite rendering quirks can be tracked later; see [ship-readiness-cleanup.md](../../planning/ship-readiness-cleanup.md) for what to tidy at ship time.
- **1C:** This is the only remaining Phase 1 deliverable. It is a separate page (e.g. `/tools/paint.html`) with the full feature set in the table below.
- **Core/app:** Patched core pushes VIP state (pattern table, drawList, GPLT, etc.); app serializes/deserializes vbstate with `paletteSelector`, `gplt`, `masterColors`. No known Phase 1 gaps there.
- **Docs:** Art pipeline, plan, development journey, and alignment/sprite docs are updated. Phase 1 readiness and risks are in [phase1-readiness-risks-debugging.md](phase1-readiness-risks-debugging.md).

**Verdict:** Phase 1 is complete except for **1C (paint-on-game editor)**. Nothing critical was forgotten for 1A/1B.

---

## Phase 1C: Paint-on-game editor — detailed plan

**Hosting:** Separate page (e.g. `/tools/paint.html`) on the same origin. User loads vbstate (and optionally an existing pack) via file input or drag-drop; no emulator required for the primary workflow.

**Two inputs:**

1. **vbstate.json** — Required. Frozen frame (pattern table, drawList, etc.) to know what is on screen and to map brush strokes to tile hashes.
2. **.vbcolor (existing pack)** — Optional. When present, load it and overlay pack colors; painting updates or appends entries. When absent, start with an empty pack; export creates the file.

### Requirements (from art-pipeline-plan §1C)

| # | Requirement | Priority | Notes |
|---|-------------|----------|--------|
| 1 | **Load vbstate from file** | Must | File input and/or drag-drop. Empty state: blank canvas + subtle "No frame loaded" (or similar). Empty drawList: same. |
| 2 | **Load existing pack (optional)** | Must | Load .vbcolor so user can continue editing. When loaded, frame draws with pack colors where available; export writes full pack. When no pack, start empty; export creates .vbcolor. |
| 3 | **Render frame** | Must | Same as 1B: drawList order, 4-color palette + presets. When pack loaded, overlay pack colors where we have entries. |
| 4 | **4 display colors + presets** | Must | Same as 1B; align with main app's Palette presets. |
| 5 | **Select tool** | Must | Click → hit-test draw list (back-to-front). Identify draw index, tile index, content hash. Show feedback: highlight or outline selected draw. |
| 6 | **Layer filter** | Must | Toggle which layers (e.g. draw-order bands) are visible. Hide background or foreground to isolate sprites. |
| 7 | **Zoom** | Must | Zoom in/out (e.g. 1x, 2x, 4x). Mouse wheel or buttons; optionally zoom to fit / zoom to selection. |
| 8 | **Sprite grouping** | Stretch | Group a set of draws (e.g. by selection or region), name (e.g. "Mario"), store as metadata; isolate character for coloring or export. |
| 9 | **Painting and export** | Must | Brush strokes → (x,y) → draw list (back-to-front) → tile index → pattern table → content hash → update/append pack entry (256-byte RGBA). Export .vbcolor as user works (re-export allowed); file = full pack. |
| 10 | **Settings + system menu** | Must | Settings (e.g. last palette preset, default zoom) persisted (e.g. localStorage key `vb-paint-editor-settings`). System menu: Settings, Load vbstate, Load pack, Export pack, etc. |

### Scale and HD (reference)

- **Editor zoom only:** 1 VB pixel = 2×2 or 4×4 screen pixels for easier painting. Stored pack stays 8×8 RGBA. Scale = editor setting only (e.g. in settings / system menu).
- **HD pack format (future):** If tiles are stored at 16×16 or 32×32, scale (1:1, 1:2, 1:4) must live in the **.vbcolor header** (e.g. `tilePixelSize` or `pixelsPerVBPixel`), not in a separate config file. Current format is 8×8 only; extend when adding HD.

### Suggested implementation order (1C)

1. **Scaffold** — New page `tools/paint.html`; load vbstate (reuse viewer load/deserialize); render frame (reuse or share viewer render path with 4 colors + presets).
2. **Pack load/export** — Load .vbcolor (optional); in-memory pack; export .vbcolor (full pack). Draw frame with pack overlay where entries exist.
3. **Select** — Hit-test draw list back-to-front; highlight selected draw; show draw index / tile hash in UI.
4. **Layer filter** — Define layers as draw-index bands (or by future layer id); checkboxes to show/hide layers.
5. **Zoom** — Zoom controls and canvas scaling; optional zoom-to-fit / zoom-to-selection.
6. **Paint** — Brush: (x,y) → draw list → tile hash → update/append pack entry; re-render; export button (and optional auto-export or “Export” on demand).
7. **Settings and menu** — localStorage schema; system menu (Load vbstate, Load pack, Export, Settings).
8. **Grouping (stretch)** — Multi-select or region select; name group; store as metadata; use for isolation or batch operations.

### Exit criteria (1C)

- Open paint page → blank canvas + “No frame loaded” (or similar).
- Load vbstate → frame renders in draw order with palette; load optional .vbcolor → pack colors overlay.
- Select draw by click; layer filter hides/shows bands; zoom works.
- Paint on canvas → pack updates; export .vbcolor → file loads in app and shows in Color mode at correct positions.
- Settings (e.g. palette preset, zoom) persist across sessions.

---

## Phase 2: Pack authoring — current state and remaining work

**Goal:** Author a color pack from a tile manifest and export a `.vbcolor` file the app can load.

**Inputs:** tile-manifest.json (from Phase 1).

**Outputs:** .vbcolor file (header + entries: 4-byte hash + 256-byte RGBA per tile; game ID in header).

### Current state

- **Pack editor exists** (`tools/editor.html`, `tools/editor.js`): loads manifest, shows tile grid with monochrome preview, select tile, assign color, apply, game ID, export .vbcolor. It is **not** ship-ready; requirements and improvements are **backlogged** in [pack-editor-backlog.md](pack-editor-backlog.md). We are prioritizing the **paint-on-game editor (Phase 1C)** first.
- **Format:** `vbcolor-pack.js` builds/parses .vbcolor; `parseVBColorPack()` in app loads it. Validator (`pack-validator.js`) can check pack and optional coverage vs dump.

### Remaining work (Phase 2)

| Item | Status | Notes |
|------|--------|--------|
| Load manifest | Done | |
| Monochrome (red) preview | Done | |
| Select tile, assign color, apply | Done | |
| Game ID, export .vbcolor | Done | |
| Batch color / "apply to all" | Optional | Nice-to-have. |
| Validator integration | Optional | Ensure `validatePack(buffer)` and coverage vs vbstate are usable from UI or CLI. |
| Alignment with paint-on-game | When 1C exists | Paint editor exports same .vbcolor format; user can start from manifest (editor) or from vbstate + paint (1C). |

**Exit criteria (Phase 2):** Load manifest → assign colors to a subset of tiles → set game ID → export .vbcolor. `validatePack(buffer)` reports valid; app loads pack and Color mode shows tiles. **Already met** by current editor; refinements are incremental.

---

## Phase 3: Runtime validation

**Goal:** Confirm the app’s color layer draws pack tiles in the right places and order when the patched core pushes VIP state every frame.

### Prerequisites

- Patched core pushing full VIP state each frame (pattern table, OAM, segments, windows, drawList).
- At least one vbstate.json captured with Seg=16 and non-empty drawList.

### Steps

1. **Build a hand-made pack** — Use Phase 1 (vbstate → viewer) + Phase 2 (manifest → editor) or Phase 1C (paint-on-game): one vbstate, color a few tiles, export .vbcolor.
2. **Run in app** — Load ROM, load .vbcolor, set display to **Color**.
3. **Observe** — Same scene (or same frame): colorized tiles at correct (x, y) and draw order; where pack has no entry, monochrome shows through (no black holes).

### Requirements (app runtime)

- **VIP state consumer:** Core calls `__VB_PUSH_VIP_STATE__(state)` → app keeps one `lastVIPState`; pass to color layer (and other consumers).
- **Color layer:** For each draw in `state.drawList`: get 16-byte tile from `state.patternTable` at `tileIndex`, hash, lookup in pack; if found, draw 256-byte RGBA at (x, y) with flipH/flipV. Composite over monochrome; transparent where no pack entry.
- **Save VIP state:** Button serializes `lastVIPState` → vbstate.json; enabled when at least one state received.

### Exit criteria (Phase 3)

- Hand-made pack shows colored tiles in correct positions and order.
- Missing pack entries show mono underneath (transparent color layer).
- No crashes or obvious memory growth over many frames.

---

## Summary: what to do next

| Priority | What | Doc reference |
|----------|------|----------------|
| 1 | **Graphics investigations** — Fading/opacity/brightness, animated BG artifacting, affine layer. | [graphics-next-investigations.md](../../planning/graphics-next-investigations.md). |
| 2 | **Phase 1C polish (optional)** — Zoom for frame canvas, sprite grouping (stretch), settings menu. | This doc, § Phase 1C. |
| 3 | **Phase 2 polish** — Optional batch color, validator UI/CLI; keep pack editor in sync with paint export format. | This doc, § Phase 2. |
| 4 | **Phase 3** — Run through hand-made pack in app (Color mode, positions, order); document any bugs. | This doc, § Phase 3. |
| 5 | **Ship-readiness** — When preparing to ship, follow [ship-readiness-cleanup.md](../../planning/ship-readiness-cleanup.md). | Do not remove debug options now. |

Phase 1C **paint-on-game editor is in place** (Colorize! → painter → Save and Play, overrides, layer filter, multi-frame). Next focus is **graphics** (fading, BG, affines); then optional 1C polish (zoom, grouping) and Phase 2/ship when needed.
