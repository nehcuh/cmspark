#!/usr/bin/env bash
# P0-D packaging gate tests.
#
# Asserts fail-closed host/tray/windows scripts packaging and honest release
# notes. Fast path uses CMSPARK_PACKAGE_GATE_ONLY + static file checks.
#
# Run: bash scripts/tests/test-package-gates.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PACKAGE_SH="${ROOT}/scripts/package.sh"
CREATE_DMG="${ROOT}/scripts/create-dmg.sh"
MAKEFILE="${ROOT}/Makefile"
RELEASE_YML="${ROOT}/.github/workflows/release.yml"
CI_YML="${ROOT}/.github/workflows/ci.yml"
PS1="${ROOT}/scripts/build-windows-exe.ps1"

PASS=0
FAIL=0

assert_eq() {
  if [ "${1}" = "${2}" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL: ${3} (expected=${1} actual=${2})" >&2
  fi
}

assert_match() {
  if echo "${2}" | grep -qE "${1}"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL: ${3} (pattern='${1}' not in haystack)" >&2
  fi
}

assert_file_has() {
  if grep -qE "${2}" "${1}"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL: ${3} (${1} missing /${2}/)" >&2
  fi
}

assert_file_lacks() {
  if grep -qE "${2}" "${1}"; then
    FAIL=$((FAIL + 1))
    echo "  FAIL: ${3} (${1} still has /${2}/)" >&2
  else
    PASS=$((PASS + 1))
  fi
}

# P0 OPS-01: was referenced but undefined — gates silently no-op'd under set -u
assert_file_exists() {
  if [ -f "${1}" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL: ${2} (missing file: ${1})" >&2
  fi
}

echo "=== P0-D package gate tests ==="
echo "Root: ${ROOT}"
echo ""

# --- Static: package.sh hard-fail (not WARNING) for missing host -------------
echo "[static] package.sh fail-closed host/tray"
assert_file_has "${PACKAGE_SH}" 'ERROR: companion/dist/cmspark-host missing' \
  "package.sh errors on missing cmspark-host"
assert_file_has "${PACKAGE_SH}" 'host-scripts/\*\.scpt missing' \
  "package.sh errors on missing scpt"
assert_file_has "${PACKAGE_SH}" 'cmspark-tray missing' \
  "package.sh errors on missing cmspark-tray (macos-arm64)"
assert_file_lacks "${PACKAGE_SH}" 'WARNING: companion/dist/cmspark-host not built' \
  "package.sh no longer soft-WARNINGs missing host"
# P2 esbuild SoT: externals live in companion/scripts/esbuild-bundle-args.json;
# package.sh invokes run-esbuild-bundle.mjs (must still keep ORT external / unstaged).
ESBUILD_ARGS="${ROOT}/companion/scripts/esbuild-bundle-args.json"
ESBUILD_RUNNER="${ROOT}/companion/scripts/run-esbuild-bundle.mjs"
assert_file_has "${ESBUILD_ARGS}" 'onnxruntime-node' \
  "esbuild-bundle-args.json externalizes onnxruntime-node (residual; not staged)"
assert_file_has "${PACKAGE_SH}" 'run-esbuild-bundle\.mjs' \
  "package.sh uses shared esbuild SoT runner"
assert_file_has "${ESBUILD_RUNNER}" 'esbuild-bundle-args\.json' \
  "run-esbuild-bundle.mjs loads esbuild-bundle-args.json"
assert_file_has "${ESBUILD_RUNNER}" 'win32-' \
  "run-esbuild-bundle.mjs resolves Windows @esbuild/win32-* esbuild.exe"

# --- Whisper binary auto-fetch SoT -------------------------------------------
echo "[static] whisper-binary auto-fetch SoT"
assert_file_exists "${ROOT}/companion/assets/whisper-binary.manifest.json" \
  "whisper-binary.manifest.json present"
assert_file_exists "${ROOT}/companion/scripts/fetch-whisper-binary.mjs" \
  "fetch-whisper-binary.mjs present"
assert_file_has "${ROOT}/scripts/build-windows-exe.ps1" 'fetch-whisper-binary' \
  "build-windows-exe.ps1 auto-fetches whisper when missing"
assert_file_has "${ROOT}/companion/src/voice/whisper-binary-pins.ts" 'b7c6dc2e999a80bc2d23cd4c76701211f392ae55d5cabdf0d45eb2ca4faf09af' \
  "win-x64 pin matches whisper.cpp v1.7.6 primary (lock-step with manifest)"
assert_file_has "${PACKAGE_SH}" 'host-scripts-win' \
  "package.sh stages host-scripts-win"
assert_file_has "${PACKAGE_SH}" 'qwen-vl-worker\.py' \
  "package.sh stages qwen-vl-worker.py (Qwen3-VL)"
assert_file_lacks "${PACKAGE_SH}" 'stage_onnxruntime' \
  "package.sh no longer stages onnxruntime-node"
assert_file_lacks "${PACKAGE_SH}" 'cp companion/dist/tinyclick' \
  "package.sh no longer copies tinyclick worker into staging"
assert_file_has "${PACKAGE_SH}" 'npm run build:host' \
  "package.sh invokes build:host"
assert_file_has "${PACKAGE_SH}" 'requires macOS \(swiftc/osacompile' \
  "package.sh hard-errors cross-OS macos packaging"

# --- Static: create-dmg.sh native MacOS/CMspark (D4 / A6 / DR-N2) ------------
echo "[static] create-dmg.sh native MacOS/CMspark (not bash launcher)"
assert_file_lacks "${CREATE_DMG}" 'env arch -arm64 /bin/bash' \
  "create-dmg must not install bash as main executable"
assert_file_has "${CREATE_DMG}" 'Contents/MacOS/CMspark' \
  "create-dmg installs native MacOS/CMspark"
assert_file_has "${CREATE_DMG}" 'A6 OK: single CDHash' \
  "create-dmg asserts CDHash equality for MacOS/CMspark and cmspark-host"
assert_file_has "${CREATE_DMG}" '__CMSPARK_VERSION__' \
  "create-dmg stamps Info.plist via __CMSPARK_VERSION__ placeholder"
assert_file_lacks "${CREATE_DMG}" 's/0\.2\.0/' \
  "create-dmg must not hardcode sed s/0.2.0/ (stale version trap)"
INFO_PLIST="${ROOT}/scripts/macos/Info.plist"
assert_file_has "${INFO_PLIST}" '__CMSPARK_VERSION__' \
  "Info.plist template uses __CMSPARK_VERSION__ placeholder"
assert_file_lacks "${INFO_PLIST}" '>[0-9]\+\.[0-9]\+\.[0-9]\+<' \
  "Info.plist template must not hardcode x.y.z (stamp at dmg time)"

# --- Static: Makefile package-macos depends on build-host --------------------
echo "[static] Makefile package-macos → build-host"
assert_file_has "${MAKEFILE}" '^build-host:' \
  "Makefile defines build-host target"
assert_file_has "${MAKEFILE}" 'package-macos:.*build-host' \
  "package-macos depends on build-host"

# --- Static: release.yml asserts + honest WS auth body -----------------------
echo "[static] release.yml content asserts + body"
assert_file_has "${RELEASE_YML}" 'Assert macOS zip has host' \
  "release.yml has macOS zip assert step"
assert_file_has "${RELEASE_YML}" 'Assert windows zip has host-scripts-win' \
  "release.yml has windows zip assert step"
assert_file_has "${RELEASE_YML}" 'cmspark-host' \
  "release.yml mentions cmspark-host in assert/body"
assert_file_has "${RELEASE_YML}" 'host-scripts-win' \
  "release.yml asserts/documents host-scripts-win"
assert_file_has "${RELEASE_YML}" 'qwen-vl-worker' \
  "release.yml documents qwen-vl-worker"
assert_file_lacks "${RELEASE_YML}" 'tinyclick-worker' \
  "release.yml no longer requires TinyClick worker"
assert_file_lacks "${RELEASE_YML}" 'shared-secret handshake is deferred' \
  "release.yml must not claim shared-secret deferred"
assert_file_lacks "${RELEASE_YML}" 'local-process shared-secret handshake is deferred' \
  "release.yml must not use old deferred handshake wording"
assert_file_has "${RELEASE_YML}" 'FIXED' \
  "release.yml body marks C1 as FIXED"
assert_file_has "${RELEASE_YML}" 'fail-closed' \
  "release.yml documents fail-closed packaging"

# --- Static: build-windows-exe.ps1 fail-closed host scripts + Qwen worker ----
echo "[static] build-windows-exe.ps1 fail-closed"
assert_file_has "${PS1}" 'Fail "win host-use scripts not found' \
  "ps1 Fails when win scripts missing"
assert_file_has "${PS1}" 'host-scripts-win/\*\.ps1 empty after staging' \
  "ps1 Fails when host-scripts-win empty"
assert_file_has "${PS1}" 'qwen-vl-worker\.py missing' \
  "ps1 Fails when qwen-vl-worker.py missing"
assert_file_lacks "${PS1}" 'WP5 local model layer required' \
  "ps1 no longer hard-requires ORT for TinyClick"
assert_file_has "${PS1}" 'package\.json' \
  "ps1 reads version from companion/package.json"
assert_file_lacks "${PS1}" 'CMspark-v0\.2\.0' \
  "ps1 header must not advertise stale 0.2.0 artifact names"
assert_file_has "${PS1}" '/DPRODUCT_VERSION=' \
  "ps1 injects PRODUCT_VERSION into NSIS"
assert_file_has "${PS1}" 'CMSPARK_ALLOW_VERSION_DRIFT' \
  "ps1 documents version-drift override for ext/companion lock-step"
assert_file_has "${PS1}" 'chrome-extension version' \
  "ps1 fail-closed on ext vs companion version mismatch (S52 N4)"
NSIS="${ROOT}/scripts/installer.nsi"
assert_file_has "${NSIS}" '!ifndef PRODUCT_VERSION' \
  "installer.nsi accepts /DPRODUCT_VERSION override"
# S52 N4: NSIS fallback PRODUCT_VERSION must equal companion/package.json version
COMP_VER="$(node -p "require('${ROOT}/companion/package.json').version" 2>/dev/null || true)"
if [ -n "${COMP_VER}" ]; then
  NSIS_FALLBACK="$(
    grep -E '^\s*!define PRODUCT_VERSION "' "${NSIS}" | head -1 | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/'
  )"
  assert_eq "${COMP_VER}" "${NSIS_FALLBACK}" \
    "installer.nsi fallback PRODUCT_VERSION must match companion/package.json (${COMP_VER})"
  EXT_VER="$(node -p "require('${ROOT}/chrome-extension/package.json').version" 2>/dev/null || true)"
  if [ -n "${EXT_VER}" ]; then
    assert_eq "${COMP_VER}" "${EXT_VER}" \
      "chrome-extension package.json version must lock-step with companion (${COMP_VER})"
  fi
else
  FAIL=$((FAIL + 1))
  echo "  FAIL: could not read companion/package.json version" >&2
fi

# --- Dynamic negative: missing cmspark-host → exit 1 -------------------------
echo "[dynamic] package.sh macos-arm64 with host deleted → exit 1"
HOST_BIN="${ROOT}/companion/dist/cmspark-host"
HOST_BAK=""
RELOCATED=0
if [ -e "${HOST_BIN}" ]; then
  HOST_BAK="$(mktemp "${TMPDIR:-/tmp}/cmspark-host.XXXXXX")"
  mv "${HOST_BIN}" "${HOST_BAK}"
  RELOCATED=1
fi

set +e
OUT="$(
  CMSPARK_SKIP_HOST_BUILD=1 CMSPARK_PACKAGE_GATE_ONLY=1 \
    bash "${PACKAGE_SH}" macos-arm64 2>&1
)"
RC=$?
set -e

