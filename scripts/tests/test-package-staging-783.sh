#!/bin/bash
# Run the generation staging controls against the actual checked-in package block.
set -euo pipefail
source_script=$1
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cmp -s "$source_script" "$repo_root/scripts/package.sh" || { echo 'package source differs from the tested block' >&2; exit 1; }
tap=$(mktemp "${TMPDIR:-/tmp}/cmspark-package-generation.XXXXXX")
trap 'rm -f "$tap"' EXIT
node --test --test-reporter=tap "$repo_root/scripts/tests/whisper-package-generation.test.mjs" | tee "$tap"
grep -Fx '# tests 13' "$tap"
grep -Fx '# pass 13' "$tap"
grep -Fx '# fail 0' "$tap"
grep -Fx '# cancelled 0' "$tap"
grep -Fx '# skipped 0' "$tap"
