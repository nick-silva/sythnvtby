---
status: partial
last-reviewed: 2026-10-10
covers: tools/painter.js, tools/painter/, tools/project.html
---

# Project tool (formerly Painter v2) — VB color authoring

This document describes a **second-generation** paint/authoring experience for the VB colorization project. It consolidates decisions and open questions from design discussion; it is **not** an implementation checklist.

**Entry point:** `tools/project.html` — the **Project tool**. This spec was written when it was called *Painter v2* and lived at `painter.html` (now a redirect), so it still uses that name throughout.
**Since then (Sep 2026):** Paint v1 was removed, and sprite painting and animation moved to **SpriteStudio** (`tools/sprite-studio.html`); see [obj-sprite-profiles-design.md](obj-sprite-profiles-design.md). The Project tool is the frame-first side: capture, groups, pools, BG anchors and BG painting.

---

## 1. Why a new app instead of trimming v1

The v1 paint tool accumulated many features (groups, pools, presets, staging, frame pickers, override modes, RAM conditions, export paths, etc.). Removing or hiding them **safely** requires touching the same large codebase repeatedly, with high regression risk.

**Strategy:** Build **painter v2** around the **new mental model** (game state + hash → rule, optional macro assets) with a **small, intentional control set**. Reuse **shared libraries** (`color-layer`, `art-pack`, VIP parsing, pool resolution) where possible; **do not** port v1 UI wholesale.

---

## 2. Product goals

| Goal | Note |
|------|------|
| **Fewer buttons and interactions** | Default surface should support one primary workflow; advanced behavior is deferred or hidden behind clear escalation. |
| **Screen = current game state** | Authoring keys off **memory-analysis game state** and **pool variants** (sub-states), not a separate abstract “screen id”. |
| **Smaller authored rule set** | Prefer **keyed lookups** `(poolVariant, hash) → …` over long **per-cell override lists** where possible. |
| **Macro assets** | **Pure BG groups only:** macro PNG per group×variant + anchor hash; mono baseline export; mixed membership disables macro (**§11.6**). |
| **OBJ vs BG** | Author **labels** each group **BG** or **OBJ** (tool may **suggest** from `layer`); **macro** only for **BG-labeled + pure-BG membership**; mixed **BG/OBJ/Affine** → **warning** + **v1-style tile8/overrides** (**§3.3**, **§11.6**). |
| **PNG in vbpack** | **Lossless PNG** for macro (and any interchange) so files can be edited outside the app. |
| **vbpack compatibility** | v2 data is **additive**; existing packs and the current emulator path keep working until v2 runtime is required. |
| **No v1 → v2 migration (for now)** | Experiments may redo color work; no obligation to auto-convert v1 overrides. |

---

## 2.1 New colorization `.vbpack` (no `groups.json` yet)

It is **normal** for a brand-new project zip to contain **`manifest.json`** (with `frameRegistry`, optional `memoryAnalysis` after the memory tool), **`vipstates/`**, **`ramdumps/`**, **`screenshots/`**, ROM, and **`color.vbcolor`**, but **no `groups.json`**. That file is introduced when the author **saves** from Painter v2 (or exports from v1 with groups), and **groups** appear when the author creates the first group.

- **Groups tree** is empty until the first group exists — not a load failure.
- The **memory analysis** tool only augments **`manifest.json`**; it does not write `groups.json` by itself.
- **Auto-seed (Painter v2):** When the zip has **no** `groups.json` entry **and** `manifest.memoryAnalysis.topCandidatesByState` is non-empty, Painter **synthesizes `gameStatePools` in memory**: one pool per analyzed **state name**, each with a single variant **`__default__`** whose **`ramConditions`** use the **first** (best-score) WRAM candidate row. **Pool `label`** is a **short display title** (segment before ` / ` or en/em dash, then max ~28 chars); **`analysisStateKey`** keeps the **full** analysis key for frame matching. **Save .vbpack** then writes `groups.json` including those pools (and any groups). Extra variants per pool are deferred to a later feature. If analysis is missing or has no seedable rows, pools stay empty until the author adds them (template merge, v1, or hand-edit per `docs/reference/art-pack-file-format.md`).

