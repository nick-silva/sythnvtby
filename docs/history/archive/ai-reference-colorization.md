---
status: proposed
last-reviewed: 2026-09-19
covers: src/color-layer.js, src/pool-match-by-ram.js, tools/shared/pack-session.js, src/ai-projection.js, src/ai-templates.js, src/comfy-client.js, tools/ai-colorize/experiment.mjs, comfyui/
---

> **Archived Oct 8 2026.** The experiment's code — the ComfyUI Docker setup (`comfyui/`), the
> experiment runner (`tools/ai-colorize/`), `src/comfy-client.js`, `src/ai-templates.js` and
> `src/ai-projection.js` — was removed from the project; it is in git history before that date.
> The project does not use ComfyUI. Reference pictures (painting from a colourised frame, made in
> any tool) stay: [reference-images.md](../../design/reference-images.md).

# AI reference colorization

> **Shelved, Sep 2026 — read this first.** Generating references *inside the app* is not
> happening. Four rounds of phase 0 (§8) showed the local model is the weak link: SDXL plus a
> Recolor Control-LoRA is a text-to-image generator with a brightness constraint, so it never
> sees the frame and invents its own detail, while an instruction-following editor used by
> hand (Gemini) produced a far better reference in one shot with almost no prompting.
>
> **What replaces it:** you make a reference image wherever you like and bring it in — see
> [reference-images.md](../../design/reference-images.md). What survives from this work and is still used:
> `src/ai-projection.js` (projecting an image back onto a frame, per-pattern colours, keep
> black) and `src/screenshot-frame.js` (reading a capture back to exact frame pixels).
>
> **What is shelved but kept, in case a local editor model is worth trying later**
> (FLUX.1 Kontext, Qwen-Image-Edit): `comfyui/` (ComfyUI in Docker),
> `tools/ai-colorize/` (the experiment runner),
> `src/comfy-client.js` and `src/ai-templates.js`. Everything below §8 describes that shelved
> plan. §8 itself is the measured record and is worth keeping.

**Status:** shelved (Sep 2026), after phase 0 (§8) ran. Nothing here is in the app. Decisions
are in §11.

## 1. The idea

Colorizing a game tile by tile is slow, and colors chosen tile by tile drift: the same
level ends up looking slightly different from screen to screen. The plan is to let an image
model — **running locally, on your own GPU** — do the first pass, **once per game state**,
and make everything else follow from it.

1. In the **Project tool**, pick a captured frame. Besides toggling the screenshot overlay,
   **colorize the frame with an image model** using a **prompt template** (SNES style,
   32-bit style, or one of your own). Try as many times as you like.
2. Choose the attempt you like and **set it as the reference frame for that game state**
   (a *state* is what memory analysis already identifies: Safety, Title, Level01, …).
3. The reference **colors every other frame of that state**, so the whole state stays
   consistent.
4. To start a **new** state, use a finished state's reference as a style example, so the
   look carries over between levels.
5. In **SpriteStudio**, the state's reference is the default reference image, already lined
   up with the sprite, and you can **copy parts of it straight into the sprite's paint**.
6. **Suggested groups** from the frames and the colorized reference — worked out from the
   game's own data, with no AI identifying anything (§5).

## 2. What the data says

Measured on `marioclash-annotated.vbpack` (30 frames, 10 states), taking the first frame
of each state as its reference:

| | Result |
|---|---|
| **Backgrounds** | One reference covers **92–100%** of every other frame's background draws in its state, by exact tile-pattern match. |
| **Sprites** | A reference covers only **29–57%** of sprite draws in states with moving sprites (Intro, Level01Intro, Level01): sprites animate and move. |
| **Repeated patterns** | **35–100%** of a reference's background draws use a tile pattern that appears more than once *in that same frame*. |
| **Between states** | Only **6–23%** of a state's patterns appear in any other state (apart from states that are the same level, like Level01 and its pause overlay). |

What follows from that:

