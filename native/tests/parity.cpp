// Parity: the C++ colour layer against the browser's, frame by frame.
//   vbcolor-parity <golden-dir>
// <golden-dir> comes from tests/parity/make-golden.mjs: game.vbcplay, and per captured frame
// <stem>.json (the frame), <stem>.left.rgba and <stem>.right.rgba (384×224 RGBA from the JS
// compositor, as the emulator calls it), and <stem>.wram.bin when the frame has its memory (for
// groups limited to some screens). Prints each frame's differing pixels; exit 1 if any.
#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "vbcolor/colorizer.hpp"
#include "vbcolor/play_pack.hpp"
#include "vbcolor/vip_state_json.hpp"

namespace fs = std::filesystem;

static std::vector<uint8_t> read_bytes(const fs::path& p) {
  std::ifstream in(p, std::ios::binary);
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

/** Differing pixels; ones see-through on both sides show nothing, so their colour bytes do not count. */
static size_t diff(const std::vector<uint8_t>& a, const std::vector<uint8_t>& b, size_t& first) {
  size_t n = 0;
  first = static_cast<size_t>(-1);
  if (a.size() != b.size()) return a.size() / 4;
  for (size_t i = 0; i + 3 < a.size(); i += 4) {
    if (a[i + 3] == 0 && b[i + 3] == 0) continue;
    if (a[i] != b[i] || a[i + 1] != b[i + 1] || a[i + 2] != b[i + 2] || a[i + 3] != b[i + 3]) {
      if (first == static_cast<size_t>(-1)) first = i / 4;
      n++;
    }
  }
  return n;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "Usage: vbcolor-parity <golden-dir>\n");
    return 2;
  }
  const fs::path dir = fs::u8path(argv[1]);
  vbc::PlayPack pack;
  try {
    pack = vbc::load_play_pack(read_bytes(dir / "game.vbcplay"));
  } catch (const std::exception& e) {
    std::fprintf(stderr, "%s\n", e.what());
    return 2;
  }
  vbc::Colorizer colorizer(pack);
  std::vector<fs::path> jsons;
  for (const auto& e : fs::directory_iterator(dir)) {
    if (e.path().extension() == ".json") jsons.push_back(e.path());
  }
  std::sort(jsons.begin(), jsons.end());
  size_t frames = 0, bad_frames = 0, total_px = 0, bad_px = 0;
  for (const fs::path& j : jsons) {
    const std::string stem = j.stem().u8string();
    const std::vector<uint8_t> text = read_bytes(j);
    vbc::VipFrame frame;
    try {
      frame = vbc::vip_frame_from_json(std::string(text.begin(), text.end()));
    } catch (const std::exception& e) {
      std::printf("SKIP %s: %s\n", stem.c_str(), e.what());
      continue;
    }
    const fs::path wram_path = dir / (stem + ".wram.bin");
    const std::vector<uint8_t> wram = fs::exists(wram_path) ? read_bytes(wram_path) : std::vector<uint8_t>{};
    colorizer.set_system_ram(wram.empty() ? nullptr : wram.data(), wram.size());
    vbc::EyeColor left, right;
    colorizer.render(frame, left, right);
    size_t fl = 0, fr = 0;
    const size_t dl = diff(left.image.rgba, read_bytes(dir / (stem + ".left.rgba")), fl);
    const size_t dr = diff(right.image.rgba, read_bytes(dir / (stem + ".right.rgba")), fr);
    frames++;
    total_px += 2 * 384 * 224;
    bad_px += dl + dr;
    if (dl || dr) {
      bad_frames++;
      std::printf("DIFF %s: left %zu px (first %zu,%zu), right %zu px (first %zu,%zu)\n", stem.c_str(), dl, dl ? fl % 384 : 0,
                  dl ? fl / 384 : 0, dr, dr ? fr % 384 : 0, dr ? fr / 384 : 0);
    }
  }
  std::printf("%zu frames, %zu differ; %zu of %zu pixels differ (%.4f%%)\n", frames, bad_frames, bad_px, total_px,
              total_px ? 100.0 * static_cast<double>(bad_px) / static_cast<double>(total_px) : 0.0);
  return bad_frames ? 1 : 0;
}
