#pragma once
// Play packs (.vbcplay): the colour for one game, as the Project tool exports it for the player.
// Format: docs/reference/play-pack-format.md. This is the C++ reader of src/play-pack.js's files.
#include <array>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "vbcolor/video.hpp"

namespace vbc {

/** One painted 8×8 tile, R G B A per pixel. */
using TileRgba = std::array<uint8_t, 256>;

/** Which draws a group claims (groups.json `criteria`); an empty set does not restrict. */
struct GroupCriteria {
  std::unordered_set<long long> worlds;      // windowIds (else worldIds)
  std::unordered_set<long long> window_ids;  // windowIds only (scaled-layer touch-ups use just these)
  std::unordered_set<long long> hashes;
  std::unordered_set<long long> layers;
  std::unordered_set<long long> slots;  // tileSlots
};

/** A picture replacing a background layer, placed in the layer's BG map. */
struct LayerArt {
  int world = 0;
  int bgmap_base = -1;  // -1: any
  int map_x = 0;
  int map_y = 0;
  int width = 0;
  int height = 0;
  RgbaImage pixels;
  // Overpaint (src/overpaint.js) is drawn over the layer's tiles; with hide_tiles (and an older
  // pack's layerArt) it replaces them.
  bool hide_tiles = true;
};

/** A picture pinned to a group's anchor tile and the arrangement around it. */
struct TouchUp {
  struct Cell {
    int dx = 0;
    int dy = 0;
    uint32_t hash = 0;
  };
  uint32_t anchor_hash = 0;
  int box_dx = 0;
  int box_dy = 0;
  int box_w = 0;
  int box_h = 0;
  std::vector<Cell> layout;
  RgbaImage pixels;
};

/** One byte of game memory a screen is recognised by (gameStatePools `ramConditions`). */
struct RamCondition {
  uint16_t offset = 0;
  uint8_t value = 0;
};

/**
 * Which screens a group's paint shows on (groups.json `screens`, src/screen-gate.js). Each listed
 * screen is the recipes of its variants that have one: the screen matches when every byte of one
 * recipe holds.
 */
struct ScreenLimit {
  bool only = true;  // false: every screen except these
  std::vector<std::vector<std::vector<RamCondition>>> screens;
};

/**
 * A condition on a game state (groups.json `gameStates` and a group's `conditions`,
 * src/game-states.js): the state's bytes, and whether they must all hold (`is`) or not.
 */
struct GroupCondition {
  std::vector<RamCondition> bytes;
  bool is = true;
};

struct Group {
  std::string id;
  std::string name;
  GroupCriteria criteria;
  std::unordered_map<uint32_t, TileRgba> tile_colors;
  /** Colour per shade 1..3 for animated tiles (`shadeRamp`); empty entries colour nothing. */
  std::optional<std::array<std::optional<std::array<uint8_t, 3>>, 4>> shade_ramp;
  std::optional<LayerArt> layer_art;  // valid and decoded
  bool has_layer_art_field = false;   // touch-ups are off for a group with layer art, valid or not
  std::optional<TouchUp> touch_up;    // valid and decoded
  std::optional<ScreenLimit> screens;  // absent: every screen
  std::vector<GroupCondition> conditions;  // all must allow the paint; empty: whatever the state
  /** Paint brightens and dims with the game's palette (`followPalette`, paletteFollowFactors in JS). */
  bool follow_palette = false;
  /** One pose of a character (`wholePose`): its picture needs every one of its patterns on the layer. */
  bool whole_pose = false;
};

/**
 * Does the group's paint show on a frame with this game memory (64 KiB)? Groups without a screens
 * setting always do, and so does every group when the memory is unknown (null or short).
 */
bool group_shown_on_screen(const Group& group, const uint8_t* wram, size_t size);

struct PlayPackInfo {
  std::string title;
  std::string author;
  std::string created_at;
  std::string rom_file_name;
  std::string rom_sha1;
  std::string rom_crc32;
  long long rom_size = -1;
  bool paint_on_transparent = false;
  std::optional<double> brightness_reference;
  std::vector<std::string> features;
};

struct PlayPack {
  PlayPackInfo info;
  std::unordered_map<uint32_t, TileRgba> tile_colors;  // color.vbcolor
  std::vector<Group> groups;
  std::vector<uint8_t> cover_png;
  /** Parts the C++ colour layer does not draw yet (the packs made so far have none). */
  size_t unsupported_overrides = 0;
  size_t unsupported_v2_rules = 0;
  bool unsupported_overlays = false;
};

/** Thrown with a message for the player's user. */
struct PlayPackError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

/** Read a .vbcplay. Throws PlayPackError. */
PlayPack load_play_pack(const std::vector<uint8_t>& bytes);

/** The groups in a groups.json (its screens settings resolved against its gameStatePools). Throws PlayPackError. */
std::vector<Group> parse_groups_json(const std::vector<uint8_t>& bytes);

/** Tile colours from a .vbcolor file; empty when it is not one. */
std::unordered_map<uint32_t, TileRgba> parse_vbcolor(const uint8_t* data, size_t size);

/** Base64 to bytes (whitespace ignored); empty on bad input. */
std::vector<uint8_t> base64_decode(const std::string& text);

}  // namespace vbc
