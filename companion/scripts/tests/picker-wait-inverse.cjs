/** Source lineage only. Restores the timed picker waits before any older hash lock. */
'use strict'
const assert = require('node:assert/strict')
const {createHash} = require('node:crypto')
const NEW_DIGEST = 'cae70de5964a0bdd3b7d1e460385188584a2b09729f91a5a079fb86b9017d2a9'
const OLD_DIGEST = '2eca9be781a3c401b6d96bf8cba6b41f9c8fe32f9be5052be094d0ae27c972b8'
const HELPER_SUCCESS = '56cb1183b0e057b879d11567424c5b325362e7dbfd373edeca4faa5dd73751e5'
const pairs = [
  [
    'uiStage=stage;uiDetail=0;observeUIStage();let windows=app.windows.matching(identifier:scene.nonce);let windowTimeout=try remaining();uiDetail=1;observeUIStage();let windowOne=windows.element(boundBy:0).waitForExistence(timeout:windowTimeout);uiDetail=windowOne ? 2:1;observeUIStage();guard windowOne else{throw OwnedUI705Error.refused};let windowCount=windows.count;uiDetail=min(windowCount,2)+1;observeUIStage();guard windowCount==1 else{throw OwnedUI705Error.refused};let w=windows.firstMatch',
    'uiStage=stage;uiDetail=0;observeUIStage();let windows=app.windows.matching(identifier:scene.nonce),count=windows.count;uiDetail=min(count,2)+1;observeUIStage();guard count==1 else{throw OwnedUI705Error.refused};let w=windows.firstMatch'
  ],
  [
    'uiStage=stage+2;uiDetail=0;observeUIStage();let sheetCount=w.sheets.count;uiDetail=min(sheetCount,2)+1;observeUIStage();guard sheetCount==1 else{throw OwnedUI705Error.refused};return w.sheets.firstMatch',
    'uiStage=stage+2;uiDetail=0;observeUIStage();let sheets=w.sheets.count;uiDetail=min(sheets,2)+1;observeUIStage();guard sheets==1 else{throw OwnedUI705Error.refused};return w.sheets.firstMatch'
  ],
  [
    'let cancelOne=cancel.element(boundBy:0).waitForExistence(timeout:try remaining());uiDetail=cancelOne ? 2:1;observeUIStage();guard cancelOne else{throw OwnedUI705Error.refused};let cancelCount=cancel.count;uiDetail=min(cancelCount,2)+1;observeUIStage();guard cancelCount==1 else{throw OwnedUI705Error.refused}',
    'let cancelCount=cancel.count;uiDetail=min(cancelCount,2)+1;observeUIStage();guard cancelCount==1 else{throw OwnedUI705Error.refused}'
  ]
]
function restorePickerWait(kind, raw, options = {}) {
  const requireSuccessDigest = options.requireSuccessDigest !== false
  if (typeof raw !== 'string') throw new Error('PICKER_WAIT_SOURCE_REQUIRED')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let value = raw.replace(/\r\n/g, '\n')
  const digest = text => createHash('sha256').update(text).digest('hex')
  if (kind === 'helper') {
    if (!value.includes(NEW_DIGEST)) return raw
    const stderrNote = ";try{require('./picker-failure-evidence-476').notePickerToolStderr476(b)}catch{}"
    assert.equal(value.split(stderrNote).length, 2, 'XCRESULT_STDERR_ONCE')
    value = value.replace(stderrNote, '')
    assert.equal(value.split(NEW_DIGEST).length, 2, 'PICKER_WAIT_HELPER_DIGEST_ONCE')
    value = value.replace(NEW_DIGEST, OLD_DIGEST)
    if (requireSuccessDigest) assert.equal(digest(value), HELPER_SUCCESS, 'PICKER_WAIT_HELPER_SUCCESS')
    return value.replace(/\n/g, eol)
  }
  if (kind !== 'ui' || !value.includes('let windowOne=')) return raw
  for (const [current, prior] of pairs) {
    assert.equal(value.split(current).length, 2, 'PICKER_WAIT_UI_ONCE')
    value = value.replace(current, prior)
  }
  if (requireSuccessDigest) assert.equal(digest(value), OLD_DIGEST, 'PICKER_WAIT_UI_SUCCESS')
  return value.replace(/\n/g, eol)
}
module.exports = {restorePickerWait, NEW_DIGEST, OLD_DIGEST}
