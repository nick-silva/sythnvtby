---
status: current
last-reviewed: 2026-10-09
covers: tools/memory-analysis-inbrowser.js, src/game-states.js
---

# Game memory locations (RAM) for colorization

Addresses in a game's work RAM (WRAM) that tell you which **screen** the game is on.
Memory pools use them (`ramConditions`) so colors can apply only on the screens they
belong to — see [memory-analysis-tool-spec.md](memory-analysis-tool-spec.md) and
[art-pack-file-format.md](art-pack-file-format.md) §6.

**You rarely need to find these by hand any more.** Every captured frame saves its WRAM,
and *Analyze memory* in the Project tool finds, for each labelled screen, the bytes whose
value is unique to it. This page records what that turned up, so it is reusable and so
the numbers can be sanity-checked across packs.

**Address format:** VB CPU addresses in hex. WRAM starts at `0x05000000`; the analysis
reports offsets into it, shown here in both forms.

---

## Mario Clash

From `marioclash-annotated.vbpack`: 30 captured frames, analyzer `2.2-js`, run 2026-09-02.
Each row is the top candidate for that screen; every one scored **9/9 — a global
discriminator** (its value differs on every other captured screen).

| Screen (as labelled at capture) | Address | Offset | Value |
|---|---|---|---|
| Safety | `0x05000396` | `0x0396` | 0 |
| Splash | `0x050051BD` | `0x51BD` | 128 |
| Title | `0x050051F0` | `0x51F0` | 254 |
| Intro | `0x0500013F` | `0x013F` | 96 |
| GameMenu | `0x050051BE` | `0x51BE` | 28 |
| AutoPause | `0x050051BC` | `0x51BC` | 3 |
| Level01Intro | `0x05004001` | `0x4001` | 1 |
| Level01 | `0x05000186` | `0x0186` | 3 |
| GameoverYourScore | `0x05000131` | `0x0131` | 32 |
| TopScore | `0x05000131` | `0x0131` | 33 |

**Worth knowing:**

- **Discriminating is relative to what you captured.** A byte that separates these ten
  screens may not separate a screen you have not captured yet (another level, a second
  menu page). Re-run the analysis after capturing new screens.
- **`0x51BC`–`0x51BE`** pick out AutoPause, Splash and GameMenu, and **`0x0131`** tells the
  two score screens apart by value — both look like screen-state bytes rather than
  coincidences, which makes them good candidates to name once confirmed.
- **Level01 at `0x0186` = 3** probably encodes the level, not "in a level" — expect it to
  change on later levels.

## Mario's Tennis

From the project's own pack (`Mario's Tennis (Japan, USA).vbpack`, Oct 2026).

**Screens** (memory pools from *Analyze memory*):

| Screen | Address | Offset | Value |
|---|---|---|---|
| Safety | `0x05002285` | `0x2285` (8837) | 1 |
| AutoPause | `0x05002285` | `0x2285` (8837) | 3 |
| Intro | `0x0500202D` | `0x202D` (8237) | 0 |
| GameMenu | `0x05002036` | `0x2036` (8246) | 5 |
| InGame | `0x05000000` | `0x0000` | 48 |

**Which character you play** — a game state, not a screen (`groups.json` `gameStates`,
[memory-states.md](../design/memory-states.md)): offset **`0x2204` (8708)**, values
0 Mario · 1 Luigi · 2 Princess · 3 Yoshi · 4 Toad · 5 Koopa · 6 DKjr. Checked on all 229
classified frames. A first guess, `0x203A` (8250), matched during play but reads 0 when a
match starts, so the player went uncoloured on the first frames — check a candidate on the
frames *around* a screen change, not just in the middle of one.

---

## When the analysis is not enough

- **Savestate diffing:** save on one screen and again on another, then compare WRAM dumps
  (`ramdumps/*.wram.bin` in a pack) byte by byte.
- **Community knowledge:** VB reverse-engineering forums, TCRF, or other VB projects may
  document a game's WRAM layout.

## Links

- [memory-analysis-tool-spec.md](memory-analysis-tool-spec.md) — how the analysis scores bytes.
- [conditional-overrides-design.md](../design/conditional-overrides-design.md) — `ramConditions` shape.
- [group-override-design.md](../design/group-override-design.md) — groups gated by RAM.
