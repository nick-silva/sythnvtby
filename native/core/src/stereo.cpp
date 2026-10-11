#include "vbcolor/stereo.hpp"

#include <algorithm>

namespace vbc {

const char* view_mode_name(ViewMode mode) {
  switch (mode) {
    case ViewMode::Flat: return "2D";
    case ViewMode::SideBySide: return "Side-by-side";
    case ViewMode::Anaglyph: return "Anaglyph";
  }
  return "?";
}

ViewMode next_view_mode(ViewMode mode) {
  switch (mode) {
    case ViewMode::Flat: return ViewMode::SideBySide;
    case ViewMode::SideBySide: return ViewMode::Anaglyph;
    case ViewMode::Anaglyph: return ViewMode::Flat;
  }
  return ViewMode::Flat;
}

namespace {

uint32_t brightest(uint32_t p) {
  const uint32_t r = (p >> 16) & 0xff, g = (p >> 8) & 0xff, b = p & 0xff;
  return std::max(r, std::max(g, b));
}

uint32_t argb_at(const RgbaImage& img, size_t i) {
  const uint8_t* p = img.rgba.data() + i * 4;
  return (static_cast<uint32_t>(p[3]) << 24) | (static_cast<uint32_t>(p[0]) << 16) | (static_cast<uint32_t>(p[1]) << 8) | p[2];
}

}  // namespace

void compose_view(const VideoFrame& eyes, ViewMode mode, Image& out) {
  if (eyes.empty()) {
    out.resize(kEyeWidth, kEyeHeight);
    return;
  }
  const int eye_w = eyes.width / 2;
  const int h = eyes.height;
  if (mode == ViewMode::SideBySide) {
    out.resize(eye_w * 2, h);
    for (int y = 0; y < h; y++) {
      const uint32_t* src = eyes.pixels + static_cast<size_t>(y) * eyes.pitch;
      uint32_t* dst = out.pixels.data() + static_cast<size_t>(y) * out.width;
      for (int x = 0; x < eye_w * 2; x++) dst[x] = 0xff000000u | src[x];
    }
    return;
  }
  out.resize(eye_w, h);
  for (int y = 0; y < h; y++) {
    const uint32_t* left = eyes.pixels + static_cast<size_t>(y) * eyes.pitch;
    const uint32_t* right = left + eye_w;
    uint32_t* dst = out.pixels.data() + static_cast<size_t>(y) * out.width;
    for (int x = 0; x < eye_w; x++) {
      if (mode == ViewMode::Flat) {
        dst[x] = 0xff000000u | left[x];
      } else {
        const uint32_t l = brightest(left[x]), r = brightest(right[x]);
        dst[x] = 0xff000000u | (l << 16) | (r << 8) | r;
      }
    }
  }
}

void compose_eyes(const Image& left, const Image& right, ViewMode mode, Image& out) {
  const int w = left.width, h = left.height;
  if (mode == ViewMode::SideBySide) {
    out.resize(w * 2, h);
    for (int y = 0; y < h; y++) {
      std::copy_n(left.pixels.begin() + static_cast<ptrdiff_t>(y) * w, w, out.pixels.begin() + static_cast<ptrdiff_t>(y) * w * 2);
      if (right.width == w && right.height == h) {
        std::copy_n(right.pixels.begin() + static_cast<ptrdiff_t>(y) * w, w, out.pixels.begin() + static_cast<ptrdiff_t>(y) * w * 2 + w);
      }
    }
    return;
  }
  if (mode == ViewMode::Flat || right.width != w || right.height != h) {
    out = left;
    return;
  }
  out.resize(w, h);
  for (size_t i = 0; i < out.pixels.size(); i++) {
    const uint32_t l = left.pixels[i], r = right.pixels[i];
    const uint32_t a = std::max(l >> 24, r >> 24);
    out.pixels[i] = (a << 24) | (l & 0x00ff0000u) | (r & 0x0000ffffu);
  }
}

void compose_color(const RgbaImage& left, const RgbaImage& right, ViewMode mode, Image& out) {
  Image l, r;
  l.resize(left.width, left.height);
  for (size_t i = 0; i < l.pixels.size(); i++) l.pixels[i] = argb_at(left, i);
  if (mode != ViewMode::Flat && right.width == left.width && right.height == left.height) {
    r.resize(right.width, right.height);
    for (size_t i = 0; i < r.pixels.size(); i++) r.pixels[i] = argb_at(right, i);
  }
  compose_eyes(l, r, mode, out);
}

void overlay(Image& base, const Image& top) {
  if (base.width != top.width || base.height != top.height) return;
  for (size_t i = 0; i < base.pixels.size(); i++) {
    const uint32_t t = top.pixels[i];
    const uint32_t a = t >> 24;
    if (a == 0) continue;
    if (a == 255) {
      base.pixels[i] = 0xff000000u | (t & 0x00ffffffu);
      continue;
    }
    const uint32_t b = base.pixels[i];
    auto mix = [&](int shift) {
      const uint32_t tc = (t >> shift) & 0xff, bc = (b >> shift) & 0xff;
      return ((tc * a + bc * (255 - a) + 127) / 255) << shift;
    };
    base.pixels[i] = 0xff000000u | mix(16) | mix(8) | mix(0);
  }
}

}  // namespace vbc
