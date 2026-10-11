---
status: current
last-reviewed: 2026-09-18
covers: src/vbcolor-pack.js
---

# .vbcolor loading in the main emulator

Notes on when a color pack works and why it might not. Usually colors arrive inside a `.vbpack` (**Load pack** or **Last pack**), which also switches Color mode on. This page covers the standalone **Color pack (optional)** input, which loads a bare `.vbcolor`.

## Load order

1. **Load ROM** first.
2. **Load .vbcolor** (Color pack file input).
3. Set **Display** to **Color**.

The color layer only draws when it has both: (a) a loaded pack, and (b) VIP state from the core each frame (pattern table + draw list). If you load the pack before the ROM, that’s fine — the pack stays in memory. If you never load a pack, Color mode shows nothing.

## After a page reload

A `.vbcolor` loaded through the standalone input lives only in memory (`colorPackData`), so a reload loses it — load the file again and switch to Color. Packs don't have this problem: **Last pack** restores the whole `.vbpack`, colors included, from browser storage.

## When Color mode shows nothing

- **CDN core:** The stock CDN Beetle VB core does **not** push VIP state, so the color layer never draws. The app uses the patched local core by default (`USE_LOCAL_CORE = true` in `src/main.js`); this only bites if that is switched off.
- **Pack not loaded:** Load the .vbcolor file before or after the ROM; then switch to Color.
- **After reload:** Reload a standalone .vbcolor after any page reload.

## "Frozen" at one screen

If you did see colored sprites once but the image seemed frozen: the pack was working. The frame might have been paused, or the core might have stopped pushing new VIP state in that state. Ensuring the game is running (not paused) and the patched core is active should give you live updates.

## Boot logo (e.g. VB logo at startup)

If you made a pack from the **boot logo** (e.g. the Virtual Boy logo when a game starts), color may still not show for that screen. Reasons:

1. **VIP state timing** — The patched core might only start pushing VIP state after the first frame or two, so the exact frame you captured in the paint tool might not be the same as what the core sends when the logo is on screen.
2. **Hash mismatch** — Tile content (and thus hashes) must match exactly. If the core’s pattern table or draw list for the logo differs slightly from the vbstate you used (e.g. different segment/window state, or a different frame), hashes won’t match and the pack won’t be used for those tiles.
3. **Draw list empty** — Some cores might not export a draw list for the very first frames. Check the status line: it should show “VIP: N draws” with N &gt; 0 when the logo is visible. If it shows “VIP: state but no draw list”, the color layer has nothing to draw.

**What to try:** Let the game run past the logo into a screen where you know the core is pushing state (e.g. title screen or in-game). Load your pack, switch to Color, and see if any tiles colorize. If you see “Pack: test (13 entries)” and “VIP: 0 draws” (or “no draw list”) during the logo, the core isn’t sending draw list for that frame.

## Status line in the app

The main app shows a line under the color hint: **“Pack: … . VIP: …”**. Use it to confirm:

- **Pack: not loaded** — Load the .vbcolor file again.
- **Pack: test (13 entries)** — Pack is loaded.
- **VIP: no state** — The core isn’t pushing VIP state (e.g. CDN core, or game not started).
- **VIP: state but no draw list** — Core sends state but without a draw list; color layer won’t draw.
- **VIP: N draws** — Core is sending a draw list; if you’re in Color mode and the pack has matching hashes, tiles should colorize.

## Possible improvement

A standalone `.vbcolor` could be remembered across reloads the way **Last pack** remembers a `.vbpack`. Not implemented; loading colors through a `.vbpack` avoids the problem.
