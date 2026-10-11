# sythnvtby, native: the portable core library, the Beetle VB adapter, the SDL2 PC player and
# tests. See native/README.md and docs/design/vb-color-player.md.
cmake_minimum_required(VERSION 3.24)
project(vbcolor_native LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set_property(GLOBAL PROPERTY USE_FOLDERS ON)

option(VBC_BUILD_PLAYER "Build the SDL2 PC player" ON)
option(VBC_BUILD_TESTS "Build the tests" ON)

include(FetchContent)

# Libraries the core reads play packs with (zip, JSON, PNG).
include(cmake/Deps.cmake)
# vbcolor_core: portable — no platform, window or emulator code.
add_subdirectory(core)
# beetle_vb: the patched Beetle VB core as a static library.
include(cmake/BeetleVB.cmake)
# vbcolor_beetle: the Emulator interface over beetle_vb. Another core is another adapter.
add_subdirectory(beetle)

if(VBC_BUILD_PLAYER)
  include(cmake/SDL2.cmake)
  add_subdirectory(player-sdl)
endif()

if(VBC_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
