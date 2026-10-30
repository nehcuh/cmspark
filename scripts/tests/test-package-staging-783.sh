#!/bin/bash
# Exercise the actual package.sh dylib staging block with an owned fixture.
set -euo pipefail
source_script=$1
repo_root="$(cd "$(dirname "$source_script")/.." && pwd)"
owned=$(mktemp -d "${TMPDIR:-/tmp}/cmspark-783-stage.XXXXXX")
trap 'rm -rf "$owned"' EXIT
mkdir -p "$owned/bin" "$owned/project/companion/dist/lib" "$owned/stage/lib"
printf 'whisper\n' > "$owned/project/companion/dist/lib/libwhisper.1.dylib"
printf 'ggml\n' > "$owned/project/companion/dist/lib/libggml.1.dylib"
printf 'omp\n' > "$owned/project/companion/dist/lib/libomp.dylib"
printf 'other\n' > "$owned/project/companion/dist/lib/libomptarget.dylib"
printf 'other\n' > "$owned/project/companion/dist/lib/libomp.5extra.dylib"
awk '/^        _dylib_count=0$/ {capture=1} capture && /^        echo "  staged bin\// {exit} capture {print}' "$source_script" > "$owned/block"
test "$(grep -c 'cp -f companion/dist/lib/' "$owned/block")" -eq 2
test "$(grep -c 'cp -f "${_omp}"' "$owned/block")" -eq 1
cat > "$owned/bin/cp" <<'TOOL'
#!/bin/bash
case "$*" in
  *libwhisper*) [ "$FAULT" != whisper ] || exit 41 ;;
  *libggml*) [ "$FAULT" != ggml ] || exit 42 ;;
  *libomp*) [ "$FAULT" != omp ] || exit 43 ;;
esac
exec /bin/cp "$@"
TOOL
chmod +x "$owned/bin/cp"
printf '%s\n' 'set -euo pipefail' 'STAGING=$1' 'ROOT_DIR=$2' > "$owned/runner"
cat "$owned/block" >> "$owned/runner"
printf '%s\n' 'printf "CONTINUED\n"' >> "$owned/runner"
for scenario in whisper ggml omp success noomp; do
  rm -f "$owned/stage/lib/"*.dylib
  if [ "$scenario" = noomp ]; then rm -f "$owned/project/companion/dist/lib/libomp.dylib"; fi
  rc=0
  (cd "$owned/project" && FAULT=$scenario PATH="$owned/bin:/usr/bin:/bin" bash "$owned/runner" "$owned/stage" "$repo_root") > "$owned/out" 2> "$owned/err" || rc=$?
  if [ "$scenario" = success ] || [ "$scenario" = noomp ]; then
    [ "$rc" -eq 0 ] && grep -qx CONTINUED "$owned/out" || { echo "$scenario FAIL rc=$rc"; exit 1; }
    cmp "$owned/project/companion/dist/lib/libwhisper.1.dylib" "$owned/stage/lib/libwhisper.1.dylib"
    cmp "$owned/project/companion/dist/lib/libggml.1.dylib" "$owned/stage/lib/libggml.1.dylib"
    [ ! -e "$owned/stage/lib/libomptarget.dylib" ]
    [ ! -e "$owned/stage/lib/libomp.5extra.dylib" ]
    if [ "$scenario" = success ]; then
      cmp "$owned/project/companion/dist/lib/libomp.dylib" "$owned/stage/lib/libomp.dylib"
    else
      [ ! -e "$owned/stage/lib/libomp.dylib" ]
    fi
  else
    [ "$rc" -ne 0 ] && ! grep -qx CONTINUED "$owned/out" || { echo "$scenario FAIL rc=$rc"; exit 1; }
  fi
  printf '%s PASS\n' "$scenario"
done
