#!/bin/bash
# Finder can still be flushing a window's layout when the publisher ejects its image.
set -u
mount_point=${1:?expected the mount point of the owned image}
for delay in 1 2 4 0; do
  hdiutil detach "${mount_point}" && exit 0
  status=$?
  if [ "${status}" -ne 16 ] || [ "${delay}" -eq 0 ]; then exit "${status}"; fi
  sleep "${delay}"
done
