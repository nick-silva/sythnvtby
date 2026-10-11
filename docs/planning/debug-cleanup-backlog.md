---
status: living
last-reviewed: 2026-10-10
covers: index.html, src/main.js, src/app.css, src/art-pack.js, tools/project.html, tools/painter.js, tools/painter/, tools/sprite-studio.html, tools/sprite-studio.js, tools/sprite-studio/, tools/index.html, tools/viewer.js, tools/extract.js
---

# Debug clean-up backlog: a quieter UI for someone who just wants to color a game

> **Line numbers** below (`tools/painter.js:NNNN`, `tools/sprite-studio.js:NNNN`) are from before Oct 9
> 2026, when both tools were split into parts (`tools/painter/`, `tools/sprite-studio/`). Search by the
> names, labels and element ids given; the code map in [the project guide](../README.md) says which
> part holds what.

A task list for **hiding or removing debug and developer information** that a basic user
does not need to color in a sprite-based Virtual Boy game. Picture the target user: they
have a ROM, they want Mario red and the pipes green, and they have never heard of VIP
worlds, WRAM or pattern hashes.

This builds on [ship-readiness-cleanup.md](ship-readiness-cleanup.md), which says to *keep
the debug features until close to ship*. The two don't conflict. Almost everything here is
**hide behind a switch**, not delete, so the tools stay available to whoever is debugging a
new game. Only items that are dead, misleading, or labelled "leave off" by their own UI
are marked **Remove**.

The findings come from reading the code and from driving the real app in headless Chrome
(Mario Clash, 2026-09-26). File:line references are correct as of that date. The
companion documents are the [user guide](../guide/user-guide.md) and the
[use-case review](use-case-review.md).

**Effort:** XS < 30 min · S < half a day · M ≈ a day.

---

## Step 0: build the switch first (everything else depends on it)

There are currently **four separate debug switches**, and none of them hides the debug UI:

- `?palette-debug=1`, or localStorage `vb-palette-debug` (`src/main.js:52-58`)
- `?painterWorldDebug=1` (`tools/painter.js:255-259`)
- `?painterDebugPaint=1` (`tools/painter.js:255-259`)
- `window.EJS_DEBUG_XX` (`src/main.js:2732`). This one loads unminified EmulatorJS and has nothing to do with the UI.

| # | Task | Effort |
|---|------|--------|
| D0.1 | **Add one "Developer mode" flag** shared by every page. `?dev=1` sets localStorage `vb-dev-mode=1` and `?dev=0` clears it. Read it once at start-up in a small shared module. Keep `?palette-debug` and the painter flags as aliases that imply it. | S |
| D0.2 | Add one CSS rule per page: `body:not(.dev-mode) .dev-only { display: none !important; }`. Each **Hide** item below then only needs the `dev-only` class. | S |
| D0.3 | Give users a visible way in and out: a **Developer mode** checkbox at the bottom of the tools hub and inside the emulator's new **Advanced** disclosure (D1.2). Nobody should need to know a URL flag. | S |
| D0.4 | Add a console gate: `devLog(...)` / `devWarn(...)` helpers that do nothing outside dev mode. Only switch a `console.warn` over once its failure is also shown in the UI (see D4.1). | S |
| D0.5 | Gather the debugging `window.*` helpers (D1.14) under one `window.vbDebug` object, attached only in dev mode. **Check `tests/e2e/` first.** The suite reads `window.__vbFrameCount` and `window.EJS_emulator`, and those must stay. | S |

---

## 1. Emulator page (`index.html`, `src/main.js`)

**The biggest single problem is that the "debug" panel is always on.** `#color-debug-panel`
is shown whenever the core pushes a draw list (`updateColorDebugPanelVisibility`,
`src/main.js:1434-1441`). With the bundled core that means *every running game*, in every
display mode. So every new user sees ghost-test checkboxes and a pixel inspector under the
game.

