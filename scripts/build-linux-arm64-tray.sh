#!/usr/bin/env bash
# Native build of the same upstream JSON protocol used by systray2 2.1.4.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(uname -s)" == Linux && "$(uname -m)" == aarch64 ]] || { echo 'ERROR: native Linux ARM64 build required' >&2; exit 1; }
for tool in go gcc pkg-config curl sha256sum tar; do command -v "${tool}" >/dev/null; done
pkg-config --exists appindicator3-0.1
SOURCE_COMMIT=6eddc917bf39fcc0d95b57a0741d0c065fbd1e23
SOURCE_SHA256=f691ff456037d8f71661820387840ea73317eb47e4369ec845e608382b52a12f
OUTPUT="${ROOT}/companion/dist/linux-arm64-tray"
mkdir -p "${OUTPUT}"
BUILD="$(mktemp -d "${OUTPUT}/.build.XXXXXXXX")"
trap 'rm -rf "${BUILD}"' EXIT
curl --fail --location --retry 3 "https://codeload.github.com/felixhao28/systray-portable/tar.gz/${SOURCE_COMMIT}" -o "${BUILD}/source.tgz"
printf '%s  %s\n' "${SOURCE_SHA256}" "${BUILD}/source.tgz" | sha256sum --check --status
tar -xzf "${BUILD}/source.tgz" --strip-components=1 -C "${BUILD}"
(
  cd "${BUILD}"
  export CGO_ENABLED=1 GOTOOLCHAIN=local
  go mod download
  go mod verify
  go build -mod=readonly -trimpath -buildvcs=false -ldflags '-s -w' -o tray_linux_release .
)
install -m 0755 "${BUILD}/tray_linux_release" "${OUTPUT}/tray_linux_release"
install -m 0644 "${BUILD}/LICENSE" "${OUTPUT}/LICENSE"
printf 'systray2 2.1.4 protocol; upstream %s; source SHA256 %s\n' "${SOURCE_COMMIT}" "${SOURCE_SHA256}" > "${OUTPUT}/SOURCE.txt"
echo "Built native Linux ARM64 tray: ${OUTPUT}/tray_linux_release"
