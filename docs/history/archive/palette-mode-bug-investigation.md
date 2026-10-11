# Palette mode: bug investigation log

**Status: Archived.** The single-frame freeze bug was resolved (preserveDrawingBuffer fix). Full story is in [development-journey.md](../development-journey.md). Kept for development archive. See [README.md](../../README.md).

---

Summary of what we learned from the back-and-forth so we don’t repeat the same mistakes. See also [palette-rendering-plan.md](../../reference/palette-rendering-plan.md) for the pipeline and verification strategy.

---

## What fixed the single-frame problem

**We patched the WebGL context so it is created with `preserveDrawingBuffer: true`.**

1. **Problem:** The emulator uses a WebGL canvas. By default the browser can clear the WebGL drawing buffer after compositing. So `drawImage(webglCanvas)` and `readPixels()` often saw a cleared or cached buffer — one frame, then the same frame forever.

2. **Fix:** Before we inject the EmulatorJS loader, we patch `HTMLCanvasElement.prototype.getContext`. When the loader later calls `getContext('webgl')` or `getContext('webgl2')`, our wrapper adds `preserveDrawingBuffer: true` and calls the real getContext. The emulator's WebGL context is therefore created with the buffer preserved.

3. **Result:** With the buffer preserved, `readPixels()` (and drawImage) can read the current frame each time. We try readPixels first in `readOneFrame()`; when it returns non-zero we get fresh frames. We fall back to drawImage when readPixels returns zeros.

4. **Critical:** The patch only affects contexts created after it runs. We run it at the start of `startEmulator()` before appending the loader. The user must load a ROM (or reload and load) so the emulator is created with the patch.

**Code:** `src/main.js` — `patchGetContextForPreserveDrawingBuffer()` called at top of `startEmulator()`.

---

## Current (known) behaviour (after fix)

- Palette mode shows continuously updating frames; toggling Mono/Palette and presets works.
- Step 1b can pass when the patch is active.

- **Step 0, 1a, 3:** Pass (canvas found, one-frame capture non-zero, overlay rect OK).
- **Step 1b:** Fail (all 10 frames identical) — capture is cached.
- **In the app:** Switching to Palette grabs **one frame** and shows it with the chosen preset. That frame never updates. Toggling back to Monochrome and then to Palette again **does not** grab a new frame; the same first frame is still shown.

So: one static frame, correct colours, no updates and no refresh on toggle.

**Inconsistent which frame:** Sometimes the frame we show in Palette is the last frame that was visible in Monochrome when you switched; sometimes it seems to be an earlier cached frame. Depends on when the browser last composited the WebGL canvas. Not something we can control without fresh frames.

---

## Pipeline (reminder)

1. **Locate** emulator video canvas (getEmulatorCanvas).
2. **Capture** pixels (readOneFrame: 2D getImageData or WebGL drawImage→getImageData).
3. **Remap** 4 shades to preset (remapFrame).
4. **Composite** to overlay (aspect-fit rect, black letterbox).

The failing part is **Capture**: we only ever see one frame.

---

## What we tried and what happened

| Change | Goal | Result |
|--------|------|--------|
| **WebGL readPixels** | Fresh buffer each frame instead of compositor cache | Chrome: readPixels returned **all zeros** (wrong/cleared buffer). Firefox: sometimes one good frame then black. Caused black screen when we preferred readPixels. |
| **Fallback: if readPixels all zeros → drawImage** | Use drawImage when readPixels useless | Chrome: **worse** — still black. Likely readPixels left GL state bad so subsequent drawImage also returned zeros. |
| **Revert to drawImage-only for WebGL** | Restore visible frame | Back to one frame, no black. Step 1a pass, step1b fail. |
| **Double rAF (defer read to next frame)** | Read after emulator has drawn | **Immediately black** — we read in next frame after buffer was cleared. |
| **Separate canvases** (readback vs remap output) | Avoid overwriting readback with our remap | Did not fix “one frame”; ensured we don’t corrupt the readback. Kept. |
| **getBoundingClientRect for draw rect** | Match emulator position/size exactly | “Zoomed and offset” or wrong; reverted to **aspect-fit** only. |
| **Throttle to 30 fps + buffer reuse** | Reduce CPU/GC, fewer allocations | Kept. No evidence this broke capture; diagnostics still show step1b fail. |
| **willReadFrequently: true** on readback 2D context | Heed browser warning, optimize readback | Kept. No downside. |
| **redStats Math.min/max spread** | — | Caused **stack overflow** on large frames (640×320); fixed with loop. |
| **Fresh readback canvas every frame** | Cache might be keyed by destination; new canvas might force new composite | **No help.** Step 1a started failing (frame all zeros); reverted to reused readback. |

