# Title screen background investigation plan

**Status: Archived.** GPLT / captured palette fix was implemented. Kept for development archive. See [README.md](../../README.md) and [development-journey.md](../development-journey.md).

---

## Terminology (screen vs what renders)

- **Screen position / pixel (x, y)** — A point on the canvas in display coordinates (e.g. 384×224). Where you click.
- **Draw** — A single entry in the draw list: one 8×8 **tile instance** placed at a position (with tileIndex, x, y, flipH, flipV, eye, layer, paletteSelector). Many draws can stack at the same screen area (e.g. BG then OBJ).
- **Tile** — The 8×8 pattern in the pattern table identified by **tileIndex**. The same tile can be used by many draws at different positions.
- **Background** — The cleared buffer (e.g. black). If you click and get **0 draws**, no draw’s rectangle contains that pixel; what you see there is the **background** only (nothing from the draw list is rendering at that pixel).

So: “1 draw at this pixel” = one tile instance covers this screen position. “0 draws” = no tile instance covers it; you’re seeing the background.

## Problem

- **Symptom:** Some tiles on the title screen show up with a **solid background** (e.g. green panel behind “MARIO CLASH”). With **Transparent 0** on, the true extent of non‑zero pixels is visible (no longer partly covered by index‑0 fill).
- **Observed:** The whole title screen is **BG (tiles)**. The **Black BG** toggle has **no effect** on the title screen.

## Why Black BG has no effect

- **Black BG** only changes the color used for **palette index 0** (force it to black).  
- With **Transparent 0** on, we **never draw** pixels with palette index 0 (we leave the buffer unchanged there). So we never paint index 0, and changing its color does nothing.  
- So “Black BG has no effect” is **expected** when Transparent 0 is on. The “solid” regions are drawn with **indices 1–3**, not 0.

## Root cause: one palette for all tiles

On the VB hardware:

- Each BG/Affine tile has a **2‑bit palette selector** in the tile map (`bgsc >> 14` → 0–3).
- The core uses **four** 4‑color palettes (GPLT 0–3 for BG/Affine, JPLT 0–3 for OBJ) and selects one per tile via this selector.
- So different tiles can use **different** 4‑color sets (e.g. panel vs text).

In our viewer we were:

- Using a **single** 4‑color preset for **every** tile.
- **Not** passing or using the per‑tile palette selector from the core.

So tiles that the game draws with a different palette (e.g. a darker or different green) were all rendered with the same green. That makes some areas look like one solid block and can make panels and text blend together.

## Plan (what we did)

**Rebuild required:** After changing the core, rebuild the beetle_vb Emscripten core (e.g. from `core-build/beetle_vb` with `emmake make -f Makefile platform=emscripten`) and replace the WASM/data in `public/data/cores/`. New vbstate captures will then include `paletteSelector`; legacy vbstates default to palette 0.

1. **Core: add palette selector to the draw list**  
   - In `VB_DrawCall`, add `uint8_t palette` (0–3).  
   - In `VB_DL_Push`, add a `palette` argument.  
   - At each push site (BG, Affine, OBJ), pass `palette_selector` (`bgsc >> 14` or `oam_ptr[3] >> 14`).  
   - In the VIP state export, read this byte and expose it (e.g. `paletteSelector` or `palette`) on each draw object.

2. **Viewer: use per‑draw palette**  
   - For each draw, read `paletteSelector` (default 0 for legacy vbstate).  
   - Define four 4‑color palettes from the current preset (e.g. four green ramps: dark, mid‑dark, mid‑bright, bright).  
   - When drawing a tile, pass the 4‑color set for that draw’s `paletteSelector` into `drawTileIntoImageData`.  
   - Legacy vbstates without `paletteSelector` are treated as palette 0.

3. **Optional: diagnostics**  
   - Click a tile and log `tileIndex`, `paletteSelector`, and (if useful) pixel index histogram (count of 0/1/2/3 in the tile) to confirm which palette a “solid” tile uses and that it’s not all index 0.

## Result

- Tiles that the game renders with different palettes (e.g. panel vs text) now use different 4‑color sets in the viewer, so the title screen should no longer look like one solid block and panels vs text should separate correctly.  
- Black BG still only affects index 0; with Transparent 0 on it still has no visible effect, which is correct.

## Captured palettes (GPLT + master colors)

VIP state capture now includes **GPLT** (4 × uint16) and **BrightCLUT[0]** (the 4 master RGB colors) from the core. The viewer uses them when present: each of the four palette selectors (0–3) gets its four colors from GPLT’s remap into the master color table, so the render matches the game’s palettes on any screen. Legacy vbstates or captures without these fields still use the preset ramps (and the “Palette 2 = black” debug toggle when needed).

- **Transparent:** Index 0 in every palette remains “transparent” (core doesn’t draw it; viewer “Transparent 0” skips it). The captured colors for index 0 are still stored so each palette is complete; we just don’t paint that pixel when Transparent 0 is on.

## If issues remain

- **JPLT for OBJ:** We use the same GPLT/master colors for BG and OBJ; the VB has separate JPLT for sprites. If OBJ colors look wrong, we could export JPLT and use it for layer 2.  
- **Draw order:** If some tiles still look wrong, compare draw order and layer with the core (we already tag BG / Affine / OBJ).  
- **Viewport/crop:** Clear top/left/right and crop are per‑scene; adjust as needed for the title screen.
