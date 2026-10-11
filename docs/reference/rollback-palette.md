---
status: current
last-reviewed: 2026-09-18
covers: src/palette-layer.js
---

# Palette feature: rollback and troubleshooting

## Laggy sound or slow performance

If the emulator sounds ragged or runs slowly (including in **Monochrome**), the browser process is often under memory or CPU pressure.

- **Try:** Close other browser tabs and reopen the app (or restart the browser). Freeing RAM and reducing swap use usually fixes it.
- Palette mode is throttled to ~30 fps and reuses buffers to limit CPU/GC load; if it’s still heavy on your machine, use Monochrome or disable the feature (see Rollback below).

---

## Verbose console logs

To turn on extra palette logs (one-time diagnostic, switch-to-palette messages) for debugging:

- Add **`?palette-debug=1`** to the page URL and reload, or
- In the browser console: **`localStorage.setItem('vb-palette-debug','1')`** then reload.

Disable: remove the query param or run **`localStorage.removeItem('vb-palette-debug')`** and reload.

---

## Debugging when Palette does nothing

1. Load a ROM, then switch display to **Palette**.
2. A **Palette debug** line appears in the header:
   - **Canvas: not found** — the app cannot see any emulator canvas (often because the emulator runs in a cross-origin iframe).
   - **Canvas: 640×480 | Read: ok** — canvas found and readable; remap should be working.
   - **Canvas: … | Read: tainted (cross-origin)** — canvas is in another origin; we cannot read pixels.
3. Click **Log #game** and open the browser **Console** (F12 → Console). You will see the DOM under `#game` and all canvases. If `#game` only contains an `<iframe>`, the video is inside that iframe.
4. **Fix:** Serve EmulatorJS from your own origin (see below).

---

## Palette does nothing (stays red)

When you choose **Palette** and change presets but the game stays red, the app is likely **unable to read the emulator’s video canvas**. That usually happens when EmulatorJS loads the core in a **cross-origin iframe** (e.g. from `cdn.emulatorjs.org`). Browsers block reading pixels from another origin.

**Fix:** Serve EmulatorJS from your own origin so the canvas is same-origin.

**This is already the default:** `USE_LOCAL_CORE = true` in `src/main.js` serves EmulatorJS and the patched core from `public/data/`. The steps below only matter if you switch back to the CDN.

1. Download the [EmulatorJS release](https://github.com/EmulatorJS/EmulatorJS/releases) and unzip it.
2. Copy the **`data`** folder (the one that contains `loader.js` and the cores) into your project, e.g. **`public/data/`**.
3. In **`src/main.js`**, set the data path to your local copy instead of the CDN:
   - Change `const CDN = 'https://cdn.emulatorjs.org/stable/data/';` to `const CDN = '/data/';` (or your path).
4. Restart the dev server and load a ROM again. The emulator will run from your server; the video canvas should be in the same document and Palette can read it.

If you keep using the CDN and Palette never works, you can disable the feature (see Rollback below).

---

## Rollback: remove the feature

If the palette feature causes issues or you want to remove it, do the following.

## 1. Disable the feature flag

In **`src/main.js`**, set:

```js
const ENABLE_PALETTE = false;
```

This stops the palette loop and hides the Palette button and preset dropdown (they are removed from the DOM when the flag is false).

## 2. (Optional) Remove palette UI from HTML

In **`index.html`**, remove:

- The `<button type="button" id="btn-palette" ...>Palette</button>` line.
- The entire `<div class="palette-preset-wrap" id="palette-preset-wrap" ...> ... </div>` block.

## 3. (Optional) Remove palette code

For a full rollback so the feature is not loaded at all:

1. In **`src/main.js`**:
   - Remove the line: `import * as paletteLayerModule from './palette-layer.js';`
   - Remove the block between `// --- PALETTE FEATURE` and `// --- END PALETTE FEATURE` (the constant, palette canvas creation, palette handling in `setDisplayMode`, `btnPalette` / `palettePresetEl` refs and their event listeners, and the start/stop loop calls).
   - In `setDisplayMode`, remove references to `palette`, `btnPalette`, `palettePresetEl`, `paletteCanvas`, and `paletteLayerModule`.
   - Change `displayMode` type back to `'mono'|'color'` if you had it as `'mono'|'palette'|'color'`.
2. In **`index.html`**, remove the Palette button and the palette-preset-wrap div (as in step 2).
3. Delete **`src/palette-layer.js`**.
4. Remove **`docs/reference/rollback-palette.md`** if you no longer need it.

After step 1 (flag = false), the app behaves as before: only Monochrome and Color display modes, and no palette remap. Steps 2–3 are optional cleanup.
