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

# Stage platform-trimmed onnxruntime-node (+ onnxruntime-common) next to the
# bundle. Full npm package is multi-arch (~259MB); we ship only package.json +
# dist/ + bin/napi-v6/<os>/<arch> (mirrors scripts/build-windows-exe.ps1).
# Returns 0 on success, 1 if source missing or native payload absent.
stage_onnxruntime() {
  local ort_os="$1"   # darwin | win32 | linux
  local ort_arch="$2" # arm64 | x64
  local ort_src="${ROOT_DIR}/companion/node_modules/onnxruntime-node"
  local common_src="${ROOT_DIR}/companion/node_modules/onnxruntime-common"
  local ort_dest="${STAGING}/node_modules/onnxruntime-node"
  local common_dest="${STAGING}/node_modules/onnxruntime-common"
  local native_src="${ort_src}/bin/napi-v6/${ort_os}/${ort_arch}"

  if [ ! -d "${ort_src}" ]; then
    echo "  WARNING: onnxruntime-node not installed under companion/node_modules" >&2
    return 1
  fi
  if [ ! -d "${native_src}" ]; then
    echo "  WARNING: onnxruntime-node native payload missing: bin/napi-v6/${ort_os}/${ort_arch}" >&2
    return 1
  fi

  mkdir -p "${ort_dest}/bin/napi-v6/${ort_os}/${ort_arch}"
  cp "${ort_src}/package.json" "${ort_dest}/"
  cp -R "${ort_src}/dist" "${ort_dest}/dist"
  cp -R "${native_src}/." "${ort_dest}/bin/napi-v6/${ort_os}/${ort_arch}/"
  if [ -f "${ort_src}/LICENSE" ]; then cp "${ort_src}/LICENSE" "${ort_dest}/"; fi

  if [ -d "${common_src}" ]; then
    mkdir -p "${common_dest}"
    cp "${common_src}/package.json" "${common_dest}/"
    cp -R "${common_src}/dist" "${common_dest}/dist"
  else
    echo "  WARNING: onnxruntime-common missing — onnxruntime-node dist/ needs it at runtime" >&2
    return 1
  fi

  local ort_bytes
  ort_bytes="$(du -sk "${ort_dest}" | awk '{print $1}')"
  # ~70MB budget for win32/x64; other platforms similar
  if [ "${ort_bytes}" -gt 72000 ]; then
    echo "ERROR: staged onnxruntime-node is ${ort_bytes}KB (>70MB budget)" >&2
    return 1
  fi
  echo "  onnxruntime-node ${ort_os}/${ort_arch}: $((ort_bytes / 1024))MB (trimmed)"
  return 0
}

echo "=== CMspark Package Builder ==="
echo "Platform:  ${PLATFORM}"
echo "Version:   ${VERSION}"
echo "Output:    dist-package/${ZIP_NAME}"
echo ""

# --- Step 1: Build (skipped in CMSPARK_PACKAGE_GATE_ONLY test mode) ---
if [ "${CMSPARK_PACKAGE_GATE_ONLY:-}" = "1" ]; then
  echo "[1/9] GATE-ONLY mode: skipping companion/extension build"
else
  echo "[1/9] Building companion..."
  cd "${ROOT_DIR}/companion"
  npm run build 2>&1 | tail -1

  echo "[2/9] Building Chrome extension..."
  cd "${ROOT_DIR}/chrome-extension"
  npm run build 2>&1 | tail -1
fi

