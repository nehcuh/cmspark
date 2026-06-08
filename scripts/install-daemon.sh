#!/bin/bash
# CMspark Daemon Installer (Cross-Platform: macOS + Linux)
# =========================================================
# Installs the CMspark Companion as a user-level background service.
# Run as the target user (no sudo required).
#
# Usage: ./install-daemon.sh [all|daemon-only|menubar-only]
#   all           Install both daemon and menubar (default)
#   daemon-only   Install only the background daemon service
#   menubar-only  Install only the menubar tray launcher

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
# Mode selection
# ---------------------------------------------------------------------------
MODE="${1:-all}"
case "$MODE" in
    all|daemon-only|menubar-only) ;;
    *) echo "[ERROR] Unknown mode: $MODE (use: all, daemon-only, menubar-only)"; exit 1 ;;
esac

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.cmspark.companion"
MENUBAR_LABEL="com.cmspark.menubar"
DATA_DIR="${HOME}/.cmspark-agent"
LOGS_DIR="${DATA_DIR}/logs"
CHECKSUM_FILE="${DATA_DIR}/.plist.sha256"

if [[ "$PLATFORM" == "macos" ]]; then
    PLIST_NAME="${LABEL}.plist"
    SOURCE_PLIST="${SCRIPT_DIR}/launchd/${PLIST_NAME}"
    TARGET_PLIST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"

    MENUBAR_PLIST_NAME="${MENUBAR_LABEL}.plist"
    SOURCE_MENUBAR_PLIST="${SCRIPT_DIR}/launchd/${MENUBAR_PLIST_NAME}"
    TARGET_MENUBAR_PLIST="${HOME}/Library/LaunchAgents/${MENUBAR_PLIST_NAME}"

    APP_NAME="CMspark Agent.app"
    if [[ -d "${HOME}/Applications" ]]; then
        APP_DIR="${HOME}/Applications/${APP_NAME}"
    elif [[ -d "/Applications" ]]; then
        APP_DIR="/Applications/${APP_NAME}"
    else
        APP_DIR="${HOME}/Applications/${APP_NAME}"
    fi
fi