Painter v2 surfaces “new pack” vs “seeded from analysis” in the Memory pool panel and status line.

---

## 3. Core concepts (agreed direction)

### 3.1 Game state and “screen”

- **Game state** comes from the **same memory-analysis pipeline** as today (discriminant WRAM, state families, etc.).
- **Sub-states / variants** (e.g. menu selection, level 01 vs 02) map to **pool variants** — the same **gameStatePools** idea as v1.
- **Resolution key:** **`poolVariant` is sufficient** to mean “which screen” for coloring rules in most cases; **single-variant pools** are common and should stay simple.

**Resolution:** See **§7.1** — v2.0 uses **only** `(poolVariantId, hash)` as the runtime rule key; same variant + different frames → fix via **pools / substates**, not a second key (optional `vipFile` scope deferred to v2.1+ if ever needed).

### 3.2 Hash and tile identity

- Rules are keyed by **tile pattern hash** from the VIP/draw pipeline (same notion as today’s pack keys).
- Intention: author picks a hash that is **specific to the art asset** they care about (e.g. title graphic), including **unique** hashes where the game does not reuse the pattern — reducing wrong-place application.

**Resolution:** See **§7.2** — **tile8** applies at **every** draw site for that hash. **macro** always carries an explicit **`vipRect`** (VIP pixel coordinates); hash is the **rule key** and authoring handle, not the placement source.

### 3.3 Groups — BG (macro) vs OBJ (tile8)

Groups split into two **authoring kinds**:

| Kind | Typical use | Asset model | In the tool |
|------|-------------|-------------|-------------|
| **BG group** | Background-style tiles — **macro path only if every draw in the group is BG-type** (**§11.6**) | **One macro PNG** per **(group, pool variant)** + **anchor hash** | Macro sheet when **pure BG**; otherwise disabled (**§11.6**) |
| **OBJ group** | Sprites, animation, affine strips, **or any mixed membership** | **v1-style** tile8 + **standard overrides** as needed — **no macro** | Per-hash tiles + override rules (**§11.4**) |

**Explicit label (not auto kind):** When **defining** a group, the author **chooses BG or OBJ**. The tool may **suggest** a default from VIP **`layer`** on the selected draws (e.g. all layer `0` → suggest BG), but **does not change the label** without user confirmation.

**Mixed draw types:** Classify each member draw as **BG**, **OBJ**, or **Affine** using VIP **`layer`** (align with existing draw-list conventions: e.g. **0 → BG/world**, **1 → Affine**, **2 → OBJ/sprite** — exact mapping documented in implementation). If **more than one class** appears in the group, show a **warning**. **Effective mode:** unless **all** members are **BG**, the group uses **OBJ / v1-style** rules only (tile8 + overrides, **`color.vbcolor`** path) — **no** macro PNG export for that group. If the user **labeled BG** but membership is mixed, keep the label but show **warning** + **macro UI disabled** until they remove non-BG draws or switch to **OBJ**.

**Pure BG + label BG:** **Macro** workflow and **`painter_v2/bg/{group}__{variant}.png`** (**§11.2**).

**Resolution (runtime):** See **§7.4** and **§11**.

### 3.4 Rule types (runtime)

At minimum, distinguish:

1. **Tile8** — same shape as today: replacement **8×8 RGBA** (or pointer into a tile atlas) for this hash under this variant.
2. **Macro** — **PNG** (with alpha) placed at a defined **VIP rectangle** and **compositing order** relative to the normal draw list.

**Resolution:** See **§7.3** — two-pass composite: normal draws (with optional suppression inside macro rects), then ordered macro blits.

---

## 4. Fallback chain (target)

When resolving color for a draw (or a pixel), conceptually:

1. **v2 rule** for `(poolVariant, hash)` — tile8 or macro contribution.
2. Else **v1 pack** entry for `hash` (`color.vbcolor`).
3. Else **v1 overrides** (if still present during transition).
4. Else **mono / VIP fallback**.

