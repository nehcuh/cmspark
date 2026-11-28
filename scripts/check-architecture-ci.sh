#!/usr/bin/env bash
set -euo pipefail

node --test scripts/tests/architecture-dependencies.test.mjs
if [[ "$GITHUB_EVENT_NAME" == pull_request ]]; then
  base_ref="$(git rev-parse HEAD^1)"
else
  base_ref="$PUSH_BEFORE"
fi
if [[ "$base_ref" =~ ^0{40}$ ]]; then
  node scripts/architecture-dependencies.mjs
else
  if ! git cat-file -e "$base_ref^{commit}"; then
    git fetch --no-tags --depth=1 origin "$base_ref"
  fi
  base="$(mktemp -d)"
  trap 'rm -rf -- "$base"' EXIT
  git archive "$base_ref" companion/src companion/tsconfig.json chrome-extension/src chrome-extension/tsconfig.json | tar -xf - -C "$base"
  ln -s "$PWD/chrome-extension/node_modules" "$base/chrome-extension/node_modules"
  ln -s "$PWD/companion/node_modules" "$base/companion/node_modules"
  node scripts/architecture-dependencies.mjs --base-dir "$base"
fi
