---
status: partial
last-reviewed: 2026-10-10
covers: src/color-layer.js
---

# Color pack overrides (design only)

**Status (Oct 2026):** superseded. The cases it describes are covered by **groups** with their
own tile colours (one pattern, a different colour per world/layer), **position overrides**
(`overrides.json`, `resolveOverrideRgba`), **overpaint** pictures, and screen limits and game states
— see [art-pipeline.md](../reference/art-pipeline.md) §3–4. Kept for its reasoning.

**Not implementing now.** This doc sketches how we could support **per-context overrides** when the same tile (same hash) is re-used in different places and you want different colors in each.

---

## The problem

One tile (same 16-byte content → same hash) can appear in multiple places. The pack has **one** entry per hash, so that tile gets one colorization globally. Sometimes you want:

- **Place A:** e.g. the vertical line on the back of the “B” in “VIRTUAL BOY” — one color or shape.
- **Place B:** the same tile used elsewhere (e.g. in a different word or UI) — different color or no color.

Without overrides, you have to pick one look for that hash and live with it everywhere.

---

## What an override would do

“When this tile (hash **H**) is drawn **in this context**, use **this** color (or this other tile’s color) instead of the main pack entry for H.”

So the runtime would:

1. Look up the draw’s tile hash in the main pack (as now).
2. **Optional:** Check an override list: “Is there an override for this hash that matches this context?”
3. If yes, use the override’s RGBA (or the RGBA of an alternate hash). If no, use the main pack entry (as now).

---

## Context: what could “this context” mean?

| Context type | Description | Pros | Cons |
|--------------|-------------|------|------|
| **Position (x, y)** | Override applies when the tile is drawn with `(call.x, call.y)` inside a rectangle (e.g. `xMin ≤ x < xMax`, `yMin ≤ y < yMax`). | Simple, no scene detection; easy to author for a fixed screen (e.g. title). | Tied to one layout; if the same screen scrolls or moves, the rect may be wrong. |
| **Position + eye** | Same as above but with “left eye only” or “right eye only”. | Handy if the glitch is only in one eye. | Slightly more to author. |
| **Draw index / layer** | Override when this hash is drawn as the Nth draw, or when it’s on layer OBJ. | Can distinguish “first time we see this tile” vs “second time.” | Fragile (draw order can change); hard to author. |
| **Scene id** | Override when “we’re on the title screen” (or some other scene). | One override set per “place” in the game. | Requires defining what a “scene” is (e.g. hash of first 100 draws, or manual id per vbstate). |

**Recommendation for a first version:** **position-based** overrides only. You’d say: “For hash H, when drawn in the rectangle (x1, y1)–(x2, y2), use this RGBA (or this other hash’s RGBA).” That fits the “vertical line on the B” case: you’d define a small rectangle that covers the B’s area on the title screen and attach the alternate 8×8 to that region.

---

## Moving sprites (OBJ): position doesn’t work

Position-based overrides only work when the tile is drawn at a **fixed** place (e.g. text, HUD, background). If the same tile is used in an **OBJ (sprite)** that **moves** — enemy, character, moving UI — then (x, y) changes every frame. A rectangle “only when at (100, 50)” would rarely match, or would match the wrong frame. So for moving sprites we need a **different strategy**.

| Strategy | Idea | Works for moving? | Notes |
|----------|------|-------------------|--------|
| **Layer** | Override when the draw is on layer **OBJ** (or BG / Affine). Pack key becomes “hash + layer” instead of just “hash.” | Yes | Same tile can have one color as BG and another as OBJ. Doesn’t distinguish two different sprites that both use the same tile on the same layer. |
| **Palette selector** | VB draw has `paletteSelector` (0–3). Pack key: “hash + paletteSelector.” | Yes | If the game uses different VB palettes for the same tile in different contexts, we can give different RGB per palette. Doesn’t help when the game uses the same palette for both uses. |
| **OAM / object id** | If the core could tag each draw with “OAM index” or “object id,” we’d override by “hash + object id.” | Yes | Would follow the sprite as it moves. Requires the patched core to expose which object (OAM entry or similar) produced each draw; not in the current draw list. |
| **Draw order** | Override when this hash is the Nth draw in the list. | Unreliable | Draw order for sprites changes every frame as they move; no stable “N.” |
| **Position** | Override when (x, y) in a rectangle. | No (for moving) | Only good for fixed screen elements. |

So for **moving sprites** the practical options are:

1. **Layer-based key (pack v2):** Pack entries keyed by `(hash, layer)` instead of just `hash`. Same tile gets one RGBA when drawn as BG and another when drawn as OBJ. No per-sprite distinction: if two different moving sprites share the same tile on OBJ, they still share the same color.
2. **Palette-selector key (pack v2):** Pack entries keyed by `(hash, paletteSelector)`. Same tile can have up to 4 different looks if the game uses different VB palettes for it. Our format doc already mentioned “Optional: palette index (future)” for v2.
3. **Object id (future core):** If the core could add something like `oamIndex` or `objectId` to each draw, we could support “override for hash H when drawn by object 5,” and that would follow the sprite everywhere. Would need a core change and a new override or pack format.

**Summary:** Position overrides are for **fixed** screen elements (title text, HUD). For **moving** OBJs, we’d need **layer** or **paletteSelector** (or future **object id**) as part of the pack/override key, not position.

---

