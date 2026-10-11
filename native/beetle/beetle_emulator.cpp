// Beetle VB as a vbc::Emulator: a small libretro front end around the statically linked core.
#include "vbcolor/beetle.hpp"

#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <stdexcept>

#include "libretro.h"
#include "vb_native_export.h"

namespace vbc {
namespace {

static_assert(sizeof(vb_native_draw_call) == 12, "draw call layout must match the core's VB_DrawCall");

class BeetleEmulator;
/** The one running instance: libretro callbacks have no user pointer. */
BeetleEmulator* g_instance = nullptr;

/** Our buttons → the core's libretro joypad ids (libretro.cpp's input descriptors). */
struct ButtonMap {
  Button button;
  unsigned id;
};
constexpr ButtonMap kButtonMap[] = {
    {LeftUp, RETRO_DEVICE_ID_JOYPAD_UP},     {LeftDown, RETRO_DEVICE_ID_JOYPAD_DOWN},
    {LeftLeft, RETRO_DEVICE_ID_JOYPAD_LEFT}, {LeftRight, RETRO_DEVICE_ID_JOYPAD_RIGHT},
    {RightUp, RETRO_DEVICE_ID_JOYPAD_L2},    {RightDown, RETRO_DEVICE_ID_JOYPAD_L3},
    {RightLeft, RETRO_DEVICE_ID_JOYPAD_R2},  {RightRight, RETRO_DEVICE_ID_JOYPAD_R3},
    {A, RETRO_DEVICE_ID_JOYPAD_A},           {B, RETRO_DEVICE_ID_JOYPAD_B},
    {L, RETRO_DEVICE_ID_JOYPAD_L},           {R, RETRO_DEVICE_ID_JOYPAD_R},
    {Start, RETRO_DEVICE_ID_JOYPAD_START},   {Select, RETRO_DEVICE_ID_JOYPAD_SELECT},
};

class BeetleEmulator final : public Emulator {
 public:
  BeetleEmulator() {
    if (g_instance) throw std::runtime_error("Only one Beetle VB core can run at a time");
    g_instance = this;
    retro_set_environment(&BeetleEmulator::environment);
    retro_set_video_refresh(&BeetleEmulator::video_refresh);
    retro_set_audio_sample(&BeetleEmulator::audio_sample);
    retro_set_audio_sample_batch(&BeetleEmulator::audio_sample_batch);
    retro_set_input_poll(&BeetleEmulator::input_poll);
    retro_set_input_state(&BeetleEmulator::input_state);
    vb_native_set_frame_callback(&BeetleEmulator::on_vip_frame, this);
    retro_init();
  }

  ~BeetleEmulator() override {
    if (loaded_) retro_unload_game();
    retro_deinit();
    vb_native_set_frame_callback(nullptr, nullptr);
    g_instance = nullptr;
  }

  std::string name() const override { return "Beetle VB (Mednafen 0.9.31)"; }

  bool load_rom(const std::vector<uint8_t>& rom, std::string* error) override {
    if (loaded_) {
      retro_unload_game();
      loaded_ = false;
    }
    retro_game_info info{};
    info.path = "game.vb";
    info.data = rom.data();
    info.size = rom.size();
    if (!retro_load_game(&info)) {
      if (error) *error = "Beetle VB could not load this ROM";
      return false;
    }
    retro_system_av_info av{};
    retro_get_system_av_info(&av);
    sample_rate_ = av.timing.sample_rate > 0 ? av.timing.sample_rate : 44100.0;
    frame_rate_ = av.timing.fps > 0 ? av.timing.fps : 50.27;
    loaded_ = true;
    return true;
  }

  void run_frame(ButtonState buttons) override {
    if (!loaded_) return;
    buttons_ = buttons;
    retro_run();
  }

  VideoFrame video() const override {
    VideoFrame f;
    f.width = video_w_;
    f.height = video_h_;
    f.pitch = static_cast<size_t>(video_w_);
    f.pixels = video_.empty() ? nullptr : video_.data();
    return f;
  }

  std::vector<int16_t> take_audio() override {
    std::vector<int16_t> out;
    out.swap(audio_);
    return out;
  }
  double sample_rate() const override { return sample_rate_; }
  double frame_rate() const override { return frame_rate_; }

  const VipFrame* vip_frame() const override { return has_vip_ ? &vip_ : nullptr; }

  const uint8_t* system_ram() const override {
    if (!loaded_ || retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM) < 0x10000) return nullptr;
    return static_cast<const uint8_t*>(retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM));
  }

  std::vector<uint8_t> save_ram() const override {
    const auto* p = static_cast<const uint8_t*>(retro_get_memory_data(RETRO_MEMORY_SAVE_RAM));
    const size_t n = retro_get_memory_size(RETRO_MEMORY_SAVE_RAM);
    return p && n ? std::vector<uint8_t>(p, p + n) : std::vector<uint8_t>{};
  }

  bool load_save_ram(const std::vector<uint8_t>& data) override {
    auto* p = static_cast<uint8_t*>(retro_get_memory_data(RETRO_MEMORY_SAVE_RAM));
    const size_t n = retro_get_memory_size(RETRO_MEMORY_SAVE_RAM);
    if (!p || !n || data.size() != n) return false;
    std::memcpy(p, data.data(), n);
    return true;
  }

  std::vector<uint8_t> save_state() const override {
    std::vector<uint8_t> out(retro_serialize_size());
    if (out.empty() || !retro_serialize(out.data(), out.size())) return {};
    return out;
  }

  bool load_state(const std::vector<uint8_t>& data) override {
    return !data.empty() && retro_unserialize(data.data(), data.size());
  }

