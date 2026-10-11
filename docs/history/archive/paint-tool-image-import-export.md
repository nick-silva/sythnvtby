# Paint tool: image import/export (sprite-first workflow)

**Status:** Implemented (v1). Staging canvas + draggable selection + “Copy to Tile Editor” are in place, and the paint tool can export the current scene to `vbpack art_exports/` for round-tripping in external image editors.
Remaining (backlog): optional 8×8 pick workflow on staging, stricter edge-case handling, and HD-pack variants / affine-correct import-export.

It builds on the existing paint-on-game editor design ([paint-on-game-editor-design.md](paint-on-game-editor-design.md)), overrides flow ([paint-tool-overrides-flow.md](paint-tool-overrides-flow.md)), and use-case matrix ([paint-editor-use-cases.md](paint-editor-use-cases.md)).

---

## 1. Goals and scope

- **Primary goal (sprite-first):** Make it easy to **round-trip art between an external image editor and the paint tool** for sprite-based scenes:
  - **Export:** The **entire scene canvas** (384×224) with the **current group filter** applied — so you get exactly what you see (full frame, or only the selected group’s draws).
  - Edit in an external tool (e.g. Aseprite, Photoshop, Krita).
  - **Import:** A **separate import workspace** (its own canvas) where you load a source image, **stage and offset it** to align with the scene, then use the staging canvas (see below) to align and "Copy to Tile Editor." Staging canvas shows a copy of the scene; selection on main → same-sized movable selection on staging; copy from staging into selected tiles. You can also pick 8×8 regions on staging and copy to the current tile. Export path: vbpack subdirectory (art_exports); group name in filename.
- **Main canvas selection → tile editor + staging:** Selecting an **active region** on the main canvas updates the **tile editor** to show that many tiles (dynamic N×M). The same size appears as a **selection box on the staging canvas** (movable) so you can align the import and then "Copy to Tile Editor."
- **Future (HD packs):** Same workflow; higher-resolution imports, still align to sprites in the group and "Copy to Tile Editor."
- **Out of scope (for this design):**
  - Affine-correct rendering or HD-affine support.
  - Arbitrary large canvas painting disconnected from tiles.
  - General “paint over entire screen bitmap” workflows.

We stay strictly **tile/grid-aligned** and build image import/export on top of the existing “tile + pack/override” model.

---

## 2. Mental model (how users should think about it)

- The **scene** is still a grid of **8×8 tiles** (by hash) drawn at positions from VIP state. You **select a region** on the main canvas (N×M tiles).
- The **tile editor** shows the tiles in that **active region** (dynamic N×M) and is where you edit **per-tile RGBA** (pack or group overrides).
- **Staging canvas** = A **copy of the entire scene**. Load imported art on top, **offset** to align. The **main canvas selection** (N×M) appears as a **same-sized selection box on the staging canvas** (movable). **"Copy to Tile Editor"** copies pixels under that box into the selected tiles. You can also **pick 8×8 regions** from the staging canvas and copy into the **current tile** in the tile editor.
- **Export** = What you see on the scene canvas (384×224, group filter). Files in **vbpack art_exports**; filenames include **group name**.

Main selection drives tile editor context and staging box size; staging is where you align and choose what to copy; Copy to Tile Editor commits.

---

## 2b. Main canvas selection and tile editor (implementation foundation)

We **start with this work** so a dynamic selection populates the selection area (tile editor + staging selection box). The following defines how the user sets the active selection and how the tile editor displays it.

### Defining the active selection on the main canvas

Support **both** of these ways to define the selection rectangle (in tile coordinates, then converted to the active N×M tile region):

1. **Drag to size:** Click and drag on the main canvas to draw a rectangle (marquee). On mouse release, the selection is the bounding box in tile coordinates (e.g. 4×3 tiles). This is the primary, quick way to select a region.
2. **Click then shift-click (two corners):** Click once to set the first corner (in pixel or tile space). Shift-click to set the opposite corner. The selection is the rectangle between those two corners (in tile coordinates). Useful for precise or large regions without dragging.

The **active selection area** is always a rectangle in tile space (N×M tiles). It drives:
- The **tile editor** (see below).
- The **staging canvas** selection box (same N×M, movable).

### Tile editor layout: adjacent tiles, no grid style

