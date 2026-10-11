---
status: current
last-reviewed: 2026-10-09
covers: src/palette-layer.js, src/palette-diagnostics.js
---

# Palette rendering: plan and verification

**Status:** built — the pipeline, unit tests and diagnostics below all exist. This document defines the palette rendering pipeline, constraints, and how we verify each step so we can fix issues without going in circles.

---

## 1. Pipeline overview

```
[Emulator WebGL/2D canvas]  →  (1) Read pixels  →  (2) Remap 4 shades  →  (3) Draw to overlay
         ↑                              ↑                    ↑                      ↑
    Step 0: Locate                 Step 1: Capture     Step 2: Remap          Step 3: Composite
```

- **Step 0 – Locate:** Find the emulator’s video canvas in the DOM (may be in #game, shadow root, or iframe). Must exclude our own overlay canvases.
- **Step 1 – Capture:** Get pixel data from that canvas once per frame. For WebGL we have no 2D context; we must use either `drawImage(canvas)` to a 2D canvas + `getImageData`, or WebGL `readPixels`. Browsers may cache or clear buffers, so this step is the main source of “single frame then stuck” behaviour.
- **Step 2 – Remap:** Map each pixel’s red channel (VB intensity) to one of 4 buckets and replace with the preset RGB. Pure function: `(ImageData, colors) → ImageData`.
- **Step 3 – Composite:** Draw the remapped ImageData onto our overlay canvas, sized and positioned so it lines up with the game (aspect-fit in the container). Overlay is `position:absolute; inset:0` over the game container.

Each step can be tested in isolation. If a step fails, we don’t change the next one until it passes.

---

## 2. Known constraints

| Constraint | Impact |
|-----------|--------|
| Emulator canvas is WebGL | No `getContext('2d')`; must use drawImage→getImageData or readPixels. |
| We don’t create the WebGL context | Can’t set `preserveDrawingBuffer: true`. Buffer may be cleared after composite. |
| drawImage(webglCanvas) | Browser may return a cached copy of the last composite, so we sometimes see the same frame repeatedly. |
| readPixels | Must read in the right moment; can get black or wrong buffer. Restoring GL state (e.g. framebuffer binding) after read is required. |
| rAF order | Our callback and the emulator’s may run in any order; reading “this frame” is timing-sensitive. |

---

## 3. Verification strategy

### 3.1 Unit tests (run with `npm test`)

- **remapFrame:** Given a small ImageData and a preset, assert output RGBA matches expected (e.g. red 0→bucket 0, red 85→bucket 1, etc.).
- **aspectFitRect:** Given (srcW, srcH, dstW, dstH), assert (x, y, w, h) is centered and aspect ratio preserved.

These prove that the pure logic is correct and stay green as we change capture/composite.

### 3.2 Runtime diagnostics (in the app, with a ROM loaded)

A “Palette diagnostics” run (triggered when entering Palette mode or via a button) runs the following checks and reports pass/fail to the console and optionally to the UI:

| Step | Check | Pass condition | If fail |
|------|--------|----------------|----------|
| 0 | Locate canvas | `getEmulatorCanvas()` returns a canvas with `width ≥ 320`, `height ≥ 200` | Show “Canvas not found”; don’t run later steps. |
| 1a | One-frame read | Read pixels once (drawImage+getImageData or readPixels). Sample not all zeros; red channel has at least 2 distinct values. | “Capture: frame empty or constant.” |
| 1b | Multi-frame read | Read N frames (e.g. 10) at ~100 ms intervals. At least 2 frames must differ (e.g. by checksum or centre pixel). | “Capture: only one frame ever (cached).” |
| 2 | Remap | Use a known ImageData and preset; compare to expected output (or checksum). | “Remap: output wrong.” (Unit test covers this; runtime can skip or do one sanity check.) |
| 3 | Overlay draw | Overlay canvas has correct size; after drawing a test pattern, getImageData on overlay shows non-zero where expected. | “Overlay: size or draw wrong.” |

After a run we get a short report, e.g.:

```
[Palette diagnostics]
  Step 0 Locate:     pass (512×256 canvas)
  Step 1a Capture:   pass (non-zero, varying red)
  Step 1b Multi:     FAIL (all 10 frames identical)
  Step 2 Remap:      (skipped – covered by unit test)
  Step 3 Overlay:    pass
```

So we know exactly where the pipeline breaks (e.g. “Step 1b: capture is cached”).

### 3.3 Manual / E2E (optional later)

- Load ROM → switch to Palette → wait 2 s → capture overlay twice 1 s apart → assert content differs. Requires a test runner (e.g. Playwright) or manual check.

---

## 4. Implementation order

1. **Add unit tests** for `remapFrame` and `aspectFitRect`. Run `npm test`; both pass.
2. **Add runtime diagnostics** (see above). Wire to “Run diagnostics” in the Palette debug UI (or auto-run once when switching to Palette). Fix any failing step before changing rendering logic.
3. **Stabilise Step 1 (Capture):**  
   - If diagnostics show “Step 1a pass, Step 1b fail”, the problem is repeated frames (caching). Options: try readPixels with careful timing, try double rAF, or accept 30 fps and document “may be one frame behind” if we can’t fix cache.  
   - If “Step 1a fail”, the problem is empty/wrong buffer; try the other capture method (readPixels vs drawImage) and fix GL state or timing.
4. **Step 3 (Composite):** Only adjust size/position (e.g. aspect-fit vs getBoundingClientRect) after Step 1 is passing. Use diagnostics Step 3 to confirm overlay size and that we’re drawing where we expect.

No change to capture or composite should be made without re-running the relevant diagnostic step and unit tests.

---

## 5. Files and responsibilities

| File | Responsibility |
|------|----------------|
| `src/palette-layer.js` | Pipeline: getEmulatorCanvas, capture (readback/readPixels), remapFrame, aspectFitRect, overlay draw loop. No UI. |
| `src/palette-diagnostics.js` | Runtime checks for Steps 0–3 (`runPaletteDiagnostics`); returns a result object and logs to the console. Trigger: Palette debug → **Run diagnostics** (with a ROM loaded). |
| `src/main.js` | Enables Palette mode; starts loop; shows Palette debug UI and “Run diagnostics” button; displays diagnostic summary if desired. |
| `docs/reference/palette-rendering-plan.md` | This plan. |
| `src/palette-layer.test.js` | Unit tests for remapFrame, aspectFitRect. Run: `npm test`. |

---

## 6. Success criteria

- **Unit tests:** All pass and stay green.
- **Runtime diagnostics:** Step 0 and Step 1a pass with a ROM loaded; Step 1b pass (multiple distinct frames) is the goal for “Palette not stuck on one frame”.
- **Visual:** Palette mode shows continuously updating remapped image, correctly aligned with the game (letterboxing acceptable).