## What it could look like (authoring)

A concrete **paint-tool user flow** is in **[paint-tool-overrides-flow.md](../history/archive/paint-tool-overrides-flow.md)**. Summary:

- **One control:** “Apply to: Everywhere (pack) | This position only (override)” in the tile painter. Default = Everywhere (current behavior).
- **Same paint UX:** User paints as today; on stroke end, we commit to pack or to an override for the selected draw’s 8×8 cell, depending on “Apply to”.
- **Two exports:** “Export .vbcolor” (pack), “Export overrides” (JSON sidecar). Emulator loads pack + overrides file separately.

Earlier sketch (for reference):

- **In the paint tool:** When you have a tile selected, choose “This position only” and paint → that becomes one override (hash + rect of the selected draw’s cell + RGBA).
- **Override list (optional):** A small list of overrides: “Hash 0x… at (x,y)” for edit/delete; v1 can skip and only show “Overrides: N”.
- **Export:** Sidecar .json file (implemented in main app); paint tool exports the same JSON format.

---

## What it could look like (runtime)

- **App loads:** Pack as now; optionally load overrides (from inside the pack or from a sidecar).
- **Each frame, for each draw:**  
  - Hash H, (x, y) from the draw.  
  - Look up H in the main pack → default RGBA.  
  - If overrides exist, check: is there an override for H whose rectangle contains (x, y)? (Or the draw’s **tile origin** (call.x, call.y) in 8×8 units: e.g. one override per 8×8 cell.)  
  - If an override matches, use the override’s RGBA (or look up `alternateHash` in the pack and use that).  
  - Else use the main pack RGBA.  
- **Drawing:** Same as now (one 8×8 at (x, y)); only the source of the RGBA changes.

So the change is: **one extra lookup per draw** (override list by hash + position); no change to how we composite.

---

## Minimal data shape (for later)

Example override entry (conceptual):

- `hash` (number): tile hash this override applies to.
- `xMin`, `yMin`, `xMax`, `yMax` (number): pixel rectangle; override applies when `call.x >= xMin && call.x < xMax && call.y >= yMin && call.y < yMax` (or similar; we could use tile-aligned bounds).
- `rgba` (256 bytes or base64): the 8×8 RGBA to use, **or**
- `alternateHash` (number): use the main pack’s entry for this hash instead (so you can “point” to another tile’s colorization).

One override can apply to one (hash, region) pair. Multiple overrides can apply to the same hash for different regions.

---

## Overrides JSON format (implemented)

The app accepts an optional **Overrides** file (`.json`) via the "Overrides (optional)" file input. The file must be a JSON **array** of override entries. Each entry is an object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hash` | number | yes | Tile hash this override applies to (same as pack hash). |
| `xMin` | number | yes | Left edge of rectangle (inclusive). |
| `yMin` | number | yes | Top edge of rectangle (inclusive). |
| `xMax` | number | yes | Right edge of rectangle (exclusive). |
| `yMax` | number | yes | Bottom edge of rectangle (exclusive). |
| `rgbaBase64` | string | no* | Base64-encoded 256-byte RGBA (8×8×4) for this region. |
| `alternateHash` | number | no* | Use the pack entry for this hash instead of custom RGBA. |

\* One of `rgbaBase64` or `alternateHash` must be present.

**Match rule:** For a draw with hash `H` at pixel position `(x, y)`, the first override in the array with `hash === H` and `xMin <= x < xMax && yMin <= y < yMax` wins. That override’s RGBA is used (from `rgbaBase64` or from `packEntries.get(alternateHash)`).

**Example (hand-authored or future export from paint tool):**

```json
[
  { "hash": 12345, "xMin": 80, "yMin": 40, "xMax": 88, "yMax": 48, "rgbaBase64": "..." },
  { "hash": 12345, "xMin": 96, "yMin": 40, "xMax": 104, "yMax": 48, "alternateHash": 67890 }
]
```

---

## Summary

- **Goal:** Let a single re-used tile (same hash) have **different colors in different places** (e.g. one for the B’s vertical line, one for elsewhere).
- **Fixed screen (e.g. title text):** **Position-based overrides** — “For hash H, when drawn in rectangle R, use this RGBA.” First version fits this.
- **Moving sprites (OBJ):** Position doesn’t work (x,y changes every frame). Need a **different strategy:** pack/override keyed by **layer** (hash + BG/OBJ) or **paletteSelector** (hash + 0–3), or future **object id** from the core.
- **Authoring:** Paint tool could let you add “override when in this region” for position; for layer/palette, could be “use this RGBA when this hash is drawn on OBJ” (or with palette 2).
- **Runtime:** Resolve hash (and optionally layer/palette) to RGBA; if position overrides exist, check (x,y) in rect and use override when it matches.

**Implementation:** Position-based overrides are implemented: load a pack and an optional overrides JSON file; status shows "Overrides: N". See `src/color-layer.js` (`parsePositionOverrides`, `resolveOverrideRgba`, `compositeColorFrame`) and the Overrides file input in the main app.

**Conditional overrides (layer + preview):** For moving sprites and tiles shared across layers (e.g. blimp vs clouds), we now support optional **layer** on overrides and **“Apply at: Everywhere (this layer)”** so one override can apply to all draws with that hash on that layer. The paint tool can **preview** which draws would match. See [conditional-overrides-design.md](conditional-overrides-design.md).
