// sythnvtby Player for PC: runs a Virtual Boy game through the portable core library (vbcolor_core)
// and an emulator behind its Emulator interface (Beetle VB for now), with an SDL2 window,
// controller and audio, and draws the game's colour from a play pack (.vbcplay) over it with the
// library's colour layer. Usage: vbcolor-player <game.vb> [--pack game.vbcplay]
// [--packs-dir folder] [--view 2d|sbs|anaglyph], or drop a ROM on the window. The ROM's play
// pack is found by itself (vbcolor/pack_finder.hpp): the player's choice for that ROM, else
// <game>.vbcplay beside it, else a packs folder. Dropping a pack (or Ctrl+O) chooses it for the
// ROM; F10 goes back to finding one; Shift+F10 plays without colour. Design:
// docs/design/vb-color-player.md. For unattended checks: --frames N runs N frames and quits,
// --screenshot out.bmp saves the last picture, --tap-start presses Start every two seconds.
#include <SDL.h>
#include <SDL_syswm.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "vbcolor/beetle.hpp"
#include "vbcolor/colorizer.hpp"
#include "vbcolor/emulator.hpp"
#include "vbcolor/pack_finder.hpp"
#include "vbcolor/play_pack.hpp"
#include "vbcolor/rom_identity.hpp"
#include "vbcolor/stereo.hpp"

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <commdlg.h>
#endif

namespace fs = std::filesystem;

