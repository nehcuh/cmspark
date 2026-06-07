#!/bin/bash
# CMspark macOS Daemon Uninstaller
# =================================
# Removes the CMspark Companion launchd service and all associated files.
# Run as the target user (no sudo required).
#
# Usage: ./uninstall-daemon.sh [--purge]
#   --purge   Also delete the ~/.cmspark-agent/ data directory.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
LABEL="com.cmspark.companion"
PLIST_NAME="${LABEL}.plist"
TARGET_PLIST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"
DATA_DIR="${HOME}/.cmspark-agent"
APP_NAME="CMspark Agent.app"
if [[ -d "${HOME}/Applications/${APP_NAME}" ]]; then
    APP_DIR="${HOME}/Applications/${APP_NAME}"
elif [[ -d "/Applications/${APP_NAME}" ]]; then
    APP_DIR="/Applications/${APP_NAME}"
else
    APP_DIR=""
fi

# Parse optional --purge flag
PURGE=false
for arg in "$@"; do
    if [[ "$arg" == "--purge" ]]; then
        PURGE=true
    fi
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '[INFO]  %s\n' "$*"; }
warn()  { printf '[WARN]  %s\n' "$*" >&2; }
error() { printf '[ERROR] %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# 1. Unload launchd service (ignore errors if not loaded)
# ---------------------------------------------------------------------------
info "Unloading launchd service: ${LABEL}"
launchctl unload "${TARGET_PLIST}" >/dev/null 2>&1 || true

# Also attempt to remove from modern launchctl domain (macOS 10.10+)
launchctl remove "${LABEL}" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 2. Delete plist file
# ---------------------------------------------------------------------------
if [[ -f "${TARGET_PLIST}" ]]; then
    info "Removing plist: ${TARGET_PLIST}"
    rm -f "${TARGET_PLIST}"
else
    warn "Plist not found: ${TARGET_PLIST}"
fi

# ---------------------------------------------------------------------------
# 3. Delete "CMspark Agent.app"
# ---------------------------------------------------------------------------
if [[ -n "${APP_DIR}" && -d "${APP_DIR}" ]]; then
    info "Removing menu-bar launcher: ${APP_DIR}"
    rm -rf "${APP_DIR}"
else
    warn "Menu-bar launcher not found."
fi

# ---------------------------------------------------------------------------
# 4. Clean up UDS lock files
# ---------------------------------------------------------------------------
info "Cleaning up UDS lock files..."
# Remove any Unix Domain Socket lock files left behind by the daemon
for lock in "${DATA_DIR}"/*.sock "${DATA_DIR}"/*.lock; do
    # Prevent literal glob if no matches
    [[ -e "$lock" ]] || continue
    info "Removing lock file: $lock"
    rm -f "$lock"
done

# Also remove PID file if it exists (legacy)
if [[ -f "${DATA_DIR}/daemon.pid" ]]; then
    info "Removing PID file: ${DATA_DIR}/daemon.pid"
    rm -f "${DATA_DIR}/daemon.pid"
fi

# ---------------------------------------------------------------------------
# 5. Optionally purge data directory
# ---------------------------------------------------------------------------
if [[ "${PURGE}" == true ]]; then
    info "Purging data directory: ${DATA_DIR}"
    rm -rf "${DATA_DIR}"
    info "Data directory removed."
else
    if [[ -d "${DATA_DIR}" ]]; then
        echo ""
        read -r -p "Also delete data directory ${DATA_DIR}? [y/N] " answer <&2 <&1 || true
        if [[ "$answer" =~ ^[Yy]$ ]]; then
            info "Removing data directory: ${DATA_DIR}"
            rm -rf "${DATA_DIR}"
            info "Data directory removed."
        else
            info "Data directory preserved: ${DATA_DIR}"
        fi
    fi
fi

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "  CMspark Daemon Uninstalled"
echo "========================================"
echo ""
info "Uninstall complete."
