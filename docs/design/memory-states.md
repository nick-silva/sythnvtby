---
status: partial
last-reviewed: 2026-10-10
covers: src/game-states.js, src/memory-questions.js, src/memory-recorder.js, src/memory-panel.js, src/project-storage.js, src/sub-state-learn.js, src/screen-gate.js, src/main.js, tools/painter.js, tools/painter/, tools/painter/game-states-panel.js, tools/painter/storage-panel.js, native/core/src/play_pack.cpp
---

# Memory states: telling game states apart, on purpose

A plan for a deeper memory analysis tool: **questions** you ask the game's memory ("who is the
player, Luigi or Mario?"), answered from **memory recordings** made while playing, checked **live
in the emulator**, and saved as named **game states** that a group's paint can depend on. Plus the
storage side: recordings are cheap, but they pile up, so the project shows what it holds and lets
you decide what to keep.

**Built Oct 8 2026** (steps 1–6 of §7, with the changes below): game states and group conditions
in every reader including the native player (`src/game-states.js`; parity checked on Mario's Tennis
with a condition that changes 408 of 472 eye images: 0 pixels different); questions and recordings
(`src/memory-questions.js`) in **Project ▸ Game states…**; **Record** and the live **Now** in the
emulator's Memory panel (`src/memory-recorder.js`, `src/memory-panel.js`); **File ▸ Project
storage…** (`src/project-storage.js`); Check project's *Tell them apart…* and unrecognised frames.

Changed from this plan while building it:
- **The memory tool lives in the Project tool** (Project ▸ Game states…), not in
  `tools/memory-analysis.html`: that page opens its own copy of the pack and could only hand results
  back as a download. The old page stays for the per-screen analysis.
- **No summaries yet** (§6.3). Measured on Mario's Tennis memory: 10 samples taken far apart make
  a 14 KB recording (delta-coded, compressed; one dump alone is 5.5 KB), and samples half a second
  apart differ less. A question with 20 recordings a side is a few hundred KB — more than a summary
  (about 72 KB a side), but small next to captures (about 200 KB each), so summaries were left for
  when a project needs them. A question's recordings can be deleted in Project storage.
- Not built yet: re-learning a screen from recordings (§4.4), the best *pair* of bytes when no single
  byte fits (§4.3), archiving or thinning recordings, and asking for more variety by session beyond
  the "enough" rule.

## 1. Where we are, and why this is needed

- **Analyze memory** (File menu; `tools/memory-analysis-inbrowser.js`) learns one byte per *screen*
  (Intro, GameMenu, InGame…) from the screen names typed at capture. Groups can be limited to
  screens (`group.screens`, `src/screen-gate.js`). It is cheap and works for whole screens.
- **Screens are too coarse** for paint that depends on a state *within* a screen: who is playing,
  which court, which menu item is picked. Every Mario's Tennis match frame is just "InGame".
- **Screen recipes are weak when learned from few frames.** Mario's Tennis's InGame recipe (one
  byte) recognises 38 of the 60 frames captured during matches.
- **Oct 8: a quick learner** (`src/sub-state-learn.js`, *Only while it's on screen*) tries to tell a
  group's frames from the rest of its screen using the frames already captured. It works where a
  state exists and there are enough frames, and says plainly when it can't. On Mario's Tennis it
  found nothing for any pair Check project raised, for two reasons:
  - **Too few, too similar frames.** Positions, scores, the ball and animation frames differ
    between any two small sets of frames, so a comparison of a handful of frames turns up hundreds
    of bytes that only differ by chance (150–1,200 "equally good" bytes for the pairs that split).
  - **The wrong question.** Frames sorted by *what is on screen* (Luigi in view, Mario not) are not
    a game state — in a Luigi vs Mario match the memory is the same whichever is in view. The
    question has to be about the game ("who is the player?"), with the memory sorted by that.
- **Many samples per side fix the noise by themselves.** A byte has to hold one value on *every*
  sample of a side: with samples of "Luigi is the player" from several matches, every position,
  score and animation byte varies within the side and drops out, and only bytes that really follow
  the state survive. So the tool's job is to make collecting many labelled samples cheap, and to
  show the list of surviving bytes shrinking as they come in.

**This is expensive for the person doing it** (a few play sessions per question), so it is for the
cases where colour clearly depends on a state — typically a character's colours (Mario vs Luigi as
the player, Toad vs Princess), a level's palette, a selected menu item. Everything else should
never need it.

