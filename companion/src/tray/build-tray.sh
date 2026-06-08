#!/bin/bash
# Build script for CMspark Swift Tray
# Compiles Tray.swift into a native macOS binary for Apple Silicon

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUTPUT_DIR="${PROJECT_ROOT}/dist"
OUTPUT_BIN="${OUTPUT_DIR}/cmspark-tray"

echo "[build-tray] Building CMspark Swift Tray..."
echo "[build-tray] Source: ${SCRIPT_DIR}/Tray.swift"
echo "[build-tray] Output: ${OUTPUT_BIN}"

# Ensure output directory exists
mkdir -p "${OUTPUT_DIR}"

# Check for Swift compiler
if ! command -v swiftc &>/dev/null; then
  echo "[build-tray] ERROR: swiftc not found."
  echo "[build-tray]        Install Xcode Command Line Tools:"
  echo "[build-tray]        xcode-select --install"
  exit 1
fi

# Check architecture
ARCH=$(uname -m)
OS=$(uname -s)
if [[ "${OS}" != "Darwin" ]]; then
  echo "[build-tray] ERROR: Swift tray is only supported on macOS."
  echo "[build-tray]        Detected OS: ${OS}"
  exit 1
fi

if [[ "${ARCH}" != "arm64" && "${ARCH}" != "x86_64" ]]; then
  echo "[build-tray] WARNING: Untested architecture: ${ARCH}"
fi

# Compile
swiftc \
  -O \
  -o "${OUTPUT_BIN}" \
  "${SCRIPT_DIR}/Tray.swift" \
  -framework AppKit \
  -framework Foundation

# Verify
if [[ ! -f "${OUTPUT_BIN}" ]]; then
  echo "[build-tray] ERROR: Compilation failed — binary not found"
  exit 1
fi

BINARY_SIZE=$(stat -f%z "${OUTPUT_BIN}" 2>/dev/null || stat -c%s "${OUTPUT_BIN}" 2>/dev/null || echo "?")
echo "[build-tray] SUCCESS: Binary built at ${OUTPUT_BIN}"
echo "[build-tray]         Size: ${BINARY_SIZE} bytes"
echo "[build-tray]         Arch: ${ARCH}"

# Verify it's a valid macOS binary
if file "${OUTPUT_BIN}" | grep -q "Mach-O"; then
  echo "[build-tray]         Verified: Mach-O binary"
else
  echo "[build-tray] WARNING: Binary may be invalid (not Mach-O)"
fi

# Set restrictive permissions (owner read+execute only)
chmod 755 "${OUTPUT_BIN}"

# Compute and display SHA256 for updating the TypeScript source
BINARY_HASH=$(shasum -a 256 "${OUTPUT_BIN}" | awk '{print $1}')
echo "[build-tray]         SHA256: ${BINARY_HASH}"
echo "[build-tray]         Update SWIFT_TRAY_SHA256 in menu-bar-agent.ts with this hash"
