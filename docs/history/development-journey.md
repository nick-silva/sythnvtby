# Development journey: sythnvtby

A narrative of how this project was built — the plan, the bugs we hit, how we fixed them, and when we pivoted. Better late than never.

**Doc index:** For a full list of current and archived docs, see **[docs/README.md](../README.md)** (project docs index).

**Caveat:** Some early conversation context was compressed over time, so the very first steps are reconstructed from docs and code rather than from a full transcript. From the art-pipeline and viewer work onward, the story is more complete.

---

## What we’re building

**Goal:** A browser-based Virtual Boy emulator where games can be colorized via **per-tile color packs** (like SNES/NES colorization), with Monochrome, Palette (4-shade remap), and Color (pack overlay) modes. Stereo (2D, side-by-side, anaglyph) is supported; eventually we want a proper stereoscopic view.

**Stack:** EmulatorJS + Beetle VB (libretro) core, Vite app, VIP state (pattern table, OAM, segments, windows, draw list) from a **patched** core. Tools: tile extractor, frame viewer, pack editor; vbstate.json as the snapshot format.

**High-level pipeline:** Run game → (optional) save VIP state → extract tiles → build/assign colors in pack editor → load pack in app → Color mode composites pack over mono. The patched core must push VIP state (and a draw list) each frame so we can re-render from tiles.

---

## The plan (phases)

We wrote it down in [art-pipeline-plan.md](archive/art-pipeline-plan.md) and [core-patch-proposal.md](../core/core-patch-proposal.md):

- **Phase 1A:** Tile extractor — load vbstate, extract unique tiles by content hash, export tile manifest. Multi-file merge. Validation and tests.
- **Phase 1B:** Frame viewer — load vbstate, re-render frame from draw list in draw order, 4-color palette + presets (YY-CHR style). Standalone tool (no emulator required to view).
- **Phase 1C:** Paint-on-game editor (separate or same page) — select tile by click, layers, zoom, paint → pack. Partially scoped; viewer and alignment came first.
- **Core patch:** Build Beetle VB with hooks to push pattern table, OAM, segments, windows, and an optional **draw list** (tile + x, y, flips per draw) so we don’t re-implement the full VIP. Phased: frame tick → minimal state → full VIP → draw list.

We also pinned non-negotiables: vbstate format, 384×224 coordinate space, empty-state handling (blank + message, no throw), viewer/editor loading from file by default. See [phase1-readiness-risks-debugging.md](archive/phase1-readiness-risks-debugging.md).

---

## Journey

### Getting the app running

The app loads a ROM and runs it via EmulatorJS and the Beetle VB core (CDN or local). Monochrome works out of the box. Display options: Monochrome, Palette, Color; View: 2D, Side-by-side, Anaglyph. Color mode needs VIP state from the core; the CDN core doesn’t send it, so we had to patch and host our own core to get a draw list and pattern table.

**Cross-origin canvas:** If the emulator runs in a cross-origin iframe (e.g. CDN), the app can’t read the video canvas. Palette and any capture (screenshot, readPixels) fail or stay red. **Fix:** Serve EmulatorJS from the same origin (e.g. `public/data/`) so the canvas is same-origin. Documented in [rollback-palette.md](../reference/rollback-palette.md).

---

### Palette mode: the single-frame freeze

**Bug:** In Palette mode, the first frame was captured and remapped correctly, but the image never updated. Toggling back to Monochrome and then to Palette again still showed the same frame. So we had “one static frame, correct colours, no updates.”

**Cause:** The emulator uses WebGL. By default the browser can clear or reuse the WebGL drawing buffer after compositing. So `drawImage(webglCanvas)` and `readPixels()` were often reading a cleared or stale buffer — we only ever saw one frame (or black when we tried to prefer readPixels).

**What we tried (and didn’t fix it):** WebGL readPixels (Chrome returned zeros; Firefox sometimes one frame then black); fallback “if readPixels zeros → drawImage” (still black); double rAF to defer read (read after clear → black); separate readback vs remap canvases (cleaner but didn’t fix updates); throttle and buffer reuse (kept, no harm).

**Fix:** Create the WebGL context with **`preserveDrawingBuffer: true`**. We can’t change the core’s source at that point, so we **patch `HTMLCanvasElement.prototype.getContext`** before the EmulatorJS loader runs. When the loader calls `getContext('webgl')` or `getContext('webgl2')`, our wrapper adds `preserveDrawingBuffer: true` and forwards to the real getContext. The emulator’s buffer is then preserved so we can read the current frame each time.

**Where:** `src/main.js` — `patchGetContextForPreserveDrawingBuffer()` at the start of `startEmulator()`. User must load a ROM (or reload) so the emulator is created with the patched context.

**Doc:** [palette-mode-bug-investigation.md](archive/palette-mode-bug-investigation.md).

---

### Core patch and VIP state

To get Color mode and the tools working we need the core to push VIP state (pattern table, OAM, segments, windows) and ideally a **draw list** so we don’t re-implement the VIP. We forked/patched Beetle VB (see [core-patch-proposal.md](../core/core-patch-proposal.md) and [vip-rendering-validated.md](../reference/vip-rendering-validated.md)):

- Hook at frame end (e.g. when `DrawingBlock == 28`, `DrawingActive = false` in vip.c).
- Copy pattern table (CHR_RAM), OAM, windows, segments from DRAM into buffers and pass to JS via `window.__VB_PUSH_VIP_STATE__(state)`.
- Build a draw list inside `VIP_DrawBlock` / DrawBG / DrawAffine / DrawOBJ: each time a tile is drawn, push `{ tileIndex, x, y, flipH, flipV }` in the same order the VIP draws. JS decodes a C struct buffer into `state.drawList`.

**Build and cache gotcha:** We build the core to .bc with Emscripten, then turn it into WASM via the EmulatorJS/RetroArch build. We serve `public/data/` (loader + core) from our app. **EmulatorJS caches cores in IndexedDB.** If you replace the core files on disk and reload the app, the browser may still run the **old** cached core. Symptoms: patch level or behavior doesn’t change after a rebuild. **Fix:** Use the emulator’s **Cache Manager** (in the UI) and clear the cache, then reload the ROM so the new core is fetched and decompressed. Documented in [core-build-phase0-phase1-runbook.md](../core/core-build-phase0-phase1-runbook.md).

---

### Frame viewer and screenshot with vbstate

Phase 1B gave us the frame viewer: load a vbstate (file or drop), re-render from `drawList` with a 4-color palette and presets from `src/palette-layer.js`, shared 2bpp helpers in `src/vb-2bpp.js`. Empty state and empty drawList show a blank canvas and a clear message instead of throwing.

We wanted to **compare** our re-render to the real frame. So we added:

- **Screenshot with vbstate:** When the user clicks “Save VIP state,” we capture the emulator canvas (via `paletteLayerModule.getEmulatorCanvas()`), draw it to a 384×224 canvas, and store the PNG data URL as `screenshotDataURL` in the saved vbstate.
- **Viewer view modes:** Render | Screenshot | Overlay (with opacity slider). Offset X/Y sliders to shift the render for alignment. Click canvas → log which draw(s) are under that pixel and highlight the topmost (yellow 8×8 outline).

