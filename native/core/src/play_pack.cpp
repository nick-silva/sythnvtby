// Reading play packs (.vbcplay): zip (miniz), JSON (nlohmann), PNG pictures (stb_image).
// What is valid follows the browser's readers: src/play-pack.js, layerArtOf (src/layer-art.js),
// touchUpOf (src/touch-up.js), decodeGroupTileColors (src/group-tile-colors.js),
// normalizedCriteria (src/color-layer.js), parseVBColorPack (src/vbcolor-pack.js),
// groupScreensOf and normalizeGroupRamConditionsList (src/screen-gate.js, src/color-layer.js).
#include "vbcolor/play_pack.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>

#include "miniz.h"
#include "nlohmann/json.hpp"

#if defined(_MSC_VER)
#pragma warning(push, 0)
#endif
#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_NO_STDIO
#include "stb_image.h"
#if defined(_MSC_VER)
#pragma warning(pop)
#endif

namespace vbc {
namespace {

using json = nlohmann::json;

constexpr int kMaxSide = 4096;
constexpr int kMaxTouchUpSide = 1024;

/** A JSON number that is a whole number (JS Number.isInteger), else nothing. */
std::optional<long long> as_int(const json& v) {
  if (v.is_number_integer()) return v.get<long long>();
  if (v.is_number_float()) {
    const double d = v.get<double>();
    if (std::isfinite(d) && std::floor(d) == d && std::fabs(d) < 9e15) return static_cast<long long>(d);
  }
  return std::nullopt;
}

bool int_in(const json& obj, const char* key, long long lo, long long hi, int& out) {
  if (!obj.is_object() || !obj.contains(key)) return false;
  auto v = as_int(obj[key]);
  if (!v || *v < lo || *v > hi) return false;
  out = static_cast<int>(*v);
  return true;
}

/** toNumSet: numbers, or strings holding a decimal or 0x hex number. */
std::unordered_set<long long> num_set(const json& arr) {
  std::unordered_set<long long> out;
  if (!arr.is_array()) return out;
  for (const auto& v : arr) {
    if (v.is_number()) {
      const double d = v.get<double>();
      if (std::isfinite(d)) out.insert(static_cast<long long>(d));
      continue;
    }
    if (!v.is_string()) continue;
    std::string s = v.get<std::string>();
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) s.erase(s.begin());
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
    if (s.empty()) continue;
    try {
      size_t used = 0;
      long long n = 0;
      if (s.size() > 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
        n = std::stoll(s.substr(2), &used, 16);
        used += 2;
      } else {
        n = static_cast<long long>(std::stod(s, &used));
      }
      if (used == s.size()) out.insert(n);
    } catch (...) {
      // not a number: ignored, as Number() would give NaN
    }
  }
  return out;
}

RgbaImage decode_png(const std::vector<uint8_t>& png) {
  RgbaImage img;
  if (png.empty()) return img;
  int w = 0, h = 0, n = 0;
  unsigned char* px = stbi_load_from_memory(png.data(), static_cast<int>(png.size()), &w, &h, &n, 4);
  if (!px) return img;
  img.width = w;
  img.height = h;
  img.rgba.assign(px, px + static_cast<size_t>(w) * h * 4);
  stbi_image_free(px);
  return img;
}

std::optional<std::array<uint8_t, 3>> parse_hex_colour(const json& v) {
  if (!v.is_string()) return std::nullopt;
  const std::string s = v.get<std::string>();
  if (s.size() != 7 || s[0] != '#') return std::nullopt;
  for (size_t i = 1; i < 7; i++) {
    if (!std::isxdigit(static_cast<unsigned char>(s[i]))) return std::nullopt;
  }
  const unsigned long n = std::stoul(s.substr(1), nullptr, 16);
  return std::array<uint8_t, 3>{static_cast<uint8_t>(n >> 16), static_cast<uint8_t>(n >> 8), static_cast<uint8_t>(n)};
}

Group parse_group(const json& g) {
  Group out;
  if (g.contains("id") && g["id"].is_string()) out.id = g["id"].get<std::string>();
  if (g.contains("name") && g["name"].is_string()) out.name = g["name"].get<std::string>();
  if (g.contains("criteria") && g["criteria"].is_object()) {
    const json& c = g["criteria"];
    if (c.contains("windowIds")) out.criteria.window_ids = num_set(c["windowIds"]);
    out.criteria.worlds = out.criteria.window_ids;
    if (out.criteria.worlds.empty() && c.contains("worldIds")) out.criteria.worlds = num_set(c["worldIds"]);
    if (c.contains("hashes")) out.criteria.hashes = num_set(c["hashes"]);
    if (c.contains("layers")) out.criteria.layers = num_set(c["layers"]);
    if (c.contains("tileSlots")) out.criteria.slots = num_set(c["tileSlots"]);
  }
  if (g.contains("tileColors") && g["tileColors"].is_object()) {
    for (const auto& [key, val] : g["tileColors"].items()) {
      if (!val.is_string()) continue;
      double hash = 0;
      try {
        size_t used = 0;
        hash = std::stod(key, &used);
        if (used != key.size()) continue;
      } catch (...) {
        continue;
      }
      std::vector<uint8_t> bytes = base64_decode(val.get<std::string>());
      if (bytes.size() != 256) continue;
      TileRgba t;
      std::memcpy(t.data(), bytes.data(), 256);
      out.tile_colors[static_cast<uint32_t>(static_cast<long long>(hash))] = t;
    }
  }
  if (g.contains("shadeRamp") && g["shadeRamp"].is_array()) {
    std::array<std::optional<std::array<uint8_t, 3>>, 4> ramp{};
    const json& r = g["shadeRamp"];
    for (size_t s = 1; s < 4 && s < r.size(); s++) ramp[s] = parse_hex_colour(r[s]);
    out.shade_ramp = ramp;
  }
  // Overpaint is read first; an older pack's layerArt reads as overpaint that hides the tiles.
  const bool overpaint = g.contains("overpaint") && g["overpaint"].is_object();
  const char* art_key = overpaint ? "overpaint" : "layerArt";
  if (g.contains(art_key) && !g[art_key].is_null() && !(g[art_key].is_boolean() && !g[art_key].get<bool>())) {
    out.has_layer_art_field = true;
    const json& a = g[art_key];
    LayerArt art;
    art.hide_tiles = !overpaint || (a.contains("hideTiles") && a["hideTiles"].is_boolean() && a["hideTiles"].get<bool>());
    if (a.is_object() && int_in(a, "world", 0, 31, art.world) && int_in(a, "mapX", 0, 0x1fff, art.map_x) &&
        int_in(a, "mapY", 0, 0x1fff, art.map_y) && int_in(a, "width", 1, kMaxSide, art.width) &&
        int_in(a, "height", 1, kMaxSide, art.height)) {
      int base = -1;
      if (int_in(a, "bgmapBase", 0, 15, base)) art.bgmap_base = base;
      if (a.contains("png") && a["png"].is_string()) art.pixels = decode_png(base64_decode(a["png"].get<std::string>()));
      if (!art.pixels.empty()) out.layer_art = std::move(art);
    }
  }
  if (g.contains("touchUp") && g["touchUp"].is_object()) {
    const json& t = g["touchUp"];
    TouchUp tu;
    const json* box = t.contains("box") ? &t["box"] : nullptr;
    const bool anchor_ok = t.contains("anchorHash") && t["anchorHash"].is_number() && std::isfinite(t["anchorHash"].get<double>());
    if (anchor_ok && box && int_in(*box, "dx", -kMaxTouchUpSide, kMaxTouchUpSide, tu.box_dx) &&
        int_in(*box, "dy", -kMaxTouchUpSide, kMaxTouchUpSide, tu.box_dy) && int_in(*box, "width", 1, kMaxTouchUpSide, tu.box_w) &&
        int_in(*box, "height", 1, kMaxTouchUpSide, tu.box_h)) {
      tu.anchor_hash = static_cast<uint32_t>(static_cast<long long>(t["anchorHash"].get<double>()));
      if (t.contains("layout") && t["layout"].is_array()) {
        for (const auto& l : t["layout"]) {
          if (!l.is_object() || !l.contains("dx") || !l.contains("dy") || !l.contains("hash")) continue;
          auto dx = as_int(l["dx"]), dy = as_int(l["dy"]);
          if (!dx || !dy || !l["hash"].is_number() || !std::isfinite(l["hash"].get<double>())) continue;
          tu.layout.push_back({static_cast<int>(*dx), static_cast<int>(*dy),
                               static_cast<uint32_t>(static_cast<long long>(l["hash"].get<double>()))});
        }
      }
      if (t.contains("png") && t["png"].is_string()) tu.pixels = decode_png(base64_decode(t["png"].get<std::string>()));
      if (!tu.layout.empty() && !tu.pixels.empty()) out.touch_up = std::move(tu);
    }
  }
  return out;
}

/** normalizeGroupRamConditionsList: [{offset, expectedValue}] or the older {"0x1234": value} map. */
std::vector<RamCondition> parse_ram_conditions(const json& rc) {
  std::vector<RamCondition> out;
  auto add = [&](long long offset, long long value) {
    if (offset >= 0 && offset < 0x10000) out.push_back({static_cast<uint16_t>(offset), static_cast<uint8_t>(value & 0xff)});
  };
  if (rc.is_array()) {
    for (const auto& c : rc) {
      if (!c.is_object()) continue;
      const long long offset = c.contains("offset") ? as_int(c["offset"]).value_or(0) : 0;
      const long long value = c.contains("expectedValue") ? as_int(c["expectedValue"]).value_or(0) : 0;
      add(offset, value);
    }
  } else if (rc.is_object()) {
    for (const auto& [k, v] : rc.items()) {
      long long offset = -1;
      try {
        offset = (k.size() > 2 && k[0] == '0' && (k[1] == 'x' || k[1] == 'X')) ? std::stoll(k.substr(2), nullptr, 16) : std::stoll(k);
      } catch (...) {
        continue;
      }
      add(offset, as_int(v).value_or(0));
    }
  }
  return out;
}

/** pool id → its variants' recipes (variants without one are left out: they match nothing). */
std::unordered_map<std::string, std::vector<std::vector<RamCondition>>> parse_screen_recipes(const json& pools) {
  std::unordered_map<std::string, std::vector<std::vector<RamCondition>>> out;
  if (!pools.is_array()) return out;
  for (const auto& p : pools) {
    if (!p.is_object() || !p.contains("id") || !p["id"].is_string() || !p.contains("variants") || !p["variants"].is_array()) continue;
    auto& recipes = out[p["id"].get<std::string>()];
    for (const auto& v : p["variants"]) {
      if (!v.is_object() || !v.contains("ramConditions")) continue;
      auto conditions = parse_ram_conditions(v["ramConditions"]);
      if (!conditions.empty()) recipes.push_back(std::move(conditions));
    }
  }
  return out;
}

std::string trimmed(const std::string& s) {
  const size_t first = s.find_first_not_of(" \t\r\n");
  return first == std::string::npos ? std::string() : s.substr(first, s.find_last_not_of(" \t\r\n") - first + 1);
}

/**
 * groups.json `gameStates` (src/game-states.js gameStatesOf): id → its bytes. A state needs an id
 * and at least one valid `{ offset, value }` (offset below 0x10000, value 0–255); the first of a
 * repeated id wins.
 */
std::unordered_map<std::string, std::vector<RamCondition>> parse_game_states(const json& states) {
  std::unordered_map<std::string, std::vector<RamCondition>> out;
  if (!states.is_array()) return out;
  for (const auto& s : states) {
    if (!s.is_object() || !s.contains("id") || !s["id"].is_string() || !s.contains("conditions") || !s["conditions"].is_array()) continue;
    const std::string id = trimmed(s["id"].get<std::string>());
    if (id.empty() || out.count(id)) continue;
    std::vector<RamCondition> bytes;
    for (const auto& c : s["conditions"]) {
      if (!c.is_object() || !c.contains("offset")) continue;
      const auto offset = as_int(c["offset"]);
      const auto value = c.contains("value") ? as_int(c["value"]) : c.contains("expectedValue") ? as_int(c["expectedValue"]) : std::nullopt;
      if (!offset || !value || *offset < 0 || *offset >= 0x10000 || *value < 0 || *value > 255) continue;
      bytes.push_back({static_cast<uint16_t>(*offset), static_cast<uint8_t>(*value)});
    }
    if (!bytes.empty()) out.emplace(id, std::move(bytes));
  }
  return out;
}

/** A group's `conditions` (src/game-states.js groupConditionsOf), resolved to the states' bytes. Unknown states are left out. */
std::vector<GroupCondition> parse_conditions(const json& g, const std::unordered_map<std::string, std::vector<RamCondition>>& states) {
  std::vector<GroupCondition> out;
  if (!g.contains("conditions") || !g["conditions"].is_array()) return out;
  std::unordered_set<std::string> seen;
  for (const auto& c : g["conditions"]) {
    if (!c.is_object() || !c.contains("state") || !c["state"].is_string()) continue;
    const std::string id = trimmed(c["state"].get<std::string>());
    if (id.empty() || !seen.insert(id).second) continue;
    auto it = states.find(id);
    if (it == states.end()) continue;
    const bool is = !(c.contains("is") && c["is"].is_boolean() && !c["is"].get<bool>());
    out.push_back({it->second, is});
  }
  return out;
}

/** groupScreensOf: `{ mode: 'only' | 'except', pools: [id…] }`, resolved to the pools' recipes. */
std::optional<ScreenLimit> parse_screens(const json& g, const std::unordered_map<std::string, std::vector<std::vector<RamCondition>>>& recipes) {
  if (!g.contains("screens") || !g["screens"].is_object()) return std::nullopt;
  const json& s = g["screens"];
  const std::string mode = s.contains("mode") && s["mode"].is_string() ? s["mode"].get<std::string>() : "";
  if ((mode != "only" && mode != "except") || !s.contains("pools") || !s["pools"].is_array()) return std::nullopt;
  ScreenLimit out;
  out.only = mode == "only";
  size_t listed = 0;
  std::unordered_set<std::string> seen;
  for (const auto& p : s["pools"]) {
    if (!p.is_string()) continue;
    std::string id = p.get<std::string>();
    const size_t first = id.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) continue;
    id = id.substr(first, id.find_last_not_of(" \t\r\n") - first + 1);
    if (!seen.insert(id).second) continue;
    listed++;
    auto it = recipes.find(id);
    out.screens.push_back(it == recipes.end() ? std::vector<std::vector<RamCondition>>{} : it->second);
  }
  if (!listed) return std::nullopt;
  return out;
}

