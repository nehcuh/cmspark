#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
STAGING="${TMP}/staging"
mkdir -p "${STAGING}/assets" "${STAGING}/chrome-extension" "${STAGING}/node_modules/systray2/traybin"
printf 'fixture\n' > "${STAGING}/cmspark-agent.js"
printf '#!/bin/sh\nexit 0\n' > "${STAGING}/launch-companion.sh"
cp "${ROOT}/companion/assets/cmspark.png" "${STAGING}/assets/"
printf '{"manifest_version":3}\n' > "${STAGING}/chrome-extension/manifest.json"
node - "${STAGING}" <<'JS'
const fs=require('fs'),p=require('path'),root=process.argv[2]
const elf=Buffer.alloc(64);elf.set([127,69,76,70,2,1,1]);elf.writeUInt16LE(62,18)
for(const name of ['node','node_modules/systray2/traybin/tray_linux_release']) fs.writeFileSync(p.join(root,name),elf,{mode:0o755})
JS
chmod +x "${STAGING}/launch-companion.sh"
OUTPUT="${TMP}/output with spaces"
bash "${ROOT}/scripts/build-linux-rpm.sh" linux-x64 "${STAGING}" "${OUTPUT}"
RPM="${OUTPUT}/cmspark-$(node -p "require('${ROOT}/companion/package.json').version")-1.x86_64.rpm"
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
echo 'Linux RPM desktop launcher and native-architecture package tests passed'