- **Propagating a background reference needs no AI.** Colors are keyed by tile pattern
  (`hashTile`), so painting the reference's tiles colors the whole state automatically.
  That is how the color layer already works.
- **Sprites need a second pass**, per pose — which is what poses, auto-capture and
  SpriteStudio are for. The reference helps, but cannot cover everything alone.
- **One pattern, one color is the main constraint.** A tile pattern drawn in two places
  gets one color per state. When the model colors two copies differently (sky near the
  sun, sky near the ground), they conflict. §5 turns that into group suggestions instead
  of treating it as an error.
- **Continuity between levels has to come from style and palette**, not shared tiles.

## 3. Pipeline

```
 frame ──prepare──▶ local image model ──▶ attempts ──pick──▶ reference ──project──▶ state colors
        (template)          ▲                                                           │
     style example from ────┘                                        propagate ◀────────┤
     another state                                            (other frames in state)   │
                                                                                        ▼
                                                     SpriteStudio (underlay, clone, fill pose)
```

### 3.1 Prepare the input

- Composite the **left eye** as **grayscale** — the four VB shades mapped to evenly spaced
  grays. Sending the red monochrome image biases every model toward red.
- **Upscale with nearest-neighbour** to the model's working size: 3× (1152×672) for SDXL,
  2× (768×448) for SD 1.5. Integer factors keep pixel edges on whole pixels.
- Optionally mark colors already decided (tiles shared with a finished state) so they are
  kept — see §3.5.
- Fill in the chosen **prompt template** (§4): `{game}`, `{screen}` (the state name) and an
  optional `{scene}` note you type ("brick platforms, pipes, sky").

### 3.2 Project the result back onto the VB frame

Image models redraw rather than trace: edges shift a pixel or two and small details change,
and diffusion output is soft rather than crisp pixel art. **We never take the generated
pixels as they are** — which is also why soft output is fine. The model is a color source;
the frame's own structure is re-imposed:

1. **Align:** find any global offset or scale drift by cross-correlating the result's
   luminance with the VB shade map, and correct it.
2. **Sample:** downscale to 384×224 by taking, for each VB pixel, the median color of its
   block — the median ignores stray edge pixels.
3. **Lock structure:** keep the model's hue and saturation, but set lightness so the tile's
   four shades keep their order (shade 3 stays lighter than shade 2, and so on).
   Sprite shade 0 stays transparent.
4. **Apply the template's look** (§4): palette size, and whether each tile gets exactly one
   color per shade — the strict retro rule — or may vary pixel by pixel.
5. **Quantize** the state's colors to its palette (k-means in Lab space). A small shared
   palette is what makes a state look consistent; it is also what carries to the next state.
6. **Score:** structure fidelity (does luminance still follow the shade map?), palette size,
   and **agreement** (how often copies of one pattern got the same color). Shown on each
   attempt and used to rank them.

### 3.3 Commit a reference to the state

For each tile pattern in the reference, collect the colors of all its copies:

- **Copies agree** → that is the pattern's color for this state.
- **Copies disagree** → a **conflict**. Pick the majority for now, and list the conflict for
  the group suggestions in §5 (a positioned anchor group can give each place its own color).

Colors are stored **per state** (§9.2). Default scope: **backgrounds per state; sprites,
text and the HUD across the whole game**, so Mario looks the same in every level.

### 3.4 Propagate to the rest of the state

For every other frame in the state, show **coverage**: the share of its non-blank tiles
already colored by pattern match (the §2 numbers, per frame). Tiles still uncovered:

- **Regenerate** that frame with the state reference as the style example, and accept
  colors **only for uncovered tiles** — covered tiles are locked, so the reference is never
  overwritten.
- Or fill **deterministically**: map each uncovered tile's shades to the state palette,
  using its neighbours' colors — no model, instant, good enough for small gaps.

### 3.5 Start a new state from an existing one

Continuity with no paid services, from three local pieces:

- **Shared tiles** arrive already colored from finished states, and are locked.
- **The palette** carries over: the new state's palette is seeded from the finished state's,
  with room for new colors. This is deterministic and the most reliable of the three.
- **A style image:** the finished state's reference goes in through an **IP-Adapter** — a
  small add-on model that lets a picture, not just words, steer the style.

### 3.6 SpriteStudio

A pose knows its source frame, and a reference is frame-aligned (384×224), so the two line
up **exactly**, with no manual scaling or nudging.

- **Default reference image:** the pose's state reference, when there is one.
- **Fill pose from reference:** copy the reference's colors under the pose's tiles into
  their patterns — one click, with preview and undo.
- **Clone brush:** paint the reference's color at the same screen position — "copy and
  paste parts of the colorized frame into the sprite". A rectangle-paste variant for larger
  areas.
- **Eyedropper and palette** read from the reference and the state palette.
- **Colorize this pose:** when the pose's frame is not the reference frame, generate on that
  frame with the reference as the style example and keep only the pose's footprint.

## 4. Prompt templates

Every attempt uses a **template**: a prompt plus the settings and look rules that go with
it. Three come built in; you can copy any of them and edit, or write your own.

### 4.1 What a template holds

```json
{
  "id": "snes-16bit",
  "name": "16-bit (SNES era)",
  "description": "Bright, flat, limited palette. The default.",
  "builtIn": true,
  "prompt": "…{game}… {screen} … {scene} …",
  "negativePrompt": "…",
  "look": { "paletteSize": 24, "lockShadesPerTile": true, "flat": true },
  "sampler": { "steps": 25, "cfg": 6.5, "controlStrength": 1.0, "seed": null }
}
```

- **`{game}`, `{screen}`, `{scene}`** are filled in at generation time: the pack's game name,
  the state name, and your optional note.
- **`look`** is applied during projection (§3.2), so a template controls the result even
  where the model ignores the prompt. `lockShadesPerTile` gives every 8×8 tile exactly one
  color per VB shade — four colors per tile, the way 2-bits-per-pixel consoles worked.
- **`sampler`** settings go to the model; `seed: null` means a new random seed per attempt,
  and the seed actually used is saved with the attempt so a good one can be reproduced.
- **Where they live:** built-ins ship with the app; yours are kept in browser storage, with
  **export and import** as JSON files so they can be shared or moved between machines. Each
  attempt records the full template it used, so a pack stays reproducible even after the
  template is edited.

### 4.2 Built in

**16-bit (SNES era) — the default.** Closest in spirit to the Virtual Boy's own art: flat
color, strong outlines, readable at a glance.

- **Prompt:** `16-bit console era pixel art of {game}, {screen} screen. {scene}. Colorize
  this image: vibrant, saturated colors from a limited palette, flat cel-shaded fills,
  clean dark outlines, bright cartoon look. Keep every shape exactly where it is; do not
  add, remove or move anything.`
- **Negative:** `photo, realistic, 3d render, gradients, soft shading, blur, noise, text,
  watermark, extra objects`
- **Look:** 24 colors per state, one color per shade in every tile, flat.

**32-bit (PlayStation era).** Richer: more colors, some shading within shapes.

- **Prompt:** `32-bit console era sprite art of {game}, {screen} screen. {scene}. Colorize
  this image: rich palette, smooth shading and highlights within shapes, subtle color
  variation, detailed but still clean hand-drawn sprites. Keep every shape exactly where it
  is; do not add, remove or move anything.`
- **Negative:** `photo, realistic, 3d render, blur, noise, text, watermark, extra objects`
- **Look:** 64 colors per state, colors may vary pixel by pixel within a tile, not flat.

**Custom — start here.** Neutral wording with every placeholder and a note on each field, meant
to be copied and edited.

- **Prompt:** `Colorized version of this {game} video game screen ({screen}). {scene}.
  Describe the style you want here: era, palette, mood, shading. Keep every shape exactly
  where it is; do not add, remove or move anything.`
