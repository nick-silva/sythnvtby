---
status: partial
last-reviewed: 2026-10-13
covers: tools/painter.js, tools/painter/, tools/sprite-studio.js, tools/sprite-studio/, tools/shared/pack-session.js, src/reference-fill.js, src/screenshot-frame.js, src/art-pack.js
---

# Reference images

**Status:** built (Sep 2026) — the whole loop, from exporting a frame to painting a group or
pose from what comes back. Where the build differs from the plan below, §5 and §7 say so.

You export a frame, colorize it wherever you like — Gemini, an artist friend, your own paint
program — and bring the result back as a **reference**: a colour guide pinned exactly over the
frame, that you can paint from with one click. The app never generates it.

Replaces the shelved in-app generation plan
([ai-reference-colorization.md](../history/archive/ai-reference-colorization.md), archived with
its code on Oct 8 2026), which measured that a local model was the weak link. The parts of that
work this feature keeps are the projection idea (per-pattern colours from the picture, now in
`src/reference-fill.js`) and reading captures back to exact frame pixels (`src/screenshot-frame.js`).

## 1. The loop

```
 Project tool                  anywhere                    Project tool / SpriteStudio
 ┌───────────────┐            ┌──────────┐                ┌────────────────────────┐
 │ Export frame  │ ─ grey ──▶ │  Gemini  │ ─ colorized ─▶ │ Import → align → paint │
 │ for reference │  1152×672  │  or …    │    any size    │ overlay, fill, pick    │
 └───────────────┘            └──────────┘                └────────────────────────┘
```

1. **Export.** A grayscale PNG at 3× (1152×672): the four VB shades as evenly spaced greys.
   Grey rather than red so the model is not pushed toward red, and a whole multiple so the
   result maps back to frame pixels exactly. Filename carries the frame:
   `marioclash__Level01__f-mtkeg452-ao4qrh__ref.png`.
2. **Colorize it elsewhere.** Nothing in the app; you keep whatever prompt works for you.
3. **Import.** Pick the file; the app aligns it to the frame, scores the fit and stores it in
   the pack.
4. **Paint from it.** Overlay to compare, *Fill from reference* to do the work.

## 2. What a reference belongs to

**A game state** (a memory pool: Level01, Title, GameMenu…) — the same scope as per-state
colours. Made from one frame, it applies to every frame of that state, and SpriteStudio picks
it up for any pose captured there.

- A state may hold **several** references (concept variants); one is **active**.
- **No pools yet?** The reference attaches to its frame alone, and the panel says so:
  *"This frame only — run Analyze memory to share it across the state."* When pools appear,
  offer to promote it.
- References are **left eye**; the right eye follows because colours are stored per tile
  pattern.

### In the pack

```
references/<poolId>/<refId>.png     384×224 RGBA, already aligned — what the tools use
references/<poolId>/<refId>.json    { refId, poolId, sourceFrameId, importedAt,
                                      originalName, originalSize: [w, h],
                                      fit: { scale, dx, dy, score }, note }
manifest.references = { "<poolId>": { activeRefId: "r-…", refIds: ["r-…", …] } }
```

`importedAt` is an ISO-8601 UTC timestamp (`2026-09-21T00:00:00Z`). Additive, read back on
load, about 100–200 KB per reference.

## 3. Import and alignment

The returned image is rarely 1152×672 — image models like 1344×768 and friends.

1. **Fit**: scale to the frame's aspect, letterboxing rather than cropping.
2. **Auto-align**: search a small range of scale and offset for the best match between the
   image's brightness and the frame's shades (`structureFidelity`), which catches the usual
   few-pixel drift.
3. **Score**: shown as *Fit: 0.97 — good* / *0.71 — check alignment*. Below a threshold the
   dialog opens on the nudge controls with a blinking compare so the problem is visible.
4. **Nudge**: scale, X, Y, and *Reset to auto* — the controls SpriteStudio already has, moved
   into the import dialog where they belong.

The export dialog says the one thing that matters: **don't crop or resize it**.

## 4. In the Project tool

A **Reference** section in the right panel, under the frame controls:

```
┌──────────────── frame canvas ─────────────────┐
│  [reference blended over the frame at 45%]    │
│   ░░▒▒▓▓ Mario ▓▓▒▒░░   pipes  bricks         │
└───────────────────────────────────────────────┘

 Reference ───────────────────────────────────
 Level01 ▾   [Import…] [Export frame…]
 [x] Show over frame      (hold R = full)
 Opacity  ──────●────
 Fit 0.97 · from frame Level01/MarioOnPlatform1 · [Re-align…]

 [ Fill selection from reference ]
 [ Fill all background tiles ]
 covers 94% of this frame · 61% of the state's other frames
```

