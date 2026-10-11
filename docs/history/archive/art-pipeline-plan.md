# Art pipeline: phases and tool requirements

This document defines **phases** for the art pipeline and **concrete requirements** for each tool. It also clarifies **per-frame VIP state and RAM**.

---

## Per-frame VIP state: RAM and the 1MB vbstate.json

**We do not persist 1MB every frame.** The 1MB is the size of the **saved file** when you click "Save VIP state," not the in-memory cost each frame.

### What happens every frame

- The patched core calls `__VB_PUSH_VIP_STATE__(state)` once per frame.
- The core builds `state` from VIP memory and passes it to JS. In the core we use `heap.slice(...)`, so JS receives **new Uint8Array copies** each time:
  - **patternTable:** 32 KB  
  - **oam:** 8 KB  
  - **windows:** 1 KB  
  - **segments:** 16 × 8 KB = 128 KB  
  - **drawList:** array of `{ tileIndex, x, y, flipH, flipV }` (typically hundreds to low thousands of entries)

- The app keeps **one** state: `lastVIPState = state`. The previous frame's state is no longer referenced and can be garbage-collected.
- **In-memory per frame:** one state object with ~**170 KB** of binary buffers plus the drawList array (on the order of tens to a few hundred KB depending on draw count). Total is well under 1 MB and does not grow over time.

### Why vbstate.json is ~1MB

When you click "Save VIP state," we serialize that single state to JSON:

- Base64 encoding expands binary data by ~4/3 (e.g. 170 KB → ~227 KB).
- The draw list is stored as JSON objects (e.g. `{"tileIndex":2047,"x":14,"y":0,"flipH":false,"flipV":false}` per draw). Thousands of draws plus base64 blobs produce a ~1 MB file.

So: **RAM usage is one live state (~200–500 KB typical). The 1MB file is only created on demand when saving.** No change needed for per-frame behavior; it easily fits in RAM. Optional future optimization: the core could pass HEAP views instead of copies and the app could copy only when saving or entering painting mode, to reduce per-frame allocations.

---

## Pipeline phases

High level: **Phase 1 = extraction + manifest + viewer + paint-on-game**, **Phase 2 = pack authoring**, **Phase 3 = runtime validation**, **Phase 4 = painting mode (future)**.

---

### Phase 1: Extraction — vbstate → manifest + sprite viewer

**Goal:** From one or more `vbstate.json` files, (1) produce a **tile manifest** (unique tiles by content hash), and (2) provide a **viewer** that renders the extracted frame so the user can see tiles/sprites in context — bridging into pack authoring (choose colors, then paint). Phase 1 includes the full **paint-on-game** editor (separate page, palette, select, layers, zoom, grouping) as sub-phases 1B and 1C below.

**Inputs**

- One or more `vbstate.json` files (from "Save VIP state" in the app).
- Each file must contain at least:
  - `patternTableBase64` (or equivalent) so we can decode to a 32 KB pattern table.
  - For the **viewer**: `drawList` (and optionally segments/windows) so we can re-render the frame in draw order.
  - Full supported format: `version`, `patternTableBase64`, `oamBase64`, `segmentCount`, `segmentsBase64`, `windowsBase64`, `drawList`.

**Outputs**

- **tile-manifest.json:** `{ version: 1, tiles: [ { hash, dataBase64 }, ... ] }` where:
  - `hash` is the 32-bit content hash of the 16-byte tile (FNV-1a style, as in `hashTile()`).
  - `dataBase64` is base64 of the 16-byte tile.
  - Each **unique** tile (by content) appears exactly once.
- **Viewer:** A way to render the captured frame (tiles drawn in draw-list order) so the user can see sprites on screen before moving to color authoring.

---

#### Phase 1A: Extract and manifest

1. **Load vbstate:** Accept one or more `.json` files. Parse and support raw vbstate (base64 fields) or already-deserialized (`patternTable` etc.).
2. **Extract tiles:** From each dump's pattern table, scan every 16-byte tile, compute content hash, collect **unique** tiles (same hash → one representative).
3. **Merge:** When multiple dumps are loaded, merge so the manifest is the union of unique tiles by hash.
4. **Export manifest:** Download `tile-manifest.json`; pack editor (and viewer) can load it.

**Exit criteria:** Load N vbstate.json → one manifest; pack editor can load manifest and show tile grid.

---

