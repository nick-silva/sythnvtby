# Sprite / tile alignment investigation

**Status: Archived.** Alignment issues were resolved (eye tag, 2bpp packed decode, GPLT/captured palettes). Technical content (VIP path, draw density) is still referenced. Kept for development archive. See [README.md](../../README.md) and [development-journey.md](../development-journey.md).

---

This doc captures observed misalignment between our **re-render** (from vbstate draw list + pattern table) and the **reference screenshot** (actual emulator frame at capture time), and how we're tackling it.

---

## Observed symptoms (Mario Clash title screen)

- **Green at top:** The top of our render is filled with green above the title; the reference has black there. So we're either drawing tiles we shouldn't, or we're drawing “background” tiles that the game shows as black but we render with a visible shade.
- **Title (MARIOCLASH):** Roughly in the right place but offset slightly **to the right**. The 8×8 tiles don’t line up with each other — “garbled” (wrong alignment between tiles).
- **Title vertically stretched:** The title sprite region is ~20–25% **taller** than in the reference.
- **PUSH START BUTTON:** Offset **left** (at least as much as the title is right) and **down**, and also vertically stretched. Tiles again not aligned (garbled).
- **Copyright text:** Garbled and offset **lower** than in the reference.

So we see:

- **Not a single global offset:** X offset differs by region (title right, PUSH START left).
- **Vertical stretch:** Content is taller than it should be.
- **Garbled tiles:** 8×8 cells don’t align with each other (wrong relative positions or wrong tile/flip data).
- **Extra content at top:** Something we draw as visible (green) should be black or not drawn.

---

## What we know about the pipeline

1. **Draw list source:** The patched Beetle VB core builds a draw list in `vip_draw.inc` / `vip.c`. For each tile drawn it pushes `{ tileIndex, x, y, flipH, flipV }` (and optionally world). Coordinates are intended to be **screen-space** (384×224):
   - **DrawBG:** Pushes at tile top-left when `char_sub_y == 0` and tile X aligned; `y0 = RealY - vflip_xor`, `x` = column (see `vip_draw.inc` ~80–82, 230–234).
   - **DrawOBJ:** Pushes when `tile_y == 0`; position from OAM `(jx ± jp, jy)` (left eye: `jx - jp`, `jy`) (see ~336–344).
   - **DrawAffine:** Same idea: screen-space `(x0, y0)` at tile top-left.

2. **Viewer:** We iterate the draw list in order and draw each tile at `(call.x + offsetX, call.y + offsetY)` with 8×8 size and flips. We use the same 2bpp decode and palette as elsewhere (see `tools/viewer.js`, `src/vb-2bpp.js`).

3. **Reference screenshot:** Captured from the emulator canvas at “Save VIP state” time — same frame as the draw list. So in principle the draw list should describe exactly what’s on screen.

---


## Screenshot capture vs re-render (why the reference may not fill the canvas)

