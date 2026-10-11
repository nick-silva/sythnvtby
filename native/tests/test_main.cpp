// Tests for the portable core library, and a smoke test of the Beetle adapter on a real ROM when
// VBC_TEST_ROM names one (ROMs are not in the repo). Exit code 0 = all passed.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "vbcolor/beetle.hpp"
#include "vbcolor/play_pack.hpp"
#include "vbcolor/rom_identity.hpp"
#include "vbcolor/stereo.hpp"
#include "vbcolor/vip_frame.hpp"

namespace {

int g_failed = 0;
int g_passed = 0;

#define CHECK(cond)                                                \
  do {                                                             \
    if (cond) {                                                    \
      g_passed++;                                                  \
    } else {                                                       \
      g_failed++;                                                  \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
    }                                                              \
  } while (0)

/** A core-style side-by-side frame: left eye pixels `l`, right eye pixels `r`. */
struct Eyes {
  std::vector<uint32_t> px;
  vbc::VideoFrame frame;
  Eyes(uint32_t l, uint32_t r) : px(static_cast<size_t>(vbc::kEyeWidth) * 2 * vbc::kEyeHeight) {
    for (int y = 0; y < vbc::kEyeHeight; y++) {
      for (int x = 0; x < vbc::kEyeWidth * 2; x++) px[static_cast<size_t>(y) * vbc::kEyeWidth * 2 + x] = x < vbc::kEyeWidth ? l : r;
    }
    frame.width = vbc::kEyeWidth * 2;
    frame.height = vbc::kEyeHeight;
    frame.pitch = static_cast<size_t>(vbc::kEyeWidth) * 2;
    frame.pixels = px.data();
  }
};

void test_compose_view() {
  Eyes eyes(0x00ff0000u, 0x00800000u);  // red, brighter on the left
  vbc::Image out;
  vbc::compose_view(eyes.frame, vbc::ViewMode::Flat, out);
  CHECK(out.width == 384 && out.height == 224);
  CHECK(out.pixels[0] == 0xffff0000u);

  vbc::compose_view(eyes.frame, vbc::ViewMode::SideBySide, out);
  CHECK(out.width == 768 && out.height == 224);
  CHECK(out.pixels[0] == 0xffff0000u && out.pixels[400] == 0xff800000u);

  // One-colour (red) eyes: left brightness in red, right in green and blue.
  vbc::compose_view(eyes.frame, vbc::ViewMode::Anaglyph, out);
  CHECK(out.width == 384);
  CHECK(out.pixels[0] == 0xffff8080u);
}

void test_compose_eyes() {
  vbc::Image l, r, out;
  l.resize(2, 1);
  r.resize(2, 1);
  l.pixels = {0xff112233u, 0xff112233u};
  r.pixels = {0xff445566u, 0xff445566u};
  vbc::compose_eyes(l, r, vbc::ViewMode::Anaglyph, out);
  CHECK(out.pixels[0] == 0xff115566u);  // the left's red, the right's green and blue
  vbc::compose_eyes(l, r, vbc::ViewMode::SideBySide, out);
  CHECK(out.width == 4 && out.pixels[2] == 0xff445566u);
  CHECK(vbc::next_view_mode(vbc::ViewMode::Anaglyph) == vbc::ViewMode::Flat);
}

void test_brightness() {
  const int32_t full[4] = {0, 255, 255, 255};
  const int32_t half[4] = {0, 0, 128, 255};
  CHECK(vbc::master_brightness_from_levels(full) == 1.0);
  CHECK(vbc::master_brightness_from_levels(half) > 0.49 && vbc::master_brightness_from_levels(half) < 0.51);
}

void test_rom_identity() {
  const std::string abc = "abc", digits = "123456789";
  const auto* a = reinterpret_cast<const uint8_t*>(abc.data());
  CHECK(vbc::sha1_hex(a, abc.size()) == "a9993e364706816aba3e25717850c26c9cd0d89d");
  CHECK(vbc::crc32_hex(reinterpret_cast<const uint8_t*>(digits.data()), digits.size()) == "cbf43926");
  const vbc::RomIdentity id = vbc::rom_identity(std::vector<uint8_t>(abc.begin(), abc.end()));
  CHECK(vbc::same_rom("A9993E364706816ABA3E25717850C26C9CD0D89D", "", -1, id));
  CHECK(!vbc::same_rom(std::string(40, '0'), id.crc32, 3, id));  // SHA-1 decides when present
  CHECK(vbc::same_rom("", "352441c2", 3, id) && !vbc::same_rom("", "352441c2", 4, id));
}

void test_play_pack_pieces() {
  const std::vector<uint8_t> hello = vbc::base64_decode("aGVs bG8=");
  CHECK(std::string(hello.begin(), hello.end()) == "hello");
  CHECK(vbc::base64_decode("not*base64").empty());
  // A .vbcolor with one tile.
  std::vector<uint8_t> vbcolor = {'V', 'B', 'C', 'L', 1, 0, 2, 0, 'm', 't', 1, 0, 0, 0, 0x78, 0x56, 0x34, 0x12};
  for (int i = 0; i < 256; i++) vbcolor.push_back(static_cast<uint8_t>(i));
  const auto tiles = vbc::parse_vbcolor(vbcolor.data(), vbcolor.size());
  CHECK(tiles.size() == 1 && tiles.count(0x12345678u) && tiles.at(0x12345678u)[255] == 255);
  CHECK(vbc::parse_vbcolor(hello.data(), hello.size()).empty());
  bool threw = false;
  try {
    vbc::load_play_pack(hello);
  } catch (const vbc::PlayPackError& e) {
    threw = std::string(e.what()).find("not a play pack") != std::string::npos;
  }
  CHECK(threw);
}

/** groups.json `gameStates` and a group's `conditions` (src/game-states.js): is / is not, AND, unknown states. */
void test_group_conditions() {
  const std::string text = R"({
    "gameStatePools": [ { "id": "pool-menu", "variants": [ { "id": "d", "ramConditions": [ { "offset": 9, "expectedValue": 5 } ] } ] } ],
    "gameStates": [
      { "id": "luigi", "name": "Luigi is the player", "conditions": [ { "offset": 8212, "value": 2 } ] },
      { "id": "paused", "conditions": [ { "offset": 16, "value": 1 }, { "offset": 17, "value": 7 } ] },
      { "id": "bad", "conditions": [ { "offset": 70000, "value": 1 }, { "offset": 1, "value": 300 } ] }
    ],
    "groups": [
      { "id": "mario", "criteria": {}, "conditions": [ { "state": "luigi", "is": false } ] },
      { "id": "luigi", "criteria": {}, "conditions": [ { "state": "luigi" }, { "state": "paused", "is": false } ] },
      { "id": "ghost", "criteria": {}, "conditions": [ { "state": "bad" }, { "state": "gone" } ] },
      { "id": "both", "criteria": {}, "screens": { "mode": "except", "pools": ["pool-menu"] }, "conditions": [ { "state": "luigi" } ] }
    ]
  })";
  const auto groups = vbc::parse_groups_json(std::vector<uint8_t>(text.begin(), text.end()));
  CHECK(groups.size() == 4);
  CHECK(groups[0].conditions.size() == 1 && !groups[0].conditions[0].is);
  CHECK(groups[1].conditions.size() == 2 && groups[1].conditions[1].bytes.size() == 2);
  CHECK(groups[2].conditions.empty());  // an invalid state and an unknown one are both left out
  std::vector<uint8_t> mario(0x10000, 0), luigi(0x10000, 0), paused(0x10000, 0), menu(0x10000, 0);
  luigi[8212] = 2;
  paused[8212] = 2;
  paused[16] = 1;
  paused[17] = 7;
  menu[8212] = 2;
  menu[9] = 5;
  CHECK(vbc::group_shown_on_screen(groups[0], mario.data(), mario.size()));
  CHECK(!vbc::group_shown_on_screen(groups[0], luigi.data(), luigi.size()));
  CHECK(vbc::group_shown_on_screen(groups[1], luigi.data(), luigi.size()));
  CHECK(!vbc::group_shown_on_screen(groups[1], paused.data(), paused.size()));
  CHECK(!vbc::group_shown_on_screen(groups[1], mario.data(), mario.size()));
  CHECK(vbc::group_shown_on_screen(groups[2], mario.data(), mario.size()));
  CHECK(vbc::group_shown_on_screen(groups[3], luigi.data(), luigi.size()));
  CHECK(!vbc::group_shown_on_screen(groups[3], menu.data(), menu.size()));  // screens and conditions both
  CHECK(vbc::group_shown_on_screen(groups[1], nullptr, 0));                  // unknown memory: shown
}

