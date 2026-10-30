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

# Rebuild the tray from the current source in a private directory, using the
# same basename and working directory as the package build. No tray is run.
(
  tray_check_dir="$(mktemp -d "${TMPDIR:-/tmp}/cmspark-tray-source-XXXXXX")"
  trap 'rm -f "${tray_check_dir}/cmspark-tray"; rmdir "${tray_check_dir}"' EXIT
  cd "${ROOT_DIR}/companion"
  ./src/tray/build-tray.sh --output "${tray_check_dir}/cmspark-tray"
  cmp -s "${tray_check_dir}/cmspark-tray" "${STAGING}/cmspark-tray" || { echo "[create-dmg] ERROR: staged tray differs from current source build" >&2; exit 1; }
)
# Rebuild the bundle into a private directory and compare to staging.
node "${ROOT_DIR}/companion/scripts/run-esbuild-bundle.mjs" --verify-macos-arm64-tray

# Standalone DMG creation may be pointed at old staging. Bind any staged
# whisper helper and libraries to the selected generation and bundled pin.
_WHISPER_CURRENT="${ROOT_DIR}/companion/dist/whisper-current-darwin-arm64"
_WHISPER_STORE="${ROOT_DIR}/companion/dist/.whisper-generations"
_WHISPER_BIN="${STAGING}/bin/cmspark-whisper-darwin-arm64"
_WHISPER_PIN=""
if [ -e "${_WHISPER_BIN}" ] || [ -L "${_WHISPER_BIN}" ] || [ -e "${_WHISPER_CURRENT}" ] || [ -L "${_WHISPER_CURRENT}" ]; then
  if ! _WHISPER_PIN="$(cd "${ROOT_DIR}/companion" && node scripts/run-esbuild-bundle.mjs --verify-whisper-macos-arm64)"; then
    echo "[create-dmg] ERROR: cannot verify the bundled whisper pin" >&2; exit 1
  fi
  if [[ ! "${_WHISPER_PIN}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "[create-dmg] ERROR: invalid verified whisper pin" >&2; exit 1
  fi
  cmp -s "${STAGING}/cmspark-agent.js" "${ROOT_DIR}/companion/dist/cmspark-agent.js" || { echo "[create-dmg] ERROR: staged agent differs from verified bundle" >&2; exit 1; }
  node "${ROOT_DIR}/scripts/whisper-generation.mjs" verify "${_WHISPER_STORE}" "${_WHISPER_CURRENT}" darwin-arm64 "${STAGING}" "${_WHISPER_PIN}"
  node "${ROOT_DIR}/scripts/verify-macos-whisper-closure.mjs" "${STAGING}" cmspark-whisper-darwin-arm64
fi

if [ ! -d "${ICONSET}" ]; then
  echo "[ERROR] Icon set not found: ${ICONSET}"
  echo "        Run 'cd chrome-extension && node scripts/generate-icons.mjs' first."
  exit 1
fi

# --- Step 1: Create .app bundle structure ---
echo "[1/6] Creating CMspark.app bundle..."
rm -rf "${DMG_DIR}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${RESOURCES}"

# Info.plist (version-stamped from companion/package.json via placeholder)
# Do not hardcode x.y.z here — template uses __CMSPARK_VERSION__.
sed "s/__CMSPARK_VERSION__/${VERSION}/g" "${ROOT_DIR}/scripts/macos/Info.plist" \
  > "${APP_BUNDLE}/Contents/Info.plist"
if grep -q '__CMSPARK_VERSION__' "${APP_BUNDLE}/Contents/Info.plist"; then
  echo "[ERROR] Info.plist still contains __CMSPARK_VERSION__ after stamp" >&2
  exit 1
fi

# --- Step 2: Generate .icns from .iconset ---
echo "[2/6] Generating app icon (.icns)..."
iconutil -c icns "${ICONSET}" -o "${RESOURCES}/AppIcon.icns"
echo "  AppIcon.icns ($(du -h "${RESOURCES}/AppIcon.icns" | cut -f1))"

# --- Step 3: Copy staging files directly into Resources/ (flat layout) ---
echo "[3/6] Copying application files..."
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

# --- Main executable: native CMspark (product TCC identity) ---
HOST_SRC="${RESOURCES}/cmspark-host"
if [ ! -f "${HOST_SRC}" ]; then
  echo "[create-dmg] ERROR: cmspark-host missing in Resources (run package-macos / build:host)"
  exit 1
fi
cp -f "${HOST_SRC}" "${APP_BUNDLE}/Contents/MacOS/CMspark"
chmod +x "${APP_BUNDLE}/Contents/MacOS/CMspark"
# A6 / A18: single signed blob for product TCC identity.
# Do NOT keep an independent Resources/cmspark-host Mach-O: codesign --deep would
# re-sign it as a second nested blob (different CDHash). Hardlinks also break
# because codesign rewrites the main executable to a new inode. Symlink to
# ../MacOS/CMspark survives deep-sign, verifies cleanly, and shares one CDHash.
rm -f "${HOST_SRC}"
ln -sf "../MacOS/CMspark" "${HOST_SRC}"

if file "${APP_BUNDLE}/Contents/MacOS/CMspark" | grep -qiE 'script|text executable|ASCII text'; then
  echo "[create-dmg] ERROR: MacOS/CMspark must be Mach-O, got script/text"
  exit 1
fi

# --- Step 3.5: Ad-hoc codesign the entire .app bundle ---
# Without this, macOS 26 Tahoe TCC treats the bundle as "unsigned" and
# re-prompts for Screen Capture permission on every launch, even though
# internal binaries (cmspark-host, node) are individually signed. TCC
# evaluates bundle-level signature, not per-binary. (2026-07-23 regression:
# DMG users dragged the unsigned .app into /Applications, overwriting the
# manually re-signed version, and TCC prompts came back.)
echo "[4/6] Ad-hoc codesigning .app bundle..."
ENTITLEMENTS="${ROOT_DIR}/companion/src/host-use/darwin/host.entitlements"
codesign --force --deep --sign - --options runtime \
  --entitlements "${ENTITLEMENTS}" \
  "${APP_BUNDLE}"
if ! codesign --verify --verbose "${APP_BUNDLE}"; then
  echo "[create-dmg] ERROR: codesign verify failed for ${APP_BUNDLE}"
  exit 1
fi
codesign -dv --verbose=4 "${APP_BUNDLE}" 2>&1 | grep -E "CDHash|Identifier|TeamIdentifier|flags=" | head -5

# DR-N2 / A6: MacOS/CMspark and Resources/cmspark-host must share one CDHash
HASH_MAIN=$(codesign -dv --verbose=4 "${APP_BUNDLE}/Contents/MacOS/CMspark" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}')
HASH_HOST=$(codesign -dv --verbose=4 "${RESOURCES}/cmspark-host" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}')
if [[ -z "${HASH_MAIN}" || "${HASH_MAIN}" != "${HASH_HOST}" ]]; then
  echo "[create-dmg] ERROR: CDHash mismatch MacOS/CMspark=${HASH_MAIN} Resources/cmspark-host=${HASH_HOST} (A6)"
  exit 1
fi
echo "[create-dmg] A6 OK: single CDHash ${HASH_MAIN}"
# Deep signing must not silently change the native bytes embedded in the daemon table.
node "${ROOT_DIR}/companion/scripts/desktop-artifacts.mjs" verify "${RESOURCES}/bin/desktop-native" darwin

# Deep signing must not change the pair checked by the package producer.
cmp -s "${STAGING}/cmspark-agent.js" "${RESOURCES}/cmspark-agent.js" || { echo "[create-dmg] ERROR: signed agent differs from staging" >&2; exit 1; }
cmp -s "${STAGING}/cmspark-tray" "${RESOURCES}/cmspark-tray" || { echo "[create-dmg] ERROR: signed tray differs from staging" >&2; exit 1; }
if [ -n "${_WHISPER_PIN}" ]; then
  node "${ROOT_DIR}/scripts/whisper-generation.mjs" verify "${_WHISPER_STORE}" "${_WHISPER_CURRENT}" darwin-arm64 "${RESOURCES}" "${_WHISPER_PIN}"
  node "${ROOT_DIR}/scripts/verify-macos-whisper-closure.mjs" "${RESOURCES}" cmspark-whisper-darwin-arm64
fi


# --- Step 4: Create DMG ---
echo "[5/6] Creating DMG..."

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
# cp -R (not -r): BSD -r resolves symlinks — it turned Resources/cmspark-host
# into a regular file, breaking the codesign seal in every shipped DMG
# (found 2026-09-07: host-integrity refusing to spawn on packaged installs).
echo "  Copying files to DMG..."
cp -R "${APP_BUNDLE}" "${VOLUME}/"
ln -sf /Applications "${VOLUME}/Applications"

# Fail-closed: the copied bundle inside the writable image must still verify
# (catches seal-breaking copy regressions before the compressed DMG ships).
if ! codesign --verify --verbose "${VOLUME}/CMspark.app"; then
  echo "[create-dmg] ERROR: codesign verify failed for DMG copy of ${APP_BUNDLE}"
  hdiutil detach "${DEVICE}" -force 2>/dev/null || true
  exit 1
fi
if ! cmp -s "${STAGING}/cmspark-agent.js" "${VOLUME}/CMspark.app/Contents/Resources/cmspark-agent.js" || \
   ! cmp -s "${STAGING}/cmspark-tray" "${VOLUME}/CMspark.app/Contents/Resources/cmspark-tray"; then
  echo "[create-dmg] ERROR: DMG copy differs from checked staging pair" >&2
  hdiutil detach "${DEVICE}" -quiet 2>/dev/null || true
  exit 1
fi
if [ -n "${_WHISPER_PIN}" ]; then
  _DMG_RESOURCES="${VOLUME}/CMspark.app/Contents/Resources"
  if ! node "${ROOT_DIR}/scripts/whisper-generation.mjs" verify "${_WHISPER_STORE}" "${_WHISPER_CURRENT}" darwin-arm64 "${_DMG_RESOURCES}" "${_WHISPER_PIN}" || \
     ! node "${ROOT_DIR}/scripts/verify-macos-whisper-closure.mjs" "${_DMG_RESOURCES}" cmspark-whisper-darwin-arm64; then
    echo "[create-dmg] ERROR: DMG whisper copy differs from the verified generation" >&2
    if ! hdiutil detach "${DEVICE}" -quiet; then echo "[create-dmg] ERROR: failed to detach DMG" >&2; fi
    exit 1
  fi
fi

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
echo "[6/6] Compressing DMG..."
hdiutil convert "${TMP_DMG}" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -o "${DMG_OUTPUT}"

rm -f "${TMP_DMG}"

echo ""
echo "=== Done: dist-package/${DMG_NAME} ==="
echo "  Size: $(du -sh "${DMG_OUTPUT}" | cut -f1)"
