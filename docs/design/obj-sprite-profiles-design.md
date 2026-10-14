---
status: partial
last-reviewed: 2026-10-13
covers: src/obj-sprite-profiles.js, src/pose-source-frames.js, src/pattern-set.js, src/flood-fill.js, src/shade-ramp.js, tools/shared/project-return.js, tools/shared/animated-tiles.js, tools/shared/pack-session.js, tools/sprite-studio.js, tools/sprite-studio/, src/affine-base.js
---

# OBJ sprite profiles: design direction

**Status:** Partly built (Sep 2026). The data model and capture from the Project
tool (§7 steps 1–2) are done, and animation tracks are edited and previewed in
SpriteStudio — as named `tracks` in VB frames, which replaced the single `track`
this doc first proposed (see §2). Pose-aware rendering in the emulator (§5, §7
step 3) was measured Oct 9 2026 and put on hold ([pose-aware-rendering.md](pose-aware-rendering.md)): game
states, screen limits and group order cover the cases found; pose pictures colour a pose only
when it is on screen. Originally captured the direction agreed for
[priorities-and-next.md](../planning/priorities-and-next.md)'s then-top
priority: *"OBJ sprite profiles (multi-frame) — capture
animation sequences across frames; help authors accumulate sprite poses into
an OBJ group... Anchors stay BG-first; OBJ needs its own profile model."*

Does **not** depend on a core patch exporting each OBJ draw's OAM index
(`oamIndex`). That idea was originally pitched as hardware-verified sprite clustering, but
each VB OAM entry draws a single 8×8 character, so `oamIndex` identifies a
*tile*, not a sprite (see §3).

---

## 1. The problem

BG tiles got a real win from **anchor + macro** groups
([group-override-design.md](group-override-design.md),
[painter-v2-spec.md](painter-v2-spec.md) §"BG anchor + macro"): spot one
distinctive tile hash (`anchorHash`), and because BG position is stable,
blit one precomposed macro PNG over a fixed `vipRect` instead of resolving
color tile-by-tile.

OBJ (sprites) can't reuse this directly, for two reasons:

1. **Position moves every frame** — there's no fixed `vipRect` to anchor to.
2. **Composition changes across poses** — a walk cycle's tile hashes differ
   frame to frame; "the same character" isn't "the same tile set."

Today, OBJ groups exist but are, in `priorities-and-next.md`'s words, "still
too close to 'label a group and paint tile8.'" There's no way to (a) see a
sprite's tiles as one unified thing while painting, (b) accumulate its poses
across many captured frames as they're discovered during play, or (c) render
it as cheaply as a BG macro.

---

## 2. Data model: profile → pose → track

Extend the existing group concept rather than invent a parallel structure.
Groups already carry `authoringKind` (BG/OBJ) and `anchorHash` for the BG
case (`tools/painter/groups.js`, `docs/history/development-journey.md`). An **OBJ
group becomes a profile container** with a `poses` array, instead of a
single flat tile-hash criteria set:

```jsonc
{
  "id": "grp_mario",
  "name": "Mario",
  "authoringKind": "obj",
  "criteria": { "windowIds": [], "hashes": [3812552193, 918273645, 55219981], "layers": [2] },
  "poses": [
    {
      "poseId": "pose_walk1",
      "name": "Walk 1",
      // Captured, same-frame-clustered tile set (see §3).
      // dx/dy are omitted (not `0`) for a pose that hasn't been captured from
      // a live frame yet — see §6 "groups.json migration". A pose missing
      // dx/dy on any tile is not eligible for anchor-macro rendering (§5)
      // and falls back to per-tile rendering until re-captured.
      "tiles": [
        { "hash": 3812552193, "dx": 0, "dy": 0 },
        { "hash": 918273645,  "dx": 8, "dy": 0 },
        { "hash": 55219981,   "dx": 0, "dy": 8 }
      ],
      "anchorHash": 3812552193,  // see §5/§6 — which tile is the render anchor
      "allowFlipMacro": true,    // see §6 "Flip authoring" — false forces a separate pose instead of a mirrored blit
      "anchorFlipH": false,      // anchor draw's flip flags at capture; the compositor mirrors relative to these
      "anchorFlipV": false,
      "clippedAtCapture": false, // see §6 "Partial/off-screen sprites" — true if any tile touched the capture viewport edge
      "sourceFrameId": "frame_0007"  // frameRegistry id this pose was captured from (filled in on Save for Current-frame captures)
    },
    { "poseId": "pose_walk2", "name": "Walk 2", "tiles": [ /* ... */ ], "anchorHash": 918273645, "allowFlipMacro": true }
  ],
  "track": [
    { "poseId": "pose_walk1", "durationMs": 120 },
    { "poseId": "pose_walk2", "durationMs": 120 }
  ]
}
```

