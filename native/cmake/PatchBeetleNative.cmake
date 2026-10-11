# Run in the Beetle checkout by FetchContent's PATCH_COMMAND (cmake -P, working directory = the
# checkout). Applies our VIP export patches, in the order docs/core/core-build.md gives, then
# makes them work natively: the frame data they gather (draw list, pattern table, display RAM,
# palettes, brightness) is switched on for VB_NATIVE_EXPORT builds too, and at the end of each
# frame a C callback receives it instead of the browser hand-off (EM_ASM), which stays
# browser-only. Idempotent: a marker in vip.c says it is done.
set(VIP "mednafen/vb/vip.c")
set(DRAW "mednafen/vb/vip_draw.inc")

file(READ ${VIP} vip)
string(FIND "${vip}" "VB_NATIVE_EXPORT" already)
if(NOT already EQUAL -1)
  return()
endif()

foreach(p beetle-vb-vip-draw-list-export beetle-vb-vip-draw-list-edge-tiles)
  execute_process(
    COMMAND git apply --whitespace=nowarn "${PATCH_DIR}/${p}.patch"
    RESULT_VARIABLE rc
    ERROR_VARIABLE err)
  if(NOT rc EQUAL 0)
    message(FATAL_ERROR "Could not apply ${p}.patch: ${err}")
  endif()
endforeach()

# string(REPLACE) that must find its text: a silent miss would build a core with no frame data.
function(must_replace var from to what)
  string(FIND "${${var}}" "${from}" at)
  if(at EQUAL -1)
    message(FATAL_ERROR "PatchBeetleNative: could not find ${what}")
  endif()
  string(REPLACE "${from}" "${to}" out "${${var}}")
  set(${var} "${out}" PARENT_SCOPE)
endfunction()

set(GUARD "#if defined(__EMSCRIPTEN__) || defined(VB_NATIVE_EXPORT)")

foreach(f ${VIP} ${DRAW})
  file(READ ${f} text)
  string(REPLACE "\r\n" "\n" text "${text}")
  must_replace(text "#ifdef __EMSCRIPTEN__" "${GUARD}" "the emscripten guards in ${f}")
  if(f STREQUAL VIP)
    must_replace(text "#include <emscripten.h>"
      "#ifdef __EMSCRIPTEN__\n#include <emscripten.h>\n#endif"
      "the emscripten include")
    # End of a frame: native builds publish it; the EM_ASM hand-off below stays browser-only.
    must_replace(text
      "               vb_js_opt_ptrs.pBrightnessCache = BrightnessCache;\n"
      "               vb_js_opt_ptrs.pBrightnessCache = BrightnessCache;\n#ifdef VB_NATIVE_EXPORT\n               vb_native_publish_frame();\n#endif\n#ifdef __EMSCRIPTEN__\n"
      "the end-of-frame export")
    must_replace(text
      "(int)(uintptr_t)(const void*)&vb_js_opt_ptrs\n               );\n#endif\n"
      "(int)(uintptr_t)(const void*)&vb_js_opt_ptrs\n               );\n#endif\n#endif\n"
      "the end of the EM_ASM hand-off")
    # The callback, once GPLT and BrightnessCache are declared.
    must_replace(text "static uint16 GPLT[4];\n" "static uint16 GPLT[4];\n
#ifdef VB_NATIVE_EXPORT
#include \"vb_native_export.h\"
static vb_native_frame_callback vb_native_cb = NULL;
static void *vb_native_user = NULL;

void vb_native_set_frame_callback(vb_native_frame_callback cb, void *user)
{
   vb_native_cb = cb;
   vb_native_user = user;
}

static void vb_native_publish_frame(void)
{
   vb_native_frame f;
   if(!vb_native_cb)
      return;
   f.frame_number = vip_js_frame_count;
   f.chr_ram = (const uint8_t *)CHR_RAM;
   f.chr_ram_size = (uint32_t)sizeof(CHR_RAM);
   f.dram = (const uint8_t *)DRAM;
   f.dram_size = (uint32_t)sizeof(DRAM);
   f.draw_calls = (const vb_native_draw_call *)vb_draw_calls;
   f.draw_call_count = vb_draw_count;
   f.draw_call_stride = (uint32_t)sizeof(VB_DrawCall);
   f.gplt = (const uint16_t *)GPLT;
   f.brightness_cache = (const int32_t *)BrightnessCache;
   vb_native_cb(&f, vb_native_user);
}
#endif
" "the GPLT declaration")
  endif()
  file(WRITE ${f} "${text}")
endforeach()
message(STATUS "Beetle VB: VIP export patches applied for a native build")
