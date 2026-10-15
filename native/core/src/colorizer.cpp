// The colour layer in C++: a port of compositeColorFrame (src/color-layer.js) as the emulator and
// the web player call it (unpainted pixels see-through, the pack's transparent-paint flag, the
// default fade response), with the passes it draws through: layer art (src/layer-art.js),
// touch-ups (src/touch-up.js), affine sampling (src/affine-world.js), stereo twins and borrowing
// from the left eye (src/stereo-twin.js), shade ramps (src/shade-ramp.js) and fades (src/fade.js).
// Checked against the browser on captured frames by tests/parity.cpp. Not ported yet: position
// overrides, Painter v2 rules and old screen-pinned overlays (no pack made so far uses them).
#include "vbcolor/colorizer.hpp"

#include <algorithm>
#include <array>
#include <deque>
#include <optional>
#include <unordered_map>
#include <unordered_set>

#include "vip_internal.hpp"

namespace vbc {

using namespace detail;

namespace {

constexpr uint8_t kUnpainted = 0x80;
constexpr int kStereoSearch = 8;
constexpr int kMatchReach = 3;
constexpr double kTouchUpMinMatch = 0.6;
constexpr double kFadeResponse = 1.34;  // FADE_RESPONSE_DEFAULT: the emulator's default scale
constexpr double kMinReference = 0.05;
constexpr int kPixels = kW * kH;

int layer_of(const DrawCall& d) { return d.layer == kUnknownField ? -1 : d.layer; }
int layer_or0(const DrawCall& d) { return d.layer == kUnknownField ? 0 : d.layer; }
int world_of(const DrawCall& d) { return d.world == kUnknownField ? -1 : d.world; }
int strip_of(const DrawCall& d) { return d.strip == kUnknownField ? (d.y >> 3) : d.strip; }

bool matches_group(int world, int layer, int tile, const Group& g, uint32_t hash) {
  const GroupCriteria& c = g.criteria;
  if (!c.worlds.empty() && (world < 0 || !c.worlds.count(world))) return false;
  if (!c.hashes.empty() && !c.hashes.count(static_cast<long long>(hash)) && !(!c.slots.empty() && c.slots.count(tile))) return false;
  if (!c.layers.empty()) {
    if (layer < 0) return false;
    if (!c.layers.count(layer) && !(layer == 1 && c.layers.count(0))) return false;
  }
  return true;
}

double fade_factor(const VipFrame& f, const std::optional<double>& reference, double scale) {
  if (!f.has_master_brightness) return 1.0;
  const double mb = f.master_brightness;
  if (reference && *reference >= kMinReference) return std::clamp((mb / *reference) * (scale / kFadeResponse), 0.0, 1.0);
  if (mb >= 1 && scale == 1) return 1.0;
  return std::clamp(mb * scale, 0.0, 1.0);
}

/** JS `(v * k) | 0` for a byte and a factor in 0..1. */
inline int scale_byte(uint8_t v, double k) { return static_cast<int>(v * k); }

/** Blend an art pixel (already scaled) over the frame, as layer art and touch-ups do. */
inline void put_art_pixel(uint8_t* dst, int r, int g, int b, int a) {
  if (a == 255) {
    dst[0] = static_cast<uint8_t>(r);
    dst[1] = static_cast<uint8_t>(g);
    dst[2] = static_cast<uint8_t>(b);
    dst[3] = 255;
    return;
  }
  const double t = a / 255.0;
  dst[0] = static_cast<uint8_t>(static_cast<int>(r * t + dst[0] * (1 - t)));
  dst[1] = static_cast<uint8_t>(static_cast<int>(g * t + dst[1] * (1 - t)));
  dst[2] = static_cast<uint8_t>(static_cast<int>(b * t + dst[2] * (1 - t)));
  dst[3] = static_cast<uint8_t>(std::max<int>(a, dst[3]));
}

struct ArtEntry {
  int world = 0;
  const Group* group = nullptr;
  int twin_left = -1;
  int twin_shift = 0;
};

struct Placement {
  int x = 0, y = 0, world = 0;
};

struct TouchEntry {
  int world = 0;
  const Group* group = nullptr;
  std::vector<Placement> placements;
};

struct AffinePlacement {
  int mx = 0, my = 0;
};

struct AffineTouchEntry {
  int world = 0;
  const Group* group = nullptr;
  std::vector<AffinePlacement> placements;
};

/** A group's overpaint on a scaled (affine) world, drawn through the world's sampling. */
struct AffineArtEntry {
  int world = 0;
  const Group* group = nullptr;
};

/**
 * Which group colours a shared tile: the one whose own tiles touch it (src/shared-tile-owner.js,
 * which explains the rule; this decides exactly what it decides). A tile two allowed groups paint
 * differently gets votes from the draws beside it (same world and layer, 8 px left/right/up/down;
 * on an affine world the map cells beside it); touching contested tiles settle together in rounds
 * that each read only the last one's results; then the corners; one group voted → it wins, else
 * the list order does. One per eye per frame, lazy: a frame with nothing contested costs nothing.
 */
class SharedTileOwners {
 public:
  using Entry = std::pair<const Group*, const TileRgba*>;
  using Colors = std::unordered_map<uint32_t, std::vector<Entry>>;
  static constexpr int kMaxRounds = 8;        // MAX_ROUNDS
  static constexpr size_t kMaxCluster = 256;  // MAX_CLUSTER

  SharedTileOwners(const Mem& m, int eye, const std::vector<DrawCall>& draws, const Colors& colors,
                   const std::unordered_set<uint32_t>& maybe_contested, const std::unordered_set<const Group*>& hidden,
                   const Twins& twins, const std::vector<int>& affine)
      : m_(m), eye_(eye), draws_(draws), colors_(colors), maybe_(maybe_contested), hidden_(hidden), twins_(twins) {
    for (int w : affine) affine_[static_cast<size_t>(w)] = true;
    slot_code_.fill(0);
  }

  bool is_contested(uint32_t hash) const { return maybe_.count(hash) > 0; }

  /** ownerOfDraw: the entry the neighbours give draw `i` (a plain or sprite draw); null → list order. */
  const Entry* owner_of_draw(int i, uint32_t hash) {
    if (!maybe_.count(hash)) return nullptr;
    if (!positions_built_) build_positions();
    const DrawCall& d = draws_[static_cast<size_t>(i)];
    const std::optional<uint32_t> own = hash_of(d.tile);
    const uint32_t h = own ? *own : hash;
    int n = draw_node_[static_cast<size_t>(i)];
    if (n < 0) {
      // As the browser: the first draw at this place with this pattern.
      int at = i;
      auto it = pos_.find(pos_key(world_of(d), layer_or0(d), d.x, d.y));
      if (it != pos_.end()) {
        for (int j : it->second) {
          if (hash_of(draws_[static_cast<size_t>(j)].tile) == h) {
            at = j;
            break;
          }
        }
      }
      n = node_of_draw(at, h);
    }
    return owner_of(n);
  }

  /** ownerOfCell: the same for map cell `cell` (cellY * 1024 + cellX) of affine world `world`. */
  const Entry* owner_of_cell(int world, int cell, uint32_t hash) {
    if (cell < 0 || !maybe_.count(hash)) return nullptr;
    const int n = node_of_cell(world, cell % 1024, cell / 1024);
    return n < 0 ? nullptr : owner_of(n);
  }

 private:
  struct Node {
    uint32_t hash = 0;
    int world = -1, layer = 0, x = 0, y = 0;  // a draw's screen place, or a cell's map cell
    int match_world = -1, match_layer = -1, tile = 0;
    bool cell = false;
    int claim_state = -1;  // -1 not worked out, 0 not contested, 1 contested
    std::vector<const Entry*> claim;
  };

  // The sides first (0–3), then the corners (4–7).
  static constexpr int kDirs[8][2] = {{-8, 0}, {8, 0}, {0, -8}, {0, 8}, {-8, -8}, {8, -8}, {-8, 8}, {8, 8}};

  static long long pos_key(int world, int layer, int x, int y) {
    return ((((static_cast<long long>(world + 1) & 63) * 4 + (layer & 3)) * 2048 + ((x + 1024) & 2047)) * 2048) + ((y + 1024) & 2047);
  }