#### Phase 1B: Frame / sprite viewer (first step of paint-on-game)

Render the captured frame so the user sees how tiles look in screen space (same as the game at capture time). This is the bridge into choosing display colors and eventually painting. The viewer is a **standalone tool**: the user loads a vbstate file themselves (no emulator required).

**How the user gets a frame into the viewer**

- **Load vbstate.json** via file input or drag-and-drop. This is the primary and earliest workflow: open the viewer/editor page, choose "Load vbstate" (or drop a file), and the tool displays that snapshot. The emulator is not required to trigger the viewer; the user may have saved vbstate.json earlier from the emulator and now opens it in the viewer on its own. Optional later: an "Open in editor" button in the emulator that opens the viewer and passes state without a manual save/load step.

**Requirements:**

1. **Load from file:** Support loading a vbstate.json via file input and/or drag-and-drop. No dependency on the emulator; the tool works as soon as the user provides a file.
2. **Empty / no state:** When nothing is loaded (initial load or after clearing), show a **blank canvas** (or empty frame area) and a **subtle message** informing the user that nothing is currently loaded (e.g. "No frame loaded" or "Load a vbstate.json file to view"). Do not throw; do not show a raw error unless the user tried to load an invalid file.
3. **Empty drawList:** If the user loads a valid vbstate that has an empty drawList (or no drawList), show the same: blank frame area and a subtle message (e.g. "This frame has no draw list" or "No tiles to display"). Again, no throw.
4. **Re-render frame from vbstate:** When a valid vbstate with a non-empty drawList is loaded, draw all tiles in **drawList order** at (x, y) with flipH/flipV, using the pattern table. Result: one image that matches the game frame at capture.
5. **Display palette (YY-CHR / NESmaker style):** The VB has 4 levels per tile (transparent + 3 shades). The viewer must let the user choose **4 arbitrary colors** for those levels (e.g. level 0 = transparent, 1 = dark, 2 = mid, 3 = bright). These are the "display colors" used to paint the 2bpp data on screen — not yet the pack RGBA, just how we show the frame in the tool.
6. **Presets:** Provide ~6 presets (same idea as the main app's Palette mode: e.g. original red, green, blue, Game Boy, warm). Preset = a set of 4 colors; user can pick a preset then tweak individual slots if desired.
7. **Shared preset source:** Reuse or mirror the main app's palette presets (`PALETTE_PRESETS` from `palette-layer.js`: original, green, blue, gameboy, warm) so behavior is consistent between "Palette mode" in the emulator and "viewer palette" in the extraction tool.

**Exit criteria:** Open viewer → see blank canvas + "No frame loaded" (or similar). Load vbstate → see the frame rendered in draw order; switch palette (4 colors + presets) and see the same frame in different colors. Load vbstate with empty drawList → blank frame + subtle message. Ready to connect "click on screen" → tile/layer in the next phase.

---

#### Phase 1C: Paint-on-game editor (separate page, full feature set)

The **paint-on-game** tool is where the user paints color onto the frozen frame; strokes map to tile hashes and update the pack. It is defined here as its own sub-phase with clear hosting and feature requirements.

**Hosting: separate page vs same page**

- **Recommendation: separate webpage** on the same origin (e.g. `/tools/paint.html` on the same localhost as the emulator). Reasons:
  - **Simpler UX:** Dedicated URL; no iframe or mode-switching inside the emulator. User can have emulator in one tab, paint tool in another.
  - **Data flow:** The paint tool does not need live VIP state every frame. It needs **one snapshot** (the frozen frame). The **primary and earliest workflow** is: user opens the viewer/editor page and **loads a vbstate.json file** (file picker or drag-drop). No emulator trigger required; the user may have saved the file earlier from the emulator. Optional later: "Open in editor" from the emulator that opens the paint page and passes state without a manual file step.
  - **Technical:** Same origin gives no CORS issues. For v1, "load vbstate.json" on the paint page is sufficient and works offline.

**Two key files (with one exception)**

The paint-on-game editor needs **two inputs** to function fully:

1. **vbstate.json** — The frozen frame (pattern table, draw list, etc.). Needed to know what is on screen and to map brush strokes to tile hashes.
2. **.vbcolor** (existing pack) — The color pack being edited. As the user paints, we **update or append** entries in this pack; when they export, we write the (updated) .vbcolor file. So the editor loads the pack, applies paint changes in memory, and **exports as you work** (user can re-export repeatedly).

**Exception:** When **creating a new pack for the first time**, there is no existing .vbcolor. The user only loads vbstate; the editor starts with an empty pack in memory. As they paint, we add entries; when they export, we create the .vbcolor file. So: **first time = vbstate only → paint → export creates the file.** After that, **normal workflow = vbstate + load existing .vbcolor → paint (append/update) → export** to save changes.

**Requirements (paint-on-game editor)**

1. **Load snapshot from file:** Load a single vbstate.json via file input or drag-and-drop (no emulator required). Deserialize to pattern table, drawList, etc. This is the "frozen frame." Same empty-state behavior as 1B: when nothing is loaded or drawList is empty, show blank canvas and a subtle message (e.g. "No frame loaded").
2. **Load existing pack (optional for first-time create):** Allow loading an existing .vbcolor file so the user can continue editing. When loaded, the frame is drawn with pack colors where available; painting updates or appends entries. Export writes the full pack (existing + new/updated entries). When no pack is loaded, we start with an empty pack and export creates the file.
3. **Render frame:** Same as Phase 1B — draw all tiles in drawList order with 4-color palette + presets (YY-CHR style). When a pack is loaded, overlay pack colors where we have entries (so the user sees their previous work). This is the main canvas the user will paint on.
4. **4 display colors + presets:** Same as 1B: 4 slots (transparent + 3 shades), arbitrary RGB per slot; ~6 presets (aligned with main app's Palette presets).
5. **Select tool (stretch):** Click on the canvas → **hit-test** against the draw list (back-to-front: last draw at (x,y) wins). Identify which **draw list index** (and thus tile index, pattern table tile, content hash) and optionally **draw layer** (e.g. "layer" = world or strip index if we add it). Show feedback: highlight the selected tile(s) or outline the draw that was clicked. This allows "select a sprite to focus on."
6. **Draw layer filter:** Toggle which "layers" are visible. Layers can be defined as draw-order bands (e.g. draws 0–99 = layer 0, 100–199 = layer 1) or by a world/layer id if we add it to the draw list. User can hide background or foreground to isolate sprites.
7. **Zoom:** Zoom in/out on the canvas (e.g. 1x, 2x, 4x). Interaction: mouse wheel or buttons; optionally pinch on touch. Consider: zoom center (cursor vs canvas center); optional "zoom to fit" or "zoom to selection" (e.g. zoom so the selected sprite or group fits in view). No technical blocker; just UX choices.
8. **Sprite grouping (stretch):** Sprites in games are often multiple 8×8 tiles drawn together. Allow the user to **group** a set of draws (e.g. by selecting a region or multiple tiles) and name/save as "Mario", "enemy type A", etc. So we can "isolate this character" and later apply colors or export as a unit. Stored as metadata (list of draw indices or tile hashes); no change to vbstate format.
9. **Painting and export:** Brush strokes in screen space → map (x, y) to draw list (back-to-front) → tile index → pattern table → content hash → update or append pack entry (256-byte RGBA). The editor **exports the .vbcolor as the user works** (they can re-export repeatedly); the file is the full pack (existing entries plus new/updated ones).
10. **Editor settings and system menu:** The editor should have a **settings file** (or equivalent) so we can remember configuration (e.g. last palette preset, default zoom, window layout, future options). That implies a **system menu** (or settings menu) somewhere in the UI where the user can change options and where we persist/load that config. Storage can be localStorage (key e.g. `vb-paint-editor-settings`), a user-saved JSON file, or IndexedDB; start with localStorage and a simple schema (e.g. `{ palettePreset, zoomLevel, ... }`). The system menu is the place for "Settings", "Load vbstate", "Load pack", "Export pack", and eventually other commands.

**Higher-resolution tiles (1:1, 1:2, 1:4 pixels per VB pixel) — where does scale live?**

- **Two cases:**
  - **A) Display zoom only (editor UX):** The canvas shows 1 VB pixel = 2×2 or 4×4 **screen** pixels so the user can paint more easily. We still store 8×8 RGBA in the pack; the app draws at 1:1. Scale is an **editor setting only** (e.g. in the editor settings file / system menu), not in the .vbcolor file. **No format change.**
  - **B) HD pack format (tiles stored at higher resolution):** Each tile in the pack is stored at higher resolution (e.g. 16×16 or 32×32 RGBA per tile). Then the **scale (1:1, 1:2, 1:4) must be defined in the .vbcolor file** — e.g. a header field such as `tilePixelSize` (1, 2, or 4 meaning 8, 16, or 32 pixels per side) or `pixelsPerVBPixel` (1, 2, 4). That way the app knows how to interpret each entry when it loads the pack. A separate config file would be fragile (pack and config could get out of sync); the pack file should be self-describing. So: **HD modes are supported directly in the .vbcolor file** (header), not in a separate place. Current format has no such field (fixed 8×8); we’d add it as a format extension when we add HD packs.
