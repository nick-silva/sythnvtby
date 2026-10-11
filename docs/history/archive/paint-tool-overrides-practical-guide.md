# Paint tool — practical guide to overrides (why, when, how)

**Audience:** Authors using the paint tool who feel lost among “pack,” “override,” “group,” “position,” “RAM,” and “presets.” **Goal:** one readable map from *intent* → *controls* → *what gets saved*, plus **product direction** for simplifying the surface area.

**Related specs (detail / history):** [paint-tool-overrides-flow.md](paint-tool-overrides-flow.md), [group-override-design.md](../../design/group-override-design.md), [paint-tool-overrides-redesign-spec.md](paint-tool-overrides-redesign-spec.md), [color-pack-overrides-design.md](../../design/color-pack-overrides-design.md), [memory-analysis-tool-spec.md](../../reference/memory-analysis-tool-spec.md). **Simplified UI + profiles (shipped in paint tool):** [paint-tool-simplified-authoring-spec.md](paint-tool-simplified-authoring-spec.md).

---

## 1. What you are actually choosing (three decisions)

Every time you color something “special” (not just the global pack), you are answering:

| # | Question | Plain language |
|---|----------|----------------|
| **A** | **Scope of the color** | “One spot on this frame” vs “this tile *wherever* this group appears in the game.” |
| **B** | **Which draws count** | Optional **group** (world + tile hashes ± layers) narrows *which* draws use the override. No group → you rely on **position** and/or **layer** rules instead. |
| **C** | **When it applies in the game** | **Always** (every frame where the draw matches) vs **only in certain game states** (WRAM / “game-state” conditions from memory analysis). |

The UI overloads the word **“override”**: it means “not only the pack hash color,” but the *kind* of override depends on **A–C**. Presets (below) are not a separate mechanism — they are **saved recipes** for the same fields.

---

## 2. The two “families” of override (learn these first)

### 2.1 Pack color (not an override)

- **What:** One RGBA per **tile hash** for the whole game (subject to how you loaded the pack).
- **When:** Default for “this tile should look like this everywhere we don’t special-case it.”
- **How:** **Apply to: Everywhere (pack)** and **no paint-target group** (or you are explicitly painting the pack in a workflow that updates pack entries — follow the status / hints in the tool).

This is the baseline. Everything else exists because the **same tile hash** is reused in places where you want **different** art.

### 2.2 Position / conditional overrides (everything else)

All non-pack paths end up as rows in `overrides.json`: same **hash**, plus extra rules (rectangle, optional **layer**, optional **groupId**, optional **ramConditions**).

Rough split:

| Family | Typical intent | How it usually shows up in the tool |
|--------|----------------|-------------------------------------|
| **Position override** | “Only this **8×8 screen cell** (or this layer at that cell) should look different.” Good for **fixed** HUD, title text, static BG details. | **Apply to: This position only (override)**. Optional **layer** / **this cell vs everywhere on that layer** in the tile painter block. |
| **Group override** | “This **set of draws** (e.g. blimp, UI window) should use these colors **wherever** those draws appear — possibly only in **certain game states**.” Good for **reused** tiles, moving sprites that share a hash, or “color this system, not the whole pack.” | Select a **paint-target group**, paint, and/or use **Override** (copy pack colors into group-scoped overrides). **Game-state (WRAM)** for the group lives in the **expanded group** panel. |

**Rule of thumb:** If the same hash appears in **multiple places per frame** and you need **different** colors for **different uses** of that hash, you are in **group** territory (or layer/palette tricks — see §5). If it’s **one place on one screen**, **position** is simpler.

---

## 3. Controls in the UI (what they actually do)

### 3.1 “Apply to” (tile painter)

- **Everywhere (pack)** — Writes the **pack** entry for this hash (global default).
- **This position only (override)** — Writes a **position override** for the **selected draw’s** cell (and optional layer / apply-at — see below). Does **not** change the pack for that hash’s global entry (unless you also paint to pack separately).

### 3.2 Paint-target **group** (radio in the group list)

- **None** — You see all draws (subject to filters); painting with **Apply to: Everywhere** updates the **pack**. **Apply to: Position** creates **non-group** overrides.
- **Group G selected** — Scene filters to that group’s draws; painting updates **overrides** tagged with **`groupId: G`** (pack unchanged for those commits). This is how you color “the blimp” without recoloring every other use of the same hash.

### 3.3 **Override** button on a group (“copy from pack”)

- **Why:** Quickly create **group overrides** for **every hash** in the group from **current pack colors** — useful when you already like the pack on this frame and want to **freeze** that look for this group everywhere.
- **How:** One override per hash, large bounds, `groupId` set — see [group-override-design.md](../../design/group-override-design.md).

### 3.4 Layer + “this cell” vs “everywhere (this layer)”

Used for **position** and **non-group** flows (and mirrored in presets):

- **Layer** — Restrict the override to BG / Affine / OBJ when the same hash appears on multiple layers.
- **This 8×8 only** — Classic **fixed position** override.
- **Everywhere (this layer)** — Same hash on that layer gets the override **wherever** it is drawn (e.g. **moving** object) — still **without** a group, so you are not filtering by world/window; use when that’s enough.

When that is **not** enough (two different sprites share hash + layer), you need **groups** (or future core features like per-object ids — not available today).

### 3.5 Game-state / WRAM (two places — intentional but confusing)

