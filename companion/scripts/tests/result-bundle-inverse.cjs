/** Source lineage only. Restores the xcodebuild result-bundle argument before any helper hash. */
'use strict'
const assert = require('node:assert/strict')
const CURRENT = "'-only-testing:OwnedPickerUITests/WorkspacePicker705/testOwnedPanel'],'xcode'"
const PRIOR = "'-only-testing:OwnedPickerUITests/WorkspacePicker705/testOwnedPanel','-resultBundlePath',path.join(this.scene.root,'Result.xcresult')],'xcode'"
function restoreResultBundle(raw) {
  if (typeof raw !== 'string') throw new Error('RESULT_BUNDLE_SOURCE_REQUIRED')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let value = raw.replace(/\r\n/g, '\n')
  assert.equal(value.split(CURRENT).length, 2, 'RESULT_BUNDLE_ONCE')
  value = value.replace(CURRENT, PRIOR)
  return value.replace(/\n/g, eol)
}
module.exports = {restoreResultBundle, CURRENT, PRIOR}