**As built (Sep 2026)**, `compositeColorFrame` resolves in this order, most specific first:

1. **Position override** — `overrides.json`, optionally scoped to a group and a rect.
2. **The draw's own group** — `groups.json` `tileColors`, applied only to draws the group's
   criteria claim, so one pattern can be a different colour in every layer that draws it.
   See [group-tile-colors.js](../../src/group-tile-colors.js).
3. **Painter v2 rules** — `painter-v2-rules.json` `tile8ByVariant`.
4. **The shared pack** — `color.vbcolor`, per pattern, everywhere that pattern appears.
5. **Mono / VIP fallback.**

An **anchored BG group** is outside this chain: its paint is a positioned full-frame overlay
(`painter-v2-vip-overlays.json`) blended *after* compositing when the anchor is on the frame,
scaled by the same `masterBrightness` so it fades with the scene. It is stored by position, not
by pattern, which is why it cannot express "this pattern, this colour" and why the
painted-tiles inventory lists it per 8×8 cell instead.

Removing v1 later means **deleting branches and data** once v2 covers all needed cases — straightforward architecturally, independent of how much re-authoring is required.

---

## 5. vbpack and files (direction)

### 5.1 Compatibility

- Keep existing entries: `rom`, `color.vbcolor`, `overrides.json`, `groups.json`, `manifest.json`, `vipstates/`, `savestates/`, `screenshots/`, `ramdumps/`, etc.
- Add v2 artifacts in a **versioned, additive** way, for example:
  - New JSON: e.g. `painter-v2-rules.json` (name TBD), **or**
  - `manifest.schemaVersion` / `painterV2` block pointing at rule files and asset paths.

Old readers ignore unknown keys/files.

### 5.2 PNG storage and mapping

**v1 today:** `art_exports/*.png` is a **full-scene snapshot** on export/save; **no** manifest maps those PNGs to hashes or variants. The color layer does not consume them.

**v2 target:** Macro PNGs (primarily **BG groups**) live under a **stable prefix**, e.g. `painter_v2/bg/*.png`, with **JSON** linking **`(poolVariantId, anchorHash)`** (or explicit `groupId`) → `{ kind: 'macro', path, vipRect, … }`. **Filename convention (human + tool friendly):** **`{groupSlug}__{variantSlug}.png`** — double underscore separates group from variant; slugs are filesystem-safe (see **§11.2**).

**Resolution:** See **§7.2** (paths), **§5.2.1** (shared PNG).

#### 5.2.1 Shared PNG files

**Decision:** Multiple rules **may** reference the **same** zip path (e.g. one atlas PNG, different rects via `uvRect` later, or duplicate refs). v2.0 can use **one file per macro** for simplicity; sharing remains valid in the schema.

### 5.3 VIP filenames (authoring ergonomics)

- Keep **`vipstates/` flat**.
- **Prefix** VIP JSON names with a **user/state slug** (from capture or hand edit) and keep a **unique suffix** (existing id) to avoid collisions, e.g. `title-a3f9c2.json`, `in-game_level-02-7b1e4d.json`.
- **Slug rules** (charset, max length, collision handling) are implementation details but should be documented when capture tooling is updated.

**Resolution:** See **§7.8** — **manifest / `frameRegistry`** is authoritative; capture flow should emit slugged names; painter may rename via an explicit user action that updates manifest.

---

## 6. UI principles (minimal interaction)

Design constraints for v2 **first release**:

- **One primary task per screen** where possible (e.g. pick variant → pick hash / pick from scene → assign or edit asset).
- **No port** of v1’s full override matrix, advanced toggles, or parallel workflows unless a v2 story **requires** them.
- **Explicit non-goals** for v2.0 (documented below) so scope does not creep.

Suggested **initial** control categories (counts are illustrative, not final):

- Load pack / pick frame or variant.
- Scene canvas + **minimal** inspector (hash, variant, rule status).
- **Rules list or table** keyed by variant + hash (not a flat override list of dozens of rects).
- **One** export/save path that writes vbpack with v2 + optional v1 compatibility.

