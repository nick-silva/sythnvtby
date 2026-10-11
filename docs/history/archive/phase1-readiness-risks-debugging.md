# Phase 1: Readiness, risks, and debugging

**Status: Archived.** Phase 1 is complete. Kept for development archive. See [README.md](../../README.md).

---

This document answers: **Are we ready to start Phase 1?** What’s missing? What could go wrong? How do we debug and validate?

---

## 1. Readiness checklist

### We have enough to start

| Item | Status |
|------|--------|
| **vbstate format** | Defined and implemented; `serializeVIPState` / `deserializeVIPState` include patternTable, oam, segments, windows, drawList. |
| **Tile extraction (1A)** | `extractTilesFromDump`, `exportTileManifest` exist; tools/extract.js loads one vbstate and downloads manifest. Multi-file merge not yet (add when needed). |
| **Draw-list rendering** | `color-layer.js` already draws from drawList with flipH/flipV and 8×8 tiles; same logic can be reused for viewer (draw to canvas with 4-color palette instead of pack lookup). |
| **2bpp decode** | `tools/editor.js` has `decodeTile` (16 bytes → 64 indices 0–3); can be shared or moved to a common module for 1B/1C. |
| **Palette presets** | `src/palette-layer.js` exports `PALETTE_PRESETS` (original, green, blue, gameboy, warm); viewer/editor can import or copy. |
| **Test vbstate** | You have a real `vbstate.json` (Seg=16, drawList present) in project root; use it for manual validation. |
| **Pack format** | `.vbcolor` parse/build and validator exist; paint-on-game will write the same format. |

### Pinned requirements (no longer optional)

- **Layer definition for filter (1C):** Draw list has no explicit “layer” field yet. For 1C we can define layers as bands of draw indices (e.g. by splitting drawList into N chunks) or add an optional `world`/`layer` to the core’s draw list later. Start with index-based bands.
- **Coordinate system:** VB frame is 384×224; drawList (x, y) are in that space. Viewer canvas should be 384×224 (or scaled for display). No ambiguity.
- **Empty / no state in viewer (and eventual editor):** When nothing is loaded (initial load or after clearing), or when the loaded vbstate has an empty drawList, show a **blank canvas** (or empty frame area) and a **subtle message** (e.g. "No frame loaded" or "Load a vbstate.json file to view"). Do not throw. Invalid file load can show a clear error; "no file yet" or "empty frame" is not an error — just blank + message.
- **Viewer/editor loads from file by default:** The viewer (and paint-on-game editor) do **not** require the emulator to trigger them. The user opens the tool page and loads a vbstate.json via file input or drag-and-drop. That is the primary and earliest workflow. Optional later: "Open in editor" from the emulator that passes state without a manual save/load.

**Verdict:** Ready to start. Begin with **1A** (enhance extractor with multi-file merge if desired, then lock 1A). Then **1B** (viewer page: load vbstate, re-render frame with 4 colors + presets). Then **1C** (same page or new paint.html: select, layer filter, zoom, grouping, paint → pack).

---

## 2. Risks and mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| **vbstate.json from different core version** | Old dumps might lack drawList or have different shape; viewer fails or shows nothing. | Validate on load: require `drawList` (array) and `patternTable`; show a clear error if missing. Document “use Save VIP state from current patched core.” |
| **Draw order / flip bugs** | Frame looks wrong (tiles flipped or in wrong order). | Reuse the exact loop from `color-layer.js` (draw order, flipH/flipV). Add a “reference” screenshot from the emulator for the same frame and compare visually, or add a unit test that renders a 2-tile vbstate and checks pixel at a known (x,y). |
| **Large vbstate (1MB+) in browser** | Slow load or parse, or OOM on low-end devices. | Load is one-time per session. If needed: lazy-parse drawList (stream or chunk) or cap drawList length for display (e.g. first 10k draws) with a warning. Start without cap; add only if we see issues. |
| **Palette preset mismatch** | Viewer colors don’t match main app Palette mode. | Import `PALETTE_PRESETS` from `palette-layer.js` in the tool (or copy the same structure). Use same 4-color remap (level 0→transparent, 1–3→color at 33/66/100% or same formula as palette-layer). |
| **Scope creep (1C)** | Select, layers, zoom, grouping, paint could each grow. | Implement in order: load + render (1B) → load + render + palette (still 1B) → then add select (hit-test) → layer filter → zoom → grouping (stretch) → paint. Lock exit criteria for each sub-phase before adding the next. |
| **Shared code (decodeTile, hashTile)** | Duplication between app, editor, and new viewer. | Move shared pieces into `src/` (e.g. `decodeTile` and 2bpp→RGBA with 4 colors into `vip-state.js` or a small `vb-2bpp.js`) and import from tools. Reduces drift and bugs. |

---

## 3. Debugging strategy

### What we need to debug

- **1A:** Correctness of extraction (unique tiles, correct hashes, manifest loadable by pack editor).
- **1B:** Frame matches the game at capture time (same tiles, same order, same flips); palette application correct.
- **1C:** Hit-test picks the right draw; layer filter shows/hides correct draws; paint updates the right tile hash; saved pack loads in app and shows in Color mode.

