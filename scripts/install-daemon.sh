#!/bin/bash
# CMspark macOS Daemon Installer
# ================================
# Installs the CMspark Companion as a user-level launchd service.
# Run as the target user (no sudo required).
#
# Usage: ./install-daemon.sh

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
LABEL="com.cmspark.companion"
PLIST_NAME="${LABEL}.plist"
SOURCE_PLIST="$(cd "$(dirname "$0")" && pwd)/launchd/${PLIST_NAME}"
TARGET_PLIST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"
DATA_DIR="${HOME}/.cmspark-agent"
LOGS_DIR="${DATA_DIR}/logs"
APP_NAME="CMspark Agent.app"
# Prefer ~/Applications/ (user-local), fall back to /Applications/
if [[ -d "${HOME}/Applications" ]]; then
    APP_DIR="${HOME}/Applications/${APP_NAME}"
elif [[ -d "/Applications" ]]; then
    APP_DIR="/Applications/${APP_NAME}"
else
    APP_DIR="${HOME}/Applications/${APP_NAME}"
fi
CHECKSUM_FILE="${DATA_DIR}/.plist.sha256"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '[INFO]  %s\n' "$*"; }
warn()  { printf '[WARN]  %s\n' "$*" >&2; }
error() { printf '[ERROR] %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# 1. Verify cmspark-agent is available in PATH
# ---------------------------------------------------------------------------
info "Checking for cmspark-agent in PATH..."
if ! command -v cmspark-agent >/dev/null 2>&1; then
    error "cmspark-agent not found in PATH."
    error "Please install it first, e.g.: npm install -g cmspark-agent"
    exit 1
fi
CMSPARK_AGENT_PATH="$(command -v cmspark-agent)"
info "Found: ${CMSPARK_AGENT_PATH}"

# ---------------------------------------------------------------------------
# 2. Create data directory with restrictive permissions
# ---------------------------------------------------------------------------
info "Creating data directory: ${DATA_DIR}"
mkdir -p "${DATA_DIR}"
chmod 0700 "${DATA_DIR}"

# ---------------------------------------------------------------------------
# 3. Create logs directory with restrictive permissions
# ---------------------------------------------------------------------------
info "Creating logs directory: ${LOGS_DIR}"
mkdir -p "${LOGS_DIR}"
chmod 0700 "${LOGS_DIR}"

# ---------------------------------------------------------------------------
# 4. Copy plist and substitute {{HOME}} with real $HOME
# ---------------------------------------------------------------------------
info "Installing launchd plist: ${TARGET_PLIST}"
if [[ ! -f "${SOURCE_PLIST}" ]]; then
    error "Source plist not found: ${SOURCE_PLIST}"
    exit 1
fi

# Ensure LaunchAgents directory exists
mkdir -p "${HOME}/Library/LaunchAgents"

# Copy and replace placeholder; also replace the hard-coded binary path
# with the actual detected path so it works even when npm global bin
# is outside the usual locations.
sed -e "s|{{HOME}}|${HOME}|g" \
    -e "s|${HOME}/.cmspark-agent/bin/cmspark-agent|${CMSPARK_AGENT_PATH}|g" \
    "${SOURCE_PLIST}" > "${TARGET_PLIST}"

chmod 644 "${TARGET_PLIST}"

# ---------------------------------------------------------------------------
# 5. Generate SHA256 checksum of the installed plist
# ---------------------------------------------------------------------------
info "Generating plist checksum..."
shasum -a 256 "${TARGET_PLIST}" | awk '{print $1}' > "${CHECKSUM_FILE}"
chmod 600 "${CHECKSUM_FILE}"
info "Checksum written to: ${CHECKSUM_FILE}"

# ---------------------------------------------------------------------------
# 6. Unload any existing service (ignore errors if not loaded)
# ---------------------------------------------------------------------------
info "Unloading existing service (if any)..."
launchctl unload "${TARGET_PLIST}" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 7. Load the new service
# ---------------------------------------------------------------------------
info "Loading launchd service: ${LABEL}"
launchctl load "${TARGET_PLIST}"

# ---------------------------------------------------------------------------
# 8. Verify service is loaded
# ---------------------------------------------------------------------------
info "Verifying service status..."
if launchctl list | grep -q "^${LABEL}$"; then
    info "Service ${LABEL} is loaded."
else
    warn "Service may not be loaded yet; this is normal on first install."
fi

# ---------------------------------------------------------------------------
# 9. Create "CMspark Agent.app" menu-bar launcher
# ---------------------------------------------------------------------------
info "Creating menu-bar launcher: ${APP_DIR}"

# Remove old version if present
rm -rf "${APP_DIR}"

# Build a minimal AppleScript .app that calls cmspark-agent menu-bar
# We use osacompile to generate the binary .app bundle.
OSASCRIPT_SRC="
on run
    do shell script \"${CMSPARK_AGENT_PATH} menu-bar\"
end run

on open theFiles
    do shell script \"${CMSPARK_AGENT_PATH} menu-bar\"
end open
"

# osacompile creates the .app bundle
mkdir -p "$(dirname "${APP_DIR}")"
echo "${OSASCRIPT_SRC}" | osacompile -o "${APP_DIR}" 2>&1 || {
    warn "osacompile failed; falling back to shell-script wrapper."
    # Fallback: create a minimal .app structure with a shell script
    mkdir -p "${APP_DIR}/Contents/MacOS"
    cat > "${APP_DIR}/Contents/MacOS/CMspark Agent" <<EOF
#!/bin/bash
exec "${CMSPARK_AGENT_PATH}" menu-bar
EOF
    chmod +x "${APP_DIR}/Contents/MacOS/CMspark Agent"

    cat > "${APP_DIR}/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>CMspark Agent</string>
    <key>CFBundleIdentifier</key>
    <string>com.cmspark.menu-bar-agent</string>
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
EOF
}

# Hide from Dock (LSUIElement / LSBackgroundOnly)
# osacompile already sets these, but ensure they are present.
if [[ -f "${APP_DIR}/Contents/Info.plist" ]]; then
    # If the plist does not already contain LSUIElement, inject it.
    if ! grep -q "LSUIElement" "${APP_DIR}/Contents/Info.plist"; then
        # Insert before the closing </dict></plist>
        sed -i '' 's|</dict>|    <key>LSUIElement</key>\n    <true/>\n</dict>|' "${APP_DIR}/Contents/Info.plist" || true
    fi
fi

info "Menu-bar launcher created at: ${APP_DIR}"

# ---------------------------------------------------------------------------
# 10. Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "  CMspark Daemon Installation Complete"
echo "========================================"
echo ""
echo "  Service label : ${LABEL}"
echo "  Plist path    : ${TARGET_PLIST}"
echo "  Data directory: ${DATA_DIR}"
echo "  Logs directory: ${LOGS_DIR}"
echo "  Menu-bar app  : ${APP_DIR}"
echo ""
echo "  Commands:"
echo "    launchctl start ${LABEL}"
echo "    launchctl stop  ${LABEL}"
echo "    launchctl list | grep ${LABEL}"
echo ""
echo "  To uninstall, run:"
echo "    $(cd "$(dirname "$0")" && pwd)/uninstall-daemon.sh"
echo ""