if [ "${RELOCATED}" = "1" ] && [ -n "${HOST_BAK}" ]; then
  mv "${HOST_BAK}" "${HOST_BIN}"
fi

assert_eq 1 "${RC}" "missing cmspark-host must exit 1"
# On Darwin the host-binary gate fires; on Linux CI package.sh hard-fails earlier
# with "requires macOS (swiftc/osacompile…)" before the host file check (package.sh:~114).
if [ "$(uname -s)" = "Darwin" ]; then
  assert_match 'cmspark-host missing' "${OUT}" "error message mentions missing host"
else
  assert_match 'requires macOS|cmspark-host missing' "${OUT}" \
    "error mentions macOS requirement or missing host"
fi

# --- Dynamic positive gate-only (when artifacts present) ---------------------
if [ "$(uname -s)" = "Darwin" ] && [ -f "${HOST_BIN}" ] \
  && [ -f "${ROOT}/companion/dist/cmspark-tray" ] \
  && ls "${ROOT}/companion/dist/host-scripts/"*.scpt >/dev/null 2>&1; then
  echo "[dynamic] package.sh GATE-ONLY macos-arm64 with artifacts present → exit 0"
  set +e
  OUT_OK="$(
    CMSPARK_SKIP_HOST_BUILD=1 CMSPARK_PACKAGE_GATE_ONLY=1 \
      bash "${PACKAGE_SH}" macos-arm64 2>&1
  )"
  RC_OK=$?
  set -e
  assert_eq 0 "${RC_OK}" "present host/tray/scpt must pass gate-only"
  assert_match 'GATE-ONLY: macOS host/tray/scpt gates passed' "${OUT_OK}" \
    "gate-only success message"
