#!/usr/bin/env bash
# verify-node.sh — H8 (audit 2026-07-09): verify a downloaded Node.js archive
# against a SHASUMS256.txt manifest BEFORE extracting it into the build.
#
# Why: scripts/package.sh downloads the Node binary from ${NODE_MIRROR}
# (env-overridable) via plain curl. A poisoned NODE_MIRROR or a MITM on the
# download could substitute a trojaned node binary that exfiltrates
# config.json on first run. This closes that vector: the archive's sha256
# must match the entry the canonical nodejs.org publishes in SHASUMS256.txt
# for that version (package.sh fetches the manifest from NODE_SHASUMS_MIRROR,
# which defaults to https://nodejs.org/dist — INDEPENDENT of NODE_MIRROR — so
# a poisoned binary mirror can't serve a matching manifest for its own trojan),
# or the build aborts and the bad archive is deleted.
#
# This script is deliberately PURE — it takes the archive path and an already-
# fetched SHASUMS256.txt path and does no network I/O. package.sh fetches the
# manifest (over HTTPS, from NODE_MIRROR); keeping fetch out of this core makes
# it deterministic to unit-test (see scripts/tests/test-verify-node.sh).
#
# Usage: verify-node.sh <archive-path> <shasums256-file> [display-label]
# Exit: 0 on match, 1 on mismatch / missing entry / bad args. On mismatch the
# archive is removed so a retry re-downloads instead of reusing a poisoned file.
set -euo pipefail

ARCHIVE="${1:-}"
SHASUMS="${2:-}"
LABEL="${3:-$(basename "${ARCHIVE:-archive}")}"

if [ -z "${ARCHIVE}" ] || [ -z "${SHASUMS}" ]; then
  echo "usage: verify-node.sh <archive-path> <shasums256-file> [label]" >&2
  exit 1
fi
if [ ! -f "${ARCHIVE}" ]; then
  echo "ERROR: archive not found: ${ARCHIVE}" >&2
  exit 1
fi
if [ ! -f "${SHASUMS}" ]; then
  echo "ERROR: SHASUMS file not found: ${SHASUMS}" >&2
  exit 1
fi

BASENAME="$(basename "${ARCHIVE}")"

# SHASUMS256.txt lines look like: "<64-hex-hash>  <filename>". Match the exact
# basename as a LITERAL field (field 2), not a regex — a `.` in the filename
# would otherwise wildcard-match a different entry (e.g. ".tar.gz" matching a
# hypothetical ".tarXgz"). awk prints nothing and exits 0 on no-match, so no
# `|| true` guard is needed and the empty-check below always runs (an earlier
# grep-based version aborted silently under `set -euo pipefail` on no-match).
EXPECTED="$(awk -v bn="${BASENAME}" '$1 ~ /^[0-9a-f]{64}$/ && $2 == bn {print $1; exit}' "${SHASUMS}")"
if [ -z "${EXPECTED}" ]; then
  echo "ERROR: no SHASUMS256.txt entry for ${BASENAME} — manifest mismatch or wrong version." >&2
  echo "  Aborting; cannot verify supply-chain integrity of Node ${LABEL}." >&2
  exit 1
fi

# Portable sha256: prefer coreutils sha256sum (Linux), fall back to shasum
# (macOS default + any perl-Digest-SHA install). Both print "<hash>  <path>".
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"
else
  ACTUAL="$(shasum -a 256 "${ARCHIVE}" | awk '{print $1}')"
fi

if [ "${ACTUAL}" != "${EXPECTED}" ]; then
  echo "ERROR: sha256 mismatch for ${LABEL} (${BASENAME})" >&2
  echo "  expected: ${EXPECTED}" >&2
  echo "  actual:   ${ACTUAL}" >&2
  echo "  Aborting — possible supply-chain tamper. Removing the archive." >&2
  rm -f "${ARCHIVE}"
  exit 1
fi

echo "  sha256 OK: ${LABEL} (${EXPECTED})"
