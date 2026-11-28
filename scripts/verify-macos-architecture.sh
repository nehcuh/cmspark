#!/bin/bash
# Check native objects without running any code from the bundle.
set -euo pipefail
export LC_ALL=C

root="${1:?expected bundle or staging directory}"
case "${2:-}" in
  macos-arm64) cpu=arm64 ;;
  macos-x64) cpu=x86_64 ;;
  *) echo "Expected macos-arm64 or macos-x64" >&2; exit 2 ;;
esac
root="$(cd "$root" && pwd -P)"

/usr/bin/find "$root" -type f -exec /usr/bin/file -E -00 -- {} + | (
  count=0
  failed=0
  # Double NUL mode separates paths and descriptions, including universal
  # binaries whose file description spans multiple lines.
  while IFS= read -r -d '' pathname && IFS= read -r -d '' description; do
    [[ "$description" == Mach-O* ]] || continue
    count=$((count + 1))
    if ! /usr/bin/lipo "$pathname" -verify_arch "$cpu"; then
      echo "Missing $cpu slice: ${pathname#"$root"/}" >&2
      failed=1
    fi
  done
  if [ "$count" -eq 0 ]; then
    echo "No Mach-O files found in $root" >&2
    exit 1
  fi
  [ "$failed" -eq 0 ] || exit 1
  echo "Verified $cpu in $count Mach-O files in $root"
)
