#!/usr/bin/env bash
# Test-only. Always allocate a fresh display and notification bus before entering.
set -euo pipefail
if [ "${1:-}" != '--owned-x11' ]; then
  node --max-old-space-size=3072 scripts/tests/activity-linux-apps-observation-758.cpu.mjs
  exec dbus-run-session -- xvfb-run -a -s '-screen 0 1280x900x24 -nolisten tcp' bash "$0" --owned-x11
fi
: "${DISPLAY:?owned Xvfb display required}"
: "${DBUS_SESSION_BUS_ADDRESS:?owned notification bus required}"
export XDG_SESSION_TYPE=x11
unset WAYLAND_DISPLAY
openbox > "${TMPDIR:-/tmp}/activity758-openbox.log" 2>&1 &
wm=$!
dunst > "${TMPDIR:-/tmp}/activity758-dunst.log" 2>&1 &
notifier=$!
lock_root=$(mktemp -d "${TMPDIR:-/tmp}/activity758-lock-XXXXXXXX")
/usr/bin/python3 tests/fixtures/activity-lock-service-758.py "$lock_root" > "$lock_root/service.log" 2>&1 &
locker=$!
cleanup() {
  kill "$locker" "$notifier" "$wm" 2>/dev/null || true
  wait "$locker" "$notifier" "$wm" 2>/dev/null || true
  rm -rf "$lock_root"
}
trap cleanup EXIT
CMSPARK_ACTIVITY_LOCK_FIXTURE_758="$lock_root" CMSPARK_ACTIVITY_PRIVATE_BUS_758=1 CMSPARK_ACTIVITY_NATIVE_758=1 node scripts/run-tests.mjs .test-dist/tests/activity-platform-native-758.test.js