Anything else starts as **deferred** unless it blocks the primary loop.

### 6.1 Non-goals for v2.0 (proposal)

Defer unless proven blocking:

- **Affine-first** authoring, Affine-only macros, or Affine-specific group types (**§12**).
- Full v1 staging/import parity.
- Every v1 RAM override UI nuance.
- Per-cell override authoring as the default path.
- Memory-analysis authoring inside painter v2 (analysis may stay in existing tools; painter **consumes** pools).

---

## 7. Resolved decisions (item-by-item)

These replace the old “ambiguities checklist.” If implementation disagrees, update this section.

### 7.1 Variant collision — same `poolVariant`, different VIP frames

**Decision:** The **runtime rule lookup key** in v2.0 is **`(poolVariantId, tileHash)` only** — no `vipFile` / `frameId` in the first ship.

**Implication:** If two captures resolve to the **same** pool variant but need **different** colorization, authoring must **split variants** (refine WRAM discriminant, add a sub-state, or separate pool entries) so the variant id differs. That matches treating **game state** as the screen identity.

**Escape hatch (not v2.0):** Optional **`vipStateRef`** (or `frameId`) on a rule row if we ever need an exception without changing RAM layout — **defer** until a concrete game proves it necessary.

---

### 7.2 Hash reuse — tile8 vs macro placement

**Tile8:** If the same `tileHash` appears **K** times on the frame, **all K** draws get the **same** replacement tile. No per-position distinction without a different rule key (which v2.0 does not add).

**Macro:** A macro rule **always** includes:

- **`vipRect`:** `{ x, y, width, height }` in **VIP framebuffer coordinates** (384×224 space per eye; stereo policy TBD in implementation — likely one rect per eye or full canvas policy documented in code).
- **`pngPath`:** path inside the vbpack (e.g. `painter_v2/assets/title.png`).

The **`tileHash` in the rule key** is the **authoring anchor** (which hash you clicked / assigned in the UI), **not** where the PNG is drawn. Placement is **only** `vipRect`.

**Conflict:** For a given `(poolVariantId, tileHash)`, allow **either** a **tile8** rule **or** a **macro** rule, **not both**. Schema / save validation should reject duplicates.

**Same hash outside `vipRect`:** Still draws **tile8** if that is the rule type; **macro** does not move with each draw. If a **macro** rule exists for that hash, **tile8 is disallowed** for the same key — author must choose. Title workflows should prefer **macro + rect covering the artwork** (and optional suppression — §7.3) or **unique hashes** for per-8×8 work.

---

### 7.3 Macro vs draw order (compositing)

**Decision:** **Two-pass** compositing:

1. **Pass A — tile stack:** Walk the draw list in the **same order** as today’s color pipeline (`compareDrawCallOrderByWorld` / existing sort). For each draw:
   - If **`hideDrawsInRect`** is **true** for an **active** macro for this context and the draw’s **anchor** `(draw.x, draw.y)` lies inside that macro’s `vipRect`, **skip** this draw (no mono/tile8/v1 stamp for it). **Suppression is purely geometric** (anchor-in-rect), **not** filtered by whether the draw’s hash matches the macro’s rule key — so one title rect can clear a patch of unrelated 8×8 draws before the PNG is blitted.
   - Else resolve **v2 tile8** → else **v1 pack** → else **v1 overrides** → else **mono**, and stamp **8×8** as today.

2. **Pass B — macros:** Sort active macros by **`zOrder`** (integer, ascending = earlier = further back). For each macro, **blit** the PNG onto `vipRect` with **alpha**.

**Default for `hideDrawsInRect`:** **`true`** for macro rules (title-style “replace region”). Author may set **`false`** to **overlay** without suppressing underlying draws.

**Overlapping macros:** **Higher `zOrder`** draws **later** (on top). Undefined behavior if rects overlap and `zOrder` ties — implementation should **stable-sort** by rule id or path.

**Parallax / H-bias:** Same caveat as v1: compositor uses **per-draw anchors**, not per-scanline hardware behavior; macros are **flat** rectangles in VIP space.

