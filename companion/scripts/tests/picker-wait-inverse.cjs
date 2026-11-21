/** Source lineage only. Restores the timed picker waits before any older hash lock. */
'use strict'
const assert = require('node:assert/strict')
const {createHash} = require('node:crypto')
const NEW_DIGEST = '571e2c7f0d7c61e3a830a695967014705268726466dd40627922bd27724dc8fa'
const SECOND_READY_DIGEST = '33645c729edd5672abf72ed8ac322c7439be17f57a9360406ffee13f27bb319a'
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
const readyPairs = [
  [`  func requireUniqueAfterReady(_ query:XCUIElementQuery,_ stage:Int,_ countStage:Int) throws {
   uiStage=stage;uiDetail=0;observeUIStage();_ = try remaining()
   var count=query.count
   if count==0 {
    let exists=query.firstMatch.waitForExistence(timeout:try remaining())
    guard exists else{throw OwnedUI705Error.refused}
    _ = try remaining();count=query.count
   }
   uiStage=countStage;uiDetail=min(count,2)+1;observeUIStage()
   guard count==1 else{throw OwnedUI705Error.refused}
   _ = try remaining()
  }
`, ''],
  [`  uiStage=14;uiDetail=0;observeUIStage();try ready(.second,2)
  // The host has shown the second panel. Check uniqueness directly and wait
  // only if XCTest's accessibility tree has not exposed the element yet.
  let secondOwners=app.windows.matching(identifier:scene.nonce)
  try requireUniqueAfterReady(secondOwners,15,15)
  let secondSheets=secondOwners.firstMatch.sheets
  try requireUniqueAfterReady(secondSheets,16,17)
  let second=secondSheets.firstMatch
  let cancel=second.buttons.matching(identifier:"Cancel")
  try requireUniqueAfterReady(cancel,18,18)
`, `  uiStage=14;uiDetail=0;observeUIStage();try ready(.second,2);let second=try sheet(15),cancel=second.buttons.matching(identifier:"Cancel")
  uiStage=18;uiDetail=0;observeUIStage();let cancelOne=cancel.element(boundBy:0).waitForExistence(timeout:try remaining());uiDetail=cancelOne ? 2:1;observeUIStage();guard cancelOne else{throw OwnedUI705Error.refused};let cancelCount=cancel.count;uiDetail=min(cancelCount,2)+1;observeUIStage();guard cancelCount==1 else{throw OwnedUI705Error.refused}
`],
]
function restoreChooseWait(raw) {
  const current = '  try requireUniqueAfterReady(choose,11,11)'
  if (!raw.includes(current)) return raw
  assert.equal(raw.split(current).length, 2, 'PICKER_CHOOSE_QUERY_ONCE')
  return raw.replace(current, '  uiStage=11;uiDetail=0;observeUIStage();let chooseElement=choose.firstMatch;uiDetail=3;observeUIStage();let chooseTimeout=try remaining();uiDetail=4;observeUIStage();let chooseSeen=chooseElement.waitForExistence(timeout:chooseTimeout);uiDetail=chooseSeen ? 2:1;observeUIStage();guard chooseSeen else{throw OwnedUI705Error.refused};let chooseCount=choose.count;uiDetail=min(chooseCount,2)+1;observeUIStage();guard chooseCount==1 else{throw OwnedUI705Error.refused}')
}

function restoreFirstReadyPickerUi(raw) {
  raw = restoreChooseWait(raw)
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const value = raw.replace(/\r\n/g, '\n')
  if (!value.includes('let owners=app.windows') && !value.includes('try requireUniqueAfterReady(owners,')) return raw
  const current = [
    '   let owners=app.windows.matching(identifier:scene.nonce)',
    '   try requireUniqueAfterReady(owners,stage,stage)',
    '   let sheets=owners.firstMatch.sheets',
    '   try requireUniqueAfterReady(sheets,stage+1,stage+2)',
    '   return sheets.firstMatch',
  ].join('\n')
  const prior = [
    '   ' + pairs[0][0],
    '   uiStage=stage+1;uiDetail=0;observeUIStage();let exists=w.sheets.firstMatch.waitForExistence(timeout:try remaining());uiDetail=exists ? 2:1;observeUIStage();guard exists else{throw OwnedUI705Error.refused}',
    '   ' + pairs[1][0],
  ].join('\n')
  assert.equal(value.split(current).length, 2, 'PICKER_FIRST_READY_QUERY_ONCE')
  return value.replace(current, prior).replace(/\n/g, eol)
}

function restoreReadyPickerUi(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let value = raw.replace(/\r\n/g, '\n')
  if (!value.includes('requireUniqueAfterReady') && !value.includes('let secondOwners=')) return raw
  for (const [current, prior] of readyPairs) {
    assert.equal(value.split(current).length, 2, 'PICKER_READY_QUERY_ONCE')
    value = value.replace(current, prior)
  }
  return value.replace(/\n/g, eol)
}

function restorePickerWait(kind, raw, options = {}) {
  const requireSuccessDigest = options.requireSuccessDigest !== false
  if (typeof raw !== 'string') throw new Error('PICKER_WAIT_SOURCE_REQUIRED')
  if (kind === 'ui') raw = restoreReadyPickerUi(restoreFirstReadyPickerUi(raw))
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let value = raw.replace(/\r\n/g, '\n')
  const digest = text => createHash('sha256').update(text).digest('hex')
  if (kind === 'helper') {
    const current = value.includes(NEW_DIGEST) ? NEW_DIGEST : SECOND_READY_DIGEST
    if (!value.includes(current)) return raw
    const stderrNote = ";try{require('./picker-failure-evidence-476').notePickerToolStderr476(b)}catch{}"
    assert.equal(value.split(stderrNote).length, 2, 'XCRESULT_STDERR_ONCE')
    value = value.replace(stderrNote, '')
    assert.equal(value.split(current).length, 2, 'PICKER_WAIT_HELPER_DIGEST_ONCE')
    value = value.replace(current, OLD_DIGEST)
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
module.exports = {restorePickerWait, restoreFirstReadyPickerUi, restoreChooseWait, NEW_DIGEST, OLD_DIGEST}
