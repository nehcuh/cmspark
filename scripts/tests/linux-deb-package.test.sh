#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
SOCKET_PID=""
cleanup() {
  if [[ -n "${SOCKET_PID}" ]]; then
    kill "${SOCKET_PID}" >/dev/null 2>&1 || true
    wait "${SOCKET_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_file() { [[ -f "$1" ]] || fail "missing file: $1"; }
assert_executable() { [[ -x "$1" ]] || fail "not executable: $1"; }
assert_contains() { grep -qF -- "$2" "$1" || fail "$1 missing: $2"; }
assert_log() {
  local expected="$1" actual
  actual="$(cat "${SYSTEMCTL_LOG}")"
  [[ "${actual}" == "${expected}" ]] || fail "systemctl sequence mismatch
expected:
${expected}
actual:
${actual}"
}

# Exercise output ownership with inert tools before the real Linux package run.
python3 "${ROOT_DIR}/scripts/tests/linux-deb-owned-staging.test.py"

STAGING="${TMP_DIR}/staging"
mkdir -p \
  "${STAGING}/assets" \
  "${STAGING}/chrome-extension" \
  "${STAGING}/node_modules/systray2/traybin" \
  "${STAGING}/node_modules/@modelcontextprotocol/server-filesystem/dist" \
  "${STAGING}/node_modules/@modelcontextprotocol/sdk"
printf 'bundle\n' > "${STAGING}/cmspark-agent.js"
printf '#!/bin/sh\n' > "${STAGING}/launch-companion.sh"
printf '#!/bin/sh\n' > "${STAGING}/node"
printf '#!/bin/sh\n' > "${STAGING}/node_modules/systray2/traybin/tray_linux_release"
printf '// official filesystem fixture\n' > "${STAGING}/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"
printf '{"name":"@modelcontextprotocol/sdk","version":"fixture"}\n' > "${STAGING}/node_modules/@modelcontextprotocol/sdk/package.json"
printf '{"manifest_version":3}\n' > "${STAGING}/chrome-extension/manifest.json"
cp "${ROOT_DIR}/companion/assets/cmspark.png" "${STAGING}/assets/cmspark.png"
chmod 0755 "${STAGING}/launch-companion.sh" "${STAGING}/node" \
  "${STAGING}/node_modules/systray2/traybin/tray_linux_release"

OUTPUT_DIR="${TMP_DIR}/output"
CMSPARK_DEB_REVISION='1~test' bash "${ROOT_DIR}/scripts/build-linux-deb.sh" \
  linux-x64 "${STAGING}" "${OUTPUT_DIR}" >/dev/null
VERSION="$(node -p "require('${ROOT_DIR}/companion/package.json').version")"
DEB="${OUTPUT_DIR}/cmspark_${VERSION}-1~test_amd64.deb"
assert_file "${DEB}"
EXTRACTED="${TMP_DIR}/extracted"
dpkg-deb -R "${DEB}" "${EXTRACTED}"

for file in \
  opt/cmspark/launch-desktop.sh \
  opt/cmspark/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js \
  opt/cmspark/node_modules/@modelcontextprotocol/sdk/package.json \
  usr/bin/cmspark-agent \
  usr/lib/systemd/user/cmspark-companion.service \
  usr/lib/systemd/user/cmspark-tray.service \
  usr/share/applications/cmspark.desktop \
  usr/share/icons/hicolor/256x256/apps/cmspark.png \
  DEBIAN/postinst \
  DEBIAN/prerm \
  DEBIAN/postrm; do
  assert_file "${EXTRACTED}/${file}"
done
for executable in \
  opt/cmspark/launch-desktop.sh \
  usr/bin/cmspark-agent \
  DEBIAN/postinst \
  DEBIAN/prerm \
  DEBIAN/postrm; do
  assert_executable "${EXTRACTED}/${executable}"
done
assert_contains "${EXTRACTED}/DEBIAN/control" 'Depends: libc6, libstdc++6, libgcc-s1, libappindicator3-1, libgtk-3-0, xclip | xsel'
assert_contains "${EXTRACTED}/DEBIAN/control" 'Recommends: wl-clipboard'
assert_contains "${EXTRACTED}/usr/share/applications/cmspark.desktop" 'Exec=/opt/cmspark/launch-desktop.sh'
assert_contains "${EXTRACTED}/usr/lib/systemd/user/cmspark-companion.service" 'Wants=cmspark-tray.service'
assert_contains "${EXTRACTED}/usr/lib/systemd/user/cmspark-companion.service" 'WantedBy=default.target'
for script in postinst prerm postrm; do
  sh -n "${EXTRACTED}/DEBIAN/${script}"
done
sh -n "${EXTRACTED}/opt/cmspark/launch-desktop.sh"
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "${EXTRACTED}/usr/share/applications/cmspark.desktop"
fi
( cd "${EXTRACTED}" && md5sum -c DEBIAN/md5sums >/dev/null )

MOCK_BIN="${TMP_DIR}/mock-bin"
mkdir -p "${MOCK_BIN}"
cat > "${MOCK_BIN}/systemctl" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >> "${CMSPARK_TEST_SYSTEMCTL_LOG:?}"
case " $* " in
  *" is-active "*)
    if [ "${CMSPARK_TEST_ACTIVE:-0}" = "1" ]; then exit 0; else exit 3; fi
    ;;
  *" is-enabled "*)
    if [ "${CMSPARK_TEST_ENABLED:-1}" = "1" ]; then exit 0; else exit 4; fi
    ;;
