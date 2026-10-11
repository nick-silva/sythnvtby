---
status: current
last-reviewed: 2026-10-09
covers: src/vip-dump.js
---

# Captured frame format (VIP state JSON)

A captured frame is one [VIP state](vip-state.md) — one eye of one frame — saved as JSON.
Inside a `.vbpack` each capture is `vipstates/<frameId>.json`, and the frame the pack was
last on is `vipstate-current.json` (see [art-pack-file-format.md](art-pack-file-format.md)).
The same JSON is what the frame viewer and tile extractor accept on its own.

`serializeVIPState` in `src/vip-dump.js` writes it; `deserializeVIPState` reads it back into
typed arrays, and `validateVIPState` checks a file before a tool uses it.

## Fields

```json
{
  "version": 1,
  "eye": 0,
  "frameNumber": 434,
  "patternTableBase64": "…",
  "oamBase64": "…",
  "segmentCount": 0,
  "segmentsBase64": [],
  "windowsBase64": "…",
  "drawList": [
    { "tileIndex": 593, "x": 136, "y": 171, "flipH": true, "eye": 0, "layer": 2, "world": 8, "strip": 21, "paletteSelector": 0 }
  ],
  "masterBrightness": 0.54,
  "corePatchLevel": 3,
  "gplt": [0, 0, 0, 0],
  "masterColors": [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
}
```

- **Binary blocks are base64:** the 32 KB pattern table, the 8 KB OAM, background
  segments and the world descriptors.
- **`drawList`** carries the fields described in [vip-state.md](vip-state.md#a-draw).
  Optional fields are omitted when the core did not send them; `eye` defaults to 0.
- **`masterBrightness`, `gplt`, `masterColors`** are present only when the core sent them;
  **`corePatchLevel`** (3 for cores from Sep 28 2026) says whether tiles cut by an edge were
  recorded ([vip-state.md](vip-state.md#things-worth-knowing)).
- **Size:** roughly 0.6–1 MB of JSON per frame (kept compressed inside a `.vbpack`), most of it the draw list — every cell of every world,
  blank ones included.

A binary single-file variant was once proposed; it was never built.