class Zip {
 public:
  explicit Zip(const std::vector<uint8_t>& bytes) {
    std::memset(&zip_, 0, sizeof zip_);
    ok_ = !bytes.empty() && mz_zip_reader_init_mem(&zip_, bytes.data(), bytes.size(), 0) != 0;
  }
  ~Zip() {
    if (ok_) mz_zip_reader_end(&zip_);
  }
  Zip(const Zip&) = delete;
  Zip& operator=(const Zip&) = delete;
  bool ok() const { return ok_; }
  std::optional<std::vector<uint8_t>> read(const char* name) {
    const int index = mz_zip_reader_locate_file(&zip_, name, nullptr, 0);
    if (index < 0) return std::nullopt;
    size_t size = 0;
    void* p = mz_zip_reader_extract_to_heap(&zip_, static_cast<mz_uint>(index), &size, 0);
    if (!p) return std::nullopt;
    std::vector<uint8_t> out(static_cast<uint8_t*>(p), static_cast<uint8_t*>(p) + size);
    mz_free(p);
    return out;
  }

 private:
  mz_zip_archive zip_;
  bool ok_ = false;
};

json parse_json(const std::vector<uint8_t>& bytes, const char* name) {
  try {
    return json::parse(bytes.begin(), bytes.end());
  } catch (const std::exception&) {
    throw PlayPackError(std::string("This play pack is damaged (") + name + " is not valid JSON).");
  }
}

