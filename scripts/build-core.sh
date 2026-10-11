#!/usr/bin/env bash
# Rebuild the patched Beetle VB WASM core (public/data/cores/beetle_vb-wasm.data).
#
# Linux or WSL (Ubuntu). Needs: git, make, gcc, python3, 7z (p7zip-full). Installs emsdk if
# missing. Everything is pinned to what the shipped core was built from, so the only
# differences are our patches:
#   emsdk 3.1.74 (what EmulatorJS builds cores with), RetroArch (EmulatorJS fork) ed32657,
#   beetle-vb-libretro (EmulatorJS fork) f94d3e8.
#
# Usage (from WSL, repo on the Windows drive):
#   CORE_BUILD_DIR=~/vbcore bash scripts/build-core.sh
# CORE_BUILD_DIR defaults to <repo>/core-build (gitignored). On WSL keep it on the Linux disk
# (~/...): building on /mnt/d is several times slower.
#
# Result: public/data/cores/beetle_vb-wasm.data, with the previous file kept as
# core-build/beetle_vb-wasm.data.prev (in the repo, gitignored).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${CORE_BUILD_DIR:-$REPO_ROOT/core-build}"
EMSDK_VERSION=3.1.74
RETROARCH_COMMIT=ed32657
BEETLE_COMMIT=f94d3e8
JOBS="$(nproc)"

# Applied in order. Beetle: VIP export hooks, then edge tiles (patch level 3).
BEETLE_PATCHES=(beetle-vb-vip-draw-list-export.patch beetle-vb-vip-draw-list-edge-tiles.patch)
RETROARCH_PATCHES=(retroarch-emulatorjs-wram-exports-and-heap-get-memory-data.patch retroarch-emulatorjs-getstate-copy-before-free.patch)

step() { printf '\n== %s\n' "$*"; }

mkdir -p "$WORK"
cd "$WORK"

step "Patches (normalised to LF: a Windows checkout may have CRLF)"
mkdir -p patches-lf
for f in "$REPO_ROOT"/patches/*.patch; do sed 's/\r$//' "$f" > "patches-lf/$(basename "$f")"; done

step "emsdk $EMSDK_VERSION"
if [[ -z "${EMSDK:-}" || ! -f "${EMSDK}/emsdk_env.sh" ]]; then
  EMSDK="$WORK/emsdk"
  [[ -d "$EMSDK" ]] || git clone -q https://github.com/emscripten-core/emsdk.git "$EMSDK"
  "$EMSDK/emsdk" install "$EMSDK_VERSION" >/dev/null
  "$EMSDK/emsdk" activate "$EMSDK_VERSION" >/dev/null
fi
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
emcc --version | head -1

step "Sources"
[[ -d beetle_vb ]] || git clone -q https://github.com/EmulatorJS/beetle-vb-libretro.git beetle_vb
[[ -d RetroArch ]] || git clone -q --filter=blob:none https://github.com/EmulatorJS/RetroArch.git RetroArch
git -C beetle_vb fetch -q origin || true
git -C RetroArch fetch -q origin || true

step "Beetle VB @ $BEETLE_COMMIT + ${BEETLE_PATCHES[*]}"
cd "$WORK/beetle_vb"
git -c advice.detachedHead=false checkout -q -f "$BEETLE_COMMIT"
git clean -qfd
for p in "${BEETLE_PATCHES[@]}"; do git apply "$WORK/patches-lf/$p"; done
emmake make -f Makefile platform=emscripten clean >/dev/null 2>&1 || true
emmake make -f Makefile platform=emscripten -j"$JOBS" > "$WORK/beetle-build.log" 2>&1 \
  || { tail -40 "$WORK/beetle-build.log"; exit 1; }
cp -f mednafen_vb_libretro_emscripten.bc "$WORK/RetroArch/emulatorjs/"

step "RetroArch @ $RETROARCH_COMMIT + ${RETROARCH_PATCHES[*]}"
cd "$WORK/RetroArch"
git -c advice.detachedHead=false checkout -q -f "$RETROARCH_COMMIT"
git clean -qfd -e emulatorjs/mednafen_vb_libretro_emscripten.bc
for p in "${RETROARCH_PATCHES[@]}"; do git apply "$WORK/patches-lf/$p"; done
cd emulatorjs
rm -f "$WORK/EmulatorJS/data/cores/beetle_vb-wasm.data"
emmake ./build-emulatorjs.sh --clean > "$WORK/retroarch-build.log" 2>&1 \
  || { tail -40 "$WORK/retroarch-build.log"; exit 1; }
OUT="$WORK/EmulatorJS/data/cores/beetle_vb-wasm.data"
[[ -s "$OUT" ]] || { echo "build produced no $OUT"; exit 1; }

step "Install into the app"
DEST="$REPO_ROOT/public/data/cores/beetle_vb-wasm.data"
mkdir -p "$REPO_ROOT/core-build"
[[ -f "$DEST" ]] && cp -f "$DEST" "$REPO_ROOT/core-build/beetle_vb-wasm.data.prev"
cp -f "$OUT" "$DEST"
ls -la "$DEST"
echo "Done. Reload the emulator page; the console shows __VB_CORE_PATCH_LEVEL__ = 3 for this build."
