---
status: current
last-reviewed: 2026-10-09
covers: patches/beetle-vb-vip-draw-list-export.patch
---

# Proposal: Patching the Beetle VB Core for VIP State Export

> **Done.** This was the original plan; every phase was built (`patches/`, patch level 3 today). How
> to rebuild the core now: [core-build.md](core-build.md). What the core sends:
> [vip-state.md](../reference/vip-state.md).

This document outlines a phased plan to build and patch the Virtual Boy core so our app can receive VIP state each frame and enable Color mode. Each phase has a clear validation step so we never move on until we know the previous step works.

---

## Goal

The core must call `window.__VB_PUSH_VIP_STATE__(state)` (or the equivalent from WASM) each frame after rendering, with:

- `patternTable` (Uint8Array, 32 KB)
- `oam` (Uint8Array, 8 KB)
- `segments`, `windows`, `eye`, `frameNumber`
- Optionally `drawList` (list of tile draws) so we don’t have to reimplement the full VIP

The app already exposes `window.__VB_PUSH_VIP_STATE__` and consumes state in `src/vip-state.js`. We only need to build a core that calls it.

Rendering order and memory layout have been validated against hardware docs and the Beetle VB source; see **[vip-rendering-validated.md](../reference/vip-rendering-validated.md)** for strip/world order, exact DRAM/CHR offsets, and where to hook for the draw list.

---

## Prerequisites (one-time)

