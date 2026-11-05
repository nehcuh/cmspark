#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="${ROOT_DIR}/chrome-extension/build/chrome-mv3-prod"
VERSION="$(node -p "require('${ROOT_DIR}/chrome-extension/package.json').version")"
OUTPUT_DIR="${ROOT_DIR}/dist-package/chrome-extension"
OUTPUT="${OUTPUT_DIR}/CMspark-Chrome-Extension-v${VERSION}.zip"

[[ -s "${EXT_DIR}/manifest.json" ]] || { echo "ERROR: production extension build is missing" >&2; exit 1; }
node -e 'const m=require(process.argv[1]); if(m.version!==process.argv[2]) process.exit(1)' "${EXT_DIR}/manifest.json" "${VERSION}" || {
  echo "ERROR: production extension version does not match package.json" >&2; exit 1;
}
command -v zip >/dev/null 2>&1 || { echo "ERROR: zip is required" >&2; exit 1; }

mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT}"
(
  cd "${EXT_DIR}"
  zip -qr "${OUTPUT}" .
)
node -e 'const fs=require("node:fs"),c=require("node:crypto"),p=process.argv[1],h=c.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); fs.writeFileSync(p+".sha256",h+"  "+require("node:path").basename(p)+String.fromCharCode(10))' "${OUTPUT}"
cat > "${OUTPUT_DIR}/README.txt" <<'EOF'
CMspark Chrome Extension

1. Extract the ZIP to a folder you want to keep.
2. Open chrome://extensions and enable Developer mode.
3. Choose Load unpacked and select the extracted folder containing manifest.json.
EOF
echo "Wrote ${OUTPUT}"