- **Pose** = one captured, unified sprite snapshot: a set of tiles at
  offsets *relative to each other* (not absolute screen position — that
  changes every frame). `dx`/`dy` are relative to the pose's anchor tile.
- **Profile** = the existing OBJ group, now holding multiple poses alongside
  its existing `criteria`. `name`, pool/variant (`statePoolId`/
  `stateVariantId`), and RAM conditions (`ramConditions`) stay at the group
  level, same as BG groups — poses don't carry their own pool/variant.
- **Track** = an ordered list of `poseId` + `durationMs`. This is an
  **authoring aid only** — it lets you scrub/preview "Mario walking" as a
  unified animation while painting. It is explicitly *not* required for
  runtime rendering (§5 renders per-pose, independent of track order); see
  §6 "Track playback" — decided as authoring-preview only for v1.
  **As built:** a group holds any number of **named** tracks,
  `tracks: [{ id, name, steps: [{ poseId, holdFrames, flipH? }] }]`. Holds are
  in VB frames (~20 ms), and `flipH` plays a step mirrored — for a cycle
  captured facing one way. The single `track` above is still read and converted
  (`getEffectiveTracks` in `src/obj-sprite-profiles.js`), so older packs animate.

`groupsSchemaVersion` bumps (currently 2) when this ships, same pattern as
the `gameStatePools` addition.

---

## 3. Same-frame clustering (building a pose)

**Shipped (marquee capture):** the same marquee-select gesture used for BG
"new group from selection" — the author boxes the sprite, and **New pose from
selection…** takes every OBJ draw on the current eye inside it as the pose's
tile set. Less reliable when sprites overlap, but it needs no core changes.

**Correction — `oamIndex` does not cluster sprites.** An earlier version of
this doc claimed that all tiles of one sprite share an `oamIndex`. They don't:
in `DrawOBJ`, each OAM entry carries one character (`char_no = oam_ptr[3] &
0x7FF`) and pushes one draw per eye. A 16×24 character is six OAM entries, so
`oamIndex` gives each *tile* an identity, not each sprite. What it can still
offer is a hint: games usually allocate one character's tiles in consecutive
OAM slots, so "consecutive `oamIndex` + touching on screen" is a better
auto-cluster heuristic than proximity alone. It is not a hardware guarantee.

---

## 4. Cross-frame linking (the iterative-discovery workflow)

This is the part `oamIndex` would *not* solve even with the core patch (games
reuse OAM slots from frame to frame) — no signal
says "this pose captured today is the same character as one captured last
week." Build on infrastructure that already exists for exactly this kind of
incremental discovery (`gameStatePools`, multi-frame vbpacks,
`frameRegistry`):

- **Quick capture while playing:** a hotkey that stashes the current VIP
  state into the pack's `frameRegistry` with an auto label (timestamp or
  "unlabeled #N"), without the full Colorize!→painter round trip. Discovering
  a new pose (an attack animation, a hit-flash, a level-specific recolor)
  should be cheap and not interrupt play.
- **Per-profile pose review:** in the painter, viewing a profile shows the
  poses already captured under it. Reviewing a newly captured frame, the
  author picks "attach as new pose to profile X" (extends the existing
  "new group from selection" dialog with a profile picker, instead of only
  "create new group").
- **Dedup assist (nice-to-have, not v1):** compare a candidate pose's
  tile-hash set against poses already in the profile; flag likely duplicates
  so the author isn't re-capturing "Walk 1" for the fifth time. Purely a
  suggestion — never auto-merges.

---

## 5. Runtime rendering: the OBJ equivalent of anchor + macro

Port the anchor trick to a **moving frame of reference**:

