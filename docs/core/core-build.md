---
status: current
last-reviewed: 2026-10-09
covers: scripts/build-core.sh, patches/beetle-vb-vip-draw-list-export.patch, patches/beetle-vb-vip-draw-list-edge-tiles.patch, patches/retroarch-emulatorjs-getstate-copy-before-free.patch, patches/retroarch-emulatorjs-wram-exports-and-heap-get-memory-data.patch, public/data/cores/beetle_vb-wasm.data
---

# Rebuilding the Beetle VB core

The app runs the patched core in `public/data/cores/beetle_vb-wasm.data` (with
`USE_LOCAL_CORE = true` in `src/main.js`). That file is tracked and enough to run the app.
Rebuild it only when the C in Beetle (`mednafen/vb/*`) or RetroArch's JS↔WASM glue changes.

**Verified Sep 28 2026** on Windows 11 + WSL Ubuntu 24.04:
- `scripts/build-core.sh` from fresh clones produces a core **bit-identical** to a hand build.
- The whole browser suite passes on it.
- A baseline build (no new patches) reproduces the core that shipped before.

## TL;DR

From a WSL (or Linux) shell:

```bash
cd /mnt/d/ColorVB/sythnvtby          # the repo, wherever it is
CORE_BUILD_DIR=~/vbcore bash scripts/build-core.sh
```

- **Time:** about 3 minutes. The first run also downloads emsdk (~1 GB) and clones Beetle and RetroArch.
- **Result:** the new core goes into `public/data/cores/`, and the previous one is kept as `core-build/beetle_vb-wasm.data.prev`.
- **Check:** reload the emulator page; the console variable `__VB_CORE_PATCH_LEVEL__` shows which patch level is running (3 today).

Setup notes:
- **Packages:** needs `git make gcc python3 p7zip-full` (`sudo apt install build-essential p7zip-full git python3`).
- **Location:** keep `CORE_BUILD_DIR` on the Linux disk (`~/…`), not `/mnt/…`. Compiling across the Windows mount is several times slower.
- **Existing emsdk:** set `EMSDK=/path/to/emsdk` to reuse an install you already have.

## What the script pins, and why

| Piece | Version | Why this one |
|-------|---------|--------------|
| Emscripten | **emsdk 3.1.74** | What EmulatorJS builds its cores with (`build_env.sh` in [EmulatorJS/build](https://github.com/EmulatorJS/build)). The old shipped wasm still carries `/emsdk/emscripten/…` paths, so it was built in the matching `emscripten/emsdk` Docker image. |
| RetroArch | **EmulatorJS/RetroArch `ed32657`** (v1.22.2) | The shipped core reports `RetroArch 1.22.2 (Git ed32657)` in the console. |
| Beetle VB | **EmulatorJS/beetle-vb-libretro `f94d3e8`** | The EmulatorJS fork's current head; our patches apply to it cleanly. |

Patches, applied in order:

| Patch | Tree | What it does |
|-------|------|--------------|
| `beetle-vb-vip-draw-list-export.patch` | Beetle | The VIP export hooks. Every frame, pushes the draw list, pattern table, OAM, world table, display RAM, palettes and brightness to `window.__VB_PUSH_VIP_STATE__`. Patch level 2. |
| `beetle-vb-vip-draw-list-edge-tiles.patch` | Beetle | Records every BG and sprite tile on its **first drawn** scanline and pixel, so tiles cut by the top or left edge are in the draw list at their true (possibly negative) position. Stamps `corePatchLevel: 3` on each pushed state. See below. |
| `retroarch-emulatorjs-wram-exports-and-heap-get-memory-data.patch` | RetroArch | Exports `_retro_get_memory_*` for live WRAM. |
| `retroarch-emulatorjs-getstate-copy-before-free.patch` | RetroArch | `EmulatorJSGetState` freed the heap before copying it, so `getState()` returned garbage and WRAM-from-savestate broke. The patch copies first. |

**Superseded:** `beetle-vb-vip_draw-add-world-param.patch`, and `scripts/build-core-with-world.sh`, which applies it. The export patch already records the world for BG, affine and sprite draws. That patch file is also malformed and no longer applies.

## Patch level 3: tiles cut by an edge

**The problem.** Before level 3, the draw-list hook recorded:
- a BG tile only on the scanline of its source row 0 (`char_sub_y == 0`), at the pixel of its source column 0;
- a sprite tile only on its top row (`tile_y == 0`).

A tile hanging off the top of the screen, or a BG tile off the left edge of its window, never reached that scanline or pixel. So it was never recorded, even though the frame showed its visible part. The result: colour disappeared up to a tile early as layers scrolled off the top (IntroCin's clouds).

**The fix.** Level 3 records a tile on its first drawn scanline and pixel, and gives the tile's true top-left as its position:

| Tiles | Scanline condition | Pixel condition |
|-------|--------------------|-----------------|
| BG | `(SourceY & 7) == 0 \|\| RealY == first drawn row` | `(SourceX & 7) == 0 \|\| x == start_x` |
| Sprite | `tile_y == 0 \|\| Y == 0` | — |

**Checked live** over 2½ minutes of Mario Clash's intro: the old rule would have dropped 7,765 tiles, and every one of them was in the level-3 draw list, with no duplicates. That includes sprite tiles above the top edge.

**Older frames.** Frames from older cores, including every capture already saved in a `.vbpack`, are still repaired in JavaScript by `src/vip-edge-tiles.js`. That covers BG tiles only, and it skips frames stamped `corePatchLevel >= 3`. See [vip-state.md](../reference/vip-state.md).

## Manual steps (what the script does)

1. **emsdk:** `git clone https://github.com/emscripten-core/emsdk && ./emsdk install 3.1.74 &&
   ./emsdk activate 3.1.74 && source ./emsdk_env.sh`.
2. **Normalise patches to LF.** On a Windows checkout the `.patch` files may come out with CRLF
   line endings, and `git apply` then reports "corrupt patch" or "does not apply".
   `.gitattributes` now pins `*.patch` to LF for new checkouts, and the script also converts them.
3. **Beetle:** check out `f94d3e8` and `git apply` the two Beetle patches. Then run
   `emmake make -f Makefile platform=emscripten -j$(nproc)` to produce
   `mednafen_vb_libretro_emscripten.bc`, and copy that into `RetroArch/emulatorjs/`.
4. **RetroArch:** check out `ed32657` and `git apply` the two RetroArch patches. Then, in
   `RetroArch/emulatorjs/`, run `emmake ./build-emulatorjs.sh --clean`. It links every
   `*_emscripten.bc` in that folder and 7-zips the wasm and js into
   `../../EmulatorJS/data/cores/beetle_vb-wasm.data`.
5. Copy that file to `public/data/cores/`.

## Checking a new core

1. Run `npm run dev`, load a ROM, and check the console: `__VB_CORE_PATCH_LEVEL__` should be 3.
2. Run `npm run test:e2e`. The browser suite drives the real emulator, capture, Colorize! and
   Save and Play on the new core.
3. If a page seems to be running an old core, clear the EmulatorJS cache from the player menu
   ([core-build-phase0-phase1-runbook.md](core-build-phase0-phase1-runbook.md) has notes on the cache).

## Related

- [core-patch-proposal.md](core-patch-proposal.md) — the original plan for exporting VIP state.
- [core-build-phase0-phase1-runbook.md](core-build-phase0-phase1-runbook.md) — the older, longer
  runbook (Linux toolchain, cache behaviour).
