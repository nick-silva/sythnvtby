# Paint tool: user flow for position overrides

This doc designs how to add **override authoring** to the paint-on-game tool without confusing users who only want to paint the pack (one color per tile everywhere).

**Note:** The painter supports **Load pack** for both **.vbcolor** and **.vbpack**. A loaded `.vbpack` may include optional ROM and VIP/save state; the painter can use it when present. **Export .vbpack** includes ROM when the painter has it (e.g. when coming from Colorize!/Save and Play), otherwise it omits ROM. VIP state in vbpack is Phase B.

---

## 1. Mental model (keep it simple)

| Concept | Meaning |
|--------|--------|
| **Pack** | One color per tile (by hash). When you paint and apply to the pack, **every** place that tile appears gets that color. |
| **Override** | “This tile (same hash) but **only at this spot** on screen gets a different color.” The spot = one 8×8 cell (the selected draw’s position). |

So the only extra idea we introduce is: **where does this paint apply?** — everywhere (pack) or this position only (override).

---

## 2. One control: “Apply to”

Add a single, clear control in the **tile painter** section (next to the canvas or right below “Draws at click”):

- **Apply to: [ Everywhere (pack) | This position only (override) ]**

- **Default:** “Everywhere (pack)” — current behavior. No change for users who never touch overrides.
- **“This position only (override)”:** When the user paints and commits (stroke end), we **do not** write to the pack for that hash; we **add or update an override** for the selected draw’s 8×8 cell. The scene should still show the override color in that cell (so we need to render overrides in the paint tool’s scene view as well).

Wording avoids the word “override” in the primary label; “This position only” is self-explanatory. Tooltip or short hint: “Saved as an override; export as a separate .json file.”

---

## 3. Flow (step by step)

1. User loads vbstate (and optionally pack). Scene renders.
2. User clicks scene → picks a draw from the stack. Tile painter shows that tile.
3. **Optional:** User switches “Apply to” to **“This position only (override)”** if they want this spot to differ from the rest.
4. User paints in the 128×128 canvas as today (same palette, same stroke → commit).
5. **On stroke end (commit):**
   - If **Everywhere (pack):** `pack.set(hash, editBuffer)` and redraw scene (current behavior).
   - If **This position only (override):** Compute rect from selected draw: `xMin = d.x`, `yMin = d.y`, `xMax = d.x+8`, `yMax = d.y+8`. Add or replace an override entry `{ hash, xMin, yMin, xMax, yMax, rgbaBase64 }` in the in-memory override list. Do **not** write to pack. Redraw scene (so the override is visible in that cell).
6. Scene render in paint tool: when drawing a cell, if there’s an override matching (hash, draw.x, draw.y), use the override’s RGBA for that 8×8; else use pack (or 2bpp). So overrides “win” in the scene view.
7. **Export:** Two actions:
   - **Export .vbcolor** — pack only (unchanged). Use in emulator as “Color pack”.
   - **Export overrides** — JSON file (array of override entries). Only enabled when there is at least one override. User loads this in the emulator as “Overrides (optional)”.

Result: one place to choose scope (“Apply to”), same painting UX, two export files. No extra steps unless the user wants a position-only change.

---

## 4. Avoid confusion: UI details

- **Single control:** One radio group or dropdown: “Apply to: Everywhere (pack) | This position only (override)”. Not two separate modes elsewhere.
- **Placement:** In the tile painter section, e.g. directly under the “Draws at click” list or above the 128×128 canvas. Visible whenever a draw is selected.
- **Feedback:**
  - When “This position only” is selected, optionally show a short hint: “This paint will apply only at the selected tile’s position.”
  - In status line (or small badge): “Overrides: N” when N > 0, so they know they have overrides to export.
- **Export overrides button:** Label: “Export overrides .json” (or “Export overrides”). Disabled when override list is empty. Tooltip: “Load this file in the emulator as ‘Overrides (optional)’.”
- **No mixing in one file for v1:** Pack = .vbcolor, overrides = .json. User loads both in the emulator. Keeps the mental model clear and matches current main app (two inputs).

---

## 5. Override list (optional for v1)

A small “Overrides” list (hash + rect, delete button) is nice for power users but not required for the first version. Minimum viable flow:

- Apply to: Everywhere | This position only  
- Paint → commit (to pack or override)  
- Export .vbcolor / Export overrides  

If we add a list later: show “N overrides” and each entry “Hash 0x… at (x,y)”. Click to select that draw and edit; delete to remove. For v1, we can skip the list and only show “Overrides: N” in status.

---

## 6. Edge cases

- **Override for a tile with no pack entry:** Allowed. The override carries its own RGBA. In the emulator, that position gets color from the override; other positions with the same hash get nothing (or pack if we add one later).
- **Same position, paint again in override mode:** Replace the existing override for (hash, this rect) with the new RGBA. One override per (hash, rect).
- **Switch “Apply to” after painting:** Only affects the **next** commit. Already-committed pack or override is unchanged.
- **Load overrides in paint tool:** Optional later. For v1 we only **create and export** overrides; we don’t need to load an existing overrides file in the paint tool (user can edit JSON by hand if needed).

---

## 7. Override highlighting (scene viewer)

A **toggle** in the paint tool: “Highlight override tiles”. When on, the scene view draws a visible indicator (e.g. outline or tint) on every 8×8 cell that has a position override for the tile drawn there. This gives clear feedback on which tiles were modified via the override mechanism. Toggle off = normal scene. Implement by: after rendering the frame, for each draw, if an override exists for (hash, draw.x, draw.y), draw a rectangle or overlay (e.g. semi-transparent border) around that cell.

---

## 8. Single pack file (art pack)

Overrides (and pack + ROM) can be stored in a **single .vbpack file** (zip with `rom`, `color.vbcolor`, `overrides.json`, `manifest.json`). See [art-pack-file-format.md](../../reference/art-pack-file-format.md). Then:

- **Export:** “Export .vbpack” produces one file (pack + overrides + optional ROM + manifest).
- **Load:** Main app (and paint tool) can “Load pack” and get ROM + color pack + overrides in one step.

The “Apply to” flow and override highlighting stay the same; only persistence becomes “inside .vbpack” instead of separate files. The painter can **Load pack** (vbcolor + overrides + optional VIP state) and **Export .vbpack**; in the full **Colorize!** workflow (see docs/design/colorize-workflow-vision.md), the painter is entered from the emulator with the current frame’s VIP state and returns an updated vbpack via “Save and Play”.

---

## 9. Summary

| What | How |
|------|-----|
| **One extra concept** | “Apply to: Everywhere vs This position only.” |
| **One control** | “Apply to: Everywhere (pack) \| This position only (override)” in tile painter. |
| **Same painting** | Paint and commit as today; scope depends on “Apply to”. |
| **Exports** | “Export .vbcolor” (pack), “Export overrides” (JSON), or “Export .vbpack” (single file: pack + overrides + optional ROM + manifest). |
| **Scene in paint tool** | When rendering, use override RGBA for (hash, x, y) if an override exists; else pack. |
| **Override highlighting** | Toggle “Highlight override tiles” to show which cells use overrides (outline/tint on scene). |

This keeps the flow simple and avoids confusing users who only use the pack.
