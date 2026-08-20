#!/usr/bin/env bash
# Wrap package.sh windows-x64 staging in an NSIS Setup.exe.
#
# Official producer of dist-package/CMspark-Setup-v{version}.exe.
# Do NOT call this on a SEA tree (cmspark-agent.exe is a hard fail).
#
# Usage:
#   bash scripts/build-windows-installer.sh
# Env:
#   CMSPARK_REQUIRE_NSIS=1   fail if makensis missing (CI Windows job)
#   CMSPARK_MAKENSIS=path    override makensis binary (tests)
#   CMSPARK_STAGING_DIR=dir  override staging (tests)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  ROOT_DIR="$(cygpath -m "${ROOT_DIR}")"
fi

VERSION="$(node -p "require('${ROOT_DIR}/companion/package.json').version")"
STAGING="${CMSPARK_STAGING_DIR:-${ROOT_DIR}/dist-package/cmspark-windows-x64}"
OUTFILE="${ROOT_DIR}/dist-package/CMspark-Setup-v${VERSION}.exe"
NSI="${ROOT_DIR}/scripts/installer.nsi"
REQUIRE="${CMSPARK_REQUIRE_NSIS:-}"

find_makensis() {
  if [ -n "${CMSPARK_MAKENSIS:-}" ]; then
    printf '%s' "${CMSPARK_MAKENSIS}"
    return 0
  fi
  if command -v makensis >/dev/null 2>&1; then
    command -v makensis
    return 0
  fi
  local c
  for c in \
    "/c/Program Files (x86)/NSIS/makensis.exe" \
    "/c/Program Files/NSIS/makensis.exe" \
    "C:/Program Files (x86)/NSIS/makensis.exe" \
    "C:/Program Files/NSIS/makensis.exe" \
    "/usr/bin/makensis" \
    "/usr/local/bin/makensis"
  do
    if [ -x "${c}" ]; then
      printf '%s' "${c}"
      return 0
    fi
  done
  return 1
}

MAKENSIS=""
if MAKENSIS="$(find_makensis)"; then
  :
else
  MAKENSIS=""
fi

if [ -z "${MAKENSIS}" ] || [ ! -x "${MAKENSIS}" ]; then
  if [ "${REQUIRE}" = "1" ]; then
    echo "ERROR: makensis not found (CMSPARK_REQUIRE_NSIS=1). Install NSIS 3.12.0 (choco install nsis --version=3.12.0) and re-run." >&2
    exit 1
  fi
  echo "WARNING: makensis not found — skipping CMspark-Setup-v${VERSION}.exe (zip is still valid)." >&2
  echo "         CI sets CMSPARK_REQUIRE_NSIS=1. Local: brew/choco install nsis, then re-run." >&2
  exit 0
fi

echo "=== CMspark Windows NSIS installer ==="
echo "  makensis: ${MAKENSIS}"
echo "  staging:  ${STAGING}"
echo "  output:   ${OUTFILE}"

if [ ! -d "${STAGING}" ]; then
  echo "ERROR: staging directory missing: ${STAGING}" >&2
  exit 1
fi

missing=0
for rel in node.exe cmspark-agent.js launch-hidden.vbs chrome-extension; do
  if [ ! -e "${STAGING}/${rel}" ]; then
    echo "ERROR: official installer staging missing ${rel}" >&2
    missing=1
  fi
done
if [ -e "${STAGING}/cmspark-agent.exe" ]; then
  echo "ERROR: staging contains cmspark-agent.exe — refuse to wrap a SEA/mixed tree as CMspark-Setup-v${VERSION}.exe" >&2
  missing=1
fi
if [ "${missing}" != "0" ]; then
  exit 1
fi

rm -f "${OUTFILE}"

# Git Bash converts argv starting with / into Windows paths. Never pass /D…
# NSIS accepts -D on Windows and Unix.
export MSYS_NO_PATHCONV=1
set +e
"${MAKENSIS}" "-DPRODUCT_VERSION=${VERSION}" "${NSI}"
nsis_rc=$?
set -e
if [ "${nsis_rc}" != "0" ]; then
  echo "ERROR: makensis failed (exit ${nsis_rc})" >&2
  exit 1
fi

if [ ! -s "${OUTFILE}" ]; then
  echo "ERROR: installer missing or empty: ${OUTFILE}" >&2
  exit 1
fi

echo "  wrote $(du -h "${OUTFILE}" | cut -f1) ${OUTFILE}"
