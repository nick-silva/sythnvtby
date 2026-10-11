# Paint tool: groups (window id, multi-select, filter) — implementation spec

This spec turns the [tile-groups-requirements](../../design/tile-groups-requirements.md) into concrete paint-tool behavior and data shapes. It covers window id exposure, filter-by-window, multi-select, Add/Remove from group, and a RAM-condition stub.

> Terminology note: the core draw payload still exposes `draw.world`; in project docs/UI we call this **window**. Data shape key should be `windowIds` (legacy `worldIds` still read for compatibility).

---

## 1. Groups vs overrides (design decision)

**We keep the existing override system and extend it.**

- **Overrides** stay as they are: hash + optional position (rect) + optional layer. They define “this tile (and optionally this area/layer) gets this color.”
- **Groups** are named sets of draws (criteria: world ids, hashes, layers, optional RAM). They do **not** replace overrides.
- **Override scope by group:** An override entry gets an optional **`groupId`** (string). When present, the override applies only when: (1) hash/layer/position match as today, and (2) the draw is in the specified group. So you can have “same hash, color A when in group Blimp, color B when in group Clouds.”

So: **groups = scope for overrides**. Override resolution (in color layer and paint tool) will later check “is this draw in group X?” when the override has `groupId`; that requires `drawMatchesGroup(draw, group)` once we have groups and world in the draw list.

---

## 2. Window id in the pipeline

