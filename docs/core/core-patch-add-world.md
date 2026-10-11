---
status: current
last-reviewed: 2026-10-09
covers: patches/beetle-vb-vip_draw-add-world-param.patch, scripts/build-core-with-world.sh
---

# Core patch: add world (0..31) to draw list

> **Superseded.** The export patch (`beetle-vb-vip-draw-list-export.patch`) records the world for every
> draw, and this patch no longer applies. Rebuild the core with [core-build.md](core-build.md). Kept
> for history.

This doc describes how to add the **world** index to each draw in the Beetle VB core so the paint tool’s world filter and group-by-world work. It applies to a **patched** beetle-vb tree that already has:

- VIP state push to JS (`__VB_PUSH_VIP_STATE__`) at frame end
- A draw list built in `VIP_DrawBlock` / `DrawBG` / `DrawAffine` / `DrawOBJ` (e.g. `VB_DL_Push`, `VB_DrawCall`)

If your tree doesn’t have the draw list yet, do the Phase 2–4 patches from [core-patch-proposal.md](core-patch-proposal.md) first, then add world as below.

---

## 1. Add `world` to the draw-call struct and push

Wherever you define the draw-call struct (e.g. `VB_DrawCall` or the buffer you pass to JS):

- Add a field: **`uint8_t world`** (0..31).

Wherever you push a draw (e.g. `VB_DL_Push(...)`):

- Add a **world** argument and set `draw_call.world = world` (or equivalent).

---

## 2. Pass world through vip_draw.inc

The VIP draws in order: for each strip, **for world 31 down to 0**, then per-world `DrawBG` / `DrawAffine` / `DrawOBJ`. So the current world is the loop variable in `VIP_DrawBlock`.

### 2.1 DrawBG

- Add parameter **`uint8 world`** to `DrawBG` (e.g. after `bool lr`).
- Where you push a BG draw (tileIndex, x, y, flipH, flipV, layer, strip, eye), pass **`world`** as well.

### 2.2 DrawAffine

- Add parameter **`uint8 world`** to `DrawAffine` (e.g. after `bool lr`).
- Where you push an Affine draw, pass **`world`**.

### 2.3 DrawOBJ

- Add parameter **`uint8 world`** to `DrawOBJ` (e.g. add at end: `uint8 world`).
- Where you push an OBJ draw (once per eye), pass **`world`**.

### 2.4 VIP_DrawBlock

- When you call **DrawBG**, **DrawAffine**, or **DrawOBJ**, pass the current loop variable: **`(uint8)world`**.

Example (conceptual):

```c
for(world = 31; world >= 0; world--)
{
   // ... world config ...
   if(bgm == BGM_OBJ)
      DrawOBJ(fb, (block_no * 8) + y, lron, (uint8)world);
   else if(bgm == BGM_AFFINE)
      DrawAffine(..., lr, (uint8)world, ...);
   else
      DrawBG(..., lr, (uint8)world, ...);
}
```

Adjust to match your actual function signatures and call sites.

---

## 3. Expose world when sending state to JS

When you build the state object for `__VB_PUSH_VIP_STATE__` and encode the draw list (e.g. struct array or typed array):

- For each draw entry, include **`world`** (0..31). The app already expects optional `draw.world` and will show it in the paint tool (draw stack, status, world filter).

No change needed in the JS app: it already supports `world` in the draw list and in vbstate serialize/deserialize.

---

## 4. Apply the included vip_draw.inc patch (optional)

If your tree is **upstream** beetle-vb with no draw list yet, the file **`patches/beetle-vb-vip_draw-add-world-param.patch`** only adds the **world parameter** to `DrawBG`, `DrawAffine`, `DrawOBJ` and passes it from `VIP_DrawBlock`. It does **not** add the draw list or VIP push; it only wires the `world` argument through so that when you add your `VB_DL_Push` (or equivalent), you can pass `world` into it.

To apply (from the beetle-vb repo root):

```bash
git apply /path/to/sythnvtby/patches/beetle-vb-vip_draw-add-world-param.patch
```

If you already have a patched vip_draw.inc (with draw list), apply the same **logic** by hand: add `uint8 world` to the three draw functions and pass `(uint8)world` from `VIP_DrawBlock`, and add `world` to your push and to the state you send to JS.

---

## 5. Rebuild and replace core

1. Rebuild the core. From this repo you can run:  
   `BEETLE_VB_SRC=/path/to/beetle-vb-libretro ./scripts/build-core-with-world.sh`  
   Or in the beetle-vb tree: apply the patch (or runbook §2 edits), then `emmake make -f Makefile platform=emscripten`.
2. Run the EmulatorJS/RetroArch step to produce WASM (see [core-build-phase0-phase1-runbook.md](core-build-phase0-phase1-runbook.md)).
3. Copy the new core files into **`public/data/`** (overwrite the existing vb core).
4. Clear the emulator’s **Cache Manager** (or set `EJS_disableDatabases = true` in dev) and reload the app so the new core is used.
5. **Clear EmulatorJS cache** so the new core is loaded: in the emulator UI open **Cache Manager** (hover icons on the emulator frame) and clear cached cores. Reload the app / reload the ROM so the new core is fetched.
6. Capture a fresh VIP state (Save VIP state) or use Colorize! and open the paint tool; the draw list should now include `world`, and the **Show world(s)** filter (W0–W31) will show draws per world.