- **Overlay**, not a second pane: both are the same 384×224 grid, so alignment is obvious and
  the canvas keeps its width. **Hold R** to see the reference at full strength.
- The dropdown lists the state's references; switching is instant. Import adds one and makes
  it active.
- **Fill selection from reference** — the headline action. With a group or a tile selection:
  every tile pattern under it takes the reference's colours, **previewed live** on the canvas
  with **Apply** / **Cancel**, and one undo entry afterwards.
  - Per pattern, not per screen position: each copy of a pattern is sampled and the copies'
    per-pixel median wins, so repeated background tiles come out consistent. VB black stays
    black. (`unifyRepeatedTiles` and `keepBlack` already do exactly this.)
  - **Conflicts** are reported after a fill: *"9 patterns had copies coloured differently;
    the majority was used."* Clicking highlights those tiles on the frame — these are the
    candidates for an anchored group, which can hold a per-position colour.
  - Anchored BG groups write into the group's overlay instead of pattern paint; everything
    else writes pattern paint.
- **Fill all background tiles** does the whole frame, same preview and undo.
- **Coverage** tells you when one reference is not enough: what share of this frame, and of
  the state's other frames, its patterns cover.

## 5. In SpriteStudio

Today's ad-hoc panel (file picker, *Show behind sprite*, scale/X/Y/opacity sliders) is
replaced. There is one reference per state, placed once in the Project tool, and SpriteStudio
reads the same `transform` from the pack — so **nothing is aligned twice**. A one-off image is
imported the same way as any other reference, through the Project tool.

**BG groups first, poses second.** A BG group is a static region on the frame that holds its
anchor: one frame, one position, no mirroring, and a reference covers 92–100% of a state's BG
draws (§2). A pose adds its own source frame, a position that moves between frames, and
mirroring. Same panel and same actions for both; only the footprint differs.

```
 Reference ─────────────────────────────────────────────
 Level01 (from this group's frame) ▾   [Side by side]
 [x] Show over sprite      (hold R = full)
 Opacity  ──────●────      [x] Only where this group paints
 [ Fill group from reference ]   [ Colours → palette ]
 covers 96% of this group · 14 patterns, 61 tiles
```

### 5.1 Sampling: how a reference pixel becomes paint

The reference's placement is `scale, dx, dy` in frame pixels (§2). For a VB pixel, invert that
to land in the image; the two are rarely 1:1, so each VB pixel takes the **median of the block
it covers** rather than one sample — the same treatment that survived the generation
experiments (`src/reference-fill.js`). Repeated patterns take the per-pixel
median **across their copies**, because paint is stored per pattern, not per position.
**Colours are taken as they are** — the pack holds colour per pixel, so nothing is flattened
to the VB's four shades. VB black stays black.

### 5.2 Fill group from reference — the headline action

One click over the current group: every tile pattern in it takes the colours underneath, as a
single undo entry. (*Built without the live preview; undo is one click and the result is on
screen immediately. Preview stays on the list if that turns out not to be enough.*) It reports
what it did in the terms that matter here: *"14 patterns · 61 tiles · 3 patterns had copies
coloured differently (majority used)"*, and the conflicting tiles can be highlighted. Because
paint is per pattern, the panel says up front how many other poses or frames the same patterns
appear in.

### 5.3 Side by side, and the ghost box

**Side by side** splits the stage: painted on the left, reference on the right, sharing zoom
and pan. A **ghost box** exists on both panes — the same frame rectangle, drawn on each — so
the mapping is visible rather than assumed.

- Drag a box on either pane to set it; it appears on both.
- **The reference-side box can be moved and resized on its own.** That is the answer to "it
  does not line up here": aim it at the right part of the reference, leave the stage-side box
  where the paint should go, and press **Paste into box**. The content is resampled from the
  reference rectangle onto the stage rectangle.
- Arrow keys nudge the reference box by 1 px, Shift by 8; a readout shows the offset it is
  compensating for. **Reset** puts it back on the mapped position.
- The nudge is **per paste** and is not saved: the pack keeps one placement per reference.

### 5.4 Getting colours out by hand

