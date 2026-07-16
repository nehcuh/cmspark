#!/bin/bash
# CMspark distribution packager
#
# Usage: scripts/package.sh [macos-arm64|macos-x64|windows-x64|linux-x64]
# Output: dist-package/cmspark-v{version}-{platform}.zip
#
set -euo pipefail

# --- Configuration ---
NODE_VERSION="v22.16.0"
NODE_MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Git Bash on windows-latest returns MSYS-style paths (e.g. /d/a/cmspark) that
# Windows Node cannot resolve in require()/fs — the very first `node -p` below
# would throw MODULE_NOT_FOUND. Convert ROOT_DIR (and every path derived from
# it — STAGING, CACHE_DIR, plus the temp dir in the 7z fallback) to MIXED form
# (D:/a/cmspark), which BOTH MSYS bash tools (cp/rm/curl/du/…) AND Windows Node
# accept. No-op on macOS/Linux, where cygpath is absent and Unix paths already
# work everywhere.
to_mixed() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}
ROOT_DIR="$(to_mixed "${ROOT_DIR}")"

# --- Platform detection ---
if [ -z "${1:-}" ]; then
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  [ "$OS" = "darwin" ] && OS="macos"
  [ "$ARCH" = "x86_64" ] && ARCH="x64"
  PLATFORM="${OS}-${ARCH}"
else
  PLATFORM="$1"
fi

VERSION="$(node -p "require('${ROOT_DIR}/companion/package.json').version")"
STAGING="${ROOT_DIR}/dist-package/cmspark-${PLATFORM}"
CACHE_DIR="${ROOT_DIR}/dist-package/.cache"
ZIP_NAME="cmspark-v${VERSION}-${PLATFORM}.zip"

echo "=== CMspark Package Builder ==="
echo "Platform:  ${PLATFORM}"
echo "Version:   ${VERSION}"
echo "Output:    dist-package/${ZIP_NAME}"
echo ""

# --- Step 1: Build ---
echo "[1/9] Building companion..."
cd "${ROOT_DIR}/companion"
npm run build 2>&1 | tail -1

echo "[2/9] Building Chrome extension..."
cd "${ROOT_DIR}/chrome-extension"
npm run build 2>&1 | tail -1

# --- Step 2: Bundle ---
echo "[3/9] Bundling with esbuild..."
cd "${ROOT_DIR}/companion"
npx --yes esbuild dist/index.js \
  --bundle --platform=node --target=node22 \
  --external:node-notifier --external:systray2 \
  --external:canvas --external:pdfjs-dist \
  --outfile=dist/cmspark-agent.js 2>&1 | tail -1

# --- Step 3: Stage files ---
echo "[4/9] Staging distribution files..."
cd "${ROOT_DIR}"
rm -rf "${STAGING}"
mkdir -p "${STAGING}"

# Main bundle
cp companion/dist/cmspark-agent.js "${STAGING}/"

# WASM
cp companion/node_modules/sql.js/dist/sql-wasm.wasm "${STAGING}/"

# Builtin skills
cp -r companion/builtin-skills "${STAGING}/"

# Assets (tray icons)
if [ -d companion/assets ]; then
  cp -r companion/assets "${STAGING}/"
fi

# Chrome extension
cp -r chrome-extension/build/chrome-mv3-prod "${STAGING}/chrome-extension"

# External native dependencies — node-notifier and systray2 have native binaries
# that can't be bundled, so we ship their full dependency tree
mkdir -p "${STAGING}/node_modules"
for pkg in node-notifier systray2; do
  if [ -d "companion/node_modules/${pkg}" ]; then
    cp -r "companion/node_modules/${pkg}" "${STAGING}/node_modules/"
  fi
done

# Copy transitive dependencies by walking the require graph
cd companion
node -e "
const fs = require('fs');
const path = require('path');
const nm = 'node_modules';
const dest = '${STAGING}/node_modules';
const visited = new Set();
function copyDeps(pkgName) {
  if (visited.has(pkgName)) return;
  visited.add(pkgName);
  try {
    const pkgJson = require.resolve(pkgName + '/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    if (pkg.dependencies) {
      for (const dep of Object.keys(pkg.dependencies)) {
        const src = path.join(nm, dep);
        const dst = path.join(dest, dep);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.cpSync(src, dst, {recursive: true});
        }
        copyDeps(dep);
      }
    }
  } catch {}
}
['node-notifier', 'systray2'].forEach(copyDeps);
console.log('Copied ' + visited.size + ' transitive deps');
" 2>&1
cd "${ROOT_DIR}"

