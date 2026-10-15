// Test-only addon exports inspectOwned; product addon never exposes it.
const assert = require('node:assert/strict')
const path = require('node:path')
const root = process.argv[2], mode = process.argv[3]
assert.ok(['notify', 'worker', 'normal'].includes(mode))
const binding = require(path.join(root, `desktop-construction-${mode}.node`))
let threw = false, code = null, child, callbacks = [], timer
let resolveExit
const exit = new Promise(resolve => { resolveExit = resolve })
try {
  child = binding.launch(path.join(root, mode === 'normal' ? 'desktop-construction-exit7' : 'desktop-construction-receiver'),
    '11'.repeat(16), '22'.repeat(32), 'ws://127.0.0.1:1/desktop', value => { callbacks.push(value); resolveExit(value) })
} catch (error) { threw = true; code = error.code }
;(async () => {
  if (mode === 'notify') await new Promise(resolve => { timer = setTimeout(resolve, 150) })
  else await Promise.race([exit, new Promise(resolve => { timer = setTimeout(resolve, 2000) })])
  clearTimeout(timer)
  await new Promise(resolve => setImmediate(resolve))
  const observation = binding.inspectOwned()
  const receipt = { mode, threw, error_code: code, returned: !!child, callbacks, ...observation }
  console.log('OWNED_DESKTOP_CONSTRUCTION ' + JSON.stringify(receipt))
  try {
    assert.ok(observation.owned_pid > 0, 'must have really spawned our direct child')
    assert.equal(observation.reaped, true, 'owned child must be reaped, not live or zombie')
    assert.equal(observation.exited_unreaped, false)
    if (mode === 'notify') { assert.equal(threw, true); assert.equal(code, 'DESKTOP_LAUNCH_FAILED'); assert.equal(child, undefined); assert.deepEqual(callbacks, []) }
    else { assert.equal(threw, false); assert.ok(child); assert.deepEqual(callbacks, [mode === 'worker' ? 1 : 7]); child.terminate(); assert.equal(binding.inspectOwned().reaped, true) }
  } catch (error) { console.error(error.stack); process.exit(1) }
})().catch(error => { console.error(error.stack); process.exit(1) })
