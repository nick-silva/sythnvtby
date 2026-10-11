# Paint tool: work breakdown (canvas, Select All, groups, override)

Logical order to tackle the reported issues without breaking the current UX until we intentionally change it.

---

## Phase 1: Fix existing bugs (no UX change)

### 1.1 Canvas still twice as wide
- **Goal:** Main frame canvas displays at single-eye width (384px), not ~768px.
- **Check:** Where is the paint tool loaded (standalone tools/paint.html vs embedded)? Is the canvas or its container getting a width from elsewhere? Inspect computed style, any JS that sets width/height or scale.
- **Fix:** Ensure canvas intrinsic size and display size are 384×224; remove or override any doubling (e.g. stereo or “both eyes” layout).

### 1.2 Select All selects “matching tile” instead of all visible
- **Goal:** “Select all” = every draw currently rendered on the canvas (respecting eye, layer, world, group visibility), not “all draws that match the currently selected tile’s hash.”
- **Check:** Confirm `btn-select-all` handler and `getVisibleDrawIndices`; ensure nothing filters by `selectedTileHash` or current draw when building the selection.
- **Fix:** Select All adds every index in `getVisibleDrawIndices(...)` to `selectedDrawIndices` with no extra filter.

---

## Phase 2: Group management

### 2.1 Delete group + confirm
- **Goal:** Each group has a **Delete** control. Click → confirmation dialog (“Delete group ‘X’? Overrides for this group will remain.”) → on confirm, remove group from `groups`, update UI, re-render.
- **No undo yet** (Phase 2.2).

### 2.2 Undo for group delete (or confirm-only)
- **Goal:** Either (A) “Delete group” is undoable (e.g. Ctrl+Z restores last deleted group), or (B) confirm-only with no undo. User asked for “confirm group delete (or undo Ctrl-Z)”. Prefer confirm first; add undo if cheap (e.g. push deleted group to an undo stack, Ctrl+Z restores last deleted).

---

## Phase 3: Override button clarity + group selection model

### 3.1 What the Override button does
- **Goal:** User understands: “Override = use current pack colors for this group’s tiles everywhere (and when we have RAM, only when the group’s RAM conditions match).”
- **Options:** (A) Short tooltip/label on the button; (B) small “?” or info that expands a line of help; (C) optional “Override” panel that lists group + conditionals and explains. Start with (A)+(B); panel only if needed.
- **Design doc:** [override-panel-design.md](override-panel-design.md) describes how the override panel is supposed to work (flow and planned panel behavior).

### 3.2 Selected group (exclusive) + checkbox meaning
- **Goal:** One group can be “selected” at a time. The **checkbox** in front of each group = “select this group” (exclusive). Selecting a group means: (1) it’s the paint target, (2) canvas can show only that group’s draws (so you’re clearly painting “just that group”).
- **Conflict with current UX:** Today the checkbox is “eye” = visibility filter (multiple groups can be “on”). Changing to “select (exclusive)” removes multi-group visibility. **Decision:** Checkbox = **selected for painting** (exclusive). When no group is selected, canvas shows all draws (current “All” behavior). When one group is selected, canvas shows only that group’s draws and painting applies to that group. If we later need “show multiple groups,” we can add a separate “Show: All | Group A | Group B” dropdown.

### 3.3 Easy to deselect a group
- **Goal:** One-click way to deselect: e.g. click the selected group’s checkbox again to turn it off, or a “None” / “Deselect group” control so no group is selected.

---

## Phase 4: Tile painter group-aware

### 4.1 Painting when a group is selected
- **Goal:** When a group **is** selected, painting applies only to that group: world IDs + tile hashes (and layers) for that group. So either:
  - **Option A:** Every paint (pack update) also creates/updates **overrides** for the selected group (full-frame, groupId set) for the painted hash; or
  - **Option B:** Pack is global, but “Apply” in the tile painter when a group is selected writes to overrides for that group instead of (or in addition to) the pack.
- **Recommendation (updated):** When a group is selected, treat “apply” as “set color for this group’s use of this tile”: **write only the group override** for that hash (full-frame, groupId). Keep the pack unchanged so shared hashes elsewhere are unaffected. When no group is selected, painting updates the pack (global).

### 4.2 No group selected
- **Goal:** When no group is selected, painting behaves as today (pack only, or pack + position override if user chose “this position only”).

---

## Order of implementation

| Step | Item | Breaks existing? | Status |
|------|------|------------------|--------|
| 1 | Canvas width fix (1.1) | No | Done: scene-wrap max-width 384px, canvas !important 384×224 |
| 2 | Select All fix (1.2) | No | Done: getVisibleDrawIndices(..., { useGroupFilter: false }) for Select all |
| 3 | Delete group + confirm (2.1) | No | Done: Delete button + confirm dialog |
| 4 | Override button label/help (3.1) | No | Done: Groups section blurb + button title |
| 5 | Checkbox = exclusive “selected group”; deselect (3.2, 3.3) | Yes – multi-group “eye” goes away | Done: group checkbox selects paint target; “None” clears |
| 6 | Tile painter group-aware (4.1, 4.2) | No (additive when group selected) | Done: painting with group selected writes group override only (pack unchanged) |
| 7 | Undo for group delete (2.2) | No | Not started |

Do **1 → 2 → 3 → 4** first (fixes + delete + clarity). Then **5** (selection model) and **6** (painter) together, then **7** if we want undo.
