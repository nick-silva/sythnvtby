# Paint tool: quick test guide

Use these **one path at a time** when you want to check that the paint tool works. You don’t need to do everything in one session.

---

## Path 1: Paint pack only (no overrides)

**Goal:** Load a frame, paint tiles, export a color pack.

1. Open the paint tool (`/tools/paint.html`).
2. **Load vbstate** — pick a `vbstate.json` (e.g. from “Save VIP state” in the emulator).
3. You should see the frame. Click a tile on the scene.
4. In the side panel, one draw is selected. Paint on the 128×128 canvas (pick a color, brush).
5. When you release the mouse, the scene updates and status shows pack count.
6. **Export .vbcolor** — download a file. In the main app: load that .vbcolor (and same ROM), switch to Color — you should see your painted tile.

**Success:** Frame appears, painting updates the scene, export gives a .vbcolor that works in the emulator.

---

## Path 2: Override only (one tile, different at one spot)

**Goal:** Use “This position only” so one tile looks different in one place.

1. Do Path 1 up to step 4 (frame loaded, you’ve clicked a tile).
2. Switch **Apply to:** to **This position only (override)**.
3. Paint that tile a different color; release mouse.
4. Status should show “Overrides: 1”. Turn on **Highlight override tiles** — you should see a cyan outline on that 8×8.
5. **Export overrides** — download `overrides.json`. In the main app: load your .vbcolor, load that overrides.json as “Overrides (optional)”, Color mode — that one spot should use the override color.

**Success:** Override appears in scene, highlight shows it, exported overrides work in the emulator.

---

## Path 3: Load pack (.vbcolor or .vbpack)

**Goal:** Open an existing pack (or full vbpack) and see it on the frame.

1. Load a vbstate so you have a frame.
2. **Load pack** — choose either:
   - A **.vbcolor** file, or  
   - A **.vbpack** file (ZIP with color + overrides).
3. The scene should redraw with pack colors (and overrides if the vbpack had them). Status shows pack size and “Overrides: N” if any.
4. Click a tile and paint if you want; export .vbcolor or .vbpack when done.

**Success:** Pack/vbpack loads, frame shows pack colors, you can edit and re-export.

---

## Path 4: Load vbpack with no frame (feedback check)

**Goal:** Confirm you get a clear message when the pack has no VIP state.

1. Open the paint tool. **Do not** load a vbstate.
2. **Load pack** — choose a **.vbpack** file (one that has color + overrides but no vbstate inside).
3. You should see:
   - Status: “Pack loaded: N tiles, M overrides. Load a vbstate to see a frame and paint.”
   - Placeholder: “Pack loaded (no frame). Load a vbstate.json to paint.”
4. Then **Load vbstate** — the frame appears and uses the pack you just loaded.

**Success:** No silent failure; message tells you the pack loaded and to load a vbstate.

---

## Path 5: VIP state in vbpack (load and export)

**Goal:** Open a vbpack that has a frame inside it; export a vbpack that includes the current frame.

1. **Export a vbpack with a frame:** Load a vbstate, then (optionally) load or paint a pack. Click **Export .vbpack**. The downloaded .vbpack now includes `vipstate-current.json` (the current frame).
2. **Open that vbpack in the painter:** In a fresh painter tab (or after clearing), click **Load pack** and choose the .vbpack you just exported. You should see the frame immediately (no separate "Load vbstate" needed). The pack and overrides from the vbpack are applied. You can paint and **Export .vbpack** again; the updated pack/overrides and current frame are saved in the new file.

**From the main app:** Load ROM + pack, switch to Color, then **Export .vbpack**. That vbpack includes ROM, color pack, overrides (if any), and the current VIP state (frame). Open that .vbpack in the painter to get the frame + art in one go.

**Success:** Loading a vbpack that contains `vipstate-current.json` shows a frame; exporting from the painter or main app includes the current frame in the vbpack.

---

## Path 6: Load overrides.json only

**Goal:** Cobble together: frame + pack from one place, overrides from a file.

1. Load a vbstate and (optionally) a .vbcolor so you have a frame and pack.
2. **Load overrides (optional)** — choose an `overrides.json` file (same format as export).
3. Scene updates; status shows overrides count. **Highlight override tiles** to see which cells use them.
4. Export .vbcolor and/or Export overrides or Export .vbpack as needed.

**Success:** Overrides load from a standalone file and apply to the current frame/pack.

---

## What to test when you’re unsure

- **“Does the basics work?”** → Path 1 only.
- **“Do overrides work end-to-end?”** → Path 2 only.
- **“Does loading feel right?”** → Path 3 and Path 4.
- **“Can I mix overrides from a file?”** → Path 6.
- **"Does vbpack carry a frame so I don't load vbstate separately?"** → Path 5.

Ignore the rest until you need it. The use-case doc is for **design and features**; this guide is only for **testing** one path at a time.
