# Paint tool — game-state pools first (UX plan)

**Status:** Planning / not implemented. **Audience:** product + implementers. **Intent:** Describe a **state-first** organization for the Groups area so authors pick **which part of the game** (or “everywhere”) **before** defining tile groups and WRAM recipes — closer to how testing workflows actually run (safety vs auto-pause vs in-game, etc.).

**Related:** [group-override-design.md](../../design/group-override-design.md) (today: one `ramConditions` per group), [paint-tool-overrides-practical-guide.md](paint-tool-overrides-practical-guide.md), [paint-tool-overrides-redesign-spec.md](paint-tool-overrides-redesign-spec.md), [memory-analysis-tool-spec.md](../../reference/memory-analysis-tool-spec.md), [priorities-and-next.md](../../planning/priorities-and-next.md) (user testing backlog: “game state at top level”).

---

## 1. Why change

**Observed mental model (authoring):** “I’m coloring **the safety screen**” → then **which tiles** belong to that screen → **which WRAM bytes** separate it from auto-pause.

**Current UI mental model:** “I’m defining a **group** (tiles)” → expand → **WRAM is a footnote** inside the group. Exported `groups.json` can even show **empty `criteria`** when hashes were only implied by overrides, which confuses validation and runtime.

**Design goal:** Make **game-state context** the **first** thing you choose when creating scoped work, then attach **one or more concrete WRAM recipes** under that context, then attach **groups** (tile criteria + overrides) to a **specific recipe** (or to a **universal** pool with no WRAM gate).

---

## 2. Core concepts (proposal)

| Concept | Meaning |
|--------|---------|
| **Game state pool** | Top-level bucket: “Intro flow”, “In-game”, “Menus”, or **Universal**. Pools align with **high-level** labels from `manifest.memoryAnalysis` / `frameRegistry` where possible, or are **user-defined** when analysis is missing. |
| **Pool variant** | Child under a pool: a **named slice** with **configurable `ramConditions`** (same array shape as today). Example: under pool “Intro”, variants “Safety” and “Auto pause” each have their own byte recipe. |
| **Universal pool** | Special pool: **no RAM discrimination at the pool level**. Variants under it either have **empty** `ramConditions` (always pass) or there is a single default variant — semantics: “groups here are gated only by tile/window/layer criteria, for the whole ROM.” |
| **Group** | Still: **who** gets recolored (`criteria`: hashes, windows, layers) + `groupId` on overrides. **New:** each group references **`statePoolId`** + **`stateVariantId`** (see [art-pack-file-format.md §6](../../reference/art-pack-file-format.md)) so WRAM is **resolved from the variant**, not duplicated inside every group row. |

**Runtime (target):** `effectiveRamConditions(group)` becomes: look up variant by ids → use variant’s `ramConditions`; universal default variant → empty list → always satisfied. (Same as today’s “no gate”.)

---

## 3. UX outline (desktop)

### 3.1 Panel structure

Replace the flat **Groups** list-at-top with a **two-level chrome**:

1. **Game state pools** (primary column or accordion root)  
   - **[+ New pool]** → choice: **From analysis** (pick top-level state family) · **Custom (named)** · **Universal (everywhere, no RAM)**.  
   - Each pool row: name, badge (`Universal` / `From analysis`), chevron expand.

2. **Inside a pool: variants**  
   - Table or sub-list: **Variant name**, **WRAM summary** (e.g. `0x0500 = 0x03`), **[Edit recipe]** (opens same controls as today’s group RAM block: state picker, candidate, manual offset/value).  
   - **[+ Variant]** for non-universal pools (e.g. split safety vs auto-pause under “Intro”).

3. **Inside a pool (or scoped under a variant): groups**  
   - Existing behaviors: **New group**, **Add** selection, **Copy pack colors**, **Override for this group**, etc.  
   - **Creating a group** requires an **active variant** (or explicit **Universal → default variant**) so the tool knows where WRAM lives.

**Empty state:** If pack has `memoryAnalysis`, nudge: “Create a pool from analysis or Universal.” If no analysis, Universal + custom pools only; WRAM fields disabled or manual-only.

### 3.2 Flows

| Flow | Steps |
|------|--------|
| **New scoped pool** | New pool → pick analysis family (or type name) → auto-create **first variant** from top candidate or leave “unset” until user confirms → add groups under variant. |
| **Split screen within pool** | [+ Variant] → name “Auto pause” → set WRAM → move or duplicate groups between variants (subject to **hash exclusivity** — see tradeoffs). |
| **Universal work** | New pool → Universal → single default variant with empty `ramConditions` → groups behave like today’s “no RAM gate”. |
| **Migrate old pack** | Import flat groups: assign each to **Universal** default variant **or** prompt “Which pool does this belong to?” once; preserve existing `group.ramConditions` as **variant** recipe and clear duplicate group-level RAM after migration. |

### 3.3 Presets

Override **presets** today can carry `ramConditions`. Under this model, presets should optionally bind to **`statePoolId` + `stateVariantId`** (see [art-pack-file-format.md §6.5](../../reference/art-pack-file-format.md)) so **Apply preset** selects the right pool/variant before filling tile painter fields.

---

## 4. Data model — normative spec

