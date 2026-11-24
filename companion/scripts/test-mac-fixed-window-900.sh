#!/bin/bash
# Interactive acceptance using two extended displays and the real system window picker.
set -euo pipefail
cd "$(dirname "$0")/.."
bin="$PWD/dist/cmspark-host"
[[ -x "$bin" ]] || { echo "Build the native helper with npm run build:host first."; exit 1; }
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
app="$dir/Owned Chat.app/Contents"
mkdir -p "$app/MacOS"
cat > "$app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.cmspark.tests.OwnedChat900</string>
<key>CFBundleExecutable</key><string>OwnedChat</string>
<key>CFBundleName</key><string>CMspark Owned Chat</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
swiftc tests/helpers/activity-fixed-window-900.swift -o "$app/MacOS/OwnedChat"
codesign --force --sign - "$dir/Owned Chat.app"
"$app/MacOS/OwnedChat" "$bin"