- **Negative:** `photo, blur, noise, text, watermark, extra objects`
- **Look:** 32 colors, one color per shade in every tile, not flat.

The wording is a starting point: phase 0 will show which phrases the chosen model actually
responds to, and the built-ins get tuned from that.

## 5. Groups from frames — no AI identification

Decided: **no model identifies what anything is**, and none decides which sprite a pose
belongs to. Vision models are poor at exact positions on tiny pixel art, and we already have
exact geometry from the draw list. Grouping is built from the game's own data, and naming
stays with you — the aim is tools that make defining sprites quick, so the time goes into
colorizing them in SpriteStudio.

Signals, in rough order of reliability:

1. **VIP worlds.** The game itself puts the HUD, playfield and background in separate
   worlds — a free first split.
2. **Tile clusters** within a world (`src/tile-clusters.js`) — connected runs of tiles.
3. **Sprite clusters and poses** — the pose-suggestions pipeline
   ([priorities-and-next.md](../../planning/priorities-and-next.md) item 1).
4. **Color regions in the reference.** The model colors sky blue and bricks brown, so
   connected areas of similar generated color within a world are a split we get for free.
   The model is not asked what anything is; its coloring just happens to separate things.
5. **Conflicts** (§3.3). A pattern colored differently in different places is exactly a
   group that needs a position — a candidate anchor group.

The Project tool shows these as **suggested groups**: outlines on the frame, a unique anchor
picked automatically, the state's memory pool pre-filled, and a placeholder name for you to
change. Accept, rename, merge or dismiss — suggest-and-review, as with poses.

## 6. Running the model locally

**Target machine:** RTX 3080 Ti, 12 GB of video memory. No paid APIs.

### 6.1 Models

| Option | What it is | Memory | Speed (estimate) | Fit |
|---|---|---|---|---|
| **SDXL + "Recolor" Control-LoRA** — *primary* | Stable Diffusion XL with Stability AI's Control-LoRA trained to colorize grayscale images while keeping their brightness | ~8–10 GB | ~5–15 s | Built for colorizing; keeping brightness is exactly our structure lock; prompts steer style |
| **SD 1.5 + line-art ControlNet + pixel-art LoRA** — *fallback* | Older, smaller Stable Diffusion, held to the frame's edges, with a pixel-art style add-on | ~4–6 GB | ~2–5 s | Light and fast; follows instructions less well |
| **IP-Adapter** (SDXL) — *for §3.5* | Add-on that lets an image steer style | +~1 GB | small | Carries a finished state's look into a new one |
| **FLUX.1 Kontext [dev], quantized** — *stretch* | Newer instruction-following image editor, compressed to fit 12 GB | ~7–12 GB with offloading | ~1–2 min | Best at following instructions; slow on this card; non-commercial license |
| **DDColor** — *baseline* | Dedicated photo colorizer | ~2 GB | < 1 s | Very faithful to structure; no style control — a yardstick for phase 0 |

Speeds are estimates for this card; phase 0 measures them. SDXL's and SD 1.5's licenses
allow this use; FLUX.1 Kontext [dev] is non-commercial.

### 6.2 Host: ComfyUI

**ComfyUI** runs the models: it loads Control-LoRAs natively, IP-Adapter through the
`ComfyUI_IPAdapter_plus` nodes (installed, pinned, by our Dockerfile), runs in Docker on an
NVIDIA card, and has a local HTTP API — queue a job, follow its progress, fetch the image.
The workflow is built in code (`buildColorizeWorkflow` in `src/comfy-client.js`) rather
than shipped as files, so the Project tool and the experiment runner send the same graph.

- **Connection:** the Vite dev server proxies `/comfy` to ComfyUI on `127.0.0.1:8188`, so
  the page never makes a cross-origin call and nothing needs a key. The feature therefore
  works under `npm run dev`; a built, static copy would need ComfyUI started with a CORS
  allowance instead.