- **Remove** the current grid-style layout (e.g. 3×3 with gaps or per-cell framing). Do **not** show tiles as a grid of separate cells.
- **Render tiles adjacent to each other** with no gaps: the tile editor shows the selected region as one contiguous block of 8×8 tiles laid out in rows (e.g. N tiles wide × M tiles high = N×8 pixels wide, M×8 pixels high). So the “painter” area is a single canvas of size (N×8)×(M×8) for the selected N×M tiles.
- The **size** of this canvas is **dynamic**: it is exactly the number of tiles in the **active selection** (N×M). No fixed 3×3; the selection defines the dimensions.
- When there is no selection (or empty selection), behavior is TBD (e.g. show a single 8×8 tile, or prompt to select).

This gives a single contiguous editing surface for the whole selection and sets up the staging “Copy to Tile Editor” flow (selection on main = same shape in tile editor and on staging).

### Paint bucket: fill across the selected area

- **Paint bucket** should **not** be limited to a single 8×8 tile. It should fill **all adjacent pixels** (same color / fillable) **within the selected area**—i.e. the bucket operates on the whole N×M tile region as one contiguous pixel surface. So if the user has selected a 4×3 region, the bucket can flood across tile boundaries and fill the entire 32×24 area (or the connected component of matching pixels within it).
- Optionally provide a toggle (e.g. “Fill only current tile” vs “Fill across selection”) to restrict fill to one 8×8 tile when desired; **default** = fill across selection.

### Implementation order

1. **First:** Implement **main canvas selection** (drag-to-size + click then shift-click) so the user can define an active N×M region.
2. **Then:** Make the **tile editor** show that many tiles **adjacent** (no grid style), so the “selection area” is populated and the tile editor size is driven by the selection.
3. **Then:** Ensure **paint bucket** fills adjacent pixels across the selected area (and optional single-tile toggle).
4. Staging canvas and “Copy to Tile Editor” build on this: same-sized selection box on staging, copy from staging into the selected tiles.

---

## 3. Target workflows

### 3.0 End-to-end workflow (groups → export → colorize elsewhere → import → Copy to Tile Editor)

