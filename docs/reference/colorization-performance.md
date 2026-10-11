---
status: current
last-reviewed: 2026-10-10
covers: scripts/bench/harness.mjs, scripts/bench/render-strategies.mjs, scripts/bench/overdraw.mjs, scripts/bench/frame-worlds.mjs, src/color-layer.js, src/painter-v2-vip-overlay.js, src/group-tile-colors.js
---

# Colorization performance

What it costs to composite one colourized frame, how to measure it, and what was already
tried. Written after the intro cinematic of Mario Clash — the worst screen in the game for
this — was thought to be too layered to colourize at frame rate. It wasn't.

**If a screen feels slow, measure before redesigning.** The benchmarks below exist because a
plausible-sounding theory (too many overlapping layers) was wrong, and acting on it had
already cost one architecture rewrite.

## Running the benchmarks

```bash
npm run bench              # what each colorization strategy costs
npm run bench:overdraw     # overdraw, occlusion culling, the coverage prepass
npm run bench:worlds       # how a frame splits across worlds, and what can take an anchor
```

They need a `.vbpack` with captured frames, outside the repo. `VB_PACK_ANNOTATED` points at
it (same convention as the e2e harness); it defaults to `../marioclash-annotated.vbpack`.
`BENCH_FRAME` picks the frame by state name and defaults to `IntroCin`:

```bash
VB_PACK_ANNOTATED=/path/to/pack.vbpack BENCH_FRAME=Title npm run bench
```

The numbers below are one machine's, so treat them as ratios rather than absolutes, and
re-run before and after a change rather than comparing to this page.

## The reference frame

`IntroCin` frame 6 — 4,794 draws on one eye, 122 distinct patterns, 17 world/layer
combinations. The Virtual Boy runs at 50 Hz, so the budget is **20 ms per frame per eye**.

## What each strategy costs

Measured Sep 2026, after the optimisations described below.

| Strategy | Before | After |
| --- | --- | --- |
| Per-pattern paint only, no groups | 5.29 ms | 3.60 ms |
| 12 world+layer scoped groups, no colour of their own | 4.55 ms | 3.13 ms |
| 157 group-scoped position overrides | 12.24 ms | 4.17 ms |
| 12 anchored VIP overlays, full-frame paint | 8.58 ms | 7.84 ms |
| 12 anchored VIP overlays, only their own tiles | — | 4.00 ms |
| **157 group-scoped tile colours across 12 groups** | — | **3.64 ms** |

Three things to take from this:

- **World/layer criteria matching is nearly free.** It is a couple of integer set lookups per
  draw. Scoping groups to a world does not cost frame rate.
- **Group-scoped tile colour is the cheapest way to colour a layered screen**, and it is the
  only one that can give the same pattern a different colour per layer. See
  [group-tile-colors.js](../../src/group-tile-colors.js).
- **Anchored overlays are the most expensive.** Each group costs a presence scan over the draw
  list plus a blend pass, and that cost scales per group whatever the criteria say. (Overlays and
  touch-ups are older paint kinds, converted to **overpaint** on open since Oct 2026; overpaint is
  not in this table — measure it with the same harness if a screen with many pictures feels slow.)

## What was slow, and why it was not the data model

The original 12.24 ms for the override path was implementation, not design:

- `resolveOverrideRgba` rebuilt a group lookup `Map` **for every draw** — 4,794 times a frame.
- `drawMatchesGroup` ran `Array.includes()` scans and allocated arrays per draw. A world-sized
  group holds hundreds of hashes, so this is what made whole-layer groups feel unusable.
- `anchorDrawPresentForGroupEye` (since removed) re-hashed the **entire draw list once per group** (~57k tile
  hashes a frame for 12 groups), then blended all 86k pixels of an overlay that was mostly
  transparent.
- The world-clip cache built a `` `${world},${eye}` `` **string key per draw, in both passes** —
  about 9,600 string allocations a frame. Eye is fixed for the call, so a 32-slot array
  indexed by world does the same job: 0.41 ms → 0.06 ms.
- The coverage prepass walked all 64 cells of every draw (306,816 cells) to count overlap, but
  only the unpainted-tile fallback ever reads that count. Skipping it when no draw can reach
  that path saves 0.60 ms and costs 0.09 ms to decide.

Fixes: build the group index and normalised criteria sets once per frame, hash draws once per
blend, blend only an overlay's painted bounding box, index the world clip by world, and make
the prepass conditional.

## Occlusion culling: measured and rejected

The intro cinematic really is heavily overlapped:

```
lit pixel writes:        198,584
distinct pixels touched:  69,312  (80.6% of screen)
overdraw factor:           2.87x  ·  deepest stack: 11 draws
a perfect cull would skip 129,272 writes (65.1%)
```

Two thirds of the pixel work is thrown away. But culling it does not pay:

```
front-to-back cull + write                     ~1.0 ms
back-to-front write (what the compositor does) ~1.1 ms
```

The two are within run-to-run noise of each other — which run looks faster changes between
invocations. The write being skipped is three stores into a typed array, about as cheap as
the mask test that would skip it. Culling pays when the skipped work is expensive (a texture
fetch, a shader); here it isn't. It would also force the draw order to invert, complicating
the `occlude_black` erase path, for no measurable gain.

**Do not add occlusion culling to the colour layer without re-running `npm run bench:overdraw`
and showing a real gap.**

## Choosing a strategy for a screen

Run `npm run bench:worlds` first. It reports, per world and layer, how many patterns it draws,
how many are unique to it, and how many are drawn **exactly once** — the requirement for an
anchored overlay (`useVipOverlayForZoomPaint` → `countSameHashWorldLayerEye === 1`).

On `IntroCin` frame 6 that comes out as:

```
w18/l0   96 tiles · 29 patterns · 29 only here · 11 anchor candidates
w26/l0  376 tiles ·  5 patterns ·  4 only here ·  0 anchor candidates
w6/l0   192 tiles · 13 patterns · 12 only here ·  0 anchor candidates
...
patterns drawn in more than one world/layer: 43
  #360779f5 (SOLID shade 3) in 12 worlds
```

So the fill layers have **no legal anchor at all** — they are pure repeats — and one solid
"black-out" pattern is shared by twelve worlds. That combination is what forced group-scoped
colour: per-pattern paint cannot vary it, and anchors cannot be placed.

Rules of thumb:

- **A pattern unique to one world** — plain per-pattern paint is already correct.
- **A pattern shared across worlds that needs different colours** — a group per world with its
  own `tileColors`.
- **Different colours for the same pattern within one group** — **overpaint**: a picture pinned
  to the layer's map, so it scrolls and zooms with the layer ([overpaint.md](overpaint.md)). (The
  older anchored overlay sat in fixed screen space, which was wrong for a parallax layer.)

## Related

- [priorities-and-next.md](../planning/priorities-and-next.md) — the backlog entry this work came from
- [color-layer-z-order-and-performance.md](color-layer-z-order-and-performance.md) — draw order and the no-pack fallback
- [art-pack-file-format.md](art-pack-file-format.md) — where `tileColors` lives in `groups.json`