**Stereo (L/R):** v2.0 can standardize on **one `vipRect` per macro in shared VIP coordinates** and apply the same blit to **each eye’s buffer** (or document eye-specific rects in schema later). Exact policy lives in implementation notes when wiring `compositeColorFrame`.

---

### 7.4 Groups vs rules (updated for BG macro / OBJ tile8)

**Decision:**

- **Runtime resolver** still uses **flat keyed rules** — no need to walk “group objects” per pixel at runtime.
- **Macro rows** are emitted **only** for groups that are **labeled BG** and **pass the pure-BG membership check** (**§3.3**, **§11.6**). Otherwise **no macro** for that group’s content.
- Those **BG / pure** groups **serialize** to **macro rule** row(s): **`(poolVariantId, anchorHash) → macro`** with `vipRect`, `pngPath`, `zOrder`, `hideDrawsInRect`; files under **`painter_v2/bg/{groupSlug}__{variantSlug}.png`** (**§11.2**).
- **OBJ-labeled groups** and **mixed-membership groups** **serialize** like **v1**: **tile8** per **`(poolVariantId, hash)`** plus **`overrides.json`** (or equivalent) for **position / cell** rules where needed — **no animated PNG** or other exotic formats in v2.0.
- **`groupId`** may appear in **v2 JSON** for **traceability**; the **emulator hot path** can ignore it if the keyed map is denormalized at load time.

This keeps **runtime** simple while matching **authoring** intent (sheet vs tile/override).

---

### 7.5 Dual write — v2 rules vs legacy `color.vbcolor`

**Decision (transition):**

1. **Always write** the **v2 rules file** (+ PNGs) when the user saves a v2 project.
2. **Tile8 rules:** **Also** flatten into **`color.vbcolor`** (same format as today) so a **v1-only** color layer / emulator build **still shows 8×8 recolors** where a tile8 rule exists. **Mapping:** v2 tile8 payload → same hash key as today.
3. **Macro rules:** **Cannot** be represented in classic vbcolor. **Requires v2-aware composite** in the app that loads `painter-v2-rules.json` (or equivalent). Until that ships, macros appear **only in painter preview** (acceptable for experimentation).

**After v1 removal:** Stop emitting vbcolor if everything is in v2 — **future** cleanup item.

---

### 7.6 Loading macro PNGs (browser, cache, limits, failure)

**Decision:**

- **Decode** in the browser (`createImageBitmap` preferred; `Image` + canvas fallback acceptable).
- **Cache** decoded bitmaps **per pack load** keyed by **`pngPath`** (and optionally file mtime / zip entry CRC if available).
- **Max size (initial):** **2048×2048** pixels — reject larger files at load with a **clear error** (author can split atlases). *Adjust if memory constrained on low-end devices.*
- **Missing file / corrupt PNG:** **Skip** that macro for the frame, **`console.warn`**, continue **Pass A** and **fallback chain** for those pixels; do **not** hard-crash the app.

---

### 7.7 Authoring — surfacing hash “uniqueness”

**Decision:** **Yes, minimally:**

- When a draw / hash is selected, show **“This hash appears **N** times on this frame.”**
- **Tile8 + N > 1:** informational only (expected behavior).
- **Macro + N > 1:** **soft warning** — e.g. “Macro uses a fixed rect; other instances of this hash outside the rect still use fallback coloring unless suppressed or given tile8 rules.”

No modal spam; **one inspector line** + optional subtle icon.

---

### 7.8 VIP filename slugs — who writes them

**Decision:**

- **Canonical reference:** **`manifest.frameRegistry[].vipStateFile`** (and paths inside zip) — not the filename alone.
- **Primary writer:** **Capture path in the main app** (Colorize / capture) should generate **`{stateSlug}-{uniqueId}.json`** when saving into `vipstates/`.
- **Painter v2:** May offer **“Rename frame”** that renames the zip entry and **updates `frameRegistry` + any internal refs** in one transaction — **no** silent rename without manifest update.

