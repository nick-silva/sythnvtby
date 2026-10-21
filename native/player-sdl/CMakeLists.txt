# The PC player: SDL2 window, controller and audio around the portable core library.
add_executable(vbcolor-player main.cpp)
target_link_libraries(vbcolor-player PRIVATE vbcolor_core vbcolor_beetle SDL2::SDL2)
target_compile_definitions(vbcolor-player PRIVATE SDL_MAIN_HANDLED)
if(MSVC)
  target_compile_options(vbcolor-player PRIVATE /W4)
endif()
if(WIN32)
  # comdlg32: the Ctrl+O file picker for a play pack.
  target_link_libraries(vbcolor-player PRIVATE comdlg32)
  # SDL2.dll beside the player.
  add_custom_command(TARGET vbcolor-player POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_FILE:SDL2::SDL2> $<TARGET_FILE_DIR:vbcolor-player>)
endif()
