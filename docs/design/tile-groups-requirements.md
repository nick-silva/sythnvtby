---
status: partial
last-reviewed: 2026-10-09
covers: tools/painter/groups.js
---

# Tile / draw groups: requirements and tradeoffs

**Status (Oct 2026):** met — groups (worlds + patterns ± layers) are the core of both tools; see
[group-override-design.md](group-override-design.md) for how they were built and
[art-pack-file-format.md](../reference/art-pack-file-format.md) §6.4 for the format.

This doc captures the requirement to **group related draws** (e.g. “the blimp” as one logical layer) so we can scope overrides to a group and, in the paint tool, **toggle groups on/off** like Photoshop layers. It builds on [conditional-overrides-design.md](conditional-overrides-design.md) (layer, RAM, preview).

---

## VIP draw order and "world" (the integer that groups a set of tiles)

There's useful semantic overlap in the word "layer." Here we mean two things:

- **Layer (type)** — What we already have: **layer** in the draw list = 0 (BG), 1 (Affine), 2 (OBJ). That's the **kind** of draw (background tile vs affine vs sprite).
- **Draw order / logical layer** — Which **set** of BG (or OBJ) tiles renders together and on top of which others. That's determined by the VIP's **world** (window) index.

The VIP has **32 worlds** (windows). Rendering order is:

1. For each **strip** (0..27, top to bottom, 8 rows each).
2. For each **world** from **31 down to 0** (back to front). So **world 31** is drawn first (back), **world 0** last (front).
3. Within a world, the VIP draws either BG tiles (from a segment), Affine, or OBJ (sprites from OAM), depending on that world's mode.

So **world index (0..31)** is exactly the integer that answers "which set of BG (or OBJ) tiles is part of the same larger asset." The blimp might be drawn as **world 5** (one BG world) plus **world 3** (one OBJ world for animated parts); the clouds might be **world 8**. When one BG passes over another, it's because they're **different worlds** — the one with the **smaller** world index is drawn later and appears on top. So draw order when BGs pass over each other is **not** extra-complicated: it's fixed per frame by world order (31→0).

**What we have today:** Draw order is exposed to the color layer **only by the order of entries** in the draw list: the core pushes draws in the same order the VIP renders (strip 0..27, then within each strip world 31→0), so we iterate the array front-to-back and later draws composite on top. We get correct visual layering but **no per-draw world id**. The draw list has **layer** (0/1/2) and **strip** (0..27); it does **not** currently have **world** (0..31). The core builds the list inside `VIP_DrawBlock` → `DrawBG` / `DrawAffine` / `DrawOBJ`; the loop over `world` (31→0) is in that same function, so the core **could** tag each push with the current **world** index. Adding **world** to the draw list (core change) would give us a stable, per-draw "logical layer" id: then "group Blimp" could be "world in [5, 3]" (for example), and we wouldn't need to infer groups only from hash+layer.

**Recommendation:** Add **world** (0..31) to the draw list in the core (and to our DrawCall / vbstate format). Then group criteria can include **world** (or a set of world indices), so "all draws from world 5 and world 3" = one group (e.g. blimp) without relying only on hash+layer. See [vip-rendering-validated.md](../reference/vip-rendering-validated.md) for where to hook and the exact loop.

---

## Scene / game state (when "which scene" matters)

Groups are per-pack. But **which** group a draw belongs to can depend on **scene** (e.g. intro vs level 1). The same world index might be used for different logical content on different screens; we might want "group Blimp" only on the intro screen.

- **Scene** isn't in the draw list — it's game state (RAM or inferred from savestate/frame). So we need a way to say "this group (or this override) applies only when we're in scene X." That's what **RAM conditions** (and optionally savestate/frame) are for: e.g. "level ID at 0x0500 === 0" = intro. So a group could be defined as: **world in [5, 3] AND (optional) RAM scene condition**. Then "group Blimp" = world in [5, 3] when RAM says intro; the same world indices on another scene wouldn't get the blimp group.
- **Mesen** doesn't have a "world" id like the VB; the NES has name tables and a priority bit. So Mesen uses **conditions** to disambiguate: **memoryCheckConstant** (RAM address vs constant) for "which level/screen," **tileNearby** / **tileAtPosition** for "is this tile next to / at the same place as this other tile," and **bgpriority** for sprite priority. So they effectively infer "which logical layer" from context (neighbors, position, RAM). We can **steal** the idea of combining **scene (RAM)** with **world (draw list)**:
  - **VB:** Use **world** from the draw list (once we add it) as the main "which set of tiles" id, and **RAM** (when we have it) for "which scene." So group criteria = world set + optional RAM conditions. No need for tileNearby for the blimp case if world alone separates blimp (world 5,3) from clouds (world 8).
  - **Fallback:** If we don't add world yet, we're back to hash+layer+position or neighbor (Mesen-style) to define groups.

