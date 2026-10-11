#pragma once
// Which ROM a play pack belongs to (src/rom-identity.js): SHA-1 and CRC32 of the ROM file.
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace vbc {

struct RomIdentity {
  size_t size = 0;
  std::string sha1;   // 40 lowercase hex digits
  std::string crc32;  // 8 lowercase hex digits
};

std::string sha1_hex(const uint8_t* data, size_t size);
std::string crc32_hex(const uint8_t* data, size_t size);
RomIdentity rom_identity(const std::vector<uint8_t>& rom);

/** SHA-1 when recorded, else CRC32 and size (size -1 = not recorded). */
bool same_rom(const std::string& sha1, const std::string& crc32, long long size, const RomIdentity& actual);

}  // namespace vbc
