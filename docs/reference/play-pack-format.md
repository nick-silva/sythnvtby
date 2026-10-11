---
status: current
last-reviewed: 2026-10-10
covers: src/play-pack.js, src/screen-gate.js, src/rom-identity.js, src/player.js, src/player-flow.js, src/player-storage.js
---

# Play pack format (.vbcplay)

A **play pack** is what the sythnvtby Player (`player.html`) needs to show a game in colour, and
nothing else. The Project tool writes one with **File ▸ Export for player…** from the open project.

A `.vbpack` is a working file: the ROM and every capture (frames, save states, RAM dumps,
screenshots). Mario's Tennis's is 57 MB. Its play pack is about 100 KB.

**The ROM is never included.** The player asks for it and checks it against `play.json`.

## Zip layout

| Entry | Required | What it holds |
|---|---|---|
| `play.json` | Yes | What the pack is: see below. |
| `color.vbcolor` | No | Tile colours, the same file as in the `.vbpack`. When missing (paint only per group), the player uses an empty table. |
| `groups.json` | Yes | `{ groupsSchemaVersion, gameStatePools, groups, overridePresets }`, as in the `.vbpack` ([art-pack-file-format.md §6](art-pack-file-format.md)). Groups keep their paint (`tileColors`), poses, layer art and touch-ups; only `expanded` (list folding) is dropped (`AUTHORING_ONLY_GROUP_FIELDS`, `src/group-schema.js`). |
| `overrides.json` | No | Position overrides, when there are any. |
| `painter-v2-rules.json` | No | Painter v2 rules, when there are any. |
| `painter-v2-vip-overlays.json` | No | Old screen-pinned overlays, when there are any. |
| `cover.png` | No | A picture for the player's start screen (default: the sythnvtby splash). |

## `play.json`

```json
{
  "format": "vbcolor-play",
  "version": 1,
  "title": "Mario's Tennis",
  "author": "optional",
  "createdAt": "2026-10-02T00:00:00.000Z",
  "rom": { "fileName": "Mario's Tennis (Japan, USA).vb", "size": 524288, "sha1": "<40 hex>", "crc32": "<8 hex>" },
  "paintOnTransparent": true,
  "brightnessReference": 0.393,
  "features": ["tileColors", "overpaint"]
}
```

| Field | What it does |
|---|---|
| `format`, `version` | `vbcolor-play`, version 1. A player refuses a newer version with a message saying so. |
| `title` | Shown by the player; also the name its battery saves and save states are kept under. |
| `rom` | Which ROM the colours were made for. The player compares SHA-1 (else CRC32 and size); a different ROM gets a warning and **Play anyway**. Taken from the project's ROM, or from the manifest's `romSha1` / `romCrc32` / `romSize`. |
| `paintOnTransparent` | The project's `paintOnTransparent` flag ([art-pack-file-format.md §2](art-pack-file-format.md)). |
| `brightnessReference` | The game's normal brightness: the `masterBrightness` most captured frames show (`src/fade.js`). Fades are measured against it, and the player has no frames to measure it from. `null` when the project had no frames. |
| `features` | What the groups use (`tileColors`, `overpaint`, `screens`; older packs `layerArt`, `touchUps`), for information. `screens`: some group is limited to some screens (groups.json `screens`); the players apply it from the game's live memory. |

## Code

- `src/play-pack.js`: `buildPlayPack(parts, { title, author, cover })` from a project's parts (the
  shape `buildArtPack` takes) and `parsePlayPack(buffer)`, which throws an Error with a message for
  the player's user (not a play pack, a `.vbpack` given by mistake, damaged, newer version).
- `src/rom-identity.js`: `romIdentity`, `sameRom`, `crc32`, `sha1`.
- `src/player.js`: the player page. `src/player-flow.js` decides what its start screen says;
  `src/player-storage.js` remembers the last ROM and pack (IndexedDB `vb-color-player`).
