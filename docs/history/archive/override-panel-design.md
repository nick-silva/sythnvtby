# Override panel: how it’s supposed to work

This doc describes how the **override panel** (group-based overrides UX) is supposed to work: where it lives, what the user does, and how it relates to the tile painter and the emulator. It complements [group-override-design.md](../../design/group-override-design.md) and [paint-tool-group-work-breakdown.md](paint-tool-group-work-breakdown.md).

---

## 1. What the override panel is

- **Today:** The “override” UX lives in the **Groups** section of the paint tool. For each group you get:
  - **Override** button — “Use pack colors for this group everywhere” (creates overrides with `groupId`).
  - **Delete** / **Duplicate** (and Add/Remove selection).
  - Expanded **group details**: worlds, hashes count, layers, draws this frame.
- **Goal:** We may add a dedicated **Override panel** that centralizes override authoring (per-group overrides, later RAM, per-hash color edit) and reduce or remove override controls from the tile painter. For now, “override panel” means this **group-based override flow** (group list + Override button + future panel).

So: **override panel** = the place where the user configures **group overrides** (and optionally position overrides). Right now that place is the Groups section; later it can be a separate panel that opens when you select a group or click “Override.”

---

## 2. How group overrides are supposed to work

### 2.1 Mental model

- **Pack** = one color per tile (hash) for the whole game.
- **Group override** = “for every draw that belongs to this group, use this color instead of the pack.” So the same tile (hash) can have one color in general and a different color for “Blimp” (and another for “Blimp level 2” if you duplicate the group and set different RAM/override).

### 2.2 Intended flow (current + near-term)

1. **Create a group** (e.g. “Blimp”): add draws to the group (world + hashes ± layers).
2. **Select the group** for painting so the canvas shows only that group’s draws.
3. **Paint tiles**. With a group selected, painting creates/updates a **group override** for the current tile hash (pack is unchanged), so shared hashes elsewhere in the game are unaffected.
4. **Optional: “Override / Create from pack”**. You can also create group overrides for *all* hashes in the group by copying the current pack colors into group overrides. That:
   - Removes any existing overrides for this group (`groupId === group.id`).
   - For each hash in the group’s criteria, if the pack has a color for that hash, adds one override: `{ hash, groupId, xMin:0, yMin:0, xMax:384, yMax:224, rgba }` (full-frame; optional `layer` if group has a single layer).
5. **Result:** Every draw that matches the group (same world, same hash in group, same layer if specified) uses the override color — in the **paint tool** and in the **emulator** (runtime honors `groupId`).

### 2.3 Why “Override” might seem not to work (group overrides)

- **“Create from pack” needs pack colors first.** If the group has hashes that aren’t in the pack yet, those hashes are skipped (and the status line says “N hash(es) not in pack”). In the current workflow you can avoid this by painting with the group selected (which writes group overrides directly).
- **Paint tool rendering:** The paint tool uses `resolveOverride(hash, x, y, layer, draw)` and passes the current `draw`. Overrides with `groupId` are applied only when `drawMatchesGroup(draw, group, hash)` is true. So in the paint tool, group overrides should already affect only that group’s draws — **if** the correct group and draw are passed through. Any bug here would make overrides not show or show for the wrong draws.
- **Emulator (main app):** The main app’s color layer now receives groups and evaluates `groupId`, so group overrides should apply at runtime once the vbpack is reloaded.

So “override not working for groups” is expected in the **emulator** until we wire groups/draw into the main app; in the **paint tool** it should work if the pack has colors and the resolve path is correct.

---

## 3. Override panel behavior (current and planned)

### 3.1 Current (Groups section)

| Action | Effect |
|--------|--------|
| **Override** button | Creates/updates overrides for this group from the pack (one per hash in group; full-frame; `groupId` set). Hashes not in pack are skipped. |
| **Duplicate** | Copy group; user can then set different RAM (future) and click Override on the copy for a different color set. |
| **Delete** | Remove group; overrides that reference this `groupId` remain in the override list (they simply won’t match any group). |

There is no separate “override list per group” in the UI yet; the status line reports “Override for group X: N tile(s).”

### 3.2 Planned (override panel / next steps)

- **Override panel** (or expanded group override section):
  - When a group is selected (or “Override” is clicked), show:
    - Which overrides exist for this group (hash → color, or “from pack”).
    - Option to **create from pack** (bulk-create for the group).
    - Option to **edit color per hash** (override only for this group) without repainting in the tile painter.
  - **RAM on group:** Group can have `ramConditions`; override applies only when RAM matches. UI to add/edit RAM conditions is future work; data shape exists.
- **Tile painter:** When a group is selected, painting updates the **group override** for that hash (pack unchanged), so the user can paint the scene/group without affecting shared hashes elsewhere.
- **Ditching “stuff in the tile painter”:** The long-term direction is to centralize override authoring in the override panel (or group override UI) and keep the tile painter focused on painting the pack (and optionally applying to the selected group’s overrides in one action).

---

## 4. Relation to other docs

- **[group-override-design.md](../../design/group-override-design.md)** — Group override scope, RAM on group, “Override for this group” as primary UX, duplicate group, implementation status.
- **[paint-tool-overrides-flow.md](paint-tool-overrides-flow.md)** — Position overrides (“Apply to: Everywhere | This position only”) and export.
- **[paint-tool-group-work-breakdown.md](paint-tool-group-work-breakdown.md)** — Phases: Select All, delete group, Override clarity, checkbox = selected group, tile painter group-aware, undo.
- **[conditional-overrides-design.md](../../design/conditional-overrides-design.md)** — Override shape (hash, rect, layer, RAM, etc.) and conditional logic.

---

## 5. Summary

- **Override panel** = where the user configures group overrides (today: Groups section + Override button; later: possibly a dedicated panel).
- **Flow:** Create group → paint tiles (pack) → click **Override** to create overrides for that group from the pack. Group overrides apply in the paint tool when the resolve path has draw + group; they do **not** yet apply in the emulator until the main app color layer gets groups + draw.
- **Next:** Implement override panel (or richer group-override UI), wire groupId into the emulator color layer, and (optionally) make the tile painter group-aware so painting with a group selected updates that group’s overrides.