When the user clicks "Save VIP state," we capture the screenshot by taking whatever canvas `getEmulatorCanvas()` returns (the emulator's display canvas) and calling `drawImage(emuCanvas, 0, 0, 384, 224)` into a 384×224 canvas. So the reference is "whatever is on the emulator's display," scaled to 384×224.

If the emulator uses a canvas **larger** than 384×224 and draws the frame **centered with black bars** (e.g. to preserve aspect ratio), the captured image includes those borders; after scaling to 384×224, the game content occupies only a **central rectangle** (letterboxed). Our **re-render** draws the draw list into a **full** 384×224 canvas with no letterboxing, so it fills the frame and can look wider or "better."

**Conclusion:** Some of the perceived "resizing" or aspect-ratio difference between reference (e.g. red) and our render (e.g. green) can be due to **how the screenshot is captured**, not a bug in the draw list or our render. At capture time we now log the emulator canvas size (e.g. "Emulator canvas was 512 × 384") so you can confirm when letterboxing is present.

## How the core and EmulatorJS render VIP to the canvas (traced)

Summary of how the core draws and where the draw list is pushed (see `vip_draw.inc`, `vip.c`):

- **VIP_DrawBlock:** For each strip (block 0..27), draws 8 rows into strip buffers. **RealY = block_no*8 + y** (0..223). **VB_DL_Push** uses the same Y: for BG `y0 = RealY - vflip_xor`, for OBJ `y0 = jy`. So the Y we push is the **same** scanline space as the pixel write.
- **Strip → FB:** Strip is packed into `FB[DrawingFB][lr]` with 1:1 mapping (strip row → FB line).
- **FB → surface:** At frame end the whole FB is copied to `surface->pixels`. No Y offset or scale; line 0 → line 0.
- **Geometry:** DisplayRect is 384×224 (or 768×224 etc.). Frontend allocates the same size.

**Conclusion:** Draw list Y and emulator display Y are in the **same coordinate system**. The miscalculation is **not** "core draws at a different Y than it pushes."

**Where the mismatch could still be:** (1) **DisplayActive** (DPCTRL bit 1): when false, the copy writes black. So the visible region might not start at line 0; we still push all draws, so we draw at Y 0..47 that the emulator may show as black → explains top green bar. (2) **Reference screenshot** might be scaled/cropped. (3) **Stretch** could be duplicate draws or wrong Y step (e.g. draw density per band). Next: check DisplayActive / first visible line; confirm screenshot is raw 384×224; check draws per 8-line band.

### Draw density and Y step: app vs core

**Our application** does not implement any separate "draw density" or "Y step" logic. One draw = one 8×8 tile at pixel (call.x, call.y).

- **tools/viewer.js:** `dy = call.y + offsetY`; then `drawTileIntoImageData(..., dx, dy, ...)`. One draw → one 8×8. No scaling or duplicate/skip.
- **src/color-layer.js:** `y0 = call.y`; for py 0..7 we write at `iy = y0 + py`. One draw → one 8×8 at (x0, y0).
- **src/vb-2bpp.js:** `drawTileIntoImageData(imageData, x0, y0, ...)` draws exactly 8×8 at (x0, y0). Tile size is fixed (8).

So we assume **call.y = pixel Y of the top of the tile** (0..223) and we draw 8 rows. We never scale Y or interpret it as row index.

**Core** produces one push per tile: DrawBG/DrawAffine push when `char_sub_y == 0` (and tile X aligned), with `y0 = RealY - vflip_xor` (RealY = scanline 0..223). DrawOBJ pushes when `tile_y == 0` with `jy` (OAM Y). So the core also: one push per tile, Y in pixels. Same unit and density.

**Comparison:** Density and Y step match: one draw per tile, Y in pixels. We have no code that changes them. So vertical stretch would have to come from (a) the list having more draws per band than the core drew, or (b) the reference being scaled, or (c) a core bug (e.g. draws fewer pixels than it pushes).

### Observed Y scale ~0.78 and artifacts

With the viewer’s **Scale Y** at **0.78**, the render lines up with the reference **very closely** (but not perfectly). That gives a concrete number: our content is effectively ~1/0.78 ≈ **28% too tall** relative to the reference, so a Y scale of 0.78 corrects the vertical stretch.

**Why 0.78 helps:** It suggests either (a) we have ~28% too many vertical samples (e.g. duplicate or extra rows in the draw list for some bands), or (b) the reference display/capture uses a different vertical density. Either way, applying that scale in the viewer is a valid pragmatic fix.

**Vertical-line artifact:** When we scale each tile from 8×8 to 8×(8×0.78) ≈ 8×6 with **nearest-neighbor**, we map 8 source rows to 6 dest rows, so some source rows are skipped or merged. That can make **vertical lines** (thin columns of pixels) break or disappear. So per-tile nearest-neighbor scale-down hurts line rendering. Options: use a **box filter** (average source region per dest pixel) when scaling down so vertical continuity is preserved, or draw at 8×8 and apply a single canvas Y-scale so the browser does one consistent resample.

**Top block:** Scale does **not** remove the unwanted green band at the top. Use **Crop top** (skip draws with `y < N`), **Black BG** (palette 0 → black), or **Clear top** (after drawing, fill the top N pixels with black) to hide it.

**Next step (user):** Capture a **new vbstate from a different screen** (not Mario Clash title) and compare: Does the top block appear? Same height? Does Scale Y ≈ 0.78 still improve alignment? That will show whether the distortion and top band are frame-specific or consistent across the game.

---

## Different screen: intro scene (before title)

A second vbstate was captured from an **intro screen** (blimp over clouds, before the Mario Clash title). Comparison:

| Observation | Game screenshot (in vbstate) | Our render |
|-------------|------------------------------|------------|
| **Top block** | **None** — content goes to the top edge. | No top bar on this screen. So the top block is **scene-specific** (title screen has it; intro doesn’t). |
| **Sides** | Content extends to left/right edges; no black bars. | **Green bars on left and right** — we draw (or show) content in regions where the game has black. So the game may use a **narrower visible viewport** on this scene, or the screenshot is cropped; we draw full 384 px. |
| **Y scale** | — | Scale Y **0.78** still fits well → **global** vertical scale issue, not scene-specific. |
| **Bottom (cloud layers)** | Layered clouds, parallax. | Sprites “not looking right”; likely **multiple draw layers** and/or **transparency**. |
| **Reach/crop** | — | Our render “reaches out” a bit left/right under where the side bars are → suggests **viewport/crop**: we’re drawing a wider (or different) region than the game displays. |

### Transparency / alpha

The **core only writes a pixel when the 2bpp value is non-zero**: `if(pixel) target[x] = GPLT_...` (DrawBG, DrawAffine) and the same in DrawOBJ. So **palette index 0 is effectively transparent** on the VB: it does not overwrite the framebuffer, so lower layers or the cleared background show through.

In our viewer we draw **all** four palette levels as opaque (we fill every pixel of every tile). So we do **not** honor transparency: index 0 is drawn as a visible color (e.g. black or dark green), and overlapping layers overwrite each other instead of letting index‑0 pixels “show through.” That can make **layered sprites** (e.g. cloud layers) look wrong — solid where they should blend. So **yes, we should consider transparency**: for a correct re-render, **skip writing** pixels where the tile’s palette index is 0 (leave the buffer unchanged there). That matches the core and would fix layered/overlapping sprites. A viewer option “Skip palette 0 (transparent)” would allow toggling this.

### Viewport / side bars

The **green side bars** on this screen suggest we’re drawing content in columns that the game does not show (or shows as black). So either:

- The game (or VIP) uses a **display window** with a narrower width (e.g. visible area inset from 0 and 384), or  
- The saved screenshot is **cropped** to that visible area.

Adding **Clear left** / **Clear right** (like Clear top) in the viewer would let you black out the side bands for comparison. A root fix would be to derive the visible rect from VIP state (e.g. window registers) if the hardware defines it.

### What we learn

1. **Top block is scene-specific** — Not a global “we always draw 48 px at top”; varies by screen.  
2. **Y scale 0.78 is consistent** — Same scale on two different screens → global vertical distortion.  
3. **Transparency matters** — Core treats palette 0 as transparent; we don't; that can break layered sprites. Enabling **Transparent 0** in the viewer fixes a lot (intro, first level) and sharpens sprites; on the title screen the green box behind the title can appear larger because we show the true extent of the panel layer's non-zero pixels instead of painting index 0 everywhere.  
4. **Viewport/crop is not universal** — Side bars on intro; first level needs Clear left/right = 0. Clear/crop values are per-scene.  
5. **Layer (BG vs OBJ)** — To see whether the block behind the title is background tiles or sprites: the core now tags each draw with **layer** (0 = BG, 1 = Affine, 2 = OBJ). Rebuild the core, capture a new vbstate from the title screen, then in the viewer use **Layer: OBJ (sprites)** or **Layer: BG (tiles)** to show only one type; click the green panel to see its `layerName` in the console. Log draw list summary includes `layerCounts` (BG, Affine, OBJ). Old vbstate files don’t have layer; use Layer: All for those.

---

## Solution: green block / "black background" (captured palettes)

The **green bar at the top** and the **block that should be black** on the title screen were not a transparency bug — **index 0 is transparent** in every palette and we already honor that with **Transparent 0**. The issue was **which RGB colors** we used for each of the VB's **four palette selectors** (GPLT 0–3).

- The VB has **four** 4-color palettes (GPLT 0–3). Each tile chooses one via a 2-bit **palette selector** in the tile map (`bgsc >> 14`). We were using a **single** preset and four ramps (dark→bright) for all selectors, so e.g. "palette 2" was always 0.85× green. On the real game, the title screen sets **GPLT 2** so its four entries are black/dark — so tiles with palette selector 2 (e.g. the top block) should look black. We drew them green.

**Fix (implemented):**

1. **Per-tile palette selector** — The core already had `palette_selector` at draw time; we added it to the draw list as `paletteSelector` (0–3) and the viewer uses it to pick which of four 4-color sets to use per draw. Serialize/deserialize in `vip-dump.js` include `paletteSelector` so saved vbstates keep it.
2. **Captured GPLT + master colors** — The VIP state push now exports **GPLT** (4 × uint16) and **BrightCLUT[0]** (the 4 master RGB colors) from the core. The viewer uses them when present: each palette selector 0–3 gets its four colors from the GPLT remap into the master table, so the re-render matches the game's palettes on **any** screen. Legacy vbstates (or captures without these fields) still use the preset ramps; the debug toggle "Palette 2 = black" was a temporary workaround until captures include real palettes.

**Result:** New VIP captures include `gplt` and `masterColors`. The viewer shows "palette: captured (GPLT)" and the title-screen block (and any other palette-2 region the game draws as black) renders correctly without manual toggles. See [title-screen-background-plan.md](title-screen-background-plan.md) for terminology and plan details.

---

## Working hypotheses

1. **Coordinate space / origin**
   - Core might emit coordinates in a space we’re not handling (e.g. strip-relative X, or origin not at (0,0)).
   - Different **worlds** (background vs object) might use different coordinate systems or offsets; that could explain title (one world) shifted right and PUSH START (another world) shifted left.

2. **Y scaling or duplication**
   - If Y were in different units (e.g. half-pixels) or we doubled rows somehow, we’d see vertical stretch.
   - Or the core could be emitting duplicate draws at different Y for the same logical row.

3. **X varying by Y or by world**
   - Parallax or per-world X offset could shift BG vs OBJ differently (e.g. we always use “left eye” position; screenshot might be blended or different).

4. **"Green at top"** — **Resolved.** Tiles in the top region use a palette selector (e.g. 2) that the game sets to black via GPLT; we were rendering that palette as a green ramp. Fix: capture GPLT + master colors in the VIP state and use them in the viewer (§ Solution: green block / "black background").

5. **Garbled 8×8 alignment**
   - Wrong (x,y) per draw (e.g. off-by-one, or strip-relative vs screen).
   - Wrong tile index or flip for a cell.
   - Draw order vs. overlap (unlikely to cause “stretch,” but can cause visual mess).

---

## How we’re tackling it

### 1. Use the viewer’s debug tools

- **Load** the Mario Clash vbstate (with screenshot) in `tools/viewer.html`.
- **“Log draw list summary”** — logs `drawCount`, bounds `(minX, minY, maxX, maxY)`, and first/last draws. Check:
  - Does `minY` start at 0 or negative? Does `maxY` exceed 224?
  - Do X values look sane (0–384)?
- **“Log draw list summary”** — also logs **bandsByY**: for each 8-row vertical band (Y 0–7, 8–15, …), the count of draws and min/max X. That shows whether X offset or density varies by vertical band (would support “different offset per region”).
- **Click on the canvas** — logs which draw(s) are under that pixel (back-to-front) and highlights the topmost. Use this to see which tile the viewer thinks is at a given spot vs. what you see in the screenshot.

### 2. Inspect the draw list for this frame

- Open the vbstate in a text editor or script: look at a few `drawList` entries for Y ≈ 0 (top), Y ≈ 40–80 (title), Y ≈ 100–120 (PUSH START), Y ≈ 200 (copyright).
- Check if Y values are strictly 0, 8, 16, … (one per tile row) or if there are duplicates or fractional spacing.
- Check if X values for the title band vs. PUSH START band suggest a per-band X offset.

### 3. Compare one tile to the reference

- Pick one draw (e.g. one tile of the “M” in MARIOCLASH). Note its `tileIndex`, `x`, `y`, `flipH`, `flipV`.
- In the reference screenshot, find the same 8×8 block. Does (x, y) put our tile exactly on top of that block? If not, by how many pixels (and is that consistent with “title shifted right” or “stretched”)?

### 4. Core-side checks (if needed)

- In `vip_draw.inc`, confirm that **every** push uses the same coordinate space (full screen 0–383, 0–223).
- Confirm **DrawOBJ** uses the same left/right eye convention as the screenshot (e.g. we always push left-eye position; if the screenshot is right eye or blended, we’d see an X shift).
- Check for any **display border** or viewport offset in the core that we don’t add when building the draw list.

### 5. Optional: world/layer tagging

- If the core exposed **world** (or layer) per draw, we could:
  - Log “world” in the summary and per-band stats.
  - Test “apply different offset per world” in the viewer to see if that fixes the non-uniform X.

---

## Primary hypothesis: offset and stretch scale with distance from center

The most useful clue is **vertical offset and stretch that increase with distance from the screen center** (up above center, down below center). That pattern suggests a **single systematic cause** (wrong Y origin, wrong vertical scale, or wrong coordinate space), not per-region hacks. Fixing that mapping should fix the whole screen and likely explains the top green block too (we’re drawing “above” the visible view because our Y origin or scale is wrong).

So we **gather data** to test whether alignment offset is linear in “distance from center” (or in raw draw Y). If `offset_Y ≈ k * (draw_y - 112)` (screen center Y = 112 for 224 px height), we have a clear fix: adjust origin and/or scale in the core or viewer.

---

## Data gathering: steps and table

Use the viewer with the **same vbstate and same eye** as your reference screenshot (e.g. Mario Clash title, Left eye). Goal: for several vertical bands, record **draw Y** and the **manual offset Y** that best aligns that band with the reference. Then check if offset is linear in distance from center.

### Step 1: Load and set up

1. Load the vbstate (e.g. Mario Clash title screen) in `tools/viewer.html`.
2. Set **Eye** to match the reference (usually **Left**).
3. Set **View** to **Overlay** so you can compare render vs screenshot.
4. Optional: set **Black BG** and/or **Crop top** to reduce distraction; for data gathering you’re measuring “what offset would fix this band,” so keep crop minimal (0) if you want full-screen data.

### Step 2: Get representative draw Y per band

For each band below, either:

- **A) Click a tile** in that band on the canvas. The console will log the draw’s `y` and `distanceFromCenterY` (draw.y - 112). Use that draw’s `y` as the representative Y for the band.  
- **B) Use “Log alignment sample”** in the viewer. It prints a table of bands with a **Representative Y** (median draw Y in that band) and **Distance from center**. Copy that table for the next step.

