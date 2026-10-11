# Paint editor: use cases and feature matrix

**Status: Archived.** Use cases were implemented in the paint tool. Kept for development archive. See [README.md](../../README.md).

---

This doc clarifies **what can be loaded**, **what can be exported**, and **how loading state affects export and workflow**. Use it to prioritize features and avoid confusion.

---

## 1. Inputs (what the painter can load)

| Input | Format | What it provides | Currently supported |
|-------|--------|------------------|----------------------|
| **Load vbstate** | .json (VIP state) | One frame: draw list, pattern table, GPLT, etc. Required to see a frame and paint. | Yes |
| **Load pack** | .vbcolor | Color pack (hash → RGBA). | Yes |
| **Load pack** | .vbpack / .zip | Color pack + overrides + manifest (gameId) + optional VIP state + optional save state + optional ROM (when present in pack). | Yes |
| **Load overrides** | .json | Standalone overrides array (same as overrides.json inside vbpack). | Yes |
| **Load ROM** | .vb / .bin | ROM binary. Not used for painting; only for including in exported vbpack for one-file loads. | No (backlog) |
| **VIP state(s) from vbpack** | (inside .vbpack) | One or more frames stored in the pack; painter can switch between them without loading separate files. | No (backlog: multiple VIP states + picker) |

---

## 2. Outputs (what the painter can export)

| Export | Contains | Requires (in memory) | Notes |
|--------|----------|----------------------|------|
| **Export .vbcolor** | Color pack only | Pack (from load or painting) | Always available once pack has content. |
| **Export overrides** | overrides.json | Overrides (from load or “This position only” painting) | Button disabled when overrides.length === 0. |
| **Export .vbpack** | ZIP: `rom` (if present) + color.vbcolor + overrides.json + `manifest.json` (+ VIP/save state if present) + optional `art_exports/*.png` (exported scene) | Pack, optional overrides | Sharing/export. ROM is included only when the painter has it (e.g. from Colorize!/Save-and-Play handoff). |

---

## 3. Use-case matrix: load combinations → export and behavior

Rows = what you have loaded. Columns = what works / what you can export. “✓” = works; “—” = not applicable or disabled; “⚠” = partial or caveat.

| Loaded | See frame / paint | Export .vbcolor | Export overrides | Export .vbpack | Notes |
|--------|-------------------|-----------------|------------------|----------------|-------|
| **Nothing** | No | — | — | — | Placeholder: “Load vbstate to start.” |
| **vbstate only** | Yes | ✓ (empty or from painting) | ✓ if you add overrides | ✓ | Pack starts empty; you paint to add. |
| **vbstate + .vbcolor** | Yes | ✓ | ✓ if overrides | ✓ | Normal “paint on frame” workflow. |
| **vbstate + .vbpack** | Yes | ✓ | ✓ | ✓ | Pack + overrides from vbpack; can edit and re-export. |
| **vbstate + overrides.json** | Yes | ✓ (if pack loaded) | ✓ | ✓ | Overrides only; pack from elsewhere or empty. |
| **.vbpack only (no vbstate)** | No | ✓ (pack from vbpack) | ✓ (overrides from vbpack) | ✓ | Status: “Pack loaded: N tiles, M overrides. Load vbstate to paint.” |
| **.vbcolor only (no vbstate)** | No | ✓ | — | ✓ | Same idea; no frame to show. |
| **ROM** (future) | No | — | — | ✓ (with ROM) | Export .vbpack would include ROM so emulator one-click loads. |

---

## 4. Gaps and planned features (from this matrix)

| # | Feature | Why |
|---|---------|-----|
| 1 | **Vbpack includes VIP state(s)** | Implemented for a single current frame (`vipstate-current.json`). Backlog: multiple frames + picker. |
| 2 | **Vbpack has a directory for VIP states** | Multiple frames (e.g. title, level 1, boss) in one pack; manifest or list points to “current” and painter can switch. |
| 3 | **Painter: list of VIP states from vbpack** | When vbpack contains multiple VIP states, show a list/dropdown and switch current frame without loading separate vbstate files. |
| 4 | **Painter: include ROM in exported .vbpack** | Implemented for the Colorize!/Save-and-Play flow (ROM is carried in the handoff vbpack). Backlog: optional standalone “Load ROM” UI in painter. |
| 5 | **Painter: include current VIP state in exported .vbpack** | Implemented: painter exports `vipstate-current.json` when a frame is loaded. |
| 6 | **Clear feedback when loading vbpack with no vbstate** | Status message: “Pack loaded: N tiles, M overrides. Load vbstate to paint.” (Implemented.) |
| 7 | **Load overrides.json (standalone)** | So user can cobble together: load vbstate + .vbcolor + overrides.json, then export .vbpack. (Implemented.) |

---

## 5. Vbpack layout (target)

To support the above, the vbpack should evolve to:

| Path | Purpose |
|------|---------|
| `rom` or `rom.bin` | ROM (for emulator one-click load). |
| `color.vbcolor` | Color pack. |
| `overrides.json` | Position overrides. |
| `manifest.json` | gameId, name, **currentVipStateRef**, **vipStateList** (optional), etc. |
| **VIP directory** | e.g. `vipstates/vipstate-1.json`, `vipstates/vipstate-2.json`, or `vipstate-current.json`. Multiple files = multiple frames; manifest can list them and point to “current.” |
| Save state | (Phase B/D) For “Save and Play” restore. |

Painter: when loading .vbpack, if VIP directory or `vipstate*.json` entries exist, populate a “VIP states” list and allow switching the current frame from that list. When exporting .vbpack, include current vbstate (and optionally others) in the VIP directory.

---

## 6. Summary table: what to implement next

| Priority | Item | Doc reference |
|----------|------|----------------|
| Done | Feedback when vbpack loaded with no vbstate | §6 above |
| Done | Load overrides.json (standalone) | §4.7 |
| Next | Vbpack: directory for VIP states + manifest refs | §4.1, §4.2, §5 |
| Next | Painter: list of VIP states from vbpack, switch between them | §4.3 |
| Next | Painter: include current VIP state in exported .vbpack | §4.5 |
| Next | Painter: optional Load ROM; include ROM in exported .vbpack | §4.4 |
| Done | Save state in vbpack (Save and Play) | Save state lives in `save-state.state` and is restored on return to the emulator. |

This table and the use-case matrix above should be enough to drive the feature list and implementation order.
