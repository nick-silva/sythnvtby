---
status: partial
last-reviewed: 2026-10-10
covers: src/color-layer.js
---

# Conditional overrides: layer, RAM, and paint-tool preview

**Status (Oct 2026):** built in a different shape. Overrides carry an optional `layer` and
`ramConditions`; groups scope paint by worlds and layers; RAM conditions moved from single groups
to **memory pools** (screens, *Paint shows on*) and **game states** (*Paint shows when…*). See
[art-pack-file-format.md](../reference/art-pack-file-format.md) §6 and
[memory-states.md](memory-states.md). Kept for its reasoning about the blimp case.

This doc describes the problem (moving blimp vs shared tiles), the design for **conditional overrides** (layer + optional RAM), and how the paint tool can let you author and **preview** which draws are affected.

---

## The problem

On the Mario Clash intro screen:

- The **blimp** uses tiles that are **solid color** (same 8×8 content everywhere). Those tiles are **reused** across the game — other screens and, on the **same** screen, the **clouds at the bottom** use the same tile (same hash).
- **Position-based overrides** (hash + rectangle) don’t work for the blimp: the blimp **moves**, so the override at fixed (x,y) is “lost” as soon as the blimp moves. When the blimp overlaps the clouds, position can’t distinguish “blimp tile” from “cloud tile” at the same pixel.
- We need overrides that apply under **conditions** other than position: e.g. “this color only when the tile is drawn on **layer BG**” (blimp) vs “when on **layer OBJ**” (something else), or “only when **level ID** in RAM is 3.”

---

## Goals

1. **Layer condition** — Override can optionally apply only when the draw’s **layer** matches (0 = BG, 1 = Affine, 2 = OBJ). So “same hash, color A on BG, color B on OBJ” and “color the blimp’s solid tiles only when they’re BG” (clouds might use the same tile on a different layer or we still need more conditions).
2. **RAM / scene conditions (future)** — Override can optionally apply only when selected **RAM** values match (e.g. “level ID at 0x0500 === 3”). Requires the core to expose a small RAM snapshot in VIP state (or a separate push). Not implemented until we have that.
3. **Backward compatibility** — Overrides **without** layer or RAM conditions behave as today (match all layers, any position in rect).
4. **Paint tool** — Filter by layer (already exists). When adding an override, optionally set **layer condition** (Any / BG / Affine / OBJ). **Preview on canvas:** highlight all draws that would match the current override conditions (hash + optional layer + optional position), so you see exactly which tiles are affected before committing.

---

## Override shape (extended)

