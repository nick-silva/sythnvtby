# Paint tool: backlog (deferred until graphics glitches are addressed)

These features are **not built yet**. We are prioritizing graphics investigations first, but the next paint-tool workflow we want to plan is **sprite-first image import/export** so we can work on sprite-based games before attempting affine-heavy ones.

**See:** [graphics-next-investigations.md](../../planning/graphics-next-investigations.md) for current focus. **Paint tool positions and manifest:** [paint-tool-vip-positions.md](paint-tool-vip-positions.md) (how we use VIP (x,y), BG/OBJ, and whether we can detect “offset” from state).

---

## Backlog items

### Painter v2: VIP index-0 / mono transparency parity with hardware

**Deferred:** In Painter v2 preview, some pixels that are **hardware-transparent** (VIP 2bpp palette index 0) or **shallow no-pack stacks** can still look like **solid diagnostic mono** because the tool uses `unpackedMinCoverage: 1` and a red mono fallback for authoring. The main app defaults to **`unpackedMinCoverage: 2`** so lone no-pack tiles stay transparent in the color buffer (see `docs/reference/color-layer-z-order-and-performance.md`). **Not blocking colorize workflow** until authoring UX needs stricter parity.

---

### Groups panel: game state (WRAM) at top level (UX redesign)

**Requested (March 2026 testing):** Restructure the **Groups** side panel so **memory / game-state matching** is **first-class at the top level** (e.g. sections or tabs per analysis state, with groups or tile sets **under** each state), instead of only **inside** each expanded group’s “Game-state (WRAM)” block.

**Why:** Authors think in terms of “safety screen vs auto-pause” (discriminant WRAM) and then attach tiles; nesting RAM inside every group fights that flow.

**See also:** [priorities-and-next.md](../../planning/priorities-and-next.md) (user testing backlog). **Full plan (pools, variants, universal):** [paint-tool-game-state-pools-ux-plan.md](paint-tool-game-state-pools-ux-plan.md).

---

### Tile editor: strip selection box when copying imported PNG

**Reported:** Pasting or copying from an **imported PNG** into the tile editor brings the **selection rectangle / UI chrome** into the bitmap as if it were art.

**Expected:** Only the **actual image pixels** (or a defined crop) should transfer; selection overlays should be **ignored** or explicitly excluded in the import/copy pipeline.

**See also:** [priorities-and-next.md](../../planning/priorities-and-next.md) (user testing backlog).

---

### 0. Bug: Save and Play — vbpack handoff fails when using a remote client (e.g. Windows PC → dev server)

**Reported:** When connecting to the app from **another machine** (e.g. Windows PC on the LAN hitting a dev server), **Save and Play** from the paint tool does **not** load the returned `.vbpack` on the main emulator page, even though the flow works when developing locally on the host.

**Expected:** After **Save and Play**, `/?from=painter` loads; `maybeApplySaveAndPlayHandoff()` in `src/main.js` reads `HANDOFF_KEY_SAVE_AND_PLAY` from IndexedDB and applies the pack (ROM, color, overrides, save state, etc.).

**Mechanism (for investigators):**

- Handoff uses **`src/handoff-store.js`**: IndexedDB database `vb-handoff`, store `handoff`. Keys include `save-and-play` (blob) and `colorize-current` (Colorize! flow).
- Storage is **per-origin** (scheme + host + port) and **per browser profile** on the **client** that ran the paint page. The paint tool **writes** the buffer, then `location.href = '/?from=painter'` (or similar) navigates the **same tab** to the emulator so the **same** origin + profile can **read** it back.
- **Workaround:** Download **Export .vbpack** / **Save .vbpack** on the paint client and **Load pack** manually on the emulator page (same session or file).

**Hypotheses to investigate:**

1. **`getHandoff` returns null** — write/read race (unlikely if verify exists for Colorize); navigation before `putHandoff` completes; or storage errors swallowed (`maybeApplySaveAndPlayHandoff` early-returns if `!buffer`).
2. **Origin mismatch** — emulator opened as `http://server:port` but paint as `http://127.0.0.1:port` (or different hostname), so IndexedDB is a different database.
3. **Remote / reverse proxy** — tunnel, HTTPS gateway, or `Host` header changes that alter effective origin or block IndexedDB in embedded contexts.
4. **Browser policy** on remote client — **third-party** cookie/storage blocking if the app is framed incorrectly; **InPrivate** / strict storage; corporate policies.
5. **Query params** — `from=painter` missing or stripped by redirect so `maybeApplySaveAndPlayHandoff` never runs (check `location.search` after load).

