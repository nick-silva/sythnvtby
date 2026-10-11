add_executable(vbcolor-tests test_main.cpp)
target_link_libraries(vbcolor-tests PRIVATE vbcolor_core vbcolor_beetle)
add_test(NAME vbcolor-tests COMMAND vbcolor-tests)

# Renders captured frames with the C++ colour layer and compares them with the browser's
# (golden images from parity/make-golden.mjs). See native/README.md.
add_executable(vbcolor-parity parity.cpp)
target_link_libraries(vbcolor-parity PRIVATE vbcolor_core)
