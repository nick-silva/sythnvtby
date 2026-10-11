# sythnvtby, native (C++)

The native side of the sythnvtby player: a **portable core library**, an **emulator adapter**
(Beetle VB for now), and front ends — the **SDL2 PC player** first, then OpenXR (VR) and, one
day, Switch. Design: [docs/design/vb-color-player.md](../docs/design/vb-color-player.md).

| Folder | Target | What it is |
|---|---|---|
| `core/` | `vbcolor_core` | Portable library: no platform, window or emulator code. The `Emulator` interface, the VIP frame data, stereo layout (2D / side-by-side / anaglyph), the **play-pack reader** (`play_pack.hpp`) and the **colour layer** (`colorizer.hpp`), a port of the browser's `compositeColorFrame` checked pixel for pixel against it. |
| `beetle/` | `vbcolor_beetle` | `create_beetle_emulator()`: Beetle VB, statically linked, behind `vbc::Emulator`. |
| `cmake/BeetleVB.cmake` | `beetle_vb` | Fetches Beetle at the commit our patches target and applies `../patches` (the same VIP export patches the browser build uses), switched to a C callback (`PatchBeetleNative.cmake`). |
| `player-sdl/` | `vbcolor-player` | The PC player: window, keyboard and controller, audio, battery saves, save states, and the colour from a play pack. |
| `tests/` | `vbcolor-tests`, `vbcolor-parity` | Library tests, a Beetle smoke test on a real ROM, and the colour parity test against the browser. |

## Swapping the emulator core

Front ends only see `vbc::Emulator` (`core/include/vbcolor/emulator.hpp`): load a ROM, run a
frame with a controller state, the picture (both eyes), audio, the VIP's data for the colour
layer, save RAM and save states. Another core is another library implementing it, plus one line
where the front end creates it.

## Build (Windows)

Needs CMake and Visual Studio 2022 (Build Tools are enough). SDL2 and Beetle are downloaded on
the first configure.

```
cmake -S native -B native/build -G "Visual Studio 17 2022" -A x64
cmake --build native/build --config Release
native\build\player-sdl\Release\vbcolor-player.exe "path\to\game.vb" --pack "path\to\game.vbcplay"
```

A play pack comes from the Project tool's **File ▸ Export for player…**. Without one the game plays
in monochrome.

Tests (`VBC_TEST_ROM` adds the Beetle smoke test):

```
set VBC_TEST_ROM=path\to\game.vb
native\build\tests\Release\vbcolor-tests.exe
```

## Colour parity with the browser

The C++ colour layer is a port of `src/color-layer.js` and the modules it draws through. To check
it, render a project's captured frames with both and compare every pixel of both eyes:

```
node native/tests/parity/make-golden.mjs "path\to\project.vbpack" golden
native\build\tests\Release\vbcolor-parity.exe golden
```

`make-golden.mjs` writes the project's play pack and, per captured frame, the frame, its RAM dump
when it has one (`<stem>.wram.bin`, for groups limited to some screens) and the JS compositor's two
eyes (as the emulator calls it). `vbcolor-parity` renders the same frames from the play pack and
prints the frames and pixels that differ (exit code 1 if any). `npm test` runs this on the synthetic fixture pack
(`tests/fixtures/fixture-pack.mjs`) whenever `native/build/tests/Release/vbcolor-parity.exe` exists
(`src/native-parity.test.js`). On Oct 2 2026: Mario's Tennis 52
frames, Mario Clash 158 + 30 frames, 0 pixels different. An optional third argument limits one
group in the exported copy (`"KoopaBackground=except:pool-gamemenu"`) to check screen gating: on
Oct 5 2026, Mario's Tennis 142 frames, 0 pixels different, the 3 GameMenu frames changed.
`when:<group name>=<offset>:<value>[:not]` gives that group a condition on a one-byte game state
(src/game-states.js): on Oct 8 2026, Mario's Tennis 236 frames with `when:Mario-PlayingAs=0:48`
and with `:not` — 408 of the 472 eye images changed between the two — 0 pixels different.
`poses:<group name>` gives that group a pose picture (`poseOverpaints`) with a solid colour for
every set of its patterns a frame shows; `posegroups:<group name>` makes them separate whole-pose
groups instead (older packs). On Oct 7 2026, Mario's Tennis 186 frames with
`poses:Luigi-PlayingAs`, `posegroups:Luigi-PlayingAs` and `poses:Mario-PlayingAs`, 0 pixels
different (the Luigi pose pictures change 117 frames). `poses:` also ties each picture whose
patterns match a saved pose to it (`poseId`, as SpriteStudio does on open), so the saved-pose rule
is compared too — 62 of Mario's 77 test pictures on that pack.

Not ported yet: position overrides, Painter v2 rules and old screen-pinned overlays (no pack made
so far uses them; the player says so when a pack does).

## Player controls

| Virtual Boy | Keyboard | Controller |
|---|---|---|
| Left D-pad | Arrows | D-pad / left stick |
| Right D-pad | I J K L | Right stick |
| A / B | X / Z | A / B (or X) |
| L / R | Q / W | Shoulders or triggers |
| Start / Select | Enter / Shift | Start / Back |

| Key | Does |
|---|---|
| F9 | Colour / monochrome (with a play pack) |
| V | View: 2D → Side-by-side → Anaglyph |
| F11, Alt+Enter | Full screen (Esc leaves it) |
| P | Pause |
| F5 / F7 | Save / load state |
| Ctrl+R | Reset |
| Esc | Quit |

Or drop a ROM and a play pack (`.vbcplay`) on the window. A ROM the pack was not made for gets a
warning; the colours may land on the wrong tiles. Battery saves and save states are kept per game in
`%APPDATA%\VBColor\Player\`.