namespace {

std::optional<std::vector<uint8_t>> read_file(const fs::path& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::nullopt;
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

bool write_file(const fs::path& path, const std::vector<uint8_t>& data) {
  std::ofstream out(path, std::ios::binary);
  if (!out) return false;
  out.write(reinterpret_cast<const char*>(data.data()), static_cast<std::streamsize>(data.size()));
  return static_cast<bool>(out);
}

/** Where battery saves and save states go: the user's app-data folder (SDL's pref path). */
fs::path save_dir() {
  char* p = SDL_GetPrefPath("VBColor", "Player");
  fs::path dir = p ? fs::u8path(p) : fs::current_path();
  SDL_free(p);
  return dir;
}

/** Sleep until `when` (SDL_Delay has millisecond steps; the loop catches up on the next frame). */
void sleep_until(std::chrono::steady_clock::time_point when) {
  const auto now = std::chrono::steady_clock::now();
  if (when > now) SDL_Delay(static_cast<Uint32>(std::chrono::duration_cast<std::chrono::milliseconds>(when - now).count()));
}

/** Keyboard and the first game controller → the Virtual Boy's buttons. */
vbc::ButtonState read_buttons(SDL_GameController* pad) {
  const Uint8* k = SDL_GetKeyboardState(nullptr);
  vbc::ButtonState b = 0;
  auto on = [&](bool down, vbc::Button button) {
    if (down) b = static_cast<vbc::ButtonState>(b | button);
  };
  // Left D-pad: arrows. Right D-pad: I J K L. A: X. B: Z. L: Q. R: W. Start: Enter. Select: Shift.
  on(k[SDL_SCANCODE_UP], vbc::LeftUp);
  on(k[SDL_SCANCODE_DOWN], vbc::LeftDown);
  on(k[SDL_SCANCODE_LEFT], vbc::LeftLeft);
  on(k[SDL_SCANCODE_RIGHT], vbc::LeftRight);
  on(k[SDL_SCANCODE_I], vbc::RightUp);
  on(k[SDL_SCANCODE_K], vbc::RightDown);
  on(k[SDL_SCANCODE_J], vbc::RightLeft);
  on(k[SDL_SCANCODE_L], vbc::RightRight);
  on(k[SDL_SCANCODE_X], vbc::A);
  on(k[SDL_SCANCODE_Z], vbc::B);
  on(k[SDL_SCANCODE_Q], vbc::L);
  on(k[SDL_SCANCODE_W], vbc::R);
  on(k[SDL_SCANCODE_RETURN] && !(SDL_GetModState() & KMOD_ALT), vbc::Start);
  on(k[SDL_SCANCODE_RSHIFT] || k[SDL_SCANCODE_LSHIFT], vbc::Select);
  if (pad) {
    auto btn = [&](SDL_GameControllerButton x) { return SDL_GameControllerGetButton(pad, x) != 0; };
    auto axis = [&](SDL_GameControllerAxis a) { return SDL_GameControllerGetAxis(pad, a); };
    constexpr int kDead = 16000;
    on(btn(SDL_CONTROLLER_BUTTON_DPAD_UP) || axis(SDL_CONTROLLER_AXIS_LEFTY) < -kDead, vbc::LeftUp);
    on(btn(SDL_CONTROLLER_BUTTON_DPAD_DOWN) || axis(SDL_CONTROLLER_AXIS_LEFTY) > kDead, vbc::LeftDown);
    on(btn(SDL_CONTROLLER_BUTTON_DPAD_LEFT) || axis(SDL_CONTROLLER_AXIS_LEFTX) < -kDead, vbc::LeftLeft);
    on(btn(SDL_CONTROLLER_BUTTON_DPAD_RIGHT) || axis(SDL_CONTROLLER_AXIS_LEFTX) > kDead, vbc::LeftRight);
    on(axis(SDL_CONTROLLER_AXIS_RIGHTY) < -kDead, vbc::RightUp);
    on(axis(SDL_CONTROLLER_AXIS_RIGHTY) > kDead, vbc::RightDown);
    on(axis(SDL_CONTROLLER_AXIS_RIGHTX) < -kDead, vbc::RightLeft);
    on(axis(SDL_CONTROLLER_AXIS_RIGHTX) > kDead, vbc::RightRight);
    on(btn(SDL_CONTROLLER_BUTTON_A), vbc::A);
    on(btn(SDL_CONTROLLER_BUTTON_B) || btn(SDL_CONTROLLER_BUTTON_X), vbc::B);
    on(btn(SDL_CONTROLLER_BUTTON_LEFTSHOULDER) || axis(SDL_CONTROLLER_AXIS_TRIGGERLEFT) > kDead, vbc::L);
    on(btn(SDL_CONTROLLER_BUTTON_RIGHTSHOULDER) || axis(SDL_CONTROLLER_AXIS_TRIGGERRIGHT) > kDead, vbc::R);
    on(btn(SDL_CONTROLLER_BUTTON_START), vbc::Start);
    on(btn(SDL_CONTROLLER_BUTTON_BACK), vbc::Select);
  }
  return b;
}

bool is_play_pack(const fs::path& p) {
  std::string ext = p.extension().u8string();
  for (auto& c : ext) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return ext == ".vbcplay";
}

/**
 * Where packs are looked for by ROM: a "packs" folder beside the player (a portable download) and
 * one in the user's app-data folder (made on first run, so there is somewhere to put them).
 */
std::vector<fs::path> default_packs_dirs() {
  std::vector<fs::path> dirs;
  if (char* base = SDL_GetBasePath()) {
    dirs.push_back(fs::u8path(base) / "packs");
    SDL_free(base);
  }
  const fs::path own = save_dir() / "packs";
  std::error_code ec;
  fs::create_directories(own, ec);
  dirs.push_back(own);
  return dirs;
}

/** A file picker for a play pack; nothing where the platform has none (drop a pack instead). */
std::optional<fs::path> ask_for_pack_file(SDL_Window* window) {
#ifdef _WIN32
  SDL_SysWMinfo wm;
  SDL_VERSION(&wm.version);
  HWND owner = SDL_GetWindowWMInfo(window, &wm) ? wm.info.win.window : nullptr;
  wchar_t file[MAX_PATH] = L"";
  OPENFILENAMEW ofn{};
  ofn.lStructSize = sizeof ofn;
  ofn.hwndOwner = owner;
  ofn.lpstrFilter = L"Play packs (*.vbcplay)\0*.vbcplay\0All files\0*.*\0";
  ofn.lpstrFile = file;
  ofn.nMaxFile = MAX_PATH;
  ofn.lpstrTitle = L"Choose a colour pack for this game";
  ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
  if (!GetOpenFileNameW(&ofn)) return std::nullopt;
  return fs::path(file);
#else
  (void)window;
  return std::nullopt;
#endif
}

std::optional<vbc::ViewMode> parse_view(const std::string& s) {
  if (s == "2d" || s == "flat") return vbc::ViewMode::Flat;
  if (s == "sbs" || s == "side-by-side") return vbc::ViewMode::SideBySide;
  if (s == "anaglyph") return vbc::ViewMode::Anaglyph;
  return std::nullopt;
}

/** Unattended runs (tests, screenshots for docs). */
struct AutoRun {
  long frames = -1;  // quit after this many frames; -1 runs until closed
  std::string screenshot;
  bool tap_start = false;
};

class Player {
 public:
  bool init(vbc::ViewMode view, const AutoRun& autorun, std::vector<fs::path> packs_dirs) {
    view_ = view;
    autorun_ = autorun;
    packs_dirs_ = std::move(packs_dirs);
    choices_ = std::make_unique<vbc::PackChoices>(save_dir() / "pack-choices.json");
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_GAMECONTROLLER | SDL_INIT_EVENTS) != 0) {
      std::fprintf(stderr, "SDL could not start: %s\n", SDL_GetError());
      return false;
    }
    window_ = SDL_CreateWindow("sythnvtby Player", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, vbc::kEyeWidth * 3,
                               vbc::kEyeHeight * 3, SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI);
    renderer_ = window_ ? SDL_CreateRenderer(window_, -1, SDL_RENDERER_ACCELERATED) : nullptr;
    if (!renderer_) {
      std::fprintf(stderr, "SDL could not open a window: %s\n", SDL_GetError());
      return false;
    }
    SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "nearest");
    SDL_EventState(SDL_DROPFILE, SDL_ENABLE);
    open_first_controller();
    update_title();
    return true;
  }

  ~Player() {
    stop_game();
    if (pad_) SDL_GameControllerClose(pad_);
    if (texture_) SDL_DestroyTexture(texture_);
    if (renderer_) SDL_DestroyRenderer(renderer_);
    if (window_) SDL_DestroyWindow(window_);
    SDL_Quit();
  }

  /** Start a ROM and colour it with its pack (see the top of this file), unless one is kept from the command line. */
  bool start_game(const fs::path& rom_path) {
    stop_game();
    auto rom = read_file(rom_path);
    if (!rom) {
      report("Could not read " + rom_path.u8string());
      return false;
    }
    emu_ = vbc::create_beetle_emulator();
    std::string error;
    if (!emu_->load_rom(*rom, &error)) {
      report(error);
      emu_.reset();
      return false;
    }
    rom_name_ = rom_path.stem().u8string();
    rom_path_ = rom_path;
    rom_id_ = vbc::rom_identity(*rom);
    if (pack_ && pack_dropped_early_) {
      // A pack dropped before any game: it is the choice for the first one.
      pack_dropped_early_ = false;
      remember_choice(pack_path_);
    } else if (!keep_pack_) {
      use_found_pack();
    }
    check_rom();
    const fs::path dir = save_dir();
    sram_path_ = dir / (rom_name_ + ".srm");
    state_path_ = dir / (rom_name_ + ".state");
    if (auto sram = read_file(sram_path_)) emu_->load_save_ram(*sram);
    open_audio(emu_->sample_rate());
    paused_ = false;
    update_title();
    std::printf("%s: %s, %.2f fps, %.0f Hz audio\n", rom_name_.c_str(), emu_->name().c_str(), emu_->frame_rate(), emu_->sample_rate());
    return true;
  }

  /** A pack named on the command line: used for every game this session, never remembered. */
  bool load_pack_for_session(const fs::path& path) {
    keep_pack_ = true;
    return load_pack(path, "command line");
  }

  /** Use a play pack's colour. The game keeps running; a different ROM gets a warning. */
  bool load_pack(const fs::path& path, const std::string& from) {
    auto bytes = read_file(path);
    if (!bytes) {
      report("Could not read " + path.u8string());
      return false;
    }
    try {
      vbc::PlayPack pack = vbc::load_play_pack(*bytes);
      colorizer_.reset();
      pack_ = std::move(pack);
      colorizer_ = std::make_unique<vbc::Colorizer>(*pack_);
    } catch (const vbc::PlayPackError& e) {
      report(e.what());
      return false;
    }
    colour_on_ = true;
    warned_rom_ = false;
    chose_no_colour_ = false;
    pack_path_ = path;
    pack_from_ = from;
    std::printf("Play pack (%s): %s, %s (%zu groups, %zu tile colours)\n", from.c_str(), pack_->info.title.c_str(),
                path.u8string().c_str(), pack_->groups.size(), pack_->tile_colors.size());
    if (pack_->unsupported_overrides || pack_->unsupported_v2_rules || pack_->unsupported_overlays) {
      std::fprintf(stderr, "This pack uses position overrides, Painter v2 rules or old overlays, which this player does not draw yet.\n");
    }
    check_rom();
    update_title();
    return true;
  }

  void run() {
    using clock = std::chrono::steady_clock;
    auto next = clock::now();
    bool running = true;
    while (running) {
      SDL_Event e;
      while (SDL_PollEvent(&e)) running = handle(e) && running;
      if (!running) break;
      const double fps = emu_ ? emu_->frame_rate() : 60.0;
      const auto frame = std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>(1.0 / fps));
      if (emu_ && !paused_) {
        vbc::ButtonState buttons = read_buttons(pad_);
        if (autorun_.tap_start && frames_run_ % 100 < 6) buttons = static_cast<vbc::ButtonState>(buttons | vbc::Start);
        emu_->run_frame(buttons);
        frames_run_++;
        queue_audio();
      }
      present();
      if (autorun_.frames >= 0 && frames_run_ >= autorun_.frames) {
        if (!autorun_.screenshot.empty()) save_screenshot(autorun_.screenshot);
        break;
      }
      // Pace to the game's frame rate; let the audio queue pull ahead a little, never far.
      next += frame;
      const auto now = clock::now();
      if (next < now - frame * 4) next = now;
      if (audio_ && SDL_GetQueuedAudioSize(audio_) > audio_bytes_per_frame_ * 6) next += frame;
      sleep_until(next);
    }
  }

 private:
  // --- which pack colours the game ------------------------------------------------------------

  /** The pack the finder picks for this ROM: the player's choice, beside the game, a packs folder. */
  void use_found_pack() {
    const vbc::FoundPack found = vbc::find_play_pack(rom_path_, rom_id_, packs_dirs_, *choices_);
    for (const auto& note : found.notes) warn(note);
    if (found.source != vbc::PackSource::None && load_pack(found.path, vbc::pack_source_name(found.source))) return;
    unload_pack();
    chose_no_colour_ = found.chose_none;
    std::printf(chose_no_colour_ ? "%s: no colour (your choice; F10 finds a pack again)\n" : "%s: no play pack found for this ROM\n",
                rom_name_.c_str());
  }

  /** A pack dropped on the window or picked with Ctrl+O: use it, and remember it for this ROM. */
  void choose_pack(const fs::path& path) {
    if (!emu_) {
      // No game yet: it becomes the first game's choice.
      if (load_pack(path, "your choice")) pack_dropped_early_ = true;
      update_title();
      return;
    }
    keep_pack_ = false;
    if (!load_pack(path, "your choice")) return;
    remember_choice(path);
  }

  void remember_choice(const fs::path& path) {
    pack_from_ = "your choice";
    if (choices_->choose_pack(rom_id_.sha1, path)) {
      std::printf("Remembered %s for %s. F10 goes back to finding a pack by itself.\n", path.filename().u8string().c_str(), rom_name_.c_str());
    } else {
      warn("Could not save the pack choice (" + save_dir().u8string() + "); it holds until the player closes.");
    }
    update_title();
  }

  /** F10: forget this ROM's choice and find its pack again. */
  void find_pack_again() {
    if (!emu_) return;
    keep_pack_ = false;
    choices_->forget(rom_id_.sha1);
    use_found_pack();
    check_rom();
    update_title();
  }

  /** Shift+F10: this ROM plays without colour, remembered. */
  void choose_no_colour() {
    if (!emu_) return;
    keep_pack_ = false;
    if (!choices_->choose_none(rom_id_.sha1)) warn("Could not save the choice (" + save_dir().u8string() + ").");
    unload_pack();
    chose_no_colour_ = true;
    update_title();
  }

  void unload_pack() {
    colorizer_.reset();
    pack_.reset();
    pack_path_.clear();
    pack_from_.clear();
    pack_dropped_early_ = false;
  }

  // --- events -----------------------------------------------------------------------------------

  bool handle(const SDL_Event& e) {
    switch (e.type) {
      case SDL_QUIT:
        return false;
      case SDL_DROPFILE: {
        const fs::path path = fs::u8path(e.drop.file);
        SDL_free(e.drop.file);
        if (is_play_pack(path)) choose_pack(path);
        else start_game(path);
        return true;
      }
      case SDL_CONTROLLERDEVICEADDED:
        if (!pad_) open_first_controller();
        return true;
      case SDL_KEYDOWN:
        return on_key(e.key);
      default:
        return true;
    }
  }

  bool on_key(const SDL_KeyboardEvent& k) {
    if (k.repeat) return true;
    const bool alt = (k.keysym.mod & KMOD_ALT) != 0;
    const bool ctrl = (k.keysym.mod & KMOD_CTRL) != 0;
    switch (k.keysym.sym) {
      case SDLK_ESCAPE:
        if (SDL_GetWindowFlags(window_) & SDL_WINDOW_FULLSCREEN_DESKTOP) {
          SDL_SetWindowFullscreen(window_, 0);
          return true;
        }
        return false;
      case SDLK_F11:
        toggle_fullscreen();
        return true;
      case SDLK_RETURN:
        if (alt) toggle_fullscreen();
        return true;
      case SDLK_F9:
        if (colorizer_) {
          colour_on_ = !colour_on_;
          update_title();
        }
        return true;
      case SDLK_F10:
        if (k.keysym.mod & KMOD_SHIFT) choose_no_colour();
        else find_pack_again();
        return true;
      case SDLK_o:
        if (ctrl) {
          if (auto path = ask_for_pack_file(window_)) choose_pack(*path);
#ifndef _WIN32
          else std::printf("Drop a play pack (.vbcplay) on the window to choose it.\n");
#endif
        }
        return true;
      case SDLK_v:
        view_ = vbc::next_view_mode(view_);
        update_title();
        return true;
      case SDLK_p:
        paused_ = !paused_;
        update_title();
        return true;
      case SDLK_r:
        if (ctrl && emu_) emu_->reset();
        return true;
      case SDLK_F5:
        if (emu_) {
          const bool ok = write_file(state_path_, emu_->save_state());
          std::printf(ok ? "Saved state: %s\n" : "Could not save state: %s\n", state_path_.u8string().c_str());
        }
        return true;
      case SDLK_F7:
        if (emu_) {
          auto data = read_file(state_path_);
          const bool ok = data && emu_->load_state(*data);
          std::printf(ok ? "Loaded state: %s\n" : "No state to load: %s\n", state_path_.u8string().c_str());
        }
        return true;
      default:
        return true;
    }
  }

  void toggle_fullscreen() {
    const bool full = (SDL_GetWindowFlags(window_) & SDL_WINDOW_FULLSCREEN_DESKTOP) != 0;
    SDL_SetWindowFullscreen(window_, full ? 0 : SDL_WINDOW_FULLSCREEN_DESKTOP);
  }

  void present() {
    SDL_SetRenderDrawColor(renderer_, 0, 0, 0, 255);
    SDL_RenderClear(renderer_);
    if (emu_) {
      vbc::compose_view(emu_->video(), view_, image_);
      // The colour layer over the original picture: unpainted pixels let the picture show.
      const vbc::VipFrame* vip = emu_->vip_frame();
      if (colour_on_ && colorizer_ && vip) {
        // Groups limited to some screens follow the game's memory (src/screen-gate.js).
        const uint8_t* wram = emu_->system_ram();
        colorizer_->set_system_ram(wram, wram ? 0x10000 : 0);
        colorizer_->render(*vip, left_colour_, right_colour_);
        vbc::compose_color(left_colour_.image, right_colour_.image, view_, colour_image_);
        vbc::overlay(image_, colour_image_);
      }
      if (!texture_ || tex_w_ != image_.width || tex_h_ != image_.height) {
        if (texture_) SDL_DestroyTexture(texture_);
        texture_ = SDL_CreateTexture(renderer_, SDL_PIXELFORMAT_ARGB8888, SDL_TEXTUREACCESS_STREAMING, image_.width, image_.height);
        tex_w_ = image_.width;
        tex_h_ = image_.height;
      }
      SDL_UpdateTexture(texture_, nullptr, image_.pixels.data(), image_.width * 4);
      // As large as the window allows, keeping the picture's shape.
      int ww = 0, wh = 0;
      SDL_GetRendererOutputSize(renderer_, &ww, &wh);
      const double scale = std::min(static_cast<double>(ww) / image_.width, static_cast<double>(wh) / image_.height);
      SDL_Rect dst;
      dst.w = static_cast<int>(image_.width * scale);
      dst.h = static_cast<int>(image_.height * scale);
      dst.x = (ww - dst.w) / 2;
      dst.y = (wh - dst.h) / 2;
      SDL_RenderCopy(renderer_, texture_, nullptr, &dst);
    }
    SDL_RenderPresent(renderer_);
  }

  void save_screenshot(const std::string& path) {
    SDL_Surface* s = SDL_CreateRGBSurfaceWithFormatFrom(image_.pixels.data(), image_.width, image_.height, 32, image_.width * 4,
                                                        SDL_PIXELFORMAT_ARGB8888);
    if (!s || SDL_SaveBMP(s, path.c_str()) != 0) std::fprintf(stderr, "Could not save %s: %s\n", path.c_str(), SDL_GetError());
    else std::printf("Saved %s (%dx%d)\n", path.c_str(), image_.width, image_.height);
    if (s) SDL_FreeSurface(s);
  }

  void open_audio(double rate) {
    if (audio_) SDL_CloseAudioDevice(audio_);
    SDL_AudioSpec want{};
    SDL_AudioSpec have{};
    want.freq = static_cast<int>(rate + 0.5);
    want.format = AUDIO_S16SYS;
    want.channels = 2;
    want.samples = 1024;
    audio_ = SDL_OpenAudioDevice(nullptr, 0, &want, &have, 0);
    if (!audio_) {
      std::fprintf(stderr, "No audio: %s\n", SDL_GetError());
      return;
    }
    audio_bytes_per_frame_ = static_cast<Uint32>(rate / (emu_ ? emu_->frame_rate() : 50.0)) * 4;
    SDL_PauseAudioDevice(audio_, 0);
  }

  void queue_audio() {
    std::vector<int16_t> samples = emu_->take_audio();
    if (!audio_ || samples.empty()) return;
    // Never let latency grow without bound if the machine falls behind.
    if (SDL_GetQueuedAudioSize(audio_) > audio_bytes_per_frame_ * 12) SDL_ClearQueuedAudio(audio_);
    SDL_QueueAudio(audio_, samples.data(), static_cast<Uint32>(samples.size() * sizeof(int16_t)));
  }

  void stop_game() {
    if (!emu_) return;
    const std::vector<uint8_t> sram = emu_->save_ram();
    if (!sram.empty() && !write_file(sram_path_, sram)) {
      std::fprintf(stderr, "Could not write the battery save %s\n", sram_path_.u8string().c_str());
    }
    if (audio_) {
      SDL_CloseAudioDevice(audio_);
      audio_ = 0;
    }
    emu_.reset();
  }

  void open_first_controller() {
    for (int i = 0; i < SDL_NumJoysticks(); i++) {
      if (SDL_IsGameController(i)) {
        pad_ = SDL_GameControllerOpen(i);
        if (pad_) return;
      }
    }
  }

  void check_rom() {
    if (!pack_ || !emu_ || warned_rom_) return;
    const auto& i = pack_->info;
    if (vbc::same_rom(i.rom_sha1, i.rom_crc32, i.rom_size, rom_id_)) return;
    warned_rom_ = true;
    const std::string made_for = i.rom_file_name.empty() ? std::string() : ", made for " + i.rom_file_name;
    const std::string msg = rom_name_ + " is not the ROM " + i.title + " was made for" + made_for + ". The colours may land on the wrong tiles.";
    std::fprintf(stderr, "%s\n", msg.c_str());
    if (autorun_.frames < 0) SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_WARNING, "sythnvtby Player", msg.c_str(), window_);
  }

  void update_title() {
    std::string t = "sythnvtby Player";
    if (emu_) t += " - " + (pack_ ? pack_->info.title : rom_name_);
    else t += " - drop a Virtual Boy ROM (.vb) here";
    if (pack_) t += (colour_on_ ? " - Colour (F9), " : " - Monochrome (F9), ") + pack_from_;
    else if (emu_ && chose_no_colour_) t += " - no colour (your choice, F10 finds a pack)";
    else if (emu_) t += " - no colour pack found (drop one here, or Ctrl+O)";
    t += std::string(" - ") + vbc::view_mode_name(view_) + " (V)";
    if (paused_) t += " - paused (P)";
    SDL_SetWindowTitle(window_, t.c_str());
  }

  void report(const std::string& message) {
    std::fprintf(stderr, "%s\n", message.c_str());
    // Unattended runs must never wait on a dialog.
    if (autorun_.frames < 0) SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "sythnvtby Player", message.c_str(), window_);
  }

  void warn(const std::string& message) {
    std::fprintf(stderr, "%s\n", message.c_str());
    if (autorun_.frames < 0) SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_WARNING, "sythnvtby Player", message.c_str(), window_);
  }

  SDL_Window* window_ = nullptr;
  SDL_Renderer* renderer_ = nullptr;
  SDL_Texture* texture_ = nullptr;
  int tex_w_ = 0;
  int tex_h_ = 0;
  SDL_GameController* pad_ = nullptr;
  SDL_AudioDeviceID audio_ = 0;
  Uint32 audio_bytes_per_frame_ = 4096;
  std::unique_ptr<vbc::Emulator> emu_;
  vbc::Image image_;
  vbc::ViewMode view_ = vbc::ViewMode::Flat;
  AutoRun autorun_;
  long frames_run_ = 0;
  bool paused_ = false;
  std::string rom_name_;
  fs::path rom_path_;
  vbc::RomIdentity rom_id_;
  std::vector<fs::path> packs_dirs_;
  std::unique_ptr<vbc::PackChoices> choices_;
  fs::path pack_path_;
  std::string pack_from_;            // where the pack came from, for the title bar
  bool keep_pack_ = false;           // a --pack: kept for every game this session
  bool pack_dropped_early_ = false;  // dropped before any game: the first game's choice
  bool chose_no_colour_ = false;
  std::optional<vbc::PlayPack> pack_;
  std::unique_ptr<vbc::Colorizer> colorizer_;
  vbc::EyeColor left_colour_;
  vbc::EyeColor right_colour_;
  vbc::Image colour_image_;
  bool colour_on_ = true;
  bool warned_rom_ = false;
  fs::path sram_path_;
  fs::path state_path_;
};

}  // namespace