Bands to use (adjust names if your frame differs):

| Band name   | Y range (draw list) | Use for |
|------------|----------------------|---------|
| Top bar    | 0–39                 | Top green block / top of screen |
| Title      | 40–79                | “MARIO CLASH” |
| PUSH START | 80–119               | “PUSH START BUTTON” |
| Middle     | 120–159              | Between PUSH START and copyright |
| Copyright  | 160–224              | “©1995 Nintendo” |

### Step 3: Measure best offset Y per band

For each band:

1. Set **Offset Y** to 0.
2. Change **Offset Y** (negative = our render moves up, positive = down) until that band **best aligns** with the reference in Overlay mode. If it never lines up perfectly (e.g. copyright at -16, -17, -18), record the best integer and note “non-integer” or “scale mismatch” in Notes.
3. Record the **Offset Y** value in the table (e.g. +9 for title, -10 for PUSH START, -17 for copyright).

### Step 4: Fill the evidence table

Paste or build a table with these columns. “Representative Y” and “Distance from center” come from Step 2; “Best offset Y (manual)” from Step 3.

### Collected data (Mario Clash title, left eye)

| Band       | Representative Y | Distance from center (Y−112) | Best offset Y (manual) | Notes |
|------------|------------------|------------------------------|-------------------------|-------|
| Top bar    | 16               | -96                          | —                       | Should not be there; not an offset fix — either don’t draw or wrong content. |
| Title      | 56               | -56                          | ~+10 (varies)            | **Offset varies with vertical position within title:** top row of title ~+14, bottom row ~+4. Title ~6–7 tiles tall (~50 px) → stretch across that distance. |
| PUSH START | 96               | -16                          | -10                     | Not a perfect match; fractional pixels at play; region is 2 tiles high (~16 px). |
| Middle     | 136              | 24                           | (not reported)          | — |
| Copyright  | 184              | 72                           | -16 (closest)           | Single tile high (~8 px) — should be easiest to match exactly, but no integer offset gives a perfect fit. |

