#pragma once
// What the Virtual Boy's video chip (VIP) held for one frame: the same data the browser's colour
// layer works from (src/vip-state.js, `VIPState`), so the colour renderer is a port of it and is
// checked against it frame by frame (tests/parity.cpp).
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace vbc {

/** A draw-list field the core did not say (old captures). */
constexpr uint8_t kUnknownField = 0xff;

/** One tile the VIP drew this frame (the core's draw list). */
struct DrawCall {
  uint16_t tile = 0;  // character 0..2047
  int16_t x = 0;      // screen pixels, left eye or right eye
  int16_t y = 0;
  bool flip_h = false;
  bool flip_v = false;
  uint8_t world = kUnknownField;  // 0..31
  uint8_t eye = 0;                // 0 left, 1 right
  uint8_t layer = kUnknownField;  // 0 background, 1 affine, 2 sprite
  uint8_t palette = 0;            // 0..3
  uint8_t strip = kUnknownField;  // the 8-row band it was drawn in
};

struct VipFrame {
  static constexpr size_t kPatternTableBytes = 0x8000;
  static constexpr size_t kDisplayRamBytes = 0x20000;
  static constexpr size_t kSegmentBytes = 0x2000;    // one BG map
  static constexpr size_t kWindowsOffset = 0x1D800;  // world table, 32 × 32 bytes
  static constexpr size_t kWindowsBytes = 0x400;
  static constexpr size_t kOamOffset = 0x1E000;
  static constexpr size_t kOamBytes = 0x2000;

  uint32_t frame_number = 0;
  std::array<uint8_t, kPatternTableBytes> pattern_table{};
  std::array<uint8_t, kDisplayRamBytes> display_ram{};
  std::vector<DrawCall> draw_list;  // both eyes
  std::array<uint16_t, 4> gplt{};   // background palettes
  bool has_gplt = false;
  double master_brightness = 1.0;  // 0..1: the game's fade
  bool has_master_brightness = false;
  /** 3 and up: the core records tiles cut by a window's top or left edge (patch level). */
  int core_patch_level = 0;

  const uint8_t* windows() const { return display_ram.data() + kWindowsOffset; }
  const uint8_t* oam() const { return display_ram.data() + kOamOffset; }
  /** BG map segment `i` (0..15): 64 × 64 cells. */
  const uint8_t* segment(int i) const { return display_ram.data() + static_cast<size_t>(i) * kSegmentBytes; }
};

/**
 * The game's fade, 0..1, from the VIP's brightness levels (as the browser build derives it:
 * the mean of the three lit shades over 255).
 */
double master_brightness_from_levels(const int32_t levels[4]);

}  // namespace vbc