Slug rules (lowercase, safe charset, max length) stay **implementation-defined** but must be **cross-platform zip safe**.

---

## 8. Pseudocode reference (aligned with §7)

```text
context = resolvePoolContext(wram)   // → poolId, poolVariantId, …

activeMacros = v2.macrosFor(context.poolVariantId)  // each: vipRect, pngPath, zOrder, hideDrawsInRect

function anchorInsideAnySuppressedRect(draw):
  for m in activeMacros:
    if m.hideDrawsInRect && pointInRect(draw.x, draw.y, m.vipRect):
      return true
  return false

for draw in sortedDraws(vipState.drawList):
  if anchorInsideAnySuppressedRect(draw):
    continue

  rule = v2.tile8Lookup(context.poolVariantId, draw.tileHash)  // macro excluded here
  if rule:
    composite8x8(draw.x, draw.y, rule.rgbaOrRef)
    continue
  if v1.pack.has(draw.tileHash):
    composite8x8(draw.x, draw.y, v1.pack[draw.tileHash])
    continue
  if v1.overrideMatches(draw, context):
    composite8x8(draw.x, draw.y, v1.overrideRgba(...))
    continue
  monoFallback(draw)

for macro in sortByZOrder(activeMacros):
  blitPng(macro.pngPath, macro.vipRect)
```

**Note:** `tile8Lookup` must not return a macro row; macro rows are **only** in `macrosFor` + **Pass B**. If schema stores one table, split by `kind`.

---

## 9. Related documents

- [art-pack-file-format.md](../reference/art-pack-file-format.md) — current zip layout; v2 will extend additively.
- [paint-tool-game-state-pools-ux-plan.md](../history/archive/paint-tool-game-state-pools-ux-plan.md) — pools / variants (v1 UX; concepts carry over).
- [paint-tool-image-import-export.md](../history/archive/paint-tool-image-import-export.md) — v1 `art_exports/` behavior (differs from planned v2 macro mapping).
- [graphics-next-investigations.md](../planning/graphics-next-investigations.md) — affine / rendering investigations; relevant when **§12** work starts.

---

## 10. Document status

- **Living spec** for painter v2 / `painter.html`.
- **§7** is the **decision log** — revise when product/runtime proves a choice wrong (note date in commit message).

### 10.1 Implementation (alpha shell)

**Shipped:** `tools/project.html` + `tools/painter.js` (its parts in `tools/painter/` since Oct 9 2026) — vbpack authoring: **Open pack**, **frame** dropdown (`vipstate-current` + `vipstates/*`) with **< / >** stepping, **eye / layer** filters, **world 0–31** toggles + All, **canvas** = `compositeColorFrame` (same implementation as the main app color layer; **WRAM `null`** in the tool so gated overrides are skipped). **Groups** rail: pool-linked groups, anchor BG overlay paint, **Save .vbpack** round-trips **`painter-v2-rules.json`**, **`painter-v2-vip-overlays.json`**, **`manifest.painterV2LastVipFile`**, plus **`groups.json`** / vbcolor / overrides as before.

**Main emulator:** Loading a `.vbpack` (or last pack) applies **`painterV2Rules`** into `compositeColorFrame` (variant = first pool variant when present, else `__default__`) and blends **`painter-v2-vip-overlays.json`** after each eye composite when the anchor tile is present on the live frame. (Paint v1 was removed in Sep 2026.)

---

## 11. BG vs OBJ — behavior, naming, OBJ asset management

### 11.1 Does “group = macro” make sense?

**Yes** for **background-style** work:

- One **bounding box** and one **PNG** match how artists think about **panels, skies, title art**.
- **Always generating a PNG** (starting from **monochrome** rasterization of the grouped draws into `vipRect`) means:
  - External tools always have a **concrete file** to edit.
  - The pipeline is **uniform** (“open pack → find `painter_v2/bg/` → edit PNG → save”).
- The **anchor hash** stays the **compact lookup key** with **`poolVariant`** so WRAM state still selects the right sheet.

