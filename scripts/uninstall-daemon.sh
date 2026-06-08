#!/bin/bash
# CMspark Daemon Uninstaller (Cross-Platform: macOS + Linux)
# ============================================================
# Removes the CMspark Companion background service and all associated files.
# Run as the target user (no sudo required).
#
# Usage: ./uninstall-daemon.sh [--purge]

set -euo pipefail

# ---------------------------------------------------------------------------
# Detect OS
# ---------------------------------------------------------------------------
OS="$(uname -s)"
case "$OS" in
    Darwin*) PLATFORM="macos" ;;
    Linux*)  PLATFORM="linux" ;;
    *)       echo "[ERROR] Unsupported OS: $OS"; exit 1 ;;
esac

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
LABEL="com.cmspark.companion"
MENUBAR_LABEL="com.cmspark.menubar"
PLIST_NAME="${LABEL}.plist"
TARGET_PLIST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"
MENUBAR_PLIST_NAME="${MENUBAR_LABEL}.plist"
TARGET_MENUBAR_PLIST="${HOME}/Library/LaunchAgents/${MENUBAR_PLIST_NAME}"
DATA_DIR="${HOME}/.cmspark-agent"
APP_NAME="CMspark Agent.app"
SERVICE_NAME="cmspark-companion.service"
TARGET_SERVICE="${HOME}/.config/systemd/user/${SERVICE_NAME}"

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

# ===========================================================================
# Platform-specific uninstallation
# ===========================================================================

if [[ "$PLATFORM" == "macos" ]]; then
    # -----------------------------------------------------------------------
    # macOS: launchd
    # -----------------------------------------------------------------------
    info "Unloading launchd service: ${LABEL}"
    launchctl unload "${TARGET_PLIST}" >/dev/null 2>&1 || true
    launchctl remove "${LABEL}" >/dev/null 2>&1 || true

    if [[ -f "${TARGET_PLIST}" ]]; then
        info "Removing plist: ${TARGET_PLIST}"
        rm -f "${TARGET_PLIST}"
    else
        warn "Plist not found: ${TARGET_PLIST}"
    fi

    # Unload and remove menubar service
    info "Unloading menubar service: ${MENUBAR_LABEL}"
    launchctl unload "${TARGET_MENUBAR_PLIST}" >/dev/null 2>&1 || true
    launchctl remove "${MENUBAR_LABEL}" >/dev/null 2>&1 || true

    if [[ -f "${TARGET_MENUBAR_PLIST}" ]]; then
        info "Removing menubar plist: ${TARGET_MENUBAR_PLIST}"
        rm -f "${TARGET_MENUBAR_PLIST}"
    fi
fi

if [[ "$PLATFORM" == "linux" ]]; then
    # -----------------------------------------------------------------------
    # Linux: systemd
    # -----------------------------------------------------------------------
    if systemctl --user is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        info "Stopping systemd service: ${SERVICE_NAME}"
        systemctl --user stop "${SERVICE_NAME}" >/dev/null 2>&1 || true
    fi

    if systemctl --user is-enabled --quiet "${SERVICE_NAME}" 2>/dev/null; then
        info "Disabling systemd service: ${SERVICE_NAME}"
        systemctl --user disable "${SERVICE_NAME}" >/dev/null 2>&1 || true
    fi

    if [[ -f "${TARGET_SERVICE}" ]]; then
        info "Removing service file: ${TARGET_SERVICE}"
        rm -f "${TARGET_SERVICE}"
        systemctl --user daemon-reload >/dev/null 2>&1 || true
    else
        warn "Service file not found: ${TARGET_SERVICE}"
    fi
fi

# ---------------------------------------------------------------------------
# Common cleanup (macOS + Linux)
# ---------------------------------------------------------------------------

# Delete "CMspark Agent.app"
if [[ -n "${APP_DIR}" && -d "${APP_DIR}" ]]; then
    info "Removing menu-bar launcher: ${APP_DIR}"
    rm -rf "${APP_DIR}"
else
    warn "Menu-bar launcher not found."
fi

# Clean up UDS lock files
info "Cleaning up UDS lock files..."
for lock in "${DATA_DIR}"/*.sock "${DATA_DIR}"/*.lock; do
    [[ -e "$lock" ]] || continue
    info "Removing lock file: $lock"
    rm -f "$lock"
done

# Remove PID file if it exists
if [[ -f "${DATA_DIR}/daemon.pid" ]]; then
    info "Removing PID file: ${DATA_DIR}/daemon.pid"
    rm -f "${DATA_DIR}/daemon.pid"
fi

# Remove checksum file
if [[ -f "${DATA_DIR}/.plist.sha256" ]]; then
    info "Removing checksum file"
    rm -f "${DATA_DIR}/.plist.sha256"
fi

# ---------------------------------------------------------------------------
# Optionally purge data directory
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
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "  CMspark Daemon Uninstalled"
echo "========================================"
echo ""
info "Uninstall complete."