esac
exit 0
MOCK
cat > "${MOCK_BIN}/runuser" <<'MOCK'
#!/bin/sh
[ "$#" -ge 3 ] && [ "$1" = "-u" ] && [ "$3" = "--" ] || exit 2
shift 3
exec "$@"
MOCK
chmod 0755 "${MOCK_BIN}/systemctl" "${MOCK_BIN}/runuser"

SYSTEMCTL_LOG="${TMP_DIR}/systemctl.log"
export CMSPARK_TEST_SYSTEMCTL_LOG="${SYSTEMCTL_LOG}"
mkdir -p "${TMP_DIR}/runtime"
node -e 'require("net").createServer().listen(process.argv[1])' "${TMP_DIR}/runtime/bus" &
SOCKET_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -S "${TMP_DIR}/runtime/bus" ]] && break
  sleep 0.05
done
[[ -S "${TMP_DIR}/runtime/bus" ]] || fail "mock user bus socket was not created"
TEST_ENV=(
  env
  "PATH=${MOCK_BIN}:${PATH}"
  "SUDO_USER=$(id -un)"
  "CMSPARK_SYSTEMD_USER_RUNTIME_DIR=${TMP_DIR}/runtime"
)

: > "${SYSTEMCTL_LOG}"
"${TEST_ENV[@]}" CMSPARK_TEST_ACTIVE=0 sh "${EXTRACTED}/DEBIAN/postinst" configure
assert_log '--user daemon-reload
--user enable cmspark-companion.service
--user is-active --quiet cmspark-companion.service
--user is-active --quiet cmspark-tray.service
--user start cmspark-companion.service'

: > "${SYSTEMCTL_LOG}"
"${TEST_ENV[@]}" CMSPARK_TEST_ACTIVE=1 sh "${EXTRACTED}/DEBIAN/postinst" configure '0.7.0-1~local2'
assert_log '--user daemon-reload
--user is-active --quiet cmspark-companion.service
--user restart cmspark-companion.service cmspark-tray.service'

: > "${SYSTEMCTL_LOG}"
"${TEST_ENV[@]}" CMSPARK_TEST_ACTIVE=0 CMSPARK_TEST_ENABLED=1 \
  sh "${EXTRACTED}/DEBIAN/postinst" configure '0.7.0-1~local2'
assert_log '--user daemon-reload
--user is-active --quiet cmspark-companion.service
--user is-active --quiet cmspark-tray.service
--user is-enabled --quiet cmspark-companion.service
--user start cmspark-companion.service'

: > "${SYSTEMCTL_LOG}"
"${TEST_ENV[@]}" CMSPARK_TEST_ACTIVE=0 CMSPARK_TEST_ENABLED=0 \
  sh "${EXTRACTED}/DEBIAN/postinst" configure '0.7.0-1~local2'
assert_log '--user daemon-reload
--user is-active --quiet cmspark-companion.service
--user is-active --quiet cmspark-tray.service
--user is-enabled --quiet cmspark-companion.service'

: > "${SYSTEMCTL_LOG}"
"${TEST_ENV[@]}" sh "${EXTRACTED}/DEBIAN/prerm" upgrade
assert_log ''
"${TEST_ENV[@]}" sh "${EXTRACTED}/DEBIAN/prerm" remove
assert_log '--user stop cmspark-tray.service
--user disable --now cmspark-companion.service
--user daemon-reload'

: > "${SYSTEMCTL_LOG}"
"${TEST_ENV[@]}" sh "${EXTRACTED}/DEBIAN/postrm" upgrade
assert_log ''
"${TEST_ENV[@]}" sh "${EXTRACTED}/DEBIAN/postrm" remove
assert_log '--user daemon-reload'

: > "${SYSTEMCTL_LOG}"
env -u SUDO_USER "PATH=${MOCK_BIN}:${PATH}" sh "${EXTRACTED}/DEBIAN/postinst" configure
assert_log ''

: > "${SYSTEMCTL_LOG}"
CMSPARK_SYSTEMCTL="${MOCK_BIN}/systemctl" "${EXTRACTED}/opt/cmspark/launch-desktop.sh"
assert_log '--user daemon-reload
--user start cmspark-companion.service'

echo "Linux DEB package and lifecycle tests passed"
