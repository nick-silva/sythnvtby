---
status: current
last-reviewed: 2026-10-10
covers: src/color-layer.js
---

# Color layer: Z-order, no-pack fallback, and performance

This note captures what we tried while fixing **occlusion** (HUD / black bars over pack), **phantom grayscale** (uncolorized tiles when mono is hidden), and **stripey parallax** (clouds vs blimp). It also records why one approach was **reverted** and how we might proceed.

## Current behavior (after revert of pack-tile prepass)

`compositeColorFrame` in `src/color-layer.js`:

1. **Lightweight prepass** (per frame): for each draw, increment `drawCoverage[p]` for every pixel in the tile’s **axis-aligned 8×8 screen footprint** after the same **world clip** and **strip clip** used in the main pass. No `resolveOverrideRgba`, no tile hash, no pattern read in the prepass.
2. **Main pass**: paints pack/override pixels; for tiles **without** pack, solid 2bpp pixels (`mono != 0`) write an **opaque VIP luminance** (mono 1→0, 2→96, 3→192, scaled by brightness) **only if** `drawCoverage[p] >= 2`.
   The threshold is the `unpackedMinCoverage` option (default 2); the prepass is skipped outright
   when every draw on the eye has colour (`everyDrawHasColor`), since nothing then reads the count.
3. **Rationale for `>= 2`**: a single isolated no-pack tile stays **transparent** in the color buffer (mono hidden → no phantom gray). Two or more draws whose **bboxes** overlap that pixel allow the fallback so **later** draws can occlude **earlier** pack or no-pack (painter’s order matches draw list order).

**`occlude_black` mode**: still punches RGBA holes for palette 0 only (experimental).

**Who uses the fallback:** only the tools' previews. The emulator and the player pass
`renderUnpackedFallback: false`, so there unpainted pixels stay transparent and the monochrome frame
shows through; the coverage rule matters where there is no monochrome picture underneath.

---

## Problems observed in the wild

| Symptom | Likely cause in our model |
|--------|----------------------------|
| Side bars / HUD not covering pack | No-pack path skipped writes entirely; earlier pack “bled” through. |
| Phantom gray tower / starfield | `drawCoverage >= 2` with **only** no-pack layers (e.g. tower + sky bbox overlap): we still paint VIP gray everywhere those two stacks meet. |
| Stripey columns (blimp vs clouds) | **H-bias BG**: VIP uses **per-scanline** horizontal offset; draw list has **one `x` per tile**. Pixel inspector uses the same single-`x` model, so tooling and compositor agree but both can disagree with the core for some columns. |
| Correct vs wrong pixel nearby | Same H-bias / sampling: effective stack can change over 1px horizontally. |

---

## Approaches tried (chronological)

### A. Always paint no-pack solids (opaque VIP shade)

- **Pros**: Correct HUD occlusion over pack.
- **Cons**: Every uncolorized solid pixel became gray when mono was off (starfield, tower, etc.).

### B. `drawCoverage >= 2` only (geometric prepass, no tile reads)

- **Pros**: Fast; fixes lone uncolorized tiles; fixes pack + no-pack occlusion when bboxes overlap; deep stacks (many worlds) still get coverage ≥ 2.
- **Cons**: **Any** two no-pack layers with overlapping bboxes (tower + sky) get gray in the overlap region (“partial tower”). Stripes not addressed if root cause is H-bias.

### C. Refine B: `dstA > 0` OR `packTileCover` OR `drawCoverage >= 3`

Idea: skip phantom gray for shallow **all–no-pack** stacks unless a **packed** tile participates or the stack is “deep.”

- Implemented a **second prepass** that, for **every** draw, called `getTileBytes`, `hashTile`, **`resolveOverrideRgba`** (full override + group + WRAM path), and filled `packTileCover` per pixel.
- **No-pack eligibility** when `dst` still empty: required `drawCoverage >= 2` and (`packTileCover > 0` or `drawCoverage >= 3`); when `dst` already opaque, always allow occlusion.

**Outcome (reverted):**

- **Performance**: Roughly **doubled** per-frame work on the hot path (`resolveOverrideRgba` is not cheap; it ran once per draw in prepass **and** again in main). Input lag / dropped Start was reported.
- **Visuals**: More artifacting in practice (heuristic interacts badly with real draw distributions; harder to reason about than B).

---

## What we learned

1. **Occlusion** needs *some* write for no-pack solids when another layer already painted that pixel — either explicit `dst` opacity or a coverage rule.
2. **Phantom gray vs tower/sky** is a **semantic** problem: we cannot distinguish “tower + sky” from “two important parallax layers” using only **bbox overlap** and **pack map** without heavier signals.
3. **Heavy prepass that mirrors full resolve** is a non-starter for real-time feel on large draw lists; any future heuristic should stay **O(draws × 64)** with **minimal** work inside the inner loop, or move work **off the UI thread** / reduce composite frequency (not tackled here).
4. **Stripes** strongly suggest **geometry mismatch** (H-bias / single X) between hardware and our draw records; no amount of coverage counting fixes that without **richer data from the core** or accepting **mono underlay** / **debug BG X offset** for tuning.

---

## Recommended next steps (plan)

### Short term (keep shipped compositor fast)

1. **Stay on geometric `drawCoverage >= 2`** (current reverted state).
2. **Document UX tradeoffs**: when mono is off, overlapping **unpacked-only** layers can show VIP gray in overlap; enable mono underlay for gaps, or add tiles to the pack.
3. **Stripe investigation**: use existing **BG X offset (debug)** on a paused frame; note offset in pack authoring docs if a constant compensation works per-scene.
4. Optional: **`requestAnimationFrame` / throttle** color composite if draw list is huge (measure with perf overlay) — separate from Z logic, reduces CPU during gameplay.

### Medium term (correctness without double `resolveOverrideRgba`)

1. **Core export**: per-draw **effective X per scanline** (or segment list) for H-bias worlds — high effort, best fix for stripes.
2. **Lighter heuristic**: e.g. cache `hash` + `hasPackEntry` boolean **once per draw** in the **main** loop only; pass into inner loop; don’t re-call `resolveOverrideRgba` in a prepass. Eligibility could combine `drawCoverage` with “any draw in list had pack bitmap” **bitflags per screen row** — needs design to avoid false positives/negatives.

### Long term

1. **Optional Web Worker** for `compositeColorFrame` so UI inputs stay responsive (transfer or copy ImageData costs need measurement).
2. **Hybrid presentation**: color layer only where pack exists; mono fills elsewhere — policy decision, not implemented.

---

## File references

- Compositor: `src/color-layer.js` → `compositeColorFrame`
- Regression tests: `src/color-layer-composite.test.js`
- VIP draw-order background: `docs/reference/vip-rendering-validated.md`, `docs/planning/graphics-next-investigations.md` (H-bias caveat)

---

*Last updated: 2026-03-27 — documents revert of pack-tile prepass (`packTileCover` + `resolveOverrideRgba` in prepass).*