**Caveat:** BG groups must be **authored** so the bbox is correct (window/layer criteria, which draws belong to the group). Scrolling BGs may need **multiple variants** or **per-frame** sheets if the same group content moves — that’s still **variant-level** PNGs, not per-8×8 explosion.

### 11.2 Naming scheme (vbpack useful outside painter)

**Convention:** `painter_v2/bg/{groupSlug}__{variantSlug}.png`

- **`groupSlug`:** from user-visible group name, sanitized (`[a-z0-9_-]`, max length cap).
- **`variantSlug`:** from pool variant id or display label, sanitized the same way.
- **`__` (double underscore):** separator so single underscores inside names don’t collide.

**Optional:** If two BG groups could share the same pair, append a short hash suffix: `title__in-game-a1b2.png`.

**JSON** still records the **canonical path** and **`vipRect`** so renames don’t break resolution if someone edits the zip manually (prefer updating JSON if renaming files).

### 11.3 Tool UX — distinct BG vs OBJ

**Visual:**

- **BG group** rows: **cool / muted** styling, icon “sheet”, badge **BG**.
- **OBJ group** rows: **warmer / accent** styling, icon “sprite”, badge **OBJ**.

**Behavior:**

- **New group:** **Required** step — **BG** or **OBJ** (radio or toggle). Optional **“Suggest from selection”** reads **`layer`** on current draws and pre-selects BG vs OBJ; user can override.
- **BG group selected:** If **pure BG** (**§11.6**): **macro** panel — bbox, anchor hash, PNG preview, **Regenerate from mono**, replace file. If **mixed / impure**: show **warning banner**; **macro actions disabled**; offer **“Switch to OBJ”** or **“Remove non-BG draws”**.
- **OBJ group selected:** **v1-style** panel — hash list, **8×8** paint, **overrides** (cell / rect / layer) as in v1; **no** macro path.

**Warnings:** If membership mixes **BG / OBJ / Affine**, show non-blocking **warning** listing which classes are present; **effective export** follows **§3.3** (OBJ path unless pure BG + label BG).

### 11.4 OBJ groups — how to manage assets (v1-like vs new)

**Decision (v2.0):** **Stick with v1-style** for OBJ and for **any group that is not pure BG**.

- **Storage:** **`(poolVariantId, hash) → 256-byte RGBA`** in the v2 rules blob and **dual-write** to **`color.vbcolor`** (**§7.5**).
- **Overrides:** Use the **same override model as v1** (`overrides.json`: rects, `groupId`, `layer`, optional RAM conditions) when the artist needs **per-cell** or **position** behavior — **not** a new override dialect for v2.0.
- **No APNG / animated PNG** in v2.0 (**§11.5**). Animation remains **driven by game state / variants + different hashes per frame**, not a flipbook file format.
- **Optional later:** **UX-only** helpers (timelines, multi-capture) on top of the same tables.

**Summary:** **OBJ** (and **mixed** groups) = **tile8 + v1 overrides** as needed. **Pure BG + label BG** = **macro PNG** only.

### 11.5 Multilayer PNGs, APNG, and sprite animation (not v2.0 default)

**“Multilayer PNG where you toggle layers per animation frame”** is **not** a standard portable format. A **.png** file is a **single** raster (plus metadata chunks). **Layers** exist in **source** apps (PSD, GIMP XCF, Aseprite) but flatten away on export to PNG unless you ship **multiple PNGs** or a **custom bundle** (e.g. one JSON listing layer PNGs + which subset is visible for `frameIndex`).

**Animated PNG (APNG)** **is** a real thing: an extension of PNG that stores **multiple frames** and timing in one file, similar **in role** to **animated GIF** but usually **better** (full alpha, more colors). Browsers generally **decode APNG**; desktop tools vary. It is **frame sequences**, not “layers on/off” unless each frame is a composite you authored that way.

**Animated GIF:** same idea as APNG for consumers (flipbook), worse alpha and palette limits.

**Is multilayer / APNG overkill for VB OBJ?** Often **yes for v2.0**:

