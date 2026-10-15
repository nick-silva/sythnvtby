---
status: current
last-reviewed: 2026-10-15
covers: src/shared-tile-owner.js, src/pixel-explain.js, src/project-health.js, src/sub-state-learn.js, src/game-states.js, src/memory-questions.js, src/memory-recorder.js, src/memory-panel.js, src/poses-panel.js, src/frame-poses.js, src/project-storage.js, tools/painter/game-states-panel.js, tools/painter/storage-panel.js, src/screen-gate.js, src/group-order.js, tools/painter/health-panel.js, src/recovery.js, src/work-journal.js, index.html, src/main.js, src/frame-capture.js, src/auto-capture.js, src/frame-step.js, tools/index.html, tools/project.html, tools/painter.js, tools/painter/, tools/painter/sprite-profiles-ui.js, tools/sprite-studio.html, tools/sprite-studio.js, tools/sprite-studio/, tools/shared/pack-session.js, src/art-pack.js, src/group-folders.js, src/group-screens.js, src/layer-art.js, src/paint-gaps.js, src/project-journal.js, src/frame-numbers.js, src/starter-paint.js
---

# User guide: coloring a Virtual Boy game

This guide is for **people who want to color a game**, not people who want to change the
code. You need a Virtual Boy ROM (`.vb`), a desktop browser, and some patience. You don't
need to know anything about how the Virtual Boy draws pictures.

