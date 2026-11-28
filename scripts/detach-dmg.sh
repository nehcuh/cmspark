#!/bin/bash
# A busy eject can unmount the volume before the backing image is detached.
set -uo pipefail
mount_point=${1:?expected owned mount point}
image_path=${2:?expected owned image path}

attached_device() {
  hdiutil info -plist | /usr/bin/python3 -c '
import os, plistlib, re, sys
image, mount = map(os.path.realpath, sys.argv[1:])
images = plistlib.loads(sys.stdin.buffer.read())["images"]
matches = [i for i in images if os.path.realpath(i["image-path"]) == image]
if not matches:
    sys.exit(0)
if len(matches) != 1:
    sys.exit("Ambiguous disk image attachment")
entities = matches[0]["system-entities"]
mounts = {os.path.realpath(e["mount-point"]) for e in entities if "mount-point" in e}
disks = [e["dev-entry"] for e in entities if re.fullmatch(r"/dev/disk[0-9]+", e.get("dev-entry", ""))]
if mounts - {mount} or len(disks) != 1:
    sys.exit("Cannot identify the owned disk image attachment")
print(disks[0])
' "$image_path" "$mount_point"
}

for delay in 1 2 4 0; do
  device=$(attached_device) || exit 1
  [ -n "$device" ] || exit 0
  hdiutil detach "$device" && exit 0
  status=$?
  if [ "$status" -ne 16 ] || [ "$delay" -eq 0 ]; then
    # A concurrent eject can complete between the inventory and the detach.
    remaining=$(attached_device) || exit "$status"
    [ -z "$remaining" ] && exit 0
    exit "$status"
  fi
  sleep "$delay"
done