- **Setup:** `comfyui/README.md` runs ComfyUI in Docker on the GPU
  and downloads the models; the Project tool will add a one-button **connection test**.
  Disk: a ~14 GB image; models 6.5 GB (SDXL) + 0.4–0.7 GB (Recolor) + 3.2 GB (IP-Adapter
  and its image encoder); SD 1.5 adds ~5 GB.
- **Adapter:** the Project tool talks to `colorize({ image, exemplars, template })`, so a
  different local host (or, one day, a paid service) could be swapped in.

## 7. What has to exist first

Found in the code; the first two are worth doing even without AI:

1. **Switch colors by game state at runtime.** Per-state tile colors already exist in the
   data model (`painterV2Rules.tile8ByVariant`), but the emulator always uses the first
   variant of the first pool (`suggestedPainterV2VariantId` in `src/color-layer.js`) —
   whatever screen is showing. It should pick the variant each frame from live RAM
   (`bestPoolVariantByRam` in `src/pool-match-by-ram.js`, reading only the bytes the pools
   test), holding the last match through fades so colors don't flicker.
2. **Key per-state colors by pool.** `tile8ByVariant` is keyed by variant id alone, and every
   pool seeded from the memory analysis names its variant `__default__` — so every state
   would share one bucket. Key by pool and variant, and migrate existing packs on load.
3. **Store references and attempts in the pack** — additive, and read back on load (unlike
   `art_exports/`, which is dropped on re-save).
4. **The ComfyUI connection** (§6.2): dev-server proxy, workflow files, connection test.

## 8. Phase 0 — the local test (run Sep 2026)

`tools/ai-colorize/` renders frames from a pack, runs a
matrix of templates × Control-LoRAs × steps × style images × seeds through ComfyUI, projects
each result (§3.2) and writes a contact sheet with scores. Two rounds on Mario Clash:

- **Round 1** — Title, Intro tower, Level 1 intro, Level 1 gameplay × the three templates ×
  Recolor rank 256 and 128 × 3 seeds (72 attempts, 25 steps).
- **Round 2** (`experiments/round2.json`) —
  Title, Level 1 intro, Game menu, a second Level 1 frame, Top score, with written scene notes,
  20 steps, each with and without the best Level 1 attempt as an IP-Adapter style image (30).

What we learned:

- **The primary model is good enough to build on.** On gameplay, menu and high-score screens
  it recognizes Mario, Koopas, pipes, bricks and text and colors them plausibly without moving
  anything. SD 1.5 and DDColor were not needed and were not tried.
- **Speed on an RTX 3080 Ti at 1152×672:** ~15 s at 25 steps, ~12 s at 20 steps; +~0.5 s with a
  style image; the first attempt after start-up adds a few seconds of model loading.
- **Rank 128 is as good as rank 256** (same scores, half the size) — now the default.
- **Seeds vary a lot** — the same frame comes back green and tidy or rainbow-striped. Several
  attempts and a pick (§3, phase 2) are necessary, not a nicety.
- **Scene notes matter most.** Screens with little in them (Title, Level 1 intro) got dull or
  random colors in round 1; a sentence saying what is on screen fixed the menu and score
  screens. The UI should ask for one and keep it per state.
- **The model invents things in VB black and in large flat areas** (red diamonds, "rain",
  mottled walls). Two projection rules fix it, both now in `src/ai-projection.js`:
  **keep black** (shade 0 stays black) and **unify repeated tiles** (every copy of a pattern
  takes the per-pixel median of all copies, which turns noise over a repeated background tile
  into one flat colour — the §3.3 rule, approximated with screen tiles). Before unifying, the
  copies of a pattern already agreed in 37–100% of patterns per attempt (the `agree` score).
- **A style image works within a state and overreaches across states.** At weight 0.8 it
  carried Level 1's greens and browns into another Level 1 frame (good) and also onto the
  Title and Level 1 intro (too much). Plan: full weight for frames of the same state, ~0.4–0.6
  when the style image comes from another state. IP-Adapter centre-crops its input, so style
  images are padded to a square first.
