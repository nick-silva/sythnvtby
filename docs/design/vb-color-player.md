---
status: partial
last-reviewed: 2026-10-10
covers: src/color-layer.js, src/layer-art.js, src/touch-up.js, src/stereo-twin.js, src/stereo-view.js, src/main.js, src/art-pack.js
---

# sythnvtby Player, and true stereo first

**Status:** mostly built. Phase 0 (true stereo in the web emulator, §2a) was done Oct 2 2026. The player
exists in two forms: the **web player** (`player.html`, `src/player.js`) and the **native SDL2 PC
player** (`native/player-sdl/`, with the C++ colour layer checked against the browser's), both
reading a **play pack** (`.vbcplay`, [play-pack-format.md](../reference/play-pack-format.md)) written
by the Project tool's File ▸ Export for player…. VR (§3d, OpenXR) is not started.

A separate, non-development **player** for games coloured with the sythnvtby tools: load your ROM
and a colour pack, play in colour or monochrome, in 2D or 3D (side-by-side), on a PC, and later in
a VR headset (HTC Vive through SteamVR). Before building it, the existing web emulator has to show
**both eyes faithfully, in monochrome and in colour**, because the player reuses that renderer.

## 1. Where 3D stands today (measured Oct 2 2026)

| | Left eye | Right eye |
|---|---|---|
| **Monochrome** | The core's picture | **Not shown.** The core outputs one eye; the View menu (2D / Side-by-side / Anaglyph) only changes the colour canvas |
| **Colour, tile paint** | Yes | Yes where the right eye draws the **same patterns** as the left — often not, see below |
| **Colour, layer art and touch-ups** | Yes | **No** in the cases checked (Mario's Tennis crowd: 0 px drawn right, ~69 600 left) |

### Root cause: games draw each eye with its own world

The VIP lets a world show on the left eye only (LON), the right only (RON), or both. Many games
draw a layer **twice**, in two neighbouring worlds — one per eye — each reading a **different part
of the BG map** that holds a stereo-shifted copy of the art. That is how they give a flat layer
depth inside it (the crowd's people at different depths), rather than one parallax offset (GP).

- **Mario's Tennis, crowd backdrop:** world 30 is left-only (map Y 352), world 31 right-only
  (map Y 432), same window, same GP. 32 of 52 captured frames. Only 12% of the right copy's
  tile patterns appear in the left copy.
- **Mario Clash:** 14 left/right world pairs across its captures; pattern overlap ranges from
  100% (same art, plain parallax) down to 1%.

Everything the tools paint is tied to what the author saw, which is the left eye:

- Groups list their worlds (`criteria.windowIds`): DonkeyKongJrBacklog is `[30]`, so on the right
  eye (world 31) the group is not on screen and its layer art and touch-up never draw.
- Tile paint is per pattern, so right-copy patterns that the left never shows stay unpainted
  (the grey fallback shows through on the right eye only).

The compositor itself is fine: it already renders each eye from that eye's draws with that eye's
parallax (`compositeColorFrame(…, { eye })`, `worldGeometry(…, eye)`).

## 2. Phase 0 — both eyes, faithfully, in the web emulator

### 0a. Stereo twins (a render-time rule, no pack changes)

`stereoTwin(windows, world)` in a new stereo-twin module under `src/`: the neighbouring world (±1) with the
other eye's flag (LON-only ↔ RON-only), the same mode, and the same window (GX, GP, GY, W, H). The
map delta between them (ΔMX, ΔMY, and BG map base) maps one copy onto the other.

- **Groups:** a group on the left world counts as on screen on the right eye when its twin is
  (`activeLayerArts`, `activeTouchUps`, group matching for tile paint).
- **Layer art and touch-ups on the right twin:** drawn from the **left picture**, sampled through
  the twin's geometry minus the map delta. The right eye then shows the same picture with the
  layer's parallax but without the game's inner depth (the crowd is flat). That is faithful in
  colour and position; an optional **Right eye** picture (painted separately) can restore the
  inner depth later.
- **Tile paint on right-only patterns:** a **stereo colour transfer** — for a right-twin pixel
  with no paint, take the colour of the left composite at the map-corresponding spot, searching a
  few pixels sideways for the same shade (the copies are the same art shifted by its depth).
  Cheap enough per frame for a few hundred tiles; off when the right eye is fully painted.
- **Authoring:** the Project tool and SpriteStudio gain an **Eye: Left / Right** view where
  missing (SpriteStudio has one) and a "Right eye differs" note on groups with a twin, so authors
  can check and, if they want, paint right-only patterns directly.

### 0b. Monochrome in 3D

Two options; the plan is to spike the first.

1. **The core's own stereo output.** Beetle VB has a `vb_3dmode` core option (anaglyph,
   side-by-side, …). Side-by-side gives a 768×224 frame with both eyes exactly as the VIP drew
   them. Needs: setting the option through EmulatorJS (and checking whether it applies without a
   restart); colour overlay alignment (the colour canvas is already 768 wide in side-by-side, and
   `mapCanvasBufferToVipPixel` already handles a side-by-side buffer); and **captures**, which
   assume a 384-wide screen (`src/screenshot-frame.js`): crop to the left eye on capture.
2. **Our own mono render** of the right eye from VIP state (the compositor's grey fallback for
   every draw). No core change, but only as faithful as the compositor (affine, HBias and
   sprite edge cases), so it is a fallback.

Then **Monochrome + 3D** and **Colour + 3D** both work, and the mono underlay can stay on in
side-by-side (its eyes now line up with the colour's).

### 0c. Checks

- Unit tests: twin detection (Mario's Tennis 30/31 and a non-twin), right-eye layer art through a
  twin, colour transfer on a shifted copy.
- e2e: Side-by-side shows layer art in both halves; mono side-by-side has two different halves.
- A per-eye check on real packs: right-eye pixels changed by layer art ≈ the left's.

## 2a. Phase 0 as built (Oct 2 2026)

- `src/stereo-twin.js`: `stereoTwins(windows)` pairs each right-only world with a left-only
  neighbour — index − 1, else + 1 (Mario's Tennis's title: left eye in world 28, right in 27) —
  when the mode, OVER/SCX/SCY, GY and height match. The window and source may differ
  across — Mario Clash crops each eye by moving GX and MX together — so the pair carries `shift`,
  the right-eye screen x of what the left eye shows at x − shift (placement, source and parallax of
  both worlds). Pairs more than 64 px apart are ignored. Found in Mario's Tennis (30/31, shift 12)
  and on about 14 Mario Clash pairs (shift 0 mostly).
- **Layer art** (`activeLayerArts`, `paintLayerArt`): on the right eye a group on the left world also
  covers its twin; the twin draws inside its own window, sampling the left world's map at x − shift.
- **Touch-ups** (`activeTouchUps`, `affineTouchUps`): the left placements on the left world, moved
  across by `shift` (scaled worlds: by the map offset between the two copies, the commonest
  difference of the cells both eyes read at the same pixel), unless the right copy places it
  itself. When the left eye is there to borrow from (the emulator, and `compositeColorFrameForEye`
  in the tools), a twin whose left world had a touch-up is instead taken **wholly** from the left
  composite: the right copy is drawn shifted for depth (the title's "TENNIS" by 8 px), so a pasted
  touch-up showed the letters twice.
- **Tile paint** (`compositeColorFrame`): a twin's draws match groups as the left world (tile
  colours, shade ramps, group overrides, affine sampling). Unpainted pixels then **borrow** from the
  left composite (`stereoSource`, filled by `wireColorLayer` from `getCompositePixelInfo()`): the
  left pixel within 8 px across of x − shift with the same shade, drawn by the left world and
  coloured (painted, or under layer art or a touch-up), whose neighbours along the row best match
  (block matching over ±3 px), so a run of pixels takes one offset and edges don't smear. Borrowed
  pixels are marked (`getCompositePixelInfo().art` = 2). On the captured frames this took right-eye twin layers from 65% unpainted to 19%
  (Mario's Tennis; left eye 17%) and from 37% to 13% (Mario Clash; left 14%).
- **Monochrome** (`src/stereo-view.js`, `applyCoreViewMode` in `src/main.js`): the View menu sets
  Beetle VB's `vb_3dmode` / `vb_anaglyph_preset` at runtime (it takes effect without a restart):
  2D → anaglyph with no colours (the left eye, as before), Side-by-side → side-by-side, Anaglyph →
  red & cyan (left eye under Palette). Captures in Side-by-side crop the left eye
  (`leftEyeRect`); in Anaglyph they have no screenshot.
- **Tools' Eye: Right** (`compositeColorFrameForEye`, used by `renderFrame` in
  `tools/shared/pack-session.js` and the Project tool's view): composites the left eye first when
  the frame has twins. SpriteStudio's group views count a twin's tiles as the group's on frames
  where the group is on the left world (`bgViewOnFrame`), its layer-art preview draws through the
  twin, and **Show unpainted** does not tint pixels coloured by layer art, a touch-up or the left eye.
- Not done: a right-eye picture for layer art (inner depth), and a "right eye differs" note in the
  tools.

## 3. The player

### 3a. What it is

- Load a ROM (never shipped) and a **play pack**; it checks the ROM matches the pack.
- Display: Monochrome / Colour, 2D / Side-by-side / Anaglyph, full screen, integer scaling.
- Gamepad and keyboard mapping, save states, battery saves, a settings screen. No capture, paint,
  debug panels or pack editing.
- The sythnvtby splash art on start.

### 3b. Play pack format (`.vbcplay`, a zip)

A `.vbpack` is a working file: it carries the ROM and every capture (frames, save states, RAM
dumps, screenshots — Mario's Tennis's has ~200 entries). The player needs only the colour:

| Entry | From |
|---|---|
| `play.json` | format version, title, author, version, **ROM SHA-1 and CRC32**, features the pack needs (layer art, touch-ups, stereo twins) |
| `color.vbcolor` | as now |
| `groups.json` | groups with paint, poses, layer art, touch-ups; authoring-only fields dropped (folders, notes, frame references) |
| `painter-v2-rules.json`, `overrides.json` | as now, when present |
| `cover.png` | optional splash / library art |

Changes to the existing system, all additive:

- The pack manifest gains the ROM's SHA-1 and CRC32 when a ROM is loaded or saved (today it has
  only `romFileName`).
- The Project tool gains **Export for player…** (writes `.vbcplay`); `.vbpack` is unchanged.
- The renderer is pulled out behind one entry point (`src/render/`: compositor, layer art,
  touch-ups, fade, stereo twins) so the emulator and the player share it.
- The web emulator can open a `.vbcplay` too (to see what players will see).

### 3c. Standalone PC app — native C++ (decided Oct 2 2026)

~~Tauri~~: dropped. A Switch build has no web engine, so the standalone player is native C++,
and PC, VR and Switch share one **portable core library** ([native/README.md](../../native/README.md)):

- `vbcolor_core` — no platform, window or emulator code. The `vbc::Emulator` interface (load a
  ROM, run a frame with a controller state, both eyes' picture, audio, the VIP's data for the
  colour layer, save RAM, save states), `vbc::VipFrame` (the same data as the browser's
  `VIPState`), stereo layout (2D / side-by-side / anaglyph). Next: the play-pack reader and the
  colour renderer (a port of `src/color-layer.js` and friends, checked pixel for pixel against
  the JS one on captured frames).
- `vbcolor_beetle` — Beetle VB statically linked behind `vbc::Emulator`. It uses the same pinned
  commit and VIP export patches as the browser build; `native/cmake/PatchBeetleNative.cmake`
  switches the patches' frame hand-off to a C callback. **Swapping cores** means another library
  implementing `vbc::Emulator`.
- Front ends: **SDL2 PC player** (`native/player-sdl`, done: window, keyboard and controller,
  audio, battery saves, save states, 2D/SBS/anaglyph, full screen); then **OpenXR**; then Switch.
  The Switch target is the cardboard Virtual Boy viewer (side-by-side in handheld), not the
  plastic stand, which has red lenses.

**Licence:** the Beetle VB core is GPL-2.0. A distributed app that bundles it must ship under
GPL-compatible terms with its source available. Worth deciding before the first public build.

### 3d. VR (HTC Vive, SteamVR)

In order of effort:

1. **Side-by-side into a VR desktop viewer** (SteamVR desktop / Virtual Desktop / Bigscreen 3D
   SBS mode): works as soon as 0b and 3a are done; no VR code.
2. **WebXR in the browser player** (Chrome with SteamVR as the OpenXR runtime): each eye's buffer
   goes to that eye on a virtual screen — true stereo, like the original hardware. WebView2 has no
   WebXR, so this starts in the browser.
3. **Native OpenXR in the Tauri app** (a Rust plugin drawing the two eye textures): the end goal
   for a standalone VR player.

## 4. Will this break anything?

| Change | Risk | Why / mitigation |
|---|---|---|
| Stereo twins (0a) | **Low** | Only the right eye changes, and the right eye is only composited in Side-by-side / Anaglyph. 2D output, captures and all painting are left-eye and unchanged. Packs are not modified; old packs gain right-eye colour. A false twin (two unrelated one-eye worlds with identical windows) would draw the left's paint on the right; the geometry match makes that unlikely, and tests on both packs guard it. |
| Colour transfer (0a) | **Low–medium** | Right eye only. May show colour fringes where the copies differ by more than a shift; it only fills pixels the right eye has no paint for, and it can be switched off. |
| Side-by-side cost | **Low** | Two composites per frame, as Side-by-side already does today; the transfer adds a little. |
| Core side-by-side mono (0b) | **Medium** | The emulator canvas becomes 768 wide: captures (crop to left eye), screenshot references, the pixel inspector (already handles it) and mono/colour canvas alignment need checking. Kept behind the View menu; 2D stays exactly as now. Spike first. |
| Play pack + manifest hash (3b) | **None** for existing files | `.vbpack` and `.vbcolor` are unchanged; new manifest fields are ignored by older tools. |
| Renderer extraction (3b) | **Low** | A move with the same functions; the unit and e2e suites cover the emulator, Project tool and SpriteStudio paths. |
| Overpaint redesign | — | Stereo twins belong in it: overpaint is in map space, so the twin's map delta applies directly. Do 0a first so the redesign starts from correct stereo. |

## 5. Order of work

1. ~~**0a** stereo twins for layer art / touch-ups / group matching, with tests.~~ Done.
2. ~~**0b spike**: core side-by-side mono; decide between 0b-1 and 0b-2.~~ Done: 0b-1 (the core).
3. ~~**0a** colour transfer for right-only patterns.~~ Done. (The Project tool already has Eye.)
4. ~~Manifest ROM hash; **Export for player**.~~ Done (Oct 2 2026): `romSha1`/`romCrc32`/`romSize`
   in the manifest, `src/play-pack.js`, File ▸ Export for player… —
   [play-pack-format.md](../reference/play-pack-format.md). The pack also records the game's
   normal brightness (fades need it and the player has no frames). Renderer extraction was not
   needed: the player imports the same modules as the emulator (`wireColorLayer`).
5. ~~Web player (`player.html`).~~ Done (Oct 2 2026): `src/player.js`, ROM check, Colour/Mono,
   2D/SBS/Anaglyph, pause, full screen, remembers the last game; saves via EmulatorJS.
6. ~~Tauri app.~~ Replaced by the native C++ player: `native/` — portable core library, Beetle
   adapter and SDL2 PC player (mono, 2D/SBS/anaglyph, saves) done Oct 2 2026.
7. ~~Native colour.~~ Done Oct 2 2026: play-pack reader (miniz, nlohmann/json, stb_image) and the
   colour layer (`vbc::Colorizer`, a port of `compositeColorFrame` with layer art, touch-ups,
   affine sampling, stereo twins and borrowing, shade ramps, fades) in `vbcolor_core`; the SDL2
   player draws it (`--pack`, drop a `.vbcplay`, F9). Parity test (`native/tests/parity`): all
   240 captured frames of the Mario's Tennis and Mario Clash projects, both eyes, identical to the
   browser. Not ported: position overrides, Painter v2 rules, old overlays (unused so far). The
   port also found that the web player passed fade scale 1 instead of 1.34, dimming paint to 75%;
   fixed in `src/player.js`.
8. OpenXR front end (each eye's picture on a virtual screen, one per eye), before any Switch
   port. A SteamVR desktop viewer showing the SBS window works meanwhile.
9. Switch (cardboard viewer, side-by-side) — needs our own core for a dev-kit build (GPL).
