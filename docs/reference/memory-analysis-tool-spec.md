---
status: current
last-reviewed: 2026-10-09
covers: tools/memory-analysis-inbrowser.js, src/seed-game-state-pools-from-memory-analysis.js
---

# Memory analysis tool — specification (v1)

This document specifies a **new memory-analysis browser tool** (`tools/memory-analysis.html`) that computes **stable/discriminant WRAM bytes** from captured `.vbpack` frames and **writes the results back into the `.vbpack`** for later `ramConditions`-based game-state overrides. An offline Python analyzer may be used for debugging/comparison, but the v1 write-back path is the in-browser analyzer.

**Related:** [art-pack-file-format.md](art-pack-file-format.md), [game-memory-locations.md](game-memory-locations.md), [group-override-design.md](../design/group-override-design.md).

---

## 1. Problem statement

- **VIP state** (`vipstates/*.json`) is **not sufficient** for game-state RAM analysis.
- Today each VIP JSON holds: pattern table, OAM, segments, windows, draw list, palettes/capture metadata — i.e. **what the VIP drew for one frame**, not arbitrary **CPU work RAM** where games store level ID, screen mode, menu index, etc.
- **Emulator save states** from **RetroArch / EmulatorJS** are **`RASTATE` v1** wrappers around the core’s **`retro_serialize`** blob. For Beetle VB that inner blob is **Mednafen `MDFNSVST`** (same layout as `MDFNSS_SaveSM`), from which tools extract **64 KiB WRAM**. The JS helper `tryExtractWramFromMednafenSavestate` and the Python analyzer **unwrap `RASTATE` → `MEM ` block** before parsing `MDFNSVST`; see `task_save.c` (`content_write_serialized_state`).

**Conclusion:**  
Prefer explicit **`ramdumps/*.wram.bin`** in the `.vbpack` (written on Capture Frame / export). If missing, the analyzer falls back to **`savestates/<frameId>.state`** using the unwrap + WRAM parse above.

---

## 2. Goals (v1)

| Goal | v1 |
|------|----|
| User captures many frames with **human-meaningful labels** | Yes — dialog on **Capture Frame** |
| **Screenshots** in .vbpack for browsing | Yes — `screenshots/<frameId>.png` |
| **Stable frame identity** | Yes — `frameId` + manifest **`frameRegistry`** |
| **Annotation**: `stateName`, `subStateName`, `note` | Yes — stored in registry; editable in memory-analysis tool |
| **WRAM analysis (write-back)** | Yes — in-browser analyzer computes candidates and writes **up to 10** top discriminant locations per analyzed `stateName` into the `.vbpack` manifest |
| Cross-pack analysis inside app | No — user may diff reports manually |
| In-browser WASM/Python for analyzer | Yes — runs as JS on loaded `ramdumps/*.wram.bin` and produces `manifest.memoryAnalysis` |

---

## 3. User workflow (target)

1. In the **main emulator**, user plays the game and clicks **Capture Frame** multiple times across **high-level** states (splash, menu, in-game, …).
2. On each capture, a **dialog** collects:
   - **`stateName`** (required for clarity; default if skipped: e.g. `State 001`, incrementing)
   - **`subStateName`** (optional; default empty or `—`)
   - **`note`** (optional)
3. Each capture creates **four** linked artifacts (same **`frameId`**):
   - `vipstates/<frameId>.json` (existing VIP dump; filename convention TBD to match registry)
   - `savestates/<frameId>.state` (optional but recommended — **restore point**, not used by analyzer v1)
   - `screenshots/<frameId>.png` (preview for memory-analysis UI)
   - **`ramdumps/<frameId>.wram.bin`** (new — **64 KiB WRAM** at CPU addresses `0x05000000`–`0x0500FFFF`, or as defined by core; see §5)
