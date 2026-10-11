#pragma once
// How the two eyes are shown: one eye (2D), side by side (3D viewers such as the Switch's
// cardboard Virtual Boy viewer, VR desktop viewers), or anaglyph for red/cyan glasses.
// The browser build does the same (src/stereo-output.js, src/stereo-view.js).
#include "vbcolor/video.hpp"

namespace vbc {

enum class ViewMode { Flat, SideBySide, Anaglyph };

const char* view_mode_name(ViewMode mode);
ViewMode next_view_mode(ViewMode mode);

/**
 * Lay out a core's side-by-side frame for a view mode. Flat shows the left eye. Anaglyph puts the
 * left eye in red and the right in green and blue; the core's picture is one colour (red), so
 * each eye's brightness is its brightest channel.
 */
void compose_view(const VideoFrame& eyes, ViewMode mode, Image& out);

/** The same for two coloured eye pictures (the colour layer): anaglyph takes the left's red. */
void compose_eyes(const Image& left, const Image& right, ViewMode mode, Image& out);

/** The colour layer's two eyes (RGBA bytes) laid out the same way, alpha kept. */
void compose_color(const RgbaImage& left, const RgbaImage& right, ViewMode mode, Image& out);

/** Draw `top` over `base` (same size), by `top`'s alpha: the colour layer over the original picture. */
void overlay(Image& base, const Image& top);

}  // namespace vbc
