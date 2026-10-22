// Source-derived from main ab61257; only an exactly validated split can be
// projected back into the historical #750 whole-workflow conservation oracle.
import assert from 'node:assert/strict'
export const LEGACY_NATIVE760 = 'Actual native desktop build and isolated connection (#480)'
export const NATIVE_STAGES760 = Object.freeze([
  ['Build native desktop fixtures (#480)', 'node scripts/build-desktop-native.mjs --test-fixtures'],
  ['Compile native desktop acceptance tests (#480)', './node_modules/.bin/tsc -p tsconfig.test.json'],
  ['Native desktop bootstrap and process acceptance (#480)', 'node scripts/run-tests.mjs .test-dist/tests/desktop-native-macos-480.test.js .test-dist/tests/desktop-native-windows-480.test.js .test-dist/tests/desktop-native-mcp-476.test.js'],
  ['Native desktop interaction acceptance (#476)', 'node scripts/run-tests.mjs .test-dist/tests/desktop-native-thread-metadata-476.test.js'],
].map(Object.freeze))
const prefix = 'set -euo pipefail\ncd companion\n'
const ownership = '# The metadata key oracle owns the foreground; other native windows must exit first.\n'
export function collapseNativeStages760(steps) {
  assert.equal(steps.filter(s => s.name === LEGACY_NATIVE760).length, 0)
  const positions = NATIVE_STAGES760.map(([name, command], index) => {
    const matches = steps.map((step, at) => ({step, at})).filter(v => v.step.name === name)
    assert.equal(matches.length, 1, 'one required native stage: ' + name)
    assert.deepEqual(matches[0].step, {name, if: "matrix.os != 'ubuntu-latest'", shell: 'bash', run: prefix + (index === 3 ? ownership : '') + command + '\n'})
    return matches[0].at
  })
  assert.deepEqual(positions, positions.map((_, index) => positions[0] + index), 'native stages remain consecutive and ordered')
  const legacy = {name: LEGACY_NATIVE760, if: "matrix.os != 'ubuntu-latest'", shell: 'bash', run: prefix + NATIVE_STAGES760.map(([,command], index) => (index === 3 ? ownership : '') + command + '\n').join('')}
  return [...steps.slice(0, positions[0]), legacy, ...steps.slice(positions[0] + 4)]
}