## 2. When memory analysis is used during a project

| When | What the person wants | What they do | Cost |
|---|---|---|---|
| **Setting up** — after the first capture session | The tools to know which screen a frame is | Project ▸ Analyze memory (exists) | Seconds, once |
| **Paint is wrong in one state of a screen** — Check project or This pixel shows a group colouring frames it shouldn't, and the difference is a state | A condition on that group | Open or start a **question** (§4), record, check live, attach | A few play sessions; only for groups that clearly need it |
| **A screen recipe misses frames** — Check project: "22 frames no screen recognises" | A recipe that recognises every frame of its screen | Re-learn the screen from recordings (§4.4) | One play session |
| **Before sharing** | To know every screen and game state switches when it should | Play through with the **live panel** (§5.1) open | One play-through |

The quick learner (*Only while it's on screen*) stays as the shortcut for easy cases: a state that
a few existing captures already separate cleanly.

## 3. Concepts and data

### 3.1 One idea: a game state is a named memory condition

A **game state** is one or more bytes of game memory with expected values, and a name you give it
(and hope is right — the live panel is how you find out). Some game states are **screens**: the
coarse, one-per-frame states Analyze memory finds, which also organise the group tree and label
frames. The rest are plain game states ("Luigi is the player"). Both can be conditions on a group.

The stored data keeps the two apart, so nothing existing changes:

- **Screens stay where they are**: `gameStatePools` (each pool a screen, its variants' memory
  recipes), and `group.screens` (`only` / `except` a list of screens) keeps meaning what it means
  today. Every pack written so far opens unchanged; nothing in it is rewritten.
- **Other game states are new**, a top-level list in groups.json:

```jsonc
"gameStates": [
  {
    "id": "luigi-is-player",
    "name": "Luigi is the player",
    "conditions": [{ "offset": 8212, "value": 2 }],   // all must hold
    "source": "learned",            // or "manual"
    "question": "q-who-is-player",  // the question that produced it, if any
    "checkedLive": "2026-10-09T14:02:00Z" // last time it was confirmed in the emulator, if ever
  }
]
```

- **Not tied to a screen.** "Luigi is the player" holds across InGame, InGameLvM and the other
  match screens; a game state that required a weak screen recipe would inherit its misses.
- **Conditions are AND.** One byte is the normal case; a second byte can narrow it (§4.3).

### 3.2 Group conditions

```jsonc
// a group
"conditions": [
  { "state": "luigi-is-player", "is": true },
  { "state": "game-paused", "is": false }
]
```

- The group's paint (tile colours, shade ramp, overpaint, pose pictures) applies only while its
  screens setting allows it **and every** condition holds. `is: false` means "while this game state
  does *not* hold" — the natural way to say most fixes ("hide Mario-PlayingAs's paint while Luigi is
  the player").
- **Unknown memory shows the paint** (no dump, or a tool rendering without memory), as screen
  limits do: hiding paint because a dump is missing would look like lost work.
- **A condition naming a game state that no longer exists is ignored**, and Check project lists it.
- Every reader follows it: the composite (`src/color-layer.js`, through the same gate as
  `groupsForScreen`), This pixel and Check project (as reasons), SpriteStudio (a note, as for
  screens), the web player and the native player (`native/core/src/play_pack.cpp`), and the parity
  tool.

### 3.3 In the Project tool: one panel

The group details get one **Paint shows when…** section, replacing *Paint shows on*. It lists the
group's rules, of two kinds, all of which must allow the paint:

- *Screen is one of* InGame, InGameLvM · *Screen is not* GameMenu — the existing screens setting.
- *Luigi is the player* — **is** / **is not** — a condition.

**Add a rule** offers both (a screen setting, if the group has none, and any game state). Each rule
says whether it holds on this frame, and the section ends with what they do together: *This frame:
shown. Its tiles are on 40 captured frames: paint shows on 31, hidden on 9.*

**Filed under** — the group's pool / variant (`statePoolId`, `stateVariantId`) only says where the
group sits in the group tree; it never gated paint, but sits close to the screen settings and reads
like one. It is labelled *Filed under* in the details, away from *Paint shows when…*.

### 3.4 Question (an investigation)

```jsonc
// manifest.json
"memoryQuestions": [
  {
    "id": "q-who-is-player",
    "name": "Who is the player?",
    "sides": [
      { "id": "luigi", "name": "Luigi is the player" },
      { "id": "mario", "name": "Mario is the player" }
    ],
    "createdAt": "2026-10-09T13:10:00Z",
    "status": "collecting",          // "collecting" | "saved" (its game states exist) | "closed"
    "summary": null                  // §6.3, when the recordings are thinned out
  }
]
```

Two or more sides. Each side becomes a game state when the question is saved. A side can be "the
rest" ("Mario is the player" may really be "anyone but Luigi"); that only changes what is learned
for it (§4.3).

### 3.5 Memory recording

Collecting for analysis is its own kind of collection, separate from capturing frames:

- **Capture** (as today) saves a *frame* for painting: picture data, screenshot, save state and
  memory — about 200 KB each in Mario's Tennis.
- **Record** saves *memory only*, for a question's side: a few seconds of memory samples (the
  length is adjustable; default 5 s), or continuously until stopped.

