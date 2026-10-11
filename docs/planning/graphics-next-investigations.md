---
status: living
last-reviewed: 2026-10-10
covers: src/color-layer.js
---

# Graphics: next investigations and planning

Checkpoint planning for graphics glitches and improvements. Focus is on making the colorized layer match hardware/emulator behavior (fading, brightness, animated BG, affines) before adding more editor features.

---

## Where we are (phase and prior plans)

**Status (Sep 2026):** capture, the pack format and the authoring loop are in place — the
emulator captures frames (manually and with auto-capture), the **Project tool**
(`tools/project.html`) isolates and paints backgrounds, and **SpriteStudio** paints and
animates sprites. See the [project guide](../README.md) for the whole picture. The
**prebuilt, patched core ships in the repo** (`public/data/`), so no manual core setup is
needed. What remains below is rendering accuracy: making the color layer follow what the
hardware does. The current, prioritized list lives in
[priorities-and-next.md](priorities-and-next.md#graphics).

Still open alongside graphics work, and not blocking it:

| Item | Where |
|------|-------|
| **Ship-readiness cleanup** — collapse debug options, gate verbose logs | [ship-readiness-cleanup.md](ship-readiness-cleanup.md) |
| **Standalone pack editor** — extend an existing `.vbcolor`, batch color | [priorities-and-next.md](priorities-and-next.md#standalone-pack-editor-toolseditorhtml) |

The sections below keep the original investigation notes; some describe Paint v1, which
was later replaced.

---

## Foundation: how our colorization system works (for experts)

This section describes from the ground up how we produce a colorized frame so that Virtual Boy / VIP experts can understand our setup and help debug the “one tile behind” ghost on animated BG. References: [vip-rendering-validated.md](../reference/vip-rendering-validated.md), [vip-state.md](../reference/vip-state.md), [art-pipeline.md](../reference/art-pipeline.md).

### High-level pipeline

1. We run the **Beetle VB** core (Mednafen-based, libretro) in the browser via EmulatorJS. The core renders the game in **monochrome** (red/black) into a framebuffer and presents it (e.g. 384×224 per eye).
2. We use a **patched** build of the core that, each frame after rendering, calls into JavaScript with a snapshot of **VIP state** (pattern table, OAM, segments, windows, and a **draw list**).
3. Our app keeps the **latest** VIP state. When the user selects **Color** mode and has loaded a **color pack** (tile content hash → 8×8 RGBA), we **composite a color layer** on top of the mono frame: we iterate the draw list and, for each draw, look up the tile’s content hash in the pack; if found, we draw that 8×8 RGBA tile at the draw’s **(x, y)**. Where the pack has no entry, we leave the pixel transparent so the mono frame shows through. So the final image is: mono frame + color layer (same size, same coordinate system).

So we do **not** re-render the VIP from segments/OAM ourselves; we rely on the core’s **draw list** to tell us “tile *i* was drawn at screen position (*x*, *y*) with these flips” in the **same order** the VIP drew. That order is required for correct layering (back-to-front) and for our paint-on-game editor (layer toggle at a pixel).

### What the VIP state and draw list are

- **Pattern table:** 32 KB (2048 tiles × 16 bytes). Each tile is 8×8, 2 bpp. Shared by backgrounds and sprites. We use it to compute a **content hash** per tile so we can match “this draw used tile index *k*” to “our pack has colors for the tile whose 16-byte content hashes to *h*.”
- **OAM, segments, windows:** We have them in state for extraction and for potential future use; the **runtime color layer** does not re-derive tile positions from them. It only uses the draw list.
- **Draw list:** An ordered array of **draw calls**. Each entry has: **tileIndex** (into pattern table), **x**, **y** (screen pixel coordinates, 0..383 and 0..223), **flipH**, **flipV**, and optionally **eye** (0 = left, 1 = right), **layer** (0 = BG, 1 = Affine, 2 = OBJ), **strip** (0..27). The list is in the **exact order** the VIP draws: strip 0..27, then within each strip world 31→0 (back to front), then within each world the tile/object draws. Our patched core builds this list inside `VIP_DrawBlock` → `DrawBG` / `DrawAffine` / `DrawOBJ`: each time the core writes a tile to the strip buffer, it appends one entry. After all strips are done (frame complete), the core passes the full list to JS in one shot.

### What (x, y) in the draw list represents

- **(x, y)** is the **screen-space pixel position of the top-left corner** of the 8×8 tile that was drawn. Same coordinate system as the framebuffer: x = 0..383, y = 0..223.
- **Where the core gets (x, y):**
  - **DrawBG (background):** The core pushes **once per tile** when it starts drawing that tile (e.g. when `char_sub_y == 0` for the first row of the tile). It uses **RealY** (scanline 0..223) for Y: `y0 = RealY - vflip_xor`. For X it uses the column/position it’s drawing for that tile. So we get **one (x, y) per tile draw**.
  - **DrawOBJ (sprites):** One push per sprite tile; position from OAM (e.g. `jx ± jp`, `jy`). One (x, y) per 8×8 sprite.
  - **DrawAffine:** Same idea: one (x, y) per tile at the position used for that draw.
- **Important:** For **H-Bias** (horizontally biased) background worlds, the VIP hardware allows **per-scanline horizontal offset**. In the Beetle VB source, DrawBG does something like: `srcX += (int16)DRAM[(param_base + (((RealY - DestY) * 2) | lr)) & 0xFFFF]` — so the **effective X** used when drawing each scanline can **vary with RealY**. Our draw list, however, has **one x per tile** (the value at the moment of the push, typically when the first row of the tile is drawn). So for H-Bias BG, the core may be drawing **different columns** of the tile at **different screen X** per scanline; we only have a single x for the whole 8×8.

### How we use the draw list (no per-scanline logic)

- We iterate the draw list in order. For each draw we have `(tileIndex, x, y, flipH, flipV, …)`. We decode the 16-byte tile from the pattern table, hash it, look up the hash in the color pack. If found, we draw the pack’s 8×8 RGBA at **pixel (x, y)** — i.e. we fill the rectangle [x, x+8) × [y, y+8) with the tile’s pixels (with flips). We do **not** use strip index or RealY to change x or y; we assume one position per tile is valid for the whole 8×8.

### How BG “animation” works on the Virtual Boy (relevant to the bug)

- **Background layers** are built from **segments** (tile maps in DRAM). A **world** (window) can be “Normal” or **H-Bias**. For H-Bias, the hardware applies a **per-scanline horizontal offset** (from a parameter table in DRAM). So when the game scrolls a background (e.g. a blimp moving left), it may use an H-Bias world: each scanline can have a different horizontal scroll, which produces smooth or stepped scrolling. The **emulator** (DrawBG) then computes **srcX** (and thus which tile column and which pixel column) **per scanline** using that table. So the **same logical tile** can be drawn at **different screen X** on different rows of the same 8×8 — or the tile’s position can differ per strip. Our draw list only records **one** (x, y) per tile (e.g. at `char_sub_y == 0`), so we have no way to replicate that per-scanline X in the color layer without the core giving us more data (e.g. per-strip or per-scanline x).

### Summary of the bug (for expert discussion)

- **Observed:** On a specific scene (Mario Clash blimp), a **colorized BG tile** (skull on the blimp) appears with a **ghost**: the **first vertical column** (8 px) of the tile looks correct; **columns 1–7** appear **again** shifted ~8 px to the right, so the same tile content appears twice (leading edge correct, rest “one tile behind”). The skull is confirmed to be **layer 0 (BG)**, not OBJ. Other BG on the same screen (e.g. a static basket) does **not** show the ghost. Applying a **BG X offset of -8 to all BG draws** made the issue **worse** (static elements like borders and the basket shifted left; an extra chunk of skull appeared on the right), so the problem is **not** “all BG are one tile right” — it is specific to **animated/scrolling BG** (likely H-Bias worlds).
- **Hypothesis:** For H-Bias (or scrolling) BG, the core uses **per-scanline** (or per-strip) X when drawing; we only have **one x per tile**. So we draw our 8×8 at that single x; one column might align with where the core drew one row, but the other rows were drawn at different x by the core → we appear “one tile off” for those rows, which matches “leading edge correct, rest ghosted.”
- **What we need from experts:** (1) Confirmation of how H-Bias / per-scanline X works in the VIP and in Beetle VB’s DrawBG (e.g. is our single-x-per-tile push inherently wrong for H-Bias worlds?). (2) Whether the correct fix is for the core to emit **per-strip** or **per-scanline** x for BG draws when H-Bias is active, or if there is another way we can derive correct positions in the app. (3) Any other cause we might be missing (e.g. draw list timing vs displayed buffer, or double-buffering) that would produce “exactly one tile behind” only on scrolling BG.

---

## 1. Fading / opacity / brightness

**Status (Sep 2026): done for every paint store.** The core reports `masterBrightness` and
`compositeColorFrame` scales painted tiles by it (with `DEFAULT_FADE_RESPONSE`, 1.34), so they
fade with the scene. BG anchor paint (`painter-v2-vip-overlays.json`) is blended *after*
compositing and used to be copied in at full brightness, so an anchored group stayed lit
through a fade; `blendPainterV2VipOverlaysIntoImageData` now takes the same `brightnessScale`
and applies `overlayBrightness` — the same `masterBrightness × scale`, clamped to 0..1 so paint
never comes out brighter than it was painted — in the emulator and in both authoring previews.

The painted-tiles inventory is what made this diagnosable: on the Safety screen
`EnglishSafetyText` is painted entirely by overlay (0 of 19 patterns in the pack, 61 overlay
cells) and never faded, while `JapaneseSafetyText` (14 of 35 patterns in the pack, 28 overlay
cells) faded only in its pack half. When a fade looks wrong, check **which store** the paint is
in first. Note this is separate from item 2 below: `masterBrightness` is the global fade, while
per-draw palette remapping (GPLT) applies to groups that opt in with **Follow the game's palette**
(`paletteFollowFactors`, `src/color-layer.js`; since Oct 2026), for menus that highlight by palette.

The notes below are the original investigation.

**Observed:** Screen transitions use fade out and fade in. Colorized sprites (1) ignore that fading during transitions, and (2) appear much brighter than surrounding non-colorized tiles. That suggests a **per-screen or global brightness/opacity** that the VB applies and we are not emulating in our color layer.

**Goals:**
- Understand how the core (or hardware) applies fade/brightness during transitions and in general.
- Apply the same or equivalent brightness/opacity to our color layer so colorized tiles don’t “pop” and so they participate in transition fades.
- Document where brightness/opacity comes from (VIP registers, master brightness, window/segment settings, etc.).

**References:** Core rendering path, VIP docs if available; [vip-rendering-validated.md](../reference/vip-rendering-validated.md). Hardware: VIP brightness registers at 0x0005F824, 0x0005F826, 0x0005F828 (display brightness); Column Table can affect LED duty cycle per column.

**Confidence that the core has a pipeable brightness/fade source: confirmed.**

- **Core (our clone at `core-build/beetle_vb`):** In `mednafen/vb/vip.c`, the VIP has `BRTA`, `BRTB`, `BRTC`, `REST`; `RecalcBrightnessCache()` computes `BrightnessCache[4]` (int32, 0–255 per shade) and `BrightCLUT[lr][4]` used for every pixel. So the mono output already uses this for fades; we now pipe it to JS.
- **Implementation:** The frame hook passes `BrightnessCache` as a 16th parameter; JS reads the four int32s and sets `st.masterBrightness = (BrightnessCache[1]+[2]+[3])/(3*255)` (0..1). The app color layer multiplies RGBA by `state.masterBrightness` when present. Serialize/deserialize in `vip-dump.js` include `masterBrightness`.
- **Rebuild:** Rebuild the core (e.g. `emmake make -f Makefile platform=emscripten` in `core-build/beetle_vb`), replace the WASM/data in `public/data/cores/`, and clear the emulator cache so the new core is loaded. Then test a game with screen fades in Color mode.

---

### How we’re tackling it (execution plan)

**Step 1 — Find where brightness/fade is applied in the core**

- In Beetle VB / Mednafen VB source (e.g. `vip.c`, `vip_draw.inc`, or display path), locate where the VIP brightness registers (or any global intensity) are read and applied to the framebuffer.
- If the core never applies a global brightness (games might fade by changing palettes or drawing dimmer tiles), identify how games implement fades (e.g. a register written each frame, or per-tile palette changes). Document the mechanism.
- Outcome: a single “master” value we can export per frame (e.g. 0.0–1.0 or 0–255) that represents the current screen brightness/fade level, or a note that we need a different approach (e.g. per-window opacity).

**Step 2 — Export that value in the VIP push**

- In the patched core, when building the state for `__VB_PUSH_VIP_STATE__`, read the appropriate register(s) or derived value and add a field to the state (e.g. `masterBrightness` or `fadeLevel`).
- Ensure the value is updated every frame so transitions (fade in/out) are reflected.
- JS side: in `vip-state.js` or the consumer, accept the new field; in `vip-dump.js` add serialization if we persist state (optional).

**Step 3 — Apply it in the color layer**

- In `color-layer.js`, when compositing into `imageData`, if state has a brightness/fade value, multiply each pixel’s **R, G, B only** (do **not** scale A). Hardware fade is intensity/brightness, not opacity; scaling alpha caused red mono to bleed through where color was drawn.
- Use a normalised factor (e.g. 0.0–1.0) so 1.0 = no change, 0.0 = black. Optional “Fade response” scale (0.5–2) is passed from the main app so users can tune; effective k = (masterBrightness ?? 1) * scale, capped at 1.
- **Default:** `DEFAULT_FADE_RESPONSE = 1.34` in `color-layer.js` is the locked-in value that matches background colors; used as the main app slider default, in the paint tool when rendering pack tiles, and (when added) in the viewer for color output.
- Ensure the color canvas is still composited over the mono frame the same way (no change to main.js overlay behaviour).

**Step 4 — Validate**

- Run a game that has clear screen transitions (fade to black, fade in). Confirm the colorized layer fades in sync with the mono layer and no longer “pops” or looks brighter than uncolorized areas during normal play.

**Fallback if no global register:** If the core doesn’t expose a single brightness and games fade by other means (e.g. palette animation), we may need to derive a scale from the mono frame (e.g. average luminance of the core’s output) and apply it to our layer—less accurate but a possible stopgap. Prefer exposing the real register(s) from the core.

---

## 2. Animated BG tiles (moving tiles, artifacting)

**Observed:** Some tiles we classify as BG are animated (move like sprites). In our implementation, those moving BG tiles suffer from **artifacting** that “looks pretty terrible.”

**Concrete case (Mario Clash blimp):** The blimp is BG-layer tiles scrolling right-to-left. A **colorized tile** (skull) is drawn on the blimp. In the **paint tool** (static vbstate) the skull looks correct. In the **emulator** (live, BG scrolling) a **double-render** artifact appears: a portion of the skull (e.g. jaw/mouth, or a block near the eye) is drawn a second time, offset/ghosted, so the same pixels appear in two places. So the bug is specific to **live rendering with motion**—likely timing (draw list vs displayed frame), scroll/position mismatch, or duplicate draw calls when BG is moving.

**Confirmed:** The skull is a **BG tile** (layer 0), not OBJ. The issue appears specific to **animated / scrolling BG tiles** (e.g. skull on blimp); other BG tiles on the same screen (e.g. the basket below the blimp) do **not** show the ghost. So the bug is likely tied to **HBias or per-scanline X** for scrolling BG layers: we push one (x,y) per tile, but the core uses a different x per scanline for those layers.

**Follow-up observation:** Other animating BG tiles on the same screen were colorized and **behave correctly**. Only certain tiles (e.g. the skull) show the artifact. For those that mis-render: they appear **twice**, **shifted to the right** by about one tile—like **one frame (or one tile) behind** where they should be. That fits a **one-frame timing lag**: our color layer is drawn from a draw list that belongs to the previous frame (or an earlier moment in the frame), while the mono framebuffer we composite on top of has already advanced. So we draw the sprite at its “old” position (one tile right) and the core has already drawn it at the “new” position → double image. Why only some draws (e.g. skull) and not others is still open: possibly OBJ vs BG timing in the core, or duplicate emit for certain layers. User investigating further.

**Refined pattern (leading edge vs rest):** The **first vertical column** (leftmost 8 px) of the colorized skull renders **in time** (correct, single). The **rest of the sprite** (columns 1–7) appears **again**, shifted ~8 px to the right (ghost). So it's not "whole sprite duplicated" but "column 0 correct; columns 1–7 duplicated to the right." That strongly suggests a **per-strip timing/position** issue: the VIP renders in **strips** (8-pixel-tall bands, left-to-right); the core may compute sprite (OBJ) X position **per strip** as it scans (e.g. scroll or parallax). We have **one (x,y) per draw** in our list—likely the position for strip 0 or frame start. So we draw the whole 8×8 at that x: **column 0** lines up with where the core drew strip 0; **columns 1–7** land in strips 1–7 where the core may have drawn the same tile at x−8 (or similar), so our columns 1–7 sit 8 px to the right → ghost. **Conclusion:** Yes, it's a timing/position model issue: we assume one position per tile per frame; the hardware/core may use a position that varies per strip. Fix would be either per-strip draw list from the core, or we derive strip-relative positions (harder).

**Why "exactly one tile behind, consistently"?** Possible explanations:

1. **Draw list is from the "next" frame.** The core may reset/fill the draw list at the **start** of the next frame. By the time our JS runs (e.g. after present), the core may have already begun frame N+1 and overwritten the list with **new** positions (e.g. blimp moved left → skull at x−8). We'd then composite using that list (skull at "new" x) onto the **displayed** buffer, which is still frame N (skull at "old" x). So we draw our color at the position the core will use (or just used) for the *next* frame, while the user sees the *current* frame → our color appears one tile to the right, i.e. "one tile behind" in time. Slow-motion didn't change it, so if this is the cause, the overwrite may happen regardless of frame rate (e.g. list is always "next" when we read it).

2. **Per-strip X (one x per tile vs x per strip).** We have one (x,y) per draw. If the VIP/core effectively uses a **different x per strip** (e.g. scroll or parallax applied per 8-row band), then we draw the whole 8×8 at one x: column 0 matches one strip; columns 1–7 land in strips where the core drew the same tile at x−8 → we appear one tile right in those columns. That matches "leading edge correct, rest ghosted" and would be **consistent** every frame. (Core source says OBJ uses one x per sprite; this might still apply if the *display* or buffer layout is strip-relative in a way we don't see.)

3. **Wrong buffer.** We might be compositing onto a buffer that isn't the one currently on screen (e.g. double-buffer swap). Then we'd be drawing "one frame ahead" onto the back buffer while the user sees the front buffer. Less likely to look like "one tile behind" unless the state we get is also from the wrong frame.

4. **Core reports x one tile ahead.** The core might have an off-by-one: it reports (x+8, y) for the sprite instead of (x, y). We'd composite at x+8; the mono frame has the sprite at x → ghost to the right, every frame. A core bug in where the push happens (e.g. after advancing a pointer) could cause this.

**Goals:**
- Reproduce and characterize the artifact (tearing, wrong tile, wrong position, flicker, double-render, etc.).
- Determine whether the cause is timing (we draw once per frame vs. mid-frame updates), coordinate/transform handling for BG vs. OBJ, or something else.
- Fix or mitigate so moving BG tiles and sprites on top of them look correct when colorized.

**Investigation:** Identify a specific game/screen where BG tiles move; capture VIP state and compare our draw order and coordinates to the core; check if we need per-scanline or per-draw timing; consider whether “animated BG” is driven by the same draw list we use or a different path. **Next step:** Colorize more of the blimp (BG tiles) and note whether only the sprite double-renders or if BG tiles also show patterns (tearing, duplicates, wrong position)—that will narrow down whether the issue is sprite-specific or general to scrolling.

**Testing for a race (slow FPS):** EmulatorJS and the Beetle core already support **slow motion**. Use the emulator's built-in menu → Speed Options → Slow Motion = Enabled, Ratio = e.g. 2.0 or 10.0. **Result:** Even at **10× slow motion** the sprite ghost is unchanged → a simple frame-timing race (reading draw list one frame late) is **unlikely**. So we focus on **per-strip or position-model** tests below.

**Ensuring correct coordinates per frame:** To get each tile drawn at the right screen position we need either (1) the core to supply **per-strip** (or per-draw) positions so we can composite strip-by-strip, or (2) a single position that is valid for the whole frame. Don't reinvent: check whether EmulatorJS or Beetle VB expose any "frame sync" or "after render" callback we're not using. If the core only pushes one draw list per frame at a fixed moment, we may need a core patch to emit strip-relative positions or to push state after the last strip.

**Tests for per-strip / position issues:**

1. **Add strip index to the draw list (core patch).** In the core, when calling `VB_DL_Push` we're inside `VIP_DrawBlock(DrawingBlock, ...)`, so we know the current strip (0..27). Add a `strip` or `block` field to `VB_DrawCall` and set it to `DrawingBlock` in `VB_DL_Reset`/push. Expose it in the JS state. In the app, log or display strip per draw (e.g. for the skull tile). That tells us **which strip** each draw was emitted in. If the same sprite appears in multiple draws with different strips, we have per-strip draws; if one draw per sprite, we know which strip it belongs to.

2. **Confirm OBJ uses one x per sprite (core source).** In `vip_draw.inc` DrawOBJ, `x = sign_x_to_s32(10, (jx + (lr ? jp : -jp)))` is computed once per sprite per row from OAM (jx, jp). There is no per-column or per-strip x for OBJ in the current code. So for sprites, the core really does use a single x for the whole 8×8. That makes "leading edge correct, rest wrong" for a **sprite** puzzling unless (a) the display buffer we composite on is not the same as the one the core just drew, or (b) something else (e.g. HBias on a BG layer behind the sprite) is shifting what we see.

3. **Clip draw to strip (experiment).** Implemented: each draw has a **strip** field (0..27); a "Clip color layer to strip (debug)" toggle only draws each tile in that strip's 8 rows. **Result:** With strip clip ON, things get **worse** when the sprite moves diagonally: **horizontal banding** and "every other row" wrong or missing, because tiles that span two strips (or aren't strip-aligned) get cut at boundaries. So strip clip is not a valid workaround—leave it off. The strip field remains useful for logging and for a future core change (e.g. per-strip positions).

4. **Check BG for per-scanline x (HBias).** In `vip_draw.inc` DrawBG, for HBias worlds the core does `srcX += (int16)DRAM[(param_base + (((RealY - DestY) * 2) | lr)) & 0xFFFF]` — so **background** tile X can vary per scanline (RealY). We push once per tile (when char_sub_y==0) with a single x. So for **BG** tiles on scrolling/HBias layers, our x might be wrong for most rows. The skull is **BG** (confirmed); the blimp uses scrolling BG, so HBias/per-scanline X is the leading hypothesis. Non-scrolling BG (e.g. basket) does not show the ghost.

5. **Log draw list vs displayed frame.** In the app, when we receive state, log the skull draw's (x, y) and (if added) strip. Optionally sample the mono canvas at (x, y) and (x-8, y) to see where the core actually drew the sprite (which pixel has the sprite color). That would show whether our x is 8 px ahead of the display.

**What to try next (in order):**

- **A. OBJ X-offset experiment (app-only).** For **layer 2 (OBJ / sprites)** only, composite at **(x − 8, y)**. Useful to confirm sprites; **ghost is confirmed on BG (skull), not OBJ**, so OBJ offset does not fix the blimp skull. See **E** for BG offset.
- **B. Sample the mono canvas.** When compositing, we draw on top of the game canvas. Before drawing, read a few pixels from the game canvas at (call.x, call.y) and (call.x − 8, call.y) for one OBJ draw (e.g. first sprite). Log which side has non-zero/red. That shows where the core actually drew. Requires access to the emulator's output canvas from the color-layer path (may need main.js to pass it or a getter).
- **C. Core: copy draw list before next frame.** If the core resets vb_draw_calls at **start** of the next frame and our JS runs **after** the core has already started the next frame, we might be reading frame N+1's draw list (new x) while the **display** still shows frame N (old x). So we'd draw at "new" x (right) on top of "old" frame → ghost to the right. Fix: in the core, when we're about to call __VB_PUSH_VIP_STATE__, copy vb_draw_calls to a separate buffer and pass that buffer to JS instead of the live one, so the next frame can't overwrite it before JS reads. Then test again.
- **D. Per-strip x in the core (larger change).** Have the core emit one draw per strip per tile (or per column) with the x that was actually used for that strip when drawing. Then we composite strip-by-strip. More invasive; try A–C first.

- **E. BG X-offset experiment (app-only).** For **layer 0 (BG)** only, composite at **(x + offset, y)** with a **tunable offset** (number input, default **-4**). **Result:** Applying -8 to **all** BG draws made the issue **worse**: the left/right screen borders (static BG) shifted left, and an extra chunk of the skull appeared on the right. So the fix is **not** “shift all BG left”; the problem is specific to **scrolling/H-Bias BG** only. Static BG (basket, borders) is correct with the current single-x-per-tile. With **-4** px (half tile), the skull can align better; a consistent -4 might mean the core's x is mid-tile or averaged. The app has a **BG X offset (px)** number input (-24..24) in the Color debug panel below the canvas. A proper fix would still be the core emitting per-strip or per-scanline x for H-Bias BG draws, or we’d need a way to identify which draws belong to H-Bias worlds and apply an offset only there (harder without core changes).

**Paint tool vs live emulator: why the paint tool has no ghost.** In the **paint tool** (and viewer), we load a **single, frozen snapshot** of VIP state (one frame’s draw list + pattern table). We render that snapshot once onto our own canvas. There is **no second buffer** — no “emulator display” we’re compositing on top of. So by definition the draw list and the image we produce are **the same frame**. In the **live emulator**, the core **streams** VIP state every frame; we receive state and immediately composite the color layer from it, then draw that layer on top of **whatever the emulator is currently displaying**. So we have two frames in play: (1) **the state we received** (draw list, positions) and (2) **the frame actually on screen**. If those are **not** the same frame, we get misalignment: we draw at “state” positions on top of “display” pixels → ghost or offset. The paint tool never has this because it has no “display” — only one snapshot. So the critical difference is **frame synchronization**. (For how the paint tool uses positions and tile content — raw draw list (x,y), no offset; manifest = same content by hash — see [paint-tool-vip-positions.md](../history/archive/paint-tool-vip-positions.md).) in live mode we must be compositing state for the **same** frame that the user is seeing. If the core pushes state at the wrong moment (e.g. at the start of the next frame, after it has overwritten the draw list), we’d be one frame ahead or behind. **Next:** Track and show the **VIP state frame number** (state.frameNumber from the core) and, if possible, compare it to the “display frame” from the emulator to see if we’re in sync. Deduplicate-draws had no visible effect, which is consistent with the problem being **which** frame we’re drawing (state vs display), not duplicate entries within one frame. **Frame sync next steps:** (1) The app now shows **VIP state frame** in the status line (e.g. "VIP: 7405 draws · frame 12345"). (2) Open question: **when** in the core's frame lifecycle does it call __VB_PUSH_VIP_STATE__? If at the start of the next frame, we'd receive next frame's positions while the display is still the previous frame. (3) If the emulator exposes a "display frame", we could compare it to state.frameNumber to confirm sync.

**Double draw / ghost after -4:** With BG X offset **-4**, the skull tile is in the correct place, but a **second copy** (thickened outlines, blurred edges) remains on the skull, basket, clouds, and stars. So we have two issues: (1) **position** — fixed by -4 for scrolling BG; (2) **duplicate/ghost** — something is still drawing the same content twice with a small offset. Possible causes: (a) **Duplicate draws in the list** — the core may push the same tile at (x,y) and (x±1,y) or (x,y±1), or the same tile in multiple strips with slightly different x; (b) **Color layer composited twice** (e.g. stereo merge or blit path); (c) **Mono and color misaligned by 1 px** so both show at edges. **Confirmed:** Log duplicate draws reported **296 exact duplicate draws** (same tileIndex, x, y, eye) and **1258 near-duplicate pairs** (same tile within 2 px). The app has a **Deduplicate draws (fix ghost)** checkbox in the Color debug panel: when on, we only composite the first occurrence of each (tileIndex, x, y, eye), which removes the double draw from those duplicates. Turn it on to reduce or eliminate the ghost; a proper fix would be the core not emitting duplicates.

**If "OBJ X offset -8" has no visible effect (e.g. ghost is on BG):** The offset is applied only to draws with **layer === 2** (OBJ). If the core does not set `layer` on draw calls, no draws get the offset and toggling the checkbox will not change the image. (1) Click **Color layer debug** (or in the console run `reportColorLayerDebug()`). Check the logged counts: if **OBJ (layer 2)** is 0, the core is not tagging layers. (2) Enable **"Apply offset to all draws (debug)"** together with OBJ X offset -8; the whole color layer will shift left 8 px. If you see that shift, the code path works and the issue is missing layer tags from the core. Next step would be to add `layer` to the core’s draw list (0=BG, 1=Affine, 2=OBJ) when pushing each draw, then re-test the OBJ-only offset.

**References:** Draw list layer (BG vs Affine vs OBJ); [vip-state.md](../reference/vip-state.md), [sprite-alignment-investigation.md](../history/archive/sprite-alignment-investigation.md).

---

## 3. Affine layer (rotation/distortion)

**Status (Oct 2026): built.** Affine worlds are sampled pixel by pixel from display RAM the way the
VIP does it (`src/affine-world.js`), so tile paint follows the zoom in the emulator and both tools;
groups find scaled tiles the core never recorded through stand-in draws; SpriteStudio shows a scaled
group's **Base tiles** (`src/affine-base.js`) and overpaint works on scaled layers. The notes below
are the original investigation; the HD question is still open.

**Observed:** Affine layer is used (e.g. Mario Tennis court lines). Our colorized system has **no concept of how affines work**. Open question: can we ever do an **HD art pack** if rotation/distortion of tiles would look terrible at higher resolution?

**Goals:**
- Understand how the emulator core handles affine draws (transform, rasterization, sampling).
- Decide what our color layer can do: match affine with 8×8 tile lookup and transformed blit, or accept that affine stays mono until we have a better approach.
- Assess impact on HD/upscaled art: whether affine distortion is compatible with higher-res tile art or requires a different strategy.

**Investigation:** Deep dive into core affine path (VIP or libretro); capture frames that use affine (e.g. Mario Tennis court); document transform and how we could feed our pack into it; evaluate scaling/HD implications. This is intentionally **after** the sprite-first image import/export workflow we want to prioritize in the paint tool.

**References:** Core source (Beetle VB affine); [vip-rendering-validated.md](../reference/vip-rendering-validated.md); [phase2-and-next-detailed-plan.md](../history/archive/phase2-and-next-detailed-plan.md) for HD/art-pack ideas.

---

## 4. Tile editor: more than 16 colors (color wheel) — later

**Goal:** Support many more than 16 colors in the tile editor (e.g. color wheel / full RGB picker) for richer art.

**Status:** **Deferred** until graphics glitches above are in a good place. Keeping as a longer-term goal so we don’t forget.

**References:** [paint-editor-use-cases.md](../history/archive/paint-editor-use-cases.md), [pack-editor-backlog.md](../history/archive/pack-editor-backlog.md).

---

## Priority order

1. **Fading/opacity/brightness** — Affects all screens and transitions; high visual impact.
2. **Animated BG artifacting** — Fixes obvious corruption on moving BG tiles.
3. ~~**Affine investigation**~~ — built Oct 2026 (see §3).
4. **Tile editor color wheel** — After 1–3 are under control.

---

## References

- [development-journey.md](../history/development-journey.md) — Checkpoint and backlog.
- [priorities-and-next.md](priorities-and-next.md) — Next steps summary.
- [current-state-and-next-steps.md](../history/archive/current-state-and-next-steps.md) — Current state.