/** groups.json `screens` (src/screen-gate.js): parsed against the pools, then checked against memory. */
void test_group_screens() {
  const std::string text = R"({
    "gameStatePools": [
      { "id": "pool-menu", "variants": [ { "id": "__default__", "ramConditions": [ { "offset": 8246, "expectedValue": 5 } ] } ] },
      { "id": "pool-game", "variants": [ { "id": "__default__", "ramConditions": { "0x0": 48 } } ] },
      { "id": "pool-none", "variants": [ { "id": "__default__" } ] }
    ],
    "groups": [
      { "id": "plain", "criteria": {} },
      { "id": "koopa", "criteria": {}, "screens": { "mode": "except", "pools": ["pool-menu"] } },
      { "id": "game", "criteria": {}, "screens": { "mode": "only", "pools": [" pool-game", "pool-game", "pool-none"] } },
      { "id": "bad", "criteria": {}, "screens": { "mode": "sometimes", "pools": ["pool-menu"] } }
    ]
  })";
  const auto groups = vbc::parse_groups_json(std::vector<uint8_t>(text.begin(), text.end()));
  CHECK(groups.size() == 4);
  CHECK(!groups[0].screens && !groups[3].screens);
  CHECK(groups[1].screens && !groups[1].screens->only && groups[1].screens->screens.size() == 1);
  CHECK(groups[2].screens && groups[2].screens->only && groups[2].screens->screens.size() == 2);
  std::vector<uint8_t> menu(0x10000, 0), game(0x10000, 0);
  menu[8246] = 5;
  game[0] = 48;
  CHECK(vbc::group_shown_on_screen(groups[0], menu.data(), menu.size()));
  CHECK(!vbc::group_shown_on_screen(groups[1], menu.data(), menu.size()));
  CHECK(vbc::group_shown_on_screen(groups[1], game.data(), game.size()));
  CHECK(vbc::group_shown_on_screen(groups[2], game.data(), game.size()));
  CHECK(!vbc::group_shown_on_screen(groups[2], menu.data(), menu.size()));
  // Unknown memory: everything shows.
  CHECK(vbc::group_shown_on_screen(groups[1], nullptr, 0));
  CHECK(vbc::group_shown_on_screen(groups[2], game.data(), 16));
}

