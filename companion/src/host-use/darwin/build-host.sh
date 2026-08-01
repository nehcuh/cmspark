#!/bin/bash
# Build script for CMspark Host binary (Phase 0 — Computer Use spike)
# Compiles host.swift into a native macOS binary, binds an Info.plist with
# NSAppleEventsUsageDescription, and ad-hoc signs it with hardened runtime +
# automation entitlement. This is the project-existential TCC gate binary:
# docs/decisions/computer-use-round2-synthesis.md §4.1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
OUTPUT_DIR="${PROJECT_ROOT}/dist"
OUTPUT_BIN="${OUTPUT_DIR}/cmspark-host"
SCRIPTS_DIR="${OUTPUT_DIR}/host-scripts"

echo "[build-host] Building CMspark Host binary..."
echo "[build-host] Source: ${SCRIPT_DIR}/host.swift"
echo "[build-host] Output: ${OUTPUT_BIN}"

mkdir -p "${OUTPUT_DIR}" "${SCRIPTS_DIR}"

# (1) Precompile .scpt — Round 1 D3: no runtime osacompile
echo "[build-host] (1/4) Precompiling all .scpt files..."
for script in read-mail list-mail list-notes list-files; do
  osacompile -o "${SCRIPTS_DIR}/${script}.scpt" "${SCRIPT_DIR}/${script}.applescript"
  if [[ ! -f "${SCRIPTS_DIR}/${script}.scpt" ]]; then
    echo "[build-host] ERROR: osacompile failed for ${script}.scpt"
    exit 1
  fi
done

# (2) Swift compile + bind Info.plist into __TEXT __info_plist section
echo "[build-host] (2/4) Compiling Swift binary..."
swiftc \
  -O \
  -o "${OUTPUT_BIN}" \
  "${SCRIPT_DIR}/host.swift" \
  -framework Foundation \
  -framework ApplicationServices \
  -framework Vision \
  -framework Security \
  -framework Carbon \
  -framework CoreImage \
  -framework ImageIO \
  -framework ScreenCaptureKit \
  -Xlinker -sectcreate \
  -Xlinker __TEXT \
  -Xlinker __info_plist \
  -Xlinker "${SCRIPT_DIR}/host-Info.plist"

if [[ ! -f "${OUTPUT_BIN}" ]]; then
  echo "[build-host] ERROR: swiftc failed — binary not produced"
  exit 1
fi

# (3) Set restrictive perms BEFORE codesign (CodeRabbit review: codesign
# captures file mode in seal; setting perms after signing may invalidate it).
chmod 755 "${OUTPUT_BIN}"

# (3b) Codesign: ad-hoc + hardened runtime + entitlements — Round 2 D4
echo "[build-host] (3/4) Ad-hoc codesign with hardened runtime + automation entitlement..."
codesign \
  --force \
  --sign - \
  --options runtime \
  --entitlements "${SCRIPT_DIR}/host.entitlements" \
  "${OUTPUT_BIN}"

# (4) Verify signature (Kimi phase0 review Major #7: add --verify).
# Restrictive perms already set in step 3 before codesign (CodeRabbit review:
# codesign captures file mode in seal).

echo "[build-host] (4/4) Verifying signature..."
echo
echo "--- codesign --verify --verbose ---"
if ! codesign --verify --verbose "${OUTPUT_BIN}"; then
  echo "[build-host] ERROR: codesign verify failed"
  exit 1
fi
echo
echo "--- codesign -dv --verbose=4 ---"
codesign -dv --verbose=4 "${OUTPUT_BIN}"
echo
echo "--- codesign --display --entitlements - ---"
codesign --display --entitlements - "${OUTPUT_BIN}"
echo
echo "--- file ---"
file "${OUTPUT_BIN}"

