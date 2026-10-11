#pragma once
// Pictures: what a core produces each frame, and what the player shows.
#include <cstddef>
#include <cstdint>
#include <vector>

namespace vbc {

/** One eye of the Virtual Boy's screen. */
constexpr int kEyeWidth = 384;
constexpr int kEyeHeight = 224;

/**
 * A core's frame: both eyes side by side (left, then right), 0x00RRGGBB per pixel. Borrowed
 * from the core: valid until its next frame.
 */
struct VideoFrame {
  int width = 0;
  int height = 0;
  size_t pitch = 0;  // pixels per row
  const uint32_t* pixels = nullptr;
  bool empty() const { return !pixels || width <= 0 || height <= 0; }
};

/** A picture the library owns, 0xAARRGGBB per pixel. */
struct Image {
  int width = 0;
  int height = 0;
  std::vector<uint32_t> pixels;
  void resize(int w, int h) {
    width = w;
    height = h;
    pixels.assign(static_cast<size_t>(w) * static_cast<size_t>(h), 0xff000000u);
  }
};

/** A picture as bytes R, G, B, A per pixel (play-pack pictures, the colour layer's output). */
struct RgbaImage {
  int width = 0;
  int height = 0;
  std::vector<uint8_t> rgba;
  bool empty() const { return width <= 0 || height <= 0 || rgba.empty(); }
};

}  // namespace vbc
