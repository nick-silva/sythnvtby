---
status: current
last-reviewed: 2026-10-15
covers: src/art-pack.js, src/frame-summary.js, src/group-schema.js, src/group-order.js, src/screen-gate.js, src/game-states.js, src/memory-questions.js, src/recovery.js, src/layer-art.js, src/touch-up.js, src/group-folders.js, src/transparent-paint.js, src/frame-cleanup.js, src/zip-read.js, src/zip-write.js, src/lazy-entries.js, src/pose-mirror.js
---

# Art pack file format (.vbpack)

A **.vbpack** is a single ZIP file that bundles everything for a colorization project: ROM, color pack, position overrides, frame snapshots (VIP state), and optional save states. The emulator and the authoring tools load it so you can “load my project” in one step.

**Extension:** `.vbpack` (or `.zip`). It is a normal ZIP — you can unzip, edit or replace files, and re-zip with the same paths. The tools write entries **deflated** (level 1; PNGs stored as they are) and read stored or deflated entries alike: a 132-frame project went from 192 MB stored to 18.6 MB (`PACK_ZIP_COMPRESSION`). Implementation: `src/art-pack.js` (`parseArtPack`, `buildArtPack`, `PACK_ENTRIES`).

---

## 1. Zip layout: what each path does

### Root-level entries

