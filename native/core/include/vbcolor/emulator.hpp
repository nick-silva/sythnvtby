#pragma once
// The emulator a front end runs. Beetle VB is one (vbcolor_beetle); another core is another
// implementation of this interface, and nothing else changes.
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "vbcolor/buttons.hpp"
#include "vbcolor/video.hpp"
#include "vbcolor/vip_frame.hpp"

namespace vbc {

class Emulator {
 public:
  virtual ~Emulator() = default;

  /** For logs and the about box, e.g. "Beetle VB (Mednafen 0.9.31)". */
  virtual std::string name() const = 0;

  /** Start a game. False with `error` set when the core refuses it. */
  virtual bool load_rom(const std::vector<uint8_t>& rom, std::string* error) = 0;

  /** Run one frame with this controller state. */
  virtual void run_frame(ButtonState buttons) = 0;

  /** The last frame: both eyes side by side. */
  virtual VideoFrame video() const = 0;

  /** Audio since the last call: interleaved stereo, signed 16-bit. */
  virtual std::vector<int16_t> take_audio() = 0;
  virtual double sample_rate() const = 0;
  virtual double frame_rate() const = 0;

  /** The VIP's data for the last frame, for the colour layer; null when the core cannot say. */
  virtual const VipFrame* vip_frame() const = 0;

  /**
   * The game's 64 KiB of work RAM, for recognising which screen is showing (groups limited to some
   * screens); null when the core cannot say. Valid until the next frame.
   */
  virtual const uint8_t* system_ram() const { return nullptr; }

  /** Cartridge save RAM (battery saves). */
  virtual std::vector<uint8_t> save_ram() const = 0;
  virtual bool load_save_ram(const std::vector<uint8_t>& data) = 0;

  /** Save states. */
  virtual std::vector<uint8_t> save_state() const = 0;
  virtual bool load_state(const std::vector<uint8_t>& data) = 0;

  virtual void reset() = 0;
};

}  // namespace vbc