else
  echo "[dynamic] skip positive macOS gate (artifacts not all present on this machine)"
fi

# --- Dynamic: windows host-scripts-win source non-empty (gate-only) ----------
echo "[dynamic] windows-x64 GATE-ONLY host-scripts-win non-empty"
set +e
OUT_WIN="$(
  CMSPARK_PACKAGE_GATE_ONLY=1 bash "${PACKAGE_SH}" windows-x64 2>&1
)"
RC_WIN=$?
set -e
assert_eq 0 "${RC_WIN}" "windows-x64 gate-only should pass when ps1 sources exist"
assert_match 'host-scripts-win' "${OUT_WIN}" "reports host-scripts-win status"
assert_match 'GATE-ONLY: windows' "${OUT_WIN}" "gate-only success prefix"

# --- Dynamic negative: empty win scripts → exit 1 (simulate via temp rename) -
WIN_SCRIPTS="${ROOT}/companion/src/host-use/win/scripts"
if [ -d "${WIN_SCRIPTS}" ]; then
  echo "[dynamic] windows gate fails if scripts dir missing"
  WIN_BAK="${WIN_SCRIPTS}.bak-p0d-test"
  # Avoid clobbering a leftover bak from a crashed prior run.
  if [ -e "${WIN_BAK}" ]; then
    echo "  FAIL: leftover ${WIN_BAK} — remove and re-run" >&2
    FAIL=$((FAIL + 1))
  else
    mv "${WIN_SCRIPTS}" "${WIN_BAK}"
    set +e
    OUT_WIN_FAIL="$(
      CMSPARK_PACKAGE_GATE_ONLY=1 bash "${PACKAGE_SH}" windows-x64 2>&1
    )"
    RC_WIN_FAIL=$?
    set -e
    mv "${WIN_BAK}" "${WIN_SCRIPTS}"
    assert_eq 1 "${RC_WIN_FAIL}" "missing win scripts dir must exit 1"
    assert_match 'host-scripts-win|empty|missing' "${OUT_WIN_FAIL}" \
      "error mentions host-scripts-win"
  fi
