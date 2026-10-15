---
status: proposed
last-reviewed: 2026-10-14
covers: native/beetle/beetle_emulator.cpp, native/core/src/play_pack.cpp, native/core/include/vbcolor/rom_identity.hpp, src/play-pack.js, src/rom-identity.js
---

# A sythnvtby libretro core, and colour packs found by ROM

Backlog #19, planned Oct 14 2026. This doc covers what the core is, what players see in RetroArch,
how a game finds its colour pack, and how packs get published. It replaces the "original plan"
notes under *Libretro compatibility* in [priorities-and-next.md](../planning/priorities-and-next.md#libretro-compatibility-backlogged-oct-10-2026).

## In short

- **Yes, this makes sythnvtby playable in RetroArch,** and in every other libretro frontend
  (Lakka, the Steam Deck through RetroDECK or EmuDeck, Android, and so on), with their shaders,
  rewind, save states and controller mapping.
- **The core is a wrapper:** it runs our patched Beetle VB, colours each eye with the native colour
  layer (`native/core`, already checked pixel for pixel against the browser), and hands RetroArch
  the coloured picture. Authoring stays in the browser.
- **Packs are found by the ROM's SHA-1,** which play packs already record (`play.json`: SHA-1,
  CRC32 and size), so the file's name doesn't matter.
