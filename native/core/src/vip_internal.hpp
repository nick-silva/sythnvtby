#pragma once
// The VIP arithmetic the colour layer needs, ported line for line from the browser modules so
// the two agree pixel for pixel: world geometry (src/layer-art.js worldGeometry), stereo twins
// (src/stereo-twin.js), world clip (src/vip-world-clip.js), affine sampling (src/affine-world.js,
// itself a port of Beetle's DrawAffine) and edge-tile recovery (src/vip-edge-tiles.js).
#include <algorithm>
#include <array>
#include <cstdint>
#include <optional>
#include <vector>

#include "vbcolor/vip_frame.hpp"

namespace vbc::detail {

constexpr int kW = 384;
constexpr int kH = 224;
constexpr int kWorldBytes = 32;
constexpr int kHdrLon = 0x8000;
constexpr int kHdrRon = 0x4000;
constexpr int kHdrOver = 0x80;
constexpr int kHdrEnd = 0x40;
constexpr int kBgmNormal = 0;
constexpr int kBgmAffine = 2;

inline int sign_extend(int v, int bits) {
  const int m = v & ((1 << bits) - 1);
  return m >= (1 << (bits - 1)) ? m - (1 << bits) : m;
}
inline int s16(int v) { return static_cast<int16_t>(static_cast<uint16_t>(v)); }
inline int32_t wrap32(int64_t v) { return static_cast<int32_t>(static_cast<uint32_t>(v)); }

/** Readers over a frame: world table, display RAM and character RAM, by halfword. */
struct Mem {
  const VipFrame& f;
  int win(int off) const {
    const uint8_t* w = f.windows();
    return w[off] | (w[off + 1] << 8);
  }
  int dram(int h) const {
    const size_t o = static_cast<size_t>(h & 0xffff) * 2;
    return f.display_ram[o] | (f.display_ram[o + 1] << 8);
  }
  int chr16(int i) const {
    const size_t o = static_cast<size_t>(i & 0x3fff) * 2;
    return f.pattern_table[o] | (f.pattern_table[o + 1] << 8);
  }
  const uint8_t* tile(int t) const { return f.pattern_table.data() + static_cast<size_t>(t & 2047) * 16; }
};

inline uint32_t hash_tile(const uint8_t* b) {
  uint32_t h = 0x811c9dc5u;
  for (int i = 0; i < 16; i++) {
    h ^= b[i];
    h *= 0x01000193u;
  }
  return h;
}

inline bool is_blank(const uint8_t* b) {
  for (int i = 0; i < 16; i++) {
    if (b[i]) return false;
  }
  return true;
}

/** Where a normal-BG world draws for one eye, and its screen → BG-map mapping. */
struct WorldGeometry {
  int bgmap_base = 0, start_x = 0, final_x = 0, row_start = 0, row_end = 0;
  int src_x0 = 0, dest_x = 0, my = 0, gy = 0, mask_x = 0, mask_y = 0;
  int sx(int x) const { return (src_x0 + x - dest_x) & mask_x; }
  int sy(int y) const { return (my + y - gy) & mask_y; }
};

inline std::optional<WorldGeometry> world_geometry(const Mem& m, int world, int eye) {
  if (world < 0 || world > 31) return std::nullopt;
  const int b = world * kWorldBytes;
  const int header = m.win(b);
  if (((header >> 12) & 3) != kBgmNormal) return std::nullopt;
  if (!(header & (eye ? kHdrRon : kHdrLon))) return std::nullopt;
  const bool over = (header & kHdrOver) != 0;
  const int scy = (header >> 8) & 3, scx = (header >> 10) & 3;
  const int gx = sign_extend(m.win(b + 2), 11), gp = sign_extend(m.win(b + 4), 9), gy = sign_extend(m.win(b + 6), 11);
  const int mx = m.win(b + 8), mp = sign_extend(m.win(b + 10), 9), my = m.win(b + 12);
  const int dest_width = sign_extend(m.win(b + 14), 11) & 0xffff;
  const int dest_height = m.win(b + 16) & 0x3ff;
  WorldGeometry g;
  g.row_start = std::max(0, gy);
  g.row_end = std::min(kH - 1, gy + dest_height);
  g.dest_x = sign_extend(gx + (eye ? gp : -gp), 10);
  g.start_x = std::max(0, g.dest_x);
  g.final_x = std::min(kW - 1, g.dest_x + dest_width);
  if (g.row_start > g.row_end || g.start_x > g.final_x) return std::nullopt;
  g.mask_x = over ? 0x1fff : (512 << scx) - 1;
  g.mask_y = over ? 0x1fff : (512 << scy) - 1;
  g.src_x0 = mx + (eye ? mp : -mp);
  g.bgmap_base = header & 0xf;
  g.my = my;
  g.gy = gy;
  return g;
}

/** Right-only world → its left-only twin and the shift between them (src/stereo-twin.js). */
struct Twins {
  std::array<int, 32> left{};
  std::array<int, 32> shift{};
  std::vector<int> order;  // right worlds, 31 down
  Twins() { left.fill(-1); }
  bool empty() const { return order.empty(); }
  bool has(int world) const { return world >= 0 && world < 32 && left[static_cast<size_t>(world)] >= 0; }
};

constexpr int kMaxTwinShift = 64;

inline Twins stereo_twins(const Mem& m) {
  Twins out;
  auto rd = [&](int w, int off) { return m.win(w * kWorldBytes + off); };
  int end = -1;
  for (int w = 31; w >= 0; w--) {
    if (rd(w, 0) & kHdrEnd) {
      end = w;
      break;
    }
  }
  for (int r = 31; r > end; r--) {
    const int hr = rd(r, 0);
    if ((hr & (kHdrLon | kHdrRon)) != kHdrRon) continue;
    for (int l : {r - 1, r + 1}) {
      if (l <= end || l > 31) continue;
      const int hl = rd(l, 0);
      if ((hl & (kHdrLon | kHdrRon)) != kHdrLon) continue;
      if ((hl & 0x3f80) != (hr & 0x3f80)) continue;
      if (rd(l, 6) != rd(r, 6) || (rd(l, 16) & 0x3ff) != (rd(r, 16) & 0x3ff)) continue;
      const bool affine = ((hr >> 12) & 3) == kBgmAffine;
      const int dest_r = sign_extend(rd(r, 2), 11) + sign_extend(rd(r, 4), 9);
      const int dest_l = sign_extend(rd(l, 2), 11) - sign_extend(rd(l, 4), 9);
      int shift = dest_r - dest_l;
      if (!affine) shift = shift - sign_extend(rd(r, 8) - rd(l, 8), 13) - sign_extend(rd(r, 10), 9) - sign_extend(rd(l, 10), 9);
      if (shift > kMaxTwinShift || shift < -kMaxTwinShift) continue;
      out.left[static_cast<size_t>(r)] = l;
      out.shift[static_cast<size_t>(r)] = shift;
      out.order.push_back(r);
      break;
    }
  }
  return out;
}

/** Inclusive clip rectangle for BG/affine draws (getBgAffineWorldClipRect); none for OBJ worlds. */
struct ClipRect {
  bool clips = false;
  int x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  bool empty() const { return clips && x0 > x1; }
};

inline ClipRect world_clip(const Mem& m, int world, int eye) {
  ClipRect c;
  if (world < 0 || world > 31) return c;
  const int base = world * kWorldBytes;
  const int w0 = m.win(base);
  if (w0 & 0x40) return c;
  if (((w0 >> 12) & 3) == 3) return c;
  const int gx = sign_extend(m.win(base + 2), 11), gp = sign_extend(m.win(base + 4), 9), gy = sign_extend(m.win(base + 6), 11);
  const int dest_w = sign_extend(m.win(base + 14), 11);
  const int dest_h = m.win(base + 16) & 0x3ff;
  const int dest_x = gx + ((eye & 1) ? gp : -gp);
  c.clips = true;
  const int start_x = std::max(0, dest_x);
  const int final_x = std::min(kW - 1, dest_x + dest_w);
  if (start_x > final_x) {
    c.x0 = 1, c.x1 = 0, c.y0 = 0, c.y1 = -1;
    return c;
  }
  int y0 = 0, y1 = kH - 1;
  if (dest_h > 0) {
    y0 = std::max(0, gy);
    y1 = std::min(kH - 1, gy + dest_h);
    if (y0 > y1) {
      c.x0 = 1, c.x1 = 0, c.y0 = 0, c.y1 = -1;
      return c;
    }
  }
  c.x0 = start_x, c.x1 = final_x, c.y0 = y0, c.y1 = y1;
  return c;
}

/** Affine worlds shown on an eye, back to front, stopping at END. */
inline std::vector<int> affine_worlds(const Mem& m, int eye) {
  std::vector<int> out;
  for (int world = 31; world >= 0; world--) {
    const int header = m.win(world * kWorldBytes);
    if (header & kHdrEnd) break;
    if (((header >> 12) & 3) == kBgmAffine && (header & (eye ? kHdrRon : kHdrLon))) out.push_back(world);
  }
  return out;
}

/**
 * Every screen pixel an affine world samples, as the VIP does (sampleAffineWorld).
 * visit(x, y, ch, tx, ty, pixel, palette, hflip, vflip, rotated, cell).
 */
template <class Visit>
bool sample_affine_world(const Mem& m, int world, int eye, Visit&& visit) {
  if (world < 0 || world > 31) return false;
  const int b = world * kWorldBytes;
  const int header = m.win(b);
  const int lr = eye ? 1 : 0;
  if (((header >> 12) & 3) != kBgmAffine || !(header & (lr ? kHdrRon : kHdrLon))) return false;
  const int bgmap_base = header & 0xf;
  const bool over = (header & kHdrOver) != 0;
  const int scy = (header >> 8) & 3, scx = (header >> 10) & 3;
  const int gx = sign_extend(m.win(b + 2), 11) & 0xffff;
  const int gp = sign_extend(m.win(b + 4), 9) & 0xffff;
  const int gy = sign_extend(m.win(b + 6), 11) & 0xffff;
  const int dest_width = sign_extend(m.win(b + 14), 11) & 0xffff;
  const int dest_height = m.win(b + 16) & 0x3ff;
  const int param_base = m.win(b + 18) & 0xfff0;
  const int overplane_char = m.win(b + 20);
  const int dest_x = s16(sign_extend((gx + (lr ? gp : -gp)) & 0xffff, 10));
  const int dest_y = gy;
  const int sx_size = 512 << scx, sy_size = 512 << scy;
  const int32_t sx_mask = over ? 0x3ffffff : (sx_size << 9) - 1;
  const int32_t sy_mask = over ? 0x3ffffff : (sy_size << 9) - 1;
  const int bgsc_overplane = m.dram(overplane_char);
  const int map_base = bgmap_base * 4096;
  const int start_x = std::max(0, dest_x), final_x = std::min(383, dest_x + dest_width);
  for (int real_y = 0; real_y < kH; real_y++) {
    const int line = (real_y - dest_y) & 0xffff;
    if (line > dest_height) continue;
    const int p = (param_base + 8 * (real_y - dest_y)) & 0xffff;
    const int mx = s16(m.dram(p)), mp = s16(m.dram((p + 1) & 0xffff)), my = s16(m.dram((p + 2) & 0xffff));
    const int dx = s16(m.dram((p + 3) & 0xffff)), dy = s16(m.dram((p + 4) & 0xffff));
    int64_t sx64 = static_cast<int64_t>(mx) * 64;
    int64_t sy64 = static_cast<int64_t>(my) * 64;
    if (dest_x < 0) {
      sx64 += static_cast<int64_t>(dx) * -dest_x;
      sy64 += static_cast<int64_t>(dy) * -dest_x;
    }
    if (mp >= 0 && lr) {
      sx64 += static_cast<int64_t>(dx) * mp;
      sy64 += static_cast<int64_t>(dy) * mp;
    } else if (mp < 0 && !lr) {
      sx64 += static_cast<int64_t>(dx) * -mp;
      sy64 += static_cast<int64_t>(dy) * -mp;
    }
    int32_t source_x = wrap32(sx64);
    int32_t source_y = wrap32(sy64);
    if (dy == 0) {
      source_y &= sy_mask;
      if (source_y >= (sy_size << 9)) continue;
      const int row_base = map_base | (((source_y >> 6) & ~0xfff) << scx) | (((source_y >> 12) & 0x3f) * 0x40);
      for (int x = start_x; x <= final_x; x++) {
        source_x &= sx_mask;
        int bgsc = bgsc_overplane;
        int cell = -1;
        if (source_x < (sx_size << 9)) {
          bgsc = m.dram((row_base | ((source_x >> 6) & ~0xfff) | ((source_x >> 12) & 0x3f)) & 0xffff);
          cell = (source_y >> 12) * 1024 + (source_x >> 12);
        }
        const bool hflip = (bgsc & 0x2000) != 0, vflip = (bgsc & 0x1000) != 0;
        const int sub_y = (vflip ? 7 : 0) ^ ((source_y >> 9) & 7);
        const int sub_x2 = (hflip ? 0xe : 0) ^ ((source_x >> 8) & 0xe);
        const int ch = bgsc & 0x7ff;
        const int pixel = (m.chr16(ch * 8 + sub_y) >> sub_x2) & 3;
        visit(x, real_y, ch, sub_x2 >> 1, sub_y, pixel, bgsc >> 14, hflip, vflip, false, cell);
        source_x = wrap32(static_cast<int64_t>(source_x) + dx);
      }
    } else {
      for (int x = start_x; x <= final_x; x++) {
        source_x &= sx_mask;
        source_y &= sy_mask;
        int bgsc = bgsc_overplane;
        int cell = -1;
        if (source_x < (sx_size << 9) && source_y < (sy_size << 9)) {
          cell = (source_y >> 12) * 1024 + (source_x >> 12);
          const int m_index = ((source_x >> 6) & ~0xfff) + (((source_y >> 6) & ~0xfff) << scx);
          const int sub_index = ((source_x >> 12) & 0x3f) + ((source_y >> 12) & 0x3f) * 0x40;
          bgsc = m.dram((map_base | m_index | sub_index) & 0xffff);
        }
        const bool hflip = (bgsc & 0x2000) != 0, vflip = (bgsc & 0x1000) != 0;
        const int sub_y = (vflip ? 7 : 0) ^ ((source_y >> 9) & 7);
        const int sub_x = (hflip ? 7 : 0) ^ ((source_x >> 9) & 7);
        const int ch = bgsc & 0x7ff;
        const int pixel = (m.chr16(ch * 8 + sub_y) >> (sub_x * 2)) & 3;
        visit(x, real_y, ch, sub_x, sub_y, pixel, bgsc >> 14, hflip, vflip, true, cell);
        source_x = wrap32(static_cast<int64_t>(source_x) + dx);
        source_y = wrap32(static_cast<int64_t>(source_y) + dy);
      }
    }
  }
  return true;
}

/** BG tiles cut by a window's top or left edge that older cores left out of the draw list. */
inline std::vector<DrawCall> recover_clipped_bg_draws(const Mem& m, int eye) {
  std::vector<DrawCall> out;
  if (m.f.core_patch_level >= 3) return out;
  for (int world = 31; world >= 0; world--) {
    const int b = world * kWorldBytes;
    const int header = m.win(b);
    if (header & kHdrEnd) break;
    if (((header >> 12) & 3) != kBgmNormal) continue;
    if (!(header & (eye ? kHdrRon : kHdrLon))) continue;
    const int bgmap_base = header & 0xf;
    const bool over = (header & kHdrOver) != 0;
    const int scy = (header >> 8) & 3, scx = (header >> 10) & 3;
    const int gx = sign_extend(m.win(b + 2), 11), gp = sign_extend(m.win(b + 4), 9), gy = sign_extend(m.win(b + 6), 11);
    const int mx = m.win(b + 8), mp = sign_extend(m.win(b + 10), 9), my = m.win(b + 12);
    const int dest_width = sign_extend(m.win(b + 14), 11) & 0xffff;
    const int dest_height = m.win(b + 16) & 0x3ff;
    const int overplane_char = m.win(b + 20);
    const int row_start = std::max(0, gy), row_end = std::min(kH - 1, gy + dest_height);
    if (row_start > row_end) continue;
    const int dest_x = sign_extend(gx + (eye ? gp : -gp), 10);
    const int start_x = std::max(0, dest_x), final_x = std::min(kW - 1, dest_x + dest_width);
    if (start_x > final_x) continue;
    const int size_x = 512 << scx, size_y = 512 << scy;
    const int mask_x = over ? 0x1fff : size_x - 1, mask_y = over ? 0x1fff : size_y - 1;
    const int src_x0 = mx + (eye ? mp : -mp);
    auto source_x_at = [&](int x) { return (src_x0 + x - dest_x) & mask_x; };
    auto source_y_at = [&](int y) { return (my + y - gy) & mask_y; };
    auto fetch = [&](int sx, int sy) {
      if (sx >= size_x || sy >= size_y) return m.dram(overplane_char & 0xffff);
      const int row_base = (bgmap_base << 12) | (((sy >> 3) & 0x3f) * 0x40) | (((sy << 3) & ~0xfff) << scx);
      return m.dram((row_base | ((sx << 3) & ~0xfff) | ((sx >> 3) & 0x3f)) & 0xffff);
    };
    const int first_cell_x = start_x - (source_x_at(start_x) & 7);
    const int first_cell_y = row_start - (source_y_at(row_start) & 7);
    for (int y_top = first_cell_y; y_top <= row_end; y_top += 8) {
      const bool full_row = y_top >= row_start && y_top + 7 <= row_end;
      const int sy = source_y_at(std::max(y_top, row_start));
      for (int x_left = first_cell_x; x_left <= final_x; x_left += 8) {
        const bool col_recorded = x_left >= start_x;
        if (full_row && col_recorded) break;
        const int bgsc = fetch(source_x_at(std::max(x_left, start_x)), sy);
        const bool vflip = (bgsc & 0x1000) != 0;
        const int record_row = y_top + (vflip ? 7 : 0);
        if (col_recorded && record_row >= row_start && record_row <= row_end) continue;
        DrawCall d;
        d.tile = static_cast<uint16_t>(bgsc & 0x7ff);
        d.x = static_cast<int16_t>(x_left);
        d.y = static_cast<int16_t>(y_top);
        d.flip_h = (bgsc & 0x2000) != 0;
        d.flip_v = vflip;
        d.eye = static_cast<uint8_t>(eye);
        d.world = static_cast<uint8_t>(world);
        d.layer = 0;
        d.palette = static_cast<uint8_t>((bgsc >> 14) & 3);
        d.strip = static_cast<uint8_t>(std::max(row_start, y_top) >> 3);
        out.push_back(d);
      }
    }
  }
  return out;
}

}  // namespace vbc::detail
