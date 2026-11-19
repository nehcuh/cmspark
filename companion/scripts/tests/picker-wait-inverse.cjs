/** Source lineage only. Restores the timed picker waits before any older hash lock. */
'use strict'
const assert = require('node:assert/strict')
const {createHash} = require('node:crypto')
const NEW_DIGEST = '5fbd591c51695896d6f7f9241c77137acbb9557796401abc8341839ffc1a3e88'
const OLD_DIGEST = '2eca9be781a3c401b6d96bf8cba6b41f9c8fe32f9be5052be094d0ae27c972b8'
const HELPER_SUCCESS = '56cb1183b0e057b879d11567424c5b325362e7dbfd373edeca4faa5dd73751e5'
const pairs = [
  [
    'uiStage=stage;uiDetail=0;observeUIStage();let windows=app.windows.matching(identifier:scene.nonce);let windowTimeout=try remaining();uiDetail=1;observeUIStage();let windowOne=windows.element(boundBy:0).waitForExistence(timeout:windowTimeout);uiDetail=windowOne ? 2:1;observeUIStage();guard windowOne else{throw OwnedUI705Error.refused};let windowExtra=windows.element(boundBy:1).waitForExistence(timeout:1);uiDetail=windowExtra ? 3:2;observeUIStage();guard !windowExtra else{throw OwnedUI705Error.refused};let w=windows.firstMatch',
    'uiStage=stage;uiDetail=0;observeUIStage();let windows=app.windows.matching(identifier:scene.nonce),count=windows.count;uiDetail=min(count,2)+1;observeUIStage();guard count==1 else{throw OwnedUI705Error.refused};let w=windows.firstMatch'
  ],
  [
    'uiStage=stage+2;uiDetail=0;observeUIStage();if stage != 15 {let sheetExtra=w.sheets.element(boundBy:1).waitForExistence(timeout:1);uiDetail=sheetExtra ? 3:2;observeUIStage();guard !sheetExtra else{throw OwnedUI705Error.refused}};return w.sheets.firstMatch',
    'uiStage=stage+2;uiDetail=0;observeUIStage();let sheets=w.sheets.count;uiDetail=min(sheets,2)+1;observeUIStage();guard sheets==1 else{throw OwnedUI705Error.refused};return w.sheets.firstMatch'
  ],
  [
    'let comboOne=first.comboBoxes.element(boundBy:0).waitForExistence(timeout:1);let comboExtra=first.comboBoxes.element(boundBy:1).waitForExistence(timeout:1);uiDetail=(comboOne && !comboExtra) ? 2:1;observeUIStage();let inputs=(comboOne && !comboExtra) ? first.comboBoxes:first.textFields',
    'let comboCount=first.comboBoxes.count;uiDetail=min(comboCount,2)+1;observeUIStage();let inputs=comboCount==1 ? first.comboBoxes:first.textFields'
  ],
  [
    'let inputOne=inputs.element(boundBy:0).waitForExistence(timeout:try remaining());uiDetail=inputOne ? 2:1;observeUIStage();guard inputOne else{throw OwnedUI705Error.refused};let inputExtra=inputs.element(boundBy:1).waitForExistence(timeout:1);uiDetail=inputExtra ? 3:2;observeUIStage();guard !inputExtra else{throw OwnedUI705Error.refused}',
    'let inputCount=inputs.count;uiDetail=min(inputCount,2)+1;observeUIStage();guard inputCount==1 else{throw OwnedUI705Error.refused}'
  ],
  [
    'guard chooseSeen else{throw OwnedUI705Error.refused};let chooseExtra=choose.element(boundBy:1).waitForExistence(timeout:1);uiDetail=chooseExtra ? 3:2;observeUIStage();guard !chooseExtra else{throw OwnedUI705Error.refused}',
    'guard chooseSeen else{throw OwnedUI705Error.refused};let chooseCount=choose.count;uiDetail=min(chooseCount,2)+1;observeUIStage();guard chooseCount==1 else{throw OwnedUI705Error.refused}'
  ],
  [
    'let cancelOne=cancel.element(boundBy:0).waitForExistence(timeout:try remaining());uiDetail=cancelOne ? 2:1;observeUIStage();guard cancelOne else{throw OwnedUI705Error.refused};let cancelExtra=cancel.element(boundBy:1).waitForExistence(timeout:1);uiDetail=cancelExtra ? 3:2;observeUIStage();guard !cancelExtra else{throw OwnedUI705Error.refused}',
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