**Insights:**

- **Gradient within title:** Offset changes from ~+14 (top of title) to ~+4 (bottom of title) over ~50 px. That’s strong evidence the offset is **linear in Y** (or in distance from center) within that band; a single “band offset” can’t fix the whole title.
- **Stretch:** The title is ~6–7 tiles tall in our render but should match a fixed height in the reference → vertical scale or row density is wrong (we’re drawing too many rows or Y step is wrong).
- **Non-integer / fractional:** PUSH START and copyright don’t align perfectly at any integer offset → suggests either sub-pixel offset, wrong vertical scale (row height), or different coordinate origin (e.g. half-pixel).

### Step 5: Check for a linear relationship

- Plot or eyeball: **Best offset Y** vs **Distance from center**. If the points lie roughly on a line, then `offset_Y ≈ k * (draw_y - 112) + b`. That implies a **wrong origin** (b) and/or **wrong scale** (k) in our Y mapping.
- The **title gradient** (top +14, bottom +4 over ~50 px) already shows offset changing linearly with Y within one band; the next step is to see if the same linear relationship fits PUSH START (-10), copyright (-16), and Middle. If yes, one formula fixes the whole screen; if not, we may need per-layer (BG vs OBJ) Y.
- If **k** is negative: our content is “stretched” in the sense that we need to move top content down and bottom content up (or vice versa) — consistent with a scale error.
- If **k** is positive: different interpretation (e.g. we’re drawing in a flipped or shifted space). Either way, one formula should fix the whole screen.

