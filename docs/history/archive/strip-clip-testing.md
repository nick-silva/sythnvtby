# How to test the strip-clip feature (per-strip ghost debug)

**Status: Archived.** This doc describes the strip-clip debug test. **Conclusion:** Clip-to-strip is not a fix (causes horizontal banding); leave OFF. Kept for development archive. See [README.md](../../README.md) and [development-journey.md](../development-journey.md).

---

The app and patched core now support **strip** in the draw list and a **Clip color layer to strip** debug option.

**Important:** Leave **"Clip color layer to strip (debug)" OFF** for normal play. With it ON, each tile is drawn only in the 8 rows of its strip. Tiles that span two strips (e.g. sprite at y=25 spans rows 25–32) or that move diagonally get cut at strip boundaries, causing **horizontal banding** and "every other row" wrong or missing. So strip clip makes diagonal movement look worse; it was an experiment to test the per-strip hypothesis, not a fix.

---

## 1. Use the new core

The core was rebuilt with a `strip` field (0..27) added to each draw. The new WASM is in `public/data/cores/beetle_vb-wasm.data`.

- If you use **local core** (`USE_LOCAL_CORE = true`) and **EJS_disableDatabases = true**, reload the app and load a ROM so the browser fetches the new core. If the ghost still looks the same after reload, clear the emulator **Cache** (gear/menu on the game frame → clear cache) then load the ROM again so the new core is used.
- Confirm the core is new: in the browser console, `__VB_CORE_PATCH_LEVEL__` should be `2`. After a frame has run, you can run:  
  `lastVIPState.drawList.filter(d => d.layer === 2).slice(0,3).forEach(d => console.log('strip', d.strip, 'x', d.x, 'y', d.y))`  
  You should see a `strip` value (0..27) on each draw. If `strip` is always `undefined`, the old core is still in use—clear cache and reload.

---

## 2. Reproduce the ghost (without strip clip)

1. **Display** → **Color**.
2. Load your **pack** that colors the skull on the Mario Clash blimp.
3. Load the **ROM** and go to the **blimp screen** (skull on the side, blimp moving right-to-left).
4. Confirm the **ghost**: the skull’s first column is correct; the rest appears again shifted to the right (double render).

---

## 3. Turn on “Clip color layer to strip”

1. With the same scene (blimp, skull, Color mode), find the **“Clip color layer to strip (debug)”** checkbox. It appears in the Color section when Display is **Color** (below “Fade response”).
2. **Check** the box.
3. Watch the color layer.

**How to interpret:**

- **If the ghost disappears or is greatly reduced:** We were drawing each tile in every row of the screen; with strip clip we only draw each tile in the 8 rows of its strip. So the bug is consistent with **per-strip position**: our draw list has one position per tile (for one strip), and drawing that tile in other strips was wrong. Next step would be to either keep strip clip as a permanent option or fix the core to give per-strip positions.
- **If the ghost is unchanged:** Then clipping to strip doesn’t fix it—either the tile’s strip is already correct and the bug is something else (e.g. wrong x for that strip, or a different cause). We’d need to log strip vs. screen position or sample the canvas to investigate further.
- **If it looks worse (horizontal banding, "every other row" wrong):** This is what was observed. With strip clip ON we only draw each tile in one 8-row strip. Tiles that span two strips (e.g. sprite at y=25) or move diagonally get cut at strip boundaries, so you see alternating rows or 8-row bands that are wrong or missing. So strip clip is **not** a valid workaround—leave it OFF. The strip field is still useful for logging and future per-strip fixes.

---

## 4. Optional: log strip for the skull

In the browser console (with a ROM loaded and Color mode on, so `lastVIPState` is set):

```js
// Find OBJ draws (sprites) and log strip, x, y for the first few
(lastVIPState?.drawList || []).filter(d => d.layer === 2).slice(0, 5).forEach(d => {
  console.log('strip', d.strip, 'x', d.x, 'y', d.y, 'tile', d.tileIndex);
});
```

That shows which strip each sprite draw was emitted in. The skull should be one of them; note its `strip` and `y` (they should match: `strip === Math.floor(y/8)` for the top row of the tile).

---

## 5. Summary

| Step | Action |
|------|--------|
| 1 | Use new core (reload; clear cache if needed). Confirm `lastVIPState.drawList[0].strip` is 0–27. |
| 2 | Reproduce ghost: Color mode, pack with skull, blimp screen. |
| 3 | Check **“Clip color layer to strip (debug)”**. See if ghost goes away or not. |
| 4 | (Optional) Log `strip`, `x`, `y` for OBJ draws in the console. |

Result of step 3 tells us whether the per-strip clip is a valid workaround and whether to pursue per-strip positions in the core.

---

## 5. Review of localhost log (strip-clip test session)

A saved console log from the strip-clip test (`localhost-1773505463197.log`) was reviewed. The log is **EmulatorJS / RetroArch / Beetle VB startup and config** only; it does **not** contain any app-side output (no draw list, strip values, or pack coverage logs). For future strip-clip or ghost runs, consider running the optional console commands in §4 and saving the log again so strip/x/y and draw-list summary are captured.

**Notable items from the log (useful for future debugging, even if not solving the ghost):**

- **Core report fetch failed:** `Could not fetch core report JSON at cores/reports/beetle_vb.json` — expected on localhost; core report/caching is disabled. Not a problem for local dev.
- **Video timings:** `[Video] Timings deviate too much. Will not adjust. (Target = 60.00 Hz, Game = 50.27 Hz)` — VB runs at 50.27 Hz, display target 60 Hz. Relevant if we ever investigate frame pacing or “which buffer is visible when.”
- **Pixel format:** `SET_PIXEL_FORMAT: XRGB8888` — core output is XRGB8888; our color layer is RGBA. Keep in mind for any future pixel sampling (e.g. reading game canvas at (x,y) vs (x-8,y)).
- **Geometry:** `Geometry: 384x224` — matches our color layer and expectations.
- **EMSCRIPTEN:** `[EMSCRIPTEN]: Could not get screen dimensions!` then `SET_GEOMETRY` and canvas size 640×480. Suggests a moment where screen dimensions weren’t available and then canvas was set to 640×480 (likely scaled from 384×224 or stereo). Could matter when reasoning about “which buffer we composite on” and when it’s ready.
- **GL:** No BGRA8888 extension → “32-bit path will require conversion” — core may do a format conversion on the path to the canvas; relevant if we sample pixels from the game canvas.
- **Beetle VB options:** `vb_3dmode anaglyph`, `vb_color_mode black & red`, `vb_cpu_emulation fast` — confirms VB-specific options are applied.

**See also:** For ghost investigation (OBJ X offset -8, layer counts, "Apply offset to all draws"), see [graphics-next-investigations.md](../../planning/graphics-next-investigations.md) and the main app’s **Color layer debug** button.
