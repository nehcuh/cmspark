#!/bin/bash
# Build script for CMspark Host binary (Phase 0 — Computer Use spike)
# Compiles host.swift into a native macOS binary, binds an Info.plist with
# NSAppleEventsUsageDescription, and ad-hoc signs it with hardened runtime +
# automation entitlement. This is the project-existential TCC gate binary:
# docs/decisions/computer-use-round2-synthesis.md §4.1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
OUTPUT_DIR="${PROJECT_ROOT}/dist"
OUTPUT_BIN="${OUTPUT_DIR}/cmspark-host"
SCRIPTS_DIR="${OUTPUT_DIR}/host-scripts"

echo "[build-host] Building CMspark Host binary..."
echo "[build-host] Source: ${SCRIPT_DIR}/host.swift"
echo "[build-host] Output: ${OUTPUT_BIN}"

mkdir -p "${OUTPUT_DIR}" "${SCRIPTS_DIR}"

# (1) Precompile .scpt — Round 1 D3: no runtime osacompile
echo "[build-host] (1/4) Precompiling all .scpt files..."
for script in read-mail list-mail list-notes list-files; do
  osacompile -o "${SCRIPTS_DIR}/${script}.scpt" "${SCRIPT_DIR}/${script}.applescript"
  if [[ ! -f "${SCRIPTS_DIR}/${script}.scpt" ]]; then
    echo "[build-host] ERROR: osacompile failed for ${script}.scpt"
    exit 1
  fi
done

# (2) Swift compile + bind Info.plist into __TEXT __info_plist section
echo "[build-host] (2/4) Compiling Swift binary..."
swiftc \
  -O \
  -o "${OUTPUT_BIN}" \
  "${SCRIPT_DIR}/host.swift" \
  -framework Foundation \
  -framework ApplicationServices \
  -framework Vision \
  -framework Security \
  -framework Carbon \
  -framework CoreImage \
  -Xlinker -sectcreate \
  -Xlinker __TEXT \
  -Xlinker __info_plist \
  -Xlinker "${SCRIPT_DIR}/host-Info.plist"

if [[ ! -f "${OUTPUT_BIN}" ]]; then
  echo "[build-host] ERROR: swiftc failed — binary not produced"
  exit 1
fi

# (3) Set restrictive perms BEFORE codesign (CodeRabbit review: codesign
# captures file mode in seal; setting perms after signing may invalidate it).
chmod 755 "${OUTPUT_BIN}"

# (3b) Codesign: ad-hoc + hardened runtime + entitlements — Round 2 D4
echo "[build-host] (3/4) Ad-hoc codesign with hardened runtime + automation entitlement..."
codesign \
  --force \
  --sign - \
  --options runtime \
  --entitlements "${SCRIPT_DIR}/host.entitlements" \
  "${OUTPUT_BIN}"

# (4) Verify signature (Kimi phase0 review Major #7: add --verify).
# Restrictive perms already set in step 3 before codesign (CodeRabbit review:
# codesign captures file mode in seal).

echo "[build-host] (4/4) Verifying signature..."
echo
echo "--- codesign --verify --verbose ---"
if ! codesign --verify --verbose "${OUTPUT_BIN}"; then
  echo "[build-host] ERROR: codesign verify failed"
  exit 1
fi
echo
echo "--- codesign -dv --verbose=4 ---"
codesign -dv --verbose=4 "${OUTPUT_BIN}"
echo
echo "--- codesign --display --entitlements - ---"
codesign --display --entitlements - "${OUTPUT_BIN}"
echo
echo "--- file ---"
file "${OUTPUT_BIN}"

BINARY_SIZE=$(stat -f%z "${OUTPUT_BIN}" 2>/dev/null || stat -c%s "${OUTPUT_BIN}" 2>/dev/null || echo "?")
BINARY_HASH=$(shasum -a 256 "${OUTPUT_BIN}" | awk '{print $1}')
echo
echo "[build-host] SUCCESS"
echo "[build-host]   Binary: ${OUTPUT_BIN} (${BINARY_SIZE} bytes)"
echo "[build-host]   SHA256: ${BINARY_HASH}"
echo "[build-host]   Scripts: ${SCRIPTS_DIR}/read-mail.scpt"
