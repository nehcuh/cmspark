// CPU transport checks fed by the actual C# production serializer. This does
// not fabricate a native-positive HWND or call a browser/native implementation.
'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
assert.equal(process.argv.length, 4, 'compiled extension root and actual C# receipt required')
const compiled = path.resolve(process.argv[2]), receiptFile = fs.realpathSync(process.argv[3])
const owned = fs.realpathSync(process.env.CMSPARK_TEST_RUN_DIR)
const relative = path.relative(owned, receiptFile)
assert.ok(relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
const st = fs.lstatSync(receiptFile)
assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size <= 4096)
const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
assert.equal(receipt.kind, 'controlled-csharp-framing'); assert.equal(receipt.native, 'NOT_RUN')
assert.ok(receipt.passed > 0)
const { attachCockpitNativeBridge } = require(path.join(compiled, 'src/cockpit/native-bridge.js'))
function channel() {
  const messages = new Set(), disconnects = new Set(), sent = []
  let closes = 0
  return {
    sent, closes: () => closes,
    emit(value) { for (const fn of [...messages]) fn(value) },
    closeEvent() { for (const fn of [...disconnects]) fn() },
    postMessage(value) { sent.push(value) },
    disconnect() { closes++; this.closeEvent() },
    onMessage: { addListener: fn => messages.add(fn), removeListener: fn => messages.delete(fn) },
    onDisconnect: { addListener: fn => disconnects.add(fn), removeListener: fn => disconnects.delete(fn) },
  }
}
const actual = receipt.boundFixture
function setup() {
  const runtime = channel(), native = channel()
  const stop = attachCockpitNativeBridge(runtime, { connectNative(host) { assert.equal(host, 'com.cmspark.cockpit'); return native }, consumeLastError() {} })
  const { v, ownerNonce, challenge, documentId, windowId } = actual
  runtime.emit({ v, op: 'bind', ownerNonce, challenge, documentId, windowId })
  return { runtime, native, stop }
}
let passed = 0
{
  const s = setup(); s.native.emit(actual)
  assert.deepEqual(s.runtime.sent, [actual])
  s.runtime.emit({ v: 1, op: 'dispose', ownerNonce: actual.ownerNonce, portNonce: actual.portNonce })
  assert.deepEqual(s.native.sent[1], { v: 1, op: 'dispose', ownerNonce: actual.ownerNonce, portNonce: actual.portNonce })
  assert.equal(s.native.closes(), 0, 'dispose post must not prematurely close the native process')
  s.native.closeEvent(); s.stop(); passed++
}
{
  const s = setup(); s.stop(); s.native.emit(actual)
  assert.deepEqual(s.runtime.sent, [])
  assert.deepEqual(s.native.sent[1], { v: 1, op: 'dispose', ownerNonce: actual.ownerNonce, portNonce: actual.portNonce })
  assert.equal(s.native.closes(), 0)
  s.native.closeEvent(); passed++
}
{
  const s = setup(); s.native.emit({ ...actual, ownerNonce: 'd'.repeat(32) })
  assert.deepEqual(s.runtime.sent, [{ v: 1, op: 'unavailable', reason: 'bridge_unavailable' }])
  assert.equal(s.native.closes(), 1); s.stop(); passed++
}
{
  const s = setup(); s.native.emit(actual); s.native.emit(actual)
  assert.equal(s.runtime.sent.filter(v => v.op === 'bound').length, 1)
  assert.equal(s.runtime.sent.filter(v => v.op === 'unavailable').length, 1)
  assert.equal(s.native.sent.filter(v => v.op === 'dispose').length, 1)
  assert.equal(s.native.closes(), 0)
  s.native.closeEvent(); s.stop(); passed++
}
process.stdout.write(JSON.stringify({ kind: 'controlled-document-production-receipt', passed, native: 'NOT_RUN', browser: 'NOT_RUN' }) + '\n')