std::string str_or(const json& o, const char* key) {
  return o.is_object() && o.contains(key) && o[key].is_string() ? o[key].get<std::string>() : std::string();
}

}  // namespace

std::vector<uint8_t> base64_decode(const std::string& text) {
  static const auto table = [] {
    std::array<int, 256> t{};
    t.fill(-1);
    const char* abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (int i = 0; i < 64; i++) t[static_cast<unsigned char>(abc[i])] = i;
    return t;
  }();
  std::vector<uint8_t> out;
  out.reserve(text.size() * 3 / 4);
  uint32_t acc = 0;
  int bits = 0;
  for (char ch : text) {
    if (ch == '=' || std::isspace(static_cast<unsigned char>(ch))) continue;
    const int v = table[static_cast<unsigned char>(ch)];
    if (v < 0) return {};
    acc = (acc << 6) | static_cast<uint32_t>(v);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<uint8_t>(acc >> bits));
    }
  }
  return out;
}

std::unordered_map<uint32_t, TileRgba> parse_vbcolor(const uint8_t* data, size_t size) {
  std::unordered_map<uint32_t, TileRgba> out;
  if (!data || size < 12 || std::memcmp(data, "VBCL", 4) != 0) return out;
  auto u16 = [&](size_t o) { return static_cast<uint32_t>(data[o] | (data[o + 1] << 8)); };
  auto u32 = [&](size_t o) { return u16(o) | (u16(o + 2) << 16); };
  if (u16(4) != 1) return out;
  const size_t id_len = u16(6);
  if (id_len > 255 || 12 + id_len > size) return out;
  const uint32_t count = u32(8 + id_len);
  size_t off = 12 + id_len;
  for (uint32_t i = 0; i < count && off + 260 <= size; i++) {
    TileRgba t;
    std::memcpy(t.data(), data + off + 4, 256);
    out[u32(off)] = t;  // the last entry for a hash wins, as in a JS Map
    off += 260;
  }
  return out;
}

