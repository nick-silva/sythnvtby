# Paint tool: VIP positions, manifest, and BG/OBJ

This doc clarifies how the paint tool (and viewer) use VIP state for positions and tile content, and what we can or can’t infer about “offset” (e.g. scrolling BG) from the state. Relevant to the live-emulator ghost and the question of whether we should align BG tiles to a “manifest” grid.

---

## How the paint tool gets positions and tile content

- **Positions:** For every draw we use **(x, y) directly from the draw list** — `x0 = call.x`, `y0 = call.y`. We do **not** apply any offset (no -4 for BG, no -8 for OBJ) in the paint tool. So we draw each tile exactly where the core said it was when we captured the frame.
- **Tile content:** We read the 16-byte tile from the **pattern table** of the captured state: `getTileBytes(patternTable, call.tileIndex)`, then hash it and look up the pack (or draw with palette). So the **8×8 pixels** we’re painting are the same tile **content** that would be in the manifest — the manifest is built from pattern-table dumps and keyed by the same content hash. So “painting tiles as they appear in the manifest” is true for **content**: we’re painting the same 8×8 shapes. The **position** is whatever the core put in the draw list at capture time.

So: **the “offset being used by the game at the moment we freeze” is represented** — we use the core’s (x, y) as-is. If the core at that moment pushed (x+4, y) for a scrolling BG tile, we’d have captured (x+4, y) and we’d draw there in the paint tool. For a **single** snapshot there’s no second buffer, so we don’t see a ghost; we might see the tile 4 px shifted if the core’s x was wrong, but the paint tool would still look consistent because everything is from one frame.

---

## OBJ (sprites) in the paint tool

- We treat **OBJ the same as BG**: we use **(x, y) from the draw list** with **no** offset. We do not apply any OBJ-specific offset (e.g. -8) in the paint tool. So OBJ and BG are both “raw” positions from the VIP state. If the core’s OBJ positions are correct in the snapshot, the paint tool will look correct; if the live app needs an OBJ offset, that’s a separate fix for the **streaming** path, not something we change in the paint tool.

---

## Can we tell from VIP state that a BG tile is “offset” (e.g. HBias)?

- **No.** The VIP state we receive has: pattern table, OAM, segments, windows, draw list (tileIndex, x, y, flips, layer, strip, eye, …). It does **not** include “this draw used HBias” or “this world has per-scanline X.” That information lives in the **world config** in DRAM (e.g. BGM_* mode, param_base) which the core uses when drawing, but we don’t get a per-draw “HBias” flag in the state. So we cannot, from the state alone, know which BG draws are “offset” by the game. A proper fix would be either (a) the core tagging draws with world index or “HBias” so we could apply logic per draw, or (b) fixing the core so the draw list is emitted at the right time / with the right x so we don’t need to guess.

---

## Should we “line up” BG tiles to the manifest (e.g. snap to 8×8 grid)?

- The **manifest** has no positions — it’s a list of **(hash, tile bytes)**. So “line up to the manifest” can only mean one of:
  - **Content:** The 8×8 we paint is the manifest tile (same hash). We already do that: we use pattern table → hash → pack.
  - **Position:** Snap (x, y) to tile boundaries: e.g. use `(floor(x/8)*8, floor(y/8)*8)` for BG so every tile is drawn at a multiple of 8. That would **change** where we draw. If the core sometimes reports (x+4, y), snapping would move the tile 4 px left and might align it to a “grid,” but it could also **misalign** with the reference (screenshot or mono) we’re painting over, and could overlap adjacent tiles. So it’s a tradeoff; we don’t do it by default. If we ever add a “snap BG to grid” option, we’d document that it can misalign with the reference.

---

## HBias / VBias and the pattern table

- **HBias and VBias do not modify the pattern table.** They are **display-time scroll offsets**: the hardware uses them to shift which part of the background is visible per scanline. The **pattern table** is just the 32KB of tile bitmap data (VRAM). The game can overwrite it (e.g. for animated tiles), but scroll bias doesn’t change its contents. So when we “store the pattern table unmodified,” we mean: keep a **snapshot** at a chosen moment (e.g. when the ROM/pack first loads, or when we first load state in the paint tool) and use that for tile lookups so we’re editing **stable** tile content rather than whatever the current frame has in VRAM.

---

## Reference pattern table (unmodified baseline)

- **Main app:** When we first receive VIP state (core push) or when we load a vbpack, we store a **copy** of the pattern table in `referencePatternTable` and keep it separate. It is not overwritten by later frames. This gives the app (and future handoff to the paint tool) a stable “at load” baseline.
- **Paint tool:** We keep a **reference pattern table** that is set when we **first load state** (from vbpack, file, or handoff) and left unchanged when we switch frames. Optionally the user can click **“Set reference to current”** to refresh it from the current frame.
- **Toggle “Use reference pattern table”:** When **on** (default), the paint tool uses the **reference** pattern table for all tile content (hash and display). So we edit colors for the tiles as they were at reference time; when the game loads, the pack keys (hashes) match that baseline and there’s no weirdness from an “offset” or animated frame. When **off**, we use the **current frame’s** pattern table — useful for animated tiles where the same tile index can point to different content each frame.
- So: the paint tool can **modify the color pack** keyed by the **original** (reference) pattern table; when everything loads we use that same baseline and avoid mismatch.

---

## “Manifest raw (without game modifications)” in the paint tool

- The **pattern table** we get in a captured frame **is** whatever the game has in VRAM at that moment — so it’s already “game modified.” The **manifest** (tile list by content hash) is built from one or more such dumps. With the **reference pattern table** we now have a stored “unmodified” snapshot: we use it (when the toggle is on) so that the tiles we paint are the ones we consider canonical for this load. That’s as close as we get to “manifest raw” without having initial ROM VRAM. Other options:
  - **Tileset view:** Optionally show the pattern table as a **grid** (tile 0 at (0,0), …) so the user can pick tiles by **index**. That could be a future “raw tileset” mode.
  - For now, the paint tool uses the **draw list** for positions and the **reference** (or current) pattern table for content; same hash as manifest.

---

## Summary

| Question | Answer |
|----------|--------|
| Are we painting tiles as in the manifest (content)? | Yes — we use pattern table → hash; same as manifest. |
| Is the game’s offset at freeze time represented? | Yes — we use draw list (x, y) as-is; no extra offset. |
| Do we apply BG or OBJ offset in the paint tool? | No. Both use raw (x, y) from the draw list. |
| Can we tell from VIP state if a BG tile is “offset” (HBias)? | No. State has no per-draw HBias or world config. |
| Snap BG to 8×8 grid? | Not done by default; would be an option with caveats (misalign with reference). |
| “Manifest raw” in paint tool? | We store a **reference** pattern table (set when state is first loaded; optional “Set reference to current”). With “Use reference” on we edit that baseline so pack keys match at load. |
| HBias/VBias modify pattern table? | No. They’re display scroll offsets; pattern table is just VRAM. Reference = snapshot at a chosen moment for stable lookups. |
