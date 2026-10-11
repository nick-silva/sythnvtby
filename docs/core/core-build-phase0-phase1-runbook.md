---
status: current
last-reviewed: 2026-10-09
covers: patches/beetle-vb-vip-draw-list-export.patch
---

# Core build runbook: Phase 0 and Phase 1

> **Historical.** The steps used to bring the core up the first time. For a rebuild today use
> [core-build.md](core-build.md) and `scripts/build-core.sh`, which reproduce the shipped core
> bit for bit.

Concrete steps to build the Beetle VB core (unmodified then with the Phase 1 JS hook) and run it in our app. Use this together with [core-patch-proposal.md](core-patch-proposal.md).

---

## Prerequisites

- **OS:** Debian or Fedora (EmulatorJS docs say Ubuntu can be iffy).
- **Packages (Debian):**  
  `sudo apt install -y binutils-mips-linux-gnu build-essential pkgconf python3 git p7zip-full`
- **Emscripten:**  
  ```bash
  cd ~ && git clone https://github.com/emscripten-core/emsdk.git .emsdk && cd .emsdk
  ./emsdk install latest && ./emsdk activate latest
  source ./emsdk_env.sh
  ```  
  (Add `source ~/.emsdk_env.sh` to your shell profile to make it permanent.)
- **Our app:** This repo, with `npm install` and a way to serve it (e.g. `npm run dev` or `npm run build` + static server).

---

## Phase 0: Build unmodified core and run in app

### 1. Build the core to bitcode (.bc)

```bash
cd /tmp   # or your workspace
git clone https://github.com/libretro/beetle-vb-libretro.git beetle-vb-build
cd beetle-vb-build
source ~/.emsdk/emsdk_env.sh   # or wherever your emsdk is
emmake make -f Makefile platform=emscripten
```

- **Output:** `mednafen_vb_libretro_emscripten.bc` (in the repo root).
- If the build fails, fix toolchain/deps first; no code changes yet.

### 2. Turn .bc into WASM via EmulatorJS/RetroArch

EmulatorJS expects cores to be built as part of (or dropped into) their RetroArch-for-emscripten tree, which then produces the WASM + JS the loader uses.

