# The portable core library: no platform, window or emulator code, so every front end (SDL2 on
# PC, OpenXR, Switch) and every core (Beetle now, our own later) shares it.
add_library(vbcolor_core STATIC
  src/stereo.cpp
  src/vip_frame.cpp
  src/rom_identity.cpp
  src/play_pack.cpp
  src/pack_finder.cpp
  src/vip_state_json.cpp
  src/colorizer.cpp
)
target_include_directories(vbcolor_core PUBLIC include PRIVATE src ${VBC_SINGLE_HEADERS})
target_link_libraries(vbcolor_core PRIVATE miniz)
if(MSVC)
  target_compile_options(vbcolor_core PRIVATE /W4 /bigobj)
else()
  target_compile_options(vbcolor_core PRIVATE -Wall -Wextra)
endif()
