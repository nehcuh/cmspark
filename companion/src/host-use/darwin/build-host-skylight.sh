#!/bin/bash
# SPIKE build script for host-skylight binary (Approach C de-risk).
#
# Builds TWO variants for the library-validation A/B test (Grok hypothesis:
# Apple-signed SkyLight dylib should load even without disable-library-validation
# flip, since libval allows Apple-signed).
#
#   - dist/cmspark-host-skylight          (flip=true  — current S-P0-2 regression)
#   - dist/cmspark-host-skylight-nolibval (flip=false — hopeful: no regression)
#
# User runs `inject` on both; if nolibval resolves SLEventPostToPid=true,
# we ship the no-flip variant and avoid the regression.
#
# Output goes to dist/ so production host (dist/cmspark-host) is untouched.
# See docs/decisions/v1.3/adversary-approach-c-round1.txt for spike scope.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
OUTPUT_DIR="${PROJECT_ROOT}/dist"

echo "[build-host-skylight] Building SPIKE A/B binaries..."
echo "[build-host-skylight] Source: ${SCRIPT_DIR}/host-skylight.swift"
echo "[build-host-skylight] Output dir: ${OUTPUT_DIR}"
echo

mkdir -p "${OUTPUT_DIR}"

# (1) Compile Swift ONCE; link twice with different entitlements.
if [[ ! -d "${OUTPUT_DIR}/host-scripts" ]]; then
  echo "[build-host-skylight] WARNING: host-scripts/ missing — run build-host.sh first to precompile .scpt files"
fi

COMPILE_OBJ="${OUTPUT_DIR}/host-skylight.o"
echo "[build-host-skylight] (1/4) Compiling Swift → object file..."
swiftc \
  -O \
  -c \
  -o "${COMPILE_OBJ}" \
  "${SCRIPT_DIR}/host-skylight.swift" \
  -framework Foundation \
  -framework AppKit \
  -framework ApplicationServices \
  -framework Vision \
  -framework Security \
  -framework Carbon \
  -framework CoreImage \
  -framework ImageIO \
  -framework ScreenCaptureKit

if [[ ! -f "${COMPILE_OBJ}" ]]; then
  echo "[build-host-skylight] ERROR: swiftc -c failed — object not produced"
  exit 1
fi

build_variant() {
  local variant_name="$1"
  local entitlements_file="$2"
  local output_bin="${OUTPUT_DIR}/${variant_name}"

  echo
  echo "[build-host-skylight] Building variant: ${variant_name}"
  echo "[build-host-skylight]   entitlements: ${entitlements_file}"

  # Link object file into executable
  swiftc \
    -O \
    -o "${output_bin}" \
    "${COMPILE_OBJ}" \
    -framework Foundation \
    -framework AppKit \
    -framework ApplicationServices \
    -framework Vision \
    -framework Security \
    -framework Carbon \
    -framework CoreImage \
    -framework ImageIO \
    -framework ScreenCaptureKit \
    -Xlinker -sectcreate \
    -Xlinker __TEXT \
    -Xlinker __info_plist \
    -Xlinker "${SCRIPT_DIR}/host-Info.plist"

  if [[ ! -f "${output_bin}" ]]; then
    echo "[build-host-skylight] ERROR: link failed for ${variant_name}"
    exit 1
  fi

  chmod 755 "${output_bin}"

  echo "[build-host-skylight]   codesign with ${entitlements_file}"
  codesign \
    --force \
    --sign - \
    --options runtime \
    --entitlements "${entitlements_file}" \
    "${output_bin}"

  if ! codesign --verify --verbose "${output_bin}" 2>/dev/null; then
    echo "[build-host-skylight] ERROR: codesign verify failed for ${variant_name}"
    exit 1
  fi

  local binary_size binary_hash
  binary_size=$(stat -f%z "${output_bin}" 2>/dev/null || stat -c%s "${output_bin}" 2>/dev/null || echo "?")
  binary_hash=$(shasum -a 256 "${output_bin}" | awk '{print $1}')
  echo "[build-host-skylight]   ${variant_name}: ${binary_size} bytes, SHA256 ${binary_hash}"
}

# Variant A: flip disable-library-validation=true (current S-P0-2 regression)
build_variant "cmspark-host-skylight" "${SCRIPT_DIR}/host-skylight.entitlements"

# Variant B: keep disable-library-validation=false (Grok hypothesis: SkyLight
# is Apple-signed, should still load under hardened runtime)
build_variant "cmspark-host-skylight-nolibval" "${SCRIPT_DIR}/host-skylight-nolibval.entitlements"

# Cleanup object file
rm -f "${COMPILE_OBJ}"

echo
echo "[build-host-skylight] SUCCESS — both variants built"
echo
echo "Next step (user): run the A/B smoke on each binary:"
echo
echo "  ./dist/cmspark-host-skylight inject --action click --window-id 1 --x 50 --y 50"
echo "  ./dist/cmspark-host-skylight-nolibval inject --action click --window-id 1 --x 50 --y 50"
echo
echo "Compare stderr lines 'resolved SLEventPostToPid=...' on each."
echo "If nolibval resolves=true → ship without library-validation flip."