int main(int argc, char** argv) {
  SDL_SetMainReady();
  std::optional<fs::path> rom;
  std::optional<fs::path> pack;
  vbc::ViewMode view = vbc::ViewMode::Flat;
  AutoRun autorun;
  std::vector<fs::path> packs_dirs;
  for (int i = 1; i < argc; i++) {
    const std::string arg = argv[i];
    if (arg == "--view" && i + 1 < argc) {
      if (auto v = parse_view(argv[++i])) view = *v;
      else std::fprintf(stderr, "Unknown view %s (2d, sbs, anaglyph)\n", argv[i]);
    } else if (arg == "--pack" && i + 1 < argc) {
      pack = fs::u8path(argv[++i]);
    } else if (arg == "--packs-dir" && i + 1 < argc) {
      packs_dirs.push_back(fs::u8path(argv[++i]));
    } else if (arg == "--frames" && i + 1 < argc) {
      autorun.frames = std::atol(argv[++i]);
    } else if (arg == "--screenshot" && i + 1 < argc) {
      autorun.screenshot = argv[++i];
    } else if (arg == "--tap-start") {
      autorun.tap_start = true;
    } else if (arg == "--help" || arg == "-h") {
      std::printf(
          "Usage: vbcolor-player <game.vb> [--pack game.vbcplay] [--packs-dir folder] [--view 2d|sbs|anaglyph]\n"
          "                      [--frames N] [--screenshot out.bmp] [--tap-start]\n"
          "Without --pack, the game's colour pack is found by itself: your choice for that ROM, else\n"
          "<game>.vbcplay beside it, else any pack made for it in a packs folder (--packs-dir, the\n"
          "'packs' folder beside the player, and %s).\n",
          (save_dir() / "packs").u8string().c_str());
      return 0;
    } else if (is_play_pack(fs::u8path(arg))) {
      pack = fs::u8path(arg);
    } else {
      rom = fs::u8path(arg);
    }
  }
  for (auto& dir : default_packs_dirs()) packs_dirs.push_back(std::move(dir));
  Player player;
  if (!player.init(view, autorun, std::move(packs_dirs))) return 1;
  if (pack && !player.load_pack_for_session(*pack)) return 1;
  if (rom && !player.start_game(*rom)) return 1;
  player.run();
  return 0;
}
