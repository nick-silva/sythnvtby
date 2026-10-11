# SDL2 for the PC player: an installed SDL2 when CMake finds one, else the official prebuilt
# Visual C++ package (Windows) or SDL built from source (elsewhere).
set(VBC_SDL2_VERSION "2.30.9" CACHE STRING "SDL2 version to fetch when none is installed")
find_package(SDL2 CONFIG QUIET)
if(NOT SDL2_FOUND)
  if(MSVC)
    # Unpacked where it lands, not moved: FetchContent's extract-then-rename step fails when
    # antivirus still holds the new files.
    set(_sdl2_root "${CMAKE_BINARY_DIR}/_deps/sdl2-${VBC_SDL2_VERSION}-vc")
    set(_sdl2_dir "${_sdl2_root}/SDL2-${VBC_SDL2_VERSION}")
    if(NOT EXISTS "${_sdl2_dir}/cmake/sdl2-config.cmake")
      set(_sdl2_zip "${_sdl2_root}/SDL2-devel-${VBC_SDL2_VERSION}-VC.zip")
      message(STATUS "Downloading SDL2 ${VBC_SDL2_VERSION} (Visual C++ package)")
      file(DOWNLOAD
        "https://github.com/libsdl-org/SDL/releases/download/release-${VBC_SDL2_VERSION}/SDL2-devel-${VBC_SDL2_VERSION}-VC.zip"
        "${_sdl2_zip}" STATUS _sdl2_status)
      list(GET _sdl2_status 0 _sdl2_code)
      if(NOT _sdl2_code EQUAL 0)
        message(FATAL_ERROR "Could not download SDL2: ${_sdl2_status}")
      endif()
      file(ARCHIVE_EXTRACT INPUT "${_sdl2_zip}" DESTINATION "${_sdl2_root}")
    endif()
    set(SDL2_DIR "${_sdl2_dir}/cmake")
    find_package(SDL2 CONFIG REQUIRED)
  else()
    set(SDL_TEST OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(SDL2
      GIT_REPOSITORY https://github.com/libsdl-org/SDL
      GIT_TAG release-${VBC_SDL2_VERSION})
    FetchContent_MakeAvailable(SDL2)
  endif()
endif()
