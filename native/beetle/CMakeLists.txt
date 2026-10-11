# The Emulator interface over the patched Beetle VB core.
add_library(vbcolor_beetle STATIC beetle_emulator.cpp)
target_include_directories(vbcolor_beetle PUBLIC include)
target_link_libraries(vbcolor_beetle PUBLIC vbcolor_core PRIVATE beetle_vb)
if(MSVC)
  target_compile_options(vbcolor_beetle PRIVATE /W4)
endif()