- **Sprites are not consistent between attempts** (Mario's cap came out red, blue or green).
  That supports the scope decision in §3.3: sprites come from the game-wide pack, painted
  once in SpriteStudio; the reference mostly decides backgrounds.
- **Black-filled art stays black** — the Title logo's letters are VB black with a red outline,
  so keeping the structure means the letters cannot be colored. A group override is the way
  to recolor that kind of art by hand.
- **Scores:** `fid` stays ≥ 0.95 after projection almost everywhere, so it only catches
  failures; `sat` separates dull from colorful; palette distance to a style image turned out
  to be confounded by dull results and should not be used for ranking.

## 9. Data

### 9.1 In the `.vbpack`

```
references/<poolId>/<attemptId>.png     generated attempts, full resolution
references/<poolId>/<attemptId>.json    { sourceFrameId, exemplars[], model, workflow,
                                          template (full copy), seed, createdAt, scores }
manifest.references = {
  "<poolId>": { "referenceAttemptId": "a-…", "palette": ["#rrggbb", …] }
}
```

### 9.2 Colors

- Per-state background colors: the pool-keyed tile colors from §7.2.
- Game-wide colors (sprites, HUD, text): the existing pack (`.vbcolor`), unchanged.
- Conflicts resolved by position become ordinary anchor groups, gated to the state's pool.

## 10. Phases

| Phase | Delivers | Proves |
|---|---|---|
| **0. Local test** (§8) — *done* | Contact sheet across models × templates, projected and scored | Which model; whether projection keeps structure; real speed on this card |
| **1. Prerequisites** (§7) | Per-state colors switch at runtime; pool-keyed storage; references in the pack; ComfyUI connection | Per-state colors work at all; the page can reach the model |
| **2. Project tool: colorize** | Template picker and editor, attempts gallery with scores, overlay any attempt, *Set as state reference*, commit, conflict list | One state colored end to end |
| **3. Propagate** | Coverage per frame; regenerate-uncovered and deterministic fill | A whole state from one reference |
| **4. Continuity** | Palette carry-over, IP-Adapter style example | Two levels that look like one game |
| **5. SpriteStudio** | Reference as default underlay; fill pose; clone brush; colorize pose | Sprites colored from the reference |
| **6. Groups** | Suggested groups from worlds, clusters, color regions and conflicts | Isolation mostly automatic |

## 11. Decisions

**Made (Sep 2026):**

- **Local only.** The image model runs on your GPU through ComfyUI; no paid APIs, no keys,
  screenshots never leave the machine.
- **Templates.** Built-in 16-bit (SNES era, the default), 32-bit (PlayStation era), and a
  custom starter; users add their own.
- **No AI identification.** Nothing asks a model what a region is or which sprite a pose
  belongs to; grouping comes from the game's data, naming from you.
- **Unit of a reference:** one memory-analysis state (one pool).
- **Scope:** sprites, text and HUD game-wide; backgrounds per state.
- **Conflicts:** majority color, plus a group suggestion.
- **Eyes:** generate from the left eye; the right eye follows through shared tile patterns.

**Still open:**

1. **Palette sizes** — 24 / 64 / 32 for the three built-ins. Phase 0 found 24 enough for
   every screen tried; revisit once references are judged in the real UI.
2. **Built, static copy** — is dev-server-only acceptable, or should the static build be
   able to reach ComfyUI too?

## Related

- [obj-sprite-profiles-design.md](../../design/obj-sprite-profiles-design.md) — poses, which the sprite pass depends on.
- [priorities-and-next.md](../../planning/priorities-and-next.md) — pose suggestions (§5 signal 3) and mirrored poses.
- [memory-analysis-tool-spec.md](../../reference/memory-analysis-tool-spec.md) — how states are found.
- [group-override-design.md](../../design/group-override-design.md) — groups and anchors.
