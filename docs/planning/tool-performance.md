---
status: partial
last-reviewed: 2026-10-10
covers: tools/painter.js, tools/painter/, tools/sprite-studio.js, tools/sprite-studio/, tools/shared/pack-session.js, src/group-screens.js, src/color-layer.js, src/group-tile-colors.js, src/art-pack.js, src/zip-read.js, src/starter-paint.js, src/project-health.js, tests/e2e/s9-performance.mjs, src/lazy-entries.js, src/affine-world.js, src/memory-recorder.js, src/zip-write.js, tools/painter/pose-sources.js, src/pose-source-frames.js
---

# Making the tools snappy at 250, 500 and 1000+ frames

Measured Oct 8 2026 on *Mario's Tennis* (264 frames, 80 groups, a 49 MB `.vbpack`, 335 MB
unzipped), headless Chrome, CPU profiles taken through DevTools. The emulator is fine; both
authoring tools are not. The probe script lives outside the repo (it opens a private pack); its
method is below so it can be rerun.

## What is slow, and why

| Action | Project tool | SpriteStudio | Where the time goes |
|---|---|---|---|
| Open the pack | 3.5 s (frames listed at 2.9 s) | 8.5 s (listed at 2.8 s) | Unzipping and UTF-8 decoding 335 MB with JSZip (~2.2 s); SpriteStudio then decodes every group's paint (1.6 s, the starter-shade check) and draws every thumbnail |
| Switch frame | **2.2–2.5 s** | 30–90 ms (arrow keys) | `screensForGroup` / `groupInFrame`: the groups panel recounts, for all 80 groups, which of the 264 frames show them — the same answer every time |
| Select a group | 1.1–1.3 s | 0.7 s (Luigi), 1.3 s (MarioBackground, affine) | Project tool: the same recount. SpriteStudio: thumbnails, and sampling the affine layer |
| One brush stroke | **1.4 s** | **0.65 s** on Luigi-PlayingAs, 0.1 s on a background | Project tool: the groups panel rebuild again (the recount). SpriteStudio: every stroke redraws all 82 of Luigi's pose thumbnails, and each composite rebuilds the group-paint index from scratch (decoding all 80 groups' paint) because a group is being painted |
| Save | 5.3 s to rebuild the zip (Node), plus writing 54 MB | same | Every save recompresses every frame, save state and recording, though only `groups.json` changed |
| Memory | 850 MB JS heap after opening | 600 MB–1.4 GB | Every frame's JSON kept as a string, every save state, RAM dump and recording kept as bytes |

**Luigi-PlayingAs** is the biggest group (82 poses, 61 pose pictures, 2,382 painted tiles: a third
of `groups.json`), but it is a multiplier, not the cause: its 2,415 patterns make the recount and
the per-stroke thumbnail redraw expensive. Fixing those two makes its size harmless.

**What a frame costs:** a frame's VIP JSON is ~630 KB, three quarters of it the draw list written
as one JSON object per draw (5,220 draws). Unzipped per folder: frames 167 MB, save states 104 MB,
memory recordings 49 MB, screenshots 18 MB, RAM dumps 17 MB. At 1,000 frames that is ~1.3 GB
unzipped, all of it read and held at open. That, not the zip itself, is what will not scale.

## Answers to the questions behind this

- **Do we need a zip while working?** No. The zip is a good file to hand someone or to publish,
  and a bad working format: every Save rewrites all of it. A project *folder* (the project home
  the tools already use) lets Save write only what changed — `groups.json` and the paint, ~3 MB —
  in well under a second. The `.vbpack` stays as Open / Save as / export.
- **Can assets stream from the archive as needed?** Yes, either way. A zip has a directory at the
  end; one frame can be read without inflating the rest. The tools read and hold everything today
  only because it was simplest. What they need at open is small: groups, paint, the frame list,
  and a *summary* of each frame (which patterns it shows on which worlds and layers, its screen,
  how much is uncoloured). Full frame data is needed only for the frame on screen.