- **Pick** samples the reference instead of the canvas when the pointer is over the reference
  pane, or with a modifier held over an overlay. It sets the brush colour and adds it to the
  palette.
- **Colours → palette** loads the dominant colours under the group or pose, so hand-painting
  starts from the right hues.
- **Only where this group paints** clips the reference to the group's own tiles, so the rest of
  the screen stops competing for attention.

### 5.5 What poses add

- The pose's **source frame** picks the reference, and its **origin** places the footprint.
- **Mirrored poses** sample with the flip undone, so a left-facing pose takes the colours of
  the art it was mirrored from.
- **Fill pose from reference** is the same action over the pose's footprint; filling one pose
  colours that pattern wherever else it appears, which is the existing shared-paint behaviour.
- Later: a **clone brush** that paints the reference's colour at the same position.

## 6. Not in scope

- No generation, prompts or model settings in the app; no ComfyUI dependency.
- No automatic propagation to other *states* — a reference belongs to one state.
- The emulator is untouched.

## 7. Build order

| Step | Delivers | Why first |
|---|---|---|
| **1. Store and show** — *built* | Export button; import; references in the pack; overlay with shared opacity; *Move & scale*; frame names and tags | Nothing else is possible without a stored, placed reference; on its own it already replaces eyeballing a second window |
| **2. SpriteStudio, BG groups** — *built* | The panel from §5: reference from the group's frame, overlay with alpha, hold-R peek and clip-to-group, *Fill from reference* with undo and the conflict count, *Colours → palette* | A BG group is the simple case — one frame, one position, no mirroring — and the sampling, fill and per-pattern median it needs are the same pieces poses will use |
| **3. Side by side and the ghost box** — *built* | Split stage with shared zoom, ghost box on both panes, reference-side nudge (arrows, Shift for 8), *Paste into box*, *Reset box*, Pick from the reference pane | Makes an imperfectly aligned reference usable, and turns sampling colours into something you can see |
| **4. Poses** — *built* | The same panel and fill over a pose footprint, mirroring undone when sampling | Everything above, plus the two things only poses have |
| **5. Extras** — *built* | Coverage readout, clip-to-group, clone brush, a picker when a state holds several references, *Fill selection from reference* in the Project tool | Sharpening once the loop is in daily use |

### What step 1 does differently

- **Placement is by hand, not automatic.** There is no luminance auto-align or fit score.
  The image keeps its own size and carries a `transform` (`scale`, `dx`, `dy`); on import it is
  fitted inside the frame and centred. **Move & scale** (next to the Reference overlay toggle)
  outlines it — including past the canvas edges — and drags move it while edge and corner
  handles resize it. Picking another canvas tool leaves the mode; **Revert** returns it to the
  import fit and is enabled only once something moved. Auto-align can still be added later.
- **Both overlays share one opacity slider**, as asked, and the reference sits under the same
  "Overlay alpha" as the screenshot overlay. No hold-to-peek key yet.
- **Files are flat** — `references/<refId>.png`, not `references/<poolId>/…` — because the
  manifest already carries the scope. The original image is kept (open question 2 answered:
  keep it), which is also what makes re-scaling non-destructive.
- **The frame widgets moved** out of the header into a **Frame** panel at the top of the left
  rail (picker, ‹ ›, eye, layer, both overlay toggles, alpha, brightness), and per-frame
  actions live in a **Frame** menu next to File. Leaving for the emulator is now a separate
  button in the top right that warns when there are unsaved edits.

## 8. Open questions

1. **Where do exports go?** The project home folder (Chromium File System Access, already used
   by `src/project-home.js`) or an ordinary download? Project home is tidier but not on every
   browser.
2. **Keep the original import too**, or only the aligned 384×224 copy? Only the aligned copy
   keeps packs small; keeping the original allows re-aligning later without the source file.
3. **Fill granularity**: is "fill selection" plus "fill all" enough, or is a per-tile fill
   needed for touch-ups before the clone brush exists?

## Related

- [ai-reference-colorization.md](../history/archive/ai-reference-colorization.md) — the shelved generation plan;
  §8 holds the measurements that led here.
- [art-pack-file-format.md](../reference/art-pack-file-format.md) — where `references/` and
  `manifest.references` will be documented once built.
- [obj-sprite-profiles-design.md](obj-sprite-profiles-design.md) — poses, which the SpriteStudio
  step builds on.
- [priorities-and-next.md](../planning/priorities-and-next.md) — the backlog, including the
  palette-register bug that makes captures the trustworthy source of what was on screen.
