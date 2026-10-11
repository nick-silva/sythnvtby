---
status: partial
last-reviewed: 2026-10-09
covers: src/handoff-store.js
---

# Colorize! workflow vision

This doc describes the target user flow: **Colorize!** (emulator) → **Paint** (painter with current frame) → **Save and Play** (back to emulator with updated art, same frame, paused).

## As built (Sep 2026; checked Oct 9)

The loop exists; the rest of this doc is the original vision, kept for its reasoning.

1. **Colorize!** pauses, snapshots the save state and the current VIP state, builds a
   `.vbpack` from the ROM, colors, overrides, groups and **every** captured frame, and hands
   it over through IndexedDB (`src/handoff-store.js`, key `colorize-current`). It then opens
   the **Project tool** (`tools/project.html?from=emulator`), which loads that pack. If you
   had opened a pack file, its file handle travels along too.
2. **Save and Play** (Project tool) rebuilds the pack, **overwrites the `.vbpack` you opened**
   (keeping `<name>.bak.vbpack`), hands it back through IndexedDB (`save-and-play`), and
   returns to the emulator. The emulator loads it, restores the save state, and **keeps
   playing** with keyboard focus on the game.

**Not built:** the "paused until input" step below (resuming straight away was preferred).
Pruning old captures is **File ▸ Clean up frames…** in the Project tool (Oct 2026). The override-art editing
in §4 belonged to Paint v1, which has been removed.

---

## 1. High-level flow

1. **Emulator (main app):** User has a .vbpack loaded (ROM + color pack + overrides; optionally save state, VIP states). They play until they want to edit art (e.g. title screen, a specific frame).
2. **User clicks “Colorize!”** → Emulator pauses, creates a **save state** and a **VIP state** (current frame’s draw list + pattern data), then navigates to the **painter** with:
   - **Not used in painter:** ROM (painter doesn’t run the game).
   - **Used in painter:** Newly captured **VIP state** (the frame to paint), current **vbcolor** and **overrides** from the vbpack.
3. **Painter:** User edits pack (tiles) and/or **override art** (position-only tiles). Optional: load/save .vbpack here too. When done →
4. **User clicks “Save and Play”** → Painter builds the **updated .vbpack** (includes the **save state** so we can restore the same frame), then navigates back to the **emulator**. Emulator loads the updated vbpack (ROM, updated vbcolor, updated overrides, **save state**), restores to that frame, applies new art, and is **paused** until the user presses a key (or similar) to resume.
5. **Result:** User continues from the same moment in the game, with new colors/overrides applied.

---

## 2. What lives in the vbpack

| Entry | Purpose |
|-------|--------|
| `rom` / `rom.bin` | VB ROM. |
| `color.vbcolor` | Color pack (tile hash → RGBA). |
| `overrides.json` | Position overrides (same tile, different color in a rectangle). |
| `manifest.json` | Metadata (gameId, name, romFileName, **currentSaveStateRef**, **currentVipStateRef**, etc.). |
| **Save state(s)** | Emulator save state (core-specific format) so we can restore exact frame. One “current” for resume-after-paint; old ones can accumulate (cleanup backlog). |
| **VIP state(s)** | Snapshot of frame (draw list, pattern table, etc.). Used by painter as the frame to edit. “Current” = the one from last Colorize!; old ones can be kept for reference or cleaned out (backlog). |

So the pack is the single source of truth: ROM, art (vbcolor + overrides), and enough state to “resume from this frame” (save state) and “paint this frame” (VIP state).

---

## 3. Emulator (main app) behavior

- **Load pack** already applies ROM + vbcolor + overrides. Later: also apply **current save state** if present (restore emulator to that frame) and mark “paused until input.”
- **Colorize!** (new button):
  - Pause emulation.
  - Request **save state** from the core (if API exists) and **VIP state** (already have via `__VB_PUSH_VIP_STATE__`).
  - Persist save state and VIP state (e.g. into memory or pass to painter via URL/state).
  - Navigate to painter (built as `tools/project.html?from=emulator`) with: vbpack context (vbcolor, overrides), new VIP state, and save state (or a way to get it into the pack when saving).
- **Return from painter:** Painter redirects back with “updated vbpack” (e.g. as a download that user re-loads, or via postMessage / shared storage). Emulator loads updated vbpack, restores **save state** from the pack, applies new vbcolor/overrides, stays **paused** until first input.

---

## 4. Painter behavior

- **Entry from Colorize!:** Receives: current vbcolor, overrides, and **new VIP state** (the frame to paint). No ROM needed; paint tool renders from VIP state.
- **Load pack (in painter):** Can open a .vbpack to get vbcolor + overrides + optional VIP state(s). So user can “open project” in painter too.
- **Override art editing:** User can paint tiles as “this position only” (override) and see **override highlighting** on the scene. Not yet implemented; see paint-tool-overrides-flow.md and execution plan.
- **Save and Play:** Build updated .vbpack containing:
  - Same ROM (if we had it; when coming from Colorize! we might pass pack ref or re-include from emulator context).
  - Updated **color.vbcolor** and **overrides.json**.
  - **Save state** (so emulator can restore to same frame).
  - **VIP state** (optional; can keep for history).
  - Updated **manifest** (currentSaveStateRef, etc.).
  Then: navigate back to emulator and pass the updated vbpack (e.g. auto-load or “pack updated, click to load”).

---

## 5. Paused state

After loading a pack that contains a save state (or after returning from painter), the emulator restores that state and stays **paused**. User presses a key (or “Resume” button) to unpause. This avoids the game running ahead before they’re ready.

---

## 6. Backlog: cleanup of old states

- **Save states:** Pack may accumulate multiple save state files (e.g. `save-state-1.state`, `save-state-2.state`). “Current” is referenced in manifest. Later: UI to delete old save states from the pack.
- **VIP states:** Similarly, multiple VIP state snapshots (e.g. for different frames) could be stored; manifest points to “current” for the painter. Later: UI to remove old VIP states to keep pack size down.

---

## 7. Dependencies for this vision

1. **Override art editing in painter** — “Apply to: This position only” + override list + scene use overrides + override highlighting. (See paint-tool-overrides-flow.md.)
2. **Painter load/export vbpack** — Load .vbpack (vbcolor, overrides, VIP state; optionally ROM + save state). Export .vbpack (vbcolor, overrides, optional VIP state, and ROM when the painter has it).
3. **Save state in vbpack** — Format and manifest fields for “current” save state; emulator can save/restore it.
4. **VIP state in vbpack** — Store at least one VIP state (e.g. `vipstate.json` or `vipstate-current.json`); manifest refs it; painter loads it as the frame to edit.
5. **Colorize! in emulator** — Pause, capture save state + VIP state, hand off to painter (URL params, sessionStorage, or in-memory pack).
6. **Save and Play in painter** — Build vbpack with save state + updated art, then return to emulator and load it.
7. **Emulator “paused until input”** — After restore, don’t advance until user confirms.

See **docs/history/archive/colorize-workflow-execution-plan.md** for a phased implementation plan. Override art editing in the painter is specified in **docs/history/archive/paint-tool-overrides-flow.md**.