fi

# --- rg acceptance: no deferred WS auth text ---------------------------------
echo "[static] rg acceptance: no deferred WS-auth claims in release body"
if command -v rg >/dev/null 2>&1; then
  if rg -n 'WS auth.*deferred|shared-secret.*deferred|handshake is deferred' \
      "${RELEASE_YML}" >/dev/null 2>&1; then
    FAIL=$((FAIL + 1))
    echo "  FAIL: release.yml still has deferred WS-auth language" >&2
    rg -n 'deferred' "${RELEASE_YML}" >&2 || true
  else
    PASS=$((PASS + 1))
  fi
else
  if grep -E 'WS auth.*deferred|shared-secret.*deferred|handshake is deferred' \
      "${RELEASE_YML}" >/dev/null 2>&1; then
    FAIL=$((FAIL + 1))
    echo "  FAIL: release.yml still has deferred WS-auth language" >&2
  else
    PASS=$((PASS + 1))
  fi
fi

# --- Static: release body documents Qwen on-demand (not ORT/TinyClick ship) --
echo "[static] release.yml Qwen3-VL packaging story"
assert_file_has "${RELEASE_YML}" 'qwen-vl-worker' \
  "release body mentions qwen-vl-worker"
assert_file_has "${RELEASE_YML}" 'on demand' \
  "release body notes Qwen weights download on demand"
assert_file_lacks "${RELEASE_YML}" 'optional soft stage' \
  "release body no longer documents soft ORT stage"
assert_file_has "${CI_YML}" 'test-package-gates' \
  "ci.yml runs test-package-gates.sh"

