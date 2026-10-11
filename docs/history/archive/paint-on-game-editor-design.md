# Paint-on-game editor: design (Phase 1C)

**Status: Archived.** The paint-on-game editor was built (tools/paint.html). Kept for development archive. See [README.md](../../README.md).

---

This document locks the design for the paint-on-game editor before implementation. It builds on the viewer, aligns with the prior Phase 1C requirements, and incorporates the workflow you described: click → list of draws at that location → pick one → tile painter with context grid → full RGB painting → live scene update → export .vbcolor.

**Do not start building until this design is agreed.**

---

## 1. High-level requirements (rundown)

| # | Requirement | Notes |
|---|-------------|--------|
| 1 | **Build from viewer** | Use the viewer as template or shared base: same load vbstate, same draw-order render, same hit-test (click → list of draws at pixel). |
| 2 | **Two inputs** | (1) **vbstate.json** (required) — frozen frame. (2) **.vbcolor** (optional) — existing pack to continue editing; first time = vbstate only, export creates the file. |
| 3 | **Scene view** | One main canvas showing the **entire frame** in draw order. When a pack is loaded, draw pack colors where we have entries; otherwise use 4-color palette (or captured GPLT) so the user sees the 2bpp shape. Same as viewer. |
| 4 | **Selection flow** | Click on scene → get **list of draws** at that (x,y), back-to-front → user **picks one** from the list → that draw becomes the **edited tile** and appears in the tile painter. |
| 5 | **Tile painter widget** | Dedicated area for editing **one** tile (the selected draw). Shows that tile plus a **context grid** of surrounding tiles (up to 8×8) so large sprites can be worked on. |
| 6 | **Per-cell layer in painter** | At each cell in the context grid, multiple draws can exist (stacked). User must be able to **choose which draw/layer** to display for that cell (so context is correct for the sprite they’re coloring). |
| 7 | **Painting model** | **Full RGB** in the painter. User selects from a **palette of colors** and paints pixels. No VB 4-shade mapping when painting; the pack stores 8×8 RGBA per tile. |
| 8 | **Live scene update** | As the user paints, the **scene view** (full frame) updates so they see the result in context. Update policy TBD below (per-pixel vs per-stroke). |
| 9 | **Export** | Export .vbcolor (full pack: all entries). Emulator loads it and shows colored tiles in Color mode for that frame (and any other frame that uses the same tile hashes). |
| 10 | **Settings + menu** | Load vbstate, Load pack, Export pack, Settings; persist (e.g. localStorage) palette, zoom, etc. |

---

## 2. Alignment with prior plan and your additions

- **“4 display colors + presets” (prior plan)** — Used **only for the scene view** when there is no pack entry for a tile (so the user sees the 2bpp shape). In the **tile painter**, we do **not** use VB palette mapping: the user picks from an arbitrary color palette and paints full RGBA. So: scene = 4-color or captured GPLT for uncolored tiles; painter = full RGB. No contradiction.
- **Selection (prior: “hit-test, show which draw”)** — Refined to: click → **list** of all draws at that pixel (back-to-front) → user **selects one** from the list as the tile to edit. The viewer already computes this list on click; we reuse it and add a small “stack” UI to pick which draw.
- **“Brush strokes in screen space” (prior)** — We interpret this as: painting happens **in the tile painter** (pixel-by-pixel on the 8×8 tile), not by brushing on the scene. The scene is for **selection and preview**; the painter is for **editing**. Strokes in the painter update the pack entry for that tile’s hash; the scene then redraws and shows the new color for that tile everywhere it appears.
- **Layer filter (prior)** — Applies to the **scene** (show/hide draw-order bands so you can click through clutter). The **per-cell layer** in the painter is separate: it’s “which draw do I show in this grid cell?” for context only.

---

## 3. UI layout (conceptual)

```
┌─────────────────────────────────────────────────────────────────┐
│  Menu: Load vbstate | Load pack | Export .vbcolor | Settings     │
├─────────────────────────────────────────────────────────────────┤
│  Scene view (full frame)                                         │
│  - Same as viewer: draw order, pack overlay or 4-color          │
│  - Click → list of draws at (x,y) → pick one                     │
│  - Zoom, layer filter (scene layers)                               │
├──────────────────────┬──────────────────────────────────────────┤
│  Draw stack at click │  Tile painter                             │
│  - Draw #42 (top)    │  - 8×8 grid of tiles (1 edited + context) │
│  - Draw #38         │  - Per-cell: which layer to show (picker)  │
│  - Draw #12         │  - Editable tile: 8×8 pixels, zoomed      │
│  [Pick]             │  - Color palette (full RGB)                │
│                     │  - Paint on the edited tile only           │
└──────────────────────┴──────────────────────────────────────────┘
```

