#!/usr/bin/env bash
# Copy host whisper-cli into companion/dist/bin as cmspark-whisper-<arch>
# and print SHA256 for whisper-binary-pins.ts.
#
# Dev path (M1): brew install whisper-cpp → this script → pin file.
# CI/prod may later build whisper.cpp from source; same output layout.
#
# Usage:
#   bash companion/scripts/build-cmspark-whisper.sh
#   bash companion/scripts/build-cmspark-whisper.sh --write-pins
#
# Env:
#   CMSPARK_WHISPER_SRC  override source binary path
#   CMSPARK_WHISPER_OUT  override output path (full file path)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPANION_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WRITE_PINS=0
for arg in "$@"; do
  case "$arg" in
    --write-pins) WRITE_PINS=1 ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

OS="$(uname -s)"
ARCH="$(uname -m)"
case "${OS}" in
  Darwin)
    case "${ARCH}" in
      arm64)  WARCH="darwin-arm64" ;;
      x86_64) WARCH="darwin-x64" ;;
      *)
        echo "[build-cmspark-whisper] ERROR: unsupported macOS arch: ${ARCH}" >&2
        exit 1
        ;;
    esac
    ;;
  Linux)
    case "${ARCH}" in
      x86_64|amd64) WARCH="linux-x64" ;;
      *)
        echo "[build-cmspark-whisper] ERROR: unsupported Linux arch: ${ARCH}" >&2
        exit 1
        ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    WARCH="win-x64"
    ;;
  *)
    echo "[build-cmspark-whisper] ERROR: unsupported OS: ${OS}" >&2
    exit 1
    ;;
esac

EXE_SUFFIX=""
[[ "${WARCH}" == win-x64 ]] && EXE_SUFFIX=".exe"

OUT_DIR="${COMPANION_ROOT}/dist/bin"
OUT_NAME="cmspark-whisper-${WARCH}${EXE_SUFFIX}"
OUT_BIN="${CMSPARK_WHISPER_OUT:-${OUT_DIR}/${OUT_NAME}}"

resolve_src() {
  if [[ -n "${CMSPARK_WHISPER_SRC:-}" ]]; then
    printf '%s' "${CMSPARK_WHISPER_SRC}"
    return
  fi
  if command -v whisper-cli >/dev/null 2>&1; then
    command -v whisper-cli
    return
  fi
  if [[ -x /opt/homebrew/bin/whisper-cli ]]; then
    printf '%s' /opt/homebrew/bin/whisper-cli
    return
  fi
  if [[ -x /usr/local/bin/whisper-cli ]]; then
    printf '%s' /usr/local/bin/whisper-cli
    return
  fi
  if command -v brew >/dev/null 2>&1; then
    local prefix
    prefix="$(brew --prefix whisper-cpp 2>/dev/null || true)"
    if [[ -n "${prefix}" && -x "${prefix}/bin/whisper-cli" ]]; then
      printf '%s' "${prefix}/bin/whisper-cli"
      return
    fi
  fi
  return 1
}

echo "[build-cmspark-whisper] arch=${WARCH}"
echo "[build-cmspark-whisper] out=${OUT_BIN}"

if ! SRC="$(resolve_src)"; then
  echo "[build-cmspark-whisper] ERROR: whisper-cli not found." >&2
  echo "[build-cmspark-whisper]        Install: brew install whisper-cpp" >&2
  echo "[build-cmspark-whisper]        Or set CMSPARK_WHISPER_SRC=/path/to/whisper-cli" >&2
  exit 1
fi

# Resolve symlinks so we pin the real binary bytes (brew Cellar).
if command -v realpath >/dev/null 2>&1; then
  SRC="$(realpath "${SRC}")"
elif [[ -L "${SRC}" ]]; then
  # macOS without realpath: follow one link level under homebrew layout
  _link="$(readlink "${SRC}")"
  if [[ "${_link}" = /* ]]; then
    SRC="${_link}"
  else
    SRC="$(cd "$(dirname "${SRC}")" && pwd -P)/${_link}"
  fi
fi

echo "[build-cmspark-whisper] src=${SRC}"

if [[ ! -f "${SRC}" ]]; then
  echo "[build-cmspark-whisper] ERROR: source not a file: ${SRC}" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUT_BIN}")"
cp "${SRC}" "${OUT_BIN}"
chmod +x "${OUT_BIN}"

if command -v shasum >/dev/null 2>&1; then
  HASH="$(shasum -a 256 "${OUT_BIN}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  HASH="$(sha256sum "${OUT_BIN}" | awk '{print $1}')"
else
  echo "[build-cmspark-whisper] ERROR: no shasum/sha256sum" >&2
  exit 1
fi

SIZE="$(stat -f%z "${OUT_BIN}" 2>/dev/null || stat -c%s "${OUT_BIN}" 2>/dev/null || echo "?")"
echo "[build-cmspark-whisper] SUCCESS: ${OUT_BIN}"
echo "[build-cmspark-whisper]         Size: ${SIZE} bytes"
echo "[build-cmspark-whisper]         SHA256: ${HASH}"

PINS_TS="${COMPANION_ROOT}/src/voice/whisper-binary-pins.ts"
if [[ "${WRITE_PINS}" -eq 1 ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "[build-cmspark-whisper] ERROR: node required for --write-pins" >&2
    exit 1
  fi
  node - "${PINS_TS}" "${WARCH}" "${HASH}" <<'NODE'
const fs = require("fs");
const [pinsPath, arch, hash] = process.argv.slice(2);
let src = fs.readFileSync(pinsPath, "utf8");
const entryRe = new RegExp(
  `("${arch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*)("[0-9a-fA-F]{64}"|undefined|null)?`,
);
if (entryRe.test(src)) {
  src = src.replace(entryRe, `$1"${hash}"`);
} else {
  const marker = "WHISPER_BINARY_SHA256";
  const mi = src.indexOf(marker);
  if (mi < 0) {
    console.error("whisper-binary-pins.ts missing WHISPER_BINARY_SHA256");
    process.exit(1);
  }
  const brace = src.indexOf("{", mi);
  if (brace < 0) process.exit(1);
  // Skip past optional whitespace/newline after {
  let insertAt = brace + 1;
  src =
    src.slice(0, insertAt) +
    `\n  "${arch}": "${hash}",` +
    src.slice(insertAt);
}
fs.writeFileSync(pinsPath, src);
console.log(`[build-cmspark-whisper] wrote pin ${arch} → ${pinsPath}`);
NODE
else
  echo "[build-cmspark-whisper] Update companion/src/voice/whisper-binary-pins.ts:"
  echo "  \"${WARCH}\": \"${HASH}\","
  echo "[build-cmspark-whisper] Or re-run with --write-pins"
fi