---

## Why we see one frame but not each frame

We **do** capture every time the loop runs. When you switch to Palette:

1. The loop starts and runs every ~33 ms (30 fps throttle).
2. Each tick we call **readOneFrame(canvas)** → **drawImage(emulatorCanvas)** onto our readback canvas → **getImageData**.
3. So we are asking the browser for the current frame many times per second.

The issue is **not** that we only read once. The issue is **what the browser gives back**:

- The **first** time we call drawImage(webglCanvas) after switching to Palette, the browser composites the WebGL canvas and gives us that frame. We remap it and show it. Correct.
- On every **subsequent** call, the browser does **not** necessarily re-composite the WebGL back buffer. For performance, it can return a **cached** snapshot of the last time that WebGL canvas was drawn to the screen (or to another canvas). So we keep getting the same pixels. The game and music keep running because the emulator is still drawing to the WebGL canvas; we just never see those new draws in our readback.

So: we **are** trying to capture each frame. The browser is giving us the same frame every time. That’s why the diagnostics step1b (10 reads at 100 ms) shows “all 10 frames identical.”

---

## Root cause (what we know)

- Emulator uses a **WebGL** canvas. We have no 2D context on it.
- **drawImage(webglCanvas)** to a 2D canvas then **getImageData**: the browser often returns a **cached** composited frame. So we get the same frame on every read (step1b: all 10 frames identical).
- **readPixels** on the same WebGL context: in Chrome we get **zeros**; in Firefox we saw one good frame then black (timing/buffer). Using readPixels can also leave the context in a bad state so that the next drawImage fails.
- We do **not** create the WebGL context, so we cannot set e.g. `preserveDrawingBuffer: true` to make readPixels reliable.

So: with the current EmulatorJS + WebGL setup we have no reliable way to get a **new** frame every time; we get one frame then the same frame forever, and toggling Palette off/on doesn’t force a new read of the live canvas.

---

## Why “toggle Mono → Palette” doesn’t refresh

When we leave Palette we call **stopPaletteLoop()** and hide the overlay. When we enter Palette again we **startPaletteLoop()** and the first tick does **readOneFrame(canvas)**. That still goes through **drawImage(canvas)**. The compositor may still be handing us the same cached snapshot, so we keep showing the same frame. So the “one frame” isn’t literally the first frame ever; it’s “whatever frame the cache is stuck on,” and toggling doesn’t invalidate that cache.

---

## Lessons for next time

1. **Don’t prefer readPixels over drawImage for this WebGL canvas** unless we have proof (e.g. diagnostics step1b pass) that readPixels gives distinct frames and doesn’t break drawImage in the same context.
2. **Run diagnostics (step1a + step1b)** after capture changes; step1b is the one that detects “only one frame.”
3. **Test in both Chrome and Firefox** when touching capture; behaviour differs (readPixels zeros in Chrome, etc.).
4. **Aspect-fit for overlay** is predictable; getBoundingClientRect was fragile (zoomed/offset).
5. **Avoid spreading huge arrays** (e.g. into Math.min/max); use a loop to avoid stack overflow.

---

## Options from here / what we're trying next

1. **preserveDrawingBuffer patch** – We patch getContext before loading the loader so the emulator's WebGL context gets preserveDrawingBuffer: true. Then we try readPixels first again; if zeros, fall back to drawImage. Load a ROM (or reload + load) so the emulator is created with the patch.
2. **Frame checksum diagnostic** – Run "Checksums 5s" in Palette debug or `runPaletteFrameChecksumTest()` in console. Logs checksums every 100ms for 5s; "X distinct" with X ≥ 2 means frame is changing, X = 1 means cached.
3. **If still stuck** – Accept one static frame or try a fork of EmulatorJS with preserveDrawingBuffer by default.

---

## File references

- Pipeline + verification plan: [palette-rendering-plan.md](../../reference/palette-rendering-plan.md)
- Rollback / disable Palette: [rollback-palette.md](../../reference/rollback-palette.md)
- Capture + remap: `src/palette-layer.js`
- Runtime diagnostics: `src/palette-diagnostics.js` (Run diagnostics, Checksums 5s, Log #game)