4. **`manifest.json`** gains a **`frameRegistry`** array (see §6) listing each frame’s metadata and file names.
5. **Usual path (Sep 2026):** in the **Project tool**, with the pack open, choose **File → Analyze memory**. It runs the same analyzer on the open pack, writes `manifest.memoryAnalysis`, seeds (or extends) `gameStatePools` from it, and leaves the result to the normal **Save** — no export, no second file.
6. **Standalone page** (`tools/memory-analysis.html`): load the .vbpack, browse frames (thumbnail + `stateName` / `subStateName`), **Run WRAM analysis**, then **Apply analysis to manifest** (updates an in-memory copy of the zip).
7. …then **Save annotated .vbpack**, which writes `<name>-annotated.vbpack` to the project home when one is set, otherwise downloads it. That is a *second* file; open it in the Project tool to use the analysis. Step 5 avoids this.

**MVP rigor**

- **At least two** captures sharing the same **`stateName`** are required to treat that state as having “intra-state stability” signal (values that stay fixed while sub-state or time advances). **UI labels these families “low confidence” if only one frame exists.**
- **Recommendation:** **2–3 captures** per high-level **`stateName`** you care about; different **`stateName`** values across menus/title/in-game so cross-state discrimination is possible.

---

## 4. WRAM analysis mode

| Approach | Pros | Cons |
|----------|------|------|
| In-browser (v1) | No Python install; immediate write-back into `.vbpack` manifest | JS CPU cost; must load `ramdumps/*.wram.bin` |
| Python (optional) | Easy diff/CI; produces richer reports | Requires Python + does not write back into the pack |

**Decision:** v1 = **in-browser analyzer with write-back** into `manifest.memoryAnalysis`. Python remains available for comparison/debugging.

---

## 5. RAM dump format (`ramdumps/`)

### 5.1 Contents

- **Path:** `ramdumps/<frameId>.wram.bin` (or `.bin`; extension fixed in spec when implemented).
- **Payload:** linear dump of **Virtual Boy WRAM** as visible to the game CPU:
  - **Size:** `0x10000` (65 536) bytes for the canonical 64 KiB WRAM window.
  - **Semantic mapping:** byte offset `i` in the file corresponds to CPU address `0x05000000 + i` (see Sacred Tech Scroll / [game-memory-locations.md](game-memory-locations.md)).

### 5.2 Producer

- **Must** be generated at capture time from the **emulator core** (patched WASM), not inferred from VIP JSON.
- If the core exposes WRAM only via a C hook, the same bytes should be copied into this file.
- **Endianness:** document as **little-endian** for any future multi-byte reads in tools; raw bytes in v1 are compared **per byte**.

### 5.3 Optional metadata JSON (future)

For debugging, an optional `ramdumps/<frameId>.meta.json` could record `capturedAt`, core version, endianness — **not required for v1 analyzer**.

---

## 6. Manifest: `frameRegistry`

Extend `manifest.json` with an optional top-level key:

```json
{
  "version": 1,
  "gameId": "mario-clash",
  "frameRegistry": [
    {
      "frameId": "frame-7f3a2b01",
      "stateName": "Splash — Nintendo logo",
      "subStateName": "",
      "note": "",
      "vipStateFile": "vipstates/frame-7f3a2b01.json",
      "screenshotFile": "screenshots/frame-7f3a2b01.png",
      "ramdumpFile": "ramdumps/frame-7f3a2b01.wram.bin",
      "saveStateFile": "savestates/frame-7f3a2b01.state"
    }
  ]
}
```

Rules:

- **`frameId`**: stable, unique within pack — `f-<time in base 36>-<random>`, e.g. `f-mtkciint-89r4p7` (`generateFrameId` in `src/frame-capture.js`). Renaming **display** fields does not change `frameId`.
- **`stateName` / `subStateName` / `note`**: user-editable in memory-analysis tool; must stay in sync when pack is re-saved.
- File paths are **relative to zip root**; names must match actual zip entries.
- Added later: **`number`** — a short frame number shown as `#57`, never reused (`src/frame-numbers.js`); **`name`** and **`tags`** typed by hand in the Project tool's Frame details (`src/frame-metadata.js`).

If `frameRegistry` is missing, v1 memory-analysis tool may **build a provisional registry** from `vipstates/*.json` + matching `screenshots/` and `ramdumps/` by filename stem — but **authoritative** packs should always write `frameRegistry` on capture.

---

## 6.1 Manifest: `memoryAnalysis` (written by in-browser analyzer)

