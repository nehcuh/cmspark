#!/bin/bash
# CMspark Companion launcher — runs the bundled agent using the embedded Node.js
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
# Packaged node is a standalone binary (no npm/npx siblings, no Contents/lib).
# MCP stdio often spawns nvm's `npx` under this node; npm then lstats
# `<app>/Contents/lib` and exits ENOENT. Pin the prefix to the data dir.
DATA_DIR="${CMSPARK_DATA_DIR:-${HOME}/.cmspark-agent}"
mkdir -p "${DATA_DIR}/npm-prefix"
export npm_config_prefix="${DATA_DIR}/npm-prefix"
exec "${DIR}/node" "${DIR}/cmspark-agent.js" "$@"