# (4c) Assert product TCC identity (plist section / strings).
# DR-N1: do not use codesign -d --info-plist=- (fails on macOS 26).
# DR-N7: check embedded Info.plist only (not full-binary strings for host id).
echo "[build-host] (4c) Assert product TCC identity (plist section / strings)..."
PLIST_TMP=$(mktemp)
if otool -s __TEXT __info_plist "${OUTPUT_BIN}" 2>/dev/null | tail -n +3 | xxd -r -p >"${PLIST_TMP}" 2>/dev/null \
  && plutil -lint "${PLIST_TMP}" >/dev/null 2>&1; then
  IDENT=$(plutil -extract CFBundleIdentifier raw "${PLIST_TMP}" 2>/dev/null || true)
  if [[ "${IDENT}" != "com.cmspark.agent" ]]; then
    echo "[build-host] ERROR: embedded CFBundleIdentifier='${IDENT}' want com.cmspark.agent"
    rm -f "${PLIST_TMP}"
    exit 1
  fi
  if plutil -p "${PLIST_TMP}" 2>/dev/null | grep -q 'com.cmspark.host'; then
    echo "[build-host] ERROR: stale com.cmspark.host in embedded Info.plist"
    rm -f "${PLIST_TMP}"
    exit 1
  fi
  rm -f "${PLIST_TMP}"
else
  rm -f "${PLIST_TMP}"
  if ! strings "${OUTPUT_BIN}" | grep -q 'com.cmspark.agent'; then
    echo "[build-host] ERROR: com.cmspark.agent not found in binary strings"
    exit 1
  fi
  echo "[build-host] WARN: otool plist extract failed; used strings fallback for agent id only"
fi

# (4b) P2 functional gate (Pi C2/C3 + Grok blocker 2): run classifier self-test
# post-sign. The binary now exits non-zero on assertion failure AND we require
# "ok":true in stdout — double gate so a future regression in either the
# classifier OR the exit-code wiring still fails the build.
echo
echo "[build-host] (4b/5) Running classifier self-test..."
SELF_TEST_OUT=$("${OUTPUT_BIN}" self-test 2>/dev/null) || {
  echo "[build-host] ERROR: classifier self-test exited non-zero:"
  echo "${SELF_TEST_OUT}"
  exit 1
}
if ! echo "${SELF_TEST_OUT}" | grep -q '"ok":true'; then
  echo "[build-host] ERROR: classifier self-test missing \"ok\":true in stdout:"
  echo "${SELF_TEST_OUT}"
  exit 1
fi
echo "${SELF_TEST_OUT}"

BINARY_SIZE=$(stat -f%z "${OUTPUT_BIN}" 2>/dev/null || stat -c%s "${OUTPUT_BIN}" 2>/dev/null || echo "?")
BINARY_HASH=$(shasum -a 256 "${OUTPUT_BIN}" | awk '{print $1}')

# (5) Auto-rewrite CMSPARK_HOST_SHA256 constant in host-integrity.ts.
# Closes adversary N7 (stale-SHA window between binary rebuild and constant
# bump). Developer MUST commit host-integrity.ts alongside any binary-affecting
# change — CI (option A) asserts the diff is present.
INTEGRITY_TS="${SCRIPT_DIR}/host-integrity.ts"
if [[ -f "${INTEGRITY_TS}" ]]; then
  echo "[build-host] (5/5) Auto-rewriting CMSPARK_HOST_SHA256 in host-integrity.ts..."
  # Anchor on the literal constant name; robust to whitespace changes.
  # Fail-closed: if the regex doesn't match, the build fails — developer must
  # reconcile manually (constant line was renamed/moved).
  if ! perl -i -pe 's/(CMSPARK_HOST_SHA256\s*=\s*")[^"]*"/${1}'"${BINARY_HASH}"'"/' "${INTEGRITY_TS}"; then
    echo "[build-host] ERROR: perl in-place edit failed on ${INTEGRITY_TS}"
    exit 1
  fi
  if ! grep -q "CMSPARK_HOST_SHA256 = \"${BINARY_HASH}\"" "${INTEGRITY_TS}"; then
    echo "[build-host] ERROR: SHA constant did not update — regex miss. Manual reconciliation required."
    exit 1
  fi
  echo "[build-host]   host-integrity.ts updated with SHA ${BINARY_HASH}"
  echo "[build-host]   WARNING: working tree is now dirty. Commit host-integrity.ts alongside binary-affecting changes."
else
  echo "[build-host] WARNING: host-integrity.ts not found at ${INTEGRITY_TS}"
  echo "[build-host]   Skipping auto-rewrite. Manual SHA update required if it exists elsewhere."
fi

echo
echo "[build-host] SUCCESS"
echo "[build-host]   Binary: ${OUTPUT_BIN} (${BINARY_SIZE} bytes)"
echo "[build-host]   SHA256: ${BINARY_HASH}"
echo "[build-host]   Scripts: ${SCRIPTS_DIR}/read-mail.scpt"