- **Annotating frames** is the same summary, kept: what each frame proves (screens, game states
  held, patterns no other frame shows, poses captured from it, groups it shows, uncoloured tiles).
  With it, Check project, screen counts, auto-capture and Clean up frames work from summaries, and
  a frame can be archived out of the working set without losing what it told us.

## Phase 1 results (built Oct 9 2026)

Same pack, same probe, after Phase 1:

| Action | Project tool | SpriteStudio |
|---|---|---|
| Open (until listed) | 3.5 s → **1.4–1.9 s** | 8.5 s → **1.3 s** listed, 3.4 s settled |
| Switch frame | 2.2–2.5 s → **45–65 ms** | 30–90 ms → 20–55 ms |
| Select a group | 1.2 s → **65 ms** | Luigi 0.7 s → 0.45 s; MarioBackground still 1.3 s the first time (sampling its scaled layer on each frame; cached after) |
| Brush stroke (8 moves) | 1.4 s → **~100 ms** | Luigi 650 ms → **110–160 ms** |
| JS heap after open | 850 MB → **520 MB** | 600 MB → 400 MB |

What changed:
- **Screens per group counted once** (`framesShowingGroup` in `src/group-screens.js`): cached per
  group and frame index, counted again when a group's criteria change; frames indexed as number
  sets per world and layer instead of a text key per pattern.
- **Decoded group paint cached on the stored colours**, not the group object
  (`src/group-tile-colors.js`): copies of a group made per composite reuse it.
- **The group-paint index while painting** (`buildGroupTileColorIndex`) is reused while every live
  Map holds the same patterns and buffers, instead of being rebuilt for every composite.
- **SpriteStudio redraws only the thumbnails a stroke changed**, a few per frame after it; the
  "overpaint off" group list is cached, so thumbnails stop rebuilding the paint index.