/** Boot a real game for a few seconds: both eyes come out, and the VIP's data with them. */
void test_beetle_smoke() {
  const char* path = std::getenv("VBC_TEST_ROM");
  if (!path || !*path) {
    std::printf("skip Beetle smoke test (set VBC_TEST_ROM to a .vb file)\n");
    return;
  }
  std::ifstream in(path, std::ios::binary);
  std::vector<uint8_t> rom((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  CHECK(!rom.empty());
  auto emu = vbc::create_beetle_emulator();
  std::string error;
  CHECK(emu->load_rom(rom, &error));
  size_t audio = 0;
  size_t most_draws = 0;
  int right_eye_draws = 0;
  for (int i = 0; i < 300; i++) {
    emu->run_frame(i % 60 < 5 ? vbc::Start : 0);
    audio += emu->take_audio().size();
    if (const vbc::VipFrame* v = emu->vip_frame()) {
      most_draws = std::max(most_draws, v->draw_list.size());
      for (const auto& d : v->draw_list) right_eye_draws += d.eye == 1;
    }
  }
  const vbc::VideoFrame video = emu->video();
  std::printf("Beetle smoke: %dx%d video, %zu audio samples, up to %zu draws a frame\n", video.width, video.height, audio, most_draws);
  CHECK(video.width == 768 && video.height == 224);  // both eyes, side by side
  CHECK(audio > 0);
  CHECK(emu->vip_frame() != nullptr);
  CHECK(most_draws > 0);
  CHECK(right_eye_draws > 0);
  const std::vector<uint8_t> state = emu->save_state();
  CHECK(!state.empty());
  CHECK(emu->load_state(state));
  bool threw = false;
  try {
    auto second = vbc::create_beetle_emulator();
  } catch (const std::exception&) {
    threw = true;
  }
  CHECK(threw);  // one core at a time
}

}  // namespace

int main() {
  test_compose_view();
  test_compose_eyes();
  test_brightness();
  test_rom_identity();
  test_play_pack_pieces();
  test_group_screens();
  test_group_conditions();
  test_beetle_smoke();
  std::printf("%d passed, %d failed\n", g_passed, g_failed);
  return g_failed ? 1 : 0;
}
