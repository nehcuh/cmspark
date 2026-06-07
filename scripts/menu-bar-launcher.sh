#!/bin/bash
# CMspark Menu Bar Launcher
# ==========================
# Simple shell script that starts the CMspark menu-bar agent.
# This script is wrapped into "CMspark Agent.app" by install-daemon.sh.
#
# Usage: ./menu-bar-launcher.sh

set -euo pipefail

# Verify cmspark-agent is available
if ! command -v cmspark-agent >/dev/null 2>&1; then
    echo "Error: cmspark-agent not found in PATH." >&2
    echo "Please install it first, e.g.: npm install -g cmspark-agent" >&2
    exit 1
fi

# Start the menu-bar agent
exec cmspark-agent menu-bar
