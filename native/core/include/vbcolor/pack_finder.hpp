#pragma once
// Finding a game's play pack from its ROM, so the player never needs the two in one file
// (docs/design/vb-color-player.md, "Finding a play pack"). In order:
//   1. the player's own choice for this ROM, if one was made (a pack file, or none at all);
//   2. beside the game: <rom folder>/<rom name>.vbcplay, when it is made for this ROM;
//   3. the packs folders: any .vbcplay made for this ROM, by SHA-1 (else CRC32 and size); of
//      several, the newest (play.json createdAt). Each folder keeps an index.json so packs are
//      not opened on every launch.
// Shared by every front end (the SDL player now, a libretro core later).
#include <filesystem>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "vbcolor/play_pack.hpp"
#include "vbcolor/rom_identity.hpp"

namespace vbc {

/** A remembered choice for one ROM: a pack file, or no colour at all. */
struct PackChoice {
  bool none = false;
  std::filesystem::path pack;
};

/**
 * The player's choices, one per ROM (keyed by SHA-1), kept in a small JSON file:
 *   { "version": 1, "choices": { "<sha1>": { "pack": "C:/…/Game.vbcplay" } | { "none": true } } }
 * A missing or damaged file reads as no choices. Each change is written at once.
 */
class PackChoices {
 public:
  explicit PackChoices(std::filesystem::path file);
  std::optional<PackChoice> get(const std::string& rom_sha1) const;
  /** Each returns false when the file could not be written (the choice still holds this session). */
  bool choose_pack(const std::string& rom_sha1, const std::filesystem::path& pack);
  bool choose_none(const std::string& rom_sha1);
  bool forget(const std::string& rom_sha1);

 private:
  bool set(const std::string& rom_sha1, std::optional<PackChoice> choice);
  bool save() const;
  std::filesystem::path file_;
  std::vector<std::pair<std::string, PackChoice>> choices_;
};

/** One pack in a packs folder, as its index.json remembers it. */
struct IndexedPack {
  std::filesystem::path path;
  PlayPackInfo info;
};

/**
 * Every play pack in a folder (not its subfolders), from its index.json where a pack's size and
 * time still match, else read and added. index.json is rewritten when it changed; a folder that
 * cannot be written is still read. Files that are not play packs are left out.
 */
std::vector<IndexedPack> index_packs_folder(const std::filesystem::path& dir);

enum class PackSource {
  None,         // nothing found, or the player chose no colour for this ROM (FoundPack::chose_none)
  Choice,       // the player's choice for this ROM
  BesideGame,   // <rom name>.vbcplay beside the ROM
  PacksFolder,  // a packs folder
};

struct FoundPack {
  PackSource source = PackSource::None;
  std::filesystem::path path;
  bool chose_none = false;
  /** Things worth telling the player, e.g. a chosen pack that has gone. */
  std::vector<std::string> notes;
};

/** The pack to use for this ROM, following the order at the top of this file. */
FoundPack find_play_pack(const std::filesystem::path& rom_path, const RomIdentity& rom,
                         const std::vector<std::filesystem::path>& packs_dirs, const PackChoices& choices);

/** "your choice", "beside the game", "packs folder" — for the title bar. */
const char* pack_source_name(PackSource source);

}  // namespace vbc
