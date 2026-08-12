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

# macOS: brew whisper-cli is dynamically linked. Stage dylibs next to package layout
#   Resources/bin/cmspark-whisper-*
#   Resources/lib/libwhisper*.dylib + libggml*.dylib
# with @loader_path relative install names so the DMG works without Homebrew.
if [[ "${OS}" == "Darwin" ]]; then
  LIB_OUT="${COMPANION_ROOT}/dist/lib"
  mkdir -p "${LIB_OUT}"
  # Clear previous staged libs for a clean set
  rm -f "${LIB_OUT}"/libwhisper*.dylib "${LIB_OUT}"/libggml*.dylib 2>/dev/null || true

  WHISPER_PREFIX=""
  GGML_PREFIX=""
  if command -v brew >/dev/null 2>&1; then
    WHISPER_PREFIX="$(brew --prefix whisper-cpp 2>/dev/null || true)"
    GGML_PREFIX="$(brew --prefix ggml 2>/dev/null || true)"
  fi
  # Copy real (non-symlink) dylibs
  if [[ -n "${WHISPER_PREFIX}" && -d "${WHISPER_PREFIX}/lib" ]]; then
    find "${WHISPER_PREFIX}/lib" -maxdepth 1 -type f -name 'libwhisper*.dylib' -exec cp -f {} "${LIB_OUT}/" \;
  fi
  if [[ -n "${GGML_PREFIX}" && -d "${GGML_PREFIX}/lib" ]]; then
    find "${GGML_PREFIX}/lib" -maxdepth 1 -type f -name 'libggml*.dylib' -exec cp -f {} "${LIB_OUT}/" \;
  fi
  # Common soname symlinks
  (
    cd "${LIB_OUT}"
    for f in libwhisper.*.dylib; do
      [[ -f "$f" && ! -L "$f" ]] || continue
      ln -sfn "$f" libwhisper.1.dylib
      ln -sfn "$f" libwhisper.dylib
      break
    done
    for f in libggml.[0-9]*.dylib; do
      [[ -f "$f" && ! -L "$f" ]] || continue
      ln -sfn "$f" libggml.0.dylib 2>/dev/null || true
      ln -sfn "$f" libggml.dylib 2>/dev/null || true
      break
    done
    for f in libggml-base.[0-9]*.dylib; do
      [[ -f "$f" && ! -L "$f" ]] || continue
      ln -sfn "$f" libggml-base.0.dylib 2>/dev/null || true
      ln -sfn "$f" libggml-base.dylib 2>/dev/null || true
      break
    done
  )

  if command -v install_name_tool >/dev/null 2>&1 && command -v otool >/dev/null 2>&1; then
    # Point CLI at @loader_path/../lib/*
    while read -r dep; do
      case "${dep}" in
        /usr/lib/*|/System/*) continue ;;
      esac
      depbase="$(basename "${dep}")"
      if [[ -e "${LIB_OUT}/${depbase}" ]]; then
        install_name_tool -change "${dep}" "@loader_path/../lib/${depbase}" "${OUT_BIN}" 2>/dev/null || true
      fi
    done < <(otool -L "${OUT_BIN}" | awk 'NR>1 {print $1}')

    rewrite_lib() {
      local lib="$1"
      [[ -f "${lib}" && ! -L "${lib}" ]] || return 0
      local base; base="$(basename "${lib}")"
      install_name_tool -id "@loader_path/${base}" "${lib}" 2>/dev/null || true
      while read -r dep; do
        case "${dep}" in
          /usr/lib/*|/System/*|@loader_path/*) continue ;;
        esac
        local depbase; depbase="$(basename "${dep}")"
        if [[ -e "${LIB_OUT}/${depbase}" ]]; then
          install_name_tool -change "${dep}" "@loader_path/${depbase}" "${lib}" 2>/dev/null || true
        fi
      done < <(otool -L "${lib}" | awk 'NR>1 {print $1}')
    }
    for lib in "${LIB_OUT}"/libwhisper*.dylib "${LIB_OUT}"/libggml*.dylib; do
      rewrite_lib "${lib}"
    done
    if command -v codesign >/dev/null 2>&1; then
      for lib in "${LIB_OUT}"/libwhisper*.dylib "${LIB_OUT}"/libggml*.dylib; do
        [[ -f "${lib}" && ! -L "${lib}" ]] || continue
        codesign --force --sign - "${lib}" >/dev/null 2>&1 || true
      done
      codesign --force --sign - "${OUT_BIN}" >/dev/null 2>&1 || true
    fi
  fi

  _n="$(find "${LIB_OUT}" -maxdepth 1 \( -type f -o -type l \) -name 'lib*.dylib' | wc -l | tr -d ' ')"
  echo "[build-cmspark-whisper]         staged dist/lib (${_n} dylib entries)"
  if [[ "${_n}" = "0" ]]; then
    echo "[build-cmspark-whisper] WARNING: no dylibs staged — packaged macOS STT may fail (dyld libwhisper)" >&2
  fi
fi

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
