---
status: current
last-reviewed: 2026-10-09
covers: patches/beetle-vb-vip-draw-list-export.patch
---

# VIP rendering and draw order — validated against hardware and Beetle VB

This document summarizes how the Virtual Boy VIP actually renders (from hardware docs and from the Beetle VB / Mednafen source) and confirms that our art pipeline and draw-list plan match reality.

**Status:** the draw list described here was built — `patches/beetle-vb-vip-draw-list-export.patch` records each tile as the VIP draws it, with its world and strip. The colour layer sorts draws by world (31→0) first, with strip, layer and list order as ties (`compareDrawCallOrderByWorld`, `src/color-layer.js`); strips never overlap, so for any one pixel that is the VIP's own order.

---

## Sources

- **Hardware / behaviour:** [VIP timing](https://skyfloogle.github.io/vip-timing/) (strip-based rendering, 32 worlds, END world), [Virtual Boy Architecture (Copetti)](https://classic.copetti.org/writings/consoles/virtual-boy/) (windows/worlds, OAM, pattern table, segments).
- **Emulator:** [libretro/beetle-vb-libretro](https://github.com/libretro/beetle-vb-libretro), specifically `mednafen/vb/vip.c` and `mednafen/vb/vip_draw.inc` (from Mednafen VB).

---

## How the VIP renders (hardware)

- **Framebuffer:** 384×224 per eye; the VIP draws into a framebuffer, then the display subsystem sends it to the LEDs (no scanline-at-a-time like NES).
- **Strips:** The VIP renders in **8-pixel-tall strips**. There are **28 strips** (28 × 8 = 224 lines). For each strip it draws all relevant content for that band, then moves to the next strip.
- **Worlds (windows):** There are **32 windows** (worlds). Each world is 32 bytes of config (position, size, mode, segment refs, visibility per eye, etc.). Rendering order is **per strip**: the VIP processes the 32 worlds **in sequence** until an **END** world (or all 32). So **order = back to front**: first world drawn = back, last world drawn = front.
- **World types:** A world can be:
  - **Normal** or **H-Bias** — background from a segment (tile map).
  - **Affine** — background with affine transform.
  - **Object** — sprites (from OAM).
- **Sprites (objects):** OAM is 8 KB (1024 entries × 8 bytes). Each entry: position, parallax, tile index, flips, palette, visibility per eye. Sprites are drawn as part of **object worlds**; which sprites belong to which world is controlled by **SPT** (sprite priority) registers so you get up to 4 object “layers” (worlds) with different OAM ranges.
- **Pattern table (CHR):** 32 KB in VRAM = 2048 tiles × 16 bytes (8×8, 2 bpp). Shared by backgrounds and sprites.
- **Background segments:** Tile maps in DRAM; 8 KB per segment (64×64 tile refs × 2 bytes). A world points to a segment (and optionally overplane data).

So: **draw order = strip order (0..27), then within each strip world order (e.g. 31→0 in the emulator so that world 0 is on top).** Within a world you get either background tiles (in row/tile order) or objects (in OAM order for that world).

---

## How Beetle VB (Mednafen) does it

In `vip_draw.inc`, `VIP_DrawBlock(block_no, fb_l, fb_r)` draws one 8-row strip for both eyes:

```c
void VIP_DrawBlock(uint8 block_no, uint8 *fb_l, uint8 *fb_r)
{
  int y, world, lr;
  // Clear strip to background color
  for (y = 0; y < 8; y++) { ... }

  for (world = 31; world >= 0; world--)   // Back to front: 31 first, 0 last
  {
    const uint16 *world_ptr = &DRAM[(0x1D800 + world * 0x20) >> 1];  // 32 bytes per world
    // ... read end, over, bgm (mode), lron, gx, gp, gy, mx, mp, my, width, height, param_base, overplane_char
    if (end) break;

    for (y = 0; y < 8; y++)
    {
      if (bgm == BGM_OBJ)
        DrawOBJ(fb, (block_no * 8) + y, lron);
      else if (bgm == BGM_AFFINE)
        DrawAffine(...);
      else
        DrawBG(...);   // Normal or H-Bias
    }
    // obj_search_which for object world ordering
  }
}
```

- **World layout in DRAM:** `0x1D800 + world * 0x20` — 32 bytes per world, matching our “32 windows × 32 bytes.”
- **Order:** `world = 31` down to `0`. So **world 31 = back**, **world 0 = front**. Same as “process worlds in sequence” on hardware; later index = drawn first = behind.
- **Strips:** `vip.c` calls `VIP_DrawBlock(DrawingBlock, ...)` for `DrawingBlock = 0..27`, so strip 0 (top) to strip 27 (bottom). Each block is 8 rows.
- **OAM:** `vip_draw.inc` uses `&DRAM[(0x1E000 + (oam * 8)) >> 1]` — OAM at 0x1E000, 8 bytes per sprite, 1024 sprites = 8 KB. Matches our OAM size.
- **Pattern table:** `CHR_RAM` in `vip.c` is 0x8000 bytes (32 KB) = 2048 × 16 bytes. Matches our pattern table size.

So in the emulator, the **actual draw order** is:

1. For each strip (0..27):
2. For each world 31 → 0 (back to front):
3. For each of the 8 rows in the strip, draw that world (either DrawBG / DrawAffine for backgrounds, or DrawOBJ for sprites).

A **draw list** that matches this would emit “draw tile *i* at (*x*, *y*) with flips” in exactly this order so compositing and “which layer is on top” are correct.

---

## Validation of our plan

| Our doc / assumption | Reality | Match |
|----------------------|--------|--------|
| 32 windows × 32 bytes | DRAM 0x1D800, world * 0x20 | ✓ |
| Pattern table 32 KB (2048 × 16) | CHR_RAM 0x8000 | ✓ |
| OAM 8 KB (1024 × 8) | DRAM 0x1E000, 8 bytes per entry | ✓ |
| Segments 8 KB each, tile refs | BGMap in DRAM, segment base from world | ✓ |
| Draw order matters for compositing | Strip then world 31→0; same order needed for correct layering | ✓ |
| Draw order needed for “paint which layer” | At (x,y) multiple tiles can stack; order defines which is “on top” for layer toggling | ✓ |
| 28 strips × 8 rows = 224 lines | DrawingBlock 0..27, 8 rows per block | ✓ |

So:

- **Runtime color layer:** We must composite in the same order the VIP draws (strip, then world 31→0, then within world the actual tile/object draws). A draw list from the core in that order is correct.
- **Paint-on-game editor:** At a clicked (x,y), the draw list gives us an ordered stack of tiles; we can index by “layer” (e.g. 0 = top, 1 = under that, …) and let the user toggle which layer they’re painting. Our plan is accurate.

---

## Where to hook in the core for a draw list

In Beetle VB the natural place is inside `VIP_DrawBlock` (or the helpers it calls):

- **Option A:** In `DrawBG` / `DrawAffine` / `DrawOBJ`, each time a tile is written to the strip buffer, append `{ tileIndex, x, y, flipH, flipV, world }` to a list. After all strips are done (when `DrawingBlock == 28` and we’re about to set `DrawingActive = false` in `vip.c`), pass that list to JS. That gives a full-frame draw list in the same order the VIP drew.
- **Option B:** Emit draws incrementally per strip and concatenate on the JS side; same logical order.

In both cases the list is **strip order, then world order (31→0), then per-world draw order** — which is exactly what we need for correct layers and for “toggle through layers” in the paint editor.

---

## Summary

- Hardware and Mednafen/Beetle VB agree: **32 worlds**, **strip-by-strip** (28 strips), **world order 31→0** (0 = front). **OAM** and **pattern table** sizes and layout match our docs.
- Our plan to use an **ordered draw list** for (1) correct color compositing and (2) layer-aware “paint on the game” is **accurate**. Implementing the draw list in the core by recording tile draws in the same order as `VIP_DrawBlock` (and optionally tagging with world index for layer UI) will match reality.