The analyzer writes an optional `manifest.memoryAnalysis` object into the `.vbpack` — from the Project tool's *Analyze memory* or the standalone page — so memory pools (`gameStatePools`) can be seeded without re-running analysis. The Project tool also uses the pools' `ramConditions` to match each captured frame to its game screen by its own RAM (`src/pool-match-by-ram.js`).

Suggested shape:

```json
{
  "memoryAnalysis": {
    "version": 1,
    "analyzerVersion": "2.1-js",
    "generatedAt": "ISO-8601",
    "wramSize": 65536,
    "wramIngest": {
      "framesWithWram": 17,
      "fromRamdumpManifest": 17,
      "missingWramFrames": 0,
      "eligibleStateCount": 8
    },
    "framesCapturedByStateName": { "Title": 2, "InGame": 3 },
    "lowConfidenceStateNames": ["Pause"],
    "topCandidatesPerStateSaved": 10,
    "candidateTotal": 1181,
    "candidateTotalVeryHigh": false,
    "topCandidatesByState": {
      "Splash": [
        {
          "offset": 284,
          "addressCpu": "0x0500011C",
          "expectedValue": 0,
          "score": 3,
          "valuesByStateName": { "Splash": 0, "Menu": 140, "Title": 140 }
        }
      ]
    }
  }
}
```

Rules:
- The tool computes **stable-by-state** bytes from `ramdumps/*.wram.bin` (with a slower savestate fallback only if needed).
- It keeps the **top 10** (configurable in code) discriminant locations per **analyzed** `stateName` (stable within that state; different across other analyzed `stateName`s). States with **&lt; 2** captures are listed in **`lowConfidenceStateNames`** and omitted from the comparison.
- `candidateTotal` is the global number of candidate offsets; **`candidateTotalVeryHigh`** flags suspiciously large counts.

---

## 7. Capture Frame dialog (main emulator)

- **Trigger:** user clicks **Capture Frame**.
- **Modal fields:**
  - **State (high-level)** → maps to `stateName`
  - **Sub-state** → maps to `subStateName`
  - **Note** (optional)
  - Buttons: **Save capture** / **Skip** (use defaults)
- **Defaults if skipped:**
  - `stateName`: `State` + zero-padded incremental counter (e.g. `State 001`)
  - `subStateName`: empty string
  - `note`: empty string
- On confirm: allocate `frameId`, write all files, append/update `manifest.frameRegistry`.

---

## 8. Memory analysis tool page (`tools/memory-analysis.html`)

### 8.1 Behaviors

- Load **.vbpack** (file picker).
- Parse manifest + zip entries; read `frameRegistry` and locate `ramdumps/*.wram.bin`.
- UI: list frames grouped by `stateName` (expand/collapse), showing screenshot + frame metadata.
- Selecting a frame shows large preview image + per-frame RAM file status.
- Run an **in-browser WRAM analysis** that finds offsets stable within each high-level `stateName` and discriminant across `stateName`s.
- After analysis completes:
  - Show summary including `candidateTotal` and `topCandidatesByState`.
  - User clicks **Apply analysis to manifest** (updates the in-memory zip only).
  - User clicks **Save annotated .vbpack** to write the pack with `manifest.memoryAnalysis` embedded (to the project home when set, otherwise a download).
- The same analyzer runs inside the Project tool (**File → Analyze memory**) on the open pack; see §3 step 5.

### 8.2 Non-goals (v1)

- No automatic “best address” UI graph.
- No cross-pack merge in-app.

---

## 9. Optional Python analyzer — behavior (debug/comparison only)

### 9.1 Input

- Path to `.vbpack` (zip).
- Read `manifest.frameRegistry`; load each `ramdumpFile`; require **equal length** (65536) for all frames with RAM.

### 9.2 Grouping

- Group frames by **`stateName`** (exact string match after trim).
- Ignore groups with **&lt; 2** frames for “stability within state” (emit warning in report).
- Collect every distinct **`stateName`** present for “differs across states.”

### 9.3 Per-byte logic (v1 — binary pass/fail, no score)

For each byte offset `i` (0 … 65535):