- **DrawCall** (vip-state, vip-dump): add optional **`world`** (0..31) from core and present it in UI/docs as **window id**.
- **Paint tool:** Show window id wherever we show draw info: draw stack list (“#42 tile 5 **Win3** BG”), status line, tooltip. If `d.world == null` → show “—”.
- **Filter by window:** Effectively “filter by draw order” (window 31 = back, 0 = front). When “Show window(s): All” we render and hit-test the full draw list. When “Show window(s): 3, 5” we only render and hit-test draws where `d.world` is in {3, 5}. If no draws have window (all undefined), window filter is “All” only.

---

## 3. Feature list (requirements)

| Feature | Description |
|--------|-------------|
| **World id in UI** | Show `world` (0..31 or “—”) in draw stack, status, and tooltips. |
| **Filter by world** | Control to restrict which draws are visible and clickable (e.g. “All” or “World 0”, “World 1”, … multi-select or single). Only draws with selected world(s) are rendered and in hit-test. |
| **Group select mode** | A mode (e.g. toolbar toggle “Paint” vs “Group select”) where canvas clicks change **selection** instead of loading the tile into the painter. |
| **Multi-select** | In Group select mode: **click** = add the topmost draw at that pixel to the selection; **Shift+click** = remove that draw from the selection. Selection is a set of draw indices. |
| **Select all** | When filtered by world(s), “Select all” = select all currently visible draws (all that pass the world filter). |
| **Add to group** | From current selection, merge selection’s window ids, **hashes**, and layers into group G’s criteria. **Each tile hash belongs to at most one group:** those hashes are **removed** from every other group’s `criteria.hashes`. |
| **Remove from group** | From current selection, remove those window ids / hashes / layers from group G’s criteria. |
| **Duplicate group** | Copies window/layer filters (and RAM stub) to a new group but **not** hashes — re-add tiles so ownership is explicit (avoids two groups owning the same shape). |
| **Group list UI** | List of groups: name, visibility (eye), “Add selection to this group”, “Remove selection from this group”. Create / rename / delete group. |
| **RAM condition stub** | Group can have optional **ramConditions**: e.g. `{ "0x0500": 0 }`. Stored and shown in UI (“RAM 0x0500 == 0”); not evaluated until we have RAM from the core. |

---

## 4. Data shapes

### 4.1 DrawCall (vip-state.js, vip-dump.js)

- Add **`world`**: `number | undefined`, 0..31. Omit when serializing if undefined; deserialize to undefined if missing.

### 4.2 Group (groups.json / vbpack)

```json
{
  "id": "blimp",
  "name": "Blimp",
  "criteria": {
    "worldIds": [3, 5],
    "hashes": [12345, 67890],
    "layers": [0, 2]
  },
  "ramConditions": { "0x0500": 0 }
}
```

- **id:** Unique string (e.g. slug).
- **name:** Display name.
- **criteria:** One set of rules: draw is in group if `(window in windowIds or windowIds empty)` and `(hash in hashes or hashes empty)` and `(layer in layers or layers empty)`. Empty array = “no filter” (so all windows / all hashes / all layers). For v1 we can treat “empty” as “any” so that adding only window 5 gives windowIds [5] and hashes/layers empty = “any hash, any layer, window 5”.
- **Exclusive hashes:** Each **hash** in `criteria.hashes` should appear in **at most one** group. The paint tool **Add** operation removes newly added hashes from other groups. **Duplicate** copies window/layer only (empty hashes) so the user re-assigns. Groups with **no** hashes but with window/layer criteria only can still overlap until hashes are assigned (parent/subgroups are not implemented).
- **ramConditions:** Stub. Map address string → value; “RAM at address === value”. Not used for matching until we have RAM snapshot.

### 4.3 Override entry (extended)

- Add optional **groupId**: string (group id). When set, override applies only when the draw is in that group (and hash/layer/position match).

### 4.4 vbpack

- Add **groups.json** in the ZIP (same level as overrides.json). Format: `{ "groups": [ { id, name, criteria, ramConditions? }, ... ] }`. Load/save with pack; paint tool and (later) main app load it.

---

## 5. Paint tool behavior (concrete)

### 5.1 Modes

- **Paint mode (default):** Click sets single selection and loads that draw’s tile into the painter (current behavior). Draw stack shows stack at pixel; clicking a stack entry selects that draw.
- **Group select mode:** Click adds topmost draw at pixel to selection; Shift+click removes that draw from selection. Selection is shown (e.g. count, or list of indices). “Select all” = all visible (world-filtered) draws.

### 5.2 World filter

- Control: e.g. “Show world:” dropdown “All” | “0” | “1” | … | “31”, or multi-select (checkboxes) for “Show worlds: 0, 3, 5”. When not “All”, `visibleDrawIndices` = draws where `d.world` is in the selected set (or `d.world == null` → include only when we decide; for v1 “All” only if any draw has no world).
- Render: only draw tiles whose index is in `visibleDrawIndices`. Hit-test: only consider those draws. Status: “Showing world(s) 3, 5” or “Showing all worlds”.

### 5.3 Selection (multi)

- **selectedDrawIndices:** Set or array of draw indices (e.g. `Set<number>`).
- In Paint mode: selection is always size 0 or 1; we can keep `selectedDrawIndex` (single) and treat “selection” as that one when in Paint mode, or unify to “selection = array/set” and paint mode uses selection[0] for “current draw”.
- In Group select mode: selection can be multiple. UI: “3 tiles selected”, “Select all”, “Add to group …”, “Remove from group …”.

### 5.4 Add to group / Remove from group

- **Add selection to group G:** For each selected draw d: add d.world to G.criteria.worldIds (if not already), add d’s tile hash to G.criteria.hashes, add d.layer to G.criteria.layers. Persist groups (e.g. in-memory and on Export vbpack).
- **Remove selection from group G:** For each selected draw d: remove d.world from G.criteria.worldIds, remove d’s hash from G.criteria.hashes, remove d.layer from G.criteria.layers. Persist.

### 5.5 Group list UI

- List groups (name, eye for visibility). Visibility: when at least one group has eye on, show only draws that match **any** visible group (and pass world filter). When “Show all” or no eyes on, show all (subject to world filter only).
- Buttons per group or global: “Add selection to [group]”, “Remove selection from [group]”. “New group”, “Rename”, “Delete”.
- RAM stub: in group edit (or in a small “Conditions” expander per group): “RAM: address 0x____ = value ____” (optional). Stored in group.ramConditions; not evaluated yet.

---

## 6. What you might be missing (checklist)

- **Visibility vs filter:** Two concepts: (1) **World filter** = “show only draws from these worlds” (draw-order isolation). (2) **Group visibility** = “show only draws that belong to at least one of these groups” (e.g. “Blimp” + “Sky” on, “Clouds” off). Both can be active: first apply world filter, then group visibility on the remaining draws. So we need both controls.
- **Default “Show all”:** When no group has visibility on, we show all draws (subject to world filter). When at least one group has visibility on, we show only draws that match any visible group (and world filter). So “all groups off” = show all.
- **Persistence:** Groups live in vbpack as groups.json. When loading a vbpack we load groups; when exporting we include the current groups. Standalone “Load overrides” doesn’t load groups unless we add “Load groups” or bundle them.
- **Override + groupId:** Resolving overrides in the paint tool (for “which color does this draw use?”) will need to load groups and call drawMatchesGroup(draw, group) when an override has groupId. So we need that helper and to pass groups into the resolve function. Same in the main app color layer when we add groupId support there.

---

## 7. Design choices for your input

1. **Click in Group select:** Should a single click add the **topmost** draw at that pixel, or **all** draws in the stack at that pixel? Proposal: **topmost only**; user can click repeatedly (or use “Select all” when filtered by world) to add more.
2. **World filter UI:** Single dropdown “Show world: All | 0 | 1 | …” vs multi-select “Show worlds: ☐0 ☐1 … ☐31”? Multi-select is more flexible (e.g. “3 and 5 only”); dropdown is simpler. Proposal: **multi-select** (checkboxes or a multi-select list) so “Blimp (world 3+5) only” is one click.
3. **Group visibility vs world filter order:** When both “Show world: 5” and “Group Blimp (eye on)” are active: do we (A) take draws in world 5, then among those show only those in Blimp, or (B) show draws in Blimp, then among those show only world 5? Proposal: **World filter first**, then group visibility. So “Show world 5” narrows to world 5; “Blimp on” then further restricts to “draw in Blimp” (which might be world 3 and 5). So visible = (world in selected worlds) AND (draw in any visible group). If no group has eye on, second condition is “all”.
4. **Where to put “Group select” mode:** Toolbar toggle “Mode: Paint | Group select”, or a separate “Groups” panel with “Select tiles for grouping” that implicitly switches behavior when that panel is active? Proposal: **Toolbar toggle** so it’s explicit and visible.

---

## 8. Implementation order (suggested)

1. **World in DrawCall and vip-dump** — Add `world` to typedef and serialize/deserialize; paint tool can show “—” when undefined.
2. **Paint tool: show world** — In draw stack, status, tooltip show world id.
3. **Paint tool: world filter** — Add “Show world(s)” control; filter draw list for render and hit-test; when no world on draws, only “All”.
4. **Paint tool: multi-select state** — `selectedDrawIndices: Set<number>`; in Group select mode, click adds, Shift+click removes; “Select all” = all visible draws. Show selection count and highlight selected draws on canvas.
5. **Groups data and list UI** — In-memory `groups: Group[]`; load/save groups.json in vbpack; side panel with group list, eye, Add/Remove from group, New/Rename/Delete. Stub ramConditions in shape and UI.
6. **Add to group / Remove from group** — Implement merge and subtract of criteria from selection.
7. **Override groupId** — Add groupId to override shape; in resolve, when override has groupId, require draw to be in that group (drawMatchesGroup); wire in paint tool and (later) main app.

Once you confirm the design choices in §7 (or adjust them), implementation can follow this order.

---

## World id and “only All shows draws”

If your VIP state was captured from a core that **does not** push **world** on each draw, then every draw has `world === undefined`. The world filter then:

- **All** — Shows all draws (no world filter). This is the only option that shows anything.
- **W0**, **W1**, … — Show only draws where `d.world === that number`. Since no draw has world set, nothing passes the filter and the canvas is empty.

So “only the top checkbox (All) makes anything render” is expected until the **core is patched** to add `world` (0..31) to each draw in the draw list. After that, capturing a **fresh VIP state** (e.g. Save VIP state from the patched emulator, or a new vbpack with frames captured from that build) will give you world ids; the world filter will then isolate by draw order (e.g. “W3 and W5 only” for the blimp).

**Recommendation:** Use a **fresh vbpack** and **fresh VIP states** captured from a build that includes the world-id patch when you want to test world filter and group-by-world. Until then, groups can still use **hashes + layers** (and the world filter will effectively be “All” only).