- **In a hurry?** Read the [TL;DR quick start](#tldr-quick-start) and start painting. Come
  back to the rest when something surprises you. Something will.
- **Want to understand it first?** Read [How coloring works](#how-coloring-works-in-two-minutes)
  and [The golden rules](#the-golden-rules).
- **Stuck?** See [Gotchas](#gotchas-and-known-problems), [Troubleshooting](#troubleshooting)
  and the [Glossary](#glossary). The tools show a lot of internal jargon on screen, and the
  glossary translates it.

This guide adds to the [project guide](../README.md), which explains how the pieces work
internally; it doesn't replace it. For an honest assessment of where the tools are rough,
see the [use-case review](../planning/use-case-review.md).

---

## TL;DR quick start

Allow about 20 minutes, from nothing to a colored sprite running in the game.

**0. One-time setup.** You need [Node.js](https://nodejs.org) 18 or newer and **Chrome or
Edge** on a desktop. Other browsers work but can't save files in place.

```bash
npm install
npm run dev        # then open http://localhost:5173
```

**1. Pick a home folder.** On the emulator page, click **Project home → Choose folder…** and
choose an empty folder, e.g. `Documents/sythnvtby`. Every open and save dialog now starts
there, and saves land there instead of in Downloads. *Do this first. It prevents most
"where did my file go?" moments.*

**2. Load your ROM.** Click **Load ROM** and pick your `.vb` file. The game plays in
red-and-black **Monochrome**. Default keys: **arrows** = D-pad, **Enter** = Start,
**Z / X** = A / B. You can remap them in the emulator's own control settings.

**3. Capture frames.** Play until a sprite you want to color is on screen, e.g. your
character standing still. Press **F8** to capture that moment silently, or click
**Capture Frame** to give it a name such as "Level 1". Capture 3–10 moments showing your
character in different poses (standing, walking, jumping), plus one of each screen you care
about. Captures live **only in memory** until the next step.

**4. Press Colorize!** The game pauses and the **Project tool** opens on the current frame.
All your captures are listed under **Frame** at top left.

**5. Make a sprite.** In the left rail, set **Layer** to **OBJ** so that only sprites can be
selected. Drag a box around your character on the canvas. In the right rail, click
**New pose from selection…**, choose **+ New sprite group**, name it (e.g. "Hero"), name the
pose ("Stand"), and click **Add pose**. Then pick the next frame in the Frame list and repeat
for each pose, adding each one to the same "Hero" group.

**6. Paint it in SpriteStudio.** Click **SpriteStudio →** in the top bar. Your sprite opens
with its poses in a filmstrip.
- Press **B** (Brush), pick a color from the color box on the tool rail right of the stage,
  and paint.
- **G** fills an area. **I** picks a color from the picture.
- **→** / **←** move between poses. Tiles that several poses share update in all of them at
  once.

**7. Go back and play.** Click **← Project tool** at the top left of SpriteStudio. In the
Project tool, click **Save and Play**. Your project is saved as a `.vbpack` in your home
folder, and the emulator resumes at the same moment, **in color**.

**8. Keep going.** Next time, open your `.vbpack` with **Load pack** in the emulator, **not**
the ROM. The pack holds the ROM, your captures and all your paint. Play, capture more,
Colorize!, paint, Save and Play. That loop is the whole job.

> **Ignore the grey control panel under the game.** It is full of checkboxes such as
> "OBJ X offset -8 (ghost test)" plus a pixel inspector, and it is developer debugging. You
> don't need any of it. The one useful control there is **Frame / Save state**, which jumps
> to a captured frame.

Three things will catch you early. Read them now:

1. **Paint belongs to a tile, not a place.** Paint one 8×8 tile of your hero's hat and
   *every* copy of that tile pattern in the game gets the same colors. That is usually what
   you want, and occasionally not. See [Where your paint goes](#where-your-paint-goes).
2. **When painting backgrounds in the Project tool, save before you switch frames.** Some
   background paint is stored per screen position, and **unsaved paint of that kind is
   discarded when you change frame or click Reload frame**. See
   [Gotchas](#gotchas-and-known-problems).
3. **Emulator captures aren't saved until you press Colorize! or Export .vbpack.** Loading
   another ROM, loading another pack, clicking **Last pack…** or closing the tab throws them
   away without asking.

---

## How coloring works in two minutes

The Virtual Boy never draws a "picture". It draws a **mosaic of 8×8-pixel tiles**, each in
at most four shades of red, arranged in layers. A tile *pattern*, such as "Mario's left
shoe", is stored once and stamped wherever the game wants it, sometimes flipped.

```
  ROM runs in the emulator ──► each frame, the emulator reports every tile it stamped
                                         │
                   your color pack says: "tile pattern #6F9A72A3 → these 64 colored pixels"
                                         │
  red monochrome picture  ◄── colored tiles drawn on top, tile by tile; any tile you have
                              not painted stays transparent, so the original red shows
```

Three things follow from this:

- **You paint patterns, not pixels on a screen.** Paint a pattern once and it is colored
  everywhere: in every frame, facing either way. This is what makes coloring a whole game
  feasible.
- **Anything you haven't painted stays red.** A half-colored game looks like a colored game
  with red holes. Turn **Monochrome** on together with **Color** to see the holes. Turn it
  off to see only your paint.
- **When one pattern needs two colors**, you need a **group**: a named set of tiles that can
  carry its own colors. Examples are the same brick tile in two levels, or the same "black"
  tile filling five layers. Groups are the main complication, and a sprite-based game can
  get a long way before needing one.

**The files.** Everything for one game lives in one **`.vbpack`**: the ROM, your captured
frames, your groups, sprites and paint. It's your *project file*. Keep it, back it up, and
open it with **Load pack**. Because it contains the ROM, **don't share it publicly**. There
is no "player" file that shares just the colors yet (see
[priorities-and-next.md](../planning/priorities-and-next.md), "Shipping to players").

---

## The golden rules

1. **Once a project exists, open the `.vbpack`, not the ROM.** Load ROM starts a new, empty
   project.
2. **Keep your `.vbpack` inside your project home folder.** That way all three pages save
   back to the same file, and the Project tool keeps a `<name>.bak.vbpack` backup beside it.
3. **Save and Play often.** It saves *and* shows you the result in the real game.
4. **Paint sprites in SpriteStudio and backgrounds in the Project tool.** Each can do both,
   but each is better at one job.
5. **For paint that tile colours can't do** (blank gaps, one-off detail, a sky), use
   **overpaint** in SpriteStudio (press **T** on a background group).
6. **Capture more than you think you need.** Frames are cheap. They're how the tools learn
   what your sprites look like and which screen is which.

---

## The pages

The app is three pages that pass your project between them. You rarely need any other page.

| Page | Address | You use it to… |
|------|---------|----------------|
| **Emulator** | `/` | Play, capture frames, and see the result in color. |
| **Project tool** | `/tools/project.html` | Organize captured frames into sprites (poses) and background groups, and paint backgrounds. |
| **SpriteStudio** | `/tools/sprite-studio.html` | Paint sprites pose by pose and preview their animation. |
| **sythnvtby Player** | `/player.html` | Play a finished game in colour: its ROM plus a play pack. No authoring tools. See [The sythnvtby Player](#the-vb-color-player). |
| Tools hub | `/tools/` | A launcher. **Memory analysis**, **Frame viewer**, **Tile extractor** and **Pack validator** are developer utilities, and a basic user can ignore them. |

### How the pages hand over your project

```
  Emulator ── Colorize! ─────────────► Project tool ── SpriteStudio → ──► SpriteStudio
     ▲                                     │   ▲                              │
     └────────── Save and Play ◄───────────┘   └──────── ← Project tool ◄─────┘
```

Each arrow carries the whole project, so you never need to save and reopen files to move
between pages. Save and Play also writes the file to disk.

---

## The emulator page

### Controls you need

| Control | What it does |
|---------|--------------|
| **Load ROM** | Starts a **new, empty** project from a `.vb` file. Throws away unsaved captures. If a game is already running, the page **reloads** first, so only one game ever runs. |
| **Load pack** | Opens a `.vbpack` project. It boots the pack's ROM, loads all its paint, and switches to Color if the pack has colors. The pack is remembered as **Last pack: …** for next time. If a game is already running, the page **reloads** first, so only one game ever runs. |
| **Last pack: …** | Reopens the last pack. If a game is running it **reloads the page**, which also throws away unsaved captures. |
| **Display: Monochrome / Palette / Color** | **Color** shows your paint. **Monochrome** shows the original red picture underneath; turn on both to see unpainted holes. **Palette** is a separate toy that recolors the four red shades with a preset (green, Game Boy, …). It doesn't use your paint. |
| **View: 2D / Side-by-side / Anaglyph** | 3D, for the red picture and the colour alike. **Side-by-side** shows the left eye, then the right; **Anaglyph** mixes them for red/cyan glasses (under **Palette**, Anaglyph shows one eye). Stay on **2D** while capturing and coloring: a capture taken in Side-by-side keeps the left eye's screenshot, and one taken in Anaglyph has no screenshot. See [3D: both eyes](#3d-both-eyes). |
| **Capture Frame** / **F8** | Adds the current moment to your project. A capture stores what was on screen, the game's memory, a screenshot, and a save state so you can return to that moment. The button asks for a name. F8 captures silently as "State 001", "State 002", … |
| **Screen: Fill / 1:1** | **Fill** (the default) makes the game as large as the window allows, shaped like the Virtual Boy picture; the debug controls stay below it and the emulator's control bar shows over its bottom edge on hover. **1:1** is the original 640-pixel-wide screen. Remembered in this browser. |
| **Pause / ◂ Step / Step ▸** | Land on exactly the frame you want. **P** pauses and resumes; **.** steps forward one frame and **,** steps back one (hold to keep stepping; **Shift** steps 10). The emulator keeps the last 3 seconds of frames while it runs, so you can step back to something that just flew past. The readout shows the frame and how far back you can go. **Capture Frame** or **F8** then saves exactly the frame on screen, and the game stays paused. Opening a captured frame from the frame list also pauses there, ready to step. The keys don't reach the game. |
| **Auto-capture** | First asks what you're trying to capture: **Background (BG)**, **Sprite (OBJ)** or **Scaled (Affine)** tiles, or **All of the above** (it remembers your choice). Then play normally. The game pauses whenever a tile of those kinds you've never captured appears, outlines it in magenta, and asks you to name the capture. Works best after a first manual pass. **Where paint doesn't cover yet** (on its own or with the others) also stops where the colour falls short: a tile with no paint at all, or a backdrop scrolled past the part of its overpaint picture that was painted — capture it, then paint the missing part. Each gap stops the game once per session. **Stop auto-capture** (or Esc) turns it off. |
| **Memory** | Opens the Memory panel: record the game's memory for a question's side while you play, and see live which screen and game states hold. See [Questions and recordings](#questions-and-recordings-telling-game-states-apart). |
| **Poses** | Opens the Poses panel (Color on): for the frame on screen, each character whose saved pose is whole there — which pose, on which layer (or where, for a sprite, and whether mirrored) — and whether that pose's picture was drawn, or why not: a fuller pose's picture won, the group is hidden by its screens or game states, or two poses have exactly the same tiles (both pictures draw). It follows the game live; **Pause** and **Step** to look at one frame, and **Copy** puts the report with the frame number on the clipboard. |
| **Colorize!** | Pauses and opens the Project tool on this exact moment, bringing your captures (and memory recordings) along. |
| **Export .vbpack** | Saves the current project (ROM + captures + paint) to a file without leaving the page. Use it to keep captures when you're not ready to press Colorize!. |
| **Project home** | Chooses the folder where file dialogs start and where saves land (Chrome/Edge only). After a browser restart it may say "needs permission". Click **Grant access**. |
| **Tools** | The tools hub. |

**Naming captures.** The Capture dialog asks for a **Game state** ("Title", "Level 1") and an
optional **Sub-state** ("Boss", "Paused"). Use the same state name for every capture of the
same screen. The tools group frames by it, and screen-specific coloring relies on it later.
The dialog remembers your last names.

### 3D: both eyes

The Virtual Boy draws a picture for each eye. **View: Side-by-side** (or **Anaglyph**) shows both,
in monochrome straight from the emulator and in colour from your paint.

- **You paint the left eye.** Every tool shows the left eye, so the right eye gets its colour from
  the same paint: the same tiles in the same layers.
- **Layers the game draws twice.** Many games give a layer depth by drawing it twice: one copy for
  the left eye, and a slightly different copy (the art shifted for depth) for the right. Mario's
  Tennis's crowd and Mario Clash's walls are drawn like that. The emulator spots these pairs and:
  - draws your **overpaint** on the right eye's copy too (the same picture as the left, so that
    layer looks flat in 3D);
  - on a scaled copy (Mario's Tennis's title screen) takes overpaint across from the left eye pixel
    by pixel, following the game's own shift for depth, so a painted title or logo keeps its 3D;
  - colours the right copy's tiles with your paint where they're the same tiles, and elsewhere takes
    the colour of the matching spot in the left eye.
- **What can still show grey on the right:** a right-eye pixel with no matching painted pixel nearby
  on the left. Paint the matching part on the left, or use **Eye: Right** in the Project tool to see
  and paint the right eye's tiles.
- **Eye: Right** in SpriteStudio and the Project tool shows the right eye the same way the emulator
  does. In SpriteStudio, **Show unpainted** doesn't tint right-eye pixels that take their colour from
  the left eye.

### Controls to ignore

- **Color pack (optional)** and **Overrides (optional)** load loose `.vbcolor` / `.json`
  files from the old workflow. Your `.vbpack` already contains both.
- **The whole panel under the game** is developer debugging: Fade response, Clip color layer
  to strip, OBJ X offset, BG X offset, Deduplicate draws, Sort draws by world, Unpacked
  tiles, Perf overlay, Pack coverage, Color layer debug, Log duplicate draws and Pixel
  inspector. Two exceptions:
  - **Frame / Save state** is useful. It jumps back to any captured frame.
  - **Fade response** changes how fast colors dim during the game's fades. Leave it at 1.34
    unless fades look wrong.
- The **"Palette debug"** strip that appears in Palette mode.
- The status line under the game ("Pack: vb-pack (0 tiles). VIP: 2688 draws · frame 837")
  is written for developers. "0 tiles" does **not** mean your pack is empty. Most paint is
  stored in groups, and that count ignores groups.

---

## The Project tool

This is where captured frames become things you can color. It looks intimidating because
it shows a lot of internals. Here is what matters.

### Layout

- **Top bar**:
  - **File** menu: Open pack…, Save, Save as…, Import from another pack…, Import VBoy Color
    pack (.vbcp)…, Export for player…, and the project home settings.
  - **Project** menu: **Check project…** (below), Clean up frames…, Project storage…, Game
    states…, Analyze memory…, and **Developer details** (off by default): the numbers and notes
    meant for debugging the tools — draws per world under the world grid, pool context over the
    groups tree, the preview note under the canvas. Remembered in this browser.
  - **Frame** menu: Export screenshot, Export frame PNG… (the frame as it looks now, coloured), Add colorized reference…, **Copy reference** (the frame's
    number, name and id, e.g. *#57 · InGame · f-muytuaaa-eimjli*, to paste in a note or a message),
    **Go to frame…** (type its number, name or id — an id with a typo or two still finds it),
    Rename frame…. Every frame has a short number (**#57**) at the front of its name in the Frame
    list; it never changes, so *#57* keeps meaning the same frame.
  - **N to check**, next to Project, only when Check project has found something: click it for the
    list.
  - Buttons: **Save and Play**, **SpriteStudio →**, Reload frame, then — past the divider — the two
    that leave the Project tool: **All tools** (the tools list) and **Emulator**. Both ask first
    when there is unsaved work, which leaving would lose.
- **Left rail**:
  - **Frame** list, with `<` `>` to step through captures. **Show** under it narrows the list
    (and `<` `>`) to frames still needing colour: **With uncoloured tiles** (tiles with no paint
    at all) or **With uncoloured pixels** (any lit pixel nothing colours, partly painted tiles
    too). Each frame then says how much is left, e.g. "3 uncoloured tiles · 412 uncoloured px".
    It counts what the preview colours — group and sprite paint and overpaint — on the
    left eye, recounts after you paint, and is remembered. The frame you're on always stays in
    the list. A picture (overpaint) behind a tile doesn't count as colouring it: an unpainted
    character in front of a painted backdrop still counts.
  - **Highlight**, next to Show while a filter is on (or press **H**): marks what is missing on
    the frame you're on in cyan and dims the rest — the unpainted tiles with **With uncoloured
    tiles**, every uncoloured pixel with **With uncoloured pixels** — and says how much, e.g.
    "8 unpainted tiles here". It follows the World and Layer filters, so you can look at one
    layer at a time. Remembered, like Show.
  - **Eye**: leave it on Left.
  - **Layer**: All / BG / Affine / OBJ. The most useful filter.
  - The overlay toggles. The reference tools (Reference overlay, Move & scale, Revert, Fill
    selection from reference) show only on a frame that has a reference, and the opacity slider
    only while an overlay can show.
  - **Worlds** (group inspector): the worlds the group paints on. Some games move the same tiles
    between worlds from frame to frame — Mario's Tennis draws its players with background worlds
    and swaps them around so the right one is in front — and a group only paints on its own worlds,
    so the picture flickers. The inspector lists other worlds the group's tiles turn up on (e.g.
    **+ 21 (3 frames)**); one click adds it, and the paint follows there in every tool and the
    emulator. If another group already paints those tiles on that world it is named: the group
    listed first wins there. **×** removes a world.
  - **Size: Fill / 1:1** (canvas toolbar): **Fill** (the default) makes the frame as large as the
    work area allows; **1:1** is the original 768-pixel-wide canvas. Remembered in this browser.
  - The **VIP world** grid, a layer filter where 0 is the front layer. Worlds with nothing drawn on
    the current frame (and eye) are greyed out; they come back on any frame that draws them. A world
    you have already selected stays clickable, so you can always turn it off.
  - **Memory pool**: which screen this is — shown once the pack has screens (Analyze memory).
  - **This pixel**: click the frame, and it says in one line what colours that pixel — e.g.
    *Coloured by Mario-PlayingAs’s paint for this tile* — or exactly why nothing does: *LUIGI
    text paints this tile, but only on world 17; here it is drawn on world 18*, *this tile is in
    Court, but it is not painted yet*, *the backdrop’s overpaint covers map x 0–399; this spot
    is map x 512*. When there is a fix it offers one button (**Add world 18 to LUIGI text**,
    **Select Court**, **New group from this tile…**). When two groups paint the tile and the
    one listed first wins, a second button lets the other win (**Let Luigi win**: see *Which
    group wins a shared tile*, below). It updates as you step through frames.
    **Details** (closed) holds the rest: other reasons, which group wins a shared tile and why,
    the tile's hash, index, layer and world, and every draw under the pixel (click one to
    select it).
- **Canvas toolbar**:
  - **Select**, **Zoom to selection** and Tile grid.
  - **Fill**, Across tiles, Blank tiles.
  - **Replace / Add / Subtract**: how a new drag changes the selection.
  - **Select matching**: grows one tile to every copy of it.
  - **Brush** and **Eraser** (only when zoomed), **Eyedropper**, and the **color box**. The Eraser
    takes paint off the pixels you drag over, so the game's own picture shows there again; a tile
    with nothing left counts as unpainted. **Ctrl+Z** undoes paint, Clear, Move to group and
    **Delete group** (the group comes back where it was, with its paint and overlays);
    **Ctrl+Shift+Z** or **Ctrl+Y** redoes. A new change ends what can be redone.
- **Right rail**:
  - **Search groups** (top of the rail, **Ctrl+K**): narrows the Groups tree as you type — every
    word must appear in a group's name or folder — opening the screens and variants that hold a
    match, with a count ("5 of 79"). **Enter** selects the first match, **↓** moves into the list,
    **Esc** clears it and puts the tree back as it was. **On this frame** next to it shows only
    the groups with tiles on the frame you're on (remembered in this browser).
  - **New group from selection…**, **New pose from selection…**, **Painted tiles…**.
  - The **Groups** tree, sorted by screen. Click a group to select it **and all of its tiles
    on this frame**. If the world or layer filter was hiding some of them, those worlds are
    turned on (added to what you had on, never replacing it) and the status line says so.
    Its details and buttons appear under the tree.
  - **Which screens use a group.** A group's colours are not tied to a screen. They apply
    wherever its tiles appear, and the tree only files the group under the screen it was made
    on. So each row carries a pill based on your captured frames:
    - **"3 screens"** (orange): the group shows on several screens, and painting it changes all
      of them.
    - **A screen's name**: it shows on one screen, but not the one it is filed under.
    - **"not in captures"**: no captured frame shows it.
    - **Hover** a pill for the list of screens.
    - **"Shared by several screens"**, the section at the top of the tree, lists every shared
      group in one place (they stay in their own screen too).
    - **The details panel** shows the same list as **Tiles appear on: IntroCin (7 frames), Title (2 frames)**.
    - **A group limited to some screens** (see [Limiting a group to some screens](#limiting-a-group-to-some-screens))
      shows that instead, e.g. **"not GameMenu"**.

### Selecting

- Drag on the canvas to select tiles. Shift-drag adds to the selection.
- **Layer → OBJ** restricts selection to sprites. **Layer → BG** restricts it to backgrounds.
- Blank tiles are skipped unless **Blank tiles** is ticked.
- **Select matching** grows a one-tile selection to every copy of that tile.
- **Zooming clears the selection.** Select first and create your group, then zoom in to
  paint.

### Sprites: poses

A **pose** is one arrangement of a sprite's tiles: Mario standing, Mario mid-jump. A
**sprite group** holds all the poses of one character.

1. Choose a frame that shows the pose, and set **Layer → OBJ**.
2. Drag around the sprite. If another sprite is touching it, trim with **Subtract**.
3. Click **New pose from selection…**, choose the character under **Add to sprite group**
   (or *+ New sprite group*), enter a **Pose name**, and click **Add pose**. The list puts the
   groups you used most recently first (selecting a group, or adding a pose to it, in either tool),
   then the rest by name, and shows each group's folder. Type in the box above it to narrow it:
   every word must match the name or folder; **↑/↓** pick, **Enter** adds the pose to the
   highlighted group, double-click works too. Typing a name nothing matches offers
   *+ New group "…"* with that name filled in.
4. Repeat for every pose on every frame. A mirrored copy (the character facing the other
   way) uses the same tile patterns, so painting one direction colors both. The tools don't
   yet *recognize* a mirrored pose as the same pose, though.
5. Click **SpriteStudio →** to paint them.

A sprite group with no poses yet (made with **New group from selection**, say) shows in
SpriteStudio as one card per captured frame that shows it, so you can paint it straight away;
**Keep as pose** there makes a card its first pose.

**Background and scaled layers can have poses too.** Select background tiles (**Layer → BG**) or
scaled tiles (**Layer → Affine**) and click **New pose from selection…**: the dialog offers your
background groups (or *+ New background group*). A scaled pose keeps the patterns it shows and the
frame it was taken on. You rarely need this here: SpriteStudio already shows a background group
on every frame that shows something new of it, and **Keep as pose** there does the same job.

### Backgrounds: groups

1. Choose a frame and set **Layer → BG**. To pick out a single background layer, click one
   **VIP world** button.
2. Drag over scenery you want to treat as one unit, e.g. "Level 1 floor".
3. Click **New group from selection…**, enter a **Name**, choose **Kind: BG**, and click
   **Create group**. The dialog is full of technical text. The only line that matters is the
   first one: the group covers **every copy of those tiles** on screen, not just the ones in
   your box.
4. With the group selected, pick a color and use **Fill**. Or zoom in with **Zoom to
   selection** and use the **Brush**.
5. After your first stroke, check the status line to see where the paint went (see below).
   If it says "VIP paint layer" or "this 8×8 only", **save before changing frame**.

You can't paint with no group selected, and the only place the tool tells you so is the
status line.

### Where your paint goes

This is the most important thing to understand. Paint can live in three places, and the tool
picks one for you based on the group you have selected:

| You selected… | Paint is stored… | It shows… | Good for |
|---------------|------------------|-----------|----------|
| A **sprite** group (OBJ), in either tool | Once per tile pattern, for the whole game (the "shared pack") | Everywhere the pattern is drawn: in every frame, in any sprite or background that reuses it | Characters and enemies. This is why painting one pose colors the others. |
| A **background** group whose tiles repeat, or any BG group in SpriteStudio | Per tile pattern, but **owned by that group** | Only where that group's tiles appear (its layer and tiles) | Floors, walls, scenery. The same tile can be colored differently in two groups. |
| A **background** group, in **Overpaint** mode (SpriteStudio only) | As a picture pinned to the layer's background map (*overpaint*) | Wherever the layer is on screen, scrolling and zooming with it | Paint tile paint can't do: over blank and transparent pixels, detail one copy of a tile shouldn't share, a whole backdrop. See [Overpaint](#overpaint-paint-over-a-background-layer). |

What this means in practice:

- **Sprite paint leaks.** If the game reuses one of your hero's tiles somewhere unrelated,
  that spot gets your colors too. Play-test and look.
- **Tile paint can't cover blank or transparent pixels.** A tile the game draws as empty, or a
  pixel it leaves see-through, is never coloured by tile paint. That's what overpaint is for.
- **Old overlays and touch-ups become overpaint.** Older packs may hold "overlay" paint pinned to
  exact screen positions, or touch-ups pinned to an anchor tile. SpriteStudio converts them to
  overpaint when it opens the pack (the Project tool turns overlays into touch-ups first); the
  status line says how many, and you save to keep them. One no captured frame shows stays as it
  was. The Project tool no longer paints overlays: BG paint there always goes to the group's tile
  colours.
- **The first stroke on an unpainted tile colors the whole 8×8** with a starter ramp: red
  shades in the Project tool, grey in SpriteStudio. Just paint over it. The starter shades are one
  step of blue off plain red and grey (invisible), so any colour you pick — pure red 255,0,0
  included — counts as paint and can go in a palette slot.
- **Painted tiles…** in the right rail lists every color you've painted, where each is
  stored, and which groups can reach it. Every row has **Clear**. A shared-pack row also has
  **→ group**, which moves that color into the selected background group. Use it when a
  color shows up where it shouldn't.

### Reference images (optional)

To color from concept art, or from a screenshot you colorized in an image editor:

1. Choose **Frame → Export screenshot** and color the image in any editor.
2. Choose **Frame → Add colorized reference…**, pick your image, and tick **Reference
   overlay**. Use **Move & scale** if it needs lining up.
3. Select tiles and click **Fill selection from reference**. The tool samples colors from
   the image into your paint.

SpriteStudio uses the same references: hold **R** to see one, or use **Fill pose from
reference** and **Colours → palette**.

### Screens (memory pools), and when you need them

Every group belongs to a **memory pool**: a "screen" of the game (Title, Level 1, …) that is
recognized by bytes in the game's memory. When painting, pools mostly just organize the
Groups tree. **The screen a group is filed under does not switch its paint on or off.**
Background group colors and overpaint follow the group's tiles and layer, and sprite paint
applies everywhere. To keep a group's paint off some screens, use its **Paint shows when…**
setting (below). (The older position *overrides* are always screen-gated.)

**File → Analyze memory…** compares the memory snapshots taken with your captures and works
out which bytes identify each screen. After that, new groups are filed under the right
screen automatically. Run it once you have captures of several screens, with each screen
captured at least twice under the same state name. You can color a whole game without it;
the New group dialog then asks you to pick the screen yourself.

After Analyze memory, the frame you sent with **Colorize!** is recognised too. Its memory is read
from its save state and matched against the screens. The frame list shows it as, for example,
"Current — … · looks like Level 1", and new groups made on it are filed under that screen.
Frames Colorize! keeps only because you drew a pose on them are left out of the analysis
itself: they aren't named after a screen.

### Menus that highlight with the palette

Some games show which menu option is selected by drawing the same tiles with a brighter palette
(Mario's Tennis draws the chosen difficulty bright and the others dim). Paint is per tile, so once
painted, selected and unselected text look the same. Tick **Follow the game's palette** in a
background group's details (Project tool): its paint then keeps its colour where the game draws
the layer brightest and dims where the game dims it. **Same for N more on world …** turns it on for
the other groups on that layer in one go.

- It compares the palettes the layer uses on that frame. A layer drawn with only one palette is
  unaffected, so in-game text that never changes palette looks as painted.
- Paint as the brightest version should look; the dim versions follow on their own.
- Plain background layers only (not sprites or scaled layers).

### Paint shows when… (screens and game states)

A background group's colours and overpaint show wherever its tiles are drawn. Sometimes that is
too wide: a big overpaint backdrop switches on in a menu because one or two plain fill tiles of
the group also appear there, or a character's paint is right for Mario and wrong for Luigi.
**Paint shows when…**, in the group's details in the Project tool, narrows it. It has two kinds of
rule, and the paint shows only where all of them allow it:

- **Screen**: *any* (the default), *is one of…* (tick screens; the paint shows only on frames the
  game's memory recognises as one of them) or *is not…* (hidden on those, shown everywhere else —
  including frames no screen recognises). Screens come from **File → Analyze memory…**.
- **Conditions on game states**: a **game state** is a named memory condition — one or more bytes
  of the game's memory with their values, e.g. *Luigi is the player*. A condition says the paint
  shows while it **is true**, or while it **is not true**. **Add a condition…** offers the
  project's game states and **New game state…** (type a name, then the bytes as `offset = value`,
  e.g. `0x2014 = 2`); **Only while it's on screen (learn from memory)** (below) learns one. Each
  condition says whether it holds on this frame and on how many captured frames; **×** takes it off
  the group (the game state stays in the project).

Under the rules, the details say what they do together: **This frame: hidden — Luigi is the player
holds**, and **Its tiles are on 6 captured frames: paint shows on 3, hidden on 3 (GameMenu ×3)**.
The group's row gets a pill: **"not GameMenu"** for a screen, **"while Luigi is the player"** for a
condition. **This pixel** names the rule that turned the paint off.

**Filed under** (further down the details) is only where the group sits in the group list — its
pool and variant. It never changes where the paint shows.

Things to know:
- **Prefer "Every screen except…"** for a group that misbehaves on one screen. A screen's recipe
  is often just one or two bytes of memory, and may not recognise every frame of that screen: on
  the Mario's Tennis project, InGame recognises 38 of the 60 frames captured during matches, so
  "Only on InGame" would hide the paint on the rest. "Every screen except GameMenu" only needs the
  menu to be recognised, which it is on all 3 menu frames. Check the frame counts, and the
  "hidden on" line, before you rely on a screen.
- **What it hides:** the group's tile colours and overpaint. Sprite paint lives in the shared
  pack, per pattern, so it is not affected. The tiles stay in the group.
- **Frames without memory** (older captures with no RAM dump or save state) always show the paint.
- **SpriteStudio** shows a note in the Overpaint panel. The stage always shows the picture so you
  can paint it, even on a frame where the game hides it.
- The emulator, **Save and Play**, the web player and the native player all follow it, from the
  game's live memory.

#### Only while it's on screen (learn from memory)

**Only while it's on screen (learn from memory)**, next to *Add a condition…*, learns a game state
for the group from the frames already captured:
- It sorts the captured frames of the group's screen into the ones showing the group (a few of its
  own tiles — ones no other group has — are drawn) and the rest, and looks for one byte of game
  memory that is the same on every frame of the first kind and different on every frame of the
  second.
- If it finds one, it adds a game state (e.g. *Toad on screen*: the screen's own bytes and the one
  it found) and a condition on it. The details say which byte it used and how many frames it learned
  from — and, when that is few, or many other bytes would have done as well, that it may be chance:
  capture more frames with and without the group and learn again.
- If it can't, it says why and changes nothing: *every captured Title frame is one of the frames
  showing it, so there is nothing to tell apart*, or *no byte of game memory is the same on all 9
  frames showing Luigi and different on the other 63 InGame frames*.

It works when the game keeps a state for what you want to tell apart, and a handful of captures
already show it. It can't when the same scene just has different things on screen: in Mario's
Tennis, Mario and Luigi share 26 tiles, and during a Luigi vs Mario match the game's memory is the
same whichever of them is in view. The deeper way is a question answered from recordings (next).

### Questions and recordings: telling game states apart

When a group's colours depend on a state of the game — who is the player, which court, which menu
item is picked — and the captures you have don't show it cleanly, ask a **question** and answer it
from **recordings**. It takes a few play sessions, so it is for the groups that clearly need it.
The idea: a byte of memory that holds one value whenever *Luigi is the player* and another whenever
*Mario is*, however the match goes. Over many moments of play, every position, score and animation
byte changes and drops out; the bytes that follow the state stay.

1. **Ask.** **Project ▸ Game states… ▸ New question…** in the Project tool (or **New question…** in the
   emulator's Memory panel): the question (*Who is the player?*) and its sides (*Luigi is the
   player, Mario is the player*). **Check project** offers **Tell them apart…** for two groups that
   each turn up alone on some frames.
2. **Record**, in the emulator (**Memory** button). Pick the question and a side, then **Record 5 s**
   (the length is adjustable) or **Record until stopped**. While the panel is open, **1–9** pick a
   side — switching the recording to it as you play — and **0** stops. A recording is memory only,
   about 10–15 KB for 5 seconds (a capture is about 200 KB). Make several per side, at different moments and in more
   than one session (another match, another level). They go to the Project tool with **Colorize!**
   (or **Export .vbpack**).
   You can also add captured frames: **Add this frame** next to a side, in the Game states window.
3. **Analyse.** The Game states window shows each side's recordings, samples and sessions, and **N
   bytes still fit** — the bytes that hold one value on every sample of each side and a different
   value for each side — with what would help (*"Mario" has 2 recordings — make at least 5*). It
   says **enough to trust it** at 5 recordings from 2 sessions per side. **Near misses** are bytes
   that would fit but for one recording, usually one made with the wrong side picked: **Move to …**
   or **Drop** it.
4. **Check it live.** The Memory panel's **Now** shows which screen and game states hold right now,
   and the live value of each byte they test. Play, and watch it switch when it should. **Looks
   right** marks a game state as checked; the Game states window shows when.
5. **Save as game states.** Tick the byte(s) to use (the first is ticked) and save: each side becomes
   a game state. Then give groups conditions on them in **Paint shows when…**. Saving the question
   again later updates the same game states, so the groups keep them.

The Game states window also lists every game state — its bytes, which groups use it, when it was
checked live — with **Rename** and **Forget** (which takes it off every group).

Packs saved on Oct 8 2026 kept learned states as "sub-states" of a screen; they open as game states
and conditions, unchanged in what they do.

### Saving

**File ▸ Export for player…** writes a play pack for the [sythnvtby Player](#the-vb-color-player) instead: the colour only, no ROM or captures. It exports the project as it is now, saved or not.

**File ▸ Import from another pack…** brings work from another `.vbpack` of the same game into the
open project — for example when you painted in two copies of a pack by mistake.
- It first lists what would come across: groups the project lacks, and for groups both have, the
  poses, painted tiles and criteria it lacks; captured frames, reference pictures, sprite colours
  and position overrides it lacks. Groups are matched by id, else by name. A pose already there
  under another id is not added twice.
- **Where both packs have something different** (a tile painted differently, a group's layer
  art): keep this project's (the default) or take the other pack's.
- Nothing is removed from the project and the other pack is only read. The project reloads on the
  same frame and group, **unsaved**: look it over, then **Save** writes to the file you opened.

**File ▸ Import VBoy Color pack (.vbcp)…** brings in a colour pack made for
[VBoy Color](https://github.com/yuk27/VBoyColor), another Virtual Boy colouring emulator (GPL-3.0),
as a head start: their packs key colours by the same tile hash ours do, so they land on the same
tiles. It shows what it would bring and whether the pack was made for this project's ROM, then:
- **Tile colours** become shared colours (they apply wherever the game draws the tile), only for
  tiles this project has no shared colours for yet.
- **No groups are made.** Per-layer, per-palette, map-cell and per-character colours are counted
  and left out: where one of those spots looks wrong, make a group of your own for it.
- Nothing you painted changes; the project reloads **unsaved**. The import is noted in the pack
  (`vbcpImports` in its manifest) so the colours stay credited to VBoy Color. It brings colours,
  not your groups: tiles still sit in the shared colours until you put them in groups.

### Which group wins a shared tile

Two groups can include the same tile pattern on the same layer — a letter both *NORMAL* and
*HARD* use, a player's shoe that Mario's and Luigi's groups both have. Where both paint it
differently, **the tiles next to it decide**: if a tile beside it (left, right, above, below, or
failing those a corner) belongs to only one of the two groups, that group colours it. So the R in
*HARD* takes HARD's colours because H and D sit beside it, and the corner tile of the far player
takes that player's colours, even when the other group comes first in the list. A run of shared
tiles is settled from its ends. On a scaled layer (the far player in Mario's Tennis) "next to" means
next to it in the game's background map, whatever the zoom.

Where nothing next to the tile says whose it is (a whole word both groups have, or one group's
tiles on one side and the other's on the other), **the group listed first wins**, and the other's
paint for that tile never shows. The order is the order of the groups in the project
(`groups.json`). Only those tiles are the order's to decide, and only they are reported below.

- A group whose tiles take another group's colours on the frame you're on says so on its row:
  **behind Mario-PlayingAs**. That only shows when the group is on screen without the winner — when
  the winner is really there, its colours are the right ones.
- Its details list **Shared tiles** on this frame, both ways: *Behind Mario-PlayingAs on 3 tiles*
  with **Put this group first**, and *Ahead of Luigi on 3 tiles* with **Let Luigi win**. Each
  moves one group just above the other in the list. Save to keep the new order.
- **This pixel** offers the same: *Mario wins because it comes first in the group list* comes with
  **Let Luigi win**. Where the neighbours decided, it says so (*Mario wins because its own tiles are
  next to it*) and offers no reorder: the order does not change that tile.
- If both groups are on screen at once, no order makes both right: one pattern on one layer takes
  one group's colour. If each turns up alone on different screens, limit one of them to its own
  screens (**Paint shows when…**, in its details) instead of reordering — or, when the game's memory
  says which is showing, give it a condition on a game state.
- Tiles a pose picture or overpaint covers don't count: the picture shows there, whichever group
  wins.

### Project ▸ Check project…

The same questions as **This pixel**, asked of every captured frame. It runs by itself a moment
after a project opens and after you change groups or paint, a few frames at a time so the page
stays responsive; **N to check** appears next to File when it finds something. Each item is named
once however many frames show it, with one fix and **Show me**, which opens a frame that shows it
with **This pixel** explaining the spot:

- **A group moved to another world** — *LUIGI text: its tiles are drawn on world 18 on 23 frames,
  and its paint drops out there — it only paints world 17.* **Add world 18**.
- **A group's tiles taking another's colours** — *Luigi: on 3 frames it is on screen without
  Toad, and 1 of its tiles takes Toad's colours.* **Let Luigi win**. When each group is on screen
  without the other somewhere, it says changing the order would only swap which one looks wrong,
  and offers **Select** so you can limit one to its screens.
- **A layer scrolling past its overpaint** — *Crowd: on 14 frames its layer scrolls past its
  overpaint, and 6 of its tiles show past the picture's edge uncoloured.* Tiles you painted plainly
  count too (*in their plain tile paint, not the picture*): beside a backdrop picture they don't
  match it. **Select Crowd**, then paint more of the picture in SpriteStudio (or use *Cover the
  whole map*). Auto-capture's **Where paint doesn't cover yet** finds the frames while you play.
- **A damaged picture** — SpriteStudio sets it aside when it opens the project, so it can be put back.
- **A condition on a game state the project doesn't have** — it is ignored until you remove it or
  pick another.
- **Two groups that each turn up alone** on some frames, sharing tiles — no order suits both:
  **Tell them apart…** starts a question with the two as sides
  ([Questions and recordings](#questions-and-recordings-telling-game-states-apart)).

Folded away underneath: **Not painted yet** (tiles in a group with no paint, a to-do list),
**Shared tiles that take one colour** (groups always on screen together that share tiles —
worth knowing, nothing to fix by order), and **Frames no screen recognises** (screen limits treat
them as some other screen; **Analyze memory…** again with more frames of each screen). It looks at the left eye only; the right eye nearly
always repeats it.

**Project ▸ Project storage…** shows what the project's space is used for: frames (picture data,
screenshots, save states, memory dumps), memory recordings, reference and recovered pictures,
groups and paint — how many, how big before compression, what each is for and what goes without
it — and the `.vbpack`'s size on disk (the status line after **Save** says it too). **Clean up
frames…** is there for frames; **Delete recordings** takes a question's recordings out (the question
and its game states stay). Memory recordings are small; screenshots, frames and save states are
most of a big project.

**Project ▸ Clean up frames…** takes captured frames you no longer need out of the project, which
keeps the `.vbpack` smaller and the Frame list shorter.
- It lists every frame by screen (state name), with its screenshot, size and why it stays or can
  go. **Frames a pose was captured from, or with a reference picture, always stay** (SpriteStudio
  shows poses on them), and can't be ticked.
- **Suggested** frames are ticked to start with: everything they show is also on another frame of
  the same screen, so no tile pattern and no screen a group appears on is lost. Tick or untick any
  others; a frame with "tile patterns no other frame shows" is the only place you can see those.
- Each row also says how much of the frame is uncoloured, and **Show** narrows the list to
  **Fully coloured** frames (likely done with), or ones with uncoloured tiles or pixels. Frames
  the filter hides are unticked, so nothing you can't see is archived or deleted.
- **Archive…** saves the ticked frames into a separate `.vbpack` (named
  `<project>-frames-<date>.vbpack`), then takes them out. **File ▸ Import from another pack**
  brings them back. **Delete…** takes them out with no copy.
- Paint is never touched, and auto-capture still treats what the removed frames showed as already
  captured, so it won't stop on those scenes again. The project reloads **unsaved**; **Save** to keep
  it.

- **Save** (File menu) writes back to the file you opened, and keeps a `.bak` if you have a
  project home. If there's no file to write back to, it saves into the project home, or
  failing that it downloads.
- **Save and Play** saves the same way, then returns you to the emulator at the frame you
  came from, in color.
- **SpriteStudio →** carries your unsaved work across, so you don't need to save first.
- The **Emulator** button, **File → Open pack…**, closing the tab and refreshing all ask
  before discarding unsaved edits.
- A save window shows progress. Large projects (100+ frames) can take several seconds.
- **If the file can't be written** (disk full, the file locked or its permission lost), the save
  window says why and offers **Save as…** (another file) and **Download a copy** — the same
  project, so nothing is lost. SpriteStudio does the same.

---

## SpriteStudio

SpriteStudio shows one sprite at a time, pose by pose, over a loud backdrop so you can see
its edges. It's the nicest place to paint characters.

### Layout

- **Left:** **Sprites** (your sprite groups) and **Other groups** (background groups, which
  you can paint here too).
  - **Search groups** (top of the column, **Ctrl+K**): filters both lists as you type. Every word
    must appear in a group's name or folder, in any order (`luigi play` finds *Luigi-PlayingAs*);
    folders with a match open to show it, without changing how you left them, and the count shows
    how many match. **Enter** opens the first match, **↓** moves into the list, **Esc** clears.
  - **Folders.** Each list can be sorted into your own folders:
    - **+ Folder** makes a new one; use `/` to nest, e.g. `Enemies/Koopas`.
    - **To file a group,** drag it onto a folder, or pick one under **Folder** at the top of the
      right panel. Drop it on the list outside any folder to move it back to the top level.
    - **To put a folder in another folder,** drag it (by its name) onto that folder; its groups
      and sub-folders go with it. Drop it on the list outside any folder to bring it back to the
      top level. If a folder of that name is already there, you're asked before they merge.
    - **Hover a folder** for ✎ (rename, which can also move it under another folder) and ✕
      (remove: its groups move up a level, nothing is deleted).
    - **Saving:** folders are saved in the pack, and the Project tool keeps them when it saves.
    - **Collapsed folders** are remembered in this browser.
- **Center:** the stage. Under it is the **filmstrip** of poses (**▶ Play**, fps), and for
  sprites, the **Animation** panel.
  - A **background group** gets one card per captured frame that shows something new of it: a
    static screen gives one card, a character animated through different tiles (the far player
    in Mario's Tennis) gives one per drawing. The group's own screen comes first.
  - **Keep as pose** (Pose details) saves the card as one of the group's poses. Once a group has
    poses its filmstrip shows just those; delete them all to see every frame again.
- **Stage toolbar (top):**
  - **Background** draws the scene the pose was captured on. It's off by default, which is
    better for painting.
  - **Pin bg** holds one background still while you flip through poses.
  - **Outline**, **Zoom**, **Fit**.
  - **One set** (background groups whose tiles repeat, like a cloud strip): shows one copy of the
    repeating block at full strength and the other copies faded. Paint is per tile pattern, so
    painting the one copy colours all of them. Untick it to see and paint the whole group. A
    region has to hold at least two whole copies to count as repeating, so a framed panel (a
    scoreboard whose left and right borders match) is no longer mistaken for one.
  - **Show unpainted** (on by default; remembered): tiles with no paint show in red, exactly as the
    Project tool shows them (the game shows those as the original picture). Pixels of painted tiles
    that still hold a starting grey are tinted red: the game shows that grey, but nobody picked it.
    Hover a pixel to see which it is, and **Pose details → Painted** counts both. The palette leaves
    the starting greys out, so a grey you pick yourself counts as painted. Untick it for the plain
    grey preview.
  - **Only this group's paint** (on by default; remembered): the group you're painting shows only
    its own paint on its tiles — not colours another group, or the shared pack, gives the same tile
    patterns in the game. So a character never looks half-painted in another character's colours
    while you work; unpainted tiles look unpainted. Untick it to see what the game shows, where a
    shared tile takes the colours of the group whose tiles are next to it, or of the group listed
    first (among those allowed on the screen) where nothing next to it tells.
  - **Base tiles** (scaled groups only, like the far player in Mario's Tennis): shows the group's
    tiles unscaled, as they sit in the game's background map, instead of zoomed by the game.
    Paint them there with any tool; paint is per tile pattern, so every scaled copy on every frame
    follows. Each card shows the drawing that card's frame used. Untick it to check the result scaled.
    **Overpaint** shows here too, laid out in the game's map: paint it on Base tiles or on the
    zoomed card, whichever is easier. Switching Base tiles keeps you on the same frame.
  - **Brightness** (header) brightens unpainted tiles only. At 1, unpainted tiles show in the same
    greys a tile's paint starts from (the shades the game's palette shows them in), so the first
    stroke on a tile changes only the pixel you paint.
  - Paint shows at full strength on a game's normal screens, even in games that always run dim
    (Mario's Tennis); it only dims while the game fades. The emulator does the same.
  - **Onion** ghosts other poses over this one. The menu beside it picks which: **Previous &
    next** (faint, behind this pose) or any one pose, drawn **on top** and lined up on its anchor
    tile so it sits over this pose even when the two come from different frames. Choosing a pose
    turns Onion on. **Opacity** sets how strong the ghost is (remembered in this browser). The menu and Opacity show only while Onion is on, as Original's Opacity does while Original is on.
  - **Original** draws this pose's original picture (the game's monochrome, in greys, with no
    paint) over your paint, lined up pixel for pixel. Use it to check colours filled in bulk: at a
    low **Opacity** you see it through the paint; **hold O** to flip to it at full strength and
    let go to see your paint again. Brush and Eraser keep painting underneath.
  - **Behind** sets the backdrop color. It defaults to hot pink so dark edges show.
  - **Flip ↔ ↕** mirrors the view only. Stored paint keeps its original orientation.
- **Tool rail (right of the stage):** **Look (V)**, **Brush (B)**, **Eraser (E)**, **Fill (G)**,
  **Swap (S)**, **Pick (I)**, **Clone (C)**, **Auto-paint (A)**, **Paint on: Tiles / Overpaint (T)** and **Show overpaint**
  for background groups, **Size**, the color box, a **Palette** of colors you've used, **Undo**
  (Ctrl+Z), **Redo** (Ctrl+Shift+Z or Ctrl+Y), and **Clear…**. The **Eraser** takes paint off the
  pixels you drag over: on tiles the game's own picture shows there again (a tile with nothing left
  counts as unpainted), on an overpaint the layer beneath shows through.
  - **Auto-paint (A)** colours a group's unpainted poses from poses you have painted. It opens a
    window listing every pose with how much of it is painted: tick **Learn from** on the poses to
    take colours from (it starts with the fully painted ones) and **Paint** on the poses to colour
    (it starts with all the rest), then **Auto-paint**. A bar shows its progress; **Stop** ends it
    with nothing changed. It matches each pixel by what surrounds it, not by position, so poses
    don't have to line up — but a pose learns best from poses facing the same way, so paint one
    side view before auto-painting the other side views. Only pixels nobody chose a colour for are
    painted, a reference pose's tiles are never touched, and one **Undo** takes the whole run back.
    Check the result with **Original** (hold O) and fix it with the Eraser and Brush.
  - **Clear…** works on the pose or card you're looking at. Colour is stored per tile pattern, so
    it asks: **Clear this pose only** (the tiles no other pose or card of the group uses; shared
    tiles keep their colour everywhere) or **Clear all, shared tiles too** (the other poses lose
    that paint). It lists which poses share tiles, and Undo brings it all back.
- **Find poses…** (Pose details, for a background character or a sprite group with a pose kept)
  looks through the captured frames for the character's poses you have not kept and for poses kept
  twice. For a background character it looks only where the character really is (its layers that
  are not scaled, on frames where its game-state conditions hold) and leaves out fragments much
  smaller than its usual pose. For a sprite it looks at every frame's sprites that share the group's
  tiles; a pose facing the other way (or upside down) is the same pose, so it is not offered again.
  For a character kept as scaled poses (an opponent drawn through the court's zoom) it only looks
  for duplicates: two scaled poses with the same patterns. Keep new scaled poses from the filmstrip.
  New poses come ticked to keep, each from the first frame showing it — except one that also has
  another sprite group's tiles (the card says whose: usually two sprites touching, sometimes a real
  pose such as Mario carrying a shell) or one only ever seen cut by the screen's edge. Duplicates
  come ticked to remove, keeping the one with a picture or a name you chose — removing one moves its
  animation steps, and its picture if the other has none, to the one kept. A duplicate you named
  starts unticked, and one where both have a picture is only listed. Nothing is written until you
  Save.
- **Find sprites…** (next to *Sprites* in the left rail) is for a game's sprites before you have
  groups for them — Wario Land straight after capturing it. It looks at every captured frame's
  sprites, takes out the poses your sprite groups already keep (whichever way they face), and leaves
  out two sprites that were touching and a sprite cut off by the screen's edge. What is left is
  grouped into characters by the tiles their poses share: each character is a **New sprite group**
  (name it in the box) or **Add to** the group it shares tiles with. Untick poses that don't belong
  and characters that are not sprites (HUD digits, menu icons); one- and two-tile bits are under
  **Small bits**, unticked. Apply makes the groups and poses; Save keeps them. Groups can be renamed
  in the Project tool.
- **Mirrored poses.** A sprite facing the other way is the same pose: SpriteStudio and the Project
  tool find a pose mirrored (left–right or upside down) when it isn't there as captured. Turn off
  **Mirror OK** on a pose in the Project tool when its art is not a true mirror image, and its
  mirrored copy is treated as a pose of its own.
- **Painting complete** (Pose details, right rail) finishes the card on stage: every pixel still
  unpainted — a tile with no paint, a clear pixel, or a starting grey — keeps the grey it shows as
  paint of its own (the same grey to the eye), so the pose stops counting as unpainted and you don't
  have to hunt single pixels. The button says how many pixels are left; tiles other poses share keep
  that grey too, and Undo takes it back. A cyan **◪** at a card's top right means that pose still
  has unpainted pixels (the amber ◩ top left is its own overpaint picture).
- **Right rail:** **Reference** (show, opacity, side by side, fill from reference) and
  **Pose** details.

### Overpaint: paint over a background layer

Tile paint is shared: every copy of a pattern gets the same colours, and blank or transparent
pixels never get any. **Overpaint** is a picture you paint over a background group's layer, for
what tile paint can't do: filling the black gaps in a pipe, a highlight on one corner piece and not
the others, the sky above a crowd, or a whole backdrop.

> **At a glance** — think of overpaint as a transparent sheet laid on one background layer.
> - **The layer is the canvas:** paint can go anywhere on the layer, not just on the group's own
>   tiles — over blank pixels, over other groups' tiles, above and below a strip layer.
> - **The group is the switch:** the sheet is drawn only on frames where its group has a tile on
>   that layer.
> - **Background groups only.** Sprite (OBJ) groups have no overpaint — sprite paint stays per tile.
> - **Plain and scaled layers work the same way** for you; a scaled (affine) layer's sheet zooms with
>   it, and only plain layers can *hide the tiles under it*.
>
> The full reference — what turns it on, depth, stereo, groups sharing a layer, and a side-by-side
> table of sprite / plain / scaled groups — is [Overpaint: how it works](../reference/overpaint.md).

- **Where it shows:** the picture is pinned to the layer's own background map — not to the screen,
  and not to the tiles around some spot. It scrolls, zooms and keeps its stereo depth with the
  layer, and shows on **every frame where the group is on that layer**, however far the layer
  scrolls and whatever column the game starts it at.
- **Which layer:** it's drawn at the layer's depth, over its tiles. Anything in front of the layer
  still covers it, and it dims with the game's fades.
- **One per group.** It replaces the old touch-ups and layer art (see *Older packs* below).

To paint it:

1. In SpriteStudio, select the background group under **Other groups**, on a card that shows it.
2. Press **T**, click **Overpaint** under **Paint on** in the tool rail, or click **Add overpaint**
   in the **Overpaint** box in the right panel. The first time starts a clear picture on the layer
   the group is drawn on.
3. You're now in **Overpaint mode**: the stage gets an amber border and an **OVERPAINT · pinned to
   this layer** badge. Strokes go on the picture, anywhere on the layer — there is no box to grow.
   While you paint, the picture covers the layer's whole background map loop and the screen's
   height, so you can paint the sky above a strip layer, or the part of the loop another card is
   scrolled to (a group with overpaint gets a card for each scroll position the captures show).
4. Paint with **Brush** (with **Size**), **Fill**, **Swap**, **Pick** and **Clone**. **Fill** stops
   where the picture you see changes: overpaint, the tile paint under it, and the scene when
   **Background** is on. Turn Background off to fill across the scene.
5. **Scaled (affine) layers:** paint the card as it is, zoomed — strokes go through the zoom and
   land in the layer's map. **Base tiles** shows the same picture on the unscaled tiles; paint
   whichever is easier.
6. **Import image… / Paste / Ctrl+V / Copy / Export PNG** work on the whole picture. **Clear**
   erases it, **Remove** drops it (Undo brings either back).
7. Press **T** or click **Tiles** to go back to tile paint. Selecting another group always goes
   back to Tiles. **Show overpaint** (tool rail) hides or shows it on the stage and in the scene;
   hiding it while painting goes back to Tiles.
8. **Save**. The picture is stored cropped to what you painted, as a PNG on the group. The
   emulator, the Project tool (an **overpaint** pill on the group and a line in its details) and
   the sythnvtby Player draw it. You edit it in SpriteStudio.

**Hide the tiles under it** (a box in the Overpaint panel, plain layers) makes the layer show only
the picture — what *layer art* used to do, for backdrops built from a few repeated tiles where tile
paint blends together. Turning it on widens the picture to the layer's whole map loop and starts
every clear pixel from how the tiles look, so nothing goes blank; then paint over it, or Import a
picture. With it on, strokes always go to the picture, and the Project tool won't paint that
group's tiles. For such a picture the panel also offers **Fill the screen's height** (rows above
and below the layer, starting see-through) and, for older layer art made from one frame, **Cover
the whole map**.

**A backdrop that scrolls.** Some games start a backdrop at a different column depending on the
moment — Mario's Tennis scrolls its crowd 112 px when the serve changes sides. A picture painted on
one scroll then stops short, and the plain tiles show past its edge. When captured frames do that,
the Overpaint panel says so ("33 captured frames scroll this layer past the painted part…") and
offers **Cover the whole map**: the picture widens to the layer's whole map, and every new column
that shows the same tiles as a column you already painted starts as a copy of it (backdrop maps
usually repeat). The status line then lists the columns the captures still show unpainted — paint
those on a frame that shows them. Undo takes it back. Capture a frame at each scroll you see in
play, so the panel can tell you.

Things to know:
- **When it applies:** while the group has a tile on screen in that layer, in a layer drawing from
  the same background map. A group whose objects hop between worlds drawing the same map (Mario's
  Tennis's players) keeps its picture on either.
- **Only the group's own tiles switch it on.** A tile other groups on the same layers also have
  (a plain fill or "black-out" tile shared by two characters, a menu strip's fill) doesn't count,
  so Toad's picture stays off when Mario is on screen. A group whose tiles are all shared with
  others is switched on by any of them.
- **Still showing up on the wrong screen?** Use the group's **Paint shows when…** setting to keep it
  off that screen ([Limiting a group to some screens](#limiting-a-group-to-some-screens)).
- **Characters paint one pose at a time.** A background group with two or more saved poses (a
  character like Luigi-PlayingAs) paints **this pose only** by default: press T (or **Paint this
  pose**) and the pose on stage gets a picture of its own, kept inside the group, that shows only
  when *all* of that pose's tiles are on screen; when one pose's tiles are all part of a bigger
  pose, only the bigger one's picture shows. Move to another pose's card while painting and your
  first stroke there starts *its* picture — it never falls back to a picture for every pose.
  - **The badge says where strokes go:** *OVERPAINT · THIS POSE ONLY (name)*, or, after you choose
    **Paint all N poses instead**, *OVERPAINT · ALL N POSES* in orange — a picture that shows on
    every pose. **Back to this pose only** switches back. The choice lasts while SpriteStudio is
    open.
  - **The picture follows its pose.** It is tied to the saved pose it was painted on, so
    recapturing the pose or moving its tiles doesn't strand it; deleting the pose (in either tool)
    deletes its picture too.
  - **Other groups** (backdrops, menus, title art, one-view groups) paint the group's own picture
    as before. **Overpaint just this pose** still makes a pose picture for them by hand, and
    **Move this overpaint to this pose** hands a pose the picture you already painted.
  - On a pose's card the panel reads **Overpaint · this pose (…)**; **Remove** there removes just
    that picture, and Undo takes a Move back. Pose pictures never hide the layer's tiles.
  - **Drawing on this card**, at the top of the panel, lists what actually draws on the card on
    stage: *this pose's own picture*, *the group's all-poses picture*, both, or *no overpaint*.
    A character's all-poses picture (often left from before pose pictures) is marked in orange —
    it shows on every pose — with **Move it to this pose** and **Remove the all-poses picture**
    right there, whichever way the panel is painting. Pose cards with a picture of their own carry
    a small ◩ in the filmstrip.
  - Packs saved with the older one-group-per-pose version are folded into their group when
    SpriteStudio opens them, and older pose pictures are tied to their saved poses (save to keep
    it). The Project tool lists a group's pose pictures in its details.
- **The cards show the overpaint.** Pose card thumbnails include the picture (and redraw as you
  paint); **Show overpaint** hides or shows it on every card of the group, not just the stage.
- **Paint belongs to the group you selected.** A stroke over another group's tiles is part of *this*
  group's picture, so it shows only while this group is on screen. Paint it in the other group's
  overpaint if it belongs there.
- **Several groups on one layer** each get their picture; where they overlap, the group higher in the
  list is on top. Hide the tiles hides *all* of that layer's tiles, and only one group per layer can
  use it.
- **Objects the game redraws at another place in its map** (rather than scrolling them) lose their
  overpaint where they move; tile paint still covers them.
- **Not yet:** animation the game does by rewriting tiles (the starfield twinkle), HBias layers,
  and Hide the tiles on scaled layers.

**Older packs.** When SpriteStudio opens a pack, its touch-ups and layer art become overpaint; the
status line says how many, and you save to keep it.
- **Layer art** becomes overpaint with **Hide the tiles under it** on — the same picture, in the
  same place.
- **A touch-up** is placed in the layer's map where a captured frame shows it, with the same
  pixels, so it now shows on every frame where the layer is on screen. (In the Mario's Tennis
  project, the title screen's touch-up was drawn on 2 captured frames and the intro ball's on 9;
  as overpaint each shows on 11.)
- A touch-up **no captured frame shows** can't be placed, so it stays a touch-up: it is still
  drawn where its tiles line up, and the Overpaint panel offers to remove it.
- Old screen-pinned overlays take the same path. Until a pack is opened in SpriteStudio, the
  emulator and the Project tool keep drawing its touch-ups as before.

### Zooming backgrounds (affine layers)

Some scenes scale or rotate a whole background layer, like the Clash Tower zoom in Mario Clash's
intro. The Virtual Boy calls these **affine** layers, and the tile inspector shows **Layer Affine**.

- **Colours follow the zoom.** Tile paint is looked up pixel by pixel as the game scales the
  layer, so a tile you paint once is right at every size, in the emulator and both tools.
- **Paint on any frame.** Click, Brush, Fill, Pick, the marquee and Zoom to selection all work on
  a zoomed frame: selections are shaded over the tile's scaled shape, and one brush pixel paints
  that tile pixel everywhere it is drawn, scaled like the rest. Zoomed in, the pixels are large,
  which makes careful painting easier.
- **One group covers both.** A background group made while the layer was still normal covers it
  when it starts zooming, and the other way round.
- **In SpriteStudio** a scaled group's cards show it through the game's scaling, and **Base
  tiles** shows its tiles unscaled to paint them directly. Overpaint on a scaled group is painted
  on the zoomed card or on Base tiles, and drawn scaled in the emulator, both tools and the player.
- **Not yet:** **Hide the tiles under it** doesn't apply on affine layers (the picture is drawn
  over the tiles).

### Swap: recolour a whole group in one click

**Swap (S)** is the quick way to block in a group. Choose the new colour, then click a pixel
showing the colour you want to change: every pixel of that colour in the group's tiles changes,
across all its tiles and poses at once, including copies you can't see on this frame.

- **Uncoloured pixels are matched by their shade,** so on a fresh group you can colour it shade
  by shade: click a pale pixel with sky blue, a darker one with navy, and so on. (Strictly it is
  the tile's pixel value that is matched, so pixels that look alike but use a different palette
  are left alone.)
- **Transparent pixels too.** Click a see-through pixel of the group and every transparent
  pixel in its tiles takes the colour. From then on they are drawn, covering whatever the game
  shows behind them — the grass between the speckles of a tennis court, say. Fully blank tiles
  (every pixel see-through) are only in a group if you selected them with **Blank tiles** on in
  the Project tool; add them when the empty cells around a court should be coloured too.
- **Overlapping groups:** when two groups share a tile, the first one in the list supplies its
  colours. Colour the group you mean to, or remove the duplicate.
- **One click is one Undo step,** and **Clear…** still starts the tiles over.
- **On overpaint** it swaps that exact colour inside the picture.
- **Groups are defined in the Project tool.** On a scaled (affine) layer such as a court, set
  Layer to Affine, pick the world, drag across the whole screen, and make a group from that.

### Coloring a sprite across all its poses

1. Arrive from the Project tool with **SpriteStudio →**. Your sprite is pre-selected — unless a
   saved pose on the frame you were on still has pixels nothing colours: then SpriteStudio opens
   that pose (one of your selected group's first, if it has one there) and the status bar says how
   many pixels are left and how many other poses on that frame need paint. **Show: With uncoloured
   pixels** in the Project tool's frame list finds those frames.
2. Look through the filmstrip. Delete duplicate or broken poses with the **×** on the card,
   or press **Delete**. The tile patterns only that pose used leave the group with it, along with
   their paint, so they stop painting where the game shows them; tiles other poses share keep
   theirs. (A group's last pose takes nothing with it.) If a group lists patterns none of its poses
   use — left by a pose deleted before this, or by the frame the group was first made from — Pose
   details says how many and offers two fixes. Often they are a real frame of the animation (the
   game drawing the character with its own tiles), and removing them would make it flash the
   original picture there: **Keep as pose** turns the frames showing them into poses so you can
   repaint them. **Remove…** takes them out of the group with their paint, and lists the frames
   they show on.

   **Rename…** (or **F2**) in Pose details renames the pose (with **Base tiles** on, a scaled
   pose's "· base tiles" card renames, deletes and moves that pose). **Move to** sends it to another
   group of the same kind (sprite or background); affine and flat poses can share a group. The
   tile patterns only that pose used
   leave the old group with their paint and join the new one; the new group gets their paint where
   it has none of its own. Patterns the old group's other poses share stay there with their paint:
   the new group lists them but gets no copy of that paint (a copy used to bring one character's
   colours onto another — Mario's red onto Luigi's tiles). The pose's animation steps in the old group go. Use it for a pose captured into
   the wrong group, like an intro pose filed under the in-game group: left there, the old group,
   if it comes first in the list, keeps painting those tiles.
3. Press **B**, pick a color, and paint pose 1. **G** fills an area; **I** picks a color
   from the stage.
4. Press **→** for the next pose. Tiles you've already painted are colored there too, so
   paint only what's still grey. Reuse colors from the **Palette** swatches to stay
   consistent.
5. Optionally, build an **animation**: click **New…**, add each step with **+ Pose**, set its
   **hold** (in game frames), tick **mirrored** for steps facing the other way, then click
   **▶ Play track**. *Animations are a preview for checking your work. The emulator doesn't
   use them.*
6. Click **← Project tool** at the top left to go back, then **Save and Play** there.

**Save in SpriteStudio** writes over the `.vbpack` you're working on — the same file the Project
tool saves to (or the file you opened here) — keeping a `<name>.bak.vbpack` copy in the project
home first. No file dialog: the first Save in a browser session may show the browser's own
"allow editing this file?" prompt, once. Hover the pack name at the top to see which file Save
writes. **Save as…** asks for a file, and Save writes that one from then on. Only a pack opened
from no file SpriteStudio can write back to makes Save ask where, once. If the browser refuses to
write, nothing is saved anywhere else: the status line says so.

**← Project tool does not save to disk.** It carries your changes back to the Project tool,
unsaved (its status line says *Not saved yet — Save writes …*), and **Save** there writes the same
file. So either Save here, or go back and Save there — both write the one `.vbpack`.

A pack handed over from the Project tool opens once: reloading SpriteStudio, or coming to it from
the tools page, starts empty rather than reopening an older hand-over.

### What colours this pixel? (Pick)

**Pick (I)** takes the colour under the pointer, and also says in a small bubble what colours that
pixel in the game, or why nothing does — the same answer as the Project tool's **This pixel**.
With **Background** off it answers for the sprite's own tiles (what the stage shows); with it on,
for whatever the game draws in front there. A fix, when there is one, is a button in the bubble
(select the group, or add the world it is drawn on). The bubble goes at the next click, **Esc**, or
another tool.

### When something goes wrong: recovery

SpriteStudio is built so a problem with one part of your project costs that part, never the
session.
- **Unsaved work is kept as you go** — in SpriteStudio and in the Project tool. A couple of
  seconds after each change (three after you stop, in the Project tool) the tool keeps a copy of
  your unsaved work in the browser. If the tab crashes, is closed or reloads before you save,
  opening the same pack again asks *Restore it?* — OK brings the work back (unsaved: Save to keep
  it), Cancel throws it away. A successful Save, handing the pack to the other tool, or leaving
  for the emulator after saying yes to losing your changes clears it. The Project tool's copy has
  groups and paint, game states and frame names; frames, reference pictures and recordings come
  from the pack file, so ones added since the last save are not in it. It lives in this browser
  only, so it is no substitute for saving.
- **A damaged picture is set aside, not lost.** A picture (overpaint) whose stored image doesn't
  match its size and place — so drawn it would land in the wrong spot — is taken out when the pack
  opens, or at Save after asking, and the rest saves as normal. It is kept in the pack and listed
  under **Recovered pictures** in its group's Overpaint panel, and the group's row says
  *N recovered*:
  - **Put back** finds where the paint fits the group's tiles and puts it there (it asks first
    when the fit isn't certain).
  - **Export PNG** saves the paint as an image, to Import by hand.
  - **Discard** throws it away for good (it asks).
- **A failed write** offers Save as… and Download a copy, as in the Project tool.

### Keys

| Key | Action |
|-----|--------|
| V / B / E / G / I / C / S | Look / Brush / Eraser / Fill / Pick / Clone / Swap (Pick also says what colours the pixel — see below) |
| T | Paint on: tiles ⇄ overpaint |
| Ctrl+K | Search groups |
| ← / → | Previous / next pose |
| Space | Play or pause the filmstrip |
| Delete | Delete the current pose |
| F2 | Rename the current pose |
| Hold R | Show the reference image at full strength |
| Arrows (Shift: 8 px) | Side by side: nudge the reference-side ghost box |
| Esc | Put Pick's answer away |
| Ctrl+Z | Undo paint (up to 50 steps) |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Mouse wheel | Zoom (middle-drag or Alt+drag to pan) |

---

## The sythnvtby Player

The player is for **playing** a game you've coloured, not working on it: no capture, painting or
debug panels.

1. In the Project tool, **File ▸ Export for player…** and give the game a title. You get a
   `.vbcplay` **play pack**: your colours, groups and overpaint, about 100 KB. It holds
   **no ROM** and none of your captures, and your `.vbpack` is unchanged.
2. Open `/player.html` (also in the tools hub). Choose the **ROM…** and the **Play pack…**, in
   either order. The player checks the ROM is the one the colours were made for; a different ROM
   gets a warning and **Play anyway**. A ROM on its own plays in monochrome.
3. **Play**. Controls:
   - **Colour** / **Monochrome** (or **F9**): unpainted parts show the original red picture under
     the colour.
   - **View: 2D / Side-by-side / Anaglyph**: 3D, in colour and monochrome (remembered).
   - **Pause** (or **P**), **Full screen** (Esc leaves it).
   - The emulator's own control bar (hover the bottom of the game) has save states, controller
     settings and volume. Battery saves and save states are kept in this browser, under the
     game's title.
4. Next time the player remembers the ROM and pack: just press **Play**. Choosing another file
   while a game runs restarts the player with it.

## A workflow for a sprite-based game

This order avoids redoing work:

1. **Capture pass (emulator).** Play the start of the game and capture every distinct
   screen twice: menu, level, pause, game over. Name the captures consistently. Capture your
   main character in every pose you can get it into. Press **Colorize!** or **Export
   .vbpack** to keep the captures.
2. **Auto-capture pass (emulator).** Load the pack, turn on **Auto-capture**, and play a
   level. Choose **Sprite (OBJ)** to stop on every sprite tile you haven't captured yet, which is
   the fastest way to collect enemy and item poses. Add **Scaled (Affine)** for characters drawn on
   a scaled layer (the far player in Mario's Tennis), or **Background (BG)** for new screens.
3. **Poses (Project tool).** For each character, make one sprite group and add every pose
   (Layer → OBJ, drag, **New pose from selection…**).
4. **Paint sprites (SpriteStudio).** Main character first, then enemies, then items. **Save
   and Play** after each character and check it in the game. Watch for colors appearing
   where they shouldn't (shared tiles).
5. **Backgrounds (Project tool).** Make one BG group for each recognizable piece of scenery
   in each level. Fill big areas first, and save often.
6. **Screens that need different colors for the same tiles.** Make a separate BG group on
   each screen's layer. If a color is already painted into the shared pack, use **Painted
   tiles… → group** to move it into one group, then paint the other groups differently.
7. **HUD and text last.** Scores, lives and menus reuse font tiles everywhere. Decide whether
   one color everywhere is acceptable; it usually is.
8. **Play-test in the emulator** with **Color** and **Monochrome** both on, to spot red holes
   you haven't painted.

---

## Gotchas and known problems

Checked against the code on 2026-10-09. Most of these are tracked in the
[debug clean-up backlog](../planning/debug-cleanup-backlog.md) or the main
[backlog](../planning/priorities-and-next.md).

| Problem | What to do |
|---------|------------|
| **Overpaint doesn't show on some screen** where the group's tiles are. | It shows where the group has a tile on screen in a layer drawing the same background map. If the game draws the object at another place in its map there, the picture isn't under it; tile paint still is. An old touch-up no captured frame shows stays a touch-up (see [Overpaint](#overpaint-paint-over-a-background-layer), *Older packs*). |
| **Captures live only in the emulator's memory** until Colorize! or Export .vbpack. The status line says "N captures not saved", and Load ROM, Load pack, Last pack, closing the tab and refreshing all ask first. | Press Export .vbpack or Colorize! after each capture session. |
| **Sprite paint shows up on unrelated things** that reuse the same tile. | Per-tile paint goes wherever the tile is drawn. Limit the group to its own screens or game states (**Paint shows on** / **Paint shows when…**), move background spots into a BG group (Painted tiles… → group), or give a pose its own picture (Overpaint just this pose). **Project ▸ Check project…** lists groups taking another group's colours. |
| **Colors stay bright or go dark at the wrong time during fades and flashes.** | Fades follow the game's brightness; adjust **Fade response** if a fade looks off. For menus and flashes done with palettes, tick **Follow the game's palette** on the group. |
| **A mirrored pose isn't recognized as the same pose.** | Paint still works in both directions. If you need the mirrored version in SpriteStudio, add that capture as its own pose. |
| **Clicking a sprite in SpriteStudio sometimes paints nothing.** This happens where a transparent tile sits in front. | Try a neighbouring pixel, or zoom in and paint in the Project tool instead. |
| **Pack files are large**, tens of MB, because every capture keeps the full VIP state (compressed in the pack). | Delete frames you don't need with **Project ▸ Clean up frames…** (it can archive them), and keep packs on a drive with space. |
| **After opening a pack with Load pack, Colorize! → Save and Play** may save a copy to your project home or Downloads instead of overwriting the file you opened. | Keep packs in the project home folder, so that copy *is* the same file. |
| **SpriteStudio reopens an old pack** when you open it from the hub. | Open your current pack with **Open .vbpack…**, or go in through the Project tool. |
| **Tracks (animations) don't affect the game.** | They're previews only. |

---

## Troubleshooting

**Capture Frame, Colorize! and Auto-capture are greyed out.** The emulator hasn't delivered
a frame yet; wait a second after the game starts. If they never enable, you're running
without the bundled patched core (`USE_LOCAL_CORE` must be `true` in `src/main.js`). The
public EmulatorJS core can play games but can't color them.

**I clicked Color and nothing changed.** No paint is loaded. Load your `.vbpack` with **Load
pack**, or paint something and use Save and Play.

**My colors are there, but patches of red show through.** Those tiles aren't painted yet.
Turn **Monochrome** off to see only your paint, and on to find the holes.

**Fill and Brush are disabled in the Project tool.** Select a group in the right rail first.
The Brush also needs **Zoom to selection**.

**New group made a group that colors nothing.** This can happen when the selection includes
**Affine**-layer tiles, or mixes sprites and backgrounds. Select with **Layer → BG** or
**Layer → OBJ**, not **All**.

**Where did my save go?** The tool tries, in order: the file you opened, then your project
home folder, then Downloads. Set a project home to make this predictable. Firefox and Safari
always download.

**The emulator says "needs permission" next to Project home.** Browsers forget folder
permission when they restart. Click **Grant access**.

**The game restarted from the beginning after Save and Play.** The capture had no save state
(rare). The status line says so briefly. Capture again while the game is running.

**Something failed.** The emulator's status line shows failures to open a pack, restore a
frame or resume after Save and Play for several seconds. A capture that is missing its memory
snapshot or screenshot says so too: a frame without memory is skipped by Analyze memory. For
the technical detail, press F12, open the Console tab, and look for lines starting with
`[Problem]`.

---

## Keyboard shortcuts

| Page | Key | Action |
|------|-----|--------|
| Emulator | F8 | Quick capture (no dialog) |
| Emulator | F9 | Swap Monochrome ⇄ Color (show only one of them) — for before/after videos |
| Emulator | F10 | Monochrome on/off (the original picture under the colour layer) |
| Emulator | Arrows / Enter / Z / X | D-pad / Start / A / B (EmulatorJS defaults; remap in the emulator's settings) |
| Project tool | Shift-drag | Add to selection |
| Project tool | Ctrl+Z | Undo paint, Clear, Move to group, Delete group |
| Project tool | Ctrl+Shift+Z / Ctrl+Y | Redo |
| Project tool | Esc | Cancel the eyedropper or anchor pick; otherwise deselect the group |
| Project tool | Ctrl+K | Search groups (Enter selects the first match, Esc clears) |
| Project tool | H | Highlight on/off (while a Show filter is on in the frame list) |
| SpriteStudio | V B E G I C S | Look / Brush / Eraser / Fill / Pick / Clone / Swap |
| SpriteStudio | T | Paint on: tiles ⇄ overpaint (when the group can have overpaint) |
| SpriteStudio | Ctrl+K | Search groups |
| SpriteStudio | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y | Undo / redo |
| SpriteStudio | ← → / Space / Delete / F2 / R | Previous or next pose / play / delete pose / rename pose / show reference |

---

## Glossary

The tools print a lot of internal vocabulary. Here it is in plain terms.

| You'll see | It means |
|------------|----------|
| **Tile**, **8×8**, **cell** | One 8×8-pixel square of the picture. Everything on screen is made of these. |
| **Pattern**, **hash**, `#6F9A72A3` | The identity of a tile's drawing. The same drawing has the same number wherever it appears, and paint is keyed by that number. |
| **Draw**, **draws** | One placement of a tile on screen. "2688 draws" means the frame stamped 2688 tiles. |
| **VIP** | The Virtual Boy's video chip. "VIP state" is the description of one frame that the emulator hands to the tools. |
| **World (0–31)** | One of the Virtual Boy's 32 background layers. Lower numbers are in front. |
| **Layer: BG / OBJ / Affine** | Background tiles / sprite tiles / rotated-or-scaled background (not supported). |
| **Eye (Left / Right)** | The Virtual Boy is stereoscopic, with a separate picture for each eye. Paint the Left eye unless you use the stereo views. |
| **Frame**, **capture**, **vipstate** | One captured moment of the game. "Current — vipstate-current" is the moment you pressed Colorize!. |
| **Pack**, **.vbpack** | Your project file: ROM + captures + groups + paint, in one ZIP. |
| **.vbcolor**, **vbcolor pack**, **shared pack**, **tile8** | The per-pattern colors that apply to the whole game. |
| **Group** | A named set of tiles colored as one thing. A **BG group** is scenery; a **sprite / OBJ group** is a character. |
| **Pose** | One arrangement of a sprite's tiles, i.e. one frame of its animation. |
| **Track** | A named animation built from poses (preview only). |
| **Anchor** | The reference tile of a group or pose. For a BG group, having a tile that appears once on screen is what makes paint pin to screen positions. |
| **Overlay**, **VIP paint layer**, **VIP overlay** | Older background paint pinned to exact screen positions. Converted to overpaint when SpriteStudio opens a pack. See [Where your paint goes](#where-your-paint-goes). |
| **Touch-up**, **layer art** | Older kinds of background picture: a touch-up was pinned to an anchor tile and dropped out when the layer scrolled; layer art replaced a whole layer. Both are converted to overpaint when SpriteStudio opens a pack. |
| **Overpaint** | One picture per background group, pinned to its layer's background map: drawn over the tiles (or instead of them, with *Hide the tiles under it*), scrolling and zooming with the layer. See [Overpaint](#overpaint-paint-over-a-background-layer). |
| **tileColors**, "owned by a group" | Background paint that belongs to one group only. |
| **Memory pool**, **pool**, **variant**, **game state**, `__default__` | A "screen" of the game (Title, Level 1, …), recognized from the game's memory. `__default__` means the only version of that screen. |
| **WRAM**, **RAM dump**, **RAM fingerprint** | The game's working memory, snapshotted with each capture and used to recognize screens. |
| **Analyze memory** | Works out from your captures which memory bytes identify each screen. |
| **Legacy & unassigned** | Groups that aren't tied to any screen. That's fine. |
| **Colorize!** | Takes you from the Emulator to the Project tool on the current moment. |
| **Save and Play** | Saves, then returns you to the emulator in color at the same moment. |
| **Project home** | The folder you chose for opening and saving files. |
| **Reference** | A colorized image of a frame that you sample colors from. |
| **Animated tiles** | Backgrounds the game animates by redrawing tiles, such as twinkling stars. It's a group option in the Project tool. |
| **Follow the game's palette** | A group option: paint brightens and dims with the palette the game draws each tile with, so a menu's selected option stays bright and the rest dim. See [Menus that highlight with the palette](#menus-that-highlight-with-the-palette). |
| **Onion** | Ghosts of the neighbouring poses in SpriteStudio. |
| **Original** | A pose's monochrome picture as the game draws it, shown over the paint in SpriteStudio (hold O). |
| **Auto-paint** | SpriteStudio colouring a group's unpainted poses from the poses you painted (A). |

---

## Going deeper

- How the whole system fits together: [the project guide](../README.md).
- What's inside a `.vbpack`: [art-pack-file-format.md](../reference/art-pack-file-format.md).
- Groups and group colors in depth: [group-override-design.md](../design/group-override-design.md).
- Sprites, poses and tracks: [obj-sprite-profiles-design.md](../design/obj-sprite-profiles-design.md).
- Reference images: [reference-images.md](../design/reference-images.md).
- How screens are recognized: [memory-analysis-tool-spec.md](../reference/memory-analysis-tool-spec.md).
- Rendering limits (fades, layers, depth): [color-layer-z-order-and-performance.md](../reference/color-layer-z-order-and-performance.md) and [graphics-next-investigations.md](../planning/graphics-next-investigations.md).
- What's being built next: [priorities-and-next.md](../planning/priorities-and-next.md).
