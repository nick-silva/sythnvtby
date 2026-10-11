#pragma once
#include <memory>

#include "vbcolor/emulator.hpp"

namespace vbc {

/**
 * Beetle VB (Mednafen), linked in as a libretro core. One at a time: the core keeps its state in
 * globals, so a second one throws std::runtime_error while the first exists.
 */
std::unique_ptr<Emulator> create_beetle_emulator();

}  // namespace vbc