```jsonc
// manifest.json
"memoryRecordings": [
  { "id": "r-muyv6x", "question": "q-who-is-player", "side": "luigi",
    "startedAt": "2026-10-09T13:22:41Z", "seconds": 5, "samples": 10,
    "session": "p-muyv5a", "file": "memoryrecordings/r-muyv6x.bin" }
]
```

- **The unit is a recording**, labelled with one side. That is what gets fixed when a label was
  wrong ("I pressed Luigi late"), and what is listed, thinned or archived in the storage window.
- **Variety beats rate.** Samples a tenth of a second apart are nearly identical and add little;
  the default is 2 samples a second, and a sample identical to the one before is skipped. The
  analysis counts *recordings and sessions*, not samples, when deciding it has enough.
- **One file per recording, delta-coded.** The first sample is stored whole and each later one as
  its difference from the one before (mostly zeros), so a 5-second recording is about 10–15 KB; a
  memory dump alone is 5 KB compressed. (Compressing the plain samples back to back helps less —
  24 KB against 14 KB for 10 samples of Mario's Tennis: at 64 KiB each, a sample is further back
  than the compressor looks.)
- **Sessions** are one run of the emulator: the tool asks for variety ("all of Luigi's recordings
  come from one match — play another").
- **Captures can count too:** a captured frame can be added to a side; it points at the frame's
  memory dump instead of copying it.
- Recordings never go into the play pack.

### 3.6 Moving from the interim format (Oct 8, commit be778c4)

The quick learner stores sub-states inside a screen (`gameStatePools[].subStates`) and groups name
them in `screens.pools` as `"pool::sub"`. On open, both tools convert that: each becomes a game
state whose conditions are its screen's recipe plus its own byte, and each group's entry becomes a
condition (`only` → `is: true`, `except` → `is: false`). Nothing else is rewritten.

## 4. The question workflow

1. **Ask.** In the memory tool (§5.2): *New question*, name it, name the sides. Or from a group
   (*Paint shows when* ▸ *Tell states apart…*), which pre-fills the sides from Check project's pair.
2. **Record** (§5.1) — mostly by playing, labelling as you go; also by adding existing captures.
3. **Analyse** (§4.3), live as recordings arrive: how many bytes still fit, and what would help.
4. **Check it live** (§5.1): play with the live panel on; when it is wrong, record for the right
   side right there.
5. **Save**: each side becomes a game state (the chosen bytes), the question becomes *saved*, and
   the tool offers what to keep of the recordings (§6.3).
6. **Attach**: in the group's details, *Paint shows when…* ▸ *Add a rule* (game state, is / is not).
   Check project then confirms the shared-tile problem is gone.

### 4.1 What "enough" looks like

The analysis panel shows, per side, recordings, samples and sessions, and overall the bytes that
still fit:

> **Who is the player?** — Luigi: 12 recordings (96 samples) from 3 sessions · Mario: 14 (110) from 4
> **2 bytes still fit:** 0x2014 (Luigi 2, Mario 0) · 0x2A11 (Luigi 2, Mario 0) — they move
> together; either will do.

It says *enough* when every side has at least 5 recordings from at least 2 sessions and the bytes
still fitting agree on every sample (same split). Until then it says what would help: "Mario's
recordings all come from one session — play another match", "Luigi has 1 recording".

### 4.2 Near misses (mislabelled recordings)

A byte that fits every sample but those of one recording is listed separately — *0x2014 fits all
of Luigi's recordings but one* — with that recording: when it was made, its session. Usually the
label was wrong; **Move to Mario** or **Drop** fixes it, and the byte fits again.

### 4.3 What is learned

- **Two sides, or a side vs the rest:** bytes that hold one value on every sample of the side and
  never that value on the other side's samples. Ranked: steady on the other side too first (a state
  looks like that; a counter that happens to differ does not), then by how many sessions it held in.
