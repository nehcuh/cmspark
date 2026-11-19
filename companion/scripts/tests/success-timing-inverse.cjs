/** Source lineage only. Restores the failure-only timing read before any older hash. */
'use strict'
const assert = require('node:assert/strict')
const current = 'try{cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}'
const prior = 'try{if(primaryFailed)cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}'
function restoreSuccessTiming476(raw) {
  if (typeof raw !== 'string') throw new Error('SUCCESS_TIMING_SOURCE_REQUIRED')
  if (!raw.includes('cancelTiming788')) return raw
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let value = raw.replace(/\r\n/g, '\n')
  const seen = value.split(current).length - 1
  if (seen === 0) {
    assert.equal(value.split(prior).length, 2, 'SUCCESS_TIMING_ONCE')
    return raw
  }
  assert.equal(seen, 1, 'SUCCESS_TIMING_ONCE')
  if (value.includes('const uiDeadline=')) {
    assert.equal(value.split('Date.now()+44000').length, 2, 'DEADLINE_MARGIN_ONCE')
    value = value.replace('Date.now()+44000', 'Date.now()+45000')
  }
  value = value.replace(current, prior)
  return value.replace(/\n/g, eol)
}
module.exports = {restoreSuccessTiming476, current, prior}
