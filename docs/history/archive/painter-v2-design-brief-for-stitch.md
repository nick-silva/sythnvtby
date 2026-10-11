# Painter v2 — design brief for mockups (e.g. Stitch)

**Purpose:** Paste this document (or the **“Brief for the design tool”** section below) into an AI design assistant to generate UI mockups for **Painter v2**, a web-based authoring tool for **Virtual Boy game colorization**. Iterate on visuals in your design tool, then hand approved mockups back to engineering.

**Engineering spec:** [painter-v2-spec.md](../../design/painter-v2-spec.md)

---

## Brief for the design tool

### Product one-liner

**Painter v2** helps artists and developers **recolor Virtual Boy games** loaded from a project bundle (`.vbpack`). Work is organized by **game state** (from memory / RAM analysis) and **groups** of on-screen tiles. **Background-style** work uses **one large PNG per group** (editable in Photoshop); **sprite-style** work uses **8×8 tiles** and optional **position overrides**. The UI must stay **simpler than a typical pro tool**—fewer panels and buttons than “everything at once.”

### Target users

- **Color artist / pixel artist** — paints tiles or replaces BG sheets; may never touch RAM terminology.
- **Technical author** — picks **game-state variants**, understands **hashes** and **packs**, exports to emulator.

### Display constraints (important for layout)

- The **game frame** is **384 × 224 pixels** (Virtual Boy resolution, one eye). The main **preview / edit canvas** should preserve this **aspect ratio** (can be **scaled up** on screen for comfort, e.g. 2× or 3×, with optional pixel-grid hint).
- **Stereo:** Optional later; v2 mockup can show **single view** first.
- **Dark UI** is acceptable (common for creative tools); prioritize **contrast** and **clear hierarchy**.

### Design principles

1. **Low interaction load** — one **primary task** visible; secondary actions collapsed, in a kebab menu, or on a second tab—not a wall of toggles.
2. **Two worlds, visually distinct** — **BG (background)** vs **OBJ (sprites)** groups must be **instantly recognizable** (color accent, icon, badge).
3. **Honest warnings** — non-blocking **banners** when a BG group contains non-background draws; no modal spam.
4. **Professional / utilitarian** — this is a **production tool**, not a game; avoid playful game UI chrome unless it aids clarity.

---

## Information architecture (suggested regions)

Use a **single main window** (desktop web). Suggested zones:

| Region | Role |
|--------|------|
| **Top bar** | Project name / pack, **Save**, **Export .vbpack**, **Back to emulator** (optional). Keep **≤ 5 primary actions**. |
| **Left sidebar (narrow)** | **Groups** list: each row = group name + **BG** or **OBJ** badge + optional status dot (e.g. “has macro”, “has unsaved tiles”). **+ New group** at bottom. |
| **Center** | **Frame canvas** (384×224 aspect). Click picks tile / draw; optional **overlay** for group bounds (BG bbox). |
| **Right sidebar (context)** | **Inspector** — changes with selection: **pool / variant** picker, **group** details, **hash** info, **rules** summary. This is the main “thinking” panel—avoid duplicating it elsewhere. |
| **Bottom (optional, collapsible)** | **Draw stack** or **minimal timeline** — defer if it crowds the layout; v2 prefers **inspector-first**. |

---

## Core use cases (must be representable in mockups)

### UC1 — Open project and pick context

- User opens a **.vbpack** (or arrives from emulator with pack loaded).
- User selects **which frame / VIP snapshot** to edit (dropdown or compact frame list with **human-readable names** when available).
- User selects **game-state pool variant** (e.g. “Title”, “In-game — Level 2”) — often **one variant**; control should not dominate the UI.

**Mockup:** Default **loaded** state with frame + variant visible in inspector.

---

### UC2 — Create a group (explicit BG vs OBJ)

- User selects tiles on the canvas (or uses a simple **“Add visible window”** control).
- User clicks **New group** → **required choice: Background (BG) or Sprites (OBJ)**.
- Optional: **“Suggest from selection”** pre-fills BG vs OBJ from layer type; user can override.

**Mockup:** **Modal or inline step** for **BG / OBJ** choice—clean, not buried in settings.

---

### UC3 — BG group (pure): macro sheet workflow