  void reset() override {
    if (loaded_) retro_reset();
  }

 private:
  // ---------------------------------------------------------------- libretro callbacks

  static bool environment(unsigned cmd, void* data) {
    switch (cmd) {
      case RETRO_ENVIRONMENT_GET_VARIABLE: {
        auto* var = static_cast<retro_variable*>(data);
        var->value = nullptr;
        if (!var->key) return false;
        // Both eyes, side by side: the front end lays them out (vbcolor/stereo.hpp).
        if (!std::strcmp(var->key, "vb_3dmode")) var->value = "side-by-side";
        else if (!std::strcmp(var->key, "vb_anaglyph_preset")) var->value = "disabled";
        // The original red picture (the core's default; unanswered, it draws grey).
        else if (!std::strcmp(var->key, "vb_color_mode")) var->value = "black & red";
        return var->value != nullptr;
      }
      case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
        *static_cast<bool*>(data) = false;
        return true;
      case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
        return *static_cast<const retro_pixel_format*>(data) == RETRO_PIXEL_FORMAT_XRGB8888;
      case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
      case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
        *static_cast<const char**>(data) = ".";
        return true;
      case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
        static_cast<retro_log_callback*>(data)->log = &BeetleEmulator::log;
        return true;
      case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
        *static_cast<unsigned*>(data) = 0;
        return true;
      case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
      case RETRO_ENVIRONMENT_SET_VARIABLES:
      case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
      case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
        return true;
      default:
        return false;
    }
  }

  static void log(enum retro_log_level level, const char* fmt, ...) {
    if (level < RETRO_LOG_WARN) return;
    va_list args;
    va_start(args, fmt);
    std::fputs("[Beetle VB] ", stderr);
    std::vfprintf(stderr, fmt, args);
    va_end(args);
  }

  static void video_refresh(const void* data, unsigned width, unsigned height, size_t pitch) {
    BeetleEmulator* self = g_instance;
    if (!self || !data) return;  // null: the core repeats the last frame
    self->video_w_ = static_cast<int>(width);
    self->video_h_ = static_cast<int>(height);
    self->video_.resize(static_cast<size_t>(width) * height);
    const auto* src = static_cast<const uint8_t*>(data);
    for (unsigned y = 0; y < height; y++) {
      std::memcpy(self->video_.data() + static_cast<size_t>(y) * width, src + y * pitch, width * sizeof(uint32_t));
    }
  }

  static void audio_sample(int16_t left, int16_t right) {
    if (!g_instance) return;
    g_instance->audio_.push_back(left);
    g_instance->audio_.push_back(right);
  }

  static size_t audio_sample_batch(const int16_t* data, size_t frames) {
    if (g_instance) g_instance->audio_.insert(g_instance->audio_.end(), data, data + frames * 2);
    return frames;
  }

  static void input_poll() {}

  static int16_t input_state(unsigned port, unsigned device, unsigned /*index*/, unsigned id) {
    if (!g_instance || port != 0 || device != RETRO_DEVICE_JOYPAD) return 0;
    const ButtonState b = g_instance->buttons_;
    if (id == RETRO_DEVICE_ID_JOYPAD_MASK) {
      int mask = 0;
      for (const auto& m : kButtonMap) {
        if (b & m.button) mask |= 1 << m.id;
      }
      return static_cast<int16_t>(mask);
    }
    for (const auto& m : kButtonMap) {
      if (m.id == id) return (b & m.button) ? 1 : 0;
    }
    return 0;
  }

  static void on_vip_frame(const vb_native_frame* f, void* user) {
    auto* self = static_cast<BeetleEmulator*>(user);
    VipFrame& v = self->vip_;
    v.frame_number = f->frame_number;
    std::memcpy(v.pattern_table.data(), f->chr_ram, std::min<size_t>(f->chr_ram_size, v.pattern_table.size()));
    std::memcpy(v.display_ram.data(), f->dram, std::min<size_t>(f->dram_size, v.display_ram.size()));
    v.draw_list.resize(f->draw_call_count);
    const auto* base = reinterpret_cast<const uint8_t*>(f->draw_calls);
    for (uint32_t i = 0; i < f->draw_call_count; i++) {
      const auto* c = reinterpret_cast<const vb_native_draw_call*>(base + static_cast<size_t>(i) * f->draw_call_stride);
      DrawCall& d = v.draw_list[i];
      d.tile = c->tile;
      d.x = c->x;
      d.y = c->y;
      d.flip_h = (c->flags & 1) != 0;
      d.flip_v = (c->flags & 2) != 0;
      d.world = c->world;
      d.eye = c->eye;
      d.layer = c->layer;
      d.palette = static_cast<uint8_t>(c->palette & 3);
      d.strip = c->strip;
    }
    for (int i = 0; i < 4; i++) v.gplt[static_cast<size_t>(i)] = f->gplt[i];
    v.has_gplt = true;
    v.master_brightness = master_brightness_from_levels(f->brightness_cache);
    v.has_master_brightness = true;
    v.core_patch_level = 3;  // the edge-tiles patch: cut tiles are in the draw list
    self->has_vip_ = true;
  }

  bool loaded_ = false;
  ButtonState buttons_ = 0;
  std::vector<uint32_t> video_;
  int video_w_ = 0;
  int video_h_ = 0;
  std::vector<int16_t> audio_;
  double sample_rate_ = 44100.0;
  double frame_rate_ = 50.27;
  VipFrame vip_;
  bool has_vip_ = false;
};

}  // namespace

std::unique_ptr<Emulator> create_beetle_emulator() { return std::make_unique<BeetleEmulator>(); }

}  // namespace vbc
