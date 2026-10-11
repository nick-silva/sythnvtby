---
status: current
last-reviewed: 2026-10-10
covers: src/color-layer.js, src/vip-world-clip.js
---

# VIP / color layer: parallax & occlusion learnings (consolidated)

This note **preserves working understanding** from debugging **scrolling BG**, **H-bias / vertical effects**, **world vs draw order**, **pixel inspector**, and **performance**. It complements [color-layer-z-order-and-performance.md](./color-layer-z-order-and-performance.md) and [graphics-next-investigations.md](../planning/graphics-next-investigations.md).

---

## 1. Hardware vs our pipeline (one paragraph)

The **VIP** builds the image **in raster order** with **per-scanline** effects (e.g. **H-bias**: horizontal offset can vary with **scanline Y**). **BG “animation”** is mostly **scroll/bias** over tile maps, not reauthoring the pattern table every frame. Our **patched core** exports a flat **`drawList`**: ordered **8×8 draws** with **one `(x, y)` per draw** (see `vip-state.js`, `graphics-next-investigations.md`). **`compositeColorFrame`** walks that list in order and paints each full **8×8** at that anchor — **painter’s algorithm**. It does **not** re-simulate VIP raster math for normal and H-bias worlds. (**Affine** worlds are the exception since Oct 2026: they are sampled pixel by pixel from display RAM the way the VIP does, `src/affine-world.js`. Tiles cut by a window edge are recorded by core patch level 3, or rebuilt for older captures by `src/vip-edge-tiles.js`; see [vip-state.md](vip-state.md).)

**Consequence:** Where hardware uses **different effective X or Y per scanline** (H-bias, and analogous **vertical** / **strip** behavior), a **single `(x, y)` per tile** cannot match mono **pixel-for-pixel**. Symptoms: **stripes**, **wrong occlusion** vs clouds, **top vs bottom** of a sprite splitting, **~8 px** alignment beats (VIP **strips** are **8 scanlines** tall).

---

## 2. `world_id` vs who wins on screen

- **`world` (0…31)** in draw calls is **metadata** (clips, overrides, paint-tool criteria). Comment in code: draw order conceptually **world 31 → back** through **world 0 → front** (lower number = more in front in that convention).
- **`compositeColorFrame`** (default **`sortDrawsByWorld: true`**) **reorders** draws per eye with **`compareDrawCallOrderByWorld`** so **higher `world` is painted first** (back) and **lower last** (front), with **strip / layer / original-index** tie-breakers. If **`sortDrawsByWorld`** is off, or for pairs where **`world`** is missing, **core `drawList` array order** applies: **later** in the list wins at each pixel.
- For **clouds in front of blimp**, either the **sorted order** must put cloud draws **after** blimp at overlapping pixels, or the **core list** must when sorting is disabled. **H-bias / per-scanline placement** errors still break **mono** parity even when **`world`** sorting is correct.

---

## 3. Observed symptom patterns (Mario Clash–style blimp + clouds)

- **No fully “good” frame** with current model: correctness can fail for **one vertical half** of the object while the other half **accidentally** aligns — **not** random noise.
- **Top portion** vs **bottom portion**: one region matches **mono** occlusion; the other shows **banding** (blimp **in front of** clouds that should win). **Alternates** with **scroll phase** / **frame** → consistent with **strip** / **tile grid** / **per-line placement** error, not a single global Z bug.
- **~8 px alignment** where the **whole** blimp briefly respects or violates layer order → **strip (8-row) and 8×8 grid** interaction.
- **Same tile hash** (`tileIndex` / pattern) can appear **multiple times** in the stack (different **worlds**, parallax). **Pack/override** resolution is separate from **order**.
- **`src=override`** in pixel inspector: color need not come from a direct **`.vbcolor` map key** for that hash; overrides / `alternateHash` still show `pack=N` with color.

---

## 4. Pixel inspector & coordinates

- Inspector uses **`lastVIPState`** + **`drawList`** + **pattern table**; it is **pixel-level** for **which draws hit** `(x,y)` and **`mono`** sample per draw.
- **VIP space** is **384×224** per eye. Emulator **canvas buffer** may be **scaled** (e.g. 960×720) or **side-by-side**; clicks must map to VIP coords (`mapCanvasBufferToVipPixel` in `main.js`). Raw buffer coords **without** scaling → **“No hits”**.
- **Mono + inspector:** attach clicks to the **real emulator canvas** via `getEmulatorCanvas()` (iframe/shadow), not only `#game querySelector('canvas')`.
- **Color debug panel** can stay visible with **draw list** present even when **Color mode** is off, so inspector works on **mono** framebuffer clicks.

**Useful console helpers:** `reportPixelStack(x,y,{eye})`, `vbGetDrawListSnapshot()`, `vbSerializeLastVIPState()`.

---

## 5. Debugging protocol (when comparing “looks right” vs “looks wrong”)

There may be **no** frame that is globally perfect; compare **nearby pixels on the same paused frame**:

1. **Pixel A** — overlap looks **correct** vs mono. **Pixel B** — **same `x`**, **`y` differs by 1–8**, wrong occlusion.
2. Record **`frameNumber`** (`lastVIPState.frameNumber`) so A/B are same frame.
3. Compare **stack order** (later index = on top): if order is **identical** at A and B but only one looks wrong in color → **placement / alpha / coverage**, not sort. If **order differs** → **list emission / strip** worth investigating in core.

---

## 6. Performance

- **`drawList` length** can be **very large** (e.g. thousands of draws). **`compositeColorFrame`** is **O(draws × 64)** per eye, **main thread**, typically **once per VIP push** — this **steals time** from the browser and can **lower effective FPS**; the **C core** does not formally “wait” for JS, but the **event loop** does all compositing work before the next paint.
- **Mitigations** (future): throttle compositing, Web Worker, reduce work — **orthogonal** to correctness.

---

## 7. Directions that actually fix parallax correctness

1. **Core export richer geometry**: e.g. **per-scanline X** for H-bias BG, and whatever the VIP does for **vertical** / **strip-local** placement — or **emit draws** so each **8×8** anchor is valid for the raster (see investigations doc).
2. **App-only**: **mono underlay** where color is untrusted; **BG X/Y debug offsets** only help if error is a **constant** delta (often it is **not** for bias).
3. **Do not expect** `world_id` alone to fix compositing — **order + geometry** must match hardware.

---

## 8. File references

| Area | File |
|------|------|
| Compositor | `src/color-layer.js` — `compositeColorFrame`, `resolveOverrideRgba` |
| VIP types | `src/vip-state.js` — `DrawCall`, `world`, `strip` |
| Pixel inspector / VIP mapping | `src/main.js` — `reportPixelStack`, `mapCanvasBufferToVipPixel`, `syncEmulatorInspectorClickAttachment` |
| H-bias / draw list model | `docs/planning/graphics-next-investigations.md` |
| Z-order, coverage, stripes | `docs/reference/color-layer-z-order-and-performance.md` |
| Paint tool vs bias | `docs/history/archive/paint-tool-vip-positions.md` |

---

*Last updated from project discussion — captures narrative learnings so they are not lost when context resets.*
