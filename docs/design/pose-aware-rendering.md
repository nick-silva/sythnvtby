---
status: proposed
last-reviewed: 2026-10-10
covers: src/color-layer.js, src/group-order.js, src/project-health.js, src/pixel-explain.js, tools/shared/pack-session.js, native/core/src/colorizer.cpp
---

# Pose-aware rendering: which group colours a shared tile

**On hold since Oct 9 2026**, after step 1: see [Step 1 result](#step-1-result-measured-oct-9-2026).

Backlog #16 (and #14, mirrored poses, if the measurements say so). Planned Oct 9 2026 against
*Mario's Tennis* (271 frames, 80 groups).

## What happens today

A tile pattern can belong to several groups. When two groups both claim a draw (its world, layer
and pattern) and both have paint for that pattern, **the group listed first colours it**
(`resolveGroupTileMatch` in `src/color-layer.js`, mirrored in `native/core/src/colorizer.cpp`).
Screen limits and game-state conditions (`src/screen-gate.js`) take a group out before that, so
only groups allowed on the frame compete. Check project lists the losers (`sharedTileWins` in
`src/group-order.js`), and *This pixel* says who won.

## What still goes wrong (Check project, Oct 9)

The case this item was written for — **Luigi-PlayingAs taking Mario-PlayingAs's colours on 27
frames — is fixed** by game states: each group now has a condition (*mario* / *luigi* holds), so
on any frame only one of them paints. What is left:

| Kind | Cases | Fix |
|---|---|---|
| **Two groups on screen together share patterns** | Mario-PlayingAs and DKjrOpp: 74 frames, 7 tiles (one colour for both); MarioOpp / DKjrOpp: 16 frames, 1 tile; Luigi-PlayingAs / DKjrOpp: 12 frames, 2 tiles | Only knowing which *pose* a draw is part of tells them apart. This is what pose-aware rendering is for. |
| **Groups on different screens share patterns** | IntroMario / Mario-PlayingAs: 12 tiles on 16 frames, each also alone elsewhere; Luigi-PlayingAs and Toad-PlayingAs / IntroMario (4 and 2 tiles) | A screen limit or a game state on IntroMario (the intro is its own screen) — what Check project already offers. No new rendering needed. |
| Text groups sharing letters | NORMALtext / HARDtext, MATCH-text / SINGLEStext, … | Usually the same colour on purpose; nothing to do unless a word must differ. |

So the remaining need is narrower than when this was ranked: **characters drawn at the same time
that reuse tiles** (feet, racket, ball shadow), a handful of tiles each but on many frames.

## Proposal: poses break ties

Keep "listed first wins" as the rule, and add one step before it, only for **contested draws** — a
draw whose pattern is painted by two or more groups that both claim it:

1. For each group with a contested pattern on this frame, **locate its poses** (`locatePose`:
   the anchor tile, then each tile at its offset; a pose is on the frame when all its tiles are).
2. A contested draw that is part of exactly one located pose goes to that pose's group, whatever
   the list order. Part of none, or of several groups' poses: the list order decides, as today.
3. Pose pictures already work this way (a whole-pose picture shows only where its pose is), so
   this extends the same idea to tile paint.

Cheap by construction: most draws are not contested; poses are located only for groups with a
contested pattern on the frame, and cached per frame. Both authoring tools and the emulator use
the compositor, so all three change together; the native player follows in `colorizer.cpp`.

### Mirrored poses (#14)

A character facing the other way draws its tiles in mirrored positions. `locatePose` only finds a
pose drawn the way it was captured (plus a whole-pose flip where `allowFlipMacro` is set). If many
contested draws are in mirrored poses, #14 (recognise a pose and its mirror) has to come first;
step 1 below measures this rather than guessing.

## Step 1 result (measured Oct 9 2026)

Every frame's left eye, after the Luigi-PlayingAs clean-up (IntroMario limited to the Intro
screen): **796 contested draws** (two or more allowed groups claim and paint a tile differently)
on 142 frames. Poses would change the winner of **32** (4%):

| Groups | Draws | In exactly one group's pose | Winner would change |
|---|---|---|---|
| Mario-PlayingAs / DKjrOpp | 120 on 74 frames | 60, 76 with mirrored poses | 0 — Mario's tiles, Mario already wins |
| DKjrOpp / Luigi-PlayingAs | 15 on 15 frames | 15 | 15 |
| LUIGI-text / MARIO-text / DonkeyKongJrText | 48 | 40 | 16 |
| DKjrOpp / Yoshi-PlayingAs | 1 | 1 | 1 |
| Text groups sharing letters | ~400 | none (no poses) | 0 |
| Mario-PlayingAs / IntroMario | 43 on 18 frames | none | 0 |

Mirrored poses add only draws Mario already wins, so #14 is not needed for this. **Decision: on
hold.** The cases worth fixing are list order, not poses: IntroMario ahead of Mario-PlayingAs
(IntroMario now paints only on the Intro, so the move cannot reach other screens) and
Luigi-PlayingAs ahead of DKjrOpp (the 15 draws are Luigi's own tiles). Revisit if a project has
characters on screen together whose shared tiles sit in both characters' poses.

## Steps (if resumed)

1. **Measure first (½ day).** A probe over the pack: for every contested draw on every frame, is it
   in exactly one group's located pose — as captured, mirrored, or neither? This says how much the
   proposal fixes, and whether #14 is needed. *Go on only if most contested draws resolve.*
2. **The tie-break in the compositor** (`src/color-layer.js`): per-frame pose claims for contested
   patterns, used by `resolveGroupTileMatch`; unit tests with two groups sharing a tile.
3. **Explain it:** *This pixel* says "coloured by DKjrOpp — this tile is part of its pose *Serve*";
   Check project stops listing pairs that poses tell apart, and says when one needs a pose
   captured to be told apart.
4. **Native parity:** the same rule in `colorizer.cpp`, checked with the parity tool on Mario's
   Tennis frames.
5. **Measure the cost** with `tests/e2e/s9-performance.mjs` (frame switch, strokes) and the
   emulator's frame time.

## Before this: quick wins in the Check project list

Worth doing now, no code: limit **IntroMario** to the intro screen (or give it a game state),
use **Let … win** for the one-way cases (Luigi-PlayingAs over IntroMario and DKjrOpp,
Toad-PlayingAs over IntroMario, DonkeyKongJrText over LUIGI-text), and **Cover the whole map**
for the backdrops that scroll past their pictures (Luigi-PlayingAs, DKjrCharacterSelect,
MarioSelected, Toad-PlayingAs, SplashGraphic).
