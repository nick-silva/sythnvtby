---
status: living
last-reviewed: 2026-09-26
---

# Ship-readiness cleanup (future)

When preparing the project for a "ready to ship" or public release, do the following cleanup. **Do not remove these before then** — they are useful for debugging and alignment work. This doc is a checklist for a future pass.

**General:** UX will require a lot of cleanup before shipping; backlog all non-critical UX improvements until we are very close to ship.

**See also:** [debug-cleanup-backlog.md](debug-cleanup-backlog.md) is the page-by-page task list for the emulator, Project tool, SpriteStudio and tools hub, with file:line references. It keeps the debug features but hides them behind one Developer-mode switch, so it can start before ship without losing anything this checklist wants to keep. The viewer items below are its D3.14.

---

## Main app: vbpack load

| Item | Notes |
|------|--------|
| **Color mode by default when vbpack has vbcolor** | **Done:** When loading a vbpack that contains a color pack, the main app switches to Color mode automatically. |

---

## Viewer (`tools/viewer.html` / `tools/viewer.js`)

### Options to consolidate or hide by default

| Control | Current role | Ship cleanup |
|--------|----------------|--------------|
| **Crop top** | Skip draws with `y < N` (workaround for top bar). | Move into a **Debug** or **Alignment** collapsible section; or remove if capture + GPLT make it unnecessary on most screens. |
| **Clear top / Clear left / Clear right** | Fill regions with black after draw (viewport comparison). | Same: move to Debug/Alignment or remove. |
| **Black BG** | Force palette index 0 to black (was for comparison). | With captured/shaded palettes, less critical; could stay as a simple "Background color" option or move to Debug. |
| **Palette 2 = black (debug)** | Force palette selector 2 to all black (workaround before we had GPLT). | **Remove** or move to a "Legacy debug" section; redundant when using captured palettes. |
| **Offset X/Y, Scale X/Y, Origin X/Y** | Alignment compensation (e.g. scale Y 0.78). | Keep for power users; consider moving to an **Alignment** or **Advanced** section so the main toolbar is simpler. |
| **Captured: Exact \| Shaded** | Toggle raw game colors vs preset tint. | Keep; consider defaulting to **Shaded** and documenting. No need to remove. |
| **Use captured palettes (GPLT)** | Toggle captured vs preset-only. | Keep; core UX. |

### Debug section (keep but optional)

- **Log draw list summary** / **Log alignment sample** / **Show display border** — Keep under a **Debug** or **Developer** collapsible panel so they don’t clutter the main UI. Do not delete; useful for diagnosing new games or odd frames.
- **Click to log draws** — Keep; consider making the yellow highlight optional (e.g. "Highlight selected draw" checkbox) so it doesn’t confuse non-debug users.

### Status line

- Long status (offset, scale, crop, clear, palette, selected draw) is fine for power users. For ship, consider a **compact** mode that shows only frame + draw count + palette, with "Details" expanding to the full line.

### General

- **Console logs** (e.g. "Loaded N draws; per-draw palette: yes") — Consider gating behind `?debug=1` or a "Verbose logging" setting so the console stays clean for normal users.
- **Empty state messages** — Already subtle; no change needed.

---

## Main app (`src/main.js`, palette, etc.)

- **Palette debug UI** (e.g. palette-debug buttons, diagnostics) — If present, move behind a "Developer" or "Debug" section or `?palette-debug=1`. See [rollback-palette.md](../reference/rollback-palette.md).
- **Remember last palette preset** — Already in localStorage; ensure it’s documented. No removal.

---

## Docs and test assets

- **Investigation docs** (sprite-alignment, title-screen-background, etc.) — Keep in repo; they explain *why* options exist. They now live in `docs/history/archive/`, indexed from the [project guide](../README.md).
- **Minimal test vbstate** — If added for tests, keep in repo or in a test fixture path; don’t ship it in the built bundle as a user-facing asset.
- **Large vbstate.json in project root** — If committed for convenience, consider moving to a `test-fixtures/` or `docs/fixtures/` folder and document; avoid cluttering root.

---

## What not to remove

- **Transparent 0** — Core behavior; keep.
- **Eye (Left/Right)** and **Layer (BG / Affine / OBJ)** — Core for stereo and debugging; keep.
- **Palette preset dropdown** and **Use captured palettes** / **Captured: Shaded \| Exact** — Core UX; keep.
- **Export PNG / Copy image** — Useful for users; keep.
- **Load vbstate** and **View (Render / Screenshot / Overlay)** — Core viewer workflow; keep.

---

## Summary

- **Do now:** Nothing; keep all current options and debug features.
- **Do when "ready to ship":** (1) Collapse alignment/debug controls into a **Debug** or **Alignment** section. (2) Remove or hide **Palette 2 = black (debug)**. (3) Gate verbose console logs. (4) Optionally add a compact status mode. (5) Tidy test assets.
