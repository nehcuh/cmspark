#!/bin/sh
set -eu

SYSTEMCTL="${CMSPARK_SYSTEMCTL:-/usr/bin/systemctl}"
"$SYSTEMCTL" --user daemon-reload
"$SYSTEMCTL" --user start cmspark-companion.service
