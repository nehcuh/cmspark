/** Source lineage only. Removes the host-tick diagnostic before any older hash. */
'use strict'
const assert = require('node:assert/strict')
const pairs = [
  ['pickerObserved=0,hostTicks=0,hostTickLast=null,pickerReturned=0', 'pickerObserved=0,pickerReturned=0'],
  ["\n    if(f.id==='D476_WS_HOST_TICK'){if(hostTicks<40){hostTicks++;hostTickLast='D476_WS_HOST_TICK' as any}}", ''],
  ['cancelCurrent,hostTicks,hostTickLast', 'cancelCurrent']
]
function restoreHostTick(raw) {
  if (typeof raw !== 'string') throw new Error('HOST_TICK_SOURCE_REQUIRED')
  if (!raw.includes('hostTicks') && !raw.includes('D476_WS_HOST_TICK')) return raw
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let value = raw.replace(/\r\n/g, '\n')
  for (const [current, prior] of pairs) {
    assert.equal(value.split(current).length, 2, 'HOST_TICK_ONCE')
    value = value.replace(current, prior)
  }
  return value.replace(/\n/g, eol)
}
module.exports = {restoreHostTick, pairs}
