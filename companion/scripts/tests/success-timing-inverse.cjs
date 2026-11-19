/** Source lineage only. Restores the failure-only timing read before any older hash. */
'use strict'
const assert = require('node:assert/strict')
const current = 'try{cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}'
const prior = 'try{if(primaryFailed)cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}'
const evidence = "if(primaryFailed)try{require('./helpers/picker-failure-evidence-476').preservePickerFailureEvidence476(uiOwner)}catch{try{t.diagnostic('D476_PICKER_EVIDENCE_COPY_FAILED')}catch{}};"
const removal = 'fs.rmSync(dir,{recursive:true,force:true})'
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
  if (value.includes(removal)) {
    assert.equal(value.split(evidence).length, 2, 'PICKER_EVIDENCE_ONCE')
    value = value.replace(evidence, '')
  }
  value = value.replace(current, prior)
  return value.replace(/\n/g, eol)
}
module.exports = {restoreSuccessTiming476, current, prior, evidence}