- **Conclusion:** (A) = editor-only zoom, stored in editor settings. (B) = true HD packs: scale lives **in the .vbcolor header** so 1:1, 1:2, 1:4 (and entry size) are defined by the file.

**Summary: Phase 1 scope**

| Sub-phase | What | Delivers |
|-----------|------|----------|
| **1A** | Extract + merge | tile-manifest.json from one or more vbstate.json |
| **1B** | Frame/sprite viewer | Render frame from vbstate in draw order; 4 colors + presets (YY-CHR style) |
| **1C** | Paint-on-game editor (separate page) | Load vbstate → render with palette; select; layer filter; zoom; grouping (stretch); paint → pack; **editor settings file + system menu**; optional HD tiles (scale in .vbcolor header) later |

Phase 1 is not "only manifest"; it includes "see the frame and its sprites" (1B) and the full paint-on-game editor (1C) as a dedicated page. Implement 1A → 1B → 1C in order; select/layer/zoom/grouping as specified above.

**Current status:** Single-file load and export work (1A). Multi-file merge can be an explicit requirement. 1B and 1C are specified above for implementation.

**Readiness, risks, and debugging:** See [phase1-readiness-risks-debugging.md](phase1-readiness-risks-debugging.md) for readiness checklist, risks and mitigation, debugging strategy, and validation tools (including `validateVIPState`, Vitest for extraction, and test vbstate).

