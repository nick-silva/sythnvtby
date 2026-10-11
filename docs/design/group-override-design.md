---
status: partial
last-reviewed: 2026-10-10
covers: src/color-layer.js, tools/painter/groups.js
---

# Group-based overrides: agreed design

**Status (Oct 2026):** built, then extended. Groups match by worlds, patterns and layers and carry
their own tile colours; RAM qualifiers became memory pools (screens) and game states; the group
listed first wins a shared tile. Current behaviour: [art-pack-file-format.md](../reference/art-pack-file-format.md) §6.4
and the user guide.

This doc captures the **agreed design** for group-based overrides, RAM qualifiers on groups, and UX. It builds on [tile-groups-requirements.md](tile-groups-requirements.md) and [conditional-overrides-design.md](conditional-overrides-design.md).

---

## 1. Override scope: group everywhere unless RAM qualifies

- **Group override** = “use this colorization for every draw that matches this group” (same world + hashes ± layers) **everywhere in the game**.
- **Exception:** If the **group** has **RAM conditions** (e.g. “address 0x0500 === 3”), the override applies only when those RAM values match. So:
  - Group “Blimp” with no RAM → one override colors the blimp on every screen where that group matches.
  - Group “Blimp (intro only)” with `ramConditions: { "0x0500": 0 }` → same override only when RAM says “intro screen.”

We do **not** key overrides to exact vbstates or frames; screen/level is identified by **RAM** (or future equivalents), not by “this saved frame.”

---

## 2. Position as optional extra conditional

- **Position** (xMin..yMax) stays supported as an optional extra condition on overrides.
- Utility is low for level-based / “same tile everywhere” use cases, but we keep it because it’s cheap (complexity and compute) and still useful for rare cases.

---

## 3. Conditional qualifiers live on the group

- **RAM (and any other conditional qualifiers)** are attached to the **group**, not to the override.
- Override says: “for group X, use this RGBA.” Group X’s criteria = worldIds + hashes + layers; group X’s **ramConditions** = optional “only when these RAM values match.”
- So one override per group (per hash in the group) + group’s ramConditions define *when* it applies. No need to duplicate override logic; we evaluate group membership (including RAM) once per draw.

---

## 4. Duplicate group for variants (e.g. per-level)

- **Duplicate group** lets the user copy a group and then change its qualifiers (e.g. same world + hashes, but different RAM value for “level 2”).
- Flow: Duplicate “Blimp” → “Blimp level 2” → set ramConditions to level 2’s value → add a separate “Override for this group” for the new group (e.g. different color for level 2 blimp).
- So we support “same tile set, different screens/levels” by duplicating groups and varying RAM (and optionally override) per copy.

---

## 5. UX: “Override for this group”

- **Primary UX** is: from the **group panel**, user chooses **“Override for this group.”**
- That creates (or updates) overrides that apply to **this group** everywhere (or when the group’s RAM conditions match):
  - One override per hash in the group’s criteria, with `groupId` set and full-frame bounds (0,0,384,224) so position is not restrictive.
  - RGBA comes from the **pack** (current colorization for that hash). If the pack doesn’t have a hash yet, we can skip it or warn.
- We do **not** drive this from “add override, then pick a group”; the group is the anchor, and “override for this group” attaches colorization to that group.

- **Override panel:** See [override-panel-design.md](../history/archive/override-panel-design.md) for how the override panel is supposed to work (flow, pack-first, why group overrides can seem broken, and planned panel behavior).

---

## 6. RAM locations: future work

- **Per-game RAM notes** (e.g. “Mario Clash: 0x0500 = level index”) live in [game-memory-locations.md](../reference/game-memory-locations.md) and will be filled in over time.
- The core does not yet push a RAM snapshot; when it does, we will evaluate `ramConditions` on the group (and any override-level conditions if we add them later) so that group-based overrides apply only when RAM matches.
- No matching on exact vbstates or frame IDs.

---

## 7. Implementation status (short)

| Piece | Status |
|-------|--------|
| Group criteria (worldIds, hashes, layers) | Done (paint tool, vbpack) |
| Override with `groupId` | Done end-to-end (paint tool + export + runtime in main app color layer evaluates groupId with groups + draw) |
| `ramConditions` on group | Data shape + paint-tool UI + **main app color layer** evaluates against live WRAM when available (`tryCopyVBSystemRamFromEmulator`); see [color-layer.js](../../src/color-layer.js) |
| Duplicate group | Added in paint tool |
| “Override for this group” | Added in paint tool (creates overrides with groupId, full bounds, rgba from pack) |
| Position as optional condition | Already supported (override rect); keep as-is |

---

## Links

- [override-panel-design.md](../history/archive/override-panel-design.md) — how the override panel works (flow, group overrides, emulator gap)
- [tile-groups-requirements.md](tile-groups-requirements.md) — world, scene, group definition
- [conditional-overrides-design.md](conditional-overrides-design.md) — layer, RAM, override shape
- [game-memory-locations.md](../reference/game-memory-locations.md) — per-game RAM addresses (to fill in)