if [[ "$PLATFORM" == "linux" ]]; then
    SERVICE_NAME="cmspark-companion.service"
    SOURCE_SERVICE="${SCRIPT_DIR}/systemd/${SERVICE_NAME}"
    TARGET_SERVICE="${HOME}/.config/systemd/user/${SERVICE_NAME}"
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '[INFO]  %s\n' "$*"; }
warn()  { printf '[WARN]  %s\n' "$*" >&2; }
error() { printf '[ERROR] %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# Common prerequisites
# ---------------------------------------------------------------------------
info "Checking for cmspark-agent in PATH..."
if ! command -v cmspark-agent >/dev/null 2>&1; then
    error "cmspark-agent not found in PATH."
    error "Please install it first, e.g.: npm install -g cmspark-agent"
    exit 1
fi
CMSPARK_AGENT_PATH="$(command -v cmspark-agent)"
info "Found: ${CMSPARK_AGENT_PATH}"

info "Creating data directory: ${DATA_DIR}"
mkdir -p "${DATA_DIR}"
chmod 0700 "${DATA_DIR}"

info "Creating logs directory: ${LOGS_DIR}"
mkdir -p "${LOGS_DIR}"
chmod 0700 "${LOGS_DIR}"

# ===========================================================================
# Daemon installation (daemon-only or all)
# ===========================================================================

if [[ "$MODE" == "all" || "$MODE" == "daemon-only" ]]; then

if [[ "$PLATFORM" == "macos" ]]; then
    # -----------------------------------------------------------------------
    # macOS: launchd daemon
    # -----------------------------------------------------------------------
    info "Installing launchd plist: ${TARGET_PLIST}"
    if [[ ! -f "${SOURCE_PLIST}" ]]; then
        error "Source plist not found: ${SOURCE_PLIST}"
        exit 1
    fi

    mkdir -p "${HOME}/Library/LaunchAgents"

    sed -e "s|{{HOME}}|${HOME}|g" \
        -e "s|${HOME}/.cmspark-agent/bin/cmspark-agent|${CMSPARK_AGENT_PATH}|g" \
        "${SOURCE_PLIST}" > "${TARGET_PLIST}"

    chmod 644 "${TARGET_PLIST}"

    info "Generating plist checksum..."
    shasum -a 256 "${TARGET_PLIST}" | awk '{print $1}' > "${CHECKSUM_FILE}"
    chmod 600 "${CHECKSUM_FILE}"

    info "Unloading existing service (if any)..."
    launchctl unload "${TARGET_PLIST}" >/dev/null 2>&1 || true

    info "Loading launchd service: ${LABEL}"
    launchctl load "${TARGET_PLIST}"

    info "Verifying service status..."
    if launchctl list | grep -q "^${LABEL}$"; then
        info "Service ${LABEL} is loaded."
    else
        warn "Service may not be loaded yet; this is normal on first install."
    fi
fi

if [[ "$PLATFORM" == "linux" ]]; then
    # -----------------------------------------------------------------------
    # Linux: systemd user service
    # -----------------------------------------------------------------------
    info "Installing systemd user service: ${TARGET_SERVICE}"
    if [[ ! -f "${SOURCE_SERVICE}" ]]; then
        error "Source service file not found: ${SOURCE_SERVICE}"
        exit 1
    fi

    mkdir -p "${HOME}/.config/systemd/user"

    sed -e "s|%h|${HOME}|g" \
        -e "s|${HOME}/.cmspark-agent/bin/cmspark-agent|${CMSPARK_AGENT_PATH}|g" \
        "${SOURCE_SERVICE}" > "${TARGET_SERVICE}"

    chmod 644 "${TARGET_SERVICE}"

    info "Generating service file checksum..."
    sha256sum "${TARGET_SERVICE}" | awk '{print $1}' > "${CHECKSUM_FILE}"
    chmod 600 "${CHECKSUM_FILE}"

    info "Reloading systemd daemon..."
    systemctl --user daemon-reload

    info "Enabling systemd service: ${SERVICE_NAME}"
    systemctl --user enable "${SERVICE_NAME}"

    info "Starting systemd service: ${SERVICE_NAME}"
    systemctl --user start "${SERVICE_NAME}" || {
        warn "Service may not have started. Check logs with: journalctl --user -u ${SERVICE_NAME}"
    }

    info "Verifying service status..."
    if systemctl --user is-active --quiet "${SERVICE_NAME}"; then
        info "Service ${SERVICE_NAME} is active."
    else
        warn "Service may not be active yet. Check with: systemctl --user status ${SERVICE_NAME}"
    fi
fi

fi # end daemon-only / all

# ===========================================================================
# Menubar installation (menubar-only or all, macOS only)
# ===========================================================================

if [[ "$MODE" == "all" || "$MODE" == "menubar-only" ]]; then

if [[ "$PLATFORM" == "macos" ]]; then
    # -----------------------------------------------------------------------
    # macOS: menubar launchd + .app bundle
    # -----------------------------------------------------------------------

    # Install menubar launchd plist
    if [[ -f "${SOURCE_MENUBAR_PLIST}" ]]; then
        info "Installing menubar plist: ${TARGET_MENUBAR_PLIST}"
        sed -e "s|{{HOME}}|${HOME}|g" \
            -e "s|{{CMSPARK_AGENT_PATH}}|${CMSPARK_AGENT_PATH}|g" \
            "${SOURCE_MENUBAR_PLIST}" > "${TARGET_MENUBAR_PLIST}"
        chmod 644 "${TARGET_MENUBAR_PLIST}"

        info "Unloading existing menubar service (if any)..."
        launchctl unload "${TARGET_MENUBAR_PLIST}" >/dev/null 2>&1 || true

        info "Loading menubar service: ${MENUBAR_LABEL}"
        launchctl load "${TARGET_MENUBAR_PLIST}"
    else
        warn "Menubar plist not found: ${SOURCE_MENUBAR_PLIST} — skipping launchd registration"
    fi

    # Create tray launcher .app bundle
    info "Creating tray launcher: ${APP_DIR}"
    rm -rf "${APP_DIR}"

    OSASCRIPT_SRC="
on run
    do shell script \"${CMSPARK_AGENT_PATH} tray\"
end run

on open theFiles
    do shell script \"${CMSPARK_AGENT_PATH} tray\"
end open
"

    mkdir -p "$(dirname "${APP_DIR}")"
    echo "${OSASCRIPT_SRC}" | osacompile -o "${APP_DIR}" 2>&1 || {
        warn "osacompile failed; falling back to shell-script wrapper."
        mkdir -p "${APP_DIR}/Contents/MacOS"
        cat > "${APP_DIR}/Contents/MacOS/CMspark Agent" <<EOF
#!/bin/bash
exec "${CMSPARK_AGENT_PATH}" tray
EOF
        chmod +x "${APP_DIR}/Contents/MacOS/CMspark Agent"

        cat > "${APP_DIR}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>CMspark Agent</string>
    <key>CFBundleIdentifier</key>
    <string>com.cmspark.tray-agent</string>
    <key>CFBundleName</key>
    <string>CMspark Agent</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSBackgroundOnly</key>
    <true/>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST
    }

    if [[ -f "${APP_DIR}/Contents/Info.plist" ]]; then
        if ! grep -q "LSUIElement" "${APP_DIR}/Contents/Info.plist"; then
            sed -i '' 's|</dict>|    <key>LSUIElement</key>\n    <true/>\n</dict>|' "${APP_DIR}/Contents/Info.plist" || true
        fi
    fi

    info "Tray launcher created at: ${APP_DIR}"
fi

if [[ "$PLATFORM" == "linux" ]]; then
    info "Linux menubar: no separate menubar service needed (use daemon service)"
fi

fi # end menubar-only / all

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "  CMspark Installation Complete"
echo "========================================"
echo ""
echo "  Platform      : ${PLATFORM}"
echo "  Mode          : ${MODE}"
echo "  Data directory: ${DATA_DIR}"
echo "  Logs directory: ${LOGS_DIR}"
if [[ "$PLATFORM" == "macos" ]]; then
    echo "  Daemon label  : ${LABEL}"
    echo "  Daemon plist  : ${TARGET_PLIST}"
    echo "  Menubar label : ${MENUBAR_LABEL}"
    echo "  Menubar plist : ${TARGET_MENUBAR_PLIST}"
    echo "  Tray app      : ${APP_DIR}"
    echo ""
    echo "  Commands:"
    echo "    launchctl start ${LABEL}"
    echo "    launchctl stop  ${LABEL}"
    echo "    launchctl list | grep cmspark"
fi
if [[ "$PLATFORM" == "linux" ]]; then
    echo "  Service name  : ${SERVICE_NAME}"
    echo "  Service path  : ${TARGET_SERVICE}"
    echo ""
    echo "  Commands:"
    echo "    systemctl --user start   ${SERVICE_NAME}"
    echo "    systemctl --user stop    ${SERVICE_NAME}"
    echo "    systemctl --user status  ${SERVICE_NAME}"
    echo "    journalctl --user -u     ${SERVICE_NAME}"
fi
echo ""
echo "  To uninstall, run:"
echo "    ${SCRIPT_DIR}/uninstall-daemon.sh"
echo ""
