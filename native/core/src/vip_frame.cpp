#include "vbcolor/vip_frame.hpp"

#include <algorithm>

namespace vbc {

double master_brightness_from_levels(const int32_t levels[4]) {
  const double sum = static_cast<double>(levels[1]) + levels[2] + levels[3];
  return std::clamp(sum / (3.0 * 255.0), 0.0, 1.0);
}

}  // namespace vbc
