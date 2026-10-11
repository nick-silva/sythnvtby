## Needs a human (automation can't verify these)

Headless Chrome has no speakers, no GPU, no native OS pickers, and no taste. Check these by hand after changes to the related area:

- [ ] **Sound** — game audio plays after loading a ROM and after Save and Play.
- [ ] **Feel** — emulator runs smoothly on your GPU; painting and zooming feel responsive.
- [ ] **Native file pickers** — painter File → Save / Save as… and emulator Load ROM / Load pack / Export use Windows dialogs and start in the project home folder (tests replace them with downloads).
- [ ] **Project home** — set a folder; the label shows its name, and after reopening the tab it reads "… — needs permission" with a **Grant access** button that restores it in one click.
- [ ] **Save back to the pack** — Load pack → Colorize! → paint → Save and Play updates that same `.vbpack` (new modified time), writes `<name>.bak.vbpack` beside it, and adds nothing to Downloads.
- [ ] **Exports land in home** — tile manifest (tools page) and v1 `.vbcolor` / `overrides.json` write into project home instead of Downloads when home is set.
- [ ] **Native eyedropper** — the painter's color picker in real Chrome opens the screen eyedropper (tests use the canvas fallback).
- [ ] **Visual judgment** — colors, brightness, layout and text look right on emulator, painter, and tools pages, including a narrow window (screenshots in `tests/e2e/.out/`).
- [ ] **Controller/keyboard feel** — game controls respond as expected beyond "Start changes the screen".

### Project tool: new selection and inspection controls (Sep 2026)

- [ ] **Select matching on a real sprite** — select one Mario tile, hit **Select matching**: it should catch the repeats you expect and no blank tiles.
- [ ] **Replace / Add / Subtract** — build a selection across several drags; Subtract should only remove what the box covers. Shift-drag should add without leaving the current mode.
- [ ] **Draw stack panel** — click a pixel where BG and OBJ overlap: the rows should read front-to-back in the order you see on screen, with the right world/layer/group.
- [ ] **Export frame PNG** — the file lands in the project home (not Downloads) and the image matches the on-screen composite, including paint.

### SpriteStudio (`/tools/sprite-studio.html`)

- [ ] **Poses look like the sprite** — thumbnails and the stage show the sprite you expect, not a neighbouring tile, for a sprite with several poses.
- [ ] **Background context is the right frame** — the background behind each pose is the scene it was captured on, and "Matched here" reads N / N.
- [ ] **Animation reads as motion** — Play at 6–12 fps looks like the in-game animation; poses are in a sensible order (reordering is not built yet).
- [ ] **Mirrored poses** — a pose captured from a flipped sprite is placed and oriented correctly.
- [ ] **Animation reads right at real speed** — build a track with sensible holds and play it; does the timing match the game?
- [ ] **Painting feels right** — brush on a real sprite: does the shared-tile propagation help or surprise you? (One stroke colors every pose reusing that 8×8.)
- [ ] **Onion skin on a multi-pose sprite** — ghosts should help you line art up, not clutter the view.
- [ ] **Pinned background** — with poses captured on different frames, does pinning one background make the animation easier to read?
- [ ] **Reference image** — scale and nudge concept art behind a sprite and paint over it; is the control range enough?
- [ ] **Auto-capture in real play** — after a manual capture pass, turn it on and play a level: does it stop on genuinely new poses, and not so often it gets in the way? Is the outline easy to see, and is the "screen:" readout right as you move between menus and levels?
- [ ] **Painted sprites in the emulator** — SpriteStudio paint is stored per tile pattern, so the emulator colors that pattern wherever it appears. Check a painted sprite in-game for unwanted coloring elsewhere.