---

### Phase 2: Pack authoring — manifest → .vbcolor

**Goal:** Author a color pack from a tile manifest and export a `.vbcolor` file the app can load.

**Inputs**

- **tile-manifest.json** from Phase 1: `{ version, tiles: [ { hash, dataBase64 }, ... ] }`.

**Outputs**

- **.vbcolor file:** Binary format (see `vbcolor-pack.js`): header (magic, version, game ID length, game ID bytes) + entries (4-byte hash + 256-byte RGBA per tile). Game ID is a string (e.g. `mario-clash`) for display/matching.

**Requirements (Pack editor tool)**

1. **Load manifest:** Load tile-manifest.json; decode each `dataBase64` to 16-byte tile; display tiles in a grid with **monochrome red preview** (VB 2bpp: transparent + three shades of red).
2. **Select tile:** User can select a tile; editor shows which tile is selected.
3. **Assign color:** For the selected tile, user picks a color (e.g. hex). Editor generates 256-byte RGBA by mapping 2bpp levels (0=transparent, 1–3=color at 33%, 66%, 100% brightness).
4. **Apply:** Store the 256-byte RGBA for that tile's hash in the pack-in-progress. Optionally support "apply to all" or batch color for multiple tiles.
5. **Game ID:** User sets a game ID string; it is stored in the pack header.
6. **Export:** Build the binary .vbcolor (game ID + list of (hash, 256-byte RGBA)) and trigger download. Format must be parseable by `parseVBColorPack()` in the app.

**Exit criteria**

- Load manifest → assign colors to a subset of tiles → set game ID → export .vbcolor.
- `validatePack(buffer)` reports valid and correct `gameId` and `entryCount`.
- App can load the .vbcolor file (no parse errors).

**Current status:** Editor exists with load manifest, color picker, apply, game ID, export. Refinements (e.g. batch color, "apply to all") can be added as needed.

---

### Phase 3: Runtime — validate color layer with hand-made pack

**Goal:** Confirm that the app's color layer correctly draws pack tiles in the right places and in the correct order when the patched core pushes VIP state every frame.

**Prerequisites**

- Patched core that pushes full VIP state each frame (pattern table, OAM, segments, windows, **drawList**).
- At least one vbstate.json captured when Seg=16 and DL>0 (so drawList is present).

**Steps**

