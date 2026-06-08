#!/bin/bash
# Create macOS .dmg installer for CMspark
#
# Prerequisites: make package-macos (or make build build-tray) must have run first.
# This script takes the staged macos-arm64 files and wraps them into a .app bundle + .dmg.
#
# The .app bundle uses a FLAT layout under Resources/ — same as the zip package.
# cmspark-agent.js sits directly in Resources/ alongside assets/, builtin-skills/, etc.
# This matches what paths.ts expects for the packaged mode.
#
# Usage: scripts/create-dmg.sh
# Output: dist-package/CMspark-v{version}-macOS.dmg
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/companion/package.json').version")"
STAGING="${ROOT_DIR}/dist-package/cmspark-macos-arm64"
DMG_NAME="CMspark-v${VERSION}-macOS.dmg"
DMG_DIR="${ROOT_DIR}/dist-package/dmg-staging"
APP_BUNDLE="${DMG_DIR}/CMspark.app"
RESOURCES="${APP_BUNDLE}/Contents/Resources"
ICONSET="${ROOT_DIR}/chrome-extension/assets/CMspark.iconset"

echo "=== CMspark macOS DMG Builder ==="
echo "Version:  ${VERSION}"
echo "Output:   dist-package/${DMG_NAME}"
echo ""

# --- Prerequisite checks ---
if [ ! -d "${STAGING}" ]; then
  echo "[ERROR] Staging directory not found: ${STAGING}"
  echo "        Run 'make package-macos' first."
  exit 1
fi

if [ ! -d "${ICONSET}" ]; then
  echo "[ERROR] Icon set not found: ${ICONSET}"
  echo "        Run 'cd chrome-extension && node scripts/generate-icons.mjs' first."
  exit 1
fi

# --- Step 1: Create .app bundle structure ---
echo "[1/5] Creating CMspark.app bundle..."
rm -rf "${DMG_DIR}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${RESOURCES}"

# Info.plist (version-stamped)
sed "s/0.2.0/${VERSION}/g" "${ROOT_DIR}/scripts/macos/Info.plist" \
  > "${APP_BUNDLE}/Contents/Info.plist"

# --- Step 2: Generate .icns from .iconset ---
echo "[2/5] Generating app icon (.icns)..."
iconutil -c icns "${ICONSET}" -o "${RESOURCES}/AppIcon.icns"
echo "  AppIcon.icns ($(du -h "${RESOURCES}/AppIcon.icns" | cut -f1))"

# --- Step 3: Copy staging files directly into Resources/ (flat layout) ---
echo "[3/5] Copying application files..."
cd "${STAGING}"
cp -r . "${RESOURCES}/"
cd "${ROOT_DIR}"

# Make binaries executable
chmod +x "${RESOURCES}/node" 2>/dev/null || true
if [ -f "${RESOURCES}/cmspark-tray" ]; then
  chmod +x "${RESOURCES}/cmspark-tray"
  echo "  cmspark-tray (Swift)"
fi

echo "  node runtime ($(du -h "${RESOURCES}/node" | cut -f1))"
echo "  App bundle: $(du -sh "${APP_BUNDLE}" | cut -f1)"

# --- Launcher script: node runs cmspark-agent.js from Resources/ ---
cat > "${APP_BUNDLE}/Contents/MacOS/CMspark" <<'LAUNCHER'
#!/bin/bash
# CMspark Agent — macOS .app launcher
# Runs node + cmspark-agent.js from the .app bundle's Resources/
set -euo pipefail

RESOURCES="$(cd "$(dirname "$0")/../Resources" && pwd)"
exec "${RESOURCES}/node" "${RESOURCES}/cmspark-agent.js" tray
LAUNCHER
chmod +x "${APP_BUNDLE}/Contents/MacOS/CMspark"

# --- Step 4: Create DMG ---
echo "[4/5] Creating DMG..."

DMG_OUTPUT="${ROOT_DIR}/dist-package/${DMG_NAME}"
rm -f "${DMG_OUTPUT}"

TMP_DMG="/tmp/cmspark-dmg-${VERSION}.dmg"
rm -f "${TMP_DMG}" "${TMP_DMG}.sparseimage"

# Eject any previously mounted CMspark volumes (from prior failed runs or opened DMG)
for dev in $(hdiutil info | grep "/Volumes/CMspark" | awk '{print $1}' || true); do
  [[ -n "${dev}" ]] && hdiutil detach "${dev}" -force 2>/dev/null || true
done

# Create writable sparse image from staging
DMG_SIZE=$(( $(du -sm "${DMG_DIR}" | cut -f1) + 20 ))m

hdiutil create -size "${DMG_SIZE}" \
  -volname "CMspark" \
  -fs HFS+J \
  -type SPARSE \
  "${TMP_DMG}"

# Sparse image adds .sparseimage suffix
TMP_DMG="${TMP_DMG}.sparseimage"

# Mount the writable sparse image and capture the actual mount point
ATTACH_OUTPUT=$(hdiutil attach "${TMP_DMG}" -noverify -noautoopen)
echo "${ATTACH_OUTPUT}"

# Extract device and actual volume path from the last matching line
VOLUME_LINE=$(echo "${ATTACH_OUTPUT}" | grep "/Volumes/CMspark" | tail -1)
DEVICE=$(echo "${VOLUME_LINE}" | awk '{print $1}')
VOLUME=$(echo "${VOLUME_LINE}" | awk '{print $NF}')

# Copy app bundle and create Applications symlink
echo "  Copying files to DMG..."
cp -r "${APP_BUNDLE}" "${VOLUME}/"
ln -sf /Applications "${VOLUME}/Applications"

# Set Finder window layout via AppleScript
osascript <<APPLESCRIPT 2>/dev/null || true
tell application "Finder"
  set dmg to disk "CMspark"
  open dmg
  set current view of front window to icon view
  set toolbar visible of front window to false
  set statusbar visible of front window to false
  set the bounds of front window to {100, 100, 700, 480}
  set theViewOptions to the icon view options of front window
  set arrangement of theViewOptions to not arranged
  set icon size of theViewOptions to 96
  set position of item "CMspark.app" of front window to {200, 210}
  set position of item "Applications" of front window to {500, 210}
  close front window
end tell
APPLESCRIPT

sync
hdiutil detach "${DEVICE}" -quiet

# --- Step 5: Convert to compressed read-only DMG ---
echo "[5/5] Compressing DMG..."
hdiutil convert "${TMP_DMG}" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -o "${DMG_OUTPUT}"

rm -f "${TMP_DMG}"

echo ""
echo "=== Done: dist-package/${DMG_NAME} ==="
echo "  Size: $(du -sh "${DMG_OUTPUT}" | cut -f1)"