| # | Item (as the user sees it) | Where | Action | Effort |
|---|------|-------|--------|--------|
| D1.1 | **The whole debug panel** under the game, from "Fade response" to "Clear inspector" | `index.html:108-159`; `src/main.js:1434-1441` | **Hide** (dev-only). Move the two useful controls out first (D1.3, D1.4). | S |
| D1.2 | There is no place for power-user settings | — | Add a collapsed **Advanced** `<details>` under the game. It holds: Fade response, Unpacked tiles, the standalone Color pack and Overrides inputs (D1.9), and the Developer mode checkbox. | S |
| D1.3 | **Frame / Save state** dropdown (jumps to a captured frame) | `index.html:146-148` | **Keep and move.** Put it next to Capture Frame and rename it **Jump to captured frame**. It is a real feature stuck inside the debug panel. Also stop it resetting to index 0 after every capture (`src/main.js:688`). | S |
| D1.4 | **Fade response** slider (default 1.34) | `index.html:110-112` | Move to Advanced and rename it **Color brightness in fades**. | XS |
| D1.5 | "Clip color layer to strip (debug — leave off)" | `index.html:113-115` | **Remove.** Its own label says to leave it off, and strip clipping causes banding ([strip-clip-testing.md](../history/archive/strip-clip-testing.md)). | XS |
| D1.6 | "OBJ X offset -8 (ghost test)", "Apply offset to all draws (debug)", "BG X offset (px) … try -4 for blimp ghost fix" | `index.html:116-124`; `src/main.js:876-889` | **Hide.** These are game-specific alignment experiments. | XS |
| D1.7 | "Deduplicate draws (fix ghost)", "Sort draws by world (VIP z-order)" | `index.html:125-130` | **Hide.** World sort is on by default and correct ([priorities-and-next.md](priorities-and-next.md), Graphics item 3). If dedupe turns out to be needed, it should be the default, not a checkbox. | XS |
| D1.8 | "Unpacked tiles: Default (overlap-based mono fallback) / Palette 0 holes (experimental)" | `index.html:131-137` | Move to Advanced. Rename to **Uncolored tiles: Show original shade / Leave transparent**. | XS |
| D1.9 | The **Color pack (optional)** and **Overrides (optional)** file inputs in the header | `index.html:65-76` | Move to Advanced. The `.vbpack` is the main path, and a second "pack" button next to **Load pack** invites loading the wrong file. | XS |
| D1.10 | Perf overlay checkboxes (Frame Δ / fps, VIP→present ms, Draw count, Override count) | `index.html:139-145` | **Hide.** | XS |
| D1.11 | The **Pack coverage**, **Color layer debug**, **Log duplicate draws**, **Pixel inspector** and **Clear inspector** buttons, plus the inspector output | `index.html:149-157`; `src/main.js:975-1378` | **Hide.** Follow-up: turn Pack coverage into a plain status readout ("62% of tiles on screen are colored"). | XS |
| D1.12 | The **Palette debug** strip ("Canvas 640×480 · Read: ok · VIP · Core patch · Seg · DL", Run diagnostics, Checksums 5s, Log #game). Everyone sees it whenever **Palette** is on (confirmed by screenshot). | `index.html:40-46`; `src/main.js:1455-1456` (shows it), `1487-1582` (polls every 1.5 s) | **Hide** outside dev mode, and stop the 1.5 s status poll while it is hidden. | XS |
| D1.13 | The hint paragraph "Color needs a VIP-exporting core … VIP compositor … VIP-style 2bpp shade … 'Palette 0 holes' is experimental" | `index.html:77` | **Rewrite** as one line, or remove. For example: "Color draws your pack's art over the original picture. Turn Monochrome back on to fill any gaps." | XS |
| D1.14 | Debugging `window.*` helpers: `reportColorLayerDebug`, `reportPackCoverage`, `reportDuplicateDraws`, `reportPixelStack`, `getLastPixelInspectorReport`, `vbSerializeLastVIPState`, `vbGetDrawListSnapshot`, `runPaletteFrameChecksumTest`, `__vbSaveAndPlayStateUrl` | `src/main.js:1644, 1823, 1910-1930` | Move them under `window.vbDebug` in dev mode (D0.5). **Keep** the hooks the core itself uses: `__VB_PUSH_VIP_STATE__` (`src/main.js:63-66`), `__VB_FRAME__` and `__VB_CORE_PATCH_LEVEL__` (`src/main.js:2707-2713`). | S |
| D1.15 | Status line "ROM: … · Pack: vb-pack (0 tiles). VIP: 2688 draws · frame 837 · Color mode on" | `src/main.js:924-969` | **Rewrite.** Three problems. "vb-pack" is the default game ID, not the file the user opened. "0 tiles" appears for packs that *are* painted, because their paint lives in groups and overlays rather than the shared pack (observed on both sample packs). "VIP: N draws · frame N" means nothing to a colorist. Show *pack name · N frames captured · Color on* instead, and move the draw and frame counts to dev mode. | S |
| D1.16 | Splash note "color output appears when a core that exports VIP state is used" | `index.html:100-103` | **Rewrite.** The patched core ships and is the default, so the sentence is out of date. | XS |
| D1.17 | Tooltips that cite repo doc paths (`docs/reference/palette-rendering-plan.md`, `docs/design/color-pack-overrides-design.md`, "see docs on limits") | `index.html:40, 75, 77` | **Remove** the paths from UI copy. Link to the user guide if anything. | XS |
| D1.18 | An alert that mentions `__VB_PUSH_VIP_STATE__`, and confirm dialogs quoting "RetroArch GetState heap-copy patch" and "RASTATE/MDFNSVST" | `src/main.js:2025, 2045-2046, 2222-2224` | **Rewrite** the user text in plain words, e.g. "This emulator build can't capture frames". Keep the technical detail in a dev-mode console line. | XS |
| D1.19 | The **Tools** link tooltip says "Tile extractor, frame viewer, pack editor" and mentions neither the Project tool nor SpriteStudio | `index.html:93` | Rewrite. | XS |
| D1.20 | Dead custom events `vb-color-pack` and `vb-display-mode` (nothing listens for them) | `src/main.js:190, 1484, 1656` | **Remove**, unless they are being kept on purpose as an extension point. | XS |
| D1.21 | Dead module `src/rom-storage.js`. Nothing imports it, and it opens IndexedDB `colorized-vb` at version 1 while `src/vbpack-storage.js` uses version 2, so reviving it would throw. | `src/rom-storage.js` | **Remove.** | XS |
| D1.22 | Dead CSS `.color-debug-panel .color-pack-status` | `src/app.css:365` | **Remove.** | XS |

### Console noise (emulator)

Measured: **1,251 console messages in the first ~20 seconds** after loading a ROM and a
pack. Most come from EmulatorJS and RetroArch (`[EJS …]`, `[INFO] [Environ] …`, shader
logs), because `EJS_DEBUG_XX = true` loads the unminified debug build. The app adds 57
calls of its own: 35 `warn`, 16 `log` and 6 `info`.

| # | Task | Effort |
|---|------|--------|
| D1.23 | Find out whether the local core can run without `EJS_DEBUG_XX` (or with RetroArch's log level raised) outside dev mode. Most of the noise comes from there. | M |
| D1.24 | Put the chatty Colorize / Save and Play `console.info` lines (`src/main.js:2042, 2220, 2260, 2269, 2306`) and the pack-coverage and color-layer debug logs (`977-1067`) behind `devLog`. | XS |

---

## 2. Project tool (`tools/project.html`, `tools/painter.js`)

The Project tool has **no `console.log` calls and no `window` globals**. Its debug surface
is all *on screen*: raw hashes, JSON dumps, the names of files inside the pack, and internal
function names in status text.

| # | Item (as the user sees it) | Where | Action | Effort |
|---|------|-------|--------|--------|
| D2.1 | The **"Developer — v2 tile8 rules"** panel (variant override, "Copy front tile → v2 tile8"). It is made visible on every pack load. | `tools/project.html:1002-1016`; `tools/painter.js:6988, 7048` | **Hide.** These are legacy per-variant rules and no current workflow needs them. | XS |
| D2.2 | The line under the canvas: "384×224 · compositeColorFrame preview: no-pack mono = red diagnostic ramp + stack depth 1 (emulator uses grayscale + depth 2)". It is static and never updates. | `tools/project.html:1071` | **Remove.** | XS |
| D2.3 | Status bar text on open: "preview uses compositeColorFrame (WRAM off). Frame names use manifest.frameRegistry when present." | `tools/painter.js:6636-6639, 6671` | **Rewrite**, e.g. "Open a .vbpack, or press Colorize! in the emulator." | XS |
| D2.4 | The footer "Reference strip — import / paste into group: **planned**" and a static "● Live preview" | `tools/project.html:1219-1220` | **Remove** both. One advertises an unbuilt feature; the other is a label that never changes. | XS |
| D2.5 | The world histogram "Worlds in frame (eye+layer): 1413 draws — 29:658 · 28:611 …" | `tools/project.html:988`; `tools/painter.js:2475-2504` | **Hide.** | XS |
| D2.6 | The "VIP WORLD (0–31)" grid of 33 buttons | `tools/project.html:986` | Rename to **Layers (0 = front)** and collapse it by default. It helps with backgrounds and is noise for sprites. | S |
| D2.7 | Tile inspector showing Hash, Tile index, World and raw `{"x":24,"y":192,"flipH":false,…}` JSON | `tools/painter.js:2216-2220, 6733-6743` | Show "used N× on this screen · layer N" instead. **Hide** the hash, index and JSON. | S |
| D2.8 | The **Stack** panel (hash, tile index, `w#`) | `tools/painter.js:2698-2740` | Keep the panel, but hide the hash and index columns outside dev mode. | XS |
| D2.9 | Group inspector showing **Group ID**, the anchor hash in both decimal *and* hex, and **"Raw criteria (debug)"** JSON | `tools/painter.js:3812-3813, 3836-3839` | **Remove** the raw JSON from the normal view and hide the IDs. | XS |
| D2.10 | Group action buttons labelled **A**, **✕**, **+**, **-**, **CP** and **DEL**. Their tooltips still say "(placeholder icon)", and "filter to group" reuses the grid icon. | `tools/painter.js:3790-3843, 3825` | Give them real labels or icons: "Pick anchor", "Add selected", "Remove selected", "Duplicate", "Delete". | S |
| D2.11 | Memory-pool summary and pool-context hint text naming `groups.json`, `manifest.memoryAnalysis.topCandidatesByState`, `gameStatePools`, `__default__`, "Painter v2 variant (unique row)" and "(RAM fingerprint)"; also "Pool context: pool-title·\_\_default\_\_" above the groups | `tools/painter.js:3553-3602, 4328-4360, 5795-5798` | **Rewrite** in plain words, e.g. "Screen: Title". Hide the whole Memory Pool section of the rail until the pack has pools. | M |
| D2.12 | The **New group** dialog: "456 pattern hash(es) → 1227 draw(s) … Membership is by tile content (+ world/layer) … registry / VIP / selection did not resolve; v2 variant did not single out one row … No WRAM dump … BG groups store a default anchorHash … VIP overlay / macro placement" | `tools/painter.js:4454-4560`; `#new-group-dialog` in `tools/project.html` | **Rewrite** to three fields: Name · Sprite or Background · (Advanced ▸ screen). Replace the text with one sentence: "This group includes every copy of these tiles on screen." | M |
| D2.13 | Selection hint "unique anchor → VIP overlay; reused anchor hash / no anchor → vbcolor tile8" | `tools/painter.js:2151, 2186` | Rewrite as "Paints this spot only" or "Paints every copy". | XS |
| D2.14 | Status strings that use "vbcolor pack", "tile8", "VIP paint layer", "painter-v2-rules.json (schema n)" and "authoring only until macro / pack export". The last one is also **wrong**: overlays are saved and do show in the emulator. | `tools/painter.js:5352, 5475, 7043, 7426-7433, 7523-7524` | Rewrite. | S |
| D2.15 | The anchor-pick confirm text "VIP world … per-hash tile8" | `tools/painter.js:6620` | Rewrite. | XS |
| D2.16 | Save-validation messages quoting `statePoolId/stateVariantId`, `criteria.hashes[i]` and `painter-v2-rules tile8ByVariant` | `tools/painter.js:4997-5121` | Keep the technical text in dev mode. Otherwise show a plain summary, e.g. "Group 'Mario' refers to a screen that no longer exists — pick one". | M |
| D2.17 | Frame names shown with capture IDs, e.g. "Title – f-mtkckd7v-cj0v9t" | frame dropdown (`tools/painter/frame-registry.js`) | Show "Title (2)" and keep the ID in a tooltip. | S |
| D2.18 | The **Import asset** button, which is always disabled ("coming later") | `tools/painter.js:2108, 7679` | **Remove** until it is built. | XS |
| D2.19 | "Frame tags … a filter that uses them is coming" | frame-details dialog in `tools/project.html` | Remove the promise, or hide tags. | XS |
| D2.20 | The "Legacy & unassigned" section of the groups tree | `tools/painter.js:5781` | Hide it when empty, and rename it "Not tied to a screen". | XS |
| D2.21 | "Select tiles not in any group (this pool)" | `tools/project.html:1086` | Move to Advanced. | XS |
| D2.22 | The `?painterWorldDebug=1` and `?painterDebugPaint=1` `console.debug` flags | `tools/painter.js:255-259, 2465, 2479, 6265, 6447-6463` | Keep, and fold them into dev mode (D0.1). | XS |
| D2.23 | An unstyled **SpriteStudio →** button (it has no class) and an unstyled frame-details dialog (missing from the dialog CSS lists) | `tools/project.html:935, 709-757` | Style them. As they stand they look like debug leftovers. | XS |
| D2.24 | **Reload frame** is styled as a *primary* button next to Save and Play, and it throws away unsaved overlay paint (D4.3) | `tools/project.html:936` | Make it a secondary button, or move it into the Frame menu. | XS |

---

## 3. SpriteStudio and the other tools

SpriteStudio itself is clean underneath: **no console calls and no window globals.** Its
debug surface is raw hashes and jargon in the right-hand panel and the status text.

| # | Item (as the user sees it) | Where | Action | Effort |
|---|------|-------|--------|--------|
| D3.1 | Pose panel: "Anchor #17CB93D9", "Matched here 3 / 5", "Tiles" | `tools/sprite-studio.js:1858, 1884-1886` | Hide the anchor. Turn "Matched" into a plain warning, e.g. "2 tiles missing on this frame". | S |
| D3.2 | BG panel: "ONE SET 34 of 96 tiles — repeats every 264 px across", "Animated: N tile slot(s)", "Unpainted steps 1: #… 2: #…", "PAINT Overlay from the Project tool (hides pattern paint)" | `tools/sprite-studio.js:1862-1877` | Rename in plain words, or hide. | S |
| D3.3 | Pick tool status "Picked #xxxxxx from tile #1A2B3C4D" | `tools/sprite-studio.js:865` | Drop the tile hash. | XS |
| D3.4 | Coverage "12/15 pattern(s), 30 tile(s) · 2 conflict(s)"; box note "taking from +3,-2 · 1.05×"; stage note "one set: 4 of 64 tiles · painted \| reference" | `tools/sprite-studio.js:1008, 1146, 1753` | Simplify, or move behind Advanced. | S |
| D3.5 | **Eye** (Left/Right) and **Brightness 1.25** in the main header | `tools/sprite-studio.html:416-424` | Move to a View menu (Left eye by default). Changing either currently also resets your place (see the review). | S |
| D3.6 | Toolbar labels "Pin bg", "One set", "Behind" | `tools/sprite-studio.html:439-442` | Rename: "Hold background still", "Show one repeat", "Backdrop color". | XS |
| D3.7 | Sprite list falls back to the raw group `id` for unnamed groups | `tools/sprite-studio.js:260` | Show "Unnamed sprite". | XS |
| D3.8 | The **Animation** (tracks) panel does not say that tracks are a preview only (the emulator never plays them) | `tools/sprite-studio.html:493-511` | Label it **Animation preview**. | XS |
| D3.9 | The handoff query string is still `?from=painter` | `tools/sprite-studio.js:2304`; `tools/painter.js:7274-7290` | Rename to `from=project`, keeping `painter` as an alias. | XS |
| D3.10 | ~~Branding: three names for one product~~ **Done Oct 2026:** one name across the app and tools (sythnvtby, Oct 10). | page headers | Pick one name. | XS |

**The tools hub (`tools/index.html`) and the pages it links**

| # | Item | Where | Action | Effort |
|---|------|-------|--------|--------|
| D3.11 | The hub gives **Memory analysis**, **Frame viewer**, **Tile extractor**, **Pack validator** and the **Download Python WRAM analyzer** link equal billing with the main tools | `tools/index.html` | Keep Emulator, Project tool and SpriteStudio up top. Put everything else in a collapsed **Developer tools** section (dev-mode only). | S |
| D3.12 | The **Memory analysis** page duplicates *File ▸ Analyze memory* in the Project tool, and its copy still says "paint tool" | `tools/memory-analysis.html:54, 58`; `tools/memory-analysis.js:346` | Developer tools only. Fix the copy. | XS |
| D3.13 | The Python analyzer (`tools/memory-analysis/analyze_vbpack_ram.py`, version "2.1") has drifted from the in-browser one ("2.2-js") | `tools/memory-analysis-inbrowser.js:4` | Remove the hub download link. Keep the script as legacy or delete it. | XS |
| D3.14 | The **Frame viewer** has about 20 alignment controls ("Palette 2 = black (debug)", Offset/Scale/Origin, Crop top, Clear top/left/right) and 10 console calls. It also needs a standalone `vbstate.json`, which nothing in the app exports any more. | `tools/viewer.html`; `tools/viewer.js:357, 504, 555-660` | Developer tools only. See [ship-readiness-cleanup.md](ship-readiness-cleanup.md) for the per-control plan. | S |
| D3.15 | `tools/editor.html` (the pack editor) is not linked from the hub but is still built (`vite.config.js`). It decodes tiles in the wrong bit layout (`tools/editor.js:26-37` versus the shared decoder in `src/vb-2bpp.js`), so its previews and exports are scrambled. | `tools/editor.html`, `tools/editor.js` | **Remove**, or switch it to `src/vb-2bpp.js`. The Project tool and SpriteStudio replace it. | XS |
| D3.16 | Tile extractor and pack validator: file-derived text goes into `innerHTML`, and the validator accepts `.json`, which always fails | `tools/extract.js:34` | Developer tools only. Use `textContent` (this is also a small XSS hole for a crafted file). | XS |
| D3.17 | ~~The shelved AI experiment lives in `src/` beside app code.~~ **Done Oct 8 2026:** removed with ComfyUI (the project does not use it); its design is in `history/archive/ai-reference-colorization.md`, the code in git history. | `src/` | — |

---

## 4. Not debug, but blocks a basic user: fix alongside

These are not "debug information". But a quieter UI makes them *more* dangerous, because
today the console is where their only warning lives.

| # | Problem | Where | Fix | Effort |
|---|---------|-------|-----|--------|
| D4.1 | **Failures reported only in the console**: pack parse errors, overrides JSON errors, WRAM and screenshot capture failures, project-home errors, and "Save and Play boots from the start (no save state)" | `src/main.js:1674, 1692, 1735, 1792, 1883, 2348, 2462, 2470, 2750` | **Done (2026-09-29):** the emulator shows these on the status line for 9 s (`reportProblem` in `src/main.js`), and a capture missing its memory or screenshot says so. | S |
| D4.2 | **Captured frames are lost without warning.** They live only in memory. Load ROM, Load pack and **Last pack** (which reloads the page) all discard them, and the emulator has no `beforeunload` guard. | `src/main.js:1704, 1813, 1869-1872` | **Done (2026-09-29):** Load ROM, Load pack and Last pack confirm, `beforeunload` guards the tab, and the status line says "N captures not saved" (`src/unsaved-work.js`). | S |
| D4.3 | **Unsaved anchored-overlay paint is wiped on frame change or Reload frame.** `loadVipFromJson` calls `clearVipAuthoringOverlay()`, and then only the last *saved* overlays are re-applied (`loadedPackParts` is refreshed only by `syncLoadedPackPartsAfterSave`). | `tools/painter.js:388-391, 1831-1837, 5954, 7110-7145, 5238-5260` | **Done (2026-09-29):** moot — touch-ups replaced overlay painting, and old overlays convert on open. | S |
| D4.4 | The Project tool has no `beforeunload` guard, and **Open pack…** discards the current pack without asking | `tools/painter.js:6845, 7095` | **Done (2026-09-29):** `beforeunload` guard and an Open pack confirm; the page's own navigations skip the guard (`leavePainterTo`). | XS |
| D4.5 | **Packs are saved uncompressed.** `buildArtPack` calls `generateAsync({ type: 'blob' })` with no `compression`, so JSZip stores every entry. All 133 entries in `marioclash-annotated.vbpack` are stored. Re-deflating it takes **42.5 MB down to 3.0 MB**. | `src/art-pack.js:456-459`; `tools/memory-analysis.js:215` | **Done (2026-09-29):** DEFLATE level 1 for all pack writes, PNGs stored. The 192 MB Mario Clash project saves as 18.6 MB (1.9 s in node; level 6 gave 16.0 MB for 3.8 s). | XS |
| D4.6 | Colorize! can leave the game paused on an early return (the "no ROM" alert, or a cancelled save-state confirm) | `src/main.js:2053-2064` | Resume the game before returning. | XS |
| D4.7 | SpriteStudio never deletes its `sprite-studio-pack` handoff. Every later visit, for example from the hub, re-opens a possibly stale pack, and tens of MB stay in IndexedDB. | `tools/sprite-studio.js:67, 2296-2302` | Delete the handoff after reading it. | XS |

---

## Suggested order

1. **Step 0** (the switch), then **D4.1–D4.5**: don't lose work, don't fail silently, and make packs 14× smaller.
2. Emulator D1.1–D1.13. This takes about an afternoon, and afterwards the first page a new user sees is calm.
3. Project tool on-screen jargon: D2.1–D2.5, D2.9, D2.13, D2.14 and D2.18. These are mechanical.
4. Hub and SpriteStudio: D3.5–D3.8, D3.11, D3.15.
5. The copy rewrites that need thought: D1.15, D2.11, D2.12, D2.16 and D3.1–D3.2. Do them together, using the [user guide glossary](../guide/user-guide.md#glossary), so every page uses the same words.
6. The console-noise investigation (D1.23).

**Acceptance test for the whole clean-up:** with dev mode off, load a ROM and a pack, play,
Colorize!, paint, Save and Play, then open SpriteStudio. **No hash, world number, JSON,
pack-internal file name or function name should appear anywhere on screen**, and the
console should show nothing but real warnings.
