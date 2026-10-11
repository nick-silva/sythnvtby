# sythnvtby

Browser-first Virtual Boy emulator with optional per-game colorization via **sprite/tile packs** and a mono/color toggle.

- **Monochrome:** Standard red/black VB output.
- **Palette:** Remaps the 4 VB shades to a preset (e.g. green, blue, Game Boy).
- **Color:** The monochrome frame is the base; a color layer is drawn on top from a `.vbpack` / `.vbcolor`. Missing pack data stays transparent so mono shows through.

This repo is the **application**. It does **not** include ROMs or colorization project files (`.vbpack`, `groups.json`, `overrides.json`). Provide your own `.vb` ROM.

## Quick start

```bash
npm install
npm run dev
```

Open the URL shown (e.g. http://localhost:5173), load a Virtual Boy ROM (`.vb`), and play.

The app uses a **local patched Beetle VB core** (`USE_LOCAL_CORE = true` in `src/main.js`) from `public/data/`. Color mode, VIP capture, and WRAM analysis need that core — not the public EmulatorJS CDN.

## Tools

- **Tools hub** (`/tools/`) — index with links back to the emulator, the authoring tools, viewer, plus on-page tile extractor / pack validator.
- **Project tool** (`/tools/project.html`, formerly Painter v2 at `painter.html`) — frame-first authoring: load a `.vbpack`, isolate and name assets, manage groups, pools and poses, paint, save pack. **File → Analyze memory** runs the WRAM analysis into the pack you have open.
- **SpriteStudio** (`/tools/sprite-studio.html`) — sprite-first: pick a sprite, step or play through its poses over the background they were captured on. Reachable from the Project tool's **SpriteStudio →** button, which carries the open pack and selected sprite across.
- **Memory analysis** (`/tools/memory-analysis.html`) — standalone WRAM analysis page; the Project tool path above is usually what you want.

## Testing

- **Unit tests:** `npm test`
- **Browser regression tests:** `npm run test:e2e` (headless Chrome against a local ROM and `.vbpack` files; see `tests/e2e/harness.mjs`)
- **Runtime diagnostics** (with a ROM loaded, switch to Palette, click **Run diagnostics**): see console for Step 0–3. See [docs/reference/palette-rendering-plan.md](docs/reference/palette-rendering-plan.md).

## Rebuilding the emulator core

You only need this if you change C/C++ in Beetle or RetroArch glue. The shipped WASM lives in `public/data/cores/`. See **[docs/core/core-build.md](docs/core/core-build.md)**.

## Docs

**Coloring a game?** Read the **[user guide](docs/guide/user-guide.md)**. It starts with a
TL;DR quick start, then covers the tools, the gotchas and a glossary.

**Working on the code?** Start with the **[project guide](docs/README.md)**: how the emulator, color layer and authoring tools fit together, the colorizing workflow, a code map, and a map of every doc — grouped into `reference/`, `core/`, `design/`, `planning/` and `history/`. Run `npm run docs:check` to find broken doc links and docs whose code has changed since they were last reviewed.

## License

**GPL-3.0-or-later** — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The bundled emulator core is
Beetle VB (GPL-2.0-or-later) built with RetroArch and EmulatorJS (GPL-3.0); NOTICE lists every
third-party component and where the core's source comes from (`scripts/build-core.sh`, `patches/`).
Games, ROMs and the colour projects you make are not covered; don't share a `.vbpack` that holds a
ROM you may not distribute.