So: **v1 with world in draw list** = groups can be "world in [ … ]" and optionally "when RAM scene = …". **v1 without world** = we rely on hash+layer and maybe position band until the core exposes world.

---

## Use case: blimp as one “layer”

On the Mario Clash intro screen:

- The **blimp** is made of many **BG tiles** plus a few **OBJ tiles** (animated parts). They draw as one coherent object over the rest of the scene (sky, clouds, text).
- **Same tile, different context:** Solid block tiles are shared — used in the blimp and in the **clouds** at the bottom. We already added **layer** and “everywhere this layer” so we can target “all BG uses of this hash” (blimp + clouds together) or “all OBJ uses.” That’s not enough when **both** blimp and clouds are BG: we need “this override only for draws that are **part of the blimp**,” not every BG draw with that hash.
- So we need a way to define **“the blimp”** as a set of draws (across frames) and then:
  1. **Override scope:** Apply overrides only to draws that belong to group “Blimp.”
  2. **Paint tool:** Toggle “show only group Blimp” (or “Blimp + Sky”) so we can paint and assign overrides without the rest of the scene in the way; and manage which draws belong to which group.

So groups are the missing link: **named sets of draws** that the override system and paint tool can use.

---

## Goals

1. **Group definition** — A group has a **name** (e.g. “Blimp”) and **criteria** that define which draws belong to it. Criteria must work across frames (so when the blimp moves, draws that form the blimp still match).
2. **Override scope** — An override can optionally be scoped to a **group**: “this override applies only when the draw is in group X.” So we can have “solid tile, color A when in group Blimp, color B when in group Clouds” even though both use the same hash and maybe same layer.
3. **Paint tool: group visibility** — Like Photoshop layers: a list of groups with an **eye** (visible) toggle. When “Blimp” is on and “Clouds” is off, only draws that match group Blimp are rendered (and clickable). So we can isolate the blimp to paint it and assign overrides without the rest of the scene.
4. **Paint tool: assign draws to groups** — User can select draws (click, multi-select, or drag-select) and “Add to group Blimp” / “Remove from group.” That updates the group’s criteria (or adds to them) so future frames and the current frame both see the right membership.

---

## What is a “group”? (definition)

A group is a **named rule set** that says “draw D is in this group if D matches any of these criteria.”

**Criteria options (per criterion):**

| Criterion | Description | Use for blimp |
|-----------|-------------|----------------|
| **hash** | Draw’s tile hash is in a set of hashes. | “All draws that use these tile shapes.” |
| **layer** | Draw’s layer is in a set (e.g. [0, 2] = BG + OBJ). | Blimp = BG body + OBJ animated parts. |
| **hash + layer** | Both. | “These hashes when on BG or OBJ” = blimp tiles. |
| **position** (optional) | Draw’s (x, y) in a rect or band. | “Only draws in top half” to exclude clouds. |
| **neighbor** (future) | “Has a draw with hash X at offset (dx, dy).” | “Part of blimp if next to blimp-signature tile.” |
| **RAM** (future) | Same as override ramConditions. | “Only on intro screen (level ID = 0).” |

For **v1** we can keep it to **hash set + layer set**: group “Blimp” = { hashes: [H1, H2, …], layers: [0, 2] }. So “any draw whose tile is one of these hashes and whose layer is BG or OBJ is in group Blimp.” That’s easy to author by “select all visible blimp draws → Add to group Blimp” (we collect hashes and layers from the selection). The downside: if the same hash+layer appears on the clouds, we’d include it in Blimp too. So we might need **position** (e.g. “y < 160” to exclude bottom clouds) or **neighbor** later.

**Stored shape (conceptual):**

```json
{
  "groups": [
    {
      "id": "blimp",
      "name": "Blimp",
      "criteria": [
        { "hashes": [12345, 67890], "layers": [0, 2] }
      ]
    }
  ]
}
```

