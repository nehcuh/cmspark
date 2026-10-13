#!/usr/bin/env bash
# A fresh container uses baked dependencies, never the host's native node_modules.
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker build --platform linux/arm64 -f "${TASK_ROOT}/docker/office-val.Dockerfile" -t cmspark-office-val:node22.23.2 "${TASK_ROOT}"
docker run --rm --platform linux/arm64 -v "${TASK_ROOT}:/source:ro" cmspark-office-val:node22.23.2 bash -c '
  set -euo pipefail
  cp -R /source/companion/src /source/companion/tests /source/companion/scripts /source/companion/assets /opt/cmspark/companion/
  cp /source/companion/tsconfig*.json /opt/cmspark/companion/
  cp -R /source/scripts /opt/cmspark/scripts
  mkdir -p /opt/cmspark/chrome-extension
  cp -R /source/chrome-extension/src /opt/cmspark/chrome-extension/
  cd /opt/cmspark/companion
  npx tsc -p tsconfig.test.json
  node scripts/run-tests.mjs .test-dist/tests/office-format-compatibility.test.js .test-dist/tests/office-import-entry.test.js .test-dist/tests/odf-expansion.test.js
  cd /opt/cmspark
  node --test scripts/tests/office-runtime-stage.test.mjs
  node scripts/smoke-office-runtime.mjs --platform linux-arm64
'
