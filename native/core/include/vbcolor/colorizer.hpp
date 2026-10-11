#pragma once
// The colour layer: a play pack's paint drawn over one frame, both eyes. A port of the browser's
// compositeColorFrame (src/color-layer.js) as the emulator and the web player call it: unpainted
// pixels are left see-through, so the original picture shows under the colour.
#include <array>
#include <cstdint>
#include <memory>
#include <vector>

#include "vbcolor/play_pack.hpp"
#include "vbcolor/vip_frame.hpp"
#include "vbcolor/video.hpp"

namespace vbc {

/** One eye's colour, and what the right eye borrows from it (getCompositePixelInfo in JS). */
struct EyeColor {
  RgbaImage image;                 // 384×224; alpha 0 where nothing coloured the pixel
  std::vector<uint8_t> shade;      // front shade 0..3, +0x80 unpainted, 0xff unlit
  std::vector<int8_t> world;       // world that drew the pixel, -1 none
  std::vector<uint8_t> art;        // 1 layer art or touch-up, 2 taken from the left eye
  std::array<bool, 32> touched{};  // worlds a touch-up was drawn on
};

class Colorizer {
 public:
  /** The pack must outlive the colorizer. */
  explicit Colorizer(const PlayPack& pack);
  ~Colorizer();
  Colorizer(const Colorizer&) = delete;
  Colorizer& operator=(const Colorizer&) = delete;

  /** Both eyes. The right eye of a layer the game draws twice takes colour from the left. */
  void render(const VipFrame& frame, EyeColor& left, EyeColor& right);

  /** One eye; `left` is the left eye's result when rendering the right eye (else null). */
  void render_eye(const VipFrame& frame, int eye, EyeColor& out, const EyeColor* left);

  /**
   * The game memory for the next frames (64 KiB, or null when unknown): groups limited to other
   * screens are left out (group_shown_on_screen). Read during the call only.
   */
  void set_system_ram(const uint8_t* wram, size_t size);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace vbc
