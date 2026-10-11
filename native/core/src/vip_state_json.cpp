// Captured frames (src/vip-dump.js deserializeVIPState) as VipFrames.
#include "vbcolor/vip_state_json.hpp"

#include <algorithm>
#include <cstring>
#include <stdexcept>

#include "nlohmann/json.hpp"
#include "vbcolor/play_pack.hpp"

namespace vbc {

VipFrame vip_frame_from_json(const std::string& json_text) {
  using json = nlohmann::json;
  const json o = json::parse(json_text);
  if (!o.is_object() || !o.contains("patternTableBase64")) throw std::runtime_error("not a captured VIP frame");
  VipFrame f;
  auto copy = [](const std::vector<uint8_t>& src, uint8_t* dst, size_t max) { std::memcpy(dst, src.data(), std::min(src.size(), max)); };
  copy(base64_decode(o["patternTableBase64"].get<std::string>()), f.pattern_table.data(), f.pattern_table.size());
  const int segment_count = o.contains("segmentCount") && o["segmentCount"].is_number() ? o["segmentCount"].get<int>() : 0;
  if (o.contains("segmentsBase64") && o["segmentsBase64"].is_array()) {
    const json& segs = o["segmentsBase64"];
    for (int i = 0; i < segment_count && i < 16 && static_cast<size_t>(i) < segs.size(); i++) {
      if (!segs[static_cast<size_t>(i)].is_string()) continue;
      copy(base64_decode(segs[static_cast<size_t>(i)].get<std::string>()), f.display_ram.data() + static_cast<size_t>(i) * VipFrame::kSegmentBytes,
           VipFrame::kSegmentBytes);
    }
  }
  // The world table travels on its own too; the browser reads worlds from it.
  if (o.contains("windowsBase64") && o["windowsBase64"].is_string()) {
    copy(base64_decode(o["windowsBase64"].get<std::string>()), f.display_ram.data() + VipFrame::kWindowsOffset, VipFrame::kWindowsBytes);
  }
  const json list = o.contains("drawList") && o["drawList"].is_array() ? o["drawList"] : json::array();
  bool any_eye = false;
  for (const auto& d : list) any_eye = any_eye || (d.contains("eye") && !d["eye"].is_null());
  size_t i = 0;
  for (const auto& d : list) {
    DrawCall c;
    auto num = [&](const char* key, long long fallback) -> long long {
      return d.contains(key) && d[key].is_number() ? static_cast<long long>(d[key].get<double>()) : fallback;
    };
    auto has = [&](const char* key) { return d.contains(key) && !d[key].is_null(); };
    c.tile = static_cast<uint16_t>(num("tileIndex", 0));
    c.x = static_cast<int16_t>(num("x", 0));
    c.y = static_cast<int16_t>(num("y", 0));
    c.flip_h = d.contains("flipH") && d["flipH"].is_boolean() && d["flipH"].get<bool>();
    c.flip_v = d.contains("flipV") && d["flipV"].is_boolean() && d["flipV"].get<bool>();
    c.eye = static_cast<uint8_t>(has("eye") ? num("eye", 0) : (any_eye ? 0 : static_cast<long long>(i % 2)));
    if (has("layer")) c.layer = static_cast<uint8_t>(num("layer", 0));
    if (has("paletteSelector")) c.palette = static_cast<uint8_t>(num("paletteSelector", 0) & 3);
    if (has("strip")) c.strip = static_cast<uint8_t>(num("strip", 0) & 0x1f);
    if (has("world")) c.world = static_cast<uint8_t>(num("world", 0) & 0x1f);
    f.draw_list.push_back(c);
    i++;
  }
  if (o.contains("gplt") && o["gplt"].is_array() && o["gplt"].size() >= 4) {
    for (size_t g = 0; g < 4; g++) f.gplt[g] = static_cast<uint16_t>(o["gplt"][g].get<double>());
    f.has_gplt = true;
  }
  if (o.contains("masterBrightness") && o["masterBrightness"].is_number()) {
    f.master_brightness = std::clamp(o["masterBrightness"].get<double>(), 0.0, 1.0);
    f.has_master_brightness = true;
  }
  if (o.contains("corePatchLevel") && o["corePatchLevel"].is_number()) f.core_patch_level = o["corePatchLevel"].get<int>();
  if (o.contains("frameNumber") && o["frameNumber"].is_number()) f.frame_number = static_cast<uint32_t>(o["frameNumber"].get<double>());
  return f;
}

}  // namespace vbc