1. Each pose has one **anchor tile hash** — the least-ambiguous tile in that
   pose (ideally rare elsewhere), chosen by the author or defaulted to the
   pose's first/most distinctive tile.
2. In `compositeColorFrame` (`src/color-layer.js`), maintain a hash→pose map
   built once when the pack loads (same shape as the existing BG
   `anchorHash` lookup). This is one more `Map.get` per draw — the same cost
   class as the pack-color lookup every draw already does.
3. When a draw's hash matches a pose anchor: read that draw's **actual**
   `(x, y)` this frame (and `flipH`/`flipV`, and eye for stereo), compute the
   pose's live rect from the anchor's offset (`dx`/`dy` are stored relative
   to the anchor, so the whole pose's rect follows the anchor's real
   position), and blit the precomposed pose macro there — flipped if the
   draw says so.
4. Suppress the pose's other member draws this frame via hash-set
   membership (is this draw's hash one of `pose.tiles[].hash`) — O(1) per
   draw, same shape as BG's `hideDrawsInRect`, just keyed by set membership
   instead of a static rect.
5. **Graceful fallback:** if a pose's anchor doesn't fire this frame (sprite
   partially off-screen, anchor tile occluded), don't suppress anything —
   the individual tiles render via normal per-tile pack/override lookup,
   same as an un-grouped sprite today. Correct, just not optimized for that
   frame. Same "mono shows through when data's missing" philosophy already
   used elsewhere.

This does not change the documented O(draws × 64) cost model
([vip-color-layer-parallax-learnings.md](../reference/vip-color-layer-parallax-learnings.md)
§6) — it's a constant-factor addition per draw, and for grouped sprites it
should net *reduce* work versus today's per-tile compositing (fewer, larger
native `drawImage` blits instead of many small manual pixel loops), same
reasoning as the existing BG macro win.

Multiple simultaneous instances of the same profile (two identical enemies)
work naturally — detection is per-draw, so two anchor hits produce two
independent macro blits at their own positions.

---

## 6. Design decisions (resolved)

These were open questions; each is now decided, grounded in how the existing
BG anchor UI (`tools/painter.js`) actually behaves today, so OBJ profiles
extend a real pattern instead of inventing a new one.

### Anchor selection: auto-default + author override, same as BG

BG anchor picking today is **not** auto-suggested from a "rarity" score — it's
simpler than that. At group-creation time, `createGroupFromSelection` defaults
`anchorHash` to the **topmost draw in the selection**'s tile hash. The author
can then override it via the existing "A" (pick anchor) button, which lets
them click any tile that's a member of the group; picking a non-member tile
is rejected ("That tile is not in this group").

OBJ profiles reuse this exact interaction, extended one level for poses:

- **Default:** when a pose is captured, default `anchorHash` to the frontmost
  selected draw on the current eye (what `topSelectedDrawFullIndex` returns),
  **unless that tile's pattern repeats within the pose** — then use the first
  tile whose pattern appears once (`chooseAnchorIndex`). Found in browser
  testing: symmetric sprites often repeat a tile, and a repeated anchor would
  match twice per sprite at render time. The pose list warns when an anchor
  is repeated within its own pose.
- **Override:** the author can re-pick via the same "A" affordance, scoped to
  tiles that are members of *this pose*.
- **Ambiguity is a downgrade, not a block.** BG's existing uniqueness check
  (`countSameHashWorldLayerEye`) doesn't hard-block a non-unique anchor — it
  falls back to per-hash tile8 painting and says so in the status bar ("N
  copies — tile8 paint" vs. "unique — VIP overlay paint"). OBJ profiles add
  one more ambiguity axis on top of that same-frame check: **the anchor hash
  also appears in a sibling pose's tile set within the same profile.** That's
  the case BG doesn't have (BG groups don't have "poses"). When it happens,
  the anchor is still allowed, but the pose detail panel shows a warning
  ("also appears in poses: Walk 2, Idle") — same non-blocking philosophy, new
  cross-pose scope.
- **Validity tracking:** mirror the existing behavior where a BG group's
  `anchorHash` is silently cleared if the hash drops out of the group's
  criteria (`tools/painter/groups.js`, `normalizeGroup`) — a pose's
  `anchorHash` is cleared the same way if it's no longer one of that pose's
  `tiles[].hash` (e.g. after re-capturing the pose).

