#!/bin/bash
# #432 Slice 0: pack index.js as darwin SEA + sidecar @lydell/node-pty (S-2 layout).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

NODE_BIN="$(command -v node)"
ESBUILD="${DIR}/../../../companion/node_modules/esbuild/bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  ESBUILD="$(command -v esbuild || true)"
fi
if [ -z "${ESBUILD}" ] || [ ! -x "${ESBUILD}" ]; then
  echo "ERROR: esbuild not found (npm install in companion/)" >&2
  exit 2
fi

rm -rf dist dist-app
mkdir -p dist dist-app

echo "[pack] esbuild bundle (external @lydell/node-pty)"
"$ESBUILD" index.js --bundle --platform=node --target=node22 \
  --external:@lydell/node-pty --outfile=dist/bundle.js

echo "[pack] SEA blob"
node --experimental-sea-config sea-config.json

echo "[pack] copy node -> dist-app/s-pty-sea"
cp "$NODE_BIN" dist-app/s-pty-sea
chmod +x dist-app/s-pty-sea

# Strip signature so postject can inject (macOS).
codesign --remove-signature dist-app/s-pty-sea 2>/dev/null || true

echo "[pack] postject (darwin requires --macho-segment-name NODE_SEA)"
npx --yes postject@1.0.0-alpha.6 dist-app/s-pty-sea NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA --overwrite

# Ad-hoc sign so macOS will exec after injection.
echo "[pack] codesign -s -"
codesign -s - --force --deep dist-app/s-pty-sea

echo "[pack] sidecar node_modules (@lydell/node-pty + optional darwin-arm64)"
mkdir -p dist-app/node_modules
cp -R node_modules/@lydell dist-app/node_modules/@lydell

echo "[pack] done: $DIR/dist-app/s-pty-sea"
ls -la dist-app/s-pty-sea dist-app/node_modules/@lydell