namespace {
/** A pattern hash as the browser reads it (`Number(h) >>> 0`). */
uint32_t hash_u32(const json& v) { return static_cast<uint32_t>(static_cast<long long>(v.get<double>())); }

/**
 * The patterns of the saved pose a pose picture was painted on (`poseId`), only those that are the
 * group's, each once (src/pose-overpaint.js savedPoseHashes); empty when there is no such pose.
 */
json saved_pose_hashes(const json& g, const json& picture) {
  json out = json::array();
  if (!picture.contains("poseId") || !picture["poseId"].is_string() || !g.contains("poses") || !g["poses"].is_array()) return out;
  const std::string id = picture["poseId"].get<std::string>();
  std::unordered_set<uint32_t> own;
  if (g.contains("criteria") && g["criteria"].is_object() && g["criteria"].contains("hashes") && g["criteria"]["hashes"].is_array()) {
    for (const auto& h : g["criteria"]["hashes"]) if (h.is_number()) own.insert(hash_u32(h));
  }
  for (const auto& pose : g["poses"]) {
    if (!pose.is_object() || !pose.contains("poseId") || !pose["poseId"].is_string() || pose["poseId"].get<std::string>() != id) continue;
    if (!pose.contains("tiles") || !pose["tiles"].is_array()) return out;
    std::unordered_set<uint32_t> seen;
    for (const auto& t : pose["tiles"]) {
      if (!t.is_object() || !t.contains("hash") || !t["hash"].is_number()) continue;
      const uint32_t h = hash_u32(t["hash"]);
      if ((own.empty() || own.count(h)) && seen.insert(h).second) out.push_back(h);
    }
    return out;
  }
  return out;
}
}  // namespace

