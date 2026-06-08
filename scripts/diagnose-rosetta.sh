#!/bin/bash
# Diagnose Rosetta prompt source in CMspark DMG/App
set -euo pipefail

echo "=== CMspark Rosetta Diagnostic ==="
echo ""

# 1. Check installed app
echo "[1] Checking ~/Applications/CMspark.app for x86_64 binaries..."
APP="${HOME}/Applications/CMspark.app"
if [ -d "$APP" ]; then
  FOUND_X86=0
  while IFS= read -r -d '' f; do
    if file "$f" 2>/dev/null | grep -q "x86_64"; then
      echo "  ❌ x86_64: $f"
      FOUND_X86=1
    fi
  done < <(find "$APP" -type f -print0)
  if [ "$FOUND_X86" -eq 0 ]; then
    echo "  ✅ No x86_64 binaries found in installed app"
  fi
else
  echo "  ⚠️  CMspark.app not found in ~/Applications/"
fi
echo ""

# 2. Check staging directory
echo "[2] Checking dist-package staging for x86_64 binaries..."
STAGING="$(cd "$(dirname "$0")/.." && pwd)/dist-package/cmspark-macos-arm64"
if [ -d "$STAGING" ]; then
  FOUND_X86=0
  while IFS= read -r -d '' f; do
    if file "$f" 2>/dev/null | grep -q "x86_64"; then
      echo "  ❌ x86_64: $f"
      FOUND_X86=1
    fi
  done < <(find "$STAGING" -type f -print0)
  if [ "$FOUND_X86" -eq 0 ]; then
    echo "  ✅ No x86_64 binaries found in staging"
  fi
else
  echo "  ⚠️  Staging dir not found (run 'make package-macos' first)"
fi
echo ""

# 3. Check LaunchAgent plist
echo "[3] Checking LaunchAgent plist..."
PLIST="${HOME}/Library/LaunchAgents/com.cmspark.companion.plist"
if [ -f "$PLIST" ]; then
  NODE_PATH=$(grep -o '[^<]*node[^<]*' "$PLIST" 2>/dev/null | head -1 || echo "not found")
  echo "  Node path in plist: $NODE_PATH"
  if [ -f "$NODE_PATH" ]; then
    echo "  Node binary: $(file "$NODE_PATH" | grep -o 'arm64\|x86_64')"
  fi
else
  echo "  ⚠️  LaunchAgent plist not found"
fi
echo ""

# 4. Check running processes
echo "[4] Checking running CMspark processes..."
ps aux | grep -i cmspark | grep -v grep | grep -v diagnose-rosetta || echo "  No CMspark processes running"
echo ""

# 5. Recommendations
echo "=== Recommendations ==="
echo "If x86_64 binaries were found in the installed app:"
echo "  rm -rf ~/Applications/CMspark.app"
echo "  rm -f ~/Library/LaunchAgents/com.cmspark.companion.plist"
echo "  rm -f ~/Library/LaunchAgents/com.cmspark.menubar.plist"
echo "  make clean-package && make package-macos && make install-macos"
echo ""
echo "If the staging dir has x86_64 binaries after 'make package-macos':"
echo "  Check the output above and file a bug report with the paths."
