#pragma once
// A frame captured by the authoring tools (a .vbpack's vipstates/*.json, src/vip-dump.js) as a
// VipFrame: how the parity test feeds the C++ colour layer the frames the browser renders.
#include <string>

#include "vbcolor/vip_frame.hpp"

namespace vbc {

/** Throws std::runtime_error when the JSON is not a captured frame. */
VipFrame vip_frame_from_json(const std::string& json_text);

}  // namespace vbc
