#!/usr/bin/env bash
# Self-test for scripts/verify-node.sh (H8, audit 2026-07-09).
#
# Exercises the verification core with local fixtures — no network. Asserts:
#   1. A correct archive passes (exit 0).
#   2. A tampered archive fails (exit 1) AND is deleted.
#   3. An archive with no SHASUMS entry fails (exit 1).
# Run: bash scripts/tests/test-verify-node.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERIFY="$(cd "${SCRIPT_DIR}/.." && pwd)/verify-node.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

PASS=0
FAIL=0

assert_eq() { # <expected> <actual> <msg>
  if [ "${1}" = "${2}" ]; then
    PASS=$((PASS + 1))
    # echo "  ok: ${3}"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL: ${3} (expected=${1} actual=${2})" >&2
  fi
}

assert_match() { # <needle> <haystack> <msg>
  if echo "${2}" | grep -qF "${1}"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL: ${3} (needle='${1}' not in output)" >&2
  fi
}

# verify-node.sh looks up the archive in the manifest by basename, so each
# case keeps the canonical basename inside its own subdirectory (isolated so
# the "delete on tamper" cases can't clobber a shared fixture).
BASENAME="node-v22.16.0-darwin-arm64.tar.gz"
CONTENT="$(mktemp)"
printf 'node-binary-content-v22' > "${CONTENT}"
REAL_HASH="$(shasum -a 256 "${CONTENT}" 2>/dev/null | awk '{print $1}' \
  || sha256sum "${CONTENT}" | awk '{print $1}')"
rm -f "${CONTENT}"

# --- Fixtures ----------------------------------------------------------------
# Good manifest: contains the real hash for our archive + a couple decoys.
cat > "${TMP}/SHASUMS-good.txt" <<EOF
1111111111111111111111111111111111111111111111111111111111111111  node-v22.16.0-linux-x64.tar.gz
${REAL_HASH}  node-v22.16.0-darwin-arm64.tar.gz
2222222222222222222222222222222222222222222222222222222222222222  node-v22.16.0-win-x64.zip
EOF

# Tampered manifest: wrong hash for the same basename.
cat > "${TMP}/SHASUMS-bad.txt" <<EOF
deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  node-v22.16.0-darwin-arm64.tar.gz
EOF

# Manifest missing our archive entirely.
cat > "${TMP}/SHASUMS-missing.txt" <<EOF
9999999999999999999999999999999999999999999999999999999999999999  node-v22.16.0-linux-x64.tar.gz
EOF

# --- Case 1: correct archive against good manifest → exit 0 -----------------
mkdir -p "${TMP}/c1"
printf 'node-binary-content-v22' > "${TMP}/c1/${BASENAME}"
bash "${VERIFY}" "${TMP}/c1/${BASENAME}" "${TMP}/SHASUMS-good.txt" "case1" >/dev/null 2>&1
assert_eq 0 $? "case1: matching hash should pass"

# --- Case 2: tampered manifest → exit 1 + archive deleted -------------------
mkdir -p "${TMP}/c2"
printf 'node-binary-content-v22' > "${TMP}/c2/${BASENAME}"
ERR="$(bash "${VERIFY}" "${TMP}/c2/${BASENAME}" "${TMP}/SHASUMS-bad.txt" "case2" 2>&1 >/dev/null)"
RC=$?
assert_eq 1 "${RC}" "case2: mismatched hash should fail"
assert_match "sha256 mismatch" "${ERR}" "case2: should report the hash mismatch"
if [ ! -f "${TMP}/c2/${BASENAME}" ]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  echo "  FAIL: case2: tampered archive should be deleted" >&2
fi

# --- Case 2b: prefix-collision must NOT match the wrong arch ----------------
# A loose matcher could match "node-v22.16.0-darwin-arm64.tar.gz" against a
# near-prefix line; verify exact-basename matching.
mkdir -p "${TMP}/c2b"
printf 'node-binary-content-v22' > "${TMP}/c2b/${BASENAME}"
cat > "${TMP}/SHASUMS-prefix.txt" <<EOF
${REAL_HASH}  node-v22.16.0-darwin-arm64.tar.gz.SOMETHING
EOF
bash "${VERIFY}" "${TMP}/c2b/${BASENAME}" "${TMP}/SHASUMS-prefix.txt" "case2b" >/dev/null 2>&1
assert_eq 1 $? "case2b: near-prefix entry must not satisfy exact basename match"

# --- Case 3: archive absent from manifest → exit 1 + readable reason --------
# Regression guard: under `set -euo pipefail` a no-match grep used to abort the
# script SILENTLY (exit 1, no message) before the explicit empty-check ran.
# Assert we now print the real reason.
mkdir -p "${TMP}/c3"
printf 'node-binary-content-v22' > "${TMP}/c3/${BASENAME}"
ERR="$(bash "${VERIFY}" "${TMP}/c3/${BASENAME}" "${TMP}/SHASUMS-missing.txt" "case3" 2>&1 >/dev/null)"
RC=$?
assert_eq 1 "${RC}" "case3: missing manifest entry should fail"
assert_match "no SHASUMS256.txt entry" "${ERR}" "case3: should report missing-entry reason (not exit silently)"

# --- Case 3b: regex-wildcard collision must NOT match ----------------------
# An earlier grep version treated '.' as a regex wildcard, so an entry
# "node-v22.16.0-darwin-arm64.tarXgz" (note the X) wrongly satisfied the
# archive "node-v22.16.0-darwin-arm64.tar.gz". Exact-field matching (awk $2==bn)
# must reject it.
mkdir -p "${TMP}/c3b"
printf 'node-binary-content-v22' > "${TMP}/c3b/${BASENAME}"
cat > "${TMP}/SHASUMS-wildcard.txt" <<EOF
${REAL_HASH}  node-v22.16.0-darwin-arm64.tarXgz
EOF
bash "${VERIFY}" "${TMP}/c3b/${BASENAME}" "${TMP}/SHASUMS-wildcard.txt" "case3b" >/dev/null 2>&1
assert_eq 1 $? "case3b: a '.tarXgz' entry must NOT wildcard-match a '.tar.gz' archive"

# --- Case 4: bad args → exit 1 ---------------------------------------------
bash "${VERIFY}" >/dev/null 2>&1
assert_eq 1 $? "case4: missing args should fail"
bash "${VERIFY}" "${TMP}/does-not-exist.tar.gz" "${TMP}/SHASUMS-good.txt" >/dev/null 2>&1
assert_eq 1 $? "case4b: nonexistent archive should fail"

echo "verify-node.sh self-test: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ]
