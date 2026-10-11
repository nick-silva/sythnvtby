# Current state and next steps

For the full picture of how extraction, pack creation, and runtime display work (including mono-under-color fallback), see **[docs/reference/art-pipeline.md](../../reference/art-pipeline.md)**.

## What works now

- **Load a ROM** — Pick a Virtual Boy ROM (`.vb`). The app runs it in the browser via EmulatorJS. (With the default CDN core: monochrome/palette works; VIP-dependent features need a patched/local core.)
- **Play in monochrome** — Full framerate, sound, and controls. No install; runs in a modern browser.
- **Palette mode** — Display includes **Palette**: remaps the 4 VB shades to a preset (Original, Green, Blue, Game Boy, Warm). Frames update continuously; see [palette-mode-bug-investigation.md](palette-mode-bug-investigation.md) for the preserveDrawingBuffer fix.
- **Display toggle** — UI has Monochrome / Palette / Color and View (2D, Side-by-side, Anaglyph). In Color mode the app shows the monochrome frame with the color layer on top; where the pack has no tile, mono shows through. With the current CDN core no VIP state is sent, so the color layer stays empty until you use a patched core.
- **Color pack (optional)** — You can load a `.vbcolor` file. The runtime uses it when it receives VIP state: it draws only tiles that are in the pack; the rest of the color layer is transparent so mono shows underneath.
- **Save VIP state** — Saves the last received VIP state as `vbstate.json` (one frame’s pattern table, OAM, etc.) so you can open it in the tile extractor and then the pack editor to build or extend a color pack. Only works when the core pushes state (patched core required).
- **Single-file vbpack workflow** — `.vbpack` (zip) can include ROM + vbcolor + overrides + groups + manifest + `vipstate-current.json` + `save-state.state`, plus **`vipstates/*.json`** and **`savestates/*.state`** for multi-frame packs. The emulator **Frame / Save state** picker switches frames; **Export .vbpack** prompts for a filename with a default derived from the loaded ROM name. **Save .vbpack** in the painter (Chromium) can overwrite the same file after the first pick via the File System Access API.
- **Colorize! → Painter → Save and Play** — Main app **Colorize!** pauses, captures VIP+save state, and opens the painter in the same tab. Painter edits pack + overrides; **`groups.json`** can include **`gameStatePools`** (variants own `ramConditions`) and **`groupsSchemaVersion: 2`**. **Save and Play** returns an updated vbpack via IndexedDB; fallback **download** uses the **last loaded or saved** pack basename where possible, and may **overwrite** the file from **Save .vbpack** (Chromium File System Access API). **Manifest** round-trip keeps **`frameRegistry`** / **`currentVipStateRef`** so the frame list stays human-readable. **Capture Frame** remembers state/sub-state labels (localStorage + datalists).
- **Runtime WRAM gates** — When the main app can supply **64 KiB CPU WRAM** (live core RAM or extraction from save state), `color-layer.js` evaluates **`ramConditions`** on overrides and **effective RAM** from **group + pool/variant** (`resolveEffectiveRamConditionsForGroup`). When WRAM is unavailable, gated overrides are skipped per fail-closed rules in the color layer.
- **Paint tool (highlights)** — **Authoring profiles** include **pool-first** (pools → variants → groups). **Show** per group controls what appears on the canvas; **paint target** (pencil) scopes **group** overrides only — it does not hide other windows. **Frame** list: default row matches loaded VIP; custom list UI where native `<select>` is unreadable; **`frameRegistry`** preserved on **Export / Save .vbpack / Save and Play** when the pack had it. **Reset view filters** and auto-reset on frame change (window multiselect + paint target). Scene composite uses **VIP `world` order** and **pack holes at mono index 0** like the main color layer. **Selection**: marquee + **Select in box** / shift-click multi-select. **Group-scoped cell overrides**: `hash` + rect + `groupId` when using **This cell only (override)** with **This group** color target.
- **Tools** — Tile extractor, pack validator, pack editor, **memory analysis** (`tools/memory-analysis.html` — apply WRAM analysis into manifest, save annotated pack), **paint tool** (`tools/paint.html`), and a **tools index** (`tools/index.html`) are under `/tools/`. The legacy Python memory analyzer is linked from the index only.

