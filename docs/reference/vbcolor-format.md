---
status: current
last-reviewed: 2026-09-18
covers: src/vbcolor-pack.js
---

# .vbcolor pack format (per-game)

Binary format for per-game colorized tile data. Keyed by tile content hash for lookup at runtime.

## Layout

- **Magic**: 4 bytes — `0x56 0x42 0x43 0x4C` ("VBCL")
- **Version**: 2 bytes, little-endian — format version (current: 1)
- **Game ID length**: 2 bytes, little-endian — length of game ID string (0–255)
- **Game ID**: UTF-8 bytes (no null terminator)
- **Num entries**: 4 bytes, little-endian — number of (hash, tile) entries
- **Entries**: For each entry:
  - **Tile hash**: 4 bytes, little-endian (32-bit)
  - **RGBA tile**: 256 bytes (8×8×4) — row-major, 8 rows of 8 pixels, 4 bytes per pixel (R,G,B,A)

Total size: 12 + gameIdLen + numEntries * (4 + 256) = 12 + gameIdLen + numEntries * 260.

## Tile hash

32-bit FNV-1a over the tile's 16 pattern bytes (2bpp, 8×8) — `hashTile()` in `src/vip-state.js`. The hash is of the unflipped pattern; flips are applied when drawing, so one entry colors a tile in every orientation the game draws it.

## Optional: palette index (future)

Version 2 could add 1 byte palette index (0–7) after tile hash for same tile with different VB palettes.