# --- Step 1b: macOS host binary + scripts (hard-required for macos packages) ---
# P0-D: never ship a macOS zip without cmspark-host + precompiled .scpt (and
# cmspark-tray on arm64). Soft WARNING was the OPS-2 packaging hole.
if [[ "${PLATFORM}" == macos-* ]]; then
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "ERROR: packaging ${PLATFORM} requires macOS (swiftc/osacompile for cmspark-host)" >&2
    exit 1
  fi
  if [ "${CMSPARK_SKIP_HOST_BUILD:-}" != "1" ]; then
    echo "[2b/9] Building cmspark-host (npm run build:host)..."
    cd "${ROOT_DIR}/companion"
    npm run build:host
  else
    echo "[2b/9] Skipping build:host (CMSPARK_SKIP_HOST_BUILD=1 — test-only)"
  fi
  if [ ! -f "${ROOT_DIR}/companion/dist/cmspark-host" ]; then
    echo "ERROR: companion/dist/cmspark-host missing after build:host — macOS package refuses to ship without host binary" >&2
    exit 1
  fi
  scpt_count=0
  for _scpt in "${ROOT_DIR}/companion/dist/host-scripts/"*.scpt; do
    if [ -f "${_scpt}" ]; then scpt_count=$((scpt_count + 1)); fi
  done
  if [ "${scpt_count}" -eq 0 ]; then
    echo "ERROR: companion/dist/host-scripts/*.scpt missing — host_read/host_write would ENOENT at runtime" >&2
    exit 1
  fi
  if [ "${PLATFORM}" = "macos-arm64" ] && [ ! -f "${ROOT_DIR}/companion/dist/cmspark-tray" ]; then
    echo "ERROR: companion/dist/cmspark-tray missing — macos-arm64 package requires Swift tray binary" >&2
    exit 1
  fi
  if [ "${CMSPARK_PACKAGE_GATE_ONLY:-}" = "1" ]; then
    echo "GATE-ONLY: macOS host/tray/scpt gates passed — exiting 0 before full package"
    exit 0
  fi
fi

# Cross-platform gate-only: windows host-scripts-win non-empty (no full package).
if [ "${CMSPARK_PACKAGE_GATE_ONLY:-}" = "1" ] && [[ "${PLATFORM}" == windows-* ]]; then
  win_src="${ROOT_DIR}/companion/src/host-use/win/scripts"
  win_count=0
  for _ps1 in "${win_src}/"*.ps1; do
    if [ -f "${_ps1}" ]; then win_count=$((win_count + 1)); fi
  done
  if [ "${win_count}" -eq 0 ]; then
    echo "ERROR: host-scripts-win source empty (${win_src})" >&2
    exit 1
  fi
  echo "GATE-ONLY: windows host-scripts-win has ${win_count} ps1 — exiting 0"
  exit 0
fi

if [ "${CMSPARK_PACKAGE_GATE_ONLY:-}" = "1" ]; then
  echo "GATE-ONLY: no further gates for ${PLATFORM} — exiting 0"
  exit 0
fi

# --- Step 2: Bundle ---
echo "[3/9] Bundling with esbuild..."
cd "${ROOT_DIR}/companion"
# onnxruntime-node is native; keep external and stage a platform-trimmed
# node_modules copy (mirrors scripts/build-windows-exe.ps1).
npx --yes esbuild dist/index.js \
  --bundle --platform=node --target=node22 \
  --external:node-notifier --external:systray2 \
  --external:canvas --external:pdfjs-dist \
  --external:onnxruntime-node \
  --outfile=dist/cmspark-agent.js 2>&1 | tail -1

# TinyClick worker sidecar (eval-loaded at runtime; same trust level as ORT).
if [ -f dist/computer/tinyclick-worker.js ]; then
  npx --yes esbuild dist/computer/tinyclick-worker.js \
    --bundle --platform=node --target=node22 \
    --external:onnxruntime-node \
    --outfile=dist/tinyclick-worker.js 2>&1 | tail -1
fi

# --- Step 3: Stage files ---
echo "[4/9] Staging distribution files..."
cd "${ROOT_DIR}"
rm -rf "${STAGING}"
mkdir -p "${STAGING}"

# Main bundle
cp companion/dist/cmspark-agent.js "${STAGING}/"

# TinyClick worker sidecar (if built above)
if [ -f companion/dist/tinyclick-worker.js ]; then
  cp companion/dist/tinyclick-worker.js "${STAGING}/"
fi

# WASM
cp companion/node_modules/sql.js/dist/sql-wasm.wasm "${STAGING}/"

# Builtin skills
cp -r companion/builtin-skills "${STAGING}/"