| Path in zip | What it does | Required? |
|-------------|--------------|------------|
| `rom` or `rom.bin` | Virtual Boy ROM binary. Loaded by the emulator when you “Load pack”; also used so Save and Play can return a full pack. | Yes for a full pack; optional for pack-only (e.g. overrides + color, no ROM). |
| `color.vbcolor` or `pack.vbcolor` | **Color pack**: tile content hash → 256-byte RGBA. Same format as a standalone .vbcolor file. The color layer uses this to draw colorized tiles over the monochrome frame. | No (missing = no pack). |
| `overrides.json` | **Position overrides**: JSON array of `{ hash, xMin, yMin, xMax, yMax, rgbaBase64, ... }`. Same tile (hash) can have a different color in a rectangle. May include `groupId`, `layer`, `ramConditions` (non-group). Same format as standalone overrides. | No. |
| `groups.json` | **Project tool / SpriteStudio**: tile **groups** (criteria + optional game-state), **override presets**, and (schema v2) **gameStatePools** / **state variants** for WRAM. See [§6](#6-groupsjson-authoring-schema). Written when groups, presets, and/or pools exist. | No. |
| `memoryrecordings/<id>.bin` | **Memory recordings** (src/memory-questions.js `encodeRecording`): `"VBMR"`, version 1, 3 bytes padding, sample count (uint32 LE), then 64 KiB samples — the first whole, each later one XORed with the one before (mostly zeros: 10 samples compress to about 10–15 KB). Listed in `manifest.memoryRecordings`. | No. |
| `manifest.json` | **Metadata**: version, gameId, name, romFileName, timestamps, and optional refs to current VIP/save state. Used for display (“Last pack: gameId”) and for Save and Play. | Recommended; readers tolerate missing. |
| `painter-v2-rules.json` | **Painter v2 (alpha):** additive JSON rules blob. v0 shape: `{ schemaVersion: 1, tile8ByVariant: { [variantId]: { [hash]: { rgbaBase64 } | base64 } }, macroByVariant: {} }`. Parsed by `parseArtPack` as `painterV2Rules`; written when `buildArtPack({ painterV2Rules })` is set. Omitted from zip when absent. See `docs/design/painter-v2-spec.md`. | No. |
| `painter-v2-vip-overlays.json` | **Legacy (Painter v2):** full-frame (384×224) RGBA **VIP authoring** per group + eye for anchor-BG overlay paint. The tools convert each entry to the group's `touchUp` on open (when a captured frame shows the anchor) and drop it on save; nothing writes new entries. Shape: `{ schemaVersion: 1, width, height, entries: [{ groupId, eye, rgbaBase64 }] }`. Does not replace `vipstate-current.json`; it is composited on top after load. | No. |
| `framesummaries.json` | **What each captured frame shows, in brief** (src/frame-summary.js), so opening a project does not decode every frame. `{ version: 1, frames: { "<frame file>": { n, b, h, w, a, x } } }`: `n` the frame text's length (a summary whose `n` no longer matches is ignored and the frame read again), `b` its master brightness, `h` every pattern its draws use, `w` the left eye's non-blank patterns and tile slots per `"world|layer"` (`*` when a draw has none), `a` 1 when a layer is scaled, `x` the patterns scaled layers show without a draw record. Written by both tools' Save and carried through by the emulator; frames without one are summarised in the background and saved next time. | No. |
| `vipstate-current.json` | **Current frame snapshot**: one VIP state (pattern table, draw list, segments, etc.) as JSON. The “current” frame when the pack was saved. The painter uses it as the frame to edit; the emulator can show it in the Frame / Save state list. | No. |
| `save-state.state` | **Current emulator save state**: core save state (binary). Restored after Save and Play so the game is at the exact frame you edited. Also used when you pick “Current” (or the frame that has this state) in the Frame / Save state dropdown. | No. |

### Folders (multiple frames and save states)

| Path in zip | What it does | Required? |
|-------------|--------------|------------|
| `vipstates/*.json` | **All frame snapshots**. Each file is one VIP state (one frame). Names are arbitrary but typically `current.json`, `frame-1.json`, `frame-2.json`, etc. The emulator’s “Frame / Save state” dropdown lists these so you can switch frame and (if a matching savestate exists) restore that point in the game. | No. |
| `savestates/*.state` | **Per-frame save states**. Each file is one core save state (binary). Names should match frame names for pairing (e.g. `current.state` for the current frame). When you select a frame that has a matching `.state` file, the emulator restores that save state. | No. |
| `art_exports/*.png` | Scene PNGs (384×224) written by Paint v1’s “Export scene” (removed Sep 2026). Nothing writes them now, and `parseArtPack` does not read them back, so re-saving a pack drops them. The Project tool’s *Export frame PNG* saves a standalone file instead. | No. |
| `ramdumps/*.wram.bin` | Per-frame **CPU WRAM** dump (typically **64 KiB** = `0x10000` bytes) for RAM / game-state analysis. Produced when using **Capture Frame** in the main emulator (when the core exposes system RAM). Pairs with `vipstates/<same-stem>.json`. | No. |
| `screenshots/*.png` | Per-frame PNG preview of the emulator view at capture time. Same basename stem as the matching VIP JSON (e.g. `vipstates/f-abc123.json` → `screenshots/f-abc123.png`). | No. |
| `recovery/<id>.json` | **Recovered pictures** (`src/recovery.js`): overpaint SpriteStudio set aside instead of saving it in the wrong place — one whose stored PNG was not the size its settings said (found on open), or whose pixels were out of step with its settings at Save. One JSON per picture: `{ version: 1, id, setAsideAt, reason, groupId, groupName, pictureId?, settings, png }` — `settings` is the overpaint without its `png` (world, map place, size, hide tiles; `poseId`/`hashes` for a pose picture), `png` the paint as it was, base64. Listed in the group's Overpaint panel (*Put back*, *Export PNG*, *Discard*); put back or discarded, it is gone from the next save. Files a build cannot read are written back unchanged. | No. |
| `references/<refId>.png` | A colour **reference image**: a frame colorized in some external tool and imported through the Project tool's *Frame ▸ Add colorized reference…*. Stored at the size it arrived at; `manifest.references` says where it belongs and how it is placed. | No. |

**Summary:** Root entries are the “current” or single instance (ROM, pack, overrides, one VIP state, one save state). The **vipstates/** and **savestates/** folders hold **all** frames and their optional save states so the pack is a complete project (multiple frames + optional restore points). The **ramdumps/** and **screenshots/** folders hold WRAM binaries and thumbnails for each captured frame (memory-analysis tooling). The **art_exports/** folder, if present, is left over from Paint v1.

### `manifest.json` — `frameRegistry` (optional)

When frames are captured from the emulator with labels, `manifest.json` may include a **`frameRegistry`** array: one object per capture with `frameId`, `stateName`, `subStateName`, `note`, and paths to `vipStateFile`, `screenshotFile`, `ramdumpFile`, `saveStateFile`. **`number`** (since Oct 8 2026) is the frame's short number (`#57`, `src/frame-numbers.js`): frames without one get the next free number, in registry order, when a tool opens the pack; a number is never reused or changed. `name` and `tags` are set in the Project tool's Frame menu. See [memory-analysis-tool-spec.md](memory-analysis-tool-spec.md).

The Project tool adds two optional fields of its own (*Frame ▸ Rename frame… / Edit tags…*),
which never overwrite the captured `stateName`:

| Field | Type | Meaning |
|---|---|---|
| `name` | string | A name you chose. Shown instead of the state name in the frame picker. Absent when unset. |
| `tags` | string[] | Your tags, deduplicated case-insensitively and sorted, for filtering frames later. Absent when empty. |

### `manifest.json` — `references` (optional)

Where each `references/<refId>.png` belongs and how it sits on the frame
([reference-images.md](../design/reference-images.md)):

```jsonc
"references": {
  "items": [{
    "refId": "r-m1w2x3-ab12cd",
    "scope": "pool",              // "pool" = every frame of that game state; "frame" = just one
    "scopeId": "pool-level01",    // a gameStatePools id, or a frameId when scope is "frame"
    "sourceFrameId": "f-abc123",  // the frame it was made from
    "importedAt": "2026-09-21T00:00:00Z",   // ISO-8601, UTC
    "originalName": "level01-colorized.png",
    "originalSize": [1344, 768],
    "transform": { "scale": 0.2857, "dx": 0, "dy": 3 }  // frame pixels; may extend outside 384×224
  }],
  "active": { "pool:pool-level01": "r-m1w2x3-ab12cd" }   // which one a scope shows
}
```

`transform` places the image's top-left at `dx, dy` in frame pixels and multiplies its size by
`scale`; *Move & scale* writes it and *Revert* restores the fit-inside-the-frame default.
Readers that do not know about references ignore both the folder and the manifest key.

---

## 2. Manifest schema

`manifest.json` is a single JSON object. All fields are optional.

| Field | Type | What it does |
|-------|------|--------------|
| `version` | number | Pack format version (e.g. 1). |
| `gameId` | string | Game identifier (e.g. for color pack gameId; used for “Last pack: gameId”). |
| `name` | string | Human-readable project/game name. |
| `romFileName` | string | Original ROM filename (for display, e.g. “Mario Clash.vb”). |
| `romSha1`, `romCrc32`, `romSize` | string, string, number | Which ROM the pack holds (40 and 8 lowercase hex digits, bytes). Written on every save that includes the ROM (`buildArtPack`, `src/rom-identity.js`), so a play pack ([play-pack-format.md](play-pack-format.md)) can name the ROM without carrying it. |
| `createdAt` | string | ISO 8601 date/time. |
| `updatedAt` | string | ISO 8601 date/time. |
| `currentVipStateRef` | string | Entry name for the current VIP state (e.g. `vipstate-current.json`). |
| `paintOnTransparent` | number | `1`: paint on pixels the game leaves transparent (value 0) is intentional and is drawn, covering what is behind. The Project tool and SpriteStudio set it when they open a pack without it, after clearing stray paint on transparent pixels that older tools let through (it never showed); the emulator draws such paint only for flagged packs, and keeps the flag through Colorize! and Export. See `src/transparent-paint.js`. |
| `painterV2LastVipFile` | string | **Painter v2 only:** VIP leaf filename last selected in the frame dropdown (e.g. `vipstates/title.json` or `vipstate-current.json`). Reopens that frame after load; does not change which file is the pack’s “current” VIP for the emulator (`currentVipStateRef` / root `vipstate-current.json` stay as-is). |
| `currentSaveStateRef` | string | Entry name for the current save state (e.g. `save-state.state`). |
| `frameRegistry` | array | Optional list of per-capture metadata (`frameId`, `stateName`, `subStateName`, file paths). |
| `archivedCoverage` | object | Optional. `{ bg, obj, affine }`, each a sorted list of tile pattern hashes (uint32) that frames taken out by *Project ▸ Clean up frames* showed, so auto-capture still counts them as captured. Added to on every clean-up; the emulator keeps it. |
| `archivedFrames` | object | Only in an archive pack written by *Clean up frames*: `{ from, at, count }` — the project file it came from, when (ISO 8601) and how many frames. Such a pack holds just those frames (no ROM, groups or paint); *File ▸ Import from another pack* brings them back. |
| `memoryQuestions` | array | Questions asked of the game's memory (src/memory-questions.js): `[{ "id", "name", "sides": [{ "id", "name" }], "createdAt" (ISO 8601), "status": "collecting" \| "saved" }]`. Each side becomes a game state when saved. |
| `memoryRecordings` | array | Recordings answering them: `[{ "id", "question", "side", "startedAt" (ISO 8601), "seconds", "samples", "session", "source": "record" \| "frame", "frameId"? }]`. A `record` recording's samples are in `memoryrecordings/<id>.bin`; a `frame` one with a `frameId` is read from that frame's memory dump. Never copied into a play pack. |
| `memoryAnalysis` | object | Result of *Analyze memory*: per game state, the WRAM bytes that identify it (`topCandidatesByState`), used to seed `gameStatePools`. See [memory-analysis-tool-spec.md](memory-analysis-tool-spec.md). |

Example:

```json
{
  "version": 1,
  "gameId": "mario-clash",
  "name": "mario-clash",
  "romFileName": "MarioClash.vb",
  "updatedAt": "2025-03-09T14:30:00Z"
}
```

---

## 3. How the app uses the pack

- **Main emulator:** Load pack (file or “Last pack”) → parse ZIP → apply ROM (if present), color pack, overrides; load VIP state(s) and save state(s) from root + folders. “Frame / Save state” dropdown is built from `vipstate-current.json` + `vipstates/*.json`; selecting a frame applies that VIP state and, if a matching `savestates/*.state` exists, restores that save state.
- **Project tool** (`tools/project.html`): Load pack → same parse → apply color pack, overrides, groups and one VIP state (current or chosen from the folder). *File → Analyze memory* writes `manifest.memoryAnalysis` and seeds `gameStatePools` into the open pack. **Save and Play** rebuilds the pack with **all** frames in `vipstates/` and optional `savestates/`, **overwrites the `.vbpack` you opened** (keeping `<name>.bak.vbpack` beside it), and hands off to the emulator. With no file to overwrite it writes to the project home, or downloads.
- **SpriteStudio** (`tools/sprite-studio.html`): same parse via `tools/shared/pack-session.js`; **Save** writes painted tiles into `.vbcolor` and poses/tracks into `groups.json`, carrying everything else over.
- **Colorize!:** Emulator builds a vbpack from current ROM, vbcolor, overrides, current VIP state, current save state, and **all** captured frames (in `vipstates/`), puts it in IndexedDB, and opens the Project tool, which loads that pack and shows “From Colorize”.

---

## 4. Reading a pack

1. Accept a file (e.g. `.vbpack`, `.zip`).
2. Parse as ZIP. The tools use `src/zip-read.js` (the central directory, then native inflate),
   JSZip where that is not available. Frames, save states, RAM dumps, screenshots and recordings
   stay compressed until read (`src/lazy-entries.js`).

**Writing.** A pack is a plain zip — deflate (level 1) for JSON and binaries, stored for PNGs, UTF-8
names, no data descriptors or zip64 — written by `src/zip-write.js`. An entry read unchanged from
the pack that was opened is copied as its stored bytes, so a save recompresses only what it built
(groups, paint, manifest): ~0.2 s to build a 264-frame project instead of ~5 s. Any zip reader opens
the result.
3. Extract:
   - `rom` or `rom.bin` → ArrayBuffer (ROM).
   - `color.vbcolor` (or `pack.vbcolor`) → ArrayBuffer → color pack.
   - `overrides.json` → JSON → position overrides.
   - `manifest.json` → JSON → metadata.
   - `vipstate-current.json` → JSON → current VIP state.
   - `save-state.state` → ArrayBuffer → current save state.
   - All `vipstates/*.json` → list of `{ name, json }`.
   - All `savestates/*.state` → list of `{ name, buffer }`.

See `parseArtPack()` in `src/art-pack.js` for the exact names and filters.

---

## 5. Writing a pack

1. Collect: ROM buffer, color pack buffer, overrides array, manifest object, optional current VIP state (string), optional current save state (buffer), optional `vipStatesFolder` (array of `{ name, json }`), optional `saveStatesFolder` (array of `{ name, buffer }`).
2. Create a ZIP and add each part under the paths above; add every entry in `vipStatesFolder` under `vipstates/<name>`, every entry in `saveStatesFolder` under `savestates/<name>`.
3. Generate blob and optionally trigger download (e.g. `gameId.vbpack`).

See `buildArtPack()` in `src/art-pack.js`.

---

## 6. `groups.json` (authoring schema)

**Path in zip:** `groups.json` (case-insensitive match per `src/art-pack.js`).

**MIME / encoding:** UTF-8 JSON object (not an array at the root).

**Purpose:** Bundle everything the authoring tools and runtime need for **group-scoped overrides**: group definitions, optional **override presets**, and (from **schema v2**) **game-state pools** and **variants** that own WRAM recipes.

### 6.1 Root object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `groupsSchemaVersion` | number | No | **`1`** or omitted: legacy — WRAM may live only on **`groups[].ramConditions`**. **`2`**: **`gameStatePools`** MAY be present; new work SHOULD attach groups to **`statePoolId`** + **`stateVariantId`**. **`3`**: some group has sprite **`poses`** (§6.7); tools raise it to 3 on save once any group does, and never lower it. |
| `gameStatePools` | array | No | When present, each item is a **game state pool** (§7.3). Readers MUST ignore unknown pool fields. |
| `groups` | array | No | Tile groups (§6.4). |
| `overridePresets` | array | No | Named override recipes (§6.5). |

**Writing:** Tools MAY emit **`groupsSchemaVersion`: `2`** whenever **`gameStatePools`** is non-empty. Older packs omit it or use `1`.

**Minimum file:** At least one of `groups`, `overridePresets`, `gameStatePools` SHOULD be non-empty; otherwise the zip entry may be omitted.

### 7.2 `ramConditions` entry (shared shape)

Used on **`groups[]`** (legacy) and **`gameStatePools[].variants[]`** (v2). Each condition is one object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `offset` | number | Yes | CPU WRAM byte offset in **`0`..`65535`** (`0x0000`..`0xFFFF`). |
| `expectedValue` | number | Yes | Byte value to match, **`0`..`255`**. |
| `stateName` | string | No | Human / analysis label (e.g. capture state name). |
| `source` | string | No | Provenance, e.g. **`memoryAnalysis`** or **`manual`**. |

**Semantics:** All conditions in the array MUST match (logical **AND**). Empty array **`[]`**: no WRAM gate (always satisfied).

### 6.3 `gameStatePools[]` (schema v2)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Stable id. **Unique** across `gameStatePools`. Recommended pattern: **`[a-zA-Z0-9_-]+`**. |
| `label` | string | Yes | Display name (e.g. `Intro / attract`). |
| `universal` | boolean | No | If **`true`**, this pool means **no RAM discrimination** for attached groups: variants MUST use **`ramConditions: []`** only (or omit conditions). Default **`false`**. |
| `analysisStateKey` | string | No | Optional binding to `manifest.memoryAnalysis` / `frameRegistry` state naming for re-import. |
| `analysisSource` | string | No | One of **`memoryAnalysis`**, **`manual`**, **`imported`** (informative). |
| `variants` | array | Yes | Non-empty. Each item is a **state variant** (§6.3.1). |

**Universal pool rule:** At **most one** pool per file SHOULD have **`universal: true`**. Tooling default ids (recommended for interop): pool **`__universal__`**, single variant **`__default__`**.

**Unknown fields:** Preserved when round-tripping; ignored by readers that do not implement them.

#### 6.3.1 `gameStatePools[].variants[]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Stable id. **Unique within the parent pool** (not globally). |
| `label` | string | Yes | Display name (e.g. `Safety screen`). |
| `ramConditions` | array | Yes | Array of §6.2 objects. **`[]`** for universal pool or “always on” variant. |
| `analysisStateKey` | string | No | Finer-grained binding than the pool’s key (optional). |

### 6.3.2 `gameStates[]` (top level)

**Game states** (src/game-states.js): named memory conditions that groups' `conditions` name. Not tied to a screen.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Stable id, unique across `gameStates`. |
| `name` | string | No | Display name (e.g. `Luigi is the player`); the id when absent. |
| `conditions` | array | Yes | `[{ "offset": 0–0xFFFF, "value": 0–255 }]` (CPU WRAM offsets); all must hold. A state with no valid condition is ignored. |
| `source` | string | No | `learned` or `manual` (informative). |
| `question`, `checkedLive` | string | No | Planned ([memory-states.md](../design/memory-states.md)): the question that produced it; when it was last confirmed in the emulator (ISO date). |

**Interim format (Oct 8 2026 only):** `gameStatePools[].subStates` and `"<pool>::<sub>"` entries in `screens.pools` are converted on open (`convertInterimSubStates`): each sub-state becomes a game state (its screen's recipe plus its own bytes), each entry a condition (`only` → `is: true`, `except` → `is: false`).

### 6.4 `groups[]`

**Unknown fields are kept:** every tool reads groups through `src/group-schema.js`, which tidies the fields below and leaves any other field as it is, so a field one tool writes survives a save in another.

**The order of the array is the groups' priority.** Where two groups both claim a draw and paint
its pattern differently, the group whose own tiles are next to it colours it
(`src/shared-tile-owner.js`); where nothing next to it tells, the one listed first does
(`resolveGroupTileMatch`, `src/color-layer.js`). The Project tool changes the order with **Let …
win** / **Put this group first** (`src/group-order.js`). Keep the order when rewriting the file.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | **`groupId`** referenced from `overrides.json`. Unique per pack. |
| `name` | string | No | Display name. |
| `criteria` | object | Yes | `{ "windowIds"?: number[], "worldIds"?: number[], "hashes"?: number[], "layers"?: number[], "tileSlots"?: number[] }`. Empty arrays allowed; semantics match [group-override-design.md](../design/group-override-design.md). **`layers`**: `0` BG, `1` affine, `2` OBJ; a group listing `0` also matches its worlds' affine draws (`1`), since games switch a world between the two modes while scaling it. **`tileSlots`** (*Animated tiles*, BG groups): character indices the group also claims, whatever pattern the game has written into them, within its worlds and layers — for art animated by rewriting tiles in place. |
| `statePoolId` | string | No | **v2:** Id of a **`gameStatePools[]`** entry. If set, **`stateVariantId`** SHOULD be set. |
| `stateVariantId` | string | No | **v2:** Id of a variant inside that pool. |
| `ramConditions` | array | No | **Legacy (v1):** Same shape as §6.2. Omit when WRAM is fully owned by the variant. |
| `screens` | object | No | **Which screens the group's paint shows on** (src/screen-gate.js): `{ "mode": "only" \| "except", "pools": ["<gameStatePools id>", …] }`. A frame's screens are the pools with a variant whose `ramConditions` all hold for its WRAM (a variant without conditions matches nothing). `only`: the group's `tileColors`, shade ramp and `overpaint` (and older `layerArt`/`touchUp`) apply only on frames matching a listed pool; `except`: not on frames matching one. Unknown WRAM (no dump, or a tool rendering without it): applied. Absent, or no valid pools: every screen. Unlike `statePoolId`, which only files the group, this gates paint; overrides keep their own WRAM rule below. Set with **Paint shows on** in the Project tool. |
| `conditions` | array | No | **Conditions on game states** (src/game-states.js): `[{ "state": "<gameStates id>", "is": true \| false }]` (`is` defaults to true). The group's paint (as for `screens`) applies only while every condition holds: `is: true` while the game state holds, `is: false` while it does not. Both `screens` and `conditions` must allow it. Unknown WRAM: applied. A condition naming a game state the file does not have is ignored (Check project lists it). Set with **Paint shows when…** in the Project tool. |
| `authoringKind` | string | No | **`"bg"`** or **`"obj"`**. When omitted, a group whose `criteria.layers` includes `2` is treated as a sprite (OBJ) group. |
| `overpaint` | object | No | **BG groups — overpaint** (src/overpaint.js): one picture pinned to the group's layer's BG map. `{ "world": 0–31, "bgmapBase": 0–15 or null, "mapX", "mapY": 0–8191, "width", "height": 1–4096, "png": "<base64 PNG, width×height>", "hideTiles": boolean }`. `mapX`/`mapY` are pixels of the layer's whole map plane: a plain layer samples it through its scroll (like `layerArt`), a scaled (affine) layer through the VIP's sampling. Drawn over the group's tiles at the world's depth, wherever the group has a tile in a world drawing that BG map — counting only its own patterns, not ones another group on an overlapping world and layer also lists, unless all are shared (src/overpaint-switch.js); with `hideTiles` the layer's tiles are skipped (plain layers). Stored cropped to what is painted (whole when `hideTiles`). Several groups' overpaint on one world are all drawn (the group listed first on top); only one per world can hide its tiles. Replaces `layerArt` and `touchUp`, which SpriteStudio converts on open; when both are present, `overpaint` wins. How it behaves: [overpaint.md](overpaint.md). |
| `anchorHash` | number | No | **BG groups:** the tile pattern that marks where the group is. An old `touchUp` is pinned to it. (Older tools painted a positioned overlay, `painter-v2-vip-overlays.json`, when it appeared once on screen; those are converted to touch-ups when a pack opens.) |
| `tileColors` | object | No | **BG groups:** colours this group alone applies, `{ "<unsigned pattern hash, decimal>": "<base64 of 256 RGBA bytes>" }` (8×8, RGBA). Applied only to draws matching the group's `criteria`, so one pattern can be a different colour in each world that draws it. Beats `color.vbcolor`, loses to a position override. Not gated on the group's pool; gated by `screens` when set — see `src/group-tile-colors.js`, `src/screen-gate.js`. |
| `layerArt` | object | No | **Older packs — read as `overpaint` with `hideTiles`.** **BG groups — layer art:** a picture that replaces the group's whole layer. `{ "world": 0–31, "bgmapBase": 0–15, "mapX", "mapY", "width", "height": integers, "png": "<base64 PNG, width×height>" }`, positioned in the layer's BG-map coordinates. Sampled round the map's wrap, so a picture may span the point where the map loops. SpriteStudio makes new art from map X 0 across every column the game can scroll to: the map's width (512 px, or more) when it wraps, or the map plus one window of overplane filler when the world's OVER flag is set (896 px for a 512-px map and a 384-px window); older art covering only one frame's view can be widened in place (**Cover the whole map**). The picture may also be taller than the layer's window (up to 224 rows, `mapY` up to 8191, **Fill the screen's height** in SpriteStudio): rows above and below the window are drawn at the layer's depth wherever the art covers the map row the screen row maps to. While the group has a tile on screen in a normal-BG world drawing from `bgmapBase`, that world's tiles are skipped and the picture is sampled through the world's scroll and parallax instead, at the world's place in the depth order, dimmed with fades. Painted in SpriteStudio; see `src/layer-art.js`. |
| `touchUp` | object | No | **Older packs — converted to `overpaint` when SpriteStudio opens the pack (kept, and still drawn, when no captured frame places it).** **BG groups — touch-up:** "this spot only" paint pinned to the anchor tile. `{ "anchorHash": uint32, "box": { "dx", "dy", "width", "height" }, "layout": [{ "dx", "dy", "hash" }], "png": "<base64 PNG, width×height>" }`, with `box` and `layout` in pixels relative to the anchor tile's top-left. Drawn wherever a tile with `anchorHash` in the group's worlds has at least 60% of `layout` (the group's tiles around it when it was made) at those offsets; placed per eye from that tile's draw, at the world's depth over its tiles, dimmed with fades; the box is its only limit (it may reach past the world's window, up to the whole screen). On a scaled (affine) world, when `layout` is on the 8 px map grid (made on Base tiles), the anchor and arrangement are found among the map cells the VIP reads and the picture is drawn through the scaling. Covers blank and transparent pixels. Ignored when the group has `layerArt`. Painted in SpriteStudio; see `src/touch-up.js`. **Known limit:** where the layer scrolls far enough that under 60% of `layout` lines up, it is not drawn. **Planned:** replaced, with `layerArt`, by a map-space `overpaint` field — see [overpaint-redesign.md](../design/overpaint-redesign.md). |
| `folder` | string | No | SpriteStudio's folder for the group, segments joined by `/` (`"Enemies/Koopas"`); absent = top level. Organisation only — nothing renders from it. See `src/group-folders.js`. |
| `shadeRamp` | array | No | **Animated tiles:** `[null, "#rrggbb"\|null, "#rrggbb"\|null, "#rrggbb"\|null]`, the colour for shades 1–3, taken from the group's painted patterns by the tools. A claimed slot whose current pattern has no `tileColors` entry is coloured pixel by pixel from it; a shade with `null` stays unpainted. See `src/shade-ramp.js`. |
| `poseOverpaints` | array | No | **BG groups — pictures for single poses** (SpriteStudio: *Overpaint just this pose*; src/pose-overpaint.js). Each `{ "id", "name", "poseId"?, "hashes": [pattern hashes of the pose], "world", "bgmapBase", "mapX", "mapY", "width", "height", "png", "hideTiles": false }` — an overpaint plus the pose's patterns. `poseId` names the saved pose (`poses[].poseId`) it was painted on: while the group has that pose, its patterns are that pose's tile hashes that the group's `criteria.hashes` list (each once), and `hashes` is only the fallback; deleting the pose deletes the entry. Drawn as a `wholePose` group placed right after this one, with its `criteria.windowIds`, `criteria.layers` and `screens` and those patterns: only on a layer where all of them are drawn, and not where a fuller pose's picture is. Entries without patterns or a valid place are ignored. |
| `wholePose` | boolean | No | **BG groups with `overpaint`:** the group is one pose of a character (made by older SpriteStudio, which now folds such groups into their character's `poseOverpaints` on open), its `criteria.hashes` the pose's patterns. Its picture shows only on a layer where every one of those patterns (blank ones aside) is drawn, and not where another whole-pose group shown on the same world holds all of them plus more. It never counts as sharing patterns for other groups' overpaint (src/overpaint-switch.js). |
| `poseOf` | string | No | With `wholePose`: the id of the character's group the pose came from. Only for the tools (SpriteStudio's *Back to …*); colouring ignores it. |
| `followPalette` | boolean | No | **BG groups:** the paint brightens and dims with the game's background palette (Project tool: *Follow the game's palette*). On a world whose lit plain-BG tiles use more than one palette on a frame, a painted pixel is scaled by its shade under its tile's palette (from `gplt`, 0–3) over the brightest shade that pixel value takes under the palettes that world uses; worlds drawn with one palette are unaffected. For menus that highlight the selected option with a brighter palette. See `paletteFollowFactors`, `src/color-layer.js`. |
| `poses` | array | No | **v3:** sprite poses on OBJ groups; background and affine poses on BG groups (§6.7). |
| `tracks` | array | No | **v3, OBJ groups:** named animation tracks (§6.7). |
| `track` | array | No | **Legacy:** the single pre-`tracks` animation, `[{ poseId, durationMs }]`. Still read and converted. |
| `visible`, `expanded` | boolean | No | UI state; may be omitted. |

**WRAM resolution (normative for runtime / paint):**

1. If **`statePoolId`** and **`stateVariantId`** are set and resolve to a variant, use **`variant.ramConditions`**.
2. Else if **`groups[i].ramConditions`** is a non-empty array, use it (legacy).
3. Else no WRAM gate (**`[]`**).

If **`statePoolId`** / **`stateVariantId`** are set but invalid (missing pool or variant), treat as **no match** for gated overrides (fail closed) or **no gate** (fail open): **implementations SHOULD fail closed** (same as unreadable WRAM) so packs do not silently widen scope; tools SHOULD validate on save.

### 6.5 `overridePresets[]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique preset id. |
| `name` | string | Yes | Display name. |
| `layer` | string \| number | No | `any` or **`0`** / **`1`** / **`2`**. |
| `applyAt` | string | No | **`cell`** or **`everywhere`**. |
| `ramConditions` | array | No | §6.2 entries (legacy preset shape). |
| `statePoolId` | string | No | **v2:** Optional default pool when applying preset. |
| `stateVariantId` | string | No | **v2:** Optional default variant when applying preset. |

### 6.6 Full example (schema v2, illustrative)

```json
{
  "groupsSchemaVersion": 2,
  "gameStatePools": [
    {
      "id": "pool-intro",
      "label": "Intro / attract",
      "universal": false,
      "analysisSource": "memoryAnalysis",
      "analysisStateKey": "intro",
      "variants": [
        {
          "id": "variant-safety",
          "label": "Safety screen",
          "ramConditions": [
            { "offset": 1280, "expectedValue": 3, "stateName": "safety", "source": "memoryAnalysis" }
          ]
        },
        {
          "id": "variant-autopause",
          "label": "Auto pause",
          "ramConditions": [
            { "offset": 1280, "expectedValue": 7, "stateName": "autopause", "source": "memoryAnalysis" }
          ]
        }
      ]
    },
    {
      "id": "__universal__",
      "label": "Everywhere (no RAM gate)",
      "universal": true,
      "analysisSource": "manual",
      "variants": [
        {
          "id": "__default__",
          "label": "Default",
          "ramConditions": []
        }
      ]
    }
  ],
  "groups": [
    {
      "id": "grp-safety-text",
      "name": "Safety text",
      "statePoolId": "pool-intro",
      "stateVariantId": "variant-safety",
      "criteria": { "windowIds": [2], "hashes": [4030822197], "layers": [2] }
    }
  ],
  "overridePresets": []
}
```

### 6.7 Sprite poses and tracks (schema v3)

An OBJ group can record the **poses** a sprite takes — which tile patterns sit where,
relative to one **anchor** tile — and **tracks** that play poses as an animation. Normalized
by `src/obj-sprite-profiles.js`; design in [obj-sprite-profiles-design.md](../design/obj-sprite-profiles-design.md).

```json
{
  "id": "group-mario",
  "name": "Mario",
  "authoringKind": "obj",
  "criteria": { "layers": [2], "hashes": [112993102, 772203982, 2232074293] },
  "poses": [
    {
      "poseId": "pose_1",
      "name": "Walk A",
      "anchorHash": 112993102,
      "tiles": [
        { "hash": 112993102, "dx": 0, "dy": 0 },
        { "hash": 772203982, "dx": 0, "dy": 8 },
        { "hash": 2232074293, "dx": 8, "dy": 8 },
        { "hash": 2232074293, "dx": -8, "dy": 8 }
      ],
      "anchorFlipH": true,
      "anchorFlipV": false,
      "allowFlipMacro": true,
      "clippedAtCapture": false,
      "sourceFrameId": "f-mtkcljil-detrhb"
    }
  ],
  "tracks": [
    {
      "id": "track-1",
      "name": "Walk",
      "steps": [
        { "poseId": "pose_1", "holdFrames": 6 },
        { "poseId": "pose_1", "holdFrames": 6, "flipH": true }
      ]
    }
  ]
}
```

- **`tiles[].dx`, `dy`** are pixels from the anchor tile; the anchor is found in a frame by
  its pattern (`anchorHash`), so a pose is located wherever the sprite moves.
- **`sourceFrameId`** is the `frameRegistry` id of the frame the pose was captured from. The
  Current (Colorize!) frame has no registry row and the next Colorize! replaces it, so on Save the
  Project tool gives every pose without one a lasting frame: a saved frame that shows all of the
  pose, or else the Current frame written into `vipstates/` as an ordinary frame (registry
  `stateName` "Current (Colorize!)", with the pack's save state and the WRAM taken from it).
  See `src/pose-source-frames.js`.
- **`tracks[].steps[].holdFrames`** is in VB frames (about 20 ms each); **`flipH`** plays that
  step mirrored. Steps naming a missing pose are dropped on load.
- **`allowFlipMacro`** (default true, *Mirror OK* in the Project tool): the pose is also found
  drawn mirrored — left–right, upside down or both — when it is not there as captured; the tiles keep
  their patterns and sit on the other side of the anchor (`src/pose-mirror.js`). `false` means the art
  is not a true mirror image: its mirrored copy is a pose of its own.
- **BG groups may keep poses too**: frames picked to paint the group on, made in the Project tool
  (**New pose from selection…** on background or affine tiles) or in SpriteStudio (**Keep as pose**
  on a frame card). A background pose has the same shape as a sprite pose. A pose on a scaled
  (affine) layer has `"affine": true` and its `tiles` are just the patterns it shows, with no
  `dx`/`dy` or `anchorHash`, because a scaled layer has no fixed tile positions; it is drawn on its
  `sourceFrameId` frame. When that frame does not show all of it, SpriteStudio looks for the frame
  that shows the most and keeps it as `viewFrameId` (a `frameRegistry` id, written with the next
  save), so it is not searched for again. Poses never change how the emulator colours anything; they only choose
  what SpriteStudio shows. Tracks stay sprite-only.

### 6.8 Related UX spec

Authoring mental model and migration notes: [paint-tool-game-state-pools-ux-plan.md](../history/archive/paint-tool-game-state-pools-ux-plan.md).

---

## 7. References

- [colorize-workflow-vision.md](../design/colorize-workflow-vision.md) — Colorize! → Painter → Save and Play.
- [colorize-workflow-execution-plan.md](../history/archive/colorize-workflow-execution-plan.md) — Phased plan.
- [color-pack-overrides-design.md](../design/color-pack-overrides-design.md) — Position overrides format.
- [paint-tool-game-state-pools-ux-plan.md](../history/archive/paint-tool-game-state-pools-ux-plan.md) — Pools-first UX (points to §6 here for normative names).
- [group-override-design.md](../design/group-override-design.md) — Group semantics and runtime expectations.