- Clone their RetroArch (next branch) and follow their build docs:  
  [Building RetroArch Cores](https://emulatorjs.org/docs4devs/buildingraw/)  
  In short: put the `.bc` where their build expects it (often something like `dist-scripts/` or a cores directory — **check their repo and script**), then from their `emulatorjs/` (or equivalent) run something like:  
  `emmake ./build-emulatorjs.sh`
- Alternatively use the [EmulatorJS/build](https://github.com/EmulatorJS/build) script if it supports or can be adapted for the vb core.
- **Output:** WASM and companion JS for the vb core, plus the generic `loader.js` and data layout under something like `EmulatorJS/data/` or `data/cores/`.

### 3. Serve the built core from our app

- Copy the EmulatorJS `data/` output (at least `loader.js` and the vb core files) into this repo, e.g. `public/data/`.
- In `src/main.js`, set the data path to use the local build instead of the CDN, e.g.:  
  `window.EJS_pathtodata = '/data/';`  
  (Use a config or env switch if you want to keep CDN as default.)
- Serve the app (e.g. `npm run dev`) and open it in the browser. Load a ROM.

**Phase 0 validation:** Game runs (mono, sound, controls) the same as with the CDN. If yes, the build pipeline is good; proceed to Phase 1.

---

## Important: EmulatorJS core caching (Cache Manager)

EmulatorJS caches downloaded + decompressed cores in persistent browser storage (IndexedDB). That means:

- If you **replace** `public/data/cores/beetle_vb-wasm.data` on disk with a freshly built core, the browser may still keep using the **old cached** core.
- Symptoms: the app seems “stuck” on an older patch level even after rebuilding (e.g. Phase 1 frame hook works, but Phase 2 markers never appear).

### What you did (“Cache Manager” → Clear All)

Inside the emulator UI there is a **Cache Manager** item (visible via the hover icons on the emulator frame). Clearing it deletes EmulatorJS’s stored core cache entries (you’ll see items like `beetle_vb-wasm...`).

After clearing, the next ROM load forces EmulatorJS to:

- re-download `cores/beetle_vb-wasm.data` from our `/data/` path, and
- re-decompress it into the runtime it executes.

That’s why the “Core patch” marker suddenly updated.

### Recommended dev fix (no manual clearing)

For local core development we disable EmulatorJS databases/cache before loading the emulator:

- `window.EJS_disableDatabases = true`

This avoids the “stale core” problem while iterating on patches.

---

## Phase 1: Call JavaScript from the core once per frame

Goal: add a minimal hook so the core calls a JS function every time a frame finishes. No VIP state yet.

### 1. Hook location (validated)

In **beetle-vb-libretro**: `mednafen/vb/vip.c`, in the block where we detect “frame complete” (after the last strip):

- When `DrawingBlock == 28` we set `DrawingActive = false` and fire `INT_XP_END`. That’s the right place.
- **Approximate location (vip.c):** after `DrawingActive = false;` and before or after `InterruptPending |= INT_XP_END;` / `CheckIRQ();` (around lines 1342–1346 in a typical copy).

### 2. C patch: call `window.__VB_FRAME__` from the core

We need the core to call into JS only when built for Emscripten. Use Emscripten’s `EM_ASM_` so the C side doesn’t need to know the JS signature.

**At the top of `mednafen/vb/vip.c`** (with the other `#include`s), add:

```c
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif
```

**At the frame-done spot** (right after `DrawingActive = false;`), add:

```c
            if(DrawingBlock == 28)
            {
               DrawingActive = false;

#ifdef __EMSCRIPTEN__
               EM_ASM_( if (typeof window.__VB_FRAME__ === 'function') window.__VB_FRAME__(); );
#endif

               InterruptPending |= INT_XP_END;
               CheckIRQ();
            }
```

- If your Emscripten SDK uses a different pattern (e.g. no `emscripten.h` or different macro), use the same idea: only in `#ifdef __EMSCRIPTEN__`, invoke a JS global (e.g. `window.__VB_FRAME__`) when it exists.
- Rebuild the core with `emmake make -f Makefile platform=emscripten`, then repeat the EmulatorJS/RetroArch step to regenerate WASM, and copy the new build into `public/data/`.

### 3. App side: define the callback and validate

- Before the EmulatorJS loader runs (e.g. in `src/main.js` where you set up the emulator), set:  
  `window.__VB_FRAME__ = function () { window.__vbFrameCount = (window.__vbFrameCount || 0) + 1; };`
- Optional: show `window.__vbFrameCount` in the UI or log it periodically so you can see it increase.
- Reload the app, load a ROM, run the game.

**Phase 1 validation:** The counter (or log) increases every frame. That proves the core is calling JS once per frame; no VIP state is required yet.

---

## Summary

| Step | Action |
|------|--------|
| Phase 0 | Build beetle-vb with `emmake make platform=emscripten` → get `.bc` → build with EmulatorJS/RetroArch → WASM + loader → put in `public/data/` → point app at `/data/` → run game. |
| Phase 1 | Add `#include <emscripten.h>` and `EM_ASM_( ... __VB_FRAME__ ... )` at frame-done in `vip.c` → rebuild → replace files in `public/data/` → set `window.__VB_FRAME__` in app → confirm counter increments every frame. |

After Phase 1 we have a working pipeline and proof that the core can call our JS every frame; Phase 2 (minimal VIP state) can use the same hook.

---

## Debugging: local core vs CDN

### 1. Confirm the app works with the CDN (original core)

In `src/main.js`, set **`USE_LOCAL_CORE = false`** (this is the default). Run `npm run dev`, open the app, load a ROM, then switch to Palette. If the game runs and Palette works, the app and CDN core are fine. **Reverting to CDN is how you use the original core** — no other config needed.

### 2. If ROM does nothing or Palette says "iframe not there"

- The emulator runs inside **`#game`** (and often in an iframe created by the loader). If the core never loads, `#game` stays empty or shows a loading/error state, so Palette can’t find the video canvas and may report that the iframe or canvas is missing.
- **With CDN:** If ROM still does nothing with `USE_LOCAL_CORE = false`, check the browser console for errors (e.g. CORS, script load failure). Ensure you’re using a real dev server (e.g. `npm run dev`), not opening the HTML via `file://`.
- **With local core (`USE_LOCAL_CORE = true`):**
  1. Open DevTools → **Network**. Load a ROM and watch for:
     - `GET /data/loader.js` → should be **200**.
     - `GET /data/cores/beetle_vb-wasm.data` → should be **200**. If 404, the app isn’t serving `public/data/` at `/data/` (check Vite/public setup).
     - Any failed (red) request to `/data/...` or the loader’s own requests (e.g. EmulatorJS's own `emulator.js`, `consts.js`).
  2. Open **Console**. Note any errors after you pick a ROM (e.g. “Failed to fetch core”, decompression errors, WASM init errors).
  3. In Console you can run: `document.querySelector('#game')` — if the emulator loaded, you should see a node with an iframe or canvas inside. If it’s empty or missing, the core/loader failed before drawing.

### 3. Step-by-step: collect debug info for local core

Do this with **`USE_LOCAL_CORE = true`**, dev server running, and a ROM ready. Work through in order and note what you see.

**Step 1 — Open DevTools before loading a ROM**

- Open the app in the browser (e.g. `http://localhost:5173`).
- Open DevTools: **F12** or right‑click → Inspect.
- Go to the **Network** tab. Leave it open for the next steps.

**Step 2 — Clear and load ROM**

- In Network, click the **Clear** (🚫) button so the list is empty.
- Optionally enable **“Preserve log”** so requests aren’t cleared on navigation.
- In the app, click **Load ROM** and select your `.vb` (or `.bin`) file.

**Step 3 — Check Network for `/data/` requests**

In the Network list, find these (use the filter box and type `data` or `loader` if needed):

| Request | What to note |
|--------|----------------|
| `loader.js` (path should be `/data/loader.js` or similar) | Status code: **200** = OK, **404** = not found. |
| `beetle_vb-wasm.data` (path `/data/cores/beetle_vb-wasm.data`) | Status: **200** = OK, **404** = not found. Size: ~850 KB or so. |
| Any request under `/data/` that is **red** (failed) | Status code and URL. |

Write down: **loader.js** = (200 / 404 / other), **beetle_vb-wasm.data** = (200 / 404 / other). If any are 404, the server isn’t serving `public/data/` at `/data/`.

**Step 4 — Check Console for errors**

- Switch to the **Console** tab.
- Look for **red** error messages that appeared when you loaded the ROM. Copy or screenshot the full text (expand if needed).
- Typical useful lines: “Failed to fetch…”, “404”, “WASM”, “7z”, “decompress”, “instantiate”, “EJS”, “core”.

Write down or copy: **All red errors after loading the ROM** (exact text helps).

**Step 5 — Inspect `#game` in the DOM**

- In the Console, run:  
  `document.querySelector('#game')`
- Then:  
  `document.querySelector('#game')?.innerHTML?.length`
- And:  
  `document.querySelector('#game iframe')`

Note:
- Is `#game` **null** or an element?
- If an element, does it have **innerHTML** (e.g. length > 0)?
- Is there an **iframe** inside `#game`?

If `#game` is empty (no iframe, no canvas), the loader/core didn’t create the emulator container — often because the core failed to load or start.

**Step 6 — Optional: list all failed requests**

- Back in **Network**, use the filter or sort to show only failed requests (status 4xx/5xx or red).
- Note the **URL** and **status code** of each.

**What to report**

When asking for help or re-running the runbook, provide:

1. **Network:** loader.js → (status), beetle_vb-wasm.data → (status), any other failed `/data/` URLs.
2. **Console:** Full text of any red errors after loading the ROM.
3. **#game:** Result of the three Console commands (null? innerHTML length? iframe present?).

That’s enough to see whether the problem is (A) missing files / wrong path, (B) core load/decompress/WASM failure, or (C) container never created.

### 4. Common causes when using the local core

- **404 on `/data/...`** — The dev server must serve `public/` at the site root so `/data/loader.js` and `/data/cores/beetle_vb-wasm.data` resolve. With Vite, files in `public/` are served at `/`; confirm `public/data/` exists and contains `loader.js` and `cores/beetle_vb-wasm.data`.
- **Core loads but emulator doesn’t start** — Check Console for errors from the EmulatorJS runtime (e.g. 7z decompression, WASM instantiation). The `.data` file is a 7z archive; the loader unpacks it in the browser. If the archive is corrupt or the wrong file, you’ll see runtime errors.
- **Palette “cannot read video” / “iframe”** — Same as above: the emulator never created the canvas (often because the core didn’t load or start), so there’s no canvas for Palette to read. Fix core loading first.