Each override entry can have:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hash` | number | yes | Tile hash this override applies to. |
| `xMin`, `yMin`, `xMax`, `yMax` | number | yes* | Position rectangle. Override applies when draw position (x,y) is inside [xMin, xMax) × [yMin, yMax). |
| `layer` | number | no | If present (0, 1, or 2), override applies **only** when `draw.layer === layer`. If omitted, applies to all layers (current behavior). |
| `rgba` / `rgbaBase64` | Uint8Array / string | no* | 256-byte RGBA for this override (or base64 in JSON). |
| `alternateHash` | number | no* | Use pack entry for this hash instead of custom RGBA. |
| `ramConditions` | object | no (future) | e.g. `{ "0x0500": 3 }` — override only when `state.ramSnapshot["0x0500"] === 3`. Requires core to push RAM. |

\* Same as today: one of rgba/rgbaBase64 or alternateHash required. Position (xMin..yMax) can be omitted for “any position” overrides when layer (or RAM) is set — then the override applies to **every** draw with that hash and matching layer (and RAM). So we need to allow “no rect” for global hash+layer overrides.

**Match rule (runtime):** For a draw with hash `H`, position `(x, y)`, layer `L`:

1. For each override in order: if `o.hash !== H` skip. If `o.layer !== undefined && o.layer !== L` skip. If override has position and `(x, y)` is outside the rect, skip. If `o.ramConditions` is present (future), check RAM; if any condition fails, skip.
2. First override that passes all checks wins; use its RGBA (or alternateHash lookup).

**Position optional:** If an override has **no** position (e.g. we store `xMin == null` or we use a sentinel like `-1` or omit the rect), then position is not checked — “any (x,y)” for that hash + layer. So we can have:

- “Hash 0x12345, layer 0 (BG), no rect” → all BG draws with that hash get this color (perfect for moving blimp).
- “Hash 0x12345, layer 2 (OBJ), no rect” → all OBJ draws with that hash get another color.

We need to decide: in JSON, do we allow omitting xMin/yMin/xMax/yMax when layer is set? If we omit them, runtime “position check” is skipped. So: **optional position** — when xMin/yMin/xMax/yMax are all present and valid, match by rect; when they’re omitted (or we use a convention like 0,0,0,0 meaning “no rect”), match by hash (+ layer) only.

---

## RAM conditions (future)

- **Core change:** The patched core would push, with VIP state (or separately), a small **RAM snapshot**: e.g. a map `{ "0x0500": number, "0x0502": number, ... }` for addresses the app cares about. Games often keep “current level” or “scene id” in a known RAM location.
- **Override entry:** `ramConditions: { "0x0500": 3, "0x0501": 0 }` — override applies only when RAM at 0x0500 is 3 and 0x0501 is 0.
- **Authoring:** In the paint tool, “Capture RAM” at current frame (if core provides it) and “Add condition: level ID = 3” would add that to the override. Until the core exposes RAM, we document the shape and leave it unimplemented.

### Using vbpack memory-analysis candidates (planned next)

- Source: `manifest.memoryAnalysis.topCandidatesByState` written by the memory tool.
- Override UI will add a **Game-state condition** picker:
  1. Choose `stateName`.
  2. Choose candidate location from that state (top-3 list).
  3. Tool fills `offset` + `expectedValue` for that state.
- Saved override shape will include:
  - `ramConditions: [{ offset, expectedValue, stateName, source: "memoryAnalysis" }]`
- Runtime match then requires:
  - hash/layer/position/group checks pass **and**
  - `currentWram[offset] === expectedValue`

This ties the paint tool directly to analyzed state families and keeps the condition authoring user-friendly (“pick state + candidate”) instead of manual hex entry.

---

## Paint tool: layer filter and override conditions

- **Filter by layer (existing):** “Filter: All / Background tiles / Affine / Sprites (OBJ)” already filters which draws are shown and which you can click. So you can isolate BG and click only blimp/cloud tiles.
- **Override layer condition:** When “Apply to: This position only (override)” is selected, add a control: **“Override layer: Any | Background | Affine | Sprites (OBJ)”**. Default = **Any** (current behavior). If set to e.g. **Background**, the override is stored with `layer: 0` and will apply only when that tile is drawn on layer 0. So you can add “hash H, layer 0, no position” → all BG draws with that hash get this color (blimp); same hash on OBJ would use pack or another override.
- **Position optional when layer is set:** When adding an override, if **Override layer** is not Any, we can offer “Apply at: This 8×8 only | Everywhere (this layer)”. “Everywhere (this layer)” stores the override with no position rect (or a sentinel) so it applies to every draw with that hash on that layer. So the blimp case: select a solid tile on the blimp (BG), set Override layer = Background, Apply at = Everywhere (this layer), paint → one override for (hash, layer 0, no rect).

---

## Paint tool: preview “which tiles would be affected”

- **Checkbox:** “Highlight draws matching override conditions” (or “Preview override match”). When **on**:
  - We define “current override conditions” from either (a) the **selected override** in a list, or (b) the **template** we’re about to add: hash = selected tile hash, layer = override-layer dropdown (or selected draw’s layer), position = “this 8×8” or “everywhere”.
  - We compute **all draw indices** that match: same hash, and (if layer condition) same layer, and (if position) draw’s (x,y) in rect.
  - On the **main canvas**, we draw an outline (e.g. **magenta** or a distinct color) around every 8×8 that is one of those draws. So you see exactly which tiles on the frame would get this override.
- **When no override selected:** “Preview” can use the template: selected draw’s hash + current “Override layer” + “Apply at” (this cell vs everywhere). So before you paint, you can turn on “Preview override match” and see “if I add this override with layer=BG and everywhere, these 47 draws will get it.”

This gives you confidence that the blimp’s solid tiles (and not the clouds) are the ones highlighted, or vice versa, depending on layer.

---

## Implementation order

1. **Layer condition (runtime + format)**  
   - Extend override type: optional `layer`.  
   - `parsePositionOverrides`: accept optional `layer` (0|1|2).  
   - `resolveOverrideRgba(overrides, hash, x, y, packEntries, drawLayer)`: when `drawLayer` is provided, skip overrides where `o.layer !== undefined && o.layer !== drawLayer`.  
   - `compositeColorFrame`: pass `call.layer` into resolve.  
   - **Optional position:** Allow overrides with no rect (e.g. omit xMin/yMin/xMax/yMax or use 0,0,384,224 for “full frame” or a sentinel). When no rect, position check is skipped. So “hash + layer only” override applies to every draw with that hash on that layer.

2. **Paint tool: override layer + optional position**  
   - UI: “Override layer: Any | Background | Affine | Sprites” and “Apply at: This 8×8 only | Everywhere (this layer)”.  
   - When committing an override, store `layer` when not Any; when “Everywhere (this layer)” store no rect (e.g. 0, 0, 384, 224 or a sentinel).  
   - `resolveOverride` in paint.js: same logic as runtime (hash + rect + layer).

3. **Paint tool: preview matching draws**  
   - Add “Highlight draws matching override conditions” checkbox.  
   - “Current conditions” = selected tile hash + override-layer dropdown + apply-at (this cell or everywhere).  
   - `getDrawsMatchingConditions({ hash, layer?, xMin?, yMin?, xMax?, yMax? })` returns draw indices.  
   - In `renderFrame`, when preview is on, draw magenta (or similar) outline around those draws’ 8×8 rects.

4. **Export/import**  
   - Overrides JSON and vbpack: include `layer` in each entry when present. Omit position or use full-frame rect when “everywhere”.

5. **RAM conditions (later)**  
   - When core exposes RAM snapshot, add `ramConditions` to override shape and to resolve logic; add UI in paint tool to capture and add RAM conditions.

---

## Summary

| Need | Solution |
|------|----------|
| Blimp vs clouds (same tile) | Override with **layer** condition (e.g. BG only) so blimp’s BG draws get one color; no position needed when layer is set. |
| Moving blimp (position useless) | “Apply at: Everywhere (this layer)” → override with no position rect; applies to every draw with that hash on that layer. |
| See which tiles are affected | “Preview override match” highlights on the canvas all draws that match the current conditions (hash + layer + optional rect). |
| Level / scene (future) | **RAM conditions** in override when core pushes RAM snapshot; override only when e.g. level ID matches. |

**Groups (next):** For “same tile in blimp vs clouds” we need **named groups** of draws (e.g. “Blimp”) and override scope by group, plus paint-tool visibility toggles. See [tile-groups-requirements.md](tile-groups-requirements.md).

---

## Mesen NES HD pack (reference)

Mesen’s HD Pack feature for NES faces the same kind of problem: the same tile+palette can appear in multiple contexts (different sprites, background vs foreground, different screens). They solved it with a **condition system** in the `hires.txt` definition file. Reference: [Mesen HD Packs documentation](https://mesen.ca/docs/hdpacks.html).

### How Mesen does it

- **Rules** map (tile data + palette data) → replacement (PNG location). The **first matching rule** in file order is used. So more specific (conditional) rules must appear **before** fallback rules for the same tile+palette.
- **Conditions** are optional and attached to a rule. If present, the rule is used only when all listed conditions are true.
- **Composition:** Multiple conditions can be combined with `&`; any condition can be inverted with `!`.

### Condition types (relevant to us)

| Mesen condition | What it does | Our equivalent / idea |
|-----------------|--------------|-------------------------|
| **Built-in** `bgpriority`, `hmirror`, `vmirror` | Per-pixel/sprite flags (background-priority sprite, horizontal/vertical mirror). | We have **layer** (BG/Affine/OBJ) and **flipH/flipV** in the draw list. We could add optional flip conditions to overrides. |
| **tileNearby / spriteNearby** | “Is there a specific tile/sprite at offset (Δx, Δy) from the current pixel?” Tile/sprite identified by tile data + palette. | We could add **neighbor conditions**: “override when another draw with hash X (and optional layer) exists at offset (-8,0)” etc. Useful when the same tile appears in two different “shapes” (e.g. blimp vs cloud) that we can tell apart by what’s next to them. |
| **tileAtPosition / spriteAtPosition** | “Is there a specific tile/sprite at **screen position** (x, y)?” | Like our position rect, but used as a **condition** for another tile (e.g. “use this replacement when the tile at (10,10) is the title logo”). We could support “override when any draw in rect R has hash H” as a condition. |
| **memoryCheck** | Compare value at address A with value at address B (with optional mask). Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`. | Our **ramConditions** (future): same idea — compare RAM at given address(es) to constants or other addresses. Mesen’s mask is useful for “level ID in bits 4–7”. |
| **memoryCheckConstant** | Compare value at address A with a **constant** (with optional mask). | Direct match for our “level ID === 3” style condition. |
| **frameRange** | Condition true when `(frame % divisor) >= compareValue` (e.g. animation phase). | We could add **frame conditions** if we have frame number in state (we do: `frameNumber` in VIP state). Useful for “flash every 8 frames” or “only on even frames”. |