# TinyClick model manifest — must sit next to cmspark-agent.js so
# defaultManifestPath() candidate 3 (__dirname/models.manifest.json) hits.
# Without this, all 3 candidates miss and fallback returns
# "<bundle>/../../models.manifest.json" → UI shows ENOENT for that path
# and the download/license gate can't read provenance hashes.
cp companion/models.manifest.json "${STAGING}/"

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
    # Hard-gated above — copy is unconditional fail-closed.
    cp companion/dist/cmspark-host "${STAGING}/"
    mkdir -p "${STAGING}/host-scripts"
    cp companion/dist/host-scripts/*.scpt "${STAGING}/host-scripts/"
    if [ ! -f "${STAGING}/cmspark-host" ]; then
      echo "ERROR: failed to stage cmspark-host" >&2
      exit 1
    fi
    # shellcheck disable=SC2012
    if [ "$(ls -1 "${STAGING}/host-scripts/"*.scpt 2>/dev/null | wc -l | tr -d ' ')" = "0" ]; then
      echo "ERROR: failed to stage host-scripts/*.scpt" >&2
      exit 1
    fi
    if [ "${PLATFORM}" = "macos-arm64" ]; then
      cp companion/dist/cmspark-tray "${STAGING}/"
      if [ ! -f "${STAGING}/cmspark-tray" ]; then
        echo "ERROR: failed to stage cmspark-tray for macos-arm64" >&2
        exit 1
      fi
    elif [ -f companion/dist/cmspark-tray ]; then
      cp companion/dist/cmspark-tray "${STAGING}/"
    fi
    # Platform-trimmed ORT for TinyClick (darwin/<arch>). Soft on non-x64 CI
    # cross-packs; macOS arm64 local builds typically have the dylib present.
    if [ "${PLATFORM}" = "macos-arm64" ]; then
      stage_onnxruntime "darwin" "arm64" || echo "  NOTE: ORT darwin/arm64 not staged — TinyClick local model unavailable in this zip"
    else
      stage_onnxruntime "darwin" "x64" || echo "  NOTE: ORT darwin/x64 not staged — TinyClick local model unavailable in this zip"
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
    # Windows host-use PowerShell scripts — resolveWinScript candidate 0 looks in
    # <exe-dir>/host-scripts-win/. Empty staging is a hard fail (P0-D).
    WIN_SCRIPTS_SRC="${ROOT_DIR}/companion/src/host-use/win/scripts"
    if [ ! -d "${WIN_SCRIPTS_SRC}" ]; then
      echo "ERROR: ${WIN_SCRIPTS_SRC} missing — host_read/host_write will ENOENT in the package" >&2
      exit 1
    fi
    mkdir -p "${STAGING}/host-scripts-win"
    # Prefer already-staged dist copy when present; else source tree.
    if ls "${ROOT_DIR}/companion/dist/host-scripts-win/"*.ps1 >/dev/null 2>&1; then
      cp "${ROOT_DIR}/companion/dist/host-scripts-win/"*.ps1 "${STAGING}/host-scripts-win/"
    else
      cp "${WIN_SCRIPTS_SRC}/"*.ps1 "${STAGING}/host-scripts-win/"
    fi
    # shellcheck disable=SC2012
    win_ps1_count="$(ls -1 "${STAGING}/host-scripts-win/"*.ps1 2>/dev/null | wc -l | tr -d ' ')"
    if [ "${win_ps1_count}" = "0" ]; then
      echo "ERROR: host-scripts-win/*.ps1 empty after staging — refusing to ship" >&2
      exit 1
    fi
    echo "  host-scripts-win/: ${win_ps1_count} ps1 scripts"
    # TinyClick worker + win32/x64 ORT are required on windows-x64.
    if [ "${PLATFORM}" = "windows-x64" ]; then
      if [ ! -f "${STAGING}/tinyclick-worker.js" ]; then
        echo "ERROR: tinyclick-worker.js not staged — build dist/computer/tinyclick-worker.js first" >&2
        exit 1
      fi
      if ! stage_onnxruntime "win32" "x64"; then
        echo "ERROR: onnxruntime-node win32/x64 staging failed — TinyClick unavailable; refusing windows-x64 ship without ORT" >&2
        exit 1
      fi
    fi
    ;;
  linux-*)
    rm -f "${STAGING}/node_modules/systray2/traybin/tray_darwin_release"
    rm -f "${STAGING}/node_modules/systray2/traybin/tray_windows_release.exe"
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/mac.noindex" 2>/dev/null || true
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/snoreToast" 2>/dev/null || true
    rm -rf "${STAGING}/node_modules/node-notifier/vendor/notifu" 2>/dev/null || true
    if [ "${PLATFORM}" = "linux-arm64" ]; then
      stage_onnxruntime "linux" "arm64" || echo "  NOTE: ORT linux/arm64 not staged — TinyClick local model unavailable in this zip"
    else
      stage_onnxruntime "linux" "x64" || echo "  NOTE: ORT linux/x64 not staged — TinyClick local model unavailable in this zip"
    fi
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