std::vector<Group> parse_groups_json(const std::vector<uint8_t>& bytes) {
  std::vector<Group> out;
  const json doc = parse_json(bytes, "groups.json");
  if (!doc.is_object() || !doc.contains("groups") || !doc["groups"].is_array()) return out;
  const auto recipes = parse_screen_recipes(doc.contains("gameStatePools") ? doc["gameStatePools"] : json());
  const auto states = parse_game_states(doc.contains("gameStates") ? doc["gameStates"] : json());
  for (const auto& g : doc["groups"]) {
    if (!g.is_object()) continue;
    Group group = parse_group(g);
    group.screens = parse_screens(g, recipes);
    group.conditions = parse_conditions(g, states);
    group.follow_palette = g.contains("followPalette") && g["followPalette"].is_boolean() && g["followPalette"].get<bool>();
    group.whole_pose = g.contains("wholePose") && g["wholePose"].is_boolean() && g["wholePose"].get<bool>();
    const auto screens = group.screens;
    const auto conditions = group.conditions;
    out.push_back(std::move(group));
    // Pose pictures kept inside the character's group (src/pose-overpaint.js): each is drawn as a
    // whole-pose group right after it, with its worlds, layers and screens and the pose's patterns.
    if (!g.contains("poseOverpaints") || !g["poseOverpaints"].is_array()) continue;
    const json crit = g.contains("criteria") && g["criteria"].is_object() ? g["criteria"] : json::object();
    const std::string parent_id = g.contains("id") && g["id"].is_string() ? g["id"].get<std::string>() : std::string();
    for (const auto& p : g["poseOverpaints"]) {
      if (!p.is_object() || !p.contains("id") || !p["id"].is_string()) continue;
      // Its saved pose's patterns while that pose exists (only the group's), else its own list.
      json hashes = saved_pose_hashes(g, p);
      if (hashes.empty() && p.contains("hashes") && p["hashes"].is_array()) hashes = p["hashes"];
      if (hashes.empty()) continue;
      json pose = json::object();
      pose["id"] = parent_id + "#pose:" + p["id"].get<std::string>();
      pose["criteria"] = json::object();
      pose["criteria"]["windowIds"] = crit.contains("windowIds") && crit["windowIds"].is_array() ? crit["windowIds"] : json::array();
      pose["criteria"]["layers"] = crit.contains("layers") && crit["layers"].is_array() ? crit["layers"] : json::array({0});
      pose["criteria"]["hashes"] = hashes;
      pose["overpaint"] = p;
      Group picture = parse_group(pose);
      picture.screens = screens;
      picture.conditions = conditions;
      picture.whole_pose = true;
      out.push_back(std::move(picture));
    }
  }
  return out;
}

