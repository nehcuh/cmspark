#!/bin/bash
# CMspark Menu Bar Launcher Build Script
# =======================================
# Builds the "CMspark Agent.app" menu-bar launcher from source.
# Typically invoked by install-daemon.sh; can also be run standalone
# for development or CI packaging.
#
# Usage: ./build-menu-bar.sh [output-dir]
#   output-dir  Directory where "CMspark Agent.app" will be created.
#               Defaults to the current directory.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${1:-${SCRIPT_DIR}}"
APP_NAME="CMspark Agent.app"
APP_PATH="${OUTPUT_DIR}/${APP_NAME}"
LAUNCHER_SCRIPT="${SCRIPT_DIR}/menu-bar-launcher.sh"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '[INFO]  %s\n' "$*"; }
warn()  { printf '[WARN]  %s\n' "$*" >&2; }
error() { printf '[ERROR] %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# 1. Validate prerequisites
# ---------------------------------------------------------------------------
info "Building ${APP_NAME}..."

if ! command -v cmspark-agent >/dev/null 2>&1; then
    warn "cmspark-agent not found in PATH. The built app will still work"
    warn "as long as cmspark-agent is installed before the app is launched."
fi

if [[ ! -f "${LAUNCHER_SCRIPT}" ]]; then
    error "Launcher script not found: ${LAUNCHER_SCRIPT}"
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Clean previous build
# ---------------------------------------------------------------------------
if [[ -d "${APP_PATH}" ]]; then
    info "Removing previous build: ${APP_PATH}"
    rm -rf "${APP_PATH}"
fi

# ---------------------------------------------------------------------------
# 3. Build via osacompile (preferred) or fallback to manual bundle
# ---------------------------------------------------------------------------
info "Creating app bundle at: ${APP_PATH}"

# Detect actual cmspark-agent path for embedding
CMSPARK_AGENT_PATH=""
if command -v cmspark-agent >/dev/null 2>&1; then
    CMSPARK_AGENT_PATH="$(command -v cmspark-agent)"
fi

if command -v osacompile >/dev/null 2>&1 && [[ -n "${CMSPARK_AGENT_PATH}" ]]; then
    # Use osacompile to create a proper AppleScript .app
    OSASCRIPT_SRC="
on run
    do shell script \"${CMSPARK_AGENT_PATH} menu-bar\"
end run

on open theFiles
    do shell script \"${CMSPARK_AGENT_PATH} menu-bar\"
end open
"
    echo "${OSASCRIPT_SRC}" | osacompile -o "${APP_PATH}" 2>/dev/null || {
        warn "osacompile failed; falling back to manual bundle."
        osacompile_failed=true
    }
else
    osacompile_failed=true
fi

# Fallback: manual .app bundle structure
if [[ "${osacompile_failed:-false}" == true ]]; then
    mkdir -p "${APP_PATH}/Contents/MacOS"

    # Copy the launcher script as the executable
    cp "${LAUNCHER_SCRIPT}" "${APP_PATH}/Contents/MacOS/CMspark Agent"
    chmod +x "${APP_PATH}/Contents/MacOS/CMspark Agent"

    # Write Info.plist
    cat > "${APP_PATH}/Contents/Info.plist" <<'EOF'
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
fi

# Ensure LSUIElement is set (hide from Dock)
if [[ -f "${APP_PATH}/Contents/Info.plist" ]]; then
    if ! grep -q "LSUIElement" "${APP_PATH}/Contents/Info.plist"; then
        sed -i '' 's|</dict>|    <key>LSUIElement</key>\n    <true/>\n</dict>|' "${APP_PATH}/Contents/Info.plist" || true
    fi
fi

# ---------------------------------------------------------------------------
# 4. Verify bundle structure
# ---------------------------------------------------------------------------
if [[ ! -d "${APP_PATH}/Contents/MacOS" ]]; then
    error "App bundle structure is incomplete."
    exit 1
fi

info "Build complete: ${APP_PATH}"