1. **Create groups** for the sprites/regions you care about.
2. **Export each group** as an image: select group → "Export scene" → PNG saved under **vbpack art_exports/** with **group name in the filename** (e.g. `gameId-Mario-scene.png`).
3. **Take the vbpack** to another machine; use image tools and/or AI to **colorize** the art; save as you like.
4. **Back in the paint tool:** Open the **Import / staging** area. Staging canvas shows a **copy of the entire scene**. **Load** the colorized image on top; use **offset X/Y** to **align** it with the scene copy.
5. **Select the region** on the main canvas that corresponds to the group (or tiles to update). A **same-sized selection box** appears on the staging canvas; **move it** over the aligned imported art.
6. **"Copy to Tile Editor"** copies pixels under that staging selection into the selected tiles (pack or group overrides by current group). Save and Play as usual.

**HD packs (future):** Same workflow; higher-resolution imports, still align to sprites in the group and "Copy to Tile Editor."

### 3.1 Export (v1)

1. **Set the scene** (load frame, optional pack/overrides).
2. **Optionally select a group** so the canvas shows only that group’s draws (rest of frame not drawn, or transparent).
3. Click **“Export scene”** (or equivalent).
4. **Result:** A single PNG, **384×224**, matching the current scene canvas:
   - **No group selected:** Full frame as rendered (all layers, pack/overrides/2bpp).
   - **Group selected:** Only that group’s draws rendered; everywhere else is transparent (or a solid background, TBD).

Export region for v1 is **always the entire canvas** with the **current group filter** applied. Files go under **vbpack art_exports/**; filenames include **group name** when a group is selected.

### 3.2 Import (v1) — staging canvas (scene copy + selection + Copy to Tile Editor)

1. Open the **Import / staging** area. The **staging canvas** shows a **copy of the entire scene** from the main canvas (reference layer).
2. **Load a source image** (e.g. the colorized PNG). It is drawn on top of the scene copy. Use **offset X / offset Y** to **align** the imported art with the scene copy.
3. On the **main canvas**, **select a region** (N×M tiles) that you want to update. The **tile editor** shows that many tiles (dynamic). A **same-sized selection box** appears on the **staging canvas**; you can **move** it to sit over the aligned imported art.
4. **"Copy to Tile Editor"** copies the pixels under that staging selection into the selected tiles (pack or group overrides by current group selection). Scene and pack/overrides update.
5. **Optional:** You can also **select an 8×8 region** on the staging canvas and copy it into the **current tile** in the tile editor (single-tile paste).

Staging canvas = scene copy + imported layer; alignment and selection happen there; Copy to Tile Editor commits. Source image need not be exactly 384×224; offset handles alignment.

### 3.3 Multi-frame sprite reuse (later)

Once multi-frame VIP workflows are smooth: export/import on one frame updates pack or group overrides by hash, so the same tile(s) can appear updated on other frames that use those hashes. No extra design needed for v1.

---

## 4. What exactly we import/export

### 4.1 Export (v1: full canvas + group filter)

- **Region:** Always the **entire scene canvas** — 384×224 pixels. No tile-region picker for v1.
- **Group filter:** Same as the current paint-tool behavior:
  - **No group selected:** Scene shows all draws (eye + layer + world filters only). Export = that full frame.
  - **Group selected:** Scene shows only draws that match the selected group. Export = 384×224 with only those draws rendered; pixels outside any drawn tile are **transparent** (or a configurable background, e.g. black or checkerboard for visibility).
- **Pixel source per pixel:** Same as scene render — resolve override (group or position) → pack → 2bpp fallback.
- **Format:** PNG (lossless, alpha). **Path:** always under **vbpack art_exports/** (subdirectory of the vbpack). **Filename:** include **group name** for context, e.g. `gameId-groupName-scene.png` when a group is selected; `gameId-scene.png` when no group.

### 4.2 Import (v1: staging canvas = scene copy + offset + selection + Copy to Tile Editor)

- **Staging canvas:** A **separate canvas** (384×224 to match the scene). It shows a **copy of the entire scene** from the main canvas (reference layer). The user's **source image** is drawn **on top** of this copy; it is **not** the main scene canvas.
- **Load image:** User picks a file (PNG, etc.). The image is drawn on top of the scene copy. **Offset X / Offset Y** shift the image so the user can **align** it with the scene copy (and thus with the tile grid).
- **Main canvas selection:** When the user **selects a region** (N×M tiles) on the main canvas, (1) the **tile editor** shows that many tiles (dynamic), and (2) a **same-sized selection box** appears on the **staging canvas**. The user can **move** this box (e.g. drag) to sit over the aligned imported art.
- **Copy to Tile Editor:** One action. For each tile in the **main canvas selection**, we take the tile at the **same relative position** under the **staging selection box** (on the staging canvas) and write it to that tile (pack or group overrides by current group selection). So we copy from staging → selected tiles. Transparency preserved (alpha 0 stays transparent).
- **8×8 pick (optional):** User can **select a single 8×8 region** on the staging canvas and copy it into the **current tile** in the tile editor (one-tile paste).
- **Edge cases:** No image loaded on staging → staging canvas is just the scene copy, so “Copy to Tile Editor” re-applies what you already see. If the staging box extends outside the staging canvas or the image doesn't cover a cell, skip that cell (so you don't overwrite with garbage).

---

## 5. UI changes (high-level)

**Main canvas + tile editor:**

- **Main canvas:** User can **select a region** (N×M tiles) on the scene. That selection drives (1) the **tile editor** to show that many tiles (dynamic N×M), and (2) a **same-sized selection box** on the staging canvas (see below).
- The **tile editor** shows the tiles in the **active region** as **adjacent 8×8 tiles** (no grid-style layout; one contiguous canvas of size N×8 by M×8 for an N×M selection). Palette, tools (brush, **bucket fills across the selected area**), "Apply to: pack vs override", group-paint hints. Optional: **pick 8×8** from the staging canvas and copy into a tile in the selection.
- **Export (v1):** One button, e.g. **"Export scene"**, in the paint tool area. Saves under **vbpack art_exports/** with **group name in filename** when a group is selected. Tooltip: "Export current scene (384×224) as PNG. Uses current group filter." No region picker in v1 — always full canvas.

**Import / staging (separate workspace):**

- **Staging canvas:** A dedicated canvas (384×224) that shows a **copy of the entire scene** from the main canvas. The **source image** (loaded by the user) is drawn **on top**; **Offset X / Offset Y** let the user **align** it with the scene copy.
- **Selection box:** Same size as the **main canvas selection** (N×M tiles); user can **move** it on the staging canvas to sit over the aligned imported art.
- **"Copy to Tile Editor"** button: copies the pixels under the staging selection box into the selected tiles (pack or group overrides by current group selection).
- **8×8 pick (optional):** Select a single 8×8 region on the staging canvas and copy into the **current tile** in the tile editor.
- Optional: **grid overlay** (8×8) on the staging canvas; group-paint hint: "Applies to pack (no group) or to selected group overrides."

Keep the UI **minimal**: export = one button; staging = scene copy + load + offset + selection box + Copy to Tile Editor (+ optional 8×8 pick).

---

## 6. Interaction with groups and overrides

Group-aware painting is already implemented:

- With **no group selected**:
  - Painting updates the **pack** only.
- With a **group selected**:
  - Painting updates **group overrides** (pack unchanged).

Image import/export should follow the same rule:

- **Export**:
  - Always reflects what you currently see: group overrides (if any) → pack entries → 2bpp fallback.
- **Import**:
  - With no group selected: update **pack** for the tiles’ hashes.
  - With a group selected: update **group overrides** for those hashes (pack unchanged).

This keeps the mental model consistent: **selection determines scope** (global vs group), and image I/O observes that scope.

---

## 7. Edge cases and constraints

- **Shared hashes across game:** If you import art for a tile whose hash is used elsewhere:
  - **No group selected:** The new art appears **everywhere** that hash appears (intended behavior).
  - **Group selected:** Only draws that match the group’s criteria (worldIds/layers/hashes) use the new art; others continue using pack colors.
- **Region includes tiles not in group:** When a group is selected, it may be visually sensible to **export/import only tiles that actually belong to the group**, or:
  - Option A (simple): include all tiles in the rectangular region; group-scoped imports simply don’t affect non-group tiles (they don’t get a `groupId` override).
  - Option B (stricter): restrict the region to “tiles in this group” (plus empty areas).
- **Mis-sized imports:** If the user feeds a PNG that isn’t the right size, we should:
  - Detect it.
  - Show a precise error: “Expected W×H; got W'×H'.”
  - Not partially apply any changes.

---

## 8. Affine and future HD concerns (non-goals for this doc)

Affine-specific behavior is **explicitly backlogged**:

- We will treat affine draws the same as other tiles for now:
  - If they show up in the selected region, exports will include them as they currently render (likely “wrong” for rotated/skewed tiles).
  - Imports will update the underlying tile hashes / overrides, but we are not promising affine-correct warping here.
- A future **Affine design doc** will define how we:
  - Gather affine parameters from VIP state.
  - Decide whether to do VIP-style sampling or some hybrid.
  - Integrate affine-aware fills (e.g. Mario Tennis grass/lines) and shader-like effects.

For now, this document is about **sprites and static BG** workflows.

---

## 9. Open questions / v1 decisions

- **Export v1:** Decided — region = **entire canvas** (384×224) with **current group filter**; files under **vbpack art_exports/**; **group name in filename** for context.
- **Import v1:** Decided — **staging canvas** = **copy of entire scene**; user loads image on top, **offset X/Y** to align; **main canvas selection** drives **tile editor** (dynamic N×M) and **same-sized selection box on staging** (movable); **"Copy to Tile Editor"** copies from staging selection into selected tiles. Optional: **8×8 pick** from staging into current tile.
- **Main canvas selection:** Decided — selecting a region on the main canvas updates the tile editor to show that many tiles and shows a same-sized selection box on the staging canvas that the user can move.
- **Default copy target:** When no group is selected, Copy to Tile Editor updates **pack**; when a group is selected, updates **group overrides** (same as painting).
- **Group + copy:** When a group is selected, we only write overrides for tiles that belong to that group (selection can still be any region; we only commit to tiles that are in the group). Non-group tiles in the selection are skipped or TBD.
- **HD packs (future):** Same workflow; higher-resolution imports; still align and "Copy to Tile Editor."
- **Selection + tile editor + bucket:** Decided — selection via **drag to size** and **click then shift-click** (two corners); tile editor = **adjacent tiles** (no grid style), size = selection; **paint bucket** fills across the selected area. Implementation order: (1) main canvas selection, (2) tile editor adjacent layout, (3) bucket across selection, then staging/Copy to Tile Editor. See §2b.


