#!/bin/bash
# Inspect installed copies and local staging without starting CMspark.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
  platform=macos-arm64
else
  platform=macos-x64
fi

inspect_program() {
  local program="$1" description slices
  [ -f "$program" ] || { echo "Executable missing: $program" >&2; return 1; }
  description="$(LC_ALL=C /usr/bin/file -Lb "$program")" || return 1
  echo "$program: ${description%%$'\n'*}"
  if [[ "$description" == Mach-O* ]]; then
    slices="$(/usr/bin/lipo -archs "$program")" || return 1
    case "$platform $slices " in
      macos-arm64*" arm64 "*|macos-arm64*" arm64e "*|macos-x64*" x86_64 "*) ;;
      *) echo "Missing native slice for $platform" >&2; return 1 ;;
    esac
  fi
}

inspect_bundle() {
  local bundle="${1%/}" entry
  if [[ "${bundle##*/}" == "CMspark Agent.app" ]]; then
    # make install-macos creates an AppleScript applet or a shell launcher.
    entry="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$bundle/Contents/Info.plist")" || return 1
    inspect_program "$bundle/Contents/MacOS/$entry"
  else
    bash "$scripts_dir/verify-macos-architecture.sh" "$bundle" "$platform"
  fi
}

if [ "$#" -gt 0 ]; then
  inspect_bundle "$1"
  exit $?
fi

checked=0
status=0
for bundle in /Applications/"CMspark.app" "$HOME/Applications/CMspark.app" \
              /Applications/"CMspark Agent.app" "$HOME/Applications/CMspark Agent.app" \
              "$scripts_dir/../dist-package/cmspark-$platform"; do
  if [ -d "$bundle" ]; then
    checked=1
    inspect_bundle "$bundle" || status=1
  fi
done
for service in companion menubar; do
  plist="$HOME/Library/LaunchAgents/com.cmspark.$service.plist"
  if [ -f "$plist" ]; then
    checked=1
    program="$(/usr/libexec/PlistBuddy -c 'Print :Program' "$plist" 2>/dev/null ||
      /usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$plist")" || { status=1; continue; }
    inspect_program "$program" || status=1
  fi
done
if [ "$checked" -eq 0 ]; then
  echo "No installed or staged CMspark found. Pass the path to the .app to inspect." >&2
  status=1
fi
echo "Running CMspark bundle executables:"
/bin/ps -axo comm= | /usr/bin/awk '/\/CMspark( Agent)?\.app\/Contents\// { print }'
exit "$status"
