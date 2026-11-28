#!/bin/bash
set -euo pipefail
verifier="$(cd "$(dirname "$0")/.." && pwd)/verify-macos-architecture.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir "$fixture/bundle"
for cpu in x86_64 arm64; do
  echo 'int fixture;' | xcrun clang -target "$cpu-apple-macos11" -x c -c - -o "$fixture/$cpu.o"
done

/usr/bin/lipo -create "$fixture/arm64.o" "$fixture/x86_64.o" -output "$fixture/bundle/universal"
/bin/bash "$verifier" "$fixture/bundle" macos-arm64
/bin/bash "$verifier" "$fixture/bundle" macos-x64

cp "$fixture/x86_64.o" "$fixture/bundle/helper with spaces.node"
if /bin/bash "$verifier" "$fixture/bundle" macos-arm64 >"$fixture/log" 2>&1; then
  echo "Accepted Intel-only helper in an Apple silicon package" >&2; exit 1
fi
grep -F 'Missing arm64 slice: helper with spaces.node' "$fixture/log"
/bin/bash "$verifier" "$fixture/bundle" macos-x64

mkdir "$fixture/assets"
echo 'arm64 x86_64' > "$fixture/assets/x86_64.txt"
if /bin/bash "$verifier" "$fixture/assets" macos-arm64; then
  echo "Accepted a bundle without native components" >&2; exit 1
fi

# make install-macos can use a script-only launcher with an external Node.
launcher="$fixture/CMspark Agent.app/Contents"
mkdir -p "$launcher/MacOS"
/usr/bin/plutil -create xml1 "$launcher/Info.plist"
/usr/bin/plutil -insert CFBundleExecutable -string 'CMspark Agent' "$launcher/Info.plist"
echo '#!/bin/sh' > "$launcher/MacOS/CMspark Agent"
diagnose="$(dirname "$verifier")/diagnose-rosetta.sh"
/bin/bash "$diagnose" "$fixture/CMspark Agent.app" | grep -F 'CMspark Agent:'