**Canonical location:** All pool, variant, and group extensions live in the existing zip entry **`groups.json`** (no new path in the `.vbpack` for v1 of this feature).

**Field names, types, resolution order, and examples** are defined in **[art-pack-file-format.md §6 — `groups.json` (paint tool schema)](../../reference/art-pack-file-format.md)**. Summary of **identifiers**:

| Concept | JSON location |
|--------|----------------|
| Schema flag | Root **`groupsSchemaVersion`**: **`2`** when **`gameStatePools`** is used. |
| Pool list | Root **`gameStatePools`**: `{ id, label, universal?, analysisStateKey?, analysisSource?, variants[] }`. |
| Variant (WRAM owner) | **`gameStatePools[].variants[]`**: `{ id, label, ramConditions[], analysisStateKey? }`. |
| Group → pool link | **`groups[].statePoolId`**, **`groups[].stateVariantId`**. |
| Universal interop | Recommended pool id **`__universal__`**, variant **`__default__`**, **`ramConditions: []`**. |
| Legacy | **`groups[].ramConditions`** when v1 or migration; resolver order in §6.4 of art-pack doc. |

**Compatibility:** Implementations SHOULD support **both** legacy **`group.ramConditions`** and **`statePoolId` + `stateVariantId`** during transition; normative resolution order is in the art-pack doc. Exporters SHOULD avoid writing both redundant copies long-term.

---

## 5. Implementation phases (suggested)

1. **Authoring-only UI** — Pools + variants in paint tool; persist new arrays in `groups.json` (or dedicated `game-state-pools.json`); keep writing legacy `group.ramConditions` in sync for one release **or** feature-flag export format.  
2. **Runtime** — `color-layer.js` (and pack loader in main app) resolve RAM from variant ids; tests for universal vs discriminated.  
3. **Migration** — One-shot “upgrade pack layout” in paint tool + docs in [art-pack-file-format.md](../../reference/art-pack-file-format.md).  
4. **Polish** — Drag-reorder pools/variants, search when many variants, tighter integration with memory-analysis labels.

---

## 6. Tradeoffs and workflows we are *not* fully solving

These are intentional **limits** or **risks** to document so we do not oversell the redesign.

| Topic | Tradeoff / gap |
|--------|------------------|
| **Hash exclusivity** | Today one tile **hash** belongs to **one group**. Moving a group between variants in the **same** pool is fine; **sharing** the same hash across **two variants** (same pool) still requires **two groups** with duplicated criteria OR relax the rule (bigger rules change). |
| **Same graphics, two variants** | If safety and auto-pause share hashes but need different colors, you still need **two groups** (or two pool variants × two groups) — the pool does not remove the need for **duplicate group** patterns; it **organizes** them. |
| **Analysis quality** | Pools and variants are only as good as **memory analysis** and capture coverage. Bad discriminant bytes → wrong variant fires; UI can warn but cannot fix bad data. |
| **WRAM during transitions** | Between states, bytes may match **no** variant briefly → overrides flicker or fall back to pack; no proposal here for hysteresis or multi-frame smoothing. |
| **Multi-byte / complex gates** | Variants still assume **AND** of `ramConditions`; OR / scripting is out of scope unless we extend the schema later. |
| **Non-WRAM game state** | Anything not captured in CPU WRAM (rare edge cases) still cannot be gated; pools do not add new signals. |
| **Universal pool misuse** | Easy to dump everything in Universal and recreate **global leakage** across menus; product should **warn** when analysis exists (aligned with [paint-tool-overrides-redesign-spec.md](paint-tool-overrides-redesign-spec.md)). |
| **Scale** | Many in-game levels → many variants under one “Gameplay” pool; UI needs **collapse**, **search**, and maybe **folders** later — first version may feel heavy for huge games. |
| **Remote / handoff** | IndexedDB handoff and multi-machine dev are unchanged by this UX; failures there are orthogonal. |
| **Paint preview vs emulator** | Preview may still not simulate WRAM unless we add a stub; state-first UI does not fix that. |

---

## 7. Relation to older “duplicate group” guidance

**group-override-design §4** (“Duplicate group for level 2 with different RAM”) remains **valid mechanically**, but the **authoring story** becomes: **duplicate variant** (or add variant) under the same pool, then **duplicate group** tied to the new variant — fewer disconnected groups floating in a flat list.

---

## 8. Open decisions (remaining)

- **Stable keys vs re-analysis:** Whether **`statePoolId` / `stateVariantId`** must survive re-import when `manifest.memoryAnalysis` changes (optional **`analysisStateKey`** fields on pool/variant support soft rebinding; strict validation is tool-defined).  
- **Non-group overrides:** Whether position overrides with RAM stay **per-override** only or can reference **`statePoolId` + `stateVariantId`** for consistency (not in normative `overrides.json` schema yet).

**Locked:** Pools ship inside **`groups.json`** only — see [art-pack-file-format.md §6](../../reference/art-pack-file-format.md) (no separate `game-state-pools.json` for v1).

Once implementation lands, update [paint-tool-overrides-redesign-spec.md](paint-tool-overrides-redesign-spec.md) and [group-override-design.md](../../design/group-override-design.md) with pointers to §6 and this doc.
