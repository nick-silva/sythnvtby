# Paint tool — overrides & conditional game-states redesign (authoritative spec)

**Status:** Design locked for implementation. **Audience:** implementers. **Platform:** **desktop web only** for this phase; a future **Electron** shell is possible once the app is shippable—no mobile or responsive layout requirements now.

**Related:** [paint-tool-wireframe-spec.md](paint-tool-wireframe-spec.md) (v1 layout reference), [paint-tool-gamestate-override-plan.md](paint-tool-gamestate-override-plan.md), [group-override-design.md](../../design/group-override-design.md), [conditional-overrides-design.md](../../design/conditional-overrides-design.md).

---

## 1. Product decisions (locked)

| Topic | Decision |
|-------|----------|
| **Scope** | Redesign includes **new concepts**, not only layout/copy — notably **override presets** (see §3). |
| **RAM / game-state per group** | A **group** has **at most one** RAM / game-state conditional for **all** overrides that use that `groupId`. Need a different condition → **create another group** (same tile hashes cannot be in two groups — exclusive hash rule stays). |
| **Overrides without game-state** | **Discouraged** when `manifest.memoryAnalysis` exists, but **never blocked**. Use **warnings**: opt-**in** (enabling a new RAM condition) and opt-**out** (skipping RAM when analysis is available). |
| **Layout** | **Sections may be reordered** freely — no shipped users; optimize for clarity. |
| **Platform** | **Desktop only**; Electron packaging is a possible later step. |

---

## 2. Mental model

1. **Pack edits** — Apply everywhere (subject to layer/window filters as today).
2. **Group** — Defines *which draws* (criteria) + **one optional game-state gate** (`ramConditions`) for *everything* painted under that group.
3. **Override preset** — Reusable named bundle (layer, apply-at, RAM selection from analysis or manual) to speed up “same recipe” work without re-picking dropdowns each time.
4. **Position override** (non-group or group-scoped) — Still hash + rect + layer + apply-at; **group** inherits the group’s single RAM condition; **pack-only** overrides use per-override RAM UI with the same discourage / warn rules when analysis exists.

---

## 3. Override presets (new concept)

**Goal:** Let users save and re-apply common override “recipes” without re-selecting memory-analysis state, candidate, layer, and apply-at.

**Minimum viable preset contents (suggested):**

| Field | Notes |
|-------|--------|
| `id`, `name` | Stable id; human label (e.g. “Intro — BG, cell, RAM byte A”). |
| `layer` | `any` \| `0` \| `1` \| `2` (same semantics as today). |
| `applyAt` | `cell` \| `everywhere` (same as today). |
| `ramConditions` | Same array shape as today: `[{ offset, expectedValue, stateName?, source? }]` from analysis or manual. |
| Optional | `memoryAnalysisRef` — e.g. `{ stateName, candidateIndex }` to re-bind if manifest analysis updates. |

**Persistence:**

- Store in **`groups.json`** as a sibling list, e.g. `{ "groups": [...], "overridePresets": [...] }`, **or** a dedicated `override-presets.json` in the vbpack — **implementation choice**; document the chosen file in [art-pack-file-format.md](../../reference/art-pack-file-format.md) when implemented.

**UX (desktop):**

- **Preset picker** near override / group RAM controls: “Start from preset…” → applies fields; user still confirms paint target group.
- **Save as preset** from current override + RAM selection.
- Presets are **hints**; user can edit after apply.

---

## 4. Group-level RAM (single conditional per group)

**Rule:** `groups[].ramConditions` (array form, aligned with [color-layer.js](../../../src/color-layer.js) / overrides) is the **only** RAM condition for **every** override with `groupId === that group`.

**Implementation direction:**

- **Paint tool:** Configure RAM once in the **group** panel (not duplicated under every tile override row for that group).
- **Export:** Emit `group.ramConditions` on the group; overrides with `groupId` **may omit** redundant `ramConditions` if runtime resolves group first — **or** flatten at export for backward compatibility (implementation choice; document in code comments).
- **Runtime (`resolveOverride`):** When `o.groupId` is set, evaluate **group’s** `ramConditions` (once matched to group membership) before applying override RGBA.

**Freedom model:** More granular RAM → **more groups** (duplicate group shell + different RAM + re-add hashes per exclusive-hash rules).

---

## 5. Warning & discourage behavior (no hard blocks)

Assume `manifest.memoryAnalysis` is present unless stated otherwise.

| Situation | Behavior |
|-----------|----------|
| User enables **game-state** / RAM for an override or group | **Opt-in warning** (first time or when changing state/candidate): short copy that this ties art to WRAM; link to memory analysis doc if useful. |
| User **declines** RAM while analysis exists | **Opt-out warning:** remind that the override/group may match **globally** (same hash/layer/position rules everywhere). |
| No memory analysis in pack | Banner as today; RAM controls disabled or empty; no “discourage” for RAM (nothing to pick). |
| Pack-only override (no group) without RAM | Same opt-out pattern when analysis exists. |

**Never** prevent saving or exporting; warnings are informational + confirm optional for destructive actions only (e.g. “Replace all group overrides” already uses patterns elsewhere).

---

## 6. Layout (desktop) — allowed reorder

Suggested **north-star** order for the side column (implementer may adjust):

1. **Pack / frame / warnings** (memory analysis banners).
2. **Groups** — criteria, **single RAM / game-state block per group**, paint target radio, Add/Remove, Override from pack, presets hook.
3. **Override presets** — list + apply / save (if not folded into group header).
4. **Draws at click** — unchanged role.
5. **Tile painter** — Apply to pack vs override; layer / apply-at; **per-override** RAM only when **not** using a group (or when editing pack-wide override); preview / highlight.

**Staging / import** can stay below the main row or move per taste.

---

## 7. Implementation phases (suggested)

1. **Data model** — `overridePresets` in vbpack; group `ramConditions` as single source for group overrides; migration from per-override `ramConditions` on grouped overrides → group (one-time or on load).
2. **UI** — Group RAM panel; preset CRUD; move warnings to new copy blocks.
3. **Runtime** — `resolveOverride` / color-layer: evaluate group RAM for `groupId` overrides.
4. **Docs** — art-pack format, quick-test guide, wireframe v2 screenshot or ASCII update.

---

## 8. Out of scope for this redesign doc

- Electron packaging pipeline.
- Mobile / responsive CSS.
- Sub-groups / parent-child group hierarchy (still “more groups” for now).

---

## 9. Changelog

| Date | Change |
|------|--------|
| 2026-03-09 | Initial spec from product decisions: presets, group-wide RAM, warnings, desktop-only, layout freedom. |
