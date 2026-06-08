#!/bin/bash
# CMspark Agent launcher — starts the tray companion
# This is the main executable inside the .app bundle
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RESOURCES="${APP_DIR}/Contents/Resources"
NODE="${RESOURCES}/bin/node"
AGENT="${RESOURCES}/bin/cmspark-agent.js"
SWIFT_TRAY="${RESOURCES}/bin/cmspark-tray"

# Prefer the bundled Swift tray if available
if [ -x "${SWIFT_TRAY}" ]; then
  export CMSPARK_SWIFT_TRAY="${SWIFT_TRAY}"
fi

# Start the tray agent
exec "${NODE}" "${AGENT}" tray
