#!/usr/bin/env bash
# Build Beetle VB core with the world-parameter patch applied.
# Requires: beetle-vb tree (with draw list + VIP push already patched), Emscripten.
#
# Usage:
#   BEETLE_VB_SRC=/path/to/beetle-vb-libretro ./scripts/build-core-with-world.sh
#   or
#   ./scripts/build-core-with-world.sh /path/to/beetle-vb-libretro
#
# Then run EmulatorJS/RetroArch step to produce WASM and copy into public/data/.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH="$REPO_ROOT/patches/beetle-vb-vip_draw-add-world-param.patch"

BEETLE_SRC="${BEETLE_VB_SRC:-$1}"
if [[ -z "$BEETLE_SRC" ]]; then
  echo "Usage: BEETLE_VB_SRC=/path/to/beetle-vb-libretro $0"
  echo "   or: $0 /path/to/beetle-vb-libretro"
  exit 1
fi
BEETLE_SRC="$(cd "$BEETLE_SRC" && pwd)"

if [[ ! -f "$PATCH" ]]; then
  echo "Patch not found: $PATCH"
  exit 1
fi

echo "Beetle VB source: $BEETLE_SRC"
echo "Applying world-param patch: $PATCH"
cd "$BEETLE_SRC"
if ! git apply "$PATCH"; then
  echo "Patch failed (e.g. vip_draw.inc already modified). Apply the runbook edits in docs/core/core-patch-add-world.md §2 by hand, then run: emmake make -f Makefile platform=emscripten"
  exit 1
fi

echo "Building with Emscripten..."
source "${EMSDK:-$HOME/.emsdk}/emsdk_env.sh" 2>/dev/null || true
emmake make -f Makefile platform=emscripten

echo "Build done. Output: $(ls -la mednafen_vb_libretro_emscripten.bc 2>/dev/null || echo 'check repo root')"
echo "Next: run EmulatorJS/RetroArch step to produce WASM, then copy into $REPO_ROOT/public/data/ and clear emulator cache (or EJS_disableDatabases = true)."