# --- Step 4: Strip cross-platform binaries ---
echo "[5/9] Stripping non-target platform binaries..."
case "${PLATFORM}" in
  macos-*)
    rm -f "${STAGING}/node_modules/systray2/traybin/tray_windows_release.exe"
    rm -f "${STAGING}/node_modules/systray2/traybin/tray_linux_release"
    rm -f "${STAGING}/node_modules/systray2/traybin/tray_darwin_release"
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/snoreToast" 2>/dev/null || true
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/notifu" 2>/dev/null || true
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/mac.noindex" 2>/dev/null || true
    if [ -f companion/dist/cmspark-tray ]; then
      cp companion/dist/cmspark-tray "${STAGING}/"
    fi
    # Phase 1 W5-W8: cmspark-host Swift binary + precompiled .scpt scripts.
    # Without these, host_read/host_write tools ENOENT at runtime.
    if [ -f companion/dist/cmspark-host ]; then
      cp companion/dist/cmspark-host "${STAGING}/"
      mkdir -p "${STAGING}/host-scripts"
      cp companion/dist/host-scripts/*.scpt "${STAGING}/host-scripts/" 2>/dev/null || true
    else
      echo "[package] WARNING: companion/dist/cmspark-host not built — run 'npm run build:host' in companion/ first"
    fi
    ;;
  windows-*)
    rm -f "${STAGING}/node_modules/systray2/traybin/tray_darwin_release"
    rm -f "${STAGING}/node_modules/systray2/traybin/tray_linux_release"
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/mac.noindex" 2>/dev/null || true
    # ARM64: systray2 has no win32-arm64 binary; tray-adapter will fallback to readline
    if [ "${PLATFORM}" = "windows-arm64" ]; then
      echo "  NOTE: Windows ARM64 has no systray2 binary — will use readline fallback"
    fi
    ;;
  linux-*)
    rm -f "${STAGING}/node_modules/systray2/traybin/tray_darwin_release"
    rm -f "${STAGING}/node_modules/systray2/traybin/tray_windows_release.exe"
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/mac.noindex" 2>/dev/null || true
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/snoreToast" 2>/dev/null || true
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/notifu" 2>/dev/null || true
    ;;
esac

# --- Step 5: Download Node.js runtime ---
echo "[6/9] Downloading Node.js ${NODE_VERSION} for ${PLATFORM}..."
case "${PLATFORM}" in
  macos-arm64) NODE_ARCH="darwin-arm64" ;;
  macos-x64)   NODE_ARCH="darwin-x64" ;;
  windows-x64) NODE_ARCH="win-x64" ;;
  linux-x64)   NODE_ARCH="linux-x64" ;;
  linux-arm64) NODE_ARCH="linux-arm64" ;;
  *) echo "ERROR: Unsupported platform: ${PLATFORM}"; exit 1 ;;
esac

CACHE_TAR="${CACHE_DIR}/node-${NODE_VERSION}-${NODE_ARCH}.tar.gz"
mkdir -p "${CACHE_DIR}"

# H8 (audit 2026-07-09): verify the Node archive's sha256 against nodejs.org's
# SHASUMS256.txt before extracting it into the build. Without this, a poisoned
# NODE_MIRROR (env-overridable) or a MITM on the download could substitute a
# trojaned node binary that exfiltrates config.json on first run. Fetched fresh
# each build (small file) so a mirror switch is never served from stale cache.
#
# TRUST ANCHOR: the manifest is fetched from the CANONICAL nodejs.org, NOT from
# NODE_MIRROR. This is the whole point of the check — fetching the manifest
# from the same env-overridable mirror as the archive would let a poisoned
# mirror serve a matching manifest for its own trojaned archive. NODE_SHASUMS_MIRROR
# defaults to nodejs.org and is separately overridable ONLY for a fully-offline,
# operator-trusted mirror.
NODE_SHASUMS_MIRROR="${NODE_SHASUMS_MIRROR:-https://nodejs.org/dist}"
NODE_SHASUMS="${CACHE_DIR}/SHASUMS256-${NODE_VERSION}.txt"
echo "  Fetching SHASUMS256.txt for Node ${NODE_VERSION} from ${NODE_SHASUMS_MIRROR}..."
curl -fSL --retry 3 "${NODE_SHASUMS_MIRROR}/${NODE_VERSION}/SHASUMS256.txt" -o "${NODE_SHASUMS}"

if [ "${PLATFORM}" = "windows-x64" ]; then
  CACHE_ZIP="${CACHE_DIR}/node-${NODE_VERSION}-${NODE_ARCH}.zip"
  if [ ! -f "${CACHE_ZIP}" ]; then
    echo "  Downloading..."
    curl -fSL --retry 3 "${NODE_MIRROR}/${NODE_VERSION}/node-v${NODE_VERSION#v}-${NODE_ARCH}.zip" -o "${CACHE_ZIP}"
  fi
  bash "${ROOT_DIR}/scripts/verify-node.sh" "${CACHE_ZIP}" "${NODE_SHASUMS}" "Node ${NODE_VERSION} ${NODE_ARCH} (.zip)"
  if command -v unzip >/dev/null 2>&1; then
    ( cd "${STAGING}" && unzip -jo "${CACHE_ZIP}" "*/node.exe" )
  elif command -v 7z >/dev/null 2>&1; then
    # Git Bash on windows-latest does not reliably ship Info-ZIP unzip, but
    # 7-Zip is always preinstalled. Extract to a temp dir then move node.exe
    # flat into staging (matches `unzip -jo` junk-paths behavior).
    tmp_extract="$(to_mixed "$(mktemp -d)")"
    7z x "${CACHE_ZIP}" -o"${tmp_extract}" -bd -y >/dev/null
    mv "${tmp_extract}"/node-*/node.exe "${STAGING}/node.exe"
    rm -rf "${tmp_extract}"
  else
    echo "ERROR: neither unzip nor 7z available to extract Node runtime" >&2
    exit 1
  fi
  echo "  node.exe: $(du -h "${STAGING}/node.exe" | cut -f1)"