- **Three or more sides:** bytes that hold one value per side, a different value for each.
- **When no single byte fits** but two together do, the panel offers the best pair. Most questions
  should not need it.
- The analysis keeps, per side, which bytes have been steady so far and at what value, so a new
  recording only updates its side — it stays fast at hundreds of recordings.

### 4.4 Re-learning a screen

A screen whose recipe misses frames is a question with one side (the screen) against everything
else: record while on that screen, and while elsewhere; saving replaces the screen's recipe in
`gameStatePools`. Its id and everything filed under it stay the same.

## 5. Where each part lives

### 5.1 The emulator: Record, and the live panel

- **Record**, next to Capture: pick the question and side, then *Record 5 s* (length adjustable) or
  *Record until stopped*. While recording, keys 1, 2, 3… switch side, and the bar shows the count per
  side. Recordings are held with the session's captures and go to the Project tool the same way —
  with Colorize! and Save and Play, which already merge captures into the pack.
- **The live panel** (*Game states*): which screen and which game states hold *right now*, lit as
  they change, and the live value of each byte they use. This is how you check a name you "hope is
  correct": play, watch it switch. **This is wrong** → pick the right side → it records there.
- **Mark as checked**: stamps `checkedLive` on the game states shown, so the Project tool can show
  which conditions were confirmed in play.
- The emulator already copies the game's memory every frame for screen limits
  (`tryCopyVBSystemRamFromEmulator`, `src/main.js`); recording and the panel read the same copy.

### 5.2 The memory tool (`tools/memory-analysis.html`, grown)

**Built as the Project tool's Project ▸ Game states… window** (see the note at the top). It holds the questions:
sides, recordings (browse, move, drop), the analysis panel (§4.1–4.2), **Save as game states**, the
list of game states with which groups use them and when they were last checked live, and
re-learning a screen (§4.4).

### 5.3 The Project tool: using the results

- Group details: **Paint shows when…** (§3.3).
- This pixel: "Not coloured: Mario-PlayingAs's paint is off here — *Luigi is the player* is true".
- Check project: conditions naming missing game states, game states never checked live, frames no
  screen recognises; and for a shared-tile pair where each group is alone on some frames, the fix
  becomes **Tell them apart…** (starts a question with those two sides).