1. Build a small hand-made pack using Phase 1 + Phase 2 (one vbstate → manifest → color a few tiles → export .vbcolor).
2. In the app: load ROM, load the .vbcolor pack, set display to **Color**.
3. Run the game (or the same scene you captured). Observe:
   - Colorized tiles appear at the correct (x, y) and with correct layering (draw order).
   - Where the pack has no entry, the monochrome frame shows through (no black holes).

**Requirements (App runtime)**

1. **VIP state consumer:** When core calls `__VB_PUSH_VIP_STATE__(state)`, app keeps one `lastVIPState` and passes state to the color layer (and any other consumers).
2. **Color layer:** For each draw in `state.drawList`, take the 16-byte tile from `state.patternTable` at `tileIndex`, compute content hash, look up in the loaded pack; if found, draw the pack's 256-byte RGBA at (x, y) with flipH/flipV. Composite the color layer over the monochrome canvas with transparency where the pack has no tile.
3. **Save VIP state:** Button serializes `lastVIPState` via `serializeVIPState()` and downloads vbstate.json. Only enabled when at least one state has been received.

**Exit criteria**

- Hand-made pack shows colored tiles in correct positions and order.
- Missing pack entries show mono underneath (transparent color layer).
- No crashes or obvious memory growth over many frames.

---

### Phase 4 (future): Painting mode

**Goal:** Let the user paint on a frozen frame in the app; strokes map to tile hashes via the draw list and update the pack in memory; user can save the pack and restart to see changes.

**Requirements (outline)**

- **Capture:** "Enter painting mode" freezes current `lastVIPState` (pattern table, OAM, draw list). Optionally pause emulation.
- **Paint UI:** Show frozen frame (mono or color); brush strokes in screen space; map (x, y) to draw list to get tile index → pattern table → content hash; write/update pack entry for that hash.
- **Save pack:** Export .vbcolor (or persist to IndexedDB) and optionally reload game with the new pack.

Not in scope for the current "solid requirements" pass; this doc only calls out that the **data path** (VIP state + draw list) is already there.

---

## Tool requirements summary

| Tool | Input | Output | Must support |
|------|--------|--------|----------------|
| **App: Save VIP state** | Last VIP state in memory | vbstate.json (pattern table, OAM, segments, windows, drawList) | Serialize full state; only when patched core has pushed state |
| **Tile extractor** | One or more vbstate.json | tile-manifest.json | Parse vbstate (or deserialized); unique tiles by hash; merge across dumps; export manifest |
| **Pack editor** | tile-manifest.json | .vbcolor file | Load manifest; mono preview; pick tile + color; apply; game ID; export valid .vbcolor |
| **Pack validator** | .vbcolor [+ optional vbstate] | Valid/invalid + coverage | Parse pack; report gameId/entryCount; optional coverage vs dump |
| **App: Color layer** | VIP state + loaded pack | Color overlay on mono canvas | drawList-driven draw; hash lookup; transparent where no pack entry |
| **Paint-on-game (1C)** | vbstate.json + optional .vbcolor (existing pack) | .vbcolor (export as you work) | Two key files: vbstate + pack (optional). First time: vbstate only → paint → export. Settings file (e.g. localStorage) + system menu for config (palette, zoom, Load/Export). HD scale (1:1, 1:2, 1:4) when in pack format: **in .vbcolor header**, not elsewhere. |

---

## vbstate.json format (reference)

Required for extraction and for validator coverage:

- **version:** number (e.g. 1)
- **eye:** number (0/1)
- **frameNumber:** number
- **patternTableBase64:** string (32 KB decoded)
- **oamBase64:** string (8 KB decoded)
- **segmentCount:** number (16)
- **segmentsBase64:** array of strings (each 8 KB decoded)
- **windowsBase64:** string (1 KB decoded)
- **drawList:** array of `{ tileIndex, x, y, flipH?, flipV? }` (optional for extractor; required for runtime color layer and for viewer/paint-on-game)
- **screenshotDataURL:** optional string (data URL of a 384×224 PNG). When saving VIP state from the emulator, the app can capture the current frame and store it here so the viewer can load render + screenshot and overlay/compare for alignment debugging.

The tile extractor only needs the pattern table to build the manifest; segments/windows/drawList are used by the app at runtime, the validator (coverage uses pattern table from dump), and the Phase 1B/1C viewer and paint-on-game editor.