### Step 6: Optional — vertical stretch by band

If you see obvious **stretch** (our tiles taller than reference) in some bands, note it in the table (e.g. “Title ~20% taller”). That may correlate with the same scale/origin bug (e.g. duplicate rows or wrong Y step in the core for certain bands).

### Step 7: Use the result

- If **linear:** Implement in viewer or core: `y_display = y_raw * scale + origin` (or equivalent) so one set of parameters fixes all bands. Then re-test; top green block may disappear or move into place.
- If **not linear:** Re-check that the reference screenshot and draw list are the same frame and same eye; then consider per-layer or per-world Y (e.g. OBJ vs BG different).

---

## What to look at next

Based on the collected data, these are the most useful next checks:

1. **Title gradient — measure slope:** In the viewer, click one tile on the **top row** of “MARIO CLASH” and note its `y` (e.g. 40–48). Click one tile on the **bottom row** and note its `y` (e.g. 80–88). Record the two (y, offset) pairs: (y_top, +14) and (y_bottom, +4). Then **slope = (4 - 14) / (y_bottom - y_top)**. If that slope is consistent with the same formula for PUSH START and copyright (e.g. offset = k*(y - 112) + b), we have one global linear model; if not, we may have per-layer (BG vs OBJ) Y.

2. **Core: where does Y come from?** In `vip_draw.inc` (or equivalent), for **DrawBG** and **DrawOBJ**, find exactly which register or variable is used for the **Y** we push. Is it “scanline” / “row” in 8-pixel units, or pixel Y, or something else? If the VB uses “row index” (0–27) and we’re treating it as pixels (0–224), we’d see exactly this kind of stretch and gradient.

