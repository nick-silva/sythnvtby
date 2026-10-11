#include "vbcolor/rom_identity.hpp"

#include <array>
#include <cctype>
#include <cstdio>

namespace vbc {
namespace {

uint32_t rol(uint32_t v, int s) { return (v << s) | (v >> (32 - s)); }

std::string lower(std::string s) {
  for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

}  // namespace

std::string sha1_hex(const uint8_t* data, size_t size) {
  uint32_t h[5] = {0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u};
  std::vector<uint8_t> msg(data, data + size);
  const uint64_t bits = static_cast<uint64_t>(size) * 8;
  msg.push_back(0x80);
  while (msg.size() % 64 != 56) msg.push_back(0);
  for (int i = 7; i >= 0; i--) msg.push_back(static_cast<uint8_t>(bits >> (i * 8)));
  for (size_t off = 0; off < msg.size(); off += 64) {
    uint32_t w[80];
    for (int i = 0; i < 16; i++) {
      w[i] = (static_cast<uint32_t>(msg[off + i * 4]) << 24) | (static_cast<uint32_t>(msg[off + i * 4 + 1]) << 16) |
             (static_cast<uint32_t>(msg[off + i * 4 + 2]) << 8) | msg[off + i * 4 + 3];
    }
    for (int i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
    for (int i = 0; i < 80; i++) {
      uint32_t f, k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5A827999u;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1u;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDCu;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6u;
      }
      const uint32_t t = rol(a, 5) + f + e + k + w[i];
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
  }
  char out[41];
  for (int i = 0; i < 5; i++) std::snprintf(out + i * 8, 9, "%08x", h[i]);
  return std::string(out, 40);
}

std::string crc32_hex(const uint8_t* data, size_t size) {
  static const std::array<uint32_t, 256> table = [] {
    std::array<uint32_t, 256> t{};
    for (uint32_t n = 0; n < 256; n++) {
      uint32_t c = n;
      for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      t[n] = c;
    }
    return t;
  }();
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < size; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >> 8);
  char out[9];
  std::snprintf(out, sizeof out, "%08x", crc ^ 0xFFFFFFFFu);
  return std::string(out, 8);
}

RomIdentity rom_identity(const std::vector<uint8_t>& rom) {
  RomIdentity id;
  id.size = rom.size();
  id.sha1 = sha1_hex(rom.data(), rom.size());
  id.crc32 = crc32_hex(rom.data(), rom.size());
  return id;
}

bool same_rom(const std::string& sha1, const std::string& crc32, long long size, const RomIdentity& actual) {
  if (!sha1.empty()) return lower(sha1) == actual.sha1;
  if (!crc32.empty()) return lower(crc32) == actual.crc32 && (size < 0 || static_cast<size_t>(size) == actual.size);
  return false;
}

}  // namespace vbc