bool group_shown_on_screen(const Group& group, const uint8_t* wram, size_t size) {
  if (!wram || size < 0x10000) return true;
  const auto holds = [&](const std::vector<RamCondition>& bytes) {
    return std::all_of(bytes.begin(), bytes.end(), [&](const RamCondition& c) { return wram[c.offset] == c.value; });
  };
  for (const auto& c : group.conditions) {
    if (holds(c.bytes) != c.is) return false;
  }
  if (!group.screens) return true;
  bool hit = false;
  for (const auto& screen : group.screens->screens) {
    for (const auto& recipe : screen) {
      if (holds(recipe)) {
        hit = true;
        break;
      }
    }
    if (hit) break;
  }
  return group.screens->only ? hit : !hit;
}

PlayPack load_play_pack(const std::vector<uint8_t>& bytes) {
  Zip zip(bytes);
  if (!zip.ok()) throw PlayPackError("This file is not a play pack (it could not be opened as one).");
  auto info_bytes = zip.read("play.json");
  if (!info_bytes) {
    const bool vbpack = zip.read("manifest.json").has_value();
    throw PlayPackError(std::string("This file is not a play pack (no play.json).") +
                        (vbpack ? " It looks like a .vbpack project: export it for the player from the Project tool." : ""));
  }
  const json info = parse_json(*info_bytes, "play.json");
  if (!info.is_object() || str_or(info, "format") != "vbcolor-play") throw PlayPackError("This file is not a sythnvtby play pack.");
  const auto version = info.contains("version") ? as_int(info["version"]) : std::nullopt;
  if (!version || *version < 1 || *version > 1) {
    throw PlayPackError("This play pack needs a newer player (pack version " +
                        (info.contains("version") ? info["version"].dump() : std::string("?")) + ", player reads 1).");
  }
  const json rom = info.contains("rom") ? info["rom"] : json();
  PlayPack pack;
  pack.info.title = str_or(info, "title");
  pack.info.author = str_or(info, "author");
  pack.info.created_at = str_or(info, "createdAt");
  pack.info.rom_file_name = str_or(rom, "fileName");
  pack.info.rom_sha1 = str_or(rom, "sha1");
  pack.info.rom_crc32 = str_or(rom, "crc32");
  if (rom.is_object() && rom.contains("size")) {
    if (auto s = as_int(rom["size"])) pack.info.rom_size = *s;
  }
  if (pack.info.rom_sha1.empty() && pack.info.rom_crc32.empty()) throw PlayPackError("This play pack does not say which ROM it is for.");
  pack.info.paint_on_transparent =
      info.contains("paintOnTransparent") && info["paintOnTransparent"].is_boolean() && info["paintOnTransparent"].get<bool>();
  if (info.contains("brightnessReference") && info["brightnessReference"].is_number()) {
    const double r = info["brightnessReference"].get<double>();
    if (std::isfinite(r) && r > 0) pack.info.brightness_reference = r;
  }
  if (info.contains("features") && info["features"].is_array()) {
    for (const auto& f : info["features"]) {
      if (f.is_string()) pack.info.features.push_back(f.get<std::string>());
    }
  }
  if (auto vbcolor = zip.read("color.vbcolor")) pack.tile_colors = parse_vbcolor(vbcolor->data(), vbcolor->size());
  if (auto groups = zip.read("groups.json")) pack.groups = parse_groups_json(*groups);
  if (auto overrides = zip.read("overrides.json")) {
    const json doc = parse_json(*overrides, "overrides.json");
    if (doc.is_array()) pack.unsupported_overrides = doc.size();
  }
  if (auto rules = zip.read("painter-v2-rules.json")) {
    const json doc = parse_json(*rules, "painter-v2-rules.json");
    if (doc.is_object() && doc.contains("tile8ByVariant") && doc["tile8ByVariant"].is_object()) {
      for (const auto& [k, v] : doc["tile8ByVariant"].items()) pack.unsupported_v2_rules += v.is_object() ? v.size() : 0;
    }
  }
  if (auto overlays = zip.read("painter-v2-vip-overlays.json")) pack.unsupported_overlays = !overlays->empty();
  if (auto cover = zip.read("cover.png")) pack.cover_png = std::move(*cover);
  return pack;
}

}  // namespace vbc
