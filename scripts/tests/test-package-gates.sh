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
assert_file_has "${PACKAGE_SH}" 'external:onnxruntime-node' \
  "package.sh esbuild externalizes onnxruntime-node"
assert_file_has "${PACKAGE_SH}" 'host-scripts-win' \
  "package.sh stages host-scripts-win"
assert_file_has "${PACKAGE_SH}" 'tinyclick-worker' \
  "package.sh stages tinyclick-worker"
assert_file_has "${PACKAGE_SH}" 'stage_onnxruntime' \
  "package.sh defines stage_onnxruntime"
assert_file_has "${PACKAGE_SH}" 'npm run build:host' \
  "package.sh invokes build:host"
assert_file_has "${PACKAGE_SH}" 'requires macOS \(swiftc/osacompile' \
  "package.sh hard-errors cross-OS macos packaging"

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
assert_file_has "${RELEASE_YML}" 'tinyclick-worker' \
  "release.yml documents TinyClick worker"
assert_file_lacks "${RELEASE_YML}" 'shared-secret handshake is deferred' \
  "release.yml must not claim shared-secret deferred"
assert_file_lacks "${RELEASE_YML}" 'local-process shared-secret handshake is deferred' \
  "release.yml must not use old deferred handshake wording"
assert_file_has "${RELEASE_YML}" 'FIXED' \
  "release.yml body marks C1 as FIXED"
assert_file_has "${RELEASE_YML}" 'fail-closed' \
  "release.yml documents fail-closed packaging"

# --- Static: build-windows-exe.ps1 fail-closed host scripts + ORT ------------
echo "[static] build-windows-exe.ps1 fail-closed"
assert_file_has "${PS1}" 'Fail "win host-use scripts not found' \
  "ps1 Fails when win scripts missing"
assert_file_has "${PS1}" 'host-scripts-win/\*\.ps1 empty after staging' \
  "ps1 Fails when host-scripts-win empty"
assert_file_has "${PS1}" 'Fail "onnxruntime-node not installed' \
  "ps1 Fails when ORT missing"

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
assert_match 'cmspark-host missing' "${OUT}" "error message mentions missing host"

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

# --- Static: release body qualifies ORT hard-fail as windows-x64 only --------
echo "[static] release.yml ORT fail-closed is platform-qualified"
assert_file_has "${RELEASE_YML}" 'windows-x64' \
  "release body mentions windows-x64 for TinyClick/ORT"
assert_file_has "${RELEASE_YML}" 'optional soft stage' \
  "release body notes macOS/Linux ORT is optional soft stage"
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

# --- Dynamic: windows-x64 tinyclick precondition (rename sources) ------------
WORKER_CANDIDATES=(
  "${ROOT}/companion/dist/computer/tinyclick-worker.js"
  "${ROOT}/companion/dist/tinyclick-worker.js"
  "${ROOT}/companion/src/computer/tinyclick-worker.ts"
)
WORKER_MOVED=""
WORKER_BAK=""
for _wc in "${WORKER_CANDIDATES[@]}"; do
  if [ -f "${_wc}" ]; then
    WORKER_BAK="$(mktemp "${TMPDIR:-/tmp}/tinyclick-worker.XXXXXX")"
    mv "${_wc}" "${WORKER_BAK}"
    WORKER_MOVED="${_wc}"
    break
  fi
done
if [ -n "${WORKER_MOVED}" ]; then
  # Hide any remaining candidates so gate sees zero workers.
  HIDDEN_WORKERS=()
  for _wc in "${WORKER_CANDIDATES[@]}"; do
    if [ -f "${_wc}" ]; then
      _hb="$(mktemp "${TMPDIR:-/tmp}/tinyclick-hide.XXXXXX")"
      mv "${_wc}" "${_hb}"
      HIDDEN_WORKERS+=("${_wc}|${_hb}")
    fi
  done
  echo "[dynamic] windows-x64 GATE-ONLY fails without tinyclick-worker"
  set +e
  OUT_TC="$(
    CMSPARK_PACKAGE_GATE_ONLY=1 bash "${PACKAGE_SH}" windows-x64 2>&1
  )"
  RC_TC=$?
  set -e
  mv "${WORKER_BAK}" "${WORKER_MOVED}"
  for _pair in "${HIDDEN_WORKERS[@]+"${HIDDEN_WORKERS[@]}"}"; do
    [ -z "${_pair}" ] && continue
    _orig="${_pair%%|*}"
    _bak="${_pair#*|}"
    mv "${_bak}" "${_orig}"
  done
  assert_eq 1 "${RC_TC}" "missing tinyclick-worker must exit 1 on windows-x64 gate"
  assert_match 'tinyclick-worker missing' "${OUT_TC}" "error mentions tinyclick-worker"
else
  echo "[dynamic] skip tinyclick-missing test (no worker artifact/source found)"
fi

# --- Static: windows-x64 gate-only checks ORT dir + tinyclick ---------------
echo "[static] package.sh windows-x64 gate-only mentions ORT + tinyclick"
assert_file_has "${PACKAGE_SH}" 'onnxruntime-node not installed' \
  "gate-only errors when ORT missing"
assert_file_has "${PACKAGE_SH}" 'tinyclick-worker missing' \
  "gate-only errors when tinyclick missing"
assert_file_has "${PS1}" 'models.manifest.json' \
  "build-windows-exe.ps1 stages or warns about models.manifest.json"

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
if [ "${FAIL}" -ne 0 ]; then
  exit 1
fi
exit 0
