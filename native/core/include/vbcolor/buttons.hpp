#pragma once
// The Virtual Boy controller: two D-pads, A, B, L, R, Start and Select.
#include <cstdint>

namespace vbc {

/** Bits of a controller state (`ButtonState`). */
enum Button : uint16_t {
  LeftUp = 1u << 0,
  LeftDown = 1u << 1,
  LeftLeft = 1u << 2,
  LeftRight = 1u << 3,
  RightUp = 1u << 4,
  RightDown = 1u << 5,
  RightLeft = 1u << 6,
  RightRight = 1u << 7,
  A = 1u << 8,
  B = 1u << 9,
  L = 1u << 10,
  R = 1u << 11,
  Start = 1u << 12,
  Select = 1u << 13,
};

using ButtonState = uint16_t;

}  // namespace vbc