3. **Core: Y step and origin:** Check whether the core pushes **one draw per 8-pixel row** or **two per row** (e.g. for 224 lines, 28 rows vs 56). If we’re doubling rows somewhere, that would stretch the image vertically. Also check if there’s a **display origin** or **viewport Y** (e.g. first visible line) that we’re not adding; that could explain the top bar (we draw from 0, hardware shows from 48).

4. **Middle band:** If you have time, repeat the alignment test for the **Middle** band (Y 120–159). That gives a fifth point to see if offset vs Y is linear across the full screen or if there’s a kink (e.g. different above/below center).

5. **Top bar content:** In the viewer, with **Log draw list summary**, check **bandsByY** for y0 0–7, 8–15, 16–23, 24–31, 32–39. Are those the same “background” tile repeated? If you click one of those top tiles, what is its **tileIndex**? In the reference screenshot, is that region actually black (palette 0) or is the game’s framebuffer simply not drawing there (viewport/clipping)? That tells us whether the fix is “don’t draw above Y=X” or “draw but use black for palette 0”.

If you can report (1) the two title (y, offset) points, (2) what the core uses for Y in DrawBG/DrawOBJ (name of variable and whether it’s row vs pixel), and (3) whether the top-band draws are one repeated tile and what the ref shows there, we can narrow down the exact fix.

