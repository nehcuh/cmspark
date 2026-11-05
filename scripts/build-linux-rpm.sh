#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${1:-linux-x64}"
STAGING="${2:-${ROOT_DIR}/dist-package/cmspark-${PLATFORM}}"
OUTPUT_DIR="${3:-${ROOT_DIR}/dist-package}"
case "${PLATFORM}" in
  linux-x64) RPM_ARCH="x86_64" ;;
  linux-arm64) RPM_ARCH="aarch64" ;;
  *) echo "ERROR: unsupported RPM platform: ${PLATFORM}" >&2; exit 1 ;;
esac
VERSION="$(node -p "require('${ROOT_DIR}/companion/package.json').version")"
RELEASE="${CMSPARK_RPM_RELEASE:-1}"
[[ "${RELEASE}" =~ ^[A-Za-z0-9._+~]+$ ]] || { echo "ERROR: invalid RPM release" >&2; exit 1; }
for required in cmspark-agent.js launch-companion.sh node assets/cmspark.png chrome-extension/manifest.json node_modules/systray2/traybin/tray_linux_release; do
  [[ -s "${STAGING}/${required}" ]] || { echo "ERROR: staging is missing ${required}" >&2; exit 1; }
done
node "${ROOT_DIR}/scripts/verify-linux-tray.mjs" "${STAGING}" "${PLATFORM}"
for tool in rpmbuild install; do command -v "${tool}" >/dev/null 2>&1 || { echo "ERROR: ${tool} is required" >&2; exit 1; }; done
mkdir -p "${OUTPUT_DIR}"
BUILD_ROOT="$(mktemp -d "${OUTPUT_DIR}/.rpm-build-${PLATFORM}.XXXXXXXX")"
trap 'rm -rf "${BUILD_ROOT}"' EXIT
TOP="${BUILD_ROOT}/rpmbuild"
PAYLOAD="${TOP}/SOURCES/payload"
mkdir -p "${TOP}/BUILD" "${TOP}/RPMS" "${TOP}/SOURCES" "${TOP}/SPECS" "${TOP}/SRPMS" "${PAYLOAD}/opt/cmspark" "${PAYLOAD}/usr/bin" "${PAYLOAD}/usr/lib/systemd/user" "${PAYLOAD}/usr/share/applications" "${PAYLOAD}/usr/share/icons/hicolor/256x256/apps"
cp -a "${STAGING}/." "${PAYLOAD}/opt/cmspark/"
install -d "${PAYLOAD}/opt/cmspark"
install -m 0755 "${ROOT_DIR}/scripts/packaging/linux/launch-desktop.sh" "${PAYLOAD}/opt/cmspark/launch-desktop.sh"
install -m 0755 "${ROOT_DIR}/scripts/packaging/linux/cmspark-agent" "${PAYLOAD}/usr/bin/cmspark-agent"
install -m 0644 "${ROOT_DIR}/scripts/packaging/linux/systemd/"*.service "${PAYLOAD}/usr/lib/systemd/user/"
install -m 0644 "${ROOT_DIR}/scripts/packaging/linux/cmspark.desktop" "${PAYLOAD}/usr/share/applications/cmspark.desktop"
install -m 0644 "${STAGING}/assets/cmspark.png" "${PAYLOAD}/usr/share/icons/hicolor/256x256/apps/cmspark.png"

cat > "${TOP}/SPECS/cmspark.spec" <<EOF
# Keep shipped Node/Go binaries and integrity-bound resources byte-identical.
%global __os_install_post %{nil}
%global debug_package %{nil}
Name:           cmspark
Version:        ${VERSION}
Release:        ${RELEASE}%{?dist}
Summary:        CMspark Browser Agent Companion
License:        MIT
URL:            https://github.com/nehcuh/cmspark
BuildArch:      ${RPM_ARCH}
Requires:       glibc, libstdc++, libgcc, libappindicator-gtk3, gtk3, xclip
Recommends:     wl-clipboard

%description
CMspark local companion and browser automation agent.

%prep

%build

%install
mkdir -p "%{buildroot}"
cp -a "%{_sourcedir}/payload/." "%{buildroot}/"

%files
/opt/cmspark
/usr/bin/cmspark-agent
/usr/lib/systemd/user/cmspark-companion.service
/usr/lib/systemd/user/cmspark-tray.service
/usr/share/applications/cmspark.desktop
/usr/share/icons/hicolor/256x256/apps/cmspark.png

%changelog
* Thu Nov 05 2026 CMspark <release@cmspark.local> - ${VERSION}-${RELEASE}
- Build ${PLATFORM} RPM installer
EOF

rpmbuild --target "${RPM_ARCH}" --define "_topdir ${TOP}" --define "_rpmdir ${TOP}/RPMS" --define "_build_id_links none" -bb "${TOP}/SPECS/cmspark.spec"
shopt -s nullglob
RPM_FILES=( "${TOP}/RPMS/${RPM_ARCH}/cmspark-${VERSION}-${RELEASE}"*".${RPM_ARCH}.rpm" )
[[ "${#RPM_FILES[@]}" -eq 1 && -s "${RPM_FILES[0]}" ]] || { echo "ERROR: expected one RPM package" >&2; exit 1; }
cp "${RPM_FILES[0]}" "${OUTPUT_DIR}/cmspark-${VERSION}-${RELEASE}.${RPM_ARCH}.rpm"
echo "Wrote ${OUTPUT_DIR}/cmspark-${VERSION}-${RELEASE}.${RPM_ARCH}.rpm"