else
  # Download official Node.js binary for consistent universal/fat builds
  NEED_DOWNLOAD=true
  if [ "${NEED_DOWNLOAD}" = "true" ]; then
    if [ ! -f "${CACHE_TAR}" ]; then
      echo "  Downloading..."
      curl -fSL --retry 3 "${NODE_MIRROR}/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_ARCH}.tar.gz" -o "${CACHE_TAR}"
    fi
    bash "${ROOT_DIR}/scripts/verify-node.sh" "${CACHE_TAR}" "${NODE_SHASUMS}" "Node ${NODE_VERSION} ${NODE_ARCH} (.tar.gz)"
    tar xzf "${CACHE_TAR}" -C "${STAGING}" --include="*/bin/node" --strip-components=2 2>/dev/null || \
    tar xzf "${CACHE_TAR}" -C "${STAGING}" --wildcards "*/bin/node" --strip-components=2 2>/dev/null || {
      cd "${STAGING}"
      tar xzf "${CACHE_TAR}"
      mv "node-${NODE_VERSION}-${NODE_ARCH}/bin/node" . 2>/dev/null || true
      rm -rf "node-${NODE_VERSION}-${NODE_ARCH}" 2>/dev/null || true
      cd "${ROOT_DIR}"
    }
    if [ -f "${STAGING}/bin/node" ]; then mv "${STAGING}/bin/node" "${STAGING}/node"; rmdir "${STAGING}/bin" 2>/dev/null || true; fi
    chmod +x "${STAGING}/node"
  fi
  echo "  node: $(du -h "${STAGING}/node" | cut -f1)"
fi

# --- Step 6: Platform-specific launch scripts ---
echo "[7/9] Adding launch scripts..."
if [[ "${PLATFORM}" == windows* ]]; then
  cp companion/install.bat "${STAGING}/" 2>/dev/null || true
  cp companion/launch.bat "${STAGING}/" 2>/dev/null || true
  cp companion/launch-hidden.vbs "${STAGING}/" 2>/dev/null || true
  cp companion/uninstall.bat "${STAGING}/" 2>/dev/null || true
  cp scripts/install-daemon.ps1 "${STAGING}/" 2>/dev/null || true
else
  cp scripts/launch-companion.sh "${STAGING}/launch-companion.sh"
  chmod +x "${STAGING}/launch-companion.sh"
  ln -sf launch-companion.sh "${STAGING}/cmspark-agent"
fi

cp companion/README.txt "${STAGING}/" 2>/dev/null || true

# --- Step 7: Package size summary ---
echo "[8/9] Package summary:"
echo "  $(du -sh "${STAGING}" | cut -f1) total"

# --- Step 8: Zip ---
echo "[9/9] Compressing..."
cd "${ROOT_DIR}/dist-package"
rm -f "${ZIP_NAME}"
if command -v zip >/dev/null 2>&1; then
  zip -rq "${ZIP_NAME}" "cmspark-${PLATFORM}"
elif command -v 7z >/dev/null 2>&1; then
  # Git Bash on windows-latest does not reliably ship Info-ZIP zip; 7-Zip is
  # always preinstalled. -tzip produces a standard zip; -bd disables the
  # progress bar (CI logs). Output layout matches `zip -rq dir`.
  7z a -tzip -bd "${ZIP_NAME}" "cmspark-${PLATFORM}" >/dev/null
else
  echo "ERROR: neither zip nor 7z available to create artifact" >&2
  exit 1
fi
echo "  $(du -sh "${ZIP_NAME}" | cut -f1) compressed"

echo ""
echo "=== Done: dist-package/${ZIP_NAME} ==="