- **Packs can be published on GitHub,** in a packs repo with an index keyed by SHA-1. The browser
  player can fetch from it directly. RetroArch cores have no download API and shouldn't open
  network connections themselves, so RetroArch players get packs another way (see
  [Getting packs into RetroArch](#getting-packs-into-retroarch)).

## What we start from

| Piece | State | Where |
|---|---|---|
| Beetle VB with the VIP draw-list export | done, patched | `patches/`, `native/beetle` |
| Driving Beetle through `retro_*` calls | done: the SDL player is effectively a small libretro frontend | `native/beetle/beetle_emulator.cpp` |
| The colour layer in C++ | done, with parity against the browser in `npm test` | `native/core` |
| Play packs: colour only, no ROM, ROM SHA-1/CRC32/size recorded | done (Oct 2) | `src/play-pack.js`, `native/core/src/play_pack.cpp` |
| ROM identity (SHA-1, CRC32) in C++ | done | `native/core/include/vbcolor/rom_identity.hpp` |
| One project model for every app (C1) | done (Oct 10) | [refactor-plan.md](../planning/refactor-plan.md) |
| Licence | GPL-3.0-or-later, compatible with Beetle (GPL-2.0+) and RetroArch (GPL-3.0) | `LICENSE` |

The prerequisites the old plan waited on (the licence and C1) are done. C2 (the staged
compositor mirrored in C++) would help but doesn't block this.

## What the player sees in RetroArch

### Installing the core

There are two routes, depending on how far distribution has got.

**Early: our own builds (phase 2).** Each release on GitHub has one zip per platform holding
`sythnvtby_libretro.dll` / `.so` / `.dylib` and `sythnvtby_libretro.info`.

1. Download the zip for your platform and put it in RetroArch's *Downloads* folder.
2. In RetroArch: **Main Menu ▸ Load Core ▸ Install or Restore a Core** ("Install or restore a core
   from the 'Downloads' directory") and pick the zip. RetroArch copies the core into its cores
   folder. On desktop you can also copy the two files into `cores/` and `info/` by hand.
3. Optional: **Online Updater ▸ Update Core Info Files** doesn't know about us yet, which is why
   the zip carries its own `.info`. Without it the core still loads, but with a bare filename
   instead of "Nintendo - Virtual Boy (sythnvtby)".

This works on Windows, Linux, macOS and sideloaded Android APKs. It does **not** work on the
Android Play Store build, iOS or consoles, which only load cores from the libretro buildbot.

**Later: the official buildbot (phase 5).** Once the core is in libretro's build system, players
use **Online Updater ▸ Core Downloader ▸ Nintendo - Virtual Boy (sythnvtby)**, on every platform
RetroArch supports.

### Loading a game

1. **Load Content** ▸ pick the `.vb` file ▸ choose **Nintendo - Virtual Boy (sythnvtby)** when
   asked. Alternatively, scan the ROM folder into a playlist and set the Virtual Boy playlist's
   **Default Core** to sythnvtby. RetroArch's database already recognises Virtual Boy ROMs by CRC.
2. The core hashes the ROM and looks for a pack (next section).
   - **Pack found:** the game starts in colour, with an on-screen note: *"Colour: Mario's Tennis
     by <author>, v3"*.
   - **No pack:** the game plays in the original red, with: *"No colour pack for this game —
     see sythnvtby packs"*. It never fails to load because a pack is missing.
   - **Wrong pack:** a pack named after the game but made for another ROM (a different dump or
     region) is skipped, with a note saying so.
3. **Quick Menu ▸ Core Options** has:
   - **Colour:** on / off (off is plain Beetle).
   - **3D:** 2D (left eye) / side-by-side / anaglyph. Each eye is coloured before the two are
     combined.
   - **Show the original under the colour:** for unpainted holes, the same as Monochrome + Color
     in the browser.
   - Beetle's own options carry over (palette for mono, and so on).

Save states, rewind and netplay just work: colour is worked out from the live VIP state every
frame, so there is no colour state to save.

## Finding a pack

The core gets the content path and data from `retro_load_game`, and RetroArch's system folder
from `RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY`. It works out the ROM's SHA-1 (`sha1_hex`, already
in `native/core`) and looks in this order, using the first pack whose `play.json` matches the ROM
(`same_rom`):

1. **Beside the game:** `<rom folder>/<rom name>.vbcplay`. Easy to explain, and works on devices
   where the system folder is hard to reach.
2. **The packs folder:** `<system>/sythnvtby/packs/*.vbcplay`. Any filename, matched by SHA-1. The
   core keeps `<system>/sythnvtby/packs/index.json` (SHA-1 → file), rebuilt when the folder changes,
   so it doesn't open every pack on every launch.

Of several matches, the newest pack `version` wins. The one in use is shown under Core Options as
**Pack**, with an entry for "none (original red)".

## Publishing colour packs on GitHub

### A packs repo

The repo is a public `sythnvtby-packs`, separate from the code (packs are content; they change on
a different rhythm, and some people will want the code without them):

```
packs/
  marios-tennis-usa/
    marios-tennis-usa-v3.vbcplay
    cover.png
    README.md            title, author, what's painted, screenshots
index.json               generated: one entry per pack
```

`index.json` is keyed by ROM SHA-1 and generated by CI from the packs' own `play.json`, so it never
disagrees with them:

```json
{
  "format": 1,
  "packs": {
    "<rom sha1>": [
      {
        "title": "Mario's Tennis",
        "rom": { "crc32": "…", "size": 1048576, "noIntro": "Mario's Tennis (Japan, USA)" },
        "author": "…",
        "version": 3,
        "file": "packs/marios-tennis-usa/marios-tennis-usa-v3.vbcplay",
        "sha256": "…",
        "bytes": 2100000
      }
    ]
  }
}
```

The same CI check refuses a pack that contains ROM bytes or authoring files. A play pack shouldn't
have any (`src/play-pack.js` writes only colour data), but the check makes that a rule rather than
a habit.

### Getting packs into the browser player

The browser player already hashes the ROM a player opens (`src/player.js`). Add a **Find a colour
pack** step: fetch `index.json` and the matching pack from the packs repo's GitHub Pages site (or
`raw.githubusercontent.com`), check the pack's SHA-256 against the index, and cache it in the
browser. This needs no install at all, so it's the easiest way in for most people. Release-asset
download URLs redirect to another host and may not allow a cross-site fetch, so packs are served
from Pages or raw files, not Releases.

### Getting packs into RetroArch

The core itself won't download anything. RetroArch gives cores no network API, a core opening
connections would be unusual and unwelcome on the buildbot, and consoles and iOS sandbox it anyway.
Options, cheapest first:

1. **Manual:** download the `.vbcplay` from the packs site (it says which ROM it fits, including
   the No-Intro name) and drop it beside the game or in `system/sythnvtby/packs/`. The
   "no colour pack" note points to the site.
2. **A packs zip:** each packs release also publishes `sythnvtby-packs.zip` (every pack, laid out
   as `sythnvtby/packs/…`), extracted into RetroArch's system folder. The core picks the right one
   by SHA-1, so one download covers every game.
3. **RetroArch's Core System Files Downloader** (Online Updater ▸ "Download auxiliary system files
   required for correct/optimal core operation") serves per-core zips from libretro's buildbot.
   Getting `sythnvtby-packs.zip` listed there would make packs a menu click on every platform.
   This only becomes possible once the core is official (phase 5), and it's libretro's call:
   **ask them**, since these are fan-made art for commercial games.
4. **Not recommended:** an opt-in "check online" core option on desktop builds. It works, but it
   puts networking in the core, and is likely to keep it off the buildbot.

### What a pack may contain

Packs are colour data: tile colours per pattern hash, painted pictures, rules. They contain no ROM
and no tile graphics. The painted pictures are traced over the game's art, though, which puts
packs in the same place as HD texture packs for other emulators: widely shared, but derived from
commercial games. The packs repo should say so plainly, take packs only from their authors, and
remove one on request.

## Building the core

- **New target** `native/libretro/` → `sythnvtby_libretro` (shared library), built with CMake
  alongside the SDL player.
- **Symbol clash:** our core exports `retro_*`, and so does the Beetle we link in. Build Beetle
  with its `retro_*` symbols renamed (a prefix through a generated header of `#define retro_run
  beetle_retro_run` and so on), and keep `BeetleEmulator` calling the prefixed names. The SDL
  player keeps working unchanged.
- **`retro_run`:** read input, run Beetle one frame, take the exported draw list and VIP state,
  colour each eye (`vbcolor_core`), lay the eyes out for the 3D option, then send the frame
  (XRGB8888) to `video_cb`. Pass audio through untouched.
- **Memory:** game-state conditions read WRAM directly from Beetle (`RETRO_MEMORY_SYSTEM_RAM`), as
  the SDL player does.
- **Speed:** measure colouring per frame on a Steam Deck and a mid-range Android phone before
  promising handhelds. The budget is 20 ms a frame at 50 Hz, Beetle included.
- **CI:** a GitHub Actions matrix (Windows, Linux x64, macOS universal, Android arm64-v8a) builds
  and zips each platform. It runs a headless smoke test that loads the fixture pack's frames
  through the core and compares them against the parity golden.

## Phases

| Phase | What | Size | Done when |
|---|---|---|---|
| 1 | **Core on Windows:** `native/libretro`, symbol prefix, `retro_run` colouring, core options, `.info` file | M | Mario's Tennis plays in colour in desktop RetroArch, matching the browser on the parity frames |
| 2 | **Pack finding** (beside the game, packs folder + index, OSD notes, "Pack" option); **our own releases** for Windows / Linux / macOS / Android via CI | M | A fresh RetroArch install plays a coloured game following only the README's steps |
| 3 | **Packs repo:** `sythnvtby-packs`, generated `index.json`, CI checks (no ROM bytes, matching hashes), Pages site, packs zip | S–M | Mario's Tennis's pack is published and the zip works in RetroArch |
| 4 | **Browser player finds packs:** fetch by SHA-1 from the packs site, verify, cache | S | Opening a known ROM in the player colours it with no file picked |
| 5 | **Upstream, once many packs are published:** offer the VIP export patches to beetle-vb-libretro as an off-by-default hook, then propose the core for libretro's buildbot, and ask about packs in the Core System Files Downloader | L, mostly waiting | The core appears in the Online Updater |

Phases 1 and 3 can run in parallel. Phase 4 doesn't need the core at all and could ship first.

**Decided Oct 14:** a few colour packs are published (phases 3–4) before the core is.

**Platform order (proposed Oct 14):** Windows first, then Android (arm64), Linux x64 (Steam Deck),
and Linux arm64 (Raspberry Pi 4/5 and the Linux handhelds: ArkOS, ROCKNIX, muOS, Batocera), which
are one CI build each. After those come macOS, then 32-bit ARM (Pi 3 and older handhelds) once speed is
measured there. iOS and consoles need the official buildbot (phase 5).

**Decided Oct 14: fork first, upstream later.** Phases 1–2 build on our own patched Beetle and
ship our own releases. The pull request to beetle-vb-libretro (phase 5) waits until **many colour
packs** are published, so the patches arrive with a reason to take them. Until then the patches
stay in `patches/`, reapplied when Beetle changes.

## Questions to decide

1. **Which games' packs go first, and under what credit?**
2. **Authoring in RetroArch?** Captures and RAM dumps from inside RetroArch (backlog #19 item 5).
   Recommended: no; authoring stays in the browser.