  std::optional<uint32_t> hash_of(int tile) {
    const int slot = tile & 2047;
    int& c = slot_code_[static_cast<size_t>(slot)];
    if (!c) {
      const uint8_t* b = m_.tile(slot);
      if (is_blank(b)) {
        c = 1;
      } else {
        hashes_.push_back(hash_tile(b));
        c = static_cast<int>(hashes_.size()) + 1;
      }
    }
    if (c == 1) return std::nullopt;
    return hashes_[static_cast<size_t>(c - 2)];
  }

  int match_world_of(int world) const { return world >= 0 && twins_.has(world) ? twins_.left[static_cast<size_t>(world)] : world; }

  void build_positions() {
    positions_built_ = true;
    draw_node_.assign(draws_.size(), -1);
    for (int i = 0; i < static_cast<int>(draws_.size()); i++) {
      const DrawCall& d = draws_[static_cast<size_t>(i)];
      if (d.eye != eye_) continue;
      if (layer_of(d) == 1 && world_of(d) >= 0 && affine_[static_cast<size_t>(world_of(d))]) continue;
      if (!hash_of(d.tile)) continue;
      pos_[pos_key(world_of(d), layer_or0(d), d.x, d.y)].push_back(i);
    }
  }

  int node_of_draw(int i, uint32_t hash) {
    if (draw_node_[static_cast<size_t>(i)] >= 0) return draw_node_[static_cast<size_t>(i)];
    const DrawCall& d = draws_[static_cast<size_t>(i)];
    Node n;
    n.hash = hash;
    n.world = world_of(d);
    n.layer = layer_or0(d);
    n.x = d.x;
    n.y = d.y;
    n.match_world = match_world_of(world_of(d));
    n.match_layer = layer_of(d);
    n.tile = d.tile;
    nodes_.push_back(std::move(n));
    draw_node_[static_cast<size_t>(i)] = static_cast<int>(nodes_.size()) - 1;
    return draw_node_[static_cast<size_t>(i)];
  }

  int node_of_cell(int world, int cx, int cy) {
    if (cx < 0 || cy < 0) return -1;
    const long long key = (static_cast<long long>(world) << 42) | (static_cast<long long>(cy) << 21) | cx;
    auto it = cell_node_.find(key);
    if (it != cell_node_.end()) return it->second;
    const int ch = affine_map_char(m_, world, cx, cy);
    const std::optional<uint32_t> h = ch < 0 ? std::nullopt : hash_of(ch);
    int id = -1;
    if (h) {
      Node n;
      n.hash = *h;
      n.world = world;
      n.layer = 1;
      n.x = cx;
      n.y = cy;
      n.match_world = match_world_of(world);
      n.match_layer = 1;
      n.tile = ch;
      n.cell = true;
      nodes_.push_back(std::move(n));
      id = static_cast<int>(nodes_.size()) - 1;
    }
    cell_node_.emplace(key, id);
    return id;
  }

  /** Neighbour nodes in directions [from, to) of kDirs. */
  std::vector<int> neighbours(int id, int from, int to) {
    std::vector<int> out;
    for (int k = from; k < to; k++) {
      const Node& n = nodes_[static_cast<size_t>(id)];  // nodes_ is a deque: adding nodes keeps it valid
      if (n.cell) {
        const int c = node_of_cell(n.world, n.x + kDirs[k][0] / 8, n.y + kDirs[k][1] / 8);
        if (c >= 0) out.push_back(c);
      } else {
        auto it = pos_.find(pos_key(n.world, n.layer, n.x + kDirs[k][0], n.y + kDirs[k][1]));
        if (it == pos_.end()) continue;
        for (int j : it->second) out.push_back(node_of_draw(j, *hash_of(draws_[static_cast<size_t>(j)].tile)));
      }
    }
    return out;
  }

  /** claimOf: whether two or more allowed groups claim the node and paint it differently. */
  bool contested(int id) {
    Node& n = nodes_[static_cast<size_t>(id)];
    if (n.claim_state >= 0) return n.claim_state == 1;
    n.claim_state = 0;
    if (!maybe_.count(n.hash)) return false;
    auto it = colors_.find(n.hash);
    if (it == colors_.end()) return false;
    std::vector<const Entry*> claim;
    for (const Entry& e : it->second) {
      if (!hidden_.count(e.first) && matches_group(n.match_world, n.match_layer, n.tile, *e.first, n.hash)) claim.push_back(&e);
    }
    const bool differ = claim.size() > 1 && std::any_of(claim.begin() + 1, claim.end(), [&](const Entry* e) { return *e->second != *claim[0]->second; });
    if (!differ) return false;
    n.claim = std::move(claim);
    n.claim_state = 1;
    return true;
  }

  /** Stands for "neighbours disagree" among vote results (never a real group). */
  static const Group* conflict() {
    static const Group marker{};
    return &marker;
  }

  /** The group the neighbours in directions [from, to) agree on, conflict(), or null when none votes. */
  const Group* vote(int id, int from, int to, const std::unordered_map<int, const Group*>& owner) {
    std::vector<const Group*> votes;
    const auto add = [&](const Group* g) {
      if (std::find(votes.begin(), votes.end(), g) == votes.end()) votes.push_back(g);
    };
    const std::vector<const Entry*>& claim = nodes_[static_cast<size_t>(id)].claim;
    for (int nb : neighbours(id, from, to)) {
      const Node& b = nodes_[static_cast<size_t>(nb)];
      const Group* only = nullptr;
      int mine = 0;
      for (const Entry* e : claim) {
        if (matches_group(b.match_world, b.match_layer, b.tile, *e->first, b.hash)) {
          mine++;
          only = e->first;
        }
      }
      if (mine == 1) {
        add(only);
      } else if (mine > 1) {
        auto o = owner.find(nb);
        if (o != owner.end() && std::any_of(claim.begin(), claim.end(), [&](const Entry* e) { return e->first == o->second; })) add(o->second);
      }
    }
    if (votes.size() == 1) return votes[0];
    return votes.empty() ? nullptr : conflict();
  }

  void settle(int start) {
    std::vector<int> cluster{start};
    std::unordered_set<int> seen{start};
    bool big = false;
    for (size_t i = 0; i < cluster.size() && !big; i++) {
      for (int nb : neighbours(cluster[i], 0, 8)) {
        if (seen.count(nb) || !contested(nb)) continue;
        if (seen.size() >= kMaxCluster) {
          big = true;
          break;
        }
        seen.insert(nb);
        cluster.push_back(nb);
      }
    }
    if (big) {
      for (int n : cluster) settled_[n] = nullptr;
      return;
    }
    std::unordered_map<int, const Group*> owner;
    std::unordered_set<int> conflicted;
    for (int round = 0; round < kMaxRounds; round++) {
      std::unordered_map<int, const Group*> next = owner;
      bool changed = false;
      for (int n : cluster) {
        if (owner.count(n)) continue;
        const Group* g = vote(n, 0, 4, owner);
        if (g == conflict()) {
          conflicted.insert(n);
        } else if (g) {
          conflicted.erase(n);
          next[n] = g;
          changed = true;
        }
      }
      owner = std::move(next);
      if (!changed) break;
    }
    std::unordered_map<int, const Group*> final_owner = owner;
    for (int n : cluster) {
      if (owner.count(n) || conflicted.count(n)) continue;
      const Group* g = vote(n, 4, 8, owner);
      if (g && g != conflict()) final_owner[n] = g;
    }
    for (int n : cluster) {
      const Entry* entry = nullptr;
      auto f = final_owner.find(n);
      if (f != final_owner.end()) {
        for (const Entry* e : nodes_[static_cast<size_t>(n)].claim) {
          if (e->first == f->second) {
            entry = e;
            break;
          }
        }
      }
      settled_[n] = entry;
    }
  }

  const Entry* owner_of(int id) {
    if (!contested(id)) return nullptr;
    auto it = settled_.find(id);
    if (it == settled_.end()) {
      settle(id);
      it = settled_.find(id);
    }
    return it->second;
  }