- Your **game already** picks which tiles appear each frame (VIP draw list + hashes). The **simplest** match is still **`(poolVariantId, hash) → tile8`**, where **pool variant** (or capture) tracks **which animation phase** the RAM is in — **no** extra animation format in the pack.
- **Sprite sheet (one PNG + JSON frame rects)** or **`walk-0.png`, `walk-1.png`, …** are **simple for external artists** and easy to implement (choose file by variant or index).
- **APNG** is a **single-file** convenience for a flipbook; you’d still map **which APNG frame** lines up with **which game variant** — doable, but another decoder path and editor workflow.

**If** you want Photoshop-style layers later, treat it as **v2+**: e.g. `painter_v2/obj_layers/{sprite}__{variant}/layer-01.png` + `layers.json` with visibility per `logicalFrame`, **or** keep authoring in Aseprite and **export** to sheet/APNG as a build step — avoid inventing a proprietary “smart PNG” that no tool understands.

### 11.6 Pure-BG membership (layer classes)

**Purpose:** Decide whether a **BG-labeled** group may use the **macro sheet** path.

**Per-draw class** (from VIP draw list, same notion as v1 painter):

| `layer` (typical) | Class | Notes |
|-------------------|--------|--------|
| `0` | **BG** | World / background strips |
| `1` | **Affine** | **Non-BG** for **macro purity** only (**§12** — no dedicated Affine mode in v2.0) |
| `2` | **OBJ** | Sprites |

**Pure BG:** Every draw in the group has **class BG** (`layer === 0` in this mapping). **Implementation** should match whatever `color-layer` / paint tool already use for layer enums; adjust table in code comments if the core uses different values.

**Impure:** Any **OBJ** or **Affine** draw → group **cannot** export a macro sheet; **effective** authoring = **§11.4** (tile8 + v1 overrides). **Warning** copy should name the offending classes (e.g. “Contains sprite or affine draws”). **Runtime** for Affine draws stays whatever **v1 / `color-layer`** already does until the **Affine track** (**§12**) ships.

---

## 12. Affine layer — deferred (separate track)

**Painter v2.0:** **No** Affine-specific authoring mode, macro rules, or group type. Affine draws remain **`layer === 1`** in the draw list; they **break pure-BG** for grouping (**§11.6**) and otherwise follow **existing** colorization behavior (tile8 / pack / overrides as implemented today), without new spec.

**Why separate:** Affine is its **own problem space** — not just “another sprite.” Use cases to **research** before designing:

- **Line / wireframe–style objects:** “Line” sprites **rotated** (and otherwise transformed) **at runtime** so games avoid a **large library of pre-rotated tiles**; the hardware applies the transform **on the fly**.
- **Scaling and other affine transforms:** Games use the affine layer for **scaled** (or skewed) imagery; colored output should **match** the same **transform** as mono (i.e. **like BG/OBJ recolor** but **sampled through** the VIP’s **affine transform**, not a new asset shape).

**Future direction (not committed):** Dedicated **Affine** workflow in painter + composite path that **respects per-draw affine matrices** end-to-end; possibly different from flat **8×8 stamp** assumptions. **Until then:** do not expand v2.0 scope to “solve Affine”; capture findings in a follow-up doc or §12 appendix when research lands.

**Related:** [graphics-next-investigations.md](../planning/graphics-next-investigations.md) (affine / artifacts) — may overlap once work starts.

---

## 13. Painter preview — backlog

Items deferred from the in-browser painter (`tools/project.html` / `tools/painter.js`); revisit when groups / capture metadata evolve.

- **Default “memory pool + variant” for New group from selection:** Heuristics tried so far (manifest `frameRegistry` + VIP stems vs `gameStatePools` `analysisStateKey` / variant `id`, reuse from existing matching groups, Painter v2 variant only when it uniquely identifies one row) still fail or mislead on common packs (e.g. root **Current** frame, many pools sharing `__default__`). **Resolved (Sep 2026):** the dialog now matches the frame's own captured WRAM against each pool's RAM fingerprint (`src/pool-match-by-ram.js`) first, falls back to the name match, and says when the two disagree or several pools tie.
