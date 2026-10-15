---
status: current
last-reviewed: 2026-10-14
covers: src/shared-tile-owner.js, src/color-layer.js, src/group-order.js, src/project-health.js, src/pixel-explain.js, src/affine-world.js, native/core/src/colorizer.cpp
---

# Pose-aware rendering: which group colours a shared tile

**Built Oct 14 2026, as a neighbour rule rather than poses:** see
[What was built: neighbours decide](#what-was-built-neighbours-decide-oct-14-2026). Poses (the
proposal below) went on hold on Oct 9 after step 1 measured that they would change only 4% of
contested draws; the neighbour rule settles 94% on the same game.

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

## Steps (if resumed; superseded by the neighbour rule)

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

## What was built: neighbours decide (Oct 14 2026)

`src/shared-tile-owner.js`, used by `compositeColorFrame` and mirrored line for line in
`native/core/src/colorizer.cpp` (`SharedTileOwners`). Instead of locating whole poses, a contested
draw looks at the draws **beside it**:

1. Same world and layer, 8 px left, right, up, down. On a scaled (affine) layer, the cells beside it
   in the layer's map (`affineMapReader`), since the core's records of a zoomed tile are not on an
   8 px grid. A neighbour votes for a contesting group when that group claims it and no other
   contesting group does.
2. Contested draws that touch settle together, in up to 8 rounds that each read only the last
   round's results: a run of shared tiles is settled from its ends, and the answer does not depend
   on which draw is asked first (the native player has to match it exactly). A cluster of more than
   256 is left to the list order (a whole shared layer).
3. No side votes: the corners vote the same way.
4. One group voted: it colours the draw. None, or two that disagree: the list order, as before.

Nothing is stored in the pack, so every existing pack gets it. The tools agree: *This pixel* says
"wins because its own tiles are next to it" and offers no reorder there; `sharedTileWins` (the
**behind …** label, *Shared tiles*, Check project) leaves out what the neighbours settle.

**Measured** with a read-only probe over every captured frame (left eye):

| Pack | Contested draws | Settled by neighbours | Winner changed |
|---|---|---|---|
| Mario's Tennis (489 frames) | 1,553 | 1,462 | 665 (150 frames change on screen) |
| Mario Clash (158 frames) | 14,031 | 14,031 | 2,964 |

In Mario's Tennis the changes are the far player's corner tile taking the near player's colours
(Mario-PlayingAs, Yoshi-PlayingAs, LaikutoScore over DKjrOpp / MarioOpp), Toad-PlayingAs and
Princess-PlayingAs over DKjrOpp, and words sharing letters (HARD / NORMAL / EASY, MATCH / SINGLES).
What stays with the order: words both groups have whole (MatchText / SetMatch-Text), and
KoopaBackground / LuigiCharacterSelect. In Mario Clash: the lower-right pipe takes its own group's
paint instead of the upper one's, and a small platform's top its own colour.

**Cost:** lazy, so a frame with nothing contested pays nothing. Mario's Tennis composite, both eyes:
4.5 → 5.1 ms per frame in Node. **Parity:** Mario's Tennis 489 frames, 0 pixels different; Mario
Clash 158 frames, 228 right-eye pixels different on 114 frames, the same with the rule switched off
in both (a gap from before, not this rule).