### Takeaways for our design

1. **Rule order** — We already use “first matching override wins.” Keeping that and documenting that **more specific overrides (with layer, RAM, or neighbor conditions) should be listed before broader ones** matches Mesen and gives authors control.
2. **RAM conditions** — Mesen’s **memoryCheckConstant** (address, operator, constant, optional mask) is a good model for our `ramConditions`: support comparison with a constant and an optional bitmask so we can check “level ID in bits 4–7” without tying to a single byte.
3. **Neighbor / context conditions** — **tileNearby** is powerful: “use this replacement only when tile X is drawn next to this one.” We could add **neighborConditions**: e.g. “override when there exists another draw with hash H2 at (this.x + dx, this.y + dy) in the same frame.” That would help when layer alone isn’t enough (e.g. same tile on same layer in two different objects that we distinguish by surrounding tiles).
4. **Built-in draw flags** — We already have layer; we could add optional **flipH** / **flipV** to overrides so “same tile, mirrored” can get a different replacement (or the same one with our pack already storing flipped art).
5. **Frame-based conditions** — If we ever need animation-phase or timing-based overrides, we have `frameNumber` in VIP state; a condition like “frame % 8 < 4” could be added similarly to Mesen’s frameRange.

We don’t need to implement all of this at once, but Mesen’s format is a useful reference when we hit “same tile, different context” cases that layer + RAM don’t fully solve.