1. **Within-state stable:** For **every** group `G` with ≥2 frames, the byte value is **identical** across all frames in `G` (sub-states can differ — that’s the point).
2. **Across-state discriminating:** There exist **at least two** groups `G1`, `G2` (with ≥1 frame each) such that the stable value in `G1` (if defined) **≠** stable value in `G2`.

**Note:** “Stable value per group” for a group with one frame is just that frame’s byte (useful for discovery but weaker — report should label single-frame groups separately).

Output **candidate offsets** that satisfy (1) and (2). **No numeric score in v1** — either an offset is a candidate under these rules or not. Optional **tie-break** sort: prefer offsets where **more** state groups participate (future).

### 9.4 Outputs

| File | Purpose |
|------|---------|
| `memory-analysis-report.json` | Machine-readable; compare across ROMs/projects |
| `memory-analysis-report.md` | Human-readable summary |

Suggested JSON shape (illustrative):

```json
{
  "vbpack": "mario-clash.vbpack",
  "gameId": "mario-clash",
  "generatedAt": "ISO-8601",
  "warnings": ["state 'Foo' has only one frame"],
  "states": {
    "Splash A": { "frameIds": ["..."], "frameCount": 3 }
  },
  "candidates": [
    {
      "offset": 1292,
      "addressCpu": "0x0500050C",
      "valuesByState": { "Splash A": 0, "Menu": 2, "InGame": 7 }
    }
  ]
}
```

Markdown should list candidates with CPU address, hex dump of per-state values, and warnings.

### 9.5 Errors

- Missing `ramdumps/`: **fail** with clear message — “VIP-only pack; add core RAM capture.”
- Mismatched RAM lengths: fail.

---

## 10. Save states vs RAM dumps (FAQ)

| Source | Use in v1 analyzer |
|--------|-------------------|
| **VIP JSON** | No — no CPU WRAM |
| **`.state` file** | Optional fallback: used only if a frame’s `ramdumpFile` is missing (formats are parsed via the existing RASTATE→`MDFNSVST` helper) |
| **`ramdumps/*.wram.bin`** | **Yes** — canonical input |

---

## 11. Implementation phases

*Status Oct 2026:* 1a–1c are built — the Project tool runs the same analyzer from **File ▸ Analyze memory** on the open pack (`tools/memory-analysis-inbrowser.js`), and its results seed memory pools. 1d exists as a legacy CLI. Game states (named memory conditions that groups can depend on) went further than phase 3: see [memory-states.md](../design/memory-states.md).

| Phase | Deliverable |
|-------|-------------|
| **1a** | Core + main app: on Capture Frame, write `ramdumps/<frameId>.wram.bin`, screenshot, update `frameRegistry` |
| **1b** | `buildArtPack` / `parseArtPack`: include `ramdumps/`, `screenshots/`, read/write `frameRegistry` |
| **1c** | `tools/memory-analysis.html` + **in-browser WRAM analyzer** + **Apply analysis to manifest** merges `memoryAnalysis`, then **Save annotated .vbpack** downloads the updated pack |
| **1d** | Optional: keep `tools/memory-analysis/analyze_vbpack_ram.py` for debug/CI diffing (does not write back into the pack) |
| **2** | Optional: masks, multi-byte fields, confidence heuristics |
| **3** | Optional: integrate candidate import into `game-memory-locations.md` or group UI |

---

## 12. Open items (before coding) — resolved

Kept for the record: `frameId` comes from `generateFrameId` (`src/frame-capture.js`), and Capture Frame writes the save state, RAM dump, VIP state and screenshot together.

- Exact **`frameId`** generator and **VIP file naming** (migrate from `frame-1.json` if needed).
- Whether capture always writes **save state** + RAM + VIP + screenshot atomically (recommended).
- Core hook name and whether WRAM is **zero-padded** if a future core variant uses smaller RAM window.

---

## 13. References in repo

- VIP serialize: `src/vip-dump.js` (`serializeVIPState` — no WRAM fields).
- Pack build/parse: `src/art-pack.js`.
- Save state API: `public/data/src/GameManager.js` (`getState` → `EmulatorJSGetState`).