---

## Next steps (concrete)

1. **Run “Log draw list summary”** (and band summary if present) on the Mario Clash title vbstate and paste the result into this doc or a follow-up — that gives baseline stats.
2. **Gather alignment data** using the steps and table above; paste the filled table into this doc.
3. **Decide fix location:** If offset is linear in distance-from-center → add a single Y transform (origin + scale) in the viewer or core. If it’s a constant offset per world → per-world offset. If it’s a core coordinate bug → fix the core’s push.
4. **Document the fix** here (and in [vip-rendering-validated.md](../../reference/vip-rendering-validated.md) if we change core behavior).

---

## Sample log analysis (Mario Clash title, frame 958)

From “Log draw list summary” for the **left eye** (vbstate with eye-tagged draws):

- **bounds:** `minX: 2`, `minY: 0`, `maxX: 390`, `maxY: 192`. So X spans 2–390 (2 px inset left; right edge extends to 390, i.e. 6 px past 384). Y spans 0–192 (last tile row ends at 184+8); no draws below that (nominal display height 224).
- **bandsByY:** 22 bands. For y0 0–40 and 112–184: **95 draws per band**, minX 2, maxX 390 (or 386 for last band). For y0 **48–104**: **190 draws per band** — exactly double. That band range is the title + “PUSH START” region, so the middle of the frame has two layers (e.g. BG + OBJ) contributing; elsewhere we see one layer. X range is consistent across bands (no per-band X shift in the data).
- **eyeCounts: left 1413, right 1437.** So the right eye has 24 more draws than the left. That’s expected: **per-eye visibility**. Sprites (OBJ) have a “visible to left/right” flag (`jlron[lr]`); we only push a draw when the tile is visible for that eye. So some objects are drawn only for one eye, giving different totals. Not a bug.

**Next:** Use the viewer at **2× display size** (frame is shown at 768×448) to click a “PUSH START” tile and compare its reported (x, y) to the reference screenshot.

### Observed vertical offsets and top bar (Mario Clash, after 2bpp fix)

- **Top green bar:** A solid block of green at the top (~48 px tall) appears in our render; the reference has black there. Likely we’re drawing background tiles that the game uses as “black” (palette level 0) but we render as the preset’s darkest color (e.g. dark green). **Workarounds in viewer:** (1) **Black BG** — render palette level 0 as black so those tiles match the screenshot. (2) **Crop top** — skip drawing tiles with `y < N` (e.g. 48) so that band is black. Offset Y was expanded to ±64 so you can use e.g. -48 to scroll the bar off.
- **PUSH START:** Best alignment at about **-10 Y** offset (move our render up 10 px). A single global offset doesn’t fix the whole screen.
- **Copyright text:** Closer to **-17 Y**, but -16, -17, -18 don’t perfectly cover the reference — suggests a **non-integer** vertical offset or a **vertical scale** (row height) mismatch, not just a whole-pixel shift.
- **Mario Clash title:** Closest at **+9 Y** but still misaligned; clearly **stretched vertically** (our draw list may have different Y density or duplicate rows for that region). Per-region or per-band Y offsets and/or a core-side Y/scale fix are still open.