  const Mem& m_;
  int eye_;
  const std::vector<DrawCall>& draws_;
  const Colors& colors_;
  const std::unordered_set<uint32_t>& maybe_;
  const std::unordered_set<const Group*>& hidden_;
  const Twins& twins_;
  std::array<bool, 32> affine_{};
  std::array<int, 2048> slot_code_{};
  std::vector<uint32_t> hashes_;
  bool positions_built_ = false;
  std::unordered_map<long long, std::vector<int>> pos_;
  std::vector<int> draw_node_;
  std::unordered_map<long long, int> cell_node_;
  std::deque<Node> nodes_;
  std::unordered_map<int, const Entry*> settled_;
};

/** Map cells an affine world reads, in the order first read, with their pattern hashes. */
struct Cells {
  std::vector<std::pair<int, uint32_t>> ordered;
  std::unordered_map<int, uint32_t> at;
};

Cells cells_of(const Mem& m, int world, int eye) {
  Cells c;
  std::unordered_map<int, uint32_t> hash_of_char;
  sample_affine_world(m, world, eye, [&](int, int, int ch, int, int, int, int, bool, bool, bool, int cell) {
    if (cell < 0 || c.at.count(cell)) return;
    auto it = hash_of_char.find(ch);
    if (it == hash_of_char.end()) it = hash_of_char.emplace(ch, hash_tile(m.tile(ch))).first;
    c.at[cell] = it->second;
    c.ordered.emplace_back(cell, it->second);
  });
  return c;
}

std::vector<AffinePlacement> affine_placements(const Cells& cells, const TouchUp& tu) {
  std::vector<AffinePlacement> out;
  for (const auto& [cell, h] : cells.ordered) {
    if (h != tu.anchor_hash) continue;
    const int cx = cell % 1024, cy = cell / 1024;
    size_t matched = 0;
    for (const auto& l : tu.layout) {
      auto it = cells.at.find((cy + l.dy / 8) * 1024 + cx + l.dx / 8);
      if (it != cells.at.end() && it->second == l.hash) matched++;
    }
    if (static_cast<double>(matched) / static_cast<double>(tu.layout.size()) < kTouchUpMinMatch) continue;
    out.push_back({cx * 8, cy * 8});
  }
  return out;
}

/** Where a scaled right-eye twin's copy sits from the left's, in map pixels (twinCopyOffset). */
std::optional<AffinePlacement> twin_copy_offset(const Mem& m, int left, int right) {
  std::unordered_map<int, int> at;
  sample_affine_world(m, left, 0, [&](int x, int y, int, int, int, int, int, bool, bool, bool, int cell) {
    if (cell >= 0 && (x & 3) == 0 && (y & 3) == 0) at[y * kW + x] = cell;
  });
  std::vector<std::pair<std::pair<int, int>, int>> votes;
  int total = 0;
  sample_affine_world(m, right, 1, [&](int x, int y, int, int, int, int, int, bool, bool, bool, int cell) {
    if (cell < 0 || (x & 3) || (y & 3)) return;
    auto it = at.find(y * kW + x);
    if (it == at.end()) return;
    const int l = it->second;
    const std::pair<int, int> k{(cell % 1024) - (l % 1024), (cell / 1024) - (l / 1024)};
    auto v = std::find_if(votes.begin(), votes.end(), [&](const auto& e) { return e.first == k; });
    if (v == votes.end()) votes.push_back({k, 1});
    else v->second++;
    total++;
  });
  const std::pair<int, int>* best = nullptr;
  int best_n = 0;
  for (const auto& [k, n] : votes) {
    if (n > best_n) {
      best = &k;
      best_n = n;
    }
  }
  if (!best || best_n < std::max(8.0, total / 2.0)) return std::nullopt;
  return AffinePlacement{best->first * 8, best->second * 8};
}

}  // namespace

struct Colorizer::Impl {
  const PlayPack& pack;
  /** pattern → groups painting it, in group order (buildGroupTileColorIndex). */
  std::unordered_map<uint32_t, std::vector<std::pair<const Group*, const TileRgba*>>> group_colors;
  std::vector<const Group*> animated;
  /** Patterns two or more groups paint differently: the only ones SharedTileOwners can decide. */
  std::unordered_set<uint32_t> maybe_contested;
  std::unordered_map<const Group*, std::unordered_map<uint32_t, std::optional<TileRgba>>> ramp_cache;
  uint32_t blank_hash = 0;
  /** Groups limited to screens the current memory is not (src/screen-gate.js); usually empty. */
  std::unordered_set<const Group*> screen_hidden;

  bool off(const Group* g) const { return !screen_hidden.empty() && screen_hidden.count(g) > 0; }

  void set_system_ram(const uint8_t* wram, size_t size) {
    screen_hidden.clear();
    for (const Group& g : pack.groups) {
      if (!group_shown_on_screen(g, wram, size)) screen_hidden.insert(&g);
    }
  }

  /**
   * Patterns that switch a group's picture on (src/overpaint-switch.js): its own, those no other
   * group on an overlapping world and layer claims. Absent: any of the group's patterns.
   */
  std::unordered_map<const Group*, std::unordered_set<uint32_t>> switches;

  static bool overlaps(const std::unordered_set<long long>& a, const std::unordered_set<long long>& b) {
    if (a.empty() || b.empty()) return true;
    return std::any_of(a.begin(), a.end(), [&](long long x) { return b.count(x) > 0; });
  }
  static std::unordered_set<long long> layers_of(const Group& g) {
    std::unordered_set<long long> l = g.criteria.layers;
    if (l.count(0)) l.insert(1);  // a BG group also covers its worlds' scaled draws
    return l;
  }

  /**
   * Whole-pose groups' patterns, blank left out (src/overpaint-switch.js wholePoseHashes): all must
   * be on the layer for the picture to show. A whole-pose group with none never shows its picture.
   */
  std::unordered_map<const Group*, std::unordered_set<uint32_t>> poses;

  bool whole_pose_on(const Group& g, const std::unordered_set<uint32_t>& drawn) const {
    const auto it = poses.find(&g);
    if (it == poses.end()) return false;
    return std::all_of(it->second.begin(), it->second.end(), [&](uint32_t h) { return drawn.count(h) > 0; });
  }

  // Of the whole-pose pictures picked for one world, a pose another picked pose holds is left out.
  template <typename Entry>
  void drop_covered_poses(std::vector<Entry>& out) const {
    auto pose_of = [&](const Entry& e) -> const std::unordered_set<uint32_t>* {
      const auto it = poses.find(e.group);
      return it == poses.end() ? nullptr : &it->second;
    };
    std::vector<Entry> kept;
    for (const Entry& e : out) {
      const auto* mine = pose_of(e);
      const bool covered = mine && std::any_of(out.begin(), out.end(), [&](const Entry& o) {
        if (&o == &e || o.world != e.world) return false;
        const auto* theirs = pose_of(o);
        if (!theirs || theirs->size() <= mine->size()) return false;
        return std::all_of(mine->begin(), mine->end(), [&](uint32_t h) { return theirs->count(h) > 0; });
      });
      if (!covered) kept.push_back(e);
    }
    out.swap(kept);
  }

  void build_switches() {
    const uint8_t zeros[16] = {};
    const uint32_t blank = hash_tile(zeros);
    for (const Group& g : pack.groups) {
      if (!g.whole_pose || !g.layer_art) continue;
      std::unordered_set<uint32_t> need;
      for (long long h : g.criteria.hashes) {
        if (static_cast<uint32_t>(h) != blank) need.insert(static_cast<uint32_t>(h));
      }
      if (!need.empty()) poses.emplace(&g, std::move(need));
    }
    for (const Group& g : pack.groups) {
      if (!g.layer_art || g.whole_pose || g.criteria.hashes.empty()) continue;
      const auto layers = layers_of(g);
      std::unordered_set<uint32_t> shared;
      for (const Group& o : pack.groups) {
        if (&o == &g || (!o.id.empty() && o.id == g.id) || o.whole_pose) continue;
        if (!overlaps(g.criteria.window_ids, o.criteria.window_ids) || !overlaps(layers, layers_of(o))) continue;
        for (long long h : o.criteria.hashes) shared.insert(static_cast<uint32_t>(h));
      }
      std::unordered_set<uint32_t> mine;
      for (long long h : g.criteria.hashes) {
        if (!shared.count(static_cast<uint32_t>(h))) mine.insert(static_cast<uint32_t>(h));
      }
      // Distinct patterns, as the browser counts them (a hash listed twice is one pattern).
      std::unordered_set<uint32_t> own;
      for (long long h : g.criteria.hashes) own.insert(static_cast<uint32_t>(h));
      if (!mine.empty() && mine.size() < own.size()) switches.emplace(&g, std::move(mine));
    }
  }