That made it possible to overlay our render on the reference screenshot and see misalignment.

---

### Copy image and Export PNG

Right-click “Copy Image” on the viewer was copying the **render** canvas (or nothing useful) instead of the screenshot. We wanted to copy the reference screenshot and to export the **overlay** (screenshot + render at opacity) as a single image.

**Changes:**

- **Screenshot mode:** When view mode is Screenshot, the screenshot `<img>` gets the `copyable` class (higher z-index, pointer-events) and the render canvas gets `pointer-events: none`, so the browser’s native “Copy Image” on right-click copies the screenshot.
- **Export PNG / Copy image buttons:** A helper `getCurrentViewCanvas()` builds a 384×224 canvas for the **current** view (Render = canvas only; Screenshot = screenshot only; Overlay = screenshot + canvas at current opacity). “Export PNG” downloads that as a file; “Copy image” writes it to the clipboard via the Clipboard API. So the user can export or copy the overlay for sharing or further comparison.

---

### Sprite alignment: it’s not a global offset

With the overlay and a Mario Clash title-screen vbstate, the user reported:

- Top of screen: our render showed **green** where the reference was **black**.
- Title (MARIOCLASH): roughly in place but offset **right**, tiles **garbled** (8×8 not lining up), and **vertically stretched** (~20–25% taller).
- “PUSH START BUTTON”: offset **left** (and down), also stretched and garbled.
- Copyright: garbled and lower.

So the problem was **not** a single global (Δx, Δy). Different regions had different X offsets (title right, PUSH START left), and we had stretch and garbling. We wrote [sprite-alignment-investigation.md](archive/sprite-alignment-investigation.md) to record symptoms, hypotheses (coordinate space, Y scale, per-world offset, etc.), and a plan: use the viewer’s “Log draw list summary” (including per-band stats), inspect the draw list, compare one tile to the reference, then fix either in the viewer (per-band offset) or in the core (coordinates/scale).

---

### Root cause: we were drawing both eyes

While checking “is there any 3D magic in the draw list?” we traced the core’s draw-list build:

- The VIP renders **two** framebuffers per frame (left and right). Parallax shifts X per eye (world `gp`/`mp`, sprite `jp`).
- **DrawBG** and **DrawAffine** are called **once per eye** (`lr = 0` then `lr = 1`) for each tile; each call did one `VB_DL_Push(..., x, y, ...)`. So every BG and Affine tile was **pushed twice** (left X and right X) into the same list.
- **DrawOBJ** was intentionally pushing **once** per sprite, left-eye position only.

So the exported draw list was a **mix of left- and right-eye draws**. When we re-rendered the whole list on one 384×224 canvas, we drew **both eyes on top of each other**. That explained ghosting, non-uniform X (different parallax per layer), “garbled” tiles, and the stretched/doubled look. No extra depth math — just parallax and two views merged into one list without an eye tag.

**Pivot:** Instead of chasing per-band offsets or coordinate bugs first, we fixed the **data model**: tag each draw with **eye** (0 = left, 1 = right) and filter to one eye everywhere we render.

---

### Eye field and left/right toggle

**Core (C):**

- Added `uint8_t eye` to `VB_DrawCall`; `VB_DL_Push(..., eye)`.
- **DrawBG** and **DrawAffine:** pass `(uint8_t)lr` as eye so both eyes are emitted with correct X.
- **DrawOBJ:** push **once per eye** when `tile_y == 0` (loop over `lr`, only if sprite visible for that eye), with `x = jx ± jp` and `eye = lr`.
- JS callback decodes `eye` from the struct and adds `call.eye` to each draw list entry.

**App:**

- **vip-dump:** Serialize/deserialize `eye`; missing `eye` → 0 (left) for backward compatibility.
- **Viewer:** “Eye: Left | Right” dropdown (default Left). Render and hit-test use only draws with `(d.eye ?? 0) === selectedEye`. Status shows “N draws (Left eye)” or “(Right eye)”. Log summary includes `eyeCounts: { left, right }`.
- **Color layer:** `compositeColorFrame(state, packEntries, imageData, eye)` filters by `eye`. `wireColorLayer` fills left and right buffers from the **same** state (filter eye 0 and 1), then composites for 2D/side-by-side/anaglyph. So one state push drives both eyes and stereo is ready without breaking.

**Result:** Single-eye re-render matches one view; user can toggle Left/Right in the viewer. Old vbstate without `eye` still loads (treated as left). Stereoscopic support is preserved for a future stereo viewer.

---

### Sprite alignment: 2bpp decode (smeared tiles fixed)

After filtering to one eye, tiles no longer ghosted, but **pixels inside each 8×8 looked smeared or wrong** — the tile shape was right but the decoded pattern didn’t match the reference.

**Cause:** Our 2bpp decode in `src/vb-2bpp.js` used **planar** layout (two bitplanes, MSB-first). The VB core (and hardware) use **packed** layout: each row is one 16-bit word, with `pixel_col = (word >> (col*2)) & 3`.

**Fix:** In `decodeTile()`, we switched to packed: build the word per row from the two bytes, then for each column use `(word >> (col*2)) & 3`. See [sprite-alignment-investigation.md](archive/sprite-alignment-investigation.md) (§ 2bpp decode fix).

**Caveat:** Tile content hashes changed; existing .vbcolor packs keyed by the old hash may not match. Re-extract and re-author packs if needed.

---

### Viewer: crop top, Black BG, and alignment evidence

We still had a **green bar at the top** (reference was black) and **vertical offset/stretch** that varied by band (title, PUSH START, copyright needed different Y offsets). To support comparison and data gathering we added:

- **Crop top:** Number input (0–224, step 8). Skip drawing tiles with `call.y < cropTop` so the top band can be left black (workaround for “content that shouldn’t be visible”).
- **Black BG:** Checkbox. When on, palette index 0 is rendered as black so background tiles match the screenshot.
- **Offset X/Y:** Range expanded to ±64 so the user can scroll the top bar off or fine-tune alignment.
- **Alignment evidence:** “Log alignment sample” button prints a band table (Top bar, Title, PUSH START, Middle, Copyright) with representative Y and distance-from-center; click on canvas logs `distanceFromCenterY` (draw.y − 112). The investigation doc has step-by-step data gathering and an evidence table so we can test whether offset is linear in distance from center.

---

### VIP render path and draw density (traced in doc)

To see if the mismatch was “core draws at different Y than it pushes,” we traced the core and our app in [sprite-alignment-investigation.md](archive/sprite-alignment-investigation.md):