### Flip authoring: flippable macro by default

Default `allowFlipMacro: true` per pose (see §2 schema). The render path
(§5.3) already reads the anchor draw's `flipH`/`flipV` for free — every OBJ
draw carries those flags regardless of this feature — so blitting the macro
mirrored costs nothing extra and covers the common "same sprite, walks left
and right" case with one pose instead of two.

An author sets `allowFlipMacro: false` on a specific pose only when the
mirrored version isn't a true pixel-mirror of the art (asymmetric detail that
shouldn't flip — a logo, an off-center weapon, etc.). In that case the pose
only matches draws with the flip flags it was captured with; the *other*
orientation needs its own captured pose, same as any other pose. No new UI
concept — it's one checkbox in the pose detail panel, defaulted on.

### Track playback: authoring preview only, confirmed for v1

No runtime playback semantics. `track` (§2) is consumed only by the painter,
as a scrub/preview aid while authoring — the compositor (§5) never reads
`track`, it matches poses independently by anchor hash every frame. This was
already the doc's leaning; now decided rather than open. Live in-game
playback (e.g. driving a track from a timer instead of matching real OAM
data) is out of scope — nothing here rules it out later, but it's not part of
this design.

### Partial/off-screen sprites: warn, don't block

VB's visible area is 384×224 px per eye (`src/vip-state.js`). At capture time
(marquee or `oamIndex` cluster), if any tile's captured `(x, y)` is within one
tile (8px) of the eye's left/top edge, or `x+8`/`y+8` is within 8px of the
right/bottom edge, set `clippedAtCapture: true` (§2) on the pose and show a
non-blocking banner ("this pose may be missing tiles clipped at the screen
edge — capture again once fully on-screen if this looks incomplete"). The
author can still save it — some sprites are legitimately meant to be
partially off-screen (a character peeking in) — this is a review hint, not a
correctness gate. Runtime rendering is unaffected either way; §5's per-anchor
fallback already handles an incomplete tile set gracefully.

### `groups.json` migration: wrap as an implicit pose, but don't fabricate offsets

Checked the actual precedent: `groupsSchemaVersion` bumps in this codebase
(`src/art-pack.js`) are **additive and defensively read**, not a rewrite/
migration pass — old packs simply lack the new field, and loader code checks
`Array.isArray`/`typeof` before using it. OBJ profiles follow the same
pattern rather than a one-time file conversion step:

- On load, an OBJ group with no `poses` array is treated, in memory, as
  having one implicit pose: `{ poseId: 'pose_legacy', tiles: criteria.hashes
  .map(hash => ({ hash })), ... }`.
- **Critically, that implicit pose's tiles have no `dx`/`dy`** — existing
  OBJ groups only ever stored a flat `criteria.hashes` list (confirmed in
  `tools/painter.js`'s `createGroupFromSelection`: `anchorHash` is only ever
  set `kind === 'bg'`, never `'obj'` — today's OBJ groups have no anchor and
  no relative-offset data at all). There is no frame data to derive relative
  offsets from after the fact, so the implicit pose is **not eligible for
  anchor-macro rendering** (§5) — it keeps rendering exactly as it does today,
  per-tile, until the author opens it in the updated painter and re-captures
  it as a real pose (assigns `anchorHash`, gets real `dx`/`dy` from a live
  frame). That re-capture is a one-time, per-group, author-driven action —
  never automatic — consistent with "never auto-merges" in §4's dedup note.
- `groupsSchemaVersion` bumps to 3 when the `poses`/`track` fields ship. A
  pack with `groupsSchemaVersion < 3` (or missing) is only ever read through
  this implicit-pose wrapper, never written back in that shape — the first
  save after any pose-level edit persists the real schema.

---

## 7. Sequencing

The pose/profile/track authoring model, the cross-frame linking workflow,
and the anchor-style compositor optimization are all valuable **independent
of the core patch** — they work today against marquee-selected (rather than
`oamIndex`-clustered) poses. Recommended order:

1. Data model + `groups.json` schema bump (§2). **Done:** `src/obj-sprite-profiles.js`
   (normalize, legacy implicit pose, macro eligibility, anchor ambiguity,
   clipped-capture check, `buildPoseFromCapture`, schema version); Painter v2
   `normalizeGroup` keeps `poses`/`track` and save bumps `groupsSchemaVersion`
   to 3 once any group has poses. (Paint v1 has since been removed.)
2. Painter UX for creating/naming profiles and poses from marquee selection,
   plus the quick-capture/attach-to-profile workflow (§3, §4). **Done:**
   Painter v2 **New pose from selection…** (attach to an existing sprite
   group or create one; suggests the group sharing the most tile hashes);
   inspector **Sprite poses** list with Select, Set anchor, Rename, Mirror OK,
   Delete and warnings (edge-clipped, repeated anchor, anchor shared with a
   sibling pose); emulator **F8** quick capture (no dialog, auto "State NNN"
   label). UI in `tools/painter/sprite-profiles-ui.js`. Track editing and
   preview followed in **SpriteStudio** (`tools/sprite-studio.js`): named
   tracks, a timeline sized by hold, per-step mirroring, onion skin, and pose
   **Delete** (card ×, the Pose panel, or the Delete key; duplicates are easiest
   to spot there). Deleting a pose also drops its steps from every track. **Rename** (F2) and
   **Move to** (Oct 2 2026): `poseMoveTargets` offers groups of the same kind, not animated-tiles
   groups (Oct 4: BG groups that mix affine and flat poses are offered too — they exist and work);
   `movePoseBetweenGroups` takes the patterns only that pose used, with their group paint, out of
   the source and adds them to the target, which keeps its own paint where it has some. Shared
   patterns stay in the source with their paint; since Oct 9 2026 the target gets no copy of it. BG groups
   whose pattern repeats open on **One set** (`src/pattern-set.js`: the smallest block the
   region repeats by, other copies faint around it); the stage zooms with the wheel in
   whole pixels, pans with middle- or Alt+drag, and **Fit** resets it. BG groups are
   painted here per tile pattern into their own `tileColors`; a group with Project-tool
   overlay paint is offered an (undoable) clear first, because the overlay would hide it. Paint
   tools sit in a rail on the stage's right, including a **Fill** (`src/flood-fill.js`); the
   header's **← Project tool** hands the pack back with the Project tool's state restored.
   **Animated tiles** (BG groups whose art the game animates by rewriting tile slots, like
   IntroCin's starfield): the group claims its slots (`criteria.tileSlots`), SpriteStudio shows
   each captured step as a **phase** card to paint like a pose (`tools/shared/animated-tiles.js`),
   and steps nobody painted are coloured by shade from the group's `shadeRamp`.
   **Frame cards and BG poses (Sep 30 2026):** any other BG group shows one card per captured
   frame that shows something new of it (`bgGroupViews` in `tools/shared/pack-session.js`: a
   frame whose visible patterns all appear on a fuller frame's card is left out), so a character
   on a scaled layer (Mario's Tennis's far player, world 26) gets one card per drawing. BG groups
   may now keep poses: **Keep as pose** in SpriteStudio (`buildPoseFromView`) or **New pose from
   selection…** on background or affine tiles in the Project tool. An affine pose is
   `{ affine: true, tiles: [{hash}] }` drawn on its source frame (`affinePoseView`). A group with
   poses shows just those. Tracks remain sprite-only.
   **Base tiles (Oct 1 2026):** for a scaled group, SpriteStudio's **Base tiles** toggle swaps each
   card for the group's map cells laid out 1:1 (`src/affine-base.js`, which reads the source map
   cell the VIP samples at each pixel from `sampleAffineWorld`). The layout is a stand-in frame of
   plain BG draws (`addStandInFrame` in `tools/shared/pack-session.js`: an index past the captured
   frames, never saved), so rendering, Brush, Fill and Swap work unchanged. The dedup
   assist became the planned **pose suggestions** —
   [priorities-and-next.md](../planning/priorities-and-next.md) item 1.
3. Compositor anchor-style rendering (§5) — this is where the performance
   win actually lands, and it's testable against marquee-clustered poses.
4. Optional: a core patch exporting `oamIndex` (one new `VB_DrawCall` field,
   passed from `DrawOBJ`'s `oam` loop variable) for a
   consecutive-OAM-slot capture hint (see §3 correction). Low value relative
   to cost; reconsider only if marquee capture proves too error-prone.
