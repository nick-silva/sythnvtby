# Paint tool — wireframe-level UX spec (v1)

Companion to [paint-tool-gamestate-override-plan.md](paint-tool-gamestate-override-plan.md) and [paint-tool-groups-implementation.md](paint-tool-groups-implementation.md). Describes **layout blocks**, **warnings**, and **flows** at wireframe fidelity (not final visual design).

**Superseding product decisions for the next implementation pass** (presets, group-wide RAM, warning rules, desktop-only, section reorder): [paint-tool-overrides-redesign-spec.md](paint-tool-overrides-redesign-spec.md).

**Simplified authoring (profiles, Simple vs Advanced, wireframe v2 target):** [paint-tool-simplified-authoring-spec.md](paint-tool-simplified-authoring-spec.md).

---

## 1. Page regions

```
┌────────────────────────────────────────────────────────────────────────────┐
│ H1: Paint-on-game                                                          │
├────────────────────────────────────────────────────────────────────────────┤
│ MEMORY / ANALYSIS BANNERS (dynamic, 0–N stacked)                           │
│  • No memory analysis (vbpack loaded) → link to Memory analysis tool       │
│  • Low-confidence state names (single capture)                              │
│  • Very high candidateTotal warning                                         │
├────────────────────────────────────────────────────────────────────────────┤
│ TOOLBAR: frame file, pack, overrides, game id, export/save, palette, …    │
├──────────────────────────────┬─────────────────────────────────────────────┤
│ MAIN SCENE (384×224)         │ SIDE COLUMN                                 │
│  legend: outline colors      │ ┌ Draws at click (conditional)              │
│                              │ ├ Groups                                     │
│                              │ │  • Each row: (radio) name  [Add][Remove]… │
STAGING / import below         │ │  • Expanded: criteria + override panel      │
│                              │ ├ Tile painter + Apply to …                 │
│                              │ │  • Override layer / apply-at              │
│                              │ │  • Game-state condition + 2 dropdowns     │
│                              │ │  • Global-scope hint (no RAM condition)   │
│                              │ │  • Preview override match (tooltip)       │
└──────────────────────────────┴─────────────────────────────────────────────┘
│ Status line + footnotes                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Memory analysis banners (paint)

| Condition | Message tone | Action |
|-----------|--------------|--------|
| `.vbpack` context **and** no `manifest.memoryAnalysis` | Warn | Explain game-state overrides unavailable; link **Memory analysis**; still allow painting. |
| `memoryAnalysis.lowConfidenceStateNames` non-empty | Warn | List states with only one frame; suggest 2–3 captures + re-analyze. |
| `memoryAnalysis.candidateTotalVeryHigh` | Warn | Suggest verifying dumps / naming. |

**vbpack context** ≈ ROM or `frameRegistry` present from last full pack load.

---

## 3. Groups — single paint target + exclusive tile shapes

- **Control:** one **radio** per group (`name="paint-target-group"`), plus **None** clears selection.
- **Rule:** At most one group is the paint target; canvas filter uses only that group when set.
- **Exclusive membership (by hash):** Each **tile shape** (`criteria.hashes` entry) belongs to **one group**. **Add** removes those hashes from other groups. **Duplicate** copies window/layer only; user re-adds tiles to assign hashes to the new group. Groups with **no** hashes yet but with window/layer-only criteria can still overlap other groups until hashes are assigned (future subgroup model could refine this).
- **Auto-select:** On **Paint** mode, when user picks a tile (canvas or draw list) that matches **exactly one** group’s criteria → that group becomes selected.  
  - **0 groups:** no change.  
  - **2+ groups:** no auto-change (ambiguous).

---

## 4. Override — game-state block

Appears when **Apply to: This position only (override)**.

| Control | Role |
|---------|------|
| Checkbox **Game-state condition** | Enables RAM byte condition from `manifest.memoryAnalysis`. |
| Dropdown **State** | High-level `stateName` keys from analysis. **Default:** registry match for current frame’s `vipstates/…` file when available (fixes “on intro frame but wrong state pre-selected”). User may change for substates / mismatches. |
| Dropdown **Candidate** | Up to **10** discriminant offsets per state (score + one-word label). User picks another row when the default byte is wrong for what they’re painting. |
| Hint line | Shows resolved offset + CPU address + expected value. |

**Per-frame memory:** Changing **Select Frame** saves game-state control snapshot for the previous index; restoring the frame reloads that snapshot (same pack session).

**Opt out (checkbox off):** **Global-scope hint** (amber/red text): explains that **without** RAM condition, the override may apply **everywhere** the hash/layer/position rules match (whole game), and mentions current layer / apply-at mode.

---

## 5. Tooltips (explicit; icons later)

- **Override** (group row): Explains “Create from pack” behavior — full-frame overrides per hash, replaces group overrides, no RAM until user sets conditions while painting.
- **Preview override match:** Clarifies highlight is **hash + layer + apply-at** only — **does not** simulate RAM game-state (answers “preview mismatch” confusion).

---

## 6. Memory analysis tool (related)

- **Guidance box** at top: 2–3 frames per high-level state; why; single-frame = low confidence.
- **Frame tree:** summary line for each `stateName` includes **⚠ low confidence** when &lt; 2 frames.
- **After Run analysis:** Red **analysis-warnings** panel for single-frame states, failed prerequisites, or huge `candidateTotal`.

---

## 7. Key user stories

1. **Color intro blimp with wrong default state** — User opens **State** dropdown, picks correct `stateName`, then **Candidate** if needed; frame default comes from registry when possible.  
2. **Jump between frames** — Game-state checkbox + dropdowns **remember** last choice per frame index (same vbpack).  
3. **No analysis pack** — Banner warns; game-state checkbox disabled; user can still paint pack/group overrides without RAM.  
4. **Opt out of RAM** — Hint stresses global impact so user doesn’t accidentally broad-match.

---

## 8. Non-goals (this wireframe)

- Icon toolbar replacing text buttons.  
- Substate column in manifest UI (future; plan only).  
- Live WRAM readout in paint tool.