- **Core:** VIP_DrawBlock → strip buffers → packed into FB → copied 1:1 to surface. The Y we push (RealY − vflip_xor for BG, jy for OBJ) is the **same** scanline space as the pixel write. No Y offset or scale in the copy.
- **Conclusion:** Draw list Y and emulator display Y are the same coordinate system. The bug isn’t “core draws at different Y than it pushes.”
- **Where the mismatch could still be:** (1) **DisplayActive** — when false the copy writes black; we still push all draws, so we may be drawing “above” the visible window (top bar). (2) **Draw density / Y step:** We confirmed our app does **not** change density or step (one draw → one 8×8, call.y = pixel Y). The core also pushes one per tile, Y in pixels. So stretch isn’t from us reinterpreting Y; it would be duplicate draws or reference scaling.

---

### Scale and origin in the viewer (float stretch)

Rather than chase a single root cause immediately, we added a **pragmatic view transform** so the user can line up the overlay and we can collect distortion data:

- **Scale X / Scale Y:** Float inputs (default 1, range 0.5–2, step 0.01). Scale the render around an origin.
- **Origin X / Origin Y:** Default 192, 112 (center of 384×224). Transform: `displayX = originX + (call.x − originX) * scaleX + offsetX`, same for Y; tile is drawn at size `8*scaleX` × `8*scaleY` with nearest-neighbor sampling.
- **vb-2bpp.js:** `drawTileIntoImageData(..., options)` now accepts `destW` and `destH` so we can draw the 8×8 tile scaled. Flips applied in source space.
- **Viewer:** Render, highlight rect, and click hit-test all use the same transform. Export PNG and Copy image reflect the current scale and origin. Status line shows scale when not 1.

**Rationale:** We’re not “causing” the mismatch upstream; we’re compensating for a difference (viewport, capture scale, or display path). Adding scale/origin gives immediate progress (overlay can line up), records the scale values that fix the distortion, and doesn’t block a later root-cause fix (e.g. DisplayActive or capture at 1:1).


### Transparent 0 and Clear left/right

The core treats **palette index 0** as transparent (it only writes non-zero pixels). Our re-render was drawing index 0 as a visible color, which broke layered sprites (e.g. clouds, first level) and made backgrounds cover foregrounds.

- **Transparent 0:** Viewer checkbox; when on, we pass `skipPalette0: true` to `drawTileIntoImageData()` in vb-2bpp.js so pixels with palette index 0 are not written. That matches core behavior and fixes intro, first level, and sharpens sprites. On the title screen the green box behind "MARIO CLASH" can appear **larger** with Transparent 0 on, because we show the true extent of the panel layer's non-zero pixels instead of painting index 0 everywhere.
- **Clear left / Clear right:** Number inputs (0–384). After drawing the frame we fill the left N and right N columns with black so side bars can be hidden. First level uses Clear left = 0, Clear right = 0; intro needed side clearing. So **viewport/crop is per-scene**, not one global.

---

### Per-tile palette and captured GPLT (title-screen “black background” fix)

The **green bar at the top** and the **block that should be black** on the title screen were not a transparency bug — index 0 was already transparent. The VB has **four** 4-color palettes (GPLT 0–3); each tile picks one via a 2-bit **palette selector** in the tile map. We were using a single preset and four ramps for all selectors, so e.g. “palette 2” was always a green shade. The game had set GPLT 2 to black for that screen, so we drew the wrong color.

- **Per-tile palette selector:** The core already had `palette_selector` at draw time; we added it to the draw list as `paletteSelector` (0–3), and the viewer uses it to choose which of four 4-color sets to use per draw. Serialize/deserialize in `vip-dump.js` include `paletteSelector` (we had been dropping it on save/load — that’s why new captures still showed “no palette” until we fixed the dump).
- **Captured GPLT + master colors:** The VIP state push now exports **GPLT** (4 × uint16) and **BrightCLUT[0]** (the 4 master RGB colors) from the core. The viewer uses them when present: each palette selector 0–3 gets its four colors from the GPLT remap into the master table, so the re-render matches the game’s palettes on **any** screen. New vbstate captures include `gplt` and `masterColors`; the viewer shows “palette: captured (GPLT)” and the title-screen block (and other palette-driven regions) render correctly without manual toggles. See [title-screen-background-plan.md](archive/title-screen-background-plan.md) and [sprite-alignment-investigation.md](archive/sprite-alignment-investigation.md) (§ Solution: green block).

---

## Bugs and fixes (quick reference)