- **Scene view:** Same coordinate system and draw order as viewer; optional pack overlay; click to select.
- **Draw stack:** List of draws at the clicked pixel (back-to-front). User clicks one → that becomes the “edited” draw; its tile appears in the painter.
- **Tile painter:** One “active” tile (the selected draw) + context grid (e.g. 8×8). Each cell can show a different layer; one cell is the one being painted.

---

## 4. Selection flow (detailed)

1. User loads vbstate (and optionally pack). Scene renders.
2. User clicks on the scene at pixel (px, py).
3. **Hit-test:** Walk draw list (e.g. back-to-front, filtered by current eye/layer filter). For each draw that contains (px, py), add to list. Result: **ordered list of draws at that location** (e.g. “Draw #42, #38, #12”).
4. **Draw stack UI:** Show that list (e.g. “3 draws: #42 (OBJ), #38 (Affine), #12 (BG)”). User clicks one (e.g. #38) → **edited draw index = 38**.
5. **Tile painter:** The tile for draw #38 is the **edited tile**. It is shown in the painter (e.g. in the center of an 8×8 grid, or in a dedicated 8×8 edit area). The rest of the 8×8 grid shows **context tiles** (neighboring (tx, ty) in the scene). For each context cell we need to decide which draw to show (per-cell layer).

---

## 5. Tile painter: 8×8 grid and per-cell layer

- **Grid meaning:** The grid is in **tile coordinates**. Each cell is one (tx, ty) = (x/8, y/8) in VB space. The **edited tile** is one cell (the one corresponding to the selected draw’s (tx, ty)). The other cells are **neighbors** (e.g. tx±1..±4, ty±1..±4) so we have up to 8×8 cells total.
- **Centering:** For example, if the selected draw is at (tx, ty) = (20, 10), the grid could show (tx-3..tx+4, ty-3..ty+4) so the edited tile is near the center. Grid size could be fixed 8×8 or configurable (e.g. 4×4, 8×8); 8×8 is the max you mentioned.
- **Multiple draws per cell:** At any (tx, ty) there can be 0, 1, or several draws (different layers). So each **cell** has a “which draw do I show?” choice.
  - **Option A — Per-cell dropdown:** Each cell has a small control (e.g. “Layer” or “Draw”) with options: “None”, “Draw #42 (OBJ)”, “Draw #38 (Affine)”, … for draws that cover that (tx, ty). Default: e.g. “topmost” draw at that cell.
  - **Option B — Single “context layer” for whole grid:** One global control: “Show layer: BG / Affine / OBJ” for all context cells. Simpler but less flexible when sprites mix layers.
  - **Option C — Per-cell cycle:** Each cell shows one draw; click cell to cycle through the draws at that (tx, ty). No dropdown; compact.

**Recommendation:** Start with **Option A** (per-cell dropdown or small “layer” picker per cell) so the user can see exactly the sprite they care about in context. If 8×8 = 64 cells feels noisy, we can default to “topmost” for all cells and only show the picker when the user clicks “Customize context” or on a specific cell. **Open choice:** default to topmost per cell and add “edit layer for this cell” on click, vs always showing a compact layer control per cell.

- **Which cell is “edited”:** Exactly one cell is the **active** tile (the one we’re painting). That’s the cell for the **selected draw**. Painting applies only to that tile’s hash; the pack entry for that hash is updated. Other cells in the grid are **read-only context**.

---

## 6. Painting model (no VB palette in painter)

- **Color palette:** User has a palette of N colors (e.g. 16, 32, or a swatch list). They pick one as “current color” and paint on the 8×8 edited tile. Each pixel of the tile is stored as RGBA in the pack (256 bytes per tile). No mapping to VB’s 4 levels in the painter.
- **Transparency:** One of the palette colors should be “transparent” (alpha 0 or a designated index). Painting with that sets the pixel transparent so the monochrome (or lower layer) shows through at runtime.
- **Initial tile content when first painted:** When the user first selects a draw that has **no** pack entry yet, the tile in the painter can be shown as (a) the 2bpp tile rendered with a default 4-color ramp (so they see the shape), or (b) blank/checkerboard. Painting then fills in RGBA. The pack entry is created on first paint (hash → 256-byte RGBA). **Recommendation:** (a) so they see the tile shape immediately.

---

## 7. Live scene update: when to redraw the full frame

- **Option A — Per pixel:** Every pixel painted in the tile painter triggers a pack update and a full scene redraw. Simple but can be expensive for large draw lists.
- **Option B — Per stroke:** On **mouse up** (end of a brush stroke) in the tile painter, write the tile’s 256-byte RGBA to the pack and redraw the scene once. Smooth while drawing; one update per stroke.
- **Option C — On “blur” or “done”:** Only when the user switches selection or clicks “Apply” do we update the pack and scene. Fewer redraws; less immediate feedback.
- **Option D — Debounced:** After any paint change, set a timer (e.g. 100–200 ms); on timeout, update pack and redraw scene. Balances responsiveness and performance.

**Recommendation:** **Per stroke (Option B)** by default: on stroke end in the tile painter, update the pack entry and redraw the scene. Optionally add a “Live update: every stroke / every pixel / off” in Settings for power users. **Open choice:** default per-stroke with optional “update on every pixel” for small packs.

---

## 8. Data flow summary

- **vbstate** → pattern table, drawList (with x, y, tileIndex, flipH, flipV, eye, layer, etc.). Deserialize once on load; read-only.
- **Pack** → in-memory map `hash → 256-byte RGBA`. Load from .vbcolor or start empty. Updated when user paints (per stroke or per pixel). Export writes full pack to .vbcolor.
- **Scene render:** For each draw in drawList (filtered by eye/layer), get tile from pattern table, hash it; if hash in pack, draw pack’s RGBA; else draw 2bpp with 4-color palette (or GPLT). Same as viewer + pack overlay.
- **Hit-test:** Same as viewer: (px, py) → list of draws (back-to-front) that contain that pixel.
- **Tile painter:** Edited draw → tileIndex → pattern table → 16-byte tile → hash. Pack[hash] = 256-byte RGBA; painting modifies that buffer; on commit (stroke end), scene re-renders so all draws using that hash show the new color.

---

## 9. Resolved and open design choices

**Resolved:**

- Build from viewer (reuse load, render, hit-test).
- Selection: click → list of draws at location → user picks one → that tile is edited in the painter.
- Tile painter: one edited tile + context grid (up to 8×8); per-cell layer selection for context tiles.
- Painting: full RGB in painter; no VB palette mapping there; scene uses 4-color or GPLT only for tiles with no pack entry.
- Scene updates when pack changes; update on stroke end by default.

**Open (to lock before implementation):**

| Topic | Options | Suggestion |
|-------|---------|------------|
| Per-cell layer UX | Dropdown per cell vs single “context layer” vs per-cell cycle on click | Per-cell control; default “topmost”; show layer picker on cell click or “Customize context” to avoid 64 dropdowns. |
| Grid size | Fixed 8×8 vs 4×4 / 6×6 / 8×8 choice | Fixed 8×8 for v1. |
| First paint of new tile | Show 2bpp shape with default ramp vs blank | Show 2bpp shape so user sees the tile. |
| Live update | Per stroke vs per pixel vs debounced vs off | Per stroke; optional “every pixel” in settings. |
| Where edited tile sits in grid | Center of 8×8 vs top-left vs configurable | Center (e.g. index 3,3 or 4,4 so 4 tiles left/above, 3–4 right/below). |

---

## 10. Contradictions removed

- **“Brush strokes in screen space”** — We do **not** paint by brushing on the scene. We paint in the **tile painter** on the 8×8 tile; the scene is for selection and live preview. Pack updates are keyed by tile hash (one entry per unique tile content).
- **“4 display colors”** — Only the **scene** uses 4-color (or GPLT) for tiles without a pack entry. The **painter** uses a full RGB palette.
- **Layer filter** — Scene layer filter (show/hide BG/Affine/OBJ) is independent of per-cell “which draw to show” in the painter grid.

---

## 11. Exit criteria (reminder)

- Load vbstate (and optional pack) → scene renders; click → draw stack → pick one → tile painter shows that tile + 8×8 context with per-cell layer choice.
- Paint in painter with full RGB palette → pack updates; scene updates (at least per stroke).
- Export .vbcolor → file loads in emulator; Color mode shows painted tiles in correct positions and order.
- Settings (e.g. palette, zoom) persist; menu: Load vbstate, Load pack, Export, Settings.

Once the open choices in §9 are decided, this design is ready for implementation.

---

## 12. Clear path to .vbcolor and first test

**Path:** Paint-on-game keeps an in-memory pack (Map: hash → 256-byte RGBA). When the user exports, we call `buildVBColorPack(gameId, pack)` and trigger a file download. The **main emulator** already loads .vbcolor via the same format (`parseVBColorPack`); when Display is set to **Color**, it composites pack tiles over the monochrome frame.

**First test (recommended early check):**
1. Open the paint-on-game tool (`/tools/paint.html`).
2. Load a vbstate.json (from "Save VIP state" in the emulator).
3. (Optional) Load an existing .vbcolor to extend it.
4. Set Game ID (e.g. `my-game`), click **Export .vbcolor**.
5. In the main app: load the same ROM, load the downloaded .vbcolor file, set Display to **Color**.
6. Run the game (or advance to the same frame). You should see: no crash; where the pack has entries, colored tiles; where it doesn’t, monochrome. An **empty pack** (0 entries) is valid—export and load it to confirm the emulator accepts the file and shows mono only.