- The quick learner (*Only while it's on screen*) produces a game state and a condition.

## 6. Storage: awareness and control

### 6.1 Why

Captures already make Mario's Tennis 47.5 MB; questions add recordings over several sessions; and
nothing in the tools says what the space is or what it is for. Cleaning up only after an analysis
is not enough: recordings arrive across sessions, and people need to see what is taking space
before deciding.

Mario's Tennis today (compressed, in the pack):

| Kind | Files | Size | Each |
|---|---|---|---|
| Screenshots | 205 | 16.3 MB | 78 KB |
| Frames (picture data) | 236 | 14.5 MB | 60 KB |
| Save states | 236 | 14.4 MB | 60 KB |
| Memory dumps | 236 | 1.3 MB | 5 KB |
| groups.json (paint, pictures) | 1 | 0.5 MB | — |

### 6.2 Project ▸ Project storage…

One window, each kind with its size, count and what it is for:

| Kind | For | Without it |
|---|---|---|
| Frames: picture data | Seeing and painting the frame | The frame is gone (Clean up frames decides which) |
| Frames: screenshots | The capture overlay, references | No overlay for that frame |
| Frames: save states | Opening the game at that moment; memory for older captures | Only the memory dump remains |
| Frames: memory dumps | Screens and conditions per frame | The frame can't be checked against screens or game states |
| Memory recordings, per question | Learning and re-checking its game states | Re-checking needs new recordings |
| Recovered pictures, references | Putting a picture back; painting from a reference | — |

Actions per kind: **Clean up frames…** (exists), **Thin out recordings**, **Archive** (into a
separate `.vbpack`, as Clean up frames does — *Import from another pack* brings it back),
**Delete**. The size of the project after Save is shown in the status line, so growth is noticed.

### 6.3 Closing a question

When a question is saved, the tool asks what to keep of its recordings:

- **Keep all** — re-check everything later, find mislabelled recordings.
- **Keep a summary** (recommended once the game states are checked live) — per side, which bytes
  were steady and their values: about 72 KB per side, however many recordings there were. New
  recordings can still be added and the analysis continues from the summary; only near-miss
  diagnosis (§4.2) needs the recordings themselves.
- **Archive** or **Delete** — the game states stay, and the live panel still checks them.

Nothing is deleted without asking, and a question never cleans up on its own.

## 7. Build order

Each step ends with unit tests, the browser suite, and (where colours are involved) native tests
and the parity check.

1. **Game states and group conditions (data and rule).** `gameStates`, `groups[].conditions`, the
   gate in the composite, This pixel and Check project reasons, the native player, parity; the group
   details *Paint shows when…* with *Filed under* split off; converting the interim format (§3.6);
   the quick learner writes the new format. *Usable on its own with game states typed in by hand.*
2. **Questions and recordings in the pack; the analysis.** `memoryQuestions`, `memoryRecordings`,
   `memoryrecordings/`, the recording file format; the memory tool's question list, sides,
   recordings, analysis with convergence and near misses (§4.1–4.3), adding captures to a side,
   Save as game states.
3. **Recording in the emulator.** Record (timed / until stopped), side keys, sessions; recordings
   reaching the project with the captures.
4. **The live panel.** Screens and game states holding now, byte values, *This is wrong* → record,
   *Mark as checked*.
5. **Storage.** Project storage window, thinning, summaries (§6.3), archive; the size after Save.
6. **Check project links**: *Tell them apart…* from a shared-tile pair, unrecognised frames, stale
   game states; re-learning a screen (§4.4).

## 8. Open questions

- **Value sets:** a side that is "any of 1, 2 or 3" (several characters on one side). Not needed for
  the cases so far; the data allows adding `values: [...]` to a condition later.
- **A different ROM:** a learned byte is tied to the ROM; packs already record the ROM's hash, so a
  game state can warn when the ROM differs.