Override entry gains optional `groupId`: apply only when the draw is in that group (and other override conditions match).

---

## Paint tool: group visibility (“layers” like Photoshop)

- **Group list** — Side panel or toolbar: list of defined groups, each with a **visibility** toggle (eye on/off). Optionally “Show: All” (no filter) and “Show: No group” (draws not in any group).
- **Filter rule** — When at least one group has visibility on: **show only draws that belong to at least one visible group.** When “Show: All” or no groups visible: show all draws (current behavior). So “Blimp on, Clouds off” → only draws in group Blimp are rendered and hit-testable; the rest of the canvas can be dimmed or empty.
- **Rendering** — In `renderFrame()`, before drawing: filter `drawList` to draws that match any visible group’s criteria (or show all if no group filter). Same for click hit-test: only consider draws that pass the group filter.

So we need a function **drawMatchesGroup(draw, group)** (and **drawMatchesAnyVisibleGroup(draw)**) using the group’s criteria. Groups and “which groups are visible” live in paint-tool state (and groups are persisted in vbpack).

---

## Paint tool: assigning draws to a group

- **Selection** — User selects one or more draws (current single-click, or future multi-select / drag-select).
- **“Add to group”** — User picks group “Blimp” (dropdown or list). We **update group “Blimp”’s criteria** to include the hashes and layers of the selected draws. So we do **not** store “draw index 5, 7, 9 are Blimp” (that’s frame-specific); we store “Blimp = hashes {H1, H2, …} and layers {0, 2}.” So after “Add to group,” any draw in any frame that has one of those hashes and one of those layers will be in group Blimp.
- **“Remove from group”** — Either “Remove selection from group Blimp” (remove those hashes/layers from Blimp’s criteria — might need a separate “criteria” editor) or “Clear group Blimp” (remove all criteria). For v1, “Replace group with selection” could set Blimp = exactly the hashes and layers in the current selection; “Add to group” merges.
- **Over-inclusion** — If we only use hash+layer, then any BG draw with the same solid block hash will be in Blimp, including clouds. So we need either: (a) user to refine (e.g. add position “y < 160”), or (b) accept that for v1 “Blimp” might include cloud tiles and use **override scope** to still give different colors (e.g. override “solid tile in group Blimp” vs “solid tile in group Clouds” with different colors; then we need both groups to be defined and overrides to reference group). So defining “Clouds” as a separate group (hashes + layers, maybe position y >= 160) and scoping overrides by group gives us the split.

---

## Override system: group scope

- **Override entry** — Optional `groupId` (string). When present, the override applies only when: (1) hash/layer/position/ram match as today, and (2) the draw is in the specified group.
- **Runtime** — When resolving override for a draw: if the override has `groupId`, compute “is this draw in group X?” using the group’s criteria (and current frame’s draw list for neighbor conditions if we add them). So we need **groups** to be available at runtime (loaded from vbpack or sidecar) and a function **isDrawInGroup(draw, groupId, state)**.
- **Order** — First matching override still wins. So put “solid tile, group Blimp, color A” before “solid tile, group Clouds, color B” before “solid tile, default.”

---

## Where groups are stored

- **vbpack** — e.g. `groups.json` in the pack: `{ "groups": [ { "id", "name", "criteria" }, ... ] }`. Loaded with the pack in the main app and in the paint tool.
- **Overrides** — Override entries reference `groupId` by string id. No need to embed full criteria in each override.

---

## Tradeoffs

| Decision | Option A | Option B | Recommendation |
|----------|----------|----------|----------------|
| **Group membership** | Rule-based (criteria: hash set, layer set, optional position/neighbor) | Explicit list of (hash, layer) per draw per frame | **Rule-based.** Works across frames when blimp moves; we don’t store per-draw ids. |
| **Authoring** | Infer criteria from selection (“Add selection to group” → merge hashes + layers into group) | Manual: user edits “group = these hashes, these layers” in a form | **Infer from selection** for v1; add manual editor later to refine (e.g. add position band). |
| **Over-inclusion (same hash+layer in blimp and clouds)** | Add **position** criterion (e.g. y &lt; 160) or **neighbor** (has blimp tile nearby) | Define two groups (Blimp, Clouds) and scope overrides to group; both can list same hash+layer but different position/neighbor | **v1:** Two groups with optional **position** (rect or Y band) so “Blimp” = hashes + layers + yMax 160; “Clouds” = same hashes + layers + yMin 160. **Later:** neighbor condition. |
| **Visibility in paint tool** | Multi-select groups (show Blimp OR Clouds) | Single group only | **Multi-select** (checkboxes): show draws in any of the checked groups. |
| **“No group”** | Optional “Show: Unassigned” (draws not in any group) | Not in v1 | **v2:** Useful to see “what’s left” to assign. |

