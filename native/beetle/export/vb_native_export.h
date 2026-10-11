/*
 * What the patched Beetle VB core hands a native front end at the end of each frame
 * (cmake/PatchBeetleNative.cmake adds the code to mednafen/vb/vip.c). Pointers are into the
 * core's own memory and valid only during the callback.
 */
#ifndef VB_NATIVE_EXPORT_H
#define VB_NATIVE_EXPORT_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Same layout as the core's VB_DrawCall (the patch's draw list entry). */
typedef struct vb_native_draw_call {
   uint16_t tile;
   int16_t x;
   int16_t y;
   uint8_t flags; /* bit 0 flip H, bit 1 flip V */
   uint8_t world;
   uint8_t eye;
   uint8_t layer;
   uint8_t palette;
   uint8_t strip;
} vb_native_draw_call;

typedef struct vb_native_frame {
   uint32_t frame_number;
   const uint8_t *chr_ram; /* pattern table */
   uint32_t chr_ram_size;
   const uint8_t *dram; /* display RAM: BG maps, world table, OAM */
   uint32_t dram_size;
   const vb_native_draw_call *draw_calls;
   uint32_t draw_call_count;
   uint32_t draw_call_stride;
   const uint16_t *gplt;             /* 4 background palettes */
   const int32_t *brightness_cache;  /* 4 brightness levels, 0..255 */
} vb_native_frame;

typedef void (*vb_native_frame_callback)(const vb_native_frame *frame, void *user);

void vb_native_set_frame_callback(vb_native_frame_callback cb, void *user);

#ifdef __cplusplus
}
#endif

#endif