- **Opening reads the zip natively** (`src/zip-read.js`: the central directory, then the
  platform's `DecompressionStream` and `TextDecoder`; JSZip is the fallback, and still writes).
  Byte-identical to JSZip on all 1,097 entries of the Mario's Tennis pack.
- **Starter colours** are a set lookup; the planned "already converted" flag was not needed (the
  1.6 s was decode-cache misses, now gone).
- **`tests/e2e/s9-performance.mjs`**: budgets on a large pack (`VB_PACK_LARGE`) — open under 8 s,
  frame switch and strokes under 0.4–0.5 s, no freeze over 1 s; skipped without the pack.

Still slow: **Save** (5 s, unchanged — Phase 3), the first select of a scaled background, and
memory, which still grows with frames (Phase 2).

## Phase 2 results (built Oct 9 2026)

Memory, measured after a forced garbage collection as JS heap plus array buffers (the earlier
"heap" figures included garbage), Phase 1 → Phase 2 on the same pack:

| Moment | Project tool | SpriteStudio |
|---|---|---|
| Just opened | 397 → **210 MB** | 390 → **193 MB** |
| Working (frames switched, a group painted) | 498 → **334 MB** | 422 → **225 MB** (Luigi) |
| After selecting MarioBackground (scaled) | — | 1,335 → **317 MB** |

Speed stays where Phase 1 left it (open 1.1–1.2 s to listed, frame switch 50–90 ms, strokes
~100 ms, Luigi strokes 110–160 ms); selecting Luigi is 0.6 s and MarioBackground 1.2 s.

What changed:
- **Frames, save states, RAM dumps, screenshots and recordings stay compressed** in memory — a
  view into the `.vbpack` bytes already loaded — and are inflated when read (`src/lazy-entries.js`,
  synchronous with fflate, ~2–4 ms a frame), with 48 MB of recent reads cached. Items keep the
  `{ name, json }` / `{ name, buffer }` shape through getters, so every reader works unchanged;
  frame rows read through (`frameRowFrom`), and lookup tables over a folder read only what is asked
  for (`ReadOnGetMap`). Screenshot images are made when a frame is first shown.
- **Decoded frames are kept for the frames being worked on** (SpriteStudio: the 100 most recent;
  affine pixel maps: 24), not for every frame ever shown.
- **Frame summaries, in memory** (`summarizeFrame` in `tools/shared/pack-session.js`): the patterns
  each frame draws, plus those its scaled layers show without a draw record, built in the
  background after opening. A group's views and its picture coverage decode only frames that can
  show it. Without the scaled-layer tiles the filter did nothing for Mario's Tennis: 253 of its
  264 frames have a scaled layer (the court).
- **Missed, fixed Oct 9:** a scaled group's kept poses (`affinePoseView`) still decoded every
  frame looking for the best match. With only 100 frames kept, each card re-decoded and
  re-sampled the whole pack. SpriteStudio's Base tiles toggle on IntroMario (17 cards) took
  2.6 s. Now, once a frame matches, frames that can't show any of the pose's patterns are
  skipped, and the toggle takes 0.2–0.4 s. All 254 affine pose views (both eyes) pick the same
  frame as before.

Not done, and why: **summaries in the pack file** and **a compact draw list** — both change the
pack format, and with frames kept compressed the draw list is no longer what fills memory. They
fold into Phase 3, which changes how a project is stored anyway.

## Plan

### Phase 1 — stop redoing work (no format change; S, days) — built Oct 9

1. **Project tool: count a group's screens once.** Cache "frames showing this group" per group
   object, invalidated when the frame index is rebuilt; index frames with number sets per
   world/layer instead of building a text key per pattern. *Expected:* frame switch, select and
   stroke from 1.2–2.5 s to under 100 ms.
2. **SpriteStudio: redraw only what a stroke changed.** Redraw the thumbnails of poses that use
   the painted pattern, in idle time, instead of all of them; give the group-paint index a paint
   revision so it is rebuilt when paint changes, not on every composite; cache the palette's
   colours per group revision. *Expected:* strokes on Luigi from 650 ms to under 100 ms.
3. **Open faster.** Mark packs whose starter shades are already converted, so the check runs once
   (1.6 s in SpriteStudio); swap JSZip's reader for a faster inflater with native UTF-8 decoding
   (fflate, in a worker). *Expected:* open from 3–8 s to 1–2 s.
4. **A performance check in the suite** that opens a large pack and fails when frame switch or a
   stroke goes over budget, so this does not creep back.

### Phase 2 — load frames when needed (pack format addition, compatible; M) — built Oct 9, in memory (items 1–2)

1. **Frame summaries in the pack** (`framesummaries.json`, one row per frame), written at capture
   and on save, rebuilt for any frame missing one. Check project, screen counts, *On this frame*,
   frame filters and auto-capture coverage read summaries.
2. **Open reads summaries, not frames.** A frame's VIP state is read from the archive when it is
   shown (and kept for the last few); save states, RAM dumps, screenshots and recordings only when
   something uses them (Save and Play, Analyze memory, Game states). *Expected:* memory from
   ~850 MB to ~150 MB, open time no longer growing with frame count.
3. **A compact draw list** (fixed-size binary records, or re-derived from the VIP memory the frame
   already holds). *Expected:* frame data from 167 MB to ~25 MB unzipped.

### Phase 3 — fast saves (built Oct 9 2026, keeping the `.vbpack`)

Chosen over a working folder (below): the same Save speed for today's projects, with no change to
files or workflow.
- **Unchanged entries are copied as stored** (`src/zip-write.js`, used by `buildArtPack`): items
  read lazily from the opened pack carry their zip entry (`zipEntry`, src/lazy-entries.js), and
  the writer copies its compressed bytes and CRC; only what a save built is compressed again, with
  native `CompressionStream` (fflate where it is missing). The emulator's Colorize! and Export pass
  the opened pack's items through the same way, recordings included.
- **The Project tool's save no longer reads every frame** looking for poses without a source frame:
  frames are read only if their patterns (from the screen index) can hold a missing pose
  (`patternsAt` in `tools/painter/pose-sources.js`).
- Measured on Mario's Tennis: building the pack 5.2 s → **0.2 s**; a whole Save, file written,
  **0.8 s** in the Project tool and **0.5 s** in SpriteStudio. All 1,097 entries round-trip
  byte-identical, and JSZip reads the result with CRC checks. `s9-performance.mjs` budgets Save at
  2.5 s in both tools and reopens the saved pack.

Save time now grows with the file write (~50 MB today), not with recompressing it: about 1–2 s
at 1,000 frames.

### Later, if needed — a project folder while working (M–L)

1. **Working copy as a folder** in the project home: `manifest.json`, `groups.json`, the paint,
   `frames/<id>/…`. Save writes changed files only; the emulator's captures add files directly.
2. **`.vbpack` for sharing and publishing:** Open a `.vbpack` unpacks it to a folder (or works
   from it read-only), *Save as .vbpack* and the player export build the zip on demand.
3. Without folder access (non-Chromium), the `.vbpack` path keeps working as today.
   *Expected:* Save from 5–10 s to under 0.5 s; a crash loses at most the journal's few seconds.

### Phase 4 — 1,000+ frames: annotate, then archive harder (M) — backlogged Oct 9

Not needed yet: at 264 frames the tools are fast (Phases 1–3). Start before a project passes
~400–500 frames, when memory (about 1 MB per frame open in SpriteStudio's cache, the 48 MB
read cache, and the pack's own bytes) and the Save file write (~0.2 MB per frame) start to show.
Finishing Mario's Tennis is expected to need hundreds more captures.

1. **Frame summaries in the pack** (`framesummaries.json`, one row per frame): the patterns it
   draws per world and layer (both eyes, plus scaled-layer stand-ins), its screen and game states
   held (from its RAM), its uncoloured counts at the last save, and which poses were captured from
   it. Written at capture and on save; rebuilt for frames missing one. Today these are built in
   memory after each open (SpriteStudio's `summarizeFrame`, the Project tool's screen index) —
   from the file, opening a 1,000-frame project would not have to decode every frame.
2. **Annotations at capture**, kept in the summary and the frame registry: screen, game states
   held, the auto-capture reason ("2 new sprite tiles", "MarioBackground past its picture"), how
   many patterns no earlier frame had, characters (from game states). Searchable in *Go to frame…*
   and the Frame list, so a frame can be found by what it shows rather than its id.
3. **Archive by evidence:** Clean up frames suggests archiving every frame whose patterns, screens,
   game states and poses all appear on frames kept, and keeps the archived frame's summary — so
   coverage, auto-capture, screen counts and Check project still know what it showed. Archived
   frames go to a side `.vbpack` (as today) and one can be brought back on demand, not only all.
4. **A compact draw list** (fixed-size binary records, or re-derived from the VIP memory the frame
   already holds): a frame's JSON is ~630 KB, three quarters of it the draw list; binary would make
   frame data ~6× smaller in the file, in memory and on every Save write.
5. Measure again with `s9-performance.mjs` on a pack of 500+ frames (an archived copy of Mario's
   Tennis with frames duplicated is enough to start).

If saving the file itself becomes the slow part, the project folder above is the next step.

## Order and checks

Phase 1 first: it is days of work, needs no format change, and removes every multi-second wait
measured above. Phase 2 before the frame count passes ~400 (memory). Phase 3 when saving starts
to hurt or with Phase 2's format work. Each phase is checked by rerunning the probe below and the
browser suite.

**Probe method:** Playwright opens the pack through each tool's file input (never saving), and
records a CPU profile (DevTools `Profiler`, 0.5 ms sampling) around: opening, 20 s idle, six
frame switches, selecting a group, four brush strokes, and in SpriteStudio selecting
Luigi-PlayingAs and MarioBackground, five arrow steps and four strokes each. Times are from the
action to the second animation frame after it; long tasks from a `PerformanceObserver`.