### How we’ll debug

1. **Console and logs**
   - In tools: `console.log` when vbstate loads (e.g. `drawList.length`, `patternTable.length`, `segmentCount`). Optional `?debug=1` or localStorage flag to log every draw or first N draws.
   - In app: existing VIP state consumer; no change needed unless we add “Open in paint editor” (then log postMessage).

2. **Visual validation**
   - **1B:** Load the same vbstate in the viewer and compare side-by-side with a screenshot of the emulator at the same frame (or the same vbstate captured while the game was paused). Same canvas size (384×224) and same draw order → should be pixel-identical (or identical after palette remap).
   - **1C:** After painting one tile, export pack, load in app, switch to Color mode → confirm that tile appears in the right place.

3. **Unit tests (Vitest)**
   - **Extraction:** `extractTilesFromDump` with a minimal vbstate (e.g. 2 tiles in pattern table, drawList with 1 draw) → expect `tiles.size === 1` or `2`, and `hashTile(getTileBytes(patternTable, 0))` matches manifest hash.
   - **2bpp decode:** Already have palette-layer tests; add a small test for `decodeTile` (or shared 2bpp helper) that one known 16-byte tile decodes to expected 64 indices.
   - **Draw-list hit-test:** Given a tiny drawList (e.g. one draw at (0,0)), hitTest(4, 4) returns that draw index; hitTest(100, 100) returns null or -1.

4. **Small test assets**
   - Keep a **minimal vbstate** (e.g. 1 KB: pattern table with 1–2 tiles, drawList with 1–2 draws) in repo or generate in test. Use for fast automated tests and for “does the viewer load?” without loading a 1MB file.

5. **Browser devtools**
   - Network: confirm vbstate.json and tile-manifest.json load (size, 200).
   - Sources: breakpoints in `deserializeVIPState`, `extractTilesFromDump`, and in the viewer’s render loop if something is wrong.
   - Performance: only if we see jank (e.g. 50k draws); then profile and consider culling or simplifying.

---

## 4. Validation and debug tools to add

These will make Phase 1 validation and debugging easier. Implement as needed (not all up front).

| Tool | Purpose | Where |
|------|--------|--------|
| **vbstate sanity check** | On load (in tools or in a small shared helper): assert `patternTable` length 32768, `drawList` array, optional `segmentCount === 16`. Return list of warnings (e.g. “drawList empty”). | `src/vip-dump.js` (e.g. `validateVIPState(obj)`) or in viewer on load. |
| **Manifest validator** | Given a tile-manifest.json, check version, tiles array, each tile has `hash` and `dataBase64`, decode base64 and check length 16. Optional: check hash matches `hashTile(decoded)`. | `src/tile-extractor.js` or `src/pack-validator.js`; call from tools or test. |
| **Minimal test vbstate** | Generate or store a tiny vbstate (e.g. 2 tiles, 2 draws) for unit tests and “smoke test” viewer load. | `tests/fixtures/minimal-vbstate.json` or generate in test with `serializeVIPState({ ... })`. |
| **Viewer “diff” or reference** | Optional: viewer button “Compare to reference image” — load a known PNG and show diff (or just side-by-side). Low priority; manual screenshot compare is enough at first. | Later in 1B/1C if we need it. |
| **Console helpers** | In dev, expose on `window` for tools page: e.g. `window.__vbInspectState(obj)` logs summary (drawList.length, unique tile count, first draw). | Optional; add in tools/paint.html or extract.js when debugging. |

### Suggested order

1. **Before 1A lock:** Add `validateVIPState(obj)` (or a simple inline check in the tool) so we fail fast on invalid or old vbstate.
2. **Before 1B:** Add a minimal test vbstate (or create in test) and a Vitest test that loads it and runs `extractTilesFromDump` + optional `validateVIPState`. Ensures pipeline doesn’t regress.
3. **During 1B:** Reuse `compositeColorFrame`-style loop for “draw frame with 4 colors” (no pack); add a test that renders a 2-draw vbstate and checks one pixel value.
4. **During 1C:** Add hit-test unit test; add `?debug=1` or console helper to log selected draw index and hash when clicking.

---

## 5. Summary

- **Ready to start Phase 1.** No blocking gaps; a few “pin down as we go” items (layer definition, empty vbstate).
- **Risks:** vbstate shape changes, draw-order bugs, scope creep, large file. Mitigations: validate on load, reuse color-layer loop, shared 2bpp code, implement 1A→1B→1C in order.
- **Debugging:** Console logs, visual comparison (viewer vs emulator screenshot), Vitest for extraction and 2bpp and hit-test, small test vbstate, optional console helpers.
- **Tools to add:** vbstate sanity check, optional manifest validator, minimal test vbstate + test, and (during 1B/1C) pixel or hit-test tests and optional debug helpers.

Once `validateVIPState` (or equivalent) and a minimal test vbstate + test are in place, we’re in good shape to implement 1A enhancements (if any), then 1B viewer, then 1C paint-on-game.