# --- Dynamic: missing tray (macos-arm64) -------------------------------------
TRAY_BIN="${ROOT}/companion/dist/cmspark-tray"
if [ "$(uname -s)" = "Darwin" ] && [ -f "${TRAY_BIN}" ]; then
  echo "[dynamic] missing cmspark-tray → exit 1 (macos-arm64)"
  TRAY_BAK="$(mktemp "${TMPDIR:-/tmp}/cmspark-tray.XXXXXX")"
  mv "${TRAY_BIN}" "${TRAY_BAK}"
  set +e
  OUT_TRAY="$(
    CMSPARK_SKIP_HOST_BUILD=1 CMSPARK_PACKAGE_GATE_ONLY=1 \
      bash "${PACKAGE_SH}" macos-arm64 2>&1
  )"
  RC_TRAY=$?
  set -e
  mv "${TRAY_BAK}" "${TRAY_BIN}"
  assert_eq 1 "${RC_TRAY}" "missing tray must exit 1"
  assert_match 'cmspark-tray missing' "${OUT_TRAY}" "error mentions tray"
else
  echo "[dynamic] skip tray-missing test (no Darwin tray artifact)"
fi

# --- Dynamic: missing scpt ---------------------------------------------------
SCPT_DIR="${ROOT}/companion/dist/host-scripts"
if [ "$(uname -s)" = "Darwin" ] && ls "${SCPT_DIR}/"*.scpt >/dev/null 2>&1; then
  echo "[dynamic] missing host-scripts/*.scpt → exit 1"
  SCPT_BAK="${SCPT_DIR}.bak-p0d-nits"
  if [ -e "${SCPT_BAK}" ]; then
    echo "  FAIL: leftover ${SCPT_BAK}" >&2
    FAIL=$((FAIL + 1))
  else
    mv "${SCPT_DIR}" "${SCPT_BAK}"
    set +e
    OUT_SCPT="$(
      CMSPARK_SKIP_HOST_BUILD=1 CMSPARK_PACKAGE_GATE_ONLY=1 \
        bash "${PACKAGE_SH}" macos-arm64 2>&1
    )"
    RC_SCPT=$?
    set -e
    mv "${SCPT_BAK}" "${SCPT_DIR}"
    assert_eq 1 "${RC_SCPT}" "missing scpt must exit 1"
    assert_match 'scpt missing|host-scripts' "${OUT_SCPT}" "error mentions scpt"
  fi
else
  echo "[dynamic] skip scpt-missing test (no scpt artifacts)"
fi

# --- Dynamic: windows gate fails without qwen-vl-worker.py -------------------
QWEN_CANDIDATES=(
  "${ROOT}/companion/dist/computer/qwen-vl-worker.py"
  "${ROOT}/companion/src/computer/qwen-vl-worker.py"
)
HIDDEN_QWEN=()
for _qc in "${QWEN_CANDIDATES[@]}"; do
  if [ -f "${_qc}" ]; then
    _qb="$(mktemp "${TMPDIR:-/tmp}/qwen-vl-worker.XXXXXX")"
    mv "${_qc}" "${_qb}"
    HIDDEN_QWEN+=("${_qc}|${_qb}")
  fi
done
if [ "${#HIDDEN_QWEN[@]}" -gt 0 ]; then
  echo "[dynamic] windows-x64 GATE-ONLY fails without qwen-vl-worker.py"
  set +e
  OUT_QW="$(
    CMSPARK_PACKAGE_GATE_ONLY=1 bash "${PACKAGE_SH}" windows-x64 2>&1
  )"
  RC_QW=$?
  set -e
  for _pair in "${HIDDEN_QWEN[@]}"; do
    _orig="${_pair%%|*}"
    _bak="${_pair#*|}"
    mv "${_bak}" "${_orig}"
  done
  assert_eq 1 "${RC_QW}" "missing qwen-vl-worker must exit 1 on windows gate"
  assert_match 'qwen-vl-worker' "${OUT_QW}" "error mentions qwen-vl-worker"
else
  echo "[dynamic] skip qwen-worker-missing test (no qwen-vl-worker.py found)"
fi

# --- Static: package gates Qwen, not TinyClick/ORT ---------------------------
echo "[static] package.sh gates Qwen3-VL worker (not TinyClick/ORT)"
assert_file_has "${PACKAGE_SH}" 'Qwen3-VL locate hard-gate' \
  "package hard-gates qwen-vl-worker"
assert_file_lacks "${PACKAGE_SH}" 'onnxruntime-node not installed' \
  "package no longer errors on missing ORT"
assert_file_lacks "${PACKAGE_SH}" 'tinyclick-worker missing' \
  "package no longer errors on missing tinyclick-worker"
assert_file_has "${PS1}" 'qwen-vl-worker' \
  "build-windows-exe.ps1 stages qwen-vl-worker.py"

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
if [ "${FAIL}" -ne 0 ]; then
  exit 1
fi
exit 0
