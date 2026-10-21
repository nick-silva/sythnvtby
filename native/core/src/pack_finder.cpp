// Finding a game's play pack from its ROM: the player's choice, beside the game, the packs folders.
// See vbcolor/pack_finder.hpp.
#include "vbcolor/pack_finder.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <iterator>
#include <system_error>

#include "nlohmann/json.hpp"

namespace fs = std::filesystem;

namespace vbc {
namespace {

using json = nlohmann::json;

constexpr int kFileVersion = 1;
constexpr const char* kIndexName = "index.json";

std::optional<std::vector<uint8_t>> read_bytes(const fs::path& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::nullopt;
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

std::optional<json> read_json(const fs::path& path) {
  auto bytes = read_bytes(path);
  if (!bytes) return std::nullopt;
  try {
    json doc = json::parse(bytes->begin(), bytes->end());
    if (doc.is_object()) return doc;
  } catch (const std::exception&) {
    // A damaged file reads as empty: choices and the index are rebuilt from scratch.
  }
  return std::nullopt;
}

/** Write beside the file, then move it into place, so a crash never leaves half a file. */
bool write_json(const fs::path& path, const json& doc) {
  std::error_code ec;
  if (path.has_parent_path()) fs::create_directories(path.parent_path(), ec);
  fs::path tmp = path;
  tmp += ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    out << doc.dump(2);
    if (!out) return false;
  }
  fs::rename(tmp, path, ec);
  if (ec) {
    fs::remove(tmp, ec);
    return false;
  }
  return true;
}

std::string lower(std::string s) {
  for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

std::string str_of(const json& doc, const char* key) {
  return doc.is_object() && doc.contains(key) && doc[key].is_string() ? doc[key].get<std::string>() : std::string();
}

bool is_play_pack_file(const fs::path& p) { return lower(p.extension().u8string()) == ".vbcplay"; }

bool made_for(const PlayPackInfo& info, const RomIdentity& rom) {
  return same_rom(info.rom_sha1, info.rom_crc32, info.rom_size, rom);
}

long long mtime_of(const fs::path& p) {
  std::error_code ec;
  const auto t = fs::last_write_time(p, ec);
  return ec ? -1 : static_cast<long long>(t.time_since_epoch().count());
}

json info_to_json(const PlayPackInfo& info) {
  json rom = {{"sha1", info.rom_sha1}, {"crc32", info.rom_crc32}, {"size", info.rom_size}};
  if (!info.rom_file_name.empty()) rom["fileName"] = info.rom_file_name;
  return {{"title", info.title}, {"author", info.author}, {"createdAt", info.created_at}, {"rom", rom}};
}

PlayPackInfo info_from_json(const json& doc) {
  PlayPackInfo info;
  info.title = str_of(doc, "title");
  info.author = str_of(doc, "author");
  info.created_at = str_of(doc, "createdAt");
  const json rom = doc.contains("rom") ? doc["rom"] : json();
  info.rom_file_name = str_of(rom, "fileName");
  info.rom_sha1 = str_of(rom, "sha1");
  info.rom_crc32 = str_of(rom, "crc32");
  if (rom.is_object() && rom.contains("size") && rom["size"].is_number_integer()) info.rom_size = rom["size"].get<long long>();
  return info;
}

}  // namespace

// --- the player's choices -----------------------------------------------------------------------

PackChoices::PackChoices(fs::path file) : file_(std::move(file)) {
  const auto doc = read_json(file_);
  if (!doc || !doc->contains("choices") || !(*doc)["choices"].is_object()) return;
  for (const auto& [sha1, v] : (*doc)["choices"].items()) {
    if (!v.is_object()) continue;
    PackChoice c;
    c.none = v.contains("none") && v["none"].is_boolean() && v["none"].get<bool>();
    if (!c.none) {
      const std::string pack = str_of(v, "pack");
      if (pack.empty()) continue;
      c.pack = fs::u8path(pack);
    }
    choices_.emplace_back(lower(sha1), c);
  }
}

std::optional<PackChoice> PackChoices::get(const std::string& rom_sha1) const {
  const std::string key = lower(rom_sha1);
  for (const auto& [sha1, c] : choices_) {
    if (sha1 == key) return c;
  }
  return std::nullopt;
}

bool PackChoices::choose_pack(const std::string& rom_sha1, const fs::path& pack) {
  std::error_code ec;
  const fs::path full = fs::absolute(pack, ec);
  return set(rom_sha1, PackChoice{false, ec ? pack : full});
}

bool PackChoices::choose_none(const std::string& rom_sha1) { return set(rom_sha1, PackChoice{true, {}}); }

bool PackChoices::forget(const std::string& rom_sha1) { return set(rom_sha1, std::nullopt); }

bool PackChoices::set(const std::string& rom_sha1, std::optional<PackChoice> choice) {
  if (rom_sha1.empty()) return false;
  const std::string key = lower(rom_sha1);
  choices_.erase(std::remove_if(choices_.begin(), choices_.end(), [&](const auto& e) { return e.first == key; }), choices_.end());
  if (choice) choices_.emplace_back(key, *choice);
  return save();
}

bool PackChoices::save() const {
  json all = json::object();
  for (const auto& [sha1, c] : choices_) {
    all[sha1] = c.none ? json{{"none", true}} : json{{"pack", c.pack.u8string()}};
  }
  return write_json(file_, {{"version", kFileVersion}, {"choices", all}});
}

// --- packs folders ------------------------------------------------------------------------------

std::vector<IndexedPack> index_packs_folder(const fs::path& dir) {
  std::vector<IndexedPack> out;
  std::error_code ec;
  if (!fs::is_directory(dir, ec)) return out;

  // What the index already knows, by file name.
  struct Known {
    long long size = -1;
    long long mtime = -1;
    PlayPackInfo info;
  };
  std::vector<std::pair<std::string, Known>> known;
  const fs::path index_path = dir / kIndexName;
  if (const auto doc = read_json(index_path); doc && doc->contains("packs") && (*doc)["packs"].is_array()) {
    for (const auto& e : (*doc)["packs"]) {
      const std::string file = str_of(e, "file");
      if (file.empty() || !e.contains("size") || !e.contains("mtime")) continue;
      if (!e["size"].is_number_integer() || !e["mtime"].is_number_integer()) continue;
      known.emplace_back(file, Known{e["size"].get<long long>(), e["mtime"].get<long long>(), info_from_json(e)});
    }
  }

  json packs = json::array();
  bool changed = false;
  size_t kept = 0;
  for (fs::directory_iterator it(dir, ec), end; !ec && it != end; it.increment(ec)) {
    // Errors on one file must not end the listing, which `ec` drives.
    std::error_code file_ec;
    const fs::path p = it->path();
    if (!it->is_regular_file(file_ec) || !is_play_pack_file(p)) continue;
    const std::string file = p.filename().u8string();
    const auto bytes_on_disk = it->file_size(file_ec);
    if (file_ec) continue;
    const long long size = static_cast<long long>(bytes_on_disk);
    const long long mtime = mtime_of(p);
    std::optional<PlayPackInfo> info;
    const auto k = std::find_if(known.begin(), known.end(), [&](const auto& e) { return e.first == file; });
    if (k != known.end() && k->second.size == size && k->second.mtime == mtime) {
      info = k->second.info;
      kept++;
    } else {
      changed = true;
      if (auto bytes = read_bytes(p)) {
        try {
          info = read_play_pack_info(*bytes);
        } catch (const PlayPackError&) {
          // Not a play pack this player reads: left out, and looked at again when it changes.
        }
      }
    }
    if (!info) continue;
    json entry = info_to_json(*info);
    entry["file"] = file;
    entry["size"] = size;
    entry["mtime"] = mtime;
    packs.push_back(std::move(entry));
    out.push_back({p, *info});
  }
  if (kept != known.size()) changed = true;  // packs removed since
  // A folder we cannot write to (read-only install) is still read; it is just indexed each time.
  if (changed) write_json(index_path, {{"version", kFileVersion}, {"packs", packs}});
  std::sort(out.begin(), out.end(), [](const IndexedPack& a, const IndexedPack& b) { return a.path < b.path; });
  return out;
}

// --- finding the pack ---------------------------------------------------------------------------

FoundPack find_play_pack(const fs::path& rom_path, const RomIdentity& rom, const std::vector<fs::path>& packs_dirs,
                         const PackChoices& choices) {
  FoundPack out;
  std::error_code ec;

  if (const auto choice = choices.get(rom.sha1)) {
    if (choice->none) {
      out.chose_none = true;
      return out;
    }
    if (fs::is_regular_file(choice->pack, ec)) {
      out.source = PackSource::Choice;
      out.path = choice->pack;
      return out;
    }
    out.notes.push_back("The pack chosen for this game is no longer there (" + choice->pack.u8string() + "), so the player looked for another.");
  }

  fs::path beside = rom_path;
  beside.replace_extension(".vbcplay");
  if (fs::is_regular_file(beside, ec)) {
    try {
      const auto bytes = read_bytes(beside);
      const PlayPackInfo info = read_play_pack_info(bytes ? *bytes : std::vector<uint8_t>{});
      if (made_for(info, rom)) {
        out.source = PackSource::BesideGame;
        out.path = beside;
        return out;
      }
      const std::string made = info.rom_file_name.empty() ? std::string("another ROM") : info.rom_file_name;
      out.notes.push_back(beside.filename().u8string() + " is beside the game but was made for " + made + ", so it was not used.");
    } catch (const PlayPackError& e) {
      out.notes.push_back(beside.filename().u8string() + " is beside the game but could not be used: " + e.what());
    }
  }

  std::optional<IndexedPack> best;
  for (const auto& dir : packs_dirs) {
    for (auto& p : index_packs_folder(dir)) {
      if (!made_for(p.info, rom)) continue;
      // Newest wins (ISO dates compare as text); the first folder listed wins a tie.
      if (!best || p.info.created_at > best->info.created_at) best = std::move(p);
    }
  }
  if (best) {
    out.source = PackSource::PacksFolder;
    out.path = best->path;
  }
  return out;
}

const char* pack_source_name(PackSource source) {
  switch (source) {
    case PackSource::Choice:
      return "your choice";
    case PackSource::BesideGame:
      return "beside the game";
    case PackSource::PacksFolder:
      return "packs folder";
    case PackSource::None:
      break;
  }
  return "none";
}

}  // namespace vbc
