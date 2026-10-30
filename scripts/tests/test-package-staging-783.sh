#!/bin/bash
# Exercise the actual package.sh dylib staging block with an owned fixture.
set -euo pipefail
source_script=$1
owned=$(mktemp -d "${TMPDIR:-/tmp}/cmspark-783-stage.XXXXXX")
trap 'rm -rf "$owned"' EXIT
mkdir -p "$owned/bin" "$owned/project/companion/dist/lib" "$owned/stage/lib"
printf 'whisper\n' > "$owned/project/companion/dist/lib/libwhisper.1.dylib"
printf 'ggml\n' > "$owned/project/companion/dist/lib/libggml.1.dylib"
awk '/^        _dylib_count=0$/ {capture=1} capture && /^        echo "  staged bin\// {exit} capture {print}' "$source_script" > "$owned/block"
test "$(grep -c 'cp -f companion/dist/lib/' "$owned/block")" -eq 2
cat > "$owned/bin/cp" <<'TOOL'
#!/bin/bash
case "$*" in
  *libwhisper*) [ "$FAULT" != whisper ] || exit 41 ;;
  *libggml*) [ "$FAULT" != ggml ] || exit 42 ;;
esac
exec /bin/cp "$@"
TOOL
chmod +x "$owned/bin/cp"
printf '%s\n' 'set -euo pipefail' 'STAGING=$1' > "$owned/runner"
cat "$owned/block" >> "$owned/runner"
printf '%s\n' 'printf "CONTINUED\n"' >> "$owned/runner"
for scenario in whisper ggml success; do
  rc=0
  (cd "$owned/project" && FAULT=$scenario PATH="$owned/bin:/usr/bin:/bin" bash "$owned/runner" "$owned/stage") > "$owned/out" 2> "$owned/err" || rc=$?
  if [ "$scenario" = success ]; then
    [ "$rc" -eq 0 ] && grep -qx CONTINUED "$owned/out" || { echo "$scenario FAIL rc=$rc"; exit 1; }
    cmp "$owned/project/companion/dist/lib/libwhisper.1.dylib" "$owned/stage/lib/libwhisper.1.dylib"
    cmp "$owned/project/companion/dist/lib/libggml.1.dylib" "$owned/stage/lib/libggml.1.dylib"
  else
    [ "$rc" -ne 0 ] && ! grep -qx CONTINUED "$owned/out" || { echo "$scenario FAIL rc=$rc"; exit 1; }
  fi
  printf '%s PASS\n' "$scenario"
done