---

## Scale and limits

- **Number of groups per scene:** No hard limit required. Assume **20–30** is typical and **up to 100** is a reasonable upper bound (beyond that the game would be unlikely to have that many distinct logical “layers” on screen). UI (e.g. group list with visibility toggles) should handle on the order of 100 groups without special pagination.

---

## Additional information that would help

1. **Blimp vs clouds on same frame** — Are the blimp and the clouds on the **same** layer (both BG), or is the blimp partly OBJ and clouds BG? If both BG, we need position or neighbor to separate; if different layers, layer-only groups might be enough for some tiles.
2. **“Hash + layer only” for v1** — If v1 group criteria are **only** “set of hashes” and “set of layers” (no position band, no neighbor, no RAM), then any draw that has one of those hashes and one of those layers is in the group. So we **cannot** separate “blimp’s solid tile” from “cloud’s solid tile” if both use the same hash and same layer (e.g. both BG). We’d need at least **position** (e.g. y &lt; 160 for blimp, y ≥ 160 for clouds) in v1 to define two different groups and scope overrides to each. The question is: is it acceptable to ship v1 with hash+layer only (and accept that Blimp and Clouds would be one group until we add position), or do we need position (or something else) in v1 to split them?
3. **Per-pack only vs global groups** — **Per-pack only** means: groups are stored **inside** the vbpack (e.g. `groups.json` in the zip). Each pack has its own list of groups; when you load “Mario Clash.vbpack” you get that pack’s groups (Blimp, Clouds, …). When you load a different pack, you get that pack’s groups. There is no separate “Mario Clash groups.json” that lives on disk and is shared across multiple packs. **Alternative:** groups could live in a separate file (e.g. loaded via “Load groups…”) that could be reused with any pack for that game. Per-pack is simpler and keeps overrides and groups in one place; a global groups file would allow reusing the same group definitions across several packs. Recommendation: **per-pack** for v1 unless you want to share group definitions across packs.

---

## Implementation order (suggested)

1. **Data shape** — Add `groups.json` (or `groups` in manifest): array of `{ id, name, criteria }`. Criteria v1: `{ hashes: number[], layers: number[] }`. Optional per criterion: `yMin`, `yMax` (or `xMin`, `xMax`) for position band.
2. **Runtime: isDrawInGroup(draw, group)** — In color-layer and paint tool: given a draw (hash, layer, x, y) and a group’s criteria, return true if draw matches any criterion.
3. **Override: optional groupId** — Parse and store; in `resolveOverrideRgba`, when override has groupId, require draw to be in that group (need to pass groups and draw into resolve, or precompute “draw’s group ids” for the frame).
4. **Paint tool: load/save groups** — Load groups from vbpack; show list with visibility toggles; filter draw list by visible groups when rendering and hit-test.
5. **Paint tool: “Add selection to group”** — From selected draw(s), collect hashes and layers; add or merge into chosen group’s criteria. “Replace group with selection” = set group’s criteria to exactly that.
6. **Export / Save and Play** — Include `groups.json` in vbpack; main app loads it and uses it when resolving overrides.

---

## Summary

| Need | Approach |
|------|----------|
| Blimp as one logical “layer” | **Groups** = named criteria (hash set + layer set, optional position). Draw is in group if it matches. |
| Override only for blimp tiles | Override entry has optional **groupId**; override applies only when draw is in that group. |
| Paint tool: work on blimp only | **Group visibility**: show only draws in selected groups (eye toggles). Rest of scene hidden. |
| Assign draws to group | **“Add to group”** from selection → update group’s criteria (merge hashes + layers). Optional position later. |
| Same tile in blimp and clouds | Define two groups (e.g. Blimp with y &lt; 160, Clouds with y ≥ 160) and scope overrides by group. |

This gives you Photoshop-like “layers” (groups) for the paint tool and ties overrides to those groups so the blimp can be colored independently of the clouds even when they share tiles.