- Group is labeled **BG** and contains **only background-layer** draws.
- Inspector shows: **bounding box** summary, **anchor hash** (identifier), **preview of current PNG sheet**, actions: **Regenerate from monochrome**, **Replace image**, **Open folder hint** (files live in pack as `groupname__variantname.png`).
- User edits the PNG externally or in an embedded preview; save updates pack.

**Mockup:** Right panel = **macro** layout: large thumbnail, 2–3 clear buttons, no 8×8 grid.

---

### UC4 — BG group (impure): warning + fallback

- User labeled **BG** but group includes **sprite** or **affine** draws.
- **Banner:** “This group mixes layer types. Macro sheet disabled. Use Sprite workflow or remove non-background tiles.”
- Actions: **Switch group to OBJ**, **Edit membership**.
- Inspector shows **OBJ-style** tools (tile list) as **effective** mode.

**Mockup:** Same layout as UC3 but with **prominent warning strip** and **disabled** macro primary button (ghosted).

---

### UC5 — OBJ group: per-hash tile painting

- Inspector lists **hashes** (pattern IDs) in the group—compact rows with **tiny preview**.
- User picks one hash → **8×8 editor** (zoomed grid, small palette strip—**keep palette minimal**, not 50 swatches).
- Optional compact row: **Overrides** — “This cell only” / “Everywhere on layer” **without** exposing full v1 complexity in the default view (advanced in disclosure).

**Mockup:** Right panel split: **hash list** top, **8×8 paint area** below.

---

### UC6 — Pick tile from canvas (shared)

- Click on canvas highlights the **draw** under cursor; inspector shows **hash**, **layer class** (BG / Sprite / Affine), **how many times** this hash appears on frame (informational line).
- Affine: **no special tools in v2.0**—inspector may show label **“Affine (limited support)”** or hide advanced Affine messaging for mockup simplicity.

**Mockup:** Canvas with **subtle highlight** on selected 8×8 cell; inspector **readout** line for hash + count.

---

### UC7 — Save and hand off

- **Save** / **Export .vbpack** writes pack including **macro PNGs** under a predictable folder and **tile data** for sprites.
- Optional: **Save and return to emulator** (single prominent action if product requires it).

**Mockup:** Top bar with **Save** + **Export**; optional success **toast**.

---

## Visual differentiation (BG vs OBJ)

| | BG groups | OBJ groups |
|---|-----------|------------|
| **Badge** | `BG` — cool accent (e.g. blue–teal, slate) | `OBJ` — warm accent (e.g. amber, coral) |
| **Icon metaphor** | **Sheet / rectangle / landscape** | **Character / diamond / small grid** |
| **List row feel** | Calm, “structural” | Energetic, “many moving parts” |

---

## Explicitly out of scope for v2.0 mockups (omit or grey “future”)

- **Animated PNG (APNG)** workflows.
- **Dedicated Affine authoring** (rotation handles, matrix editors)—Affine is **deferred**; at most a **label** on a draw.
- **Memory analysis** / WRAM hex editors inside this app.
- **Full clone** of every v1 paint tool panel (staging import, dozens of checkboxes).

---

## Optional second screen (if the tool allows multiple artboards)

- **Empty state:** “Load a .vbpack or continue from emulator” + **drag-drop** affordance.
- **Settings (minimal):** Theme, scale factor for 384×224 preview—low priority.

---

## Deliverables to request from the design tool

1. **Desktop web** layout, **~1280px** wide minimum.
2. **Three key frames:** (A) **OBJ group** + 8×8 editor, (B) **BG group** macro inspector, (C) **BG group** with **warning banner** (mixed membership).
3. **Component hints:** group list row (BG vs OBJ), inspector card, warning banner, top bar.
4. **Accessibility:** focus states, readable font sizes for hash IDs (monospace optional).

---

## One paragraph elevator pitch (alternate paste)

Painter v2 is a focused web app for coloring Virtual Boy games from a zip-like project file. The screen shows a fixed-aspect game frame (384×224). Users organize work into groups: **Background groups** produce one large PNG sheet per game-state variant for Photoshop-friendly editing; **Sprite groups** use a simple list of tile patterns and a small 8×8 pixel editor. Users always choose whether a group is Background or Sprite when creating it. The interface must be calmer than a legacy internal tool—one main canvas, a slim group list, and a context inspector—with clear visual distinction between background and sprite workflows and a visible warning when a background group accidentally contains sprite tiles.

---

*End of Stitch-oriented brief. Technical details: see [painter-v2-spec.md](../../design/painter-v2-spec.md).*
