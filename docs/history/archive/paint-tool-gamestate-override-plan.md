# Paint tool plan: game-state override from memory analysis

This plan describes how to use `manifest.memoryAnalysis` (written by `tools/memory-analysis.html`) as conditions in the paint tool override UI.

**Wireframe-level UI:** [paint-tool-wireframe-spec.md](paint-tool-wireframe-spec.md) (banners, single group target, game-state block, tooltips).

**Full overrides / presets / group-RAM redesign:** [paint-tool-overrides-redesign-spec.md](paint-tool-overrides-redesign-spec.md).

---

## 1) Terminology alignment

- Use **`windowId` / `windowIds`** in project-facing data and UI.
- Keep compatibility with legacy **`world` / `worldIds`** fields from older packs/core docs.
- Core draw payload can still arrive as `draw.world`; paint tool treats it as `windowId` in UI labels.

Compatibility rule:
- Read: `criteria.windowIds` first, fallback to `criteria.worldIds`.
- Write: only `criteria.windowIds`.

---

## 2) Inputs available to paint tool

From loaded `.vbpack`:
- `manifest.frameRegistry` (state family labels from captures).
- `manifest.currentVipStateRef` (usually `vipstate-current.json`) — used with the paint tool’s **Current** frame (e.g. after **Colorize!**) to find the matching registry row and `stateName`.
- `manifest.memoryAnalysis`:
  - `candidateTotal`
  - `topCandidatesByState` (up to **10** discriminant byte offsets per analyzed `stateName`)
  - `wramIngest`

**Implemented defaults (paint tool):** For the selected frame, the tool maps `vipstates/…` / **Current** → `frameRegistry[].stateName`, picks that key in the analysis **state** dropdown when present, and preselects the **first** candidate row (strongest score from analysis). The user can change state or candidate anytime; a short note explains match vs mismatch.

---

## 3) Override UI changes

In the override section (where hash/position/layer/group are configured), add:

- **Game-state condition (optional)**
  - Dropdown A: `stateName` (keys from `memoryAnalysis.topCandidatesByState`)
  - Dropdown B: candidate location from that state:
    - label example: `0x0500011C (off 284) · score 6 · global discriminator`
    - store selected `{ offset, expectedValue }` for that state
  - Optional "Advanced" control: add multiple RAM conditions (AND)

And in group criteria display:
- Show summary like `Windows A,B,C + RAM 0x0500011C == 0x8C`.

---

## 4) Data shape extension

Add optional `ramConditions` to override entries (not just groups):

```json
{
  "hash": 123456,
  "xMin": 10,
  "yMin": 20,
  "xMax": 18,
  "yMax": 28,
  "layer": 0,
  "groupId": "title-clouds",
  "ramConditions": [
    { "offset": 284, "expectedValue": 140, "source": "memoryAnalysis", "stateName": "Title" }
  ],
  "rgbaBase64": "..."
}
```

Notes:
- Keep existing override fields unchanged.
- `ramConditions` is optional and ignored unless runtime has a current WRAM snapshot.

---

## 5) Runtime matching behavior

Override match becomes:
1. Hash (+ optional layer + optional position) must match (existing behavior).
2. If `groupId` exists, draw must match group criteria (with `windowIds`).
3. If `ramConditions` exists, all conditions must pass:
   - `currentWram[offset] === expectedValue`

If WRAM is unavailable:
- Option A (recommended): treat RAM-conditioned overrides as non-matching and show a warning badge in UI.
- Option B: feature flag fallback to ignore RAM conditions (debug only).

---

## 6) Paint tool workflow

1. User loads annotated `.vbpack` (contains `manifest.memoryAnalysis`).
2. User selects tile/group/window as usual.
3. User enables "Game-state condition", picks `stateName`, then picks one candidate from dropdown.
4. Tool auto-fills expected value for that state.
5. Save/export pack: override now carries `ramConditions`.

---

## 7) Validation and guardrails

- Show `candidateTotal` and `wramIngest` summary in paint tool info panel.
- If `candidateTotal` is suspiciously high/low, show non-blocking warning.
- If selected state has fewer than 2 captured frames, badge it as weak confidence.
- For each candidate option show:
  - score label (`global/strong/moderate/weak discriminator`)
  - expected value for selected state
  - quick preview of values across other states (tooltip)

---

## 8) Implementation phases

1. **Terminology pass**: UI labels and criteria key migration to `windowIds` with compatibility reads.
2. **Read memoryAnalysis** in paint tool: parse and expose in state.
3. **Override UI**: add game-state condition controls + selected candidate rendering.
4. **Override schema**: persist `ramConditions` in exports.
5. **Runtime evaluation**: apply `ramConditions` when WRAM snapshot exists.
6. **UX polish**: tooltips, confidence badges, and missing-WRAM warnings.

---

## 9) Immediate next coding tasks

- Add `memoryAnalysis` parse helpers in paint tool.
- Add candidate dropdown wiring in override panel.
- Extend `resolveOverride()` and color-layer `resolveOverrideRgba()` to evaluate `ramConditions` when current WRAM is present.
- Keep all changes backward-compatible with packs that lack `memoryAnalysis`.