## What’s built but dormant

- **Color layer** — When the core pushes VIP state (pattern table, OAM, optional draw list) each frame, the app draws only pack-matched tiles into a transparent-over-mono layer and shows it when Display is set to Color. Missing pack data shows the monochrome frame underneath. The CDN Beetle VB core does **not** export VIP state, so no color output until you use a patched core.
- **Stereo color** — Left/right buffers and view modes (2D, side-by-side, anaglyph) are implemented for the color path; they activate once the core sends state per eye.

## Next steps (in order of risk / effort)

1. **Core availability / packaging** — Make it easy to run with a core that exports VIP state (document “local core” vs CDN core, and/or ship a hosted build). The workflow works end-to-end once VIP export exists.
2. **WRAM authoring vs preview** — Live gating works in the **emulator** when WRAM is wired; the **paint tool** canvas preview still does not simulate RAM bytes (optional future). Edge cases: handoff / reload without full page refresh; see backlog in [priorities-and-next.md](../../planning/priorities-and-next.md).
3. **Graphics pipeline** — Fading/brightness, animated BG tiles, affine layer; see [graphics-next-investigations.md](../../planning/graphics-next-investigations.md).
4. **Ship-readiness polish** — Consolidate UI, improve defaults (e.g. select Color mode automatically when vbpack has vbcolor), and do the “ship cleanup” pass.

**Done recently (was on this list):** multi-frame vbpacks (`vipstates/`, `savestates/`), emulator frame picker, painter frame list with human labels, memory-analysis write-back in the browser — see [development-journey.md](../development-journey.md) (March 2026 section).

For tile painting improvements (bucket, eyedropper, eraser) and ROM name / pack lookup, see [priorities-and-next.md](../../planning/priorities-and-next.md).

---

## Other attempts to colorize Virtual Boy games

Research (as of 2025) shows a few existing approaches; none do per-tile/sprite color packs like this project.

### Red Viper (3DS)

- **What it is:** Virtual Boy emulator for Nintendo 3DS ([skyfloogle/red-viper](https://github.com/skyfloogle/red-viper)).
- **Colorization:** “Multicolor” mode remaps the **four VB shades** (Darkest, Dark, Light, Lightest) to any RGB colors via the touchscreen. Palettes can be saved **per game**. Stereoscopic 3D is preserved.
- **Coverage:** Ars Technica, July 2025 — [“Not (just) seeing red: Virtual Boy emulator adds full color support”](https://arstechnica.com/gaming/2025/07/not-just-seeing-red-virtual-boy-emulator-adds-full-color-support/).
- **Difference from this project:** Palette remapping only (same four shades for the whole screen). No per-sprite or per-tile color packs.

### Virtual-boy-colorize (shader)

- **What it is:** GLSL shader for RetroArch ([IgnacioLeivaP/Virtual-boy-colorize](https://github.com/IgnacioLeivaP/Virtual-boy-colorize)) that applies color to the VB image.
- **Colorization:** Shader-based; requires configuring RetroArch and shader files. Adds color in post-process, not per-tile data.
- **Difference from this project:** No sprite/tile pack format; different pipeline (post-process vs. re-render from VIP state + pack).

### Mednafen / Beetle VB

- **What it is:** Standard VB emulation (Mednafen docs, GBATemp threads). Virtual Boy uses a 4-shade red palette; some setups allow custom RGB for those four shades.
- **Difference from this project:** At most 4-color palette replacement for the whole frame, not per-game tile packs.

### Planet Virtual Boy

- **Community:** Forums have discussed “Color Patches,” RGB hex codes, and workarounds (dithering, column table, blending). No single canonical “colorized VB” pack format or web emulator with tile-based color like this project.

---

## Summary

This project is aiming for **per-game color packs** (hash-keyed tiles → RGBA) and a **mono/color toggle** in a browser emulator. That requires a core that exports VIP state; the current CDN core does not. Other work (Red Viper, shaders, palette options) gives full-screen or palette-level color, not the same pack-based pipeline.