| What went wrong | Cause | Fix |
|----------------|--------|-----|
| Palette mode: one frame, then frozen | WebGL buffer cleared after composite; readback saw stale/cleared buffer | Patch `getContext` to add `preserveDrawingBuffer: true` before loader runs |
| Canvas not readable / Palette stays red | Emulator in cross-origin iframe | Serve EmulatorJS from same origin |
| Core patch “not updating” after rebuild | EmulatorJS caches core in IndexedDB | Clear Cache Manager in emulator UI, then reload ROM |
| Right-click Copy Image copied wrong thing | Screenshot img behind canvas, not receiving right-click | In Screenshot mode: `copyable` on img, `pointer-events: none` on canvas |
| No way to export overlay | — | Export PNG / Copy image buttons using `getCurrentViewCanvas()` for current view |
| Viewer re-render: ghosting, wrong X, stretched, garbled | Draw list contained **both eyes**; we drew all on one canvas | Add `eye` to draw list in core; filter to one eye in viewer and color layer; Left/Right toggle |
| Old vbstate without eye | New code expected `eye` | Deserialize: missing `eye` → 0 (left); viewer treats as left |
| Tiles correct shape but pixels smeared inside 8×8 | 2bpp decode was planar; VB core uses packed layout | `decodeTile()` in vb-2bpp.js: packed row = uint16, `(word >> (col*2)) & 3`; tile hashes change, re-extract packs |
| Viewer: “cropTop already declared” | `cropTop` declared twice in `renderFrame()` | Use single `cropTop` from top of function for status line |
| Loading a vbstate did nothing (no errors) | `clearLeft` and `clearRight` used in status line and clear rects but never defined → ReferenceError in `renderFrame()` | Define `clearLeft = getClearLeft()`, `clearRight = getClearRight()` at top of `renderFrame()` and use in both clear logic and status line |
| Viewer: “per-draw palette: no” after new core + new capture | `paletteSelector` was never written to vbstate JSON (serialize) nor copied when loading (deserialize) | Add `paletteSelector` to draw list in `serializeVIPState` and `deserializeVIPState` in vip-dump.js |
| Title-screen “block that should be black” rendered green | We used one preset + four ramps for all palette selectors; game had set GPLT 2 to black | Capture GPLT + BrightCLUT[0] in VIP state; viewer uses them when present so each palette selector gets correct colors; works on any screen |
| Vbpack: multiple frames/savestates not in zip or not found when loading | Painter Save and Play didn’t include vipStatesFolder; parse used zip.file(regex) which may not return all folder entries reliably | Painter builds vipStatesFolder from all availableFrames (and fallback from currentState); parseArtPack uses zip.filter() for vipstates/*.json and savestates/*.state so all entries are read |
| Last pack button opens file picker instead of loading | "Last pack" button was inside the same \<label\> as the Load pack file input; clicking the button activated the label’s control | Moved Last pack button outside the label; wrapped label + button in `.pack-load-row` so layout unchanged |

---

## Pivots

1. **Palette:** We tried several readback strategies (readPixels, drawImage, double rAF). The real fix was changing **how the context is created** (preserveDrawingBuffer), not how we read.
2. **Alignment:** We were about to chase per-band offsets and coordinate-space bugs. Tracing the core showed we were **mixing both eyes** in one list; fixing that (eye tag + filter) became the first step. Per-world or per-band tweaks can come later if needed.
3. **Stereoscopy:** We kept the design stereo-ready (two buffers, compositeStereo) and added the eye field so we can support a dedicated stereo viewer later without breaking the current “one eye at a time” workflow.
4. **Alignment (again):** After fixing the 2bpp decode and tracing the VIP path, we confirmed the core and our app agree on Y and density. Instead of chasing DisplayActive or capture scaling first, we added **scale and origin** in the viewer so the overlay can be made to line up and we can record the distortion (scale values). That gives immediate progress and data; root-cause can follow if needed.

### Design pivots (product direction)

We are **pivoting on the design** for several parts of the product to support a tighter, single-file workflow and a clear "colorize this frame" path:

5. **Single-file pack (vbpack):** Originally we had separate inputs — Load ROM, Load color pack, Load overrides. We implemented a **single .vbpack** (generic ZIP) that holds ROM, color pack, overrides, **save state**, and **VIP state(s)**. One "Load pack" can bring in everything; Export .vbpack produces one file for sharing or for the next session. The pack format is extensible (manifest refs for current save/VIP state; cleanup of old states is backlog). See [art-pack-file-format.md](../reference/art-pack-file-format.md).

6. **Position overrides as first-class:** Same tile (hash) can appear in multiple places; we want different colors per position (e.g. one letter in a word). We added **position-based overrides** (hash + rectangle → override RGBA). Overrides live in the vbpack (`overrides.json`) and are applied at runtime in the color layer. The painter supports **override art editing** ("Apply to: This position only") and **override highlighting** on the scene so the user can see which tiles are overrides. See [color-pack-overrides-design.md](../design/color-pack-overrides-design.md) and [paint-tool-overrides-flow.md](archive/paint-tool-overrides-flow.md).

7. **Colorize! → Painter → Save and Play:** Instead of "open painter, load vbstate + pack by hand, export pack, then load in emulator," we implemented an end-to-end flow: user clicks **Colorize!** in the emulator → emulator pauses, captures **save state** and **VIP state**, navigates (same tab) to the **painter** with a full vbpack (ROM + vbcolor + overrides + VIP + save state) via IndexedDB handoff. User edits (pack + overrides); **Save and Play** builds an updated vbpack, returns to the emulator, which restores the same frame and stays **paused** until input. VIP and save states live in the pack; old ones can be cleaned out later. See [colorize-workflow-vision.md](../design/colorize-workflow-vision.md) and [colorize-workflow-execution-plan.md](archive/colorize-workflow-execution-plan.md).

8. **Painter load/export vbpack:** The painter **Load pack** supports vbpack (vbcolor + overrides + optional VIP/save state + ROM if present) and can **Export .vbpack** for sharing. For the Colorize! flow, Save and Play returns a full vbpack back to the emulator via IndexedDB handoff.

These pivots don't remove the existing "load ROM + pack + overrides separately" support; they add the vbpack path and the intended end-to-end workflow so we can iterate toward it.

---

### Vbpack folders and Save and Play refinements

9. **Multiple frames and save states in the zip:** The vbpack format was extended so **all** frames and their save states live in the zip, not just the “current” one. Root-level `vipstate-current.json` and `save-state.state` remain for the current frame; in addition:
   - **`vipstates/*.json`** — Every frame snapshot (e.g. `current.json`, `frame-1.json`, …). Parsed via `zip.filter()` so all matching entries are found regardless of JSZip API quirks.
   - **`savestates/*.state`** — Optional per-frame save state (e.g. `current.state`). Names can match frame names so the emulator can “restore this frame’s save state” when the user picks a frame.
   The emulator shows a **Frame / Save state** dropdown when a loaded vbpack has at least one frame; selecting an entry applies that VIP state and, if a matching savestate exists, restores it via `gameManager.loadState()`.

10. **Save and Play creates the vbpack officially:** Save and Play **hands off** the buffer to the emulator and may **download** a `.vbpack` when you are not in an “(editing)” handoff flow. The suggested **filename** is tied to the **last loaded / exported** pack stem (not only raw `gameId`), and Chromium may **overwrite** the file last chosen via **Save .vbpack** when the handle is still valid. The buffer is still stored as **Last pack** for reload.

11. **Painter labels when loading from Colorize:** When the painter opens via Colorize!, the handoff contains the full vbpack (ROM, pack, overrides, frames). The file-input labels now show “From Colorize” or “Loaded: N overrides” instead of “No file chosen” so it’s clear that pack, overrides, and frame came from the emulator.

12. **Loaded state on the main emulator:** After Load pack or Save and Play, the UI shows what’s loaded: “Loaded: &lt;ROM&gt;”, “Loaded: &lt;pack name&gt;”, “Loaded” for color pack, “N overrides.” File inputs use a custom “Browse” + our label (replacing the browser’s “No file chosen”) so the state is visible without relying on the native file input text.

---

## Checkpoint: full vbpack pipeline and Last pack fix

**State at checkpoint:** The end-to-end flow works: load ROM → capture frames → Colorize! → edit in painter (pack + overrides, Filter: Background / Affine / Sprites) → Save and Play (overwrite confirmation when editing; download only when new) → return to emulator with Frame / Save state dropdown. Last pack loads from IndexedDB without opening the file picker (button moved outside the Load pack label). Selecting a frame with a save state restores game state only (no static VIP snapshot), so the game and picture match.

**Bugs fixed in this stretch:** Save and Play overwrites the same vbpack when editing (warning + no extra download). Frame/savestate dropdown: when a frame has a save state we only call loadState() so the core drives the image. Last pack button was inside the file input’s label, so click opened the file picker; moved button outside the label and wrapped both in `.pack-load-row`.

**Next focus:** Graphics glitches and investigations — fading/opacity/brightness, animated BG artifacting, affine layer understanding. See [graphics-next-investigations.md](../planning/graphics-next-investigations.md). Tile editor color wheel (more than 16 colors) is deferred until after graphics are in better shape.

---

## Painter groups and override panel (latest)

**Progress:** We extended the paint tool with **tile groups** and **group-based overrides** so the same tile (hash) can have different colors per group (e.g. “Blimp” vs rest of game).

- **Select All (visible) / matching:** “Select all visible” and “Select all matching tiles” (hash) remain. **Multi-selection:** shift-click toggles the top-most visible draw under the cursor; a drag **marquee** defines a region — **Select in box** / **Unselect in box** add or remove draws from the selection (with a warning when the box spans cells that stack multiple layers). **Clear selection** and a **Selected: N** badge. Selection drives **Add** / **Remove** from groups (including pool-first hierarchy cards).
- **Selection outlines:** Orange = current tile, cyan = other selected draws, green = same shape elsewhere, teal = position override; marquee drawn in yellow dashed stroke.
- **Groups UI:** Exclusive **paint target** (radio: Pack vs **This group**) plus per-group **visibility** checkboxes. **Rendering** uses every group with `visible !== false`; **editing** (tile painter, group-scoped strokes) applies only to the **selected** group. Add / Remove / Duplicate / **Copy pack colors** (full-frame group overrides) / Delete; expanded details include WRAM / pool assignment.
- **Staging / import canvas** is sized to match the main scene (768×448) across authoring profiles.
- **Group-scoped position overrides:** With **Apply to: This cell only (override)** and **Color target: This group**, strokes write overrides with **hash + rectangle + `groupId`** (and optional single-layer filter from group criteria). WRAM gates come from **pool / variant** or legacy group RAM — not from the “non-group” game-state row on the tile painter. Same tile at two screen positions can use two rects (e.g. top vs bottom “:”) in one group.
- **Pools (schema v2):** See § “Game state pools…” below; groups may reference `statePoolId` / `stateVariantId` so variant-owned `ramConditions` replace duplicating WRAM on every group in many workflows.
- **Groups preserved across Colorize / Save and Play:** `groups.json` carries groups, presets, **`gameStatePools`**, and **`groupsSchemaVersion`** when present; manifest can carry **`frameRegistry`** and **`currentVipStateRef`** so frame labels survive round-trips.

**Closed gaps (runtime):** The color layer evaluates **`groupId`** against-loaded groups **and** resolves effective RAM from **variants / legacy group RAM** when **live WRAM** is available from the core (or from save state / analysis path as wired in `main.js`). When WRAM is missing, gated overrides are skipped fail-closed where applicable — see `color-layer.js` and tests in `color-layer-ram.test.js`.

**Still rough / backlog:** Override list UX polish, undo for group delete, sprite overlap preview, keyboard shortcuts (deliberately parked until paint UX stabilizes).

---

## Painter overrides UX (Phase 2), memory-analysis clarity, and paint-tool fixes (March 2026)

This batch focused on **pack authoring ergonomics**, **clearer memory-analysis workflow**, and **two correctness bugs** in the paint tool.

### Overrides redesign — UI (Phase 2)

**Spec:** [paint-tool-overrides-redesign-spec.md](archive/paint-tool-overrides-redesign-spec.md) (locked decisions: override presets, one RAM gate per group, warnings, desktop-only).

**Implemented:**

- **Side panel order:** Groups → **Override presets** → Draws at click → Tile painter (staging/import unchanged below).
- **Group-level game-state (WRAM):** Expanded each group has a **Game-state (entire group)** block (state + candidate from `manifest.memoryAnalysis`). Group `ramConditions` are the single source of truth; redundant per-override RAM on grouped entries is stripped on load/export. Opt-in **confirm** the first time WRAM is enabled in a session; **opt-out** hint when analysis exists but RAM is off.
- **Override presets:** List in the UI; **Apply** fills tile-painter override controls and, if a paint-target group is selected, copies RAM onto that group. **Save as preset** captures from the selected group’s RAM or from non-group override controls. **Remove** deletes a preset from the session. Stored in `groups.json` beside groups (`overridePresets`).
- **Tile painter copy:** Game-state checkbox is labeled for **non-group position overrides**; group RAM is edited in the group panel.

**Pivot (historical):** Phase 2 first shipped **authoring + export** only. **Since then:** `color-layer.js` evaluates **`ramConditions`** and **pool / variant** recipes against **live 64 KiB WRAM** when the main app supplies it (core RAM copy or save-state extract); see `wireColorLayer`, `resolveEffectiveRamConditionsForGroup`, and `color-layer-ram.test.js`. The paint tool preview still does not simulate RAM unless we add a stub later.

### Memory analysis tool — workflow copy and Python script placement

**Problem:** “Accept & write to vbpack” sounded like it wrote to disk; it only merged `memoryAnalysis` into an **in-memory** zip. **Download this pack** still served the **original** upload. Users loaded the wrong file in the paint tool and saw “no memory analysis.”

**Changes:**

- Buttons renamed to **Apply analysis to manifest** and **Save annotated .vbpack**; explanatory copy in the UI and in [memory-analysis-tool-spec.md](../reference/memory-analysis-tool-spec.md) (two-step: apply → download annotated file → load **that** file in the painter).
- **Python analyzer** link removed from the memory-analysis page; it lives on **tools/index.html** as an optional **legacy** CLI tool; the canonical path is in-browser analysis.

### Main emulator — Export .vbpack filename

**Export .vbpack** opens a **prompt** for the download filename (Cancel = no download). Default stem comes from the **loaded ROM** basename when available, else pack `gameId`.

### Paint tool — Save .vbpack without endless duplicates (Chromium)

**Save .vbpack (no play)** uses the **File System Access API** when available: first save opens the system save dialog; later saves **overwrite the same file** without a new download. Other browsers fall back to download; status text explains. Loading a different pack clears the saved handle.

### Capture Frame dialog — remember state labels

**State** and **Sub-state** fields pre-fill from **localStorage** (last successful capture). **Datalists** suggest recent distinct values to reduce typos when capturing many frames in the same high-level state. Skip / dismiss does not overwrite memory.

### Frame dropdown labels (paint tool)

**Problem:** Dropdown showed zip leaf names (`f-….json`), which look random.

**Fix:** Labels are built from **`manifest.frameRegistry`** when present: `State – SubState – frameId` (sub omitted if empty). The **Current** snapshot row uses `Current · …`. Each row keeps **`vipFile`** (real `vipstates/…` leaf) so **Save / Save and Play** still write correct filenames; human text is display-only. Duplicate VIP paths (e.g. current + folder) are **deduped**.

### Bug fixes (this period)

| Symptom | Cause | Fix |
|--------|--------|-----|
| Wrong tiles / “stacked” sprites when **switching frames** in the painter | **Reference pattern table** was only set when `null`; after the first frame, switching frames kept **frame A’s pattern table** with **frame B’s draw list** | On every `loadFromObject`, **replace** `referencePatternTable` from the new VIP state; clear it in `showEmpty` |
| Memory analysis “not in pack” after using the tool | User downloaded **original** pack or expected Accept alone to persist | UX copy + spec: annotated pack is a **separate download** after Apply |

### Small polish

- **Favicon** (`/vbcolor.ico`) on `tools/paint.html`, `tools/memory-analysis.html`, `tools/index.html` to match the main app.

---

## Game state pools, pool-first authoring, refactors, and vbpack polish (continued March 2026)

### Schema v2: `gameStatePools` in `groups.json`

We moved toward **pools → variants → WRAM recipe**, with **groups** referencing a pool + variant instead of always duplicating `ramConditions` on each group:

- **Art pack / parser:** `groups.json` may include **`gameStatePools`** (each pool has **`variants`**; each variant owns **`ramConditions`**) and **`groupsSchemaVersion: 2`**. **`parseArtPack` / `buildArtPack`** in `src/art-pack.js` read and write these fields.
- **Runtime:** `src/color-layer.js` **`resolveEffectiveRamConditionsForGroup`** resolves gates from the variant when `statePoolId` + `stateVariantId` are valid; invalid references fail closed. **`setGroups`** accepts optional pools so the emulator does not clear pools on single-arg calls.
- **Reserved universal bucket:** Pool id **`__universal__`** / variant **`__default__`** is always **universal** (no WRAM gate). The paint tool **disables** toggling universal off and **disables Remove pool** for that bucket. **Add pool** suggests a label from the **current frame’s registry state name** (with **`01`, `02`, …** suffixes if the label collides).

### Pool-first authoring profile

- **Authoring profile** **`pool-first`** shows groups **nested under pool variants** (module `tools/paint/pool-first-ui.js`). A **universal** pool is auto-created if missing. The flat **New group** control is hidden in this profile in favor of per-variant **New group** (plus the shared global entry where still needed).
- **Pool-first UX:** Per-group tile-shape counts and clearer **Add** / **Remove** status messages when selection is empty.

### Paint tool modularization (readability)

Large, low-risk extractions from `tools/paint.js`:

- `tools/paint/pool-first-ui.js` — pool-first hierarchy rendering and universal pool seeding.
- `tools/paint/selection-box.js` — Select in box / Unselect in box / Clear selection handlers.
- `tools/paint/selection.js` — main canvas shift-click and marquee interaction wiring.

`paint.js` remains the **composition root** (state + handoff + export).

### Regression fixes (same period)

| Symptom | Cause | Fix |
|--------|--------|-----|
| Pack load in paint tool failed after first frame | `staging.js` used `stagingSelectionOverlay` undeclared in `render()` | Read overlay from `deps` inside the staging module |
| Frame dropdown lost human labels after save | Exported `manifest.json` omitted **`frameRegistry`** / **`currentVipStateRef`** | Paint export / Save / Save and Play merge those fields from last loaded manifest |
| Save and Play downloaded **`vb-paint.vbpack`** | Save-and-play used **`gameId`** for filename; **`lastExportedVbpackBaseName`** was only set on Export, not on Load | On vbpack load (and Colorize pack name handoff), set tracked base name + file handle behavior; download / optional FS overwrite use that stem |

### Save and Play + disk naming

- **Save and Play** uses **`lastExportedVbpackGameId` / `lastExportedVbpackBaseName`** (from load, export, or handoff display name) so the fallback **download** matches the pack you opened or saved.
- If the user previously used **Save .vbpack** with the File System Access API, **Save and Play** tries to **write the same handle** once before navigating (no duplicate download when that succeeds).

### Paint tool compositor parity and frame UX (March 2026)

**Frame list (.vbpack)** — After load, the canvas used **root `vipState`** but **Select frame** defaulted to the **last** `vipstates/` row, so the UI disagreed with what was painted. **Default index** now tracks the load path (**`0`** when root VIP was parsed; last folder row when only the folder fallback ran). On Linux/GTK, native **`<select>`** often shows **blank** option text; the visible control is a **button + popover listbox** (hidden `<select>` keeps value/`change` wiring). Human titles come from **`manifest.frameRegistry`**; packs without it only show file stems — **Export .vbpack / Save .vbpack / Save and Play** now merge **`vbpackManifestExtras()`** so an existing **`frameRegistry`** is **not dropped** on save. A short **hint** appears when frames exist but the registry is empty.

**View filters** — Changing **Select frame** runs **`resetWorldAndGroupViewFilters()`** ( **Show window(s)** → **All (no filter)** only, **Groups** paint target cleared) so a narrowed window multiselect or group target does not persist across frames. Toolbar **Reset view filters** does the same without switching frames.

**Groups vs canvas** — **`tryAutoSelectGroupForDraw`** was removed: clicking a tile **no longer** auto-selects a group paint target. **`getVisibleDrawIndices`** no longer uses **`selectedGroupId`** to hide other groups; the canvas follows each row’s **Show** checkbox (plus eye/layer/window). The paint target radio scopes **where group edits go**, not which draws are drawn. **None** clears the target and calls **`syncColorTargetRadios`**.

**VIP draw order in the painter** — Scene render and hit-testing use **`compareDrawCallOrderByWorld`** from **`color-layer.js`** (same ordering as **`compositeColorFrame`** with **`sortDrawsByWorld`**): higher **`world`** id drawn first (back), lower last (front). Helpers: **`collectVisibleDrawIndicesInWorldCompositeOrder`**, **`getDrawIndicesAtPixelFrontFirst`**, updated **`getDrawsAtTile`** and canvas handlers.

**Pack transparency on the paint canvas** — **`drawPackTileIntoImageData`** now takes the **16-byte VIP tile** and **skips mono palette index 0** and **pack alpha 0**, matching the emulator’s pack path in **`compositeColorFrame`** (palette 0 is a hole regardless of pack RGB).

**Staging** — **`stagingSelectionOverlay`** is read from **`deps`** in **`tools/paint/staging.js`** (fixes **`ReferenceError`** in **`render()`**).

### Painter v2 alpha (`tools/painter.html`): groups rail + emulator parity (April 2026)

Alongside legacy **paint.html**, **Painter v2** loads a **.vbpack** and composites through **`compositeColorFrame`** (WRAM off in the tool for predictable parity checks). This stretch focused on **in-memory `groups.json` authoring** and **round-tripping** on save, then **main-app color layer** wiring so authored work shows **in the emulator** when the same pack is loaded.

- **New group from selection** — Dialog: display name, BG/OBJ, memory **pool + variant** row, overlap banner (legacy groups + same pool/variant only; overlapping a *different* variant is allowed). BG rows can carry **`anchorHash`** / **`authoringKind`**. **Save .vbpack** writes **`groups.json`** fields (`groups`, **`gameStatePools`**, **`overridePresets`**, **`groupsSchemaVersion`**) as well as **`painter-v2-rules.json`**, not rules-only.
- **Rename / duplicate / delete** — **Rename** updates display **`name`** only; stable **`id`** for **`overrides.json`** `groupId`. **Duplicate** opens a second dialog and **requires a different** `statePoolId` + `stateVariantId` than the source (cannot keep the same pool row). **Delete** with confirm.
- **Save validation** — Errors block save (duplicate ids, invalid pool/variant on groups or presets, bad `criteria` typing, orphan override **`groupId`**). Warnings (vacuous criteria, painter rule keys that do not match any pool variant id) require confirm. Alerts list blocking issues.
- **Canvas strip from group** — **Filter view to group** drives the header **layer** dropdown and left **VIP world** grid from the group’s `criteria`. **Zoom to group** selects all draws matching the group (current eye) and runs the same zoom box as **Zoom to selection**.
- **Clear view filters** — Resets world filter to **All**, layer to **All**, clears tile selection; lives in the Groups rail next to **New group from selection…**.
- **Pool context + unassigned tiles** — A short **hint** under those buttons shows the **resolved** `poolId::variantId` (registry/VIP stem match, **tiles in a pooled group** when something is selected, **Painter v2 variant** only when that variant id appears on **exactly one** pool row, or a **single** pool row in the pack). **Select tiles not in any group (this pool)** selects full-frame draws (active eye) that do **not** match any group **on that resolved row** (groups on other rows or legacy/unassigned are ignored for “assigned”). Resolving the row from the **Current** frame alone remains **best-effort**; explicit metadata is **backlogged** in [painter-v2-spec.md](../design/painter-v2-spec.md) §13.
- **VIP overlay persistence** — Anchor BG paint lives in **`painter-v2-vip-overlays.json`** (full-frame RGBA per `groupId` + eye). **Load order fix:** restore overlays **after** `loadVipFromJson` (that path clears authoring so the previous mid-load restore was wiped). **Reload frame** re-applies overlay JSON from the in-memory pack.
- **Last edited frame** — **`manifest.painterV2LastVipFile`** stores the frame dropdown leaf so reopening the pack selects the same VIP snapshot; independent of **`currentVipStateRef`** / root **`vipstate-current.json`** (emulator “current” frame unchanged).
- **Emulator** — **`applyVbpackResult`** calls **`colorLayer.setPainterV2FromVbpack`**: **`compositeColorFrame`** receives **`painterV2Rules`** + **`suggestedPainterV2VariantId(gameStatePools)`**; **`blendPainterV2VipOverlaysIntoImageData`** runs per eye after composite. Standalone **.vbcolor** file load clears Painter v2 sidecars via **`setPackFromBuffer`**.

**Code:** `tools/painter.js`, `tools/painter.html`, `tools/painter/frame-registry.js`; pack I/O **`src/art-pack.js`**; overlay parse/blend **`src/painter-v2-vip-overlay.js`**; wiring **`src/color-layer.js`**, **`src/main.js`**.

---

## Reference pattern table and paint-tool baseline

To avoid editing tiles keyed off a transient or scroll-offset frame, we added a **reference (unmodified) pattern table**:

- **Main app:** When we first receive VIP state (core push) or load a vbpack, we store a **copy** of the pattern table in `referencePatternTable` and keep it separate from the live state. HBias/VBias do not modify the pattern table — they are display scroll offsets; the reference is a snapshot for stable lookups.
- **Paint tool:** We keep a reference pattern table set when state is **first loaded** (or when the user clicks “Set reference to current”). A **“Use reference pattern table”** toggle (default on) uses this reference for all tile content (hash and display), so edits apply to the baseline and the pack matches at load. With the toggle off, we use the current frame’s pattern table (e.g. for animated tiles). See [paint-tool-vip-positions.md](archive/paint-tool-vip-positions.md).

---

## Strip-clip test and graphics investigations (ongoing)

We added **strip** (0..27) to the draw list and a **“Clip color layer to strip”** debug option to test whether drawing each tile only in its strip would fix the animated-BG ghost. **Conclusion:** With strip clip ON, the result was worse (horizontal banding; tiles that span strips get cut). So strip clip is **not** a fix; leave it OFF. See [strip-clip-testing.md](archive/strip-clip-testing.md) (archived).

**Current graphics work:** BG X offset (**-4** pixels) corrects the skull position on the Mario Clash blimp in live mode; the **ghost** (double-draw, thickened outlines) remains. Leading hypothesis is **frame sync** (state may be for a different frame than the one on screen). Deduplicate-draws option did not fix it. See [graphics-next-investigations.md](../planning/graphics-next-investigations.md) for foundation, frame-sync notes, and next steps.

---

## Where colour lives: group-scoped paint, and measuring before rewriting (Sep 2026)

The intro cinematic drove this one. A solid "black-out" tile fills a dozen parallax layers and
each needs its own colour — something per-pattern paint cannot express, because colour in
`.vbcolor` is keyed by pattern hash alone and applies to every copy on every frame.

The existing answer was the **anchor**: give a BG group a tile that marks where it is, and its
paint becomes a positioned full-frame overlay. That had been built partly because whole-layer
groups were believed to be too slow — an earlier attempt at layer/world filtering had made the
intro cinematic drop frames.

**That belief turned out to be wrong, and measuring it was the turning point.** Benchmarked on
`IntroCin` frame 6 (4794 draws, 122 patterns, 12 worlds), world/layer criteria matching was the
*cheapest* strategy in the system and anchored overlays the most expensive. The old slowness
was implementation, not design: `resolveOverrideRgba` rebuilt a group `Map` per draw,
`drawMatchesGroup` ran `includes()` scans and allocated per draw, the anchor check re-hashed the
entire draw list once per group, the world-clip cache built a string key per draw in both
passes, and a coverage prepass walked all 64 cells of every draw for a count only the unpainted
fallback reads. Fixing those took the override path from **12.24 ms to 4.2 ms** a frame. The
benchmarks now live in `scripts/bench/` (`npm run bench`) with the findings in
[colorization-performance.md](../reference/colorization-performance.md), so the next "this
screen feels slow" starts from numbers.

Two more things the data settled: **occlusion culling does not pay** here (2.87× overdraw, but
a front-to-back cull with a coverage mask ties with the back-to-front write it would replace —
the mask test costs as much as the typed-array store it skips), and **anchors cannot rescue the
fill layers at all** — those worlds contain no pattern drawn exactly once, which is what an
anchored overlay requires, and an overlay is pinned to fixed screen space so it could not
survive the parallax scroll anyway.

So **group-scoped paint** ([group-tile-colors.js](../../src/group-tile-colors.js)): a group
carries its own colours in `groups.json` as `tileColors`, applied only to draws its criteria
claim. Resolution per draw is override → the draw's group → Painter v2 rules → the shared pack.
Two decisions worth remembering: **sprite patterns stay shared** (SpriteStudio's model is that
painting a pattern updates every pose using it), and **tile colours are not gated on game
state** — the Project tool stamps the active pool variant onto every new group, so gating would
have made paint vanish the moment the game left that state, including right after Save and Play.

### The inventory, and two bugs it exposed

Colour now lived in three places, and a pattern painted with no group selected could not be
cleared at all — the group panel's *Clear paint* walks a group's hash list and is blind to
anything no group names. Hence **Painted tiles…**: every colour with its swatch, where it is
stored, which groups can reach it, and how many draws use it on this frame, each row clearable.

Using it on the Safety screen immediately found two things. `EnglishSafetyText` looked
unpainted: its colour is *entirely* overlay, and overlays were only summarised, not listed. And
the measurements explained a long-standing fade complaint —

| Group | Shared pack | Anchored overlay | Faded in? |
| --- | --- | --- | --- |
| `EnglishSafetyText` | 0 of 19 patterns | 61 tile cells | no |
| `JapaneseSafetyText` | 14 of 35 patterns | 28 tile cells | the pack half did, the overlay half did not |

Painted tiles dim with `masterBrightness` inside `compositeColorFrame`, but the overlay was
blended afterwards at full brightness. That is exactly "one screen where only half of a group
fades correctly, and nothing anywhere else" — everywhere else the paint is all overlay. The
blend now takes the same `brightnessScale` the composite was given.

An overlay has no per-pattern structure, so its inventory row **expands into one row per
painted 8×8 tile**, each with its position, its group, and the pattern drawn under it. On the
Safety screen that is the 61 tiles spelling the warning text.

That seam is closed too. *Fill selection from reference* used to write to the shared pack even
on an anchored group while the brush on that same group wrote to its overlay — which is how one
group ended up split across two stores, and why its fade looked half-broken. It now follows the
brush, and on an anchored group samples **each copy where it sits** instead of averaging the
copies into one pattern; positional paint has no reason to make them agree. *Clear paint* on a
group reaches its overlay as well, which it never did.

And for art that is already painted, a shared-pack row in the inventory has a **→ *group***
button: the colour moves into the selected BG group's `tileColors`, the pattern joins that
group's criteria so the group actually claims it, and the other copies go back to unpainted.
That is the migration path for the intro cinematic's shared black-out tile.

**Code:** `src/group-tile-colors.js`, `src/paint-inventory.js`, `resolveGroupTileRgba` /
`buildGroupTileColorIndex` in `src/color-layer.js`, `overlayBrightness` in
`src/painter-v2-vip-overlay.js`, the paint routing and Painted tiles panel in
`tools/painter.js`, matching routing in `tools/shared/pack-session.js` + `tools/sprite-studio.js`.

---

## Where things stand

- **Working:** Monochrome and Palette (with preserveDrawingBuffer); Color mode and tools when using a patched core; Save VIP state with optional screenshot; frame viewer (Render / Screenshot / Overlay, transforms, crop/clear, Black BG, Transparent 0, Eye, Export PNG / Copy image); tile extractor; **vbpack** load/export with **multi-frame** `vipstates/` + `savestates/`, **groups.json** (groups + override presets + **`gameStatePools`** schema v2), and **manifest** fields including **`frameRegistry`** / **`currentVipStateRef`** (preserved on paint save). **Position overrides** and **group overrides** (`groupId`, optional **group-scoped cell rects**); **live WRAM** gating in `color-layer.js` when the main app supplies CPU WRAM (core or save-state path). **Colorize! → Painter → Save and Play** with IndexedDB handoff; **Save and Play** / download naming tracks **last loaded or exported** pack stem and may **overwrite** the last **Save .vbpack** file handle in Chromium. **Painter (v1):** authoring profiles (including **pool-first**: pools/variants/groups hierarchy); **per-group Show** controls canvas visibility; **paint target** scopes group edits without hiding other groups; **frame** picker aligned with loaded VIP + custom list UI + **`frameRegistry`** round-trip on export; **VIP world draw order** and **pack mono-0 holes** match **`compositeColorFrame`**; view-filter reset on frame change / button; selection (shift-click, marquee + Select in box); staging canvas size parity with main scene; modular helpers `pool-first-ui.js`, `selection-box.js`, `selection.js`. **Painter v2 alpha (`tools/painter.html`):** groups rail (new/rename/duplicate/delete, save validation, filter/zoom/clear strip, pool-hint + select unassigned-in-pool tiles), **`painter-v2-rules.json`** + **`painter-v2-vip-overlays.json`** + **`manifest.painterV2LastVipFile`** on save; **main emulator** applies the same **`painterV2Rules`** path and **VIP overlay blend** when a vbpack is loaded so authored color shows **in play** (macros in rules remain future work). **Main app** “Loaded” labels; **memory analysis** in-browser workflow. See [art-pack-file-format.md](../reference/art-pack-file-format.md) § game-state pools and [paint-tool-game-state-pools-ux-plan.md](archive/paint-tool-game-state-pools-ux-plan.md) for product origin.
- **Validated:** VIP rendering order and core hook points ([vip-rendering-validated.md](../reference/vip-rendering-validated.md)); vbstate format and draw list shape. Core→canvas path traced: draw list Y matches display Y; draw density and Y step match (one draw per tile, pixels). See [sprite-alignment-investigation.md](archive/sprite-alignment-investigation.md).
- **Backlog / not yet built:** **Override / groups panel polish** (in-place list/edit, clearer Copy pack colors vs cell overrides, override ordering when rects overlap). **Undo for group delete** (optional). **Paint tool:** live **WRAM preview** for gated overrides (optional); **keyboard shortcuts** for selection (parked until UX settles). **Sprite overlap preview** polish. **Sprite-first workflow** staging v1 done; tighter 8×8 pick and edge cases remain. **Graphics investigations:** fading/brightness, animated BG artifacting, affine — [graphics-next-investigations.md](../planning/graphics-next-investigations.md). **Later:** wider tile palette; pack cleanup; ship-readiness; stereo viewer — [phase2-and-next-detailed-plan.md](archive/phase2-and-next-detailed-plan.md).

---

## References

**Full doc index (current + archived):** [README.md](../README.md).

**Current:** [art-pipeline.md](../reference/art-pipeline.md), [current-state-and-next-steps.md](archive/current-state-and-next-steps.md), [art-pack-file-format.md](../reference/art-pack-file-format.md), [paint-tool-game-state-pools-ux-plan.md](archive/paint-tool-game-state-pools-ux-plan.md), [color-pack-overrides-design.md](../design/color-pack-overrides-design.md), [paint-tool-overrides-flow.md](archive/paint-tool-overrides-flow.md), [paint-tool-vip-positions.md](archive/paint-tool-vip-positions.md), [colorize-workflow-vision.md](../design/colorize-workflow-vision.md), [graphics-next-investigations.md](../planning/graphics-next-investigations.md), [override-panel-design.md](archive/override-panel-design.md), [group-override-design.md](../design/group-override-design.md), [paint-tool-group-work-breakdown.md](archive/paint-tool-group-work-breakdown.md), [game-memory-locations.md](../reference/game-memory-locations.md), [core-build-phase0-phase1-runbook.md](../core/core-build-phase0-phase1-runbook.md), [core-patch-proposal.md](../core/core-patch-proposal.md), [vip-rendering-validated.md](../reference/vip-rendering-validated.md), [rollback-palette.md](../reference/rollback-palette.md).

**Archived (kept for development history):** [phase1-readiness-risks-debugging.md](archive/phase1-readiness-risks-debugging.md), [palette-mode-bug-investigation.md](archive/palette-mode-bug-investigation.md), [sprite-alignment-investigation.md](archive/sprite-alignment-investigation.md), [title-screen-background-plan.md](archive/title-screen-background-plan.md), [colorize-workflow-execution-plan.md](archive/colorize-workflow-execution-plan.md), [strip-clip-testing.md](archive/strip-clip-testing.md), [paint-on-game-editor-design.md](archive/paint-on-game-editor-design.md), [paint-editor-use-cases.md](archive/paint-editor-use-cases.md). See [docs/README.md](../README.md) for the current index.