**Observed in related cases:** Manual `.vbpack` export round-trip is correct (data not corrupted); issue is **in-session handoff**, not pack contents.

**Priority:** Medium when remote / multi-machine dev is common.

**Implementation ideas (future):** Server-side handoff session (opaque id in URL + POST blob), or `sessionStorage` + `BroadcastChannel` only if same-tab guarantees aren’t enough — **not** a small change; IndexedDB same-origin handoff is the intended MVP.

---

### 1. Image import/export for sprite-first workflows

**Goal:** Let the painter **import and export raster images** for the current selection / tile region so we can work on sprite-based games first. The exact format is still to be decided, but the likely target is a PNG-style round trip or equivalent image file format that maps cleanly to the current draw selection.

**Use case:** Start with a sprite-heavy scene, import a reference image or export a painted region, and iterate on sprite art without needing affine support first.

**Notes:** Keep this explicitly separate from affine mode. This is the priority workflow we want before investing in rotation/skew-heavy rendering.

---

### 2. Dynamic tile painter: selection-driven, adjacent tiles (no grid style)

**Current:** Tile painter context grid is fixed **3×3** (one center tile + 8 neighbors), shown as a grid of separate cells.

**Goal:** The tile painter is **driven by the main canvas selection** (see item 4). It shows **exactly the selected N×M tiles** as **one contiguous block**: tiles rendered **adjacent to each other** with no gaps (no grid-style layout). So the painter canvas is (N×8)×(M×8) pixels for an N×M tile selection. **Remove** the 3×3 grid style entirely.

**Notes:** Foundation for the sprite-first import/export workflow. See [paint-tool-image-import-export.md](paint-tool-image-import-export.md) §2b. Implementation order: selection first, then tile editor layout.

---

### 3. Universal layer selector (remove per-tile layer picker)

**Current:** Each cell in the tile painter grid can have a **per-cell layer** dropdown (when multiple draws stack at that pixel), so the user picks which layer to display per cell.

**Goal:** **Remove** the layer selector from individual tiles in the grid. Use a **single universal layer** selector (e.g. one dropdown or control above the grid) that applies to the whole tile painter. Adjacent tiles are almost always on the same layer together, so per-tile layer is awkward; one global choice is simpler.

**Notes:** When multiple draws exist at a cell, we can show the one that matches the selected layer, or a sensible default (e.g. topmost that matches). No implementation until after graphics work.

---

### 4. Active selection on main canvas (drag or two-corner) → tile painter and staging

**Current:** User **clicks** a pixel → gets draws at that point → picks one draw → tile painter shows 3×3 around that tile.

**Goal:** Support **both** ways to define the active selection rectangle (in tile coordinates): **Drag to size:** click and drag on the main canvas to draw a marquee; on mouse release, selection = bounding box in tile coords (N×M). **Click then shift-click:** click to set first corner, shift-click to set opposite corner; selection = rectangle between them. The **active selection** drives: (1) **tile painter** to show that many tiles adjacent (item 2), (2) **staging canvas** selection box (same N×M, movable). Start implementation with this so dynamic selection populates the selection area.

**Notes:** See [paint-tool-image-import-export.md](paint-tool-image-import-export.md) §2b. No implementation until after graphics work (or when starting sprite-first workflow).

---

### 5. Paint bucket: fill across selected area (default on, toggle for single-tile)

**Current:** Flood fill in the tile painter affects only the **current 8×8 tile** (the one being edited).

**Goal:** **Paint bucket** should fill **all adjacent pixels** (matching fillable color) **within the selected area**—i.e. treat the N×M selection as one contiguous pixel surface and flood across tile boundaries. One fill can cover a multi-tile region (e.g. a large sprite). Optionally provide a **toggle** (e.g. "Fill only current tile" / "Fill across selection"); **default** = fill across selection.

**Notes:** Depends on selection (item 4) and adjacent tile editor (item 2). See [paint-tool-image-import-export.md](paint-tool-image-import-export.md) §2b. No implementation until after graphics work.

---

## When we return to the paint tool

- Revisit this backlog and [paint-on-game-editor-design.md](paint-on-game-editor-design.md).
- Ensure any new behavior (e.g. drag-select, dynamic grid) is consistent with the existing draw stack, layer filter, and export flow.
