#!/usr/bin/env bash
set -euo pipefail

node --test scripts/tests/architecture-dependencies.test.mjs
node scripts/architecture-dependencies.mjs