  explicit Impl(const PlayPack& p) : pack(p) {
    for (const Group& g : pack.groups) {
      for (const auto& [hash, rgba] : g.tile_colors) group_colors[hash].emplace_back(&g, &rgba);
      if (!g.criteria.slots.empty() && g.shade_ramp) animated.push_back(&g);
    }
    build_switches();
    // Each pattern's groups in group order: the vector's order is its addresses' order.
    for (auto& [hash, list] : group_colors) {
      std::stable_sort(list.begin(), list.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
      if (list.size() > 1 && std::any_of(list.begin() + 1, list.end(), [&](const auto& e) { return *e.second != *list[0].second; })) maybe_contested.insert(hash);
    }
    const uint8_t zeros[16] = {};
    blank_hash = hash_tile(zeros);
  }

  /** The group that colours this draw, with its colours (resolveGroupTileMatch in JS); null if none. */
  const std::pair<const Group*, const TileRgba*>* group_match(int world, int layer, int tile, uint32_t hash) const {
    auto it = group_colors.find(hash);
    if (it == group_colors.end()) return nullptr;
    for (const auto& entry : it->second) {
      if (!off(entry.first) && matches_group(world, layer, tile, *entry.first, hash)) return &entry;
    }
    return nullptr;
  }

  const TileRgba* group_rgba(int world, int layer, int tile, uint32_t hash) const {
    const auto* m = group_match(world, layer, tile, hash);
    return m ? m->second : nullptr;
  }

  /**
   * paletteFollowFactors (src/color-layer.js): per world drawing plain-BG tiles with more than one
   * palette on this eye, the factor for palette p and pixel value v at [p * 4 + v].
   */
  static std::array<std::optional<std::array<double, 16>>, 32> palette_follow_factors(const Mem& m, const VipFrame& f, const std::vector<DrawCall>& dl, int eye) {
    std::array<std::optional<std::array<double, 16>>, 32> out{};
    std::array<uint8_t, 32> used{};  // bit per palette
    for (const DrawCall& d : dl) {
      if ((d.eye == 1 ? 1 : 0) != eye || layer_or0(d) != 0 || d.world == kUnknownField) continue;
      if (is_blank(m.tile(d.tile))) continue;
      used[d.world] = static_cast<uint8_t>(used[d.world] | (1u << (d.palette & 3)));
    }
    auto shade = [&](int p, int v) { return (f.gplt[static_cast<size_t>(p & 3)] >> (v * 2)) & 3; };
    for (int w = 0; w < 32; w++) {
      const uint8_t bits = used[static_cast<size_t>(w)];
      if ((bits & (bits - 1)) == 0) continue;  // one palette (or none): nothing to compare
      std::array<double, 16> t;
      t.fill(1.0);
      for (int v = 1; v < 4; v++) {
        int max = 0;
        for (int p = 0; p < 4; p++) if (bits & (1u << p)) max = std::max(max, shade(p, v));
        if (!max) continue;
        for (int p = 0; p < 4; p++) t[static_cast<size_t>(p * 4 + v)] = std::min(1.0, static_cast<double>(shade(p, v)) / max);
      }
      out[static_cast<size_t>(w)] = t;
    }
    return out;
  }

  const TileRgba* ramp_rgba(int world, int layer, int tile, uint32_t hash, const uint8_t* bytes) {
    for (const Group* g : animated) {
      if (off(g) || !g->criteria.slots.count(tile) || !matches_group(world, layer, tile, *g, hash)) continue;
      auto& cache = ramp_cache[g];
      auto it = cache.find(hash);
      if (it == cache.end()) {
        std::optional<TileRgba> rgba;
        const auto& ramp = *g->shade_ramp;
        if (ramp[1] || ramp[2] || ramp[3]) {
          TileRgba t{};
          for (int y = 0; y < 8; y++) {
            const int word = bytes[y * 2] | (bytes[y * 2 + 1] << 8);
            for (int x = 0; x < 8; x++) {
              const auto& c = ramp[static_cast<size_t>((word >> (x * 2)) & 3)];
              if (!c) continue;
              uint8_t* p = t.data() + (y * 8 + x) * 4;
              p[0] = (*c)[0];
              p[1] = (*c)[1];
              p[2] = (*c)[2];
              p[3] = 255;
            }
          }
          rgba = t;
        }
        it = cache.emplace(hash, rgba).first;
      }
      if (it->second) return &*it->second;
    }
    return nullptr;
  }

  const TileRgba* pack_rgba(uint32_t hash) const {
    auto it = pack.tile_colors.find(hash);
    return it == pack.tile_colors.end() ? nullptr : &it->second;
  }

  static bool claims(const GroupCriteria& c, int world, int tile, uint32_t h) {
    if (!c.worlds.empty() && !c.worlds.count(world)) return false;
    if ((!c.hashes.empty() || !c.slots.empty()) && !c.hashes.count(static_cast<long long>(h)) && !c.slots.count(tile)) return false;
    return true;
  }

  // ------------------------------------------------------------------ layer art

  // Every group's overpaint on a world is drawn; only one picture per world can hide its tiles.
  std::vector<ArtEntry> active_layer_arts(const Mem& m, const std::vector<DrawCall>& dl, int eye, const Twins* twins) const {
    std::vector<ArtEntry> out;
    std::array<bool, 32> hidden{};
    auto take = [&](ArtEntry e) {
      if (e.group->layer_art->hide_tiles) {
        if (hidden[static_cast<size_t>(e.world)]) return;
        hidden[static_cast<size_t>(e.world)] = true;
      }
      out.push_back(e);
    };
    // Whole-pose pictures (a character's poses, often dozens): one pass over the draw list per eye
    // finds every pattern on each plain layer; each pose then just checks its own patterns.
    struct LayerPatterns {
      bool built = false;
      std::vector<int> order;  // worlds in the order met
      std::array<std::unordered_set<uint32_t>, 32> at;
    };
    std::array<LayerPatterns, 2> layer_patterns;
    auto patterns_on = [&](int e) -> const LayerPatterns& {
      LayerPatterns& lp = layer_patterns[static_cast<size_t>(e)];
      if (lp.built) return lp;
      lp.built = true;
      for (const DrawCall& d : dl) {
        if ((d.eye == 1 ? 1 : 0) != e || layer_or0(d) != 0 || d.world == kUnknownField) continue;
        const uint8_t* bytes = m.tile(d.tile);
        if (is_blank(bytes)) continue;
        auto& set = lp.at[static_cast<size_t>(d.world)];
        if (set.empty()) lp.order.push_back(d.world);
        set.insert(hash_tile(bytes));
      }
      return lp;
    };
    for (const Group& group : pack.groups) {
      if (!group.layer_art || off(&group)) continue;
      const LayerArt& art = *group.layer_art;
      // Patterns other groups on these layers share (a fill or black-out tile) do not switch it on.
      // A whole-pose group's picture needs all of its pose there; any other, one of its own patterns.
      const bool pose = group.whole_pose;
      const auto sw = switches.find(&group);
      const std::unordered_set<uint32_t>* own = pose || sw == switches.end() ? nullptr : &sw->second;
      auto pose_on = [&](int e) {
        std::vector<int> worlds;
        const LayerPatterns& lp = patterns_on(e);
        for (int w : lp.order) {
          if (!group.criteria.worlds.empty() && !group.criteria.worlds.count(w)) continue;
          if (whole_pose_on(group, lp.at[static_cast<size_t>(w)])) worlds.push_back(w);
        }
        return worlds;
      };
      auto first_on = [&](int e) {
        if (pose && group.criteria.slots.empty()) return pose_on(e);
        std::vector<int> worlds;  // in the order met
        std::array<bool, 32> seen{};
        std::array<bool, 32> switched{};
        std::array<std::unordered_set<uint32_t>, 32> drawn;  // whole pose: its patterns per world
        for (const DrawCall& d : dl) {
          if ((d.eye == 1 ? 1 : 0) != e || layer_or0(d) != 0 || d.world == kUnknownField) continue;
          if (!pose && seen[d.world] && (!own || switched[d.world])) continue;
          const uint8_t* bytes = m.tile(d.tile);
          if (is_blank(bytes)) continue;
          const uint32_t h = hash_tile(bytes);
          if (!claims(group.criteria, d.world, d.tile, h)) continue;
          if (!seen[d.world]) {
            seen[d.world] = true;
            worlds.push_back(d.world);
          }
          if (own && (own->count(h) || group.criteria.slots.count(d.tile))) switched[d.world] = true;
          if (pose) drawn[static_cast<size_t>(d.world)].insert(h);
        }
        if (own) worlds.erase(std::remove_if(worlds.begin(), worlds.end(), [&](int w) { return !switched[static_cast<size_t>(w)]; }), worlds.end());
        if (pose) worlds.erase(std::remove_if(worlds.begin(), worlds.end(), [&](int w) { return !whole_pose_on(group, drawn[static_cast<size_t>(w)]); }), worlds.end());
        return worlds;
      };
      std::array<bool, 32> placed{};
      for (int world : first_on(eye)) {
        auto g = world_geometry(m, world, eye);
        if (!g || (art.bgmap_base >= 0 && g->bgmap_base != art.bgmap_base)) continue;
        placed[static_cast<size_t>(world)] = true;
        take({world, &group, -1, 0});
      }
      if (twins && !twins->empty()) {
        const std::vector<int> on_left = first_on(0);
        for (int right : twins->order) {
          const int left = twins->left[static_cast<size_t>(right)];
          if (placed[static_cast<size_t>(right)] || std::find(on_left.begin(), on_left.end(), left) == on_left.end()) continue;
          auto g = world_geometry(m, left, 0);
          if (!g || (art.bgmap_base >= 0 && g->bgmap_base != art.bgmap_base)) continue;
          const bool drawn = std::any_of(dl.begin(), dl.end(), [&](const DrawCall& d) { return d.world == right && d.eye == 1; });
          if (!drawn) continue;
          take({right, &group, left, twins->shift[static_cast<size_t>(right)]});
        }
      }
    }
    drop_covered_poses(out);
    // Back to front; on a shared world the group higher in the list is drawn last (on top).
    std::stable_sort(out.begin(), out.end(), [](const ArtEntry& a, const ArtEntry& b) { return a.world != b.world ? a.world > b.world : a.group > b.group; });
    return out;
  }

  static void paint_layer_art(uint8_t* data, const Mem& m, int eye, const ArtEntry& e, double brightness, uint8_t* painted) {
    auto g = world_geometry(m, e.world, eye);
    if (!g) return;
    auto from = e.twin_left >= 0 ? world_geometry(m, e.twin_left, 0) : g;
    if (!from) return;
    const int shift = e.twin_left >= 0 ? e.twin_shift : 0;
    const LayerArt& art = *e.group->layer_art;
    const RgbaImage& px = art.pixels;
    const double k = std::clamp(brightness, 0.0, 1.0);
    for (int y = 0; y < kH; y++) {
      const int ay = (from->sy(y) - art.map_y) & from->mask_y;
      if (ay >= px.height) continue;
      for (int x = g->start_x; x <= g->final_x; x++) {
        const int ax = (from->sx(x - shift) - art.map_x) & from->mask_x;
        if (ax >= px.width) continue;
        const uint8_t* s = px.rgba.data() + (static_cast<size_t>(ay) * px.width + ax) * 4;
        if (!s[3]) continue;
        const int p = y * kW + x;
        put_art_pixel(data + static_cast<size_t>(p) * 4, scale_byte(s[0], k), scale_byte(s[1], k), scale_byte(s[2], k), s[3]);
        painted[p] = 1;
      }
    }
  }

  // ------------------------------------------------------------------ touch-ups

  std::vector<Placement> touch_up_placements(const Mem& m, const std::vector<DrawCall>& dl, const Group& group, int eye) const {
    const TouchUp& tu = *group.touch_up;
    struct Scoped {
      const DrawCall* d;
      uint32_t h;
    };
    std::vector<Scoped> mine;
    for (const DrawCall& d : dl) {
      if ((d.eye == 1 ? 1 : 0) != eye || layer_or0(d) != 0 || d.world == kUnknownField) continue;
      const uint8_t* bytes = m.tile(d.tile);
      if (is_blank(bytes)) continue;
      const uint32_t h = hash_tile(bytes);
      if (!claims(group.criteria, d.world, d.tile, h)) continue;
      mine.push_back({&d, h});
    }
    std::unordered_map<long long, uint32_t> at;
    auto key = [](int world, int x, int y) {
      return (static_cast<long long>(world) << 40) | (static_cast<long long>(x + 0x80000) << 20) | static_cast<long long>(y + 0x80000);
    };
    for (const Scoped& s : mine) at[key(s.d->world, s.d->x, s.d->y)] = s.h;
    std::vector<Placement> out;
    for (const Scoped& s : mine) {
      if (s.h != tu.anchor_hash) continue;
      size_t matched = 0;
      for (const auto& l : tu.layout) {
        auto it = at.find(key(s.d->world, s.d->x + l.dx, s.d->y + l.dy));
        if (it != at.end() && it->second == l.hash) matched++;
      }
      if (static_cast<double>(matched) / static_cast<double>(tu.layout.size()) < kTouchUpMinMatch) continue;
      out.push_back({s.d->x, s.d->y, s.d->world});
    }
    return out;
  }

  std::vector<TouchEntry> active_touch_ups(const Mem& m, const std::vector<DrawCall>& dl, int eye, const Twins* twins) const {
    std::vector<TouchEntry> out;
    for (const Group& group : pack.groups) {
      if (!group.touch_up || group.has_layer_art_field || off(&group)) continue;
      std::vector<std::pair<int, std::vector<Placement>>> by_world;
      for (const Placement& p : touch_up_placements(m, dl, group, eye)) {
        auto it = std::find_if(by_world.begin(), by_world.end(), [&](const auto& w) { return w.first == p.world; });
        if (it == by_world.end()) by_world.push_back({p.world, {p}});
        else it->second.push_back(p);
      }
      if (eye == 1 && twins && !twins->empty()) {
        const std::vector<Placement> left_placements = touch_up_placements(m, dl, group, 0);
        const size_t placed = by_world.size();
        for (int right : twins->order) {
          if (std::any_of(by_world.begin(), by_world.begin() + static_cast<ptrdiff_t>(placed), [&](const auto& w) { return w.first == right; })) continue;
          const int left = twins->left[static_cast<size_t>(right)];
          std::vector<Placement> moved;
          for (const Placement& p : left_placements) {
            if (p.world == left) moved.push_back({p.x + twins->shift[static_cast<size_t>(right)], p.y, right});
          }
          if (moved.empty()) continue;
          const bool drawn = std::any_of(dl.begin(), dl.end(), [&](const DrawCall& d) { return d.world == right && d.eye == 1; });
          if (!drawn) continue;
          by_world.push_back({right, std::move(moved)});
        }
      }
      for (auto& [world, placements] : by_world) out.push_back({world, &group, std::move(placements)});
    }
    return out;
  }

  static void paint_touch_up(uint8_t* data, const TouchEntry& e, double brightness, uint8_t* painted) {
    const TouchUp& tu = *e.group->touch_up;
    const RgbaImage& px = tu.pixels;
    const double k = std::clamp(brightness, 0.0, 1.0);
    const int pw = std::min(px.width, tu.box_w), ph = std::min(px.height, tu.box_h);
    for (const Placement& p : e.placements) {
      const int ox = p.x + tu.box_dx, oy = p.y + tu.box_dy;
      for (int j = 0; j < ph; j++) {
        const int y = oy + j;
        if (y < 0 || y >= kH) continue;
        for (int i = 0; i < pw; i++) {
          const int x = ox + i;
          if (x < 0 || x >= kW) continue;
          const uint8_t* s = px.rgba.data() + (static_cast<size_t>(j) * px.width + i) * 4;
          if (!s[3]) continue;
          const int pidx = y * kW + x;
          put_art_pixel(data + static_cast<size_t>(pidx) * 4, scale_byte(s[0], k), scale_byte(s[1], k), scale_byte(s[2], k), s[3]);
          painted[pidx] = 1;
        }
      }
    }
  }

  std::vector<AffineTouchEntry> affine_touch_ups(const Mem& m, int eye, const Twins* twins) const {
    std::vector<AffineTouchEntry> out;
    const std::vector<int> shown = affine_worlds(m, eye);
    if (shown.empty()) return out;
    std::unordered_map<int, Cells> cells_cache;  // world * 2 + eye
    auto cells = [&](int world, int e) -> const Cells& {
      auto it = cells_cache.find(world * 2 + e);
      if (it == cells_cache.end()) it = cells_cache.emplace(world * 2 + e, cells_of(m, world, e)).first;
      return it->second;
    };
    std::unordered_map<int, std::optional<AffinePlacement>> offsets;
    for (const Group& group : pack.groups) {
      if (!group.touch_up || group.has_layer_art_field || off(&group)) continue;
      const TouchUp& tu = *group.touch_up;
      if (!std::all_of(tu.layout.begin(), tu.layout.end(), [](const TouchUp::Cell& l) { return l.dx % 8 == 0 && l.dy % 8 == 0; })) continue;
      const auto& ids = group.criteria.window_ids;
      for (int world : shown) {
        const bool twin = twins && twins->has(world);
        if (!ids.empty() && !ids.count(world) && !(twin && ids.count(twins->left[static_cast<size_t>(world)]))) continue;
        std::vector<AffinePlacement> placements = affine_placements(cells(world, eye), tu);
        if (placements.empty() && twin) {
          const int left = twins->left[static_cast<size_t>(world)];
          auto it = offsets.find(world);
          if (it == offsets.end()) it = offsets.emplace(world, twin_copy_offset(m, left, world)).first;
          if (it->second) {
            for (const AffinePlacement& p : affine_placements(cells(left, 0), tu)) placements.push_back({p.mx + it->second->mx, p.my + it->second->my});
          }
        }
        if (placements.empty()) continue;
        out.push_back({world, &group, std::move(placements)});
      }
    }
    return out;
  }

  static void paint_affine_touch_up(uint8_t* data, const Mem& m, int eye, const AffineTouchEntry& e, double brightness, uint8_t* painted) {
    const TouchUp& tu = *e.group->touch_up;
    const RgbaImage& px = tu.pixels;
    const double k = std::clamp(brightness, 0.0, 1.0);
    const int pw = std::min(px.width, tu.box_w), ph = std::min(px.height, tu.box_h);
    sample_affine_world(m, e.world, eye, [&](int x, int y, int, int tx, int ty, int, int, bool hflip, bool vflip, bool, int cell) {
      if (cell < 0) return;
      const int mx = (cell % 1024) * 8 + (hflip ? 7 - tx : tx);
      const int my = (cell / 1024) * 8 + (vflip ? 7 - ty : ty);
      for (const AffinePlacement& p : e.placements) {
        const int i = mx - (p.mx + tu.box_dx), j = my - (p.my + tu.box_dy);
        if (i < 0 || j < 0 || i >= pw || j >= ph) continue;
        const uint8_t* s = px.rgba.data() + (static_cast<size_t>(j) * px.width + i) * 4;
        if (!s[3]) return;
        put_art_pixel(data + static_cast<size_t>(y * kW + x) * 4, scale_byte(s[0], k), scale_byte(s[1], k), scale_byte(s[2], k), s[3]);
        painted[y * kW + x] = 1;
        return;
      }
    });
  }

  // ------------------------------------------------------------------ overpaint on scaled worlds

  // src/overpaint.js affineOverpaints: a group's picture applies to each scaled world it is on (its
  // worlds, and one of its tiles read there) that draws from the picture's BG map.
  std::vector<AffineArtEntry> affine_overpaints(const Mem& m, int eye) const {
    std::vector<AffineArtEntry> out;
    const std::vector<int> shown = affine_worlds(m, eye);
    if (shown.empty()) return out;
    std::unordered_map<int, std::unordered_set<uint32_t>> read_cache;
    auto read_in = [&](int world) -> const std::unordered_set<uint32_t>& {
      auto it = read_cache.find(world);
      if (it == read_cache.end()) {
        std::unordered_set<uint32_t> set;
        for (const auto& [cell, hash] : cells_of(m, world, eye).at) set.insert(hash);
        it = read_cache.emplace(world, std::move(set)).first;
      }
      return it->second;
    };
    for (const Group& group : pack.groups) {
      if (!group.layer_art || off(&group)) continue;
      const LayerArt& art = *group.layer_art;
      const auto& ids = group.criteria.window_ids;
      for (int world : shown) {
        if (!ids.empty() && !ids.count(world)) continue;
        if (art.bgmap_base >= 0 && (m.win(world * kWorldBytes) & 0xf) != art.bgmap_base) continue;
        const auto& read = read_in(world);
        const auto sw = switches.find(&group);
        if (group.whole_pose) {
          if (!whole_pose_on(group, read)) continue;
        } else if (sw != switches.end()) {
          if (std::none_of(sw->second.begin(), sw->second.end(), [&](uint32_t h) { return read.count(h) > 0; })) continue;
        } else if (!group.criteria.hashes.empty() &&
                   std::none_of(group.criteria.hashes.begin(), group.criteria.hashes.end(), [&](long long h) { return read.count(static_cast<uint32_t>(h)); })) {
          continue;
        }
        out.push_back({world, &group});
      }
    }
    drop_covered_poses(out);
    // Every group's picture on a world is drawn; the group higher in the list goes on top.
    std::stable_sort(out.begin(), out.end(), [](const AffineArtEntry& a, const AffineArtEntry& b) { return a.world != b.world ? a.world > b.world : a.group > b.group; });
    return out;
  }

  static void paint_affine_overpaint(uint8_t* data, const Mem& m, int eye, const AffineArtEntry& e, double brightness, uint8_t* painted) {
    const LayerArt& art = *e.group->layer_art;
    const RgbaImage& px = art.pixels;
    const double k = std::clamp(brightness, 0.0, 1.0);
    sample_affine_world(m, e.world, eye, [&](int x, int y, int, int tx, int ty, int, int, bool hflip, bool vflip, bool, int cell) {
      if (cell < 0) return;
      const int i = (cell % 1024) * 8 + (hflip ? 7 - tx : tx) - art.map_x;
      const int j = (cell / 1024) * 8 + (vflip ? 7 - ty : ty) - art.map_y;
      if (i < 0 || j < 0 || i >= px.width || j >= px.height) return;
      const uint8_t* s = px.rgba.data() + (static_cast<size_t>(j) * px.width + i) * 4;
      if (!s[3]) return;
      put_art_pixel(data + static_cast<size_t>(y * kW + x) * 4, scale_byte(s[0], k), scale_byte(s[1], k), scale_byte(s[2], k), s[3]);
      painted[y * kW + x] = 1;
    });
  }

  // ------------------------------------------------------------------ one eye

  void render_eye(const VipFrame& f, int eye, EyeColor& out, const EyeColor* source) {
    const Mem m{f};
    out.image.width = kW;
    out.image.height = kH;
    out.image.rgba.assign(static_cast<size_t>(kPixels) * 4, 0);
    out.shade.assign(kPixels, 0xff);
    out.world.assign(kPixels, -1);
    out.art.assign(kPixels, 0);
    out.touched.fill(false);
    uint8_t* data = out.image.rgba.data();
    uint8_t* pix_shade = out.shade.data();
    int8_t* pix_world = out.world.data();
    uint8_t* pix_art = out.art.data();
    const bool transparent_paint = pack.info.paint_on_transparent;

    auto shade_of = [&](int px, int pal, int layer) {
      return f.has_gplt && layer != 2 ? (f.gplt[static_cast<size_t>(pal & 3)] >> (px * 2)) & 3 : px;
    };

    // The core's draws, plus edge tiles older cores left out (appended, as the browser does).
    const std::vector<DrawCall> recovered = recover_clipped_bg_draws(m, eye);
    std::vector<DrawCall> merged;
    const std::vector<DrawCall>* dlp = &f.draw_list;
    if (!recovered.empty()) {
      merged = f.draw_list;
      merged.insert(merged.end(), recovered.begin(), recovered.end());
      dlp = &merged;
    }
    const std::vector<DrawCall>& draws = *dlp;

    const bool draw_painted_blank = transparent_paint && (pack.tile_colors.count(blank_hash) || group_colors.count(blank_hash));

    std::vector<int> eye_idx;
    for (int i = 0; i < static_cast<int>(draws.size()); i++) {
      if (draws[static_cast<size_t>(i)].eye == eye) eye_idx.push_back(i);
    }
    std::stable_sort(eye_idx.begin(), eye_idx.end(), [&](int ia, int ib) {
      const DrawCall& a = draws[static_cast<size_t>(ia)];
      const DrawCall& b = draws[static_cast<size_t>(ib)];
      const int aw = world_of(a), bw = world_of(b);
      if (aw < 0 || bw < 0) return ia < ib;
      if (aw != bw) return aw > bw;
      const int as = strip_of(a), bs = strip_of(b);
      if (as != bs) return as < bs;
      const int al = layer_or0(a), bl = layer_or0(b);
      if (al != bl) return al < bl;
      return ia < ib;
    });

    const Twins twins = eye == 1 ? stereo_twins(m) : Twins();
    const Twins* twin_of = twins.empty() ? nullptr : &twins;
    const EyeColor* borrow = twin_of && source ? source : nullptr;
    const std::vector<int> affine_set = affine_worlds(m, eye);
    std::array<bool, 32> is_affine{};
    for (int w : affine_set) is_affine[static_cast<size_t>(w)] = true;
    // A tile two groups paint differently goes to the group whose own tiles touch it.
    SharedTileOwners owners(m, eye, draws, group_colors, maybe_contested, screen_hidden, twins, affine_set);

    // ---------------------------------------------------- borrowing from the left eye
    std::vector<uint8_t> right_codes;
    auto build_right_codes = [&]() {
      right_codes.assign(kPixels, 0xff);
      for (int i : eye_idx) {
        const DrawCall& c = draws[static_cast<size_t>(i)];
        if (c.world == kUnknownField || !twins.has(c.world) || c.layer == 1 || c.layer == 2) continue;
        const uint8_t* tb = m.tile(c.tile);
        for (int py = 0; py < 8; py++) {
          const int sy = c.flip_v ? 7 - py : py;
          const int word = tb[sy * 2] | (tb[sy * 2 + 1] << 8);
          for (int px = 0; px < 8; px++) {
            const int ix = c.x + px, iy = c.y + py;
            if (ix < 0 || ix >= kW || iy < 0 || iy >= kH) continue;
            const int v = (word >> ((c.flip_h ? 7 - px : px) * 2)) & 3;
            right_codes[static_cast<size_t>(iy * kW + ix)] = static_cast<uint8_t>(v ? shade_of(v, c.palette, 0) : 4);
          }
        }
      }
      for (int world : twins.order) {
        if (!is_affine[static_cast<size_t>(world)]) continue;
        sample_affine_world(m, world, eye, [&](int x, int y, int, int, int, int px, int pal, bool, bool, bool, int) {
          right_codes[static_cast<size_t>(y * kW + x)] = static_cast<uint8_t>(px ? shade_of(px, pal, 1) : 4);
        });
      }
    };
    auto left_code = [&](int q, int left) -> int {
      const int w = borrow->world[static_cast<size_t>(q)];
      if (w != left) return w < 0 ? 4 : 5;
      const uint8_t s0 = borrow->shade[static_cast<size_t>(q)];
      return s0 == 0xff ? 4 : (s0 & 3);
    };
    auto borrow_from = [&](int ix, int iy, int shade, int world) -> int {
      if (right_codes.empty()) build_right_codes();
      const int left = twins.left[static_cast<size_t>(world)];
      const int row = iy * kW;
      const int x0 = ix - twins.shift[static_cast<size_t>(world)];
      int best = -1;
      int best_cost = 1 << 30;
      for (int k = 0; k <= kStereoSearch; k++) {
        for (int s = k ? -1 : 1; s <= 1; s += 2) {
          const int x = x0 + s * k;
          if (x < 0 || x >= kW) continue;
          const int q = row + x;
          if (borrow->world[static_cast<size_t>(q)] != left) continue;
          const int s0 = borrow->shade[static_cast<size_t>(q)];
          if (!(s0 == shade || (borrow->art[static_cast<size_t>(q)] && (s0 & ~kUnpainted) == shade))) continue;
          int cost = 0;
          for (int d = -kMatchReach; d <= kMatchReach && cost < best_cost; d++) {
            const int rx = ix + d, lx = x + d;
            if (rx < 0 || rx >= kW || lx < 0 || lx >= kW) cost++;
            else if (right_codes[static_cast<size_t>(row + rx)] != left_code(row + lx, left)) cost++;
          }
          if (cost < best_cost) {
            best = q;
            best_cost = cost;
            if (!cost) return best;
          }
        }
      }
      return best;
    };
    auto borrows_all = [&](int world) {
      return borrow && world >= 0 && twins.has(world) && borrow->touched[static_cast<size_t>(twins.left[static_cast<size_t>(world)])];
    };
    auto borrow_into = [&](int pidx, int ix, int iy, int shade, int world) {
      if (!twins.has(world)) return false;
      const int q = borrow_from(ix, iy, shade, world);
      if (q < 0) return false;
      const uint8_t* s = borrow->image.rgba.data() + static_cast<size_t>(q) * 4;
      uint8_t* d = data + static_cast<size_t>(pidx) * 4;
      d[0] = s[0];
      d[1] = s[1];
      d[2] = s[2];
      d[3] = 255;
      pix_shade[pidx] = static_cast<uint8_t>(shade);
      pix_art[pidx] = 2;
      return true;
    };

    // ---------------------------------------------------- passes at a world's depth
    const std::vector<ArtEntry> arts = active_layer_arts(m, draws, eye, twin_of);
    std::array<bool, 32> replaced{};
    // Only a picture that hides the tiles replaces them; plain overpaint is drawn over them.
    for (const ArtEntry& a : arts) {
      if (a.group->layer_art->hide_tiles) replaced[static_cast<size_t>(a.world)] = true;
    }
    const double brightness = fade_factor(f, pack.info.brightness_reference, kFadeResponse);

    auto paint_affine = [&](int world) {
      std::unordered_map<int, const TileRgba*> by_char;
      std::unordered_map<int, const TileRgba*> by_cell;
      std::unordered_map<int, std::optional<uint32_t>> contested_char;
      const int match_world = twins.has(world) ? twins.left[static_cast<size_t>(world)] : world;
      auto colour_of = [&](int ch) -> const TileRgba* {
        auto it = by_char.find(ch);
        if (it != by_char.end()) return it->second;
        const uint8_t* bytes = m.tile(ch);
        const uint32_t hash = hash_tile(bytes);
        const TileRgba* rgba = group_rgba(match_world, 1, ch, hash);
        if (!rgba && !animated.empty()) rgba = ramp_rgba(match_world, 1, ch, hash, bytes);
        if (!rgba) rgba = pack_rgba(hash);
        by_char.emplace(ch, rgba);
        return rgba;
      };
      // A character two groups paint differently is decided per map cell, by the cells beside it.
      auto colour_at = [&](int ch, int cell) -> const TileRgba* {
        if (cell < 0) return colour_of(ch);
        auto c = contested_char.find(ch);
        if (c == contested_char.end()) {
          const uint32_t h = hash_tile(m.tile(ch));
          c = contested_char.emplace(ch, owners.is_contested(h) ? std::optional<uint32_t>(h) : std::nullopt).first;
        }
        if (!c->second) return colour_of(ch);
        auto it = by_cell.find(cell);
        if (it != by_cell.end()) return it->second;
        const auto* owner = owners.owner_of_cell(world, cell, *c->second);
        const TileRgba* rgba = owner ? owner->second : colour_of(ch);
        by_cell.emplace(cell, rgba);
        return rgba;
      };
      const bool all_from_left = borrows_all(world);
      sample_affine_world(m, world, eye, [&](int x, int y, int ch, int tx, int ty, int px, int pal, bool, bool, bool, int cell) {
        const TileRgba* rgba = colour_at(ch, cell);
        if (px == 0 && !(transparent_paint && rgba && (*rgba)[static_cast<size_t>((ty * 8 + tx) * 4 + 3)])) return;
        const int pidx = y * kW + x;
        pix_world[pidx] = static_cast<int8_t>(world);
        uint8_t* d = data + static_cast<size_t>(pidx) * 4;
        if (all_from_left && px != 0 && borrow_into(pidx, x, y, shade_of(px, pal, 1), world)) return;
        if (!rgba) {
          pix_shade[pidx] = static_cast<uint8_t>(kUnpainted | shade_of(px, pal, 1));
          if (borrow && borrow_into(pidx, x, y, shade_of(px, pal, 1), world)) return;
          d[3] = 0;
          return;
        }
        const uint8_t* s = rgba->data() + (ty * 8 + tx) * 4;
        if (s[3] == 0) return;
        pix_shade[pidx] = static_cast<uint8_t>(shade_of(px, pal, 1));
        d[0] = static_cast<uint8_t>(scale_byte(s[0], brightness));
        d[1] = static_cast<uint8_t>(scale_byte(s[1], brightness));
        d[2] = static_cast<uint8_t>(scale_byte(s[2], brightness));
        d[3] = s[3];
      });
    };

    const std::vector<TouchEntry> touches = active_touch_ups(m, draws, eye, twin_of);
    const std::vector<AffineTouchEntry> affine_touches = affine_set.empty() ? std::vector<AffineTouchEntry>{} : affine_touch_ups(m, eye, twin_of);
    const std::vector<AffineArtEntry> affine_arts = affine_set.empty() ? std::vector<AffineArtEntry>{} : affine_overpaints(m, eye);

    enum Kind { kAffine, kArt, kTouch, kAffineTouch, kAffineArt };
    struct Pass {
      int world;
      Kind kind;
      size_t index;
    };
    std::vector<Pass> passes;
    for (int w : affine_set) passes.push_back({w, kAffine, 0});
    for (size_t i = 0; i < arts.size(); i++) passes.push_back({arts[i].world, kArt, i});
    for (size_t i = 0; i < touches.size(); i++) {
      if (!borrows_all(touches[i].world)) passes.push_back({touches[i].world, kTouch, i});
    }
    for (size_t i = 0; i < affine_touches.size(); i++) {
      if (!borrows_all(affine_touches[i].world)) passes.push_back({affine_touches[i].world, kAffineTouch, i});
    }
    for (size_t i = 0; i < affine_arts.size(); i++) {
      if (!borrows_all(affine_arts[i].world)) passes.push_back({affine_arts[i].world, kAffineArt, i});
    }
    std::stable_sort(passes.begin(), passes.end(), [](const Pass& a, const Pass& b) { return a.world > b.world; });
    for (const Pass& p : passes) {
      if (p.kind == kTouch || p.kind == kAffineTouch || p.kind == kAffineArt) out.touched[static_cast<size_t>(p.world)] = true;
    }
    size_t next_pass = 0;
    auto run_pass = [&](const Pass& p) {
      switch (p.kind) {
        case kAffine: paint_affine(p.world); break;
        case kArt: paint_layer_art(data, m, eye, arts[p.index], brightness, pix_art); break;
        case kTouch: paint_touch_up(data, touches[p.index], brightness, pix_art); break;
        case kAffineTouch: paint_affine_touch_up(data, m, eye, affine_touches[p.index], brightness, pix_art); break;
        case kAffineArt: paint_affine_overpaint(data, m, eye, affine_arts[p.index], brightness, pix_art); break;
      }
    };
    auto paint_passes_behind = [&](int world) {
      while (next_pass < passes.size() && (world < 0 || passes[next_pass].world > world)) run_pass(passes[next_pass++]);
    };

    // Groups that follow the game's palette brighten and dim with it (palette_follow_factors).
    const bool any_follow = f.has_gplt && std::any_of(pack.groups.begin(), pack.groups.end(), [&](const Group& g) { return g.follow_palette && !off(&g); });
    const auto follow_factors = any_follow ? palette_follow_factors(m, f, draws, eye) : std::array<std::optional<std::array<double, 16>>, 32>{};

    // ---------------------------------------------------- the draws, back to front
    std::array<std::optional<ClipRect>, 32> clip_cache;
    for (int i : eye_idx) {
      const DrawCall& c = draws[static_cast<size_t>(i)];
      const int world = world_of(c);
      const int layer = layer_of(c);
      if (next_pass < passes.size() && world >= 0) paint_passes_behind(world);
      if (world >= 0 && replaced[static_cast<size_t>(world)] && layer_or0(c) == 0) continue;
      if (layer == 1 && world >= 0 && is_affine[static_cast<size_t>(world)]) continue;
      const uint8_t* tile = m.tile(c.tile);
      if (is_blank(tile) && !draw_painted_blank) continue;
      const uint32_t hash = hash_tile(tile);
      const int twin_left = world >= 0 && twins.has(world) ? twins.left[static_cast<size_t>(world)] : -1;
      const int match_world = twin_left >= 0 ? twin_left : world;
      const bool all_from_left = twin_left >= 0 && borrows_all(world);
      const auto* match = owners.owner_of_draw(i, hash);
      if (!match) match = group_match(match_world, layer, c.tile, hash);
      const TileRgba* rgba = match ? match->second : nullptr;
      const std::array<double, 16>* follow = nullptr;
      if (match && any_follow && match->first->follow_palette && layer_or0(c) == 0 && world >= 0 && follow_factors[static_cast<size_t>(world)]) {
        follow = &*follow_factors[static_cast<size_t>(world)];
      }
      if (!rgba && !animated.empty()) rgba = ramp_rgba(match_world, layer, c.tile, hash, tile);
      if (!rgba) rgba = pack_rgba(hash);
      ClipRect clip;
      if (world >= 0) {
        auto& cached = clip_cache[static_cast<size_t>(world)];
        if (!cached) cached = world_clip(m, world, eye);
        clip = *cached;
      }
      if (clip.empty()) continue;
      for (int py = 0; py < 8; py++) {
        const int sy = c.flip_v ? 7 - py : py;
        const int word = tile[sy * 2] | (tile[sy * 2 + 1] << 8);
        for (int px = 0; px < 8; px++) {
          const int sx = c.flip_h ? 7 - px : px;
          const int ix = c.x + px, iy = c.y + py;
          if (ix < 0 || ix >= kW || iy < 0 || iy >= kH) continue;
          if (clip.clips && (ix < clip.x0 || ix > clip.x1 || iy < clip.y0 || iy > clip.y1)) continue;
          const int mono = (word >> (sx * 2)) & 3;
          if (mono == 0 && !(transparent_paint && rgba && (*rgba)[static_cast<size_t>((sy * 8 + sx) * 4 + 3)])) continue;
          const int pidx = iy * kW + ix;
          pix_world[pidx] = static_cast<int8_t>(world);
          uint8_t* d = data + static_cast<size_t>(pidx) * 4;
          if (all_from_left && mono != 0 && borrow_into(pidx, ix, iy, shade_of(mono, c.palette, layer), world)) continue;
          if (!rgba) {
            const int shade = shade_of(mono, c.palette, layer);
            pix_shade[pidx] = static_cast<uint8_t>(kUnpainted | shade);
            if (twin_left >= 0 && borrow && borrow_into(pidx, ix, iy, shade, world)) continue;
            // Unpainted: see-through, so the original picture shows at this depth.
            d[3] = 0;
            continue;
          }
          const uint8_t* s = rgba->data() + (sy * 8 + sx) * 4;
          if (s[3] == 0) continue;
          pix_shade[pidx] = static_cast<uint8_t>(shade_of(mono, c.palette, layer));
          const double k = follow && mono ? (*follow)[static_cast<size_t>((c.palette & 3) * 4 + mono)] * brightness : brightness;
          if (k != 1.0) {
            d[0] = static_cast<uint8_t>(scale_byte(s[0], k));
            d[1] = static_cast<uint8_t>(scale_byte(s[1], k));
            d[2] = static_cast<uint8_t>(scale_byte(s[2], k));
          } else {
            d[0] = s[0];
            d[1] = s[1];
            d[2] = s[2];
          }
          d[3] = s[3];
        }
      }
    }
    paint_passes_behind(-1);
  }
};

Colorizer::Colorizer(const PlayPack& pack) : impl_(std::make_unique<Impl>(pack)) {}
Colorizer::~Colorizer() = default;

void Colorizer::render(const VipFrame& frame, EyeColor& left, EyeColor& right) {
  impl_->render_eye(frame, 0, left, nullptr);
  impl_->render_eye(frame, 1, right, &left);
}

void Colorizer::render_eye(const VipFrame& frame, int eye, EyeColor& out, const EyeColor* left) {
  impl_->render_eye(frame, eye, out, left);
}

void Colorizer::set_system_ram(const uint8_t* wram, size_t size) { impl_->set_system_ram(wram, size); }

}  // namespace vbc