### 2bpp decode fix (smeared/wrong pixels inside each 8×8)

The 8×8 tiles were rendering with pixels “smeared” or wrong inside the block because our **decode** didn’t match the VB core. The core treats each row as one **uint16** and uses **packed** layout: `pixel_col = (word >> (col*2)) & 3` (bits 0,1 = column 0, bits 2,3 = column 1, …). We had implemented **planar** layout (two bitplanes, MSB-first), which produced a horizontally mirrored/wrong image. Fixed in `src/vb-2bpp.js`: `decodeTile()` now builds the 16-bit word per row and uses `(word >> (col*2)) & 3` for each column. Each draw is still one **8×8** tile; the fix only corrects how we interpret the 16 bytes. **Note:** Tile content hashes will change, so existing .vbcolor packs keyed by the old hash may not match; re-extract and re-author if needed.

---

## vbstate and the 3D / stereo draw list

**Is vbstate exactly what drives the sprites and enough for our render?**  
The vbstate contains the real VIP data (pattern table, OAM, segments, windows) and the draw list is built from the same code path that draws the framebuffer. So the **data** is authoritative. The problem is **how** that list is exported:

- **We’re not rendering “one eye” — we’re rendering both overlaid.**  
  The VIP draws **two** framebuffers per frame (left and right). Parallax (world `gp`/`mp`, sprite `jp`) shifts X (and sometimes source) per eye. In the core:
  - **DrawBG** is called once per eye (`lr = 0` then `lr = 1`) per tile; each call pushes one `(x, y)` into the same list. So **background tiles are pushed twice** (left X and right X).
  - **DrawAffine** is the same: two pushes per tile (left and right).
  - **DrawOBJ** deliberately pushes **once** per sprite using the **left-eye** position only (`x0 = jx - jp`, comment: “Use left eye (lr=0) position for now”).

So the exported draw list is a **mix of left- and right-eye draws**: every BG and Affine tile appears twice (at different X), and every sprite once (left). When we re-render the whole list on one 384×224 canvas, we draw both eyes on top of each other. That can explain ghosting, “garbled” tiles, non-uniform X (different parallax per layer), and a “stretched” or doubled look.

**Is there “magic” (depth/3D math) in draw order?**  
The only 3D effect is **parallax**: same tile at different X per eye. Draw **order** is strip → world 31→0 → within world (same as hardware); there’s no extra depth math. The bug is **mixing both eyes in one list** and not tagging which draw is for which eye. So:

1. **Confidence:** vbstate is what the core used to draw, but the **current** draw list is not “one eye” — it’s both eyes merged, so a single-canvas re-render will not match a single-eye screenshot.
2. **Fix direction:** Either (a) **tag each draw with eye** (0 = left, 1 = right) in the core and filter to one eye in the viewer / runtime, or (b) only push draws for one eye in the core (e.g. only push when `lr == 0`). Then our render and a single-eye screenshot (or one side of side‑by‑side) can match.

**Screenshot vs draw list:** The reference screenshot comes from `getEmulatorCanvas()` — i.e. whatever the app is displaying (left, right, side‑by‑side, or anaglyph). So the reference might be one eye or a composite. For alignment we should either capture one eye only and export the draw list for that same eye, or tag draws by eye and filter.

---

## References

- [vip-rendering-validated.md](../../reference/vip-rendering-validated.md) — VIP strip/world order and where we hook the draw list.
- [core-patch-proposal.md](../../core/core-patch-proposal.md) — How the core pushes VIP state and draw list.
- `core-build/beetle_vb/mednafen/vb/vip_draw.inc` — `VB_DL_Push` calls in DrawBG, DrawAffine, DrawOBJ.
- `tools/viewer.js` — Re-render loop and debug (“Log draw list summary”, click-to-inspect).
