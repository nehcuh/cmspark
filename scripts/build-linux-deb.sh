#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${1:-linux-x64}"
STAGING="${2:-${ROOT_DIR}/dist-package/cmspark-${PLATFORM}}"
OUTPUT_DIR="${3:-${ROOT_DIR}/dist-package}"
TEMPLATE_DIR="${ROOT_DIR}/scripts/packaging/linux"

case "${PLATFORM}" in
  linux-x64) DEB_ARCH="amd64" ;;
  linux-arm64) DEB_ARCH="arm64" ;;
  *) echo "ERROR: unsupported DEB platform: ${PLATFORM}" >&2; exit 1 ;;
esac

VERSION="$(node -p "require('${ROOT_DIR}/companion/package.json').version")"
REVISION="${CMSPARK_DEB_REVISION:-1}"
if [[ ! "${REVISION}" =~ ^[0-9A-Za-z.+~-]+$ ]]; then
  echo "ERROR: invalid CMSPARK_DEB_REVISION: ${REVISION}" >&2
  exit 1
fi
DEB_VERSION="${VERSION}-${REVISION}"
DEB_PATH="${OUTPUT_DIR}/cmspark_${DEB_VERSION}_${DEB_ARCH}.deb"

for required in \
  cmspark-agent.js \
  launch-companion.sh \
  node \
  assets/cmspark.png \
  chrome-extension/manifest.json \
  node_modules/systray2/traybin/tray_linux_release; do
  if [[ ! -s "${STAGING}/${required}" ]]; then
    echo "ERROR: Linux staging is missing ${required}: ${STAGING}" >&2
    exit 1
  fi
done
for executable in launch-companion.sh node node_modules/systray2/traybin/tray_linux_release; do
  if [[ ! -x "${STAGING}/${executable}" ]]; then
    echo "ERROR: staged executable is not executable: ${executable}" >&2
    exit 1
  fi
done
for tool in node dpkg-deb install md5sum; do
  command -v "${tool}" >/dev/null 2>&1 || { echo "ERROR: required tool not found: ${tool}" >&2; exit 1; }
done

mkdir -p "${OUTPUT_DIR}"
PACKAGE_ROOT="${OUTPUT_DIR}/.deb-root-${PLATFORM}"
rm -rf "${PACKAGE_ROOT}"
install -d \
  "${PACKAGE_ROOT}/DEBIAN" \
  "${PACKAGE_ROOT}/opt/cmspark" \
  "${PACKAGE_ROOT}/usr/bin" \
  "${PACKAGE_ROOT}/usr/lib/systemd/user" \
  "${PACKAGE_ROOT}/usr/share/applications" \
  "${PACKAGE_ROOT}/usr/share/icons/hicolor/256x256/apps"
cp -a "${STAGING}/." "${PACKAGE_ROOT}/opt/cmspark/"

install -m 0755 "${TEMPLATE_DIR}/launch-desktop.sh" "${PACKAGE_ROOT}/opt/cmspark/launch-desktop.sh"
install -m 0755 "${TEMPLATE_DIR}/cmspark-agent" "${PACKAGE_ROOT}/usr/bin/cmspark-agent"
install -m 0644 "${TEMPLATE_DIR}/systemd/"*.service "${PACKAGE_ROOT}/usr/lib/systemd/user/"
install -m 0644 "${TEMPLATE_DIR}/cmspark.desktop" "${PACKAGE_ROOT}/usr/share/applications/cmspark.desktop"
install -m 0644 "${STAGING}/assets/cmspark.png" "${PACKAGE_ROOT}/usr/share/icons/hicolor/256x256/apps/cmspark.png"
install -m 0755 "${TEMPLATE_DIR}/DEBIAN/postinst" "${PACKAGE_ROOT}/DEBIAN/postinst"
install -m 0755 "${TEMPLATE_DIR}/DEBIAN/prerm" "${PACKAGE_ROOT}/DEBIAN/prerm"
install -m 0755 "${TEMPLATE_DIR}/DEBIAN/postrm" "${PACKAGE_ROOT}/DEBIAN/postrm"

INSTALLED_SIZE="$(du -sk "${PACKAGE_ROOT}" | cut -f1)"
sed \
  -e "s|@VERSION@|${DEB_VERSION}|g" \
  -e "s|@ARCHITECTURE@|${DEB_ARCH}|g" \
  -e "s|@INSTALLED_SIZE@|${INSTALLED_SIZE}|g" \
  "${TEMPLATE_DIR}/DEBIAN/control.template" > "${PACKAGE_ROOT}/DEBIAN/control"
chmod 0644 "${PACKAGE_ROOT}/DEBIAN/control"

(
  cd "${PACKAGE_ROOT}"
  find . -type f ! -path './DEBIAN/*' -print0 | sort -z | xargs -0 md5sum > DEBIAN/md5sums
)
rm -f "${DEB_PATH}"
dpkg-deb --root-owner-group --build "${PACKAGE_ROOT}" "${DEB_PATH}"
echo "=== Done: ${DEB_PATH} ==="