| Location | Use |
|----------|-----|
| **Expanded group → Game-state (WRAM)** | **Canonical** for anything you paint with that **group** selected. One RAM recipe per group; applies to **all** overrides with that `groupId`. |
| **Tile painter → Game-state condition (non-group overrides)** | Only for **pack-wide / position** overrides **without** a paint-target group. Same data shape (`ramConditions`), but easy to misuse if a group would be clearer. |

**Product direction (see §6):** When `manifest.memoryAnalysis` exists, the tool should **prefer** attaching RAM to the **group** (or suggest creating a group) rather than encouraging **non-group** RAM for every edit.

### 3.6 **Override presets**

- **Why:** Save a **named recipe** (layer, apply-at, RAM selection) and re-apply it. Reduces repeated dropdown work; does **not** define a new runtime mechanism.

---

## 4. Practical recipes (copy this table)

| Goal | Suggested path | Why |
|------|----------------|-----|
| **Title screen letter uses a different color than the same tile elsewhere** | Position override: select draw → **This position only** → paint. Optionally set **layer** if the tile is also used on another layer. | Fixed **(x,y)**; smallest blast radius. |
| **Same tile on a moving sprite vs background** | Prefer **layer** filter (BG vs OBJ) on the override, or **two groups** (BG draws vs OBJ draws) if the scene is messy. | Position alone **does not follow** a moving sprite — see [color-pack-overrides-design.md](../../design/color-pack-overrides-design.md). |
| **Reused hash for one character / prop across many frames** | **Create a group** with the right **world + hashes (+ layers)** → select it as paint target → paint **or** **Override** from pack → add **game-state RAM** if it should **not** apply in every level. | Group scope matches “this object’s draws” better than one rectangle. |
| **Same graphics, different level / mode (e.g. boss vs overworld)** | **Duplicate group** → different **`ramConditions`** (from memory analysis) → different paints or overrides per duplicate. | Same tile set, different **when** — matches [group-override-design.md](../../design/group-override-design.md) §4. |
| **You already ran memory analysis** | Pick the **state** + **candidate byte** that discriminates this capture; attach to the **group** (preferred) or non-group checkbox if you must. | Ties art to **discriminant** WRAM, not to “this JSON frame file.” |

---

## 5. “Weird” edge cases — what to treat as advanced or hide later

These are **valid** technically but **confusing** for most authoring. A future UI pass may **demote** them (Advanced / “Expand”):

1. **Non-group RAM + memory analysis available** — Often a sign the user should be using a **group** so RAM lives in one place (matches locked product rules in [paint-tool-overrides-redesign-spec.md](paint-tool-overrides-redesign-spec.md)).
2. **“Everywhere (this layer)” without a group** — Powerful but easy to misapply (colors every instance of that hash on that layer globally).
3. **Duplicate concepts:** “Override” button name vs “override” in Apply to — same word, different actions (**bulk from pack** vs **position-only path**).
4. **Preview override match** — Intentionally **does not** evaluate RAM; it only shows spatial/layer coverage. Easy to think you gated game state when you did not.
5. **Per-override RAM on grouped entries** — Export should **strip** redundant RAM in favor of the group; if the UI still shows both in some edge case, treat as bug/tech debt.

**Not an edge case — just unfinished:** Until the emulator evaluates **`ramConditions`**, RAM is **authoring + export**; visually **group + position** matching already works. See §7.

---

## 6. Product direction — RAM-first, not RAM-rare

Older notes sometimes implied “avoid RAM unless necessary” (e.g. performance). **Updated stance:**

- **Do not** treat “too many WRAM checks” as a reason to avoid game-state gating in the shipped emulator. Cost of a few byte comparisons per frame is negligible compared to rendering.
- **Default mindset:** If the pack has **memory analysis**, **tie edits to a discriminant game-state** for the relevant **frame family** so overrides do not leak across levels/menus.
- **Desired UX (north star):** When the user paints for a **captured frame** that appears in **`frameRegistry`** / analysis, the tool should **suggest** (or auto-fill) the **memory-analysis state + candidate** on the **group** RAM block, and require an explicit **opt-out** with a short reason (“global-only override”) rather than the reverse.

This aligns with [paint-tool-overrides-redesign-spec.md](paint-tool-overrides-redesign-spec.md) (discourage global-only when analysis exists — **warnings**, not hard blocks).

---

## 7. Runtime status (honest)

- **Implemented today:** Pack lookup; **position** bounds; optional **layer**; **`groupId`** resolution against **group criteria** (world / hashes / layers); **`ramConditions`** against **live 64 KiB CPU WRAM** when `tryCopyVBSystemRamFromEmulator()` returns data (same path as Capture Frame). See `resolveOverrideRgba` and `ramConditionsSatisfied` in [color-layer.js](../../../src/color-layer.js). If WRAM is unreadable in a given build, gated overrides are skipped (pack/global colors still apply).
- **Paint tool preview:** Still draws overrides **without** simulating WRAM unless you add a stub — use the **main emulator** for full game-state UX testing.

---

## 8. One-line cheat sheet

| I want… | Start here |
|---------|------------|
| Global tile color | **Apply to: Everywhere (pack)**, no group. |
| One fixed cell different | **This position only**, no group (add layer if needed). |
| A **system** of tiles (character, UI) different from pack | **Group** + paint target + paint or **Override**. |
| Same group, different **level/mode** | **Duplicate group** + different **RAM** on each. |
| Repeatable setup | **Override presets**. |
| Discriminant **when** in the game | **Memory analysis** → **group RAM** (preferred). |

---

## 9. Changelog

| Date | Change |
|------|--------|
| 2026-03-24 | Initial practical guide: unified mental model, recipes, edge-case triage, RAM-first product direction, runtime status. |
