# Small libraries the portable core uses to read play packs: miniz (zip), nlohmann/json (JSON),
# stb_image (PNG). Single headers are downloaded once into the build tree.
FetchContent_Declare(miniz
  GIT_REPOSITORY https://github.com/richgel999/miniz
  GIT_TAG 3.0.2
  UPDATE_DISCONNECTED TRUE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_FUZZERS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(INSTALL_PROJECT OFF CACHE BOOL "" FORCE)
# miniz 3.0.2 asks for CMake 3.4, which CMake 4 no longer accepts as a minimum.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)
FetchContent_MakeAvailable(miniz)
unset(CMAKE_POLICY_VERSION_MINIMUM)
if(TARGET miniz)
  set_target_properties(miniz PROPERTIES FOLDER "third-party")
endif()

set(VBC_SINGLE_HEADERS "${CMAKE_BINARY_DIR}/_deps/single-headers")
function(vbc_fetch_header url relpath)
  set(dest "${VBC_SINGLE_HEADERS}/${relpath}")
  if(NOT EXISTS "${dest}")
    message(STATUS "Downloading ${relpath}")
    file(DOWNLOAD "${url}" "${dest}" STATUS st)
    list(GET st 0 code)
    if(NOT code EQUAL 0)
      file(REMOVE "${dest}")
      message(FATAL_ERROR "Could not download ${url}: ${st}")
    endif()
  endif()
endfunction()
vbc_fetch_header("https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp" "nlohmann/json.hpp")
vbc_fetch_header("https://raw.githubusercontent.com/nothings/stb/f58f558c120e9b32c217290b80bad1a0729fbb2c/stb_image.h" "stb_image.h")
