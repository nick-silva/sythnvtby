# The Beetle VB libretro core, pinned to the commit our VIP export patches target (the same one
# the browser build uses: docs/core/core-build.md), with those patches applied and their
# per-frame hand-off switched to a C callback (cmake/PatchBeetleNative.cmake).
set(VBC_BEETLE_REPO "https://github.com/EmulatorJS/beetle-vb-libretro" CACHE STRING "Beetle VB repository")
set(VBC_BEETLE_TAG "f94d3e8" CACHE STRING "Beetle VB commit our patches apply to")
get_filename_component(VBC_PATCH_DIR "${CMAKE_CURRENT_LIST_DIR}/../../patches" ABSOLUTE)

FetchContent_Declare(beetle_vb
  GIT_REPOSITORY ${VBC_BEETLE_REPO}
  GIT_TAG ${VBC_BEETLE_TAG}
  UPDATE_DISCONNECTED TRUE
  # Beetle has no CMakeLists: fetch it, build it from the list below.
  SOURCE_SUBDIR no-cmake
  PATCH_COMMAND ${CMAKE_COMMAND} -DPATCH_DIR=${VBC_PATCH_DIR} -P ${CMAKE_CURRENT_LIST_DIR}/PatchBeetleNative.cmake
)
FetchContent_MakeAvailable(beetle_vb)

set(B ${beetle_vb_SOURCE_DIR})
# The sources Makefile.common builds for the libretro core.
add_library(beetle_vb STATIC
  ${B}/libretro.cpp
  ${B}/mednafen/mempatcher.cpp
  ${B}/mednafen/hw_cpu/v810/v810_cpu.cpp
  ${B}/mednafen/vb/vsu.c
  ${B}/mednafen/vb/input.c
  ${B}/mednafen/vb/timer.c
  ${B}/mednafen/vb/vip.c
  ${B}/mednafen/hw_cpu/v810/fpu-new/softfloat.c
  ${B}/mednafen/sound/Blip_Buffer.c
  ${B}/mednafen/state.c
  ${B}/mednafen/settings.c
  ${B}/libretro-common/compat/compat_strl.c
  ${B}/libretro-common/compat/compat_snprintf.c
)
target_include_directories(beetle_vb
  PUBLIC
    ${B}/libretro-common/include
    ${CMAKE_CURRENT_LIST_DIR}/../beetle/export
  PRIVATE
    ${B}
    ${B}/mednafen
    ${B}/mednafen/include
    ${B}/mednafen/hw_sound
    ${B}/mednafen/hw_cpu
    ${B}/mednafen/hw_misc
)
target_compile_definitions(beetle_vb PRIVATE
  MEDNAFEN_VERSION="0.9.31" MEDNAFEN_VERSION_NUMERIC=931
  STDC_HEADERS __STDC_LIMIT_MACROS __LIBRETRO__ WANT_32BPP
  VB_NATIVE_EXPORT
  # Beetle's Makefile passes INLINE on the command line (_inline for MSVC).
  $<IF:$<C_COMPILER_ID:MSVC>,INLINE=__inline,INLINE=inline>
  _CRT_SECURE_NO_DEPRECATE _CRT_SECURE_NO_WARNINGS
)
if(MSVC)
  # Third-party code: its warnings are not ours to fix.
  target_compile_options(beetle_vb PRIVATE /W0)
else()
  target_compile_options(beetle_vb PRIVATE -w)
endif()
set_target_properties(beetle_vb PROPERTIES FOLDER "third-party")