- **Build environment**  
  - Debian: `sudo apt install -y binutils-mips-linux-gnu build-essential pkgconf python3 git p7zip-full`  
  - Emscripten: clone [emscripten-core/emsdk](https://github.com/emscripten-core/emsdk), install/activate latest, `source ./emsdk_env.sh` (or make it permanent per their instructions).

- **Sources**  
  - [libretro/beetle-vb-libretro](https://github.com/libretro/beetle-vb-libretro) — the core we will patch.  
  - [EmulatorJS/build](https://github.com/EmulatorJS/build) — optional script that builds many cores and packages them.  
  - [EmulatorJS/RetroArch](https://github.com/EmulatorJS/RetroArch) (branch `next`) — used to turn libretro .bc builds into WASM that EmulatorJS loads.

- **How the app loads the core**  
  - Our app sets `window.EJS_pathtodata = CDN` (e.g. `https://cdn.emulatorjs.org/stable/data/`) and injects `loader.js` from that path. The loader then loads the core (e.g. `vb_libretro.wasm` or similar) from the same base path.  
  - To use our own build: serve our built `data/` (with `loader.js` and our patched core) from the same origin as the app (e.g. `public/data/`) and set `EJS_pathtodata = '/data/'` so the app loads our core instead of the CDN.

---

## Phased plan

### Phase 0: Build the core (unmodified) and run it in our app

**Objective:** Prove we can build beetle-vb for the EmulatorJS/RetroArch pipeline and run it in our app.

**Steps:**

1. Clone beetle-vb-libretro and confirm it has a libretro build (e.g. `Makefile.libretro` or similar for emscripten).
2. Follow [EmulatorJS – Building RetroArch Cores](https://emulatorjs.org/docs4devs/buildingraw/):
   - Build the core with `emmake make -f Makefile.libretro platform=emscripten` (or the variant the repo uses).
   - Obtain the `.bc` (bitcode) output.
   - Clone EmulatorJS/RetroArch (branch `next`), copy the `.bc` into the place the build expects (e.g. `dist-scripts/`), run their build script (e.g. `emmake ./build-emulatorjs.sh` from `emulatorjs/`).
   - Collect the resulting WASM (and any JS/loader artifacts) that EmulatorJS expects for the `vb` core.
3. Serve that build from our app’s origin:
   - Copy the EmulatorJS `data/` output (or at least `loader.js` and the vb core files) into our project, e.g. `public/data/`.
   - In `src/main.js`, set `EJS_pathtodata = '/data/'` (or the path that serves that folder).
4. **Validation:** Load the app, load a ROM. The game should run exactly as with the CDN (monochrome, sound, controls). If it does, we have a working build pipeline and we can proceed to patch.

**Exit condition:** Game runs from our own built, unmodified core.

---

### Phase 1: Call JavaScript from the core once per frame (minimal hook)

**Objective:** Prove we can invoke a JS function from the core every frame without changing game behavior.

**Steps:**

1. In the core’s frame-render path, add a call into JavaScript. **Hook point (validated):** In `vip.c`, when `DrawingBlock == 28` and we set `DrawingActive = false` (frame complete); or at the libretro level when the frame is presented. See [Where to hook](#where-to-hook-in-the-core-validated) below.
2. Emscripten options:
   - **EM_ASM** / **EM_ASM_** — inline JS, e.g. `EM_ASM_({ console.log('frame'); });` or call a global.
   - **extern "C"** function implemented in JS via `mergeInto` / `addFunction` so the core calls a C function that is implemented by our JS.
3. Prefer calling a global that we control from the app, e.g. `window.__VB_FRAME__()` (no arguments). Our app can define `window.__VB_FRAME__ = () => { frameCount++; }` and show “VIP frames: N” in the UI or console.
4. **Validation:** Run the game, open devtools, and confirm the counter (or a log) updates every frame. No VIP state yet — just “core called JS every frame.”

**Exit condition:** We see proof (counter or log) that the core invokes our JS once per frame.

---

### Phase 2: Push a minimal VIP state (e.g. frame number only)

**Objective:** Prove we can call `window.__VB_PUSH_VIP_STATE__` from the core with a minimal object and that the app receives it.

**Steps:**

1. From the same hook as Phase 1, have the core call the existing `__VB_PUSH_VIP_STATE__` with a minimal state object, e.g. only `{ frameNumber: N, eye: 0 }` and dummy or empty buffers for `patternTable`, `oam`, etc. (the app’s consumer should tolerate missing or empty buffers).
2. Implement the call from C/WASM:
   - Either use EM_ASM_ to call `window.__VB_PUSH_VIP_STATE__({ frameNumber: ..., eye: 0 })` (may require passing integers and building the object in JS), or
   - Export a C API that our JS implements via Emscripten (e.g. `vb_push_vip_state(uint32_t frame_number, uint32_t eye)`), and in that JS implementation build the minimal state and call `window.__VB_PUSH_VIP_STATE__(state)`.
3. In the app, ensure the VIP state consumer (e.g. in `main.js` / color layer) does something visible when it receives state — e.g. update a “VIP frames: N” readout, or enable the “Save VIP state” button only when state has been received at least once.
4. **Validation:** Load a ROM, run the game. Confirm “VIP frames” (or equivalent) increases and/or “Save VIP state” becomes available. Optionally save a vbstate.json and confirm it contains the minimal fields.

**Exit condition:** App receives a minimal VIP state every frame from our patched core.

---

### Phase 3: Export real VIP data (pattern table, OAM, segments, windows)

**Objective:** Expose the actual VIP memory layout so the app can do extraction and, later, color rendering.

**Steps:**

1. **Known locations** (from [vip-rendering-validated.md](../reference/vip-rendering-validated.md)): In beetle-vb `mednafen/vb/vip.c` and `vip_draw.inc`:
   - **Pattern table:** `CHR_RAM`, 0x8000 bytes (32 KB), 2048 tiles × 16 bytes. Expose as `patternTable`.
   - **OAM:** In `DRAM` at **0x1E000**, 8 KB (1024 entries × 8 bytes). Expose as `oam`.
   - **Windows:** In `DRAM` at **0x1D800**, 32 × 32 bytes. Expose as `windows`.
   - **Segments:** Background maps live in DRAM; segment base and size come from world config (see validation doc). Expose the segment regions the app expects (e.g. active segments referenced by the 32 worlds).
2. In the same per-frame hook, copy those regions into buffers that the JS side can read. Emscripten allows passing pointers and lengths; the JS implementation of the push function can use `HEAPU8.subarray(ptr, ptr + len)` (or similar) to create Uint8Arrays and pass them in the state object.
3. Build the full `state` object in the C/JS glue: `patternTable`, `oam`, `segments`, `windows`, `eye`, `frameNumber`.
4. **Validation:**
   - Use “Save VIP state” in the app; open the downloaded vbstate.json in the tile extractor and confirm tiles/sprites look correct for the current frame.
   - Optionally load a .vbcolor pack and switch to Color mode; we should see color where the pack has data (if the color layer already uses pattern table + OAM; if it requires a draw list, Phase 4 may be needed for correct layering).

**Exit condition:** vbstate.json contains valid pattern table and OAM; tile extractor shows recognizable tiles; Color mode shows pack-based color where applicable.

---

### Phase 4 (optional): Export a draw list

**Objective:** So the app doesn’t have to reimplement the full VIP render order, the core supplies an ordered list of “draw tile *i* at (*x*, *y*) with flips” each frame. Same order is used for correct compositing and for “toggle through layers” in the paint-on-game editor (see [vip-rendering-validated.md](../reference/vip-rendering-validated.md)).

**Steps:**

1. **Where to record:** In `mednafen/vb/vip_draw.inc`, the VIP draws in this order: for each strip (0..27), for each world 31→0, then `DrawBG` / `DrawAffine` / `DrawOBJ`. Record each tile draw (tile index, x, y, flipH, flipV) in that same order — e.g. append from inside `DrawBG`, `DrawAffine`, and `DrawOBJ` when a tile is written to the strip buffer. Optionally tag each draw with **world index** so the app can show “layer” for the paint editor.
2. **When to emit:** When the frame is complete — in `vip.c`, when `DrawingBlock == 28` and we set `DrawingActive = false` (and fire `INT_XP_END`). That’s the place to pass the accumulated draw list to JS (for both eyes if stereo), then clear the list for the next frame.
3. Pass that list as `state.drawList` (array of `{ tileIndex, x, y, flipH?, flipV?, world? }`) in the same `__VB_PUSH_VIP_STATE__` call.
4. The app’s color layer already supports `drawList` in VIPState; it will use it for compositing when present.
5. **Validation:** Color mode with a pack should show correct layering and no missing/incorrect tiles compared to the core’s own framebuffer.

**Exit condition:** Color output matches expected layering using the core’s draw list.

---

## Where to hook in the core (validated)

See **[vip-rendering-validated.md](../reference/vip-rendering-validated.md)** for full detail. Summary:

- **Frame done:** In `mednafen/vb/vip.c`, when `DrawingCounter <= 0` and `DrawingBlock == 28` (after the last strip is drawn), we set `DrawingActive = false` and fire `INT_XP_END`. That’s the right place to invoke the JS callback (once per frame; for stereo, the same code path runs for both eyes — exact eye timing may need checking). Alternatively, hook at the libretro level when the core presents the frame (e.g. after the VB frame is committed).
- **VIP state (Phase 3):** All in `vip.c`: `CHR_RAM` (pattern table), `DRAM` (OAM at 0x1E000, windows at 0x1D800, segment data elsewhere). Pass pointers/lengths to JS when the frame is done.
- **Draw list (Phase 4):** In `vip_draw.inc`, inside `VIP_DrawBlock` → `DrawBG` / `DrawAffine` / `DrawOBJ`. Append each tile draw in the order it’s drawn (strip 0..27, world 31→0). Emit the list when the frame is done (same hook as above).

---

## Hosting our built core

- **Development:** Serve `public/data/` with our built `loader.js` and vb core (e.g. `vb_libretro.wasm` + any companion JS). Set `EJS_pathtodata = '/data/'` in `main.js` (or use an env/config so we can switch CDN vs local).
- **Production:** Either host the same `data/` on the same origin as the app, or use a separate URL and set `EJS_pathtodata` to that URL (same-origin or CORS as required by EmulatorJS).

---

## Validation checklist (summary)

| Phase | What we do | How we validate |
|-------|------------|------------------|
| 0 | Build unmodified core; serve from app origin | Game runs (mono, sound, controls) with our build |
| 1 | Core calls a JS function every frame | Counter or log in app updates every frame |
| 2 | Core calls `__VB_PUSH_VIP_STATE__` with minimal state | App shows “VIP frames” or enables Save VIP state |
| 3 | Core exports real pattern table, OAM, segments, windows | vbstate.json loads in tile extractor; Color mode shows pack color |
| 4 | Core exports draw list | Color layering matches core output |

---

## Runbook (Phase 0 + Phase 1)

For copy-paste build steps, exact hook location, and the Phase 1 C patch, see **[core-build-phase0-phase1-runbook.md](core-build-phase0-phase1-runbook.md)**.

---

## References

- [EmulatorJS – Building RetroArch Cores](https://emulatorjs.org/docs4devs/buildingraw/)
- [EmulatorJS/build](https://github.com/EmulatorJS/build) (optional automated build)
- [libretro/beetle-vb-libretro](https://github.com/libretro/beetle-vb-libretro)
- Our [vip-state.md](../reference/vip-state.md), [vip-dump-format.md](../reference/vip-dump-format.md), [art-pipeline.md](../reference/art-pipeline.md), **[vip-rendering-validated.md](../reference/vip-rendering-validated.md)** (hook locations, memory layout, draw order)
- Our `src/vip-state.js` (consumer and `pushVIPState` contract)
