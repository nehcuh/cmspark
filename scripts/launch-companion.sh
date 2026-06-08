#!/bin/bash
# CMspark Companion launcher — runs the bundled agent using the embedded Node.js
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "${DIR}/node" "${DIR}/cmspark-agent.js" "$@"
