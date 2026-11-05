#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
SOURCE="${TMP}/source"
mkdir -p "${SOURCE}/scripts" "${SOURCE}/companion/dist"
cp "${ROOT}/scripts/build-linux-rpm.sh" "${ROOT}/scripts/verify-linux-tray.mjs" "${SOURCE}/scripts/"
cp -a "${ROOT}/scripts/packaging" "${SOURCE}/scripts/"
cp "${ROOT}/companion/package.json" "${SOURCE}/companion/"
STAGING="${TMP}/staging"
case "$(uname -m)" in
  x86_64) PLATFORM=linux-x64; RPM_ARCH=x86_64 ;;
  aarch64) PLATFORM=linux-arm64; RPM_ARCH=aarch64 ;;
  *) echo 'Unsupported native RPM test architecture' >&2; exit 1 ;;
esac
mkdir -p "${STAGING}/assets" "${STAGING}/chrome-extension" "${STAGING}/node_modules/systray2/traybin"
printf 'fixture\n' > "${STAGING}/cmspark-agent.js"
cp "${STAGING}/cmspark-agent.js" "${SOURCE}/companion/dist/"
printf '#!/bin/sh\nexit 0\n' > "${STAGING}/launch-companion.sh"
cp "${ROOT}/companion/assets/cmspark.png" "${STAGING}/assets/"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({manifest_version:3,version:require(process.argv[2]).version}))' "${STAGING}/chrome-extension/manifest.json" "${ROOT}/companion/package.json"
node - "${STAGING}" <<'JS'
const fs=require('fs'),p=require('path'),root=process.argv[2]
const elf=Buffer.alloc(64);elf.set([127,69,76,70,2,1,1]);elf.writeUInt16LE(process.arch==='arm64'?183:62,18)
for(const name of ['node','node_modules/systray2/traybin/tray_linux_release']) fs.writeFileSync(p.join(root,name),elf,{mode:0o755})
JS
chmod +x "${STAGING}/launch-companion.sh"
OUTPUT="${TMP}/output with spaces"
bash "${SOURCE}/scripts/build-linux-rpm.sh" "${PLATFORM}" "${STAGING}" "${OUTPUT}"
RPM="${OUTPUT}/cmspark-$(node -p "require('${ROOT}/companion/package.json').version")-1.${RPM_ARCH}.rpm"
mkdir "${TMP}/extracted"
(cd "${TMP}/extracted"; rpm2cpio "${RPM}" | cpio -idm --quiet)
desktop="${TMP}/extracted/usr/share/applications/cmspark.desktop"
desktop-file-validate "${desktop}"
entry="$(sed -n 's/^Exec=//p' "${desktop}")"
test -x "${TMP}/extracted${entry}"
test -s "${TMP}/extracted/usr/share/icons/hicolor/256x256/apps/cmspark.png"
mkdir "${TMP}/tools"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "$CMSPARK_TEST_LOG"\n' > "${TMP}/tools/systemctl"
chmod +x "${TMP}/tools/systemctl"
CMSPARK_SYSTEMCTL="${TMP}/tools/systemctl" CMSPARK_TEST_LOG="${TMP}/launch.log" "${TMP}/extracted${entry}"
printf '%s\n' '--user daemon-reload' '--user start cmspark-companion.service' > "${TMP}/expected.log"
cmp "${TMP}/expected.log" "${TMP}/launch.log"
sha256sum "${RPM}" > "${TMP}/package.sha256"
printf 'stale build\n' > "${STAGING}/cmspark-agent.js"
if bash "${SOURCE}/scripts/build-linux-rpm.sh" "${PLATFORM}" "${STAGING}" "${OUTPUT}" > "${TMP}/stale.log" 2>&1; then
  echo 'ERROR: stale source accepted' >&2; exit 1
fi
grep -q 'staged agent does not match current bundle' "${TMP}/stale.log"
sha256sum --check "${TMP}/package.sha256"
echo 'Linux RPM desktop launcher and native-architecture package tests passed'
