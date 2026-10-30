#!/bin/bash
set -euo pipefail
source_script=$1
owned=$(mktemp -d "${TMPDIR:-/tmp}/cmspark-783-otool-control.XXXXXX")
trap 'rm -rf "$owned"' EXIT
mkdir "$owned/bin" "$owned/stage"
awk '/^        # Fail-closed: staged binary must not retain absolute Homebrew load paths$/ {capture=1} capture && /^      else$/ {exit} capture {print}' "$source_script" > "$owned/block"
[ "$(grep -c 'command -v otool' "$owned/block")" -eq 1 ]
cat > "$owned/bin/otool" <<'TOOL'
#!/bin/bash
case "$CASE" in
  failure) exit 43 ;;
  empty) exit 0 ;;
  malformed) printf 'garbage\n'; exit 0 ;;
  malformed_payload) printf '%s:\nnot-a-mach-o-dependency\n' "$2" ;;
  blank_payload) printf '%s:\n\n' "$2" ;;
  truncated_payload) printf '%s:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0\n' "$2" ;;
  universal_heading) printf '%s:\n%s (architecture arm64):\n' "$2" "$2" ;;
  good|grep_failure) printf '%s:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\n' "$2" ;;
  trailing_empty) printf '%s:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\n\n' "$2" ;;
  missing_newline) printf '%s:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)' "$2" ;;
  control) printf '%s:\n\t/owned/control\rpath (compatibility version 1.0.0, current version 1.0.0)\n' "$2" ;;
  internal_tab) printf '%s:\n\t/owned/control\tpath (compatibility version 1.0.0, current version 1.0.0)\n' "$2" ;;
  prefix_cr) printf '%s:\n\t\r/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\n' "$2" ;;
  prefix_vt) printf '%s:\n\t\v/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\n' "$2" ;;
  prefix_ff) printf '%s:\n\t\f/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\n' "$2" ;;
  prefix_tab) printf '%s:\n\t\t/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\n' "$2" ;;
  good_weak) printf '%s:\n\t@rpath/My Library.dylib (compatibility version 0.0.0, current version 65535.255.255, weak)\n' "$2" ;;
  prohibited) printf '%s:\n\t/opt/homebrew/lib/libwhisper.dylib (compatibility version 1.0.0, current version 1.0.0)\n' "$2" ;;
esac
TOOL
cat > "$owned/bin/grep" <<'TOOL'
#!/bin/bash
if [ "$CASE" = grep_failure ]; then exit 2; fi
exec /usr/bin/grep "$@"
TOOL
chmod +x "$owned/bin/otool" "$owned/bin/grep"
printf '%s\n' 'set -euo pipefail' 'STAGING=$1' '_WHISPER_BIN=cmspark-whisper-darwin-arm64' > "$owned/runner"
cat "$owned/block" >> "$owned/runner"
printf '%s\n' 'printf "CONTINUED\n"' >> "$owned/runner"
for scenario in failure empty malformed malformed_payload blank_payload truncated_payload universal_heading good good_weak grep_failure prohibited trailing_empty missing_newline control prefix_cr prefix_vt prefix_ff prefix_tab internal_tab; do
  rc=0
  CASE=$scenario PATH="$owned/bin:/usr/bin:/bin" bash "$owned/runner" "$owned/stage" > "$owned/out" 2> "$owned/err" || rc=$?
  if [ "$scenario" = good ] || [ "$scenario" = good_weak ]; then
    [ "$rc" -eq 0 ] && /usr/bin/grep -qx CONTINUED "$owned/out" || { echo "$scenario FAIL rc=$rc"; exit 1; }
  else
    [ "$rc" -ne 0 ] && ! /usr/bin/grep -qx CONTINUED "$owned/out" || { echo "$scenario FAIL rc=$rc"; exit 1; }
  fi
  printf '%s PASS\n' "$scenario"
done
