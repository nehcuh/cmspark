import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const native = fs.readFileSync(path.join(root, 'companion/tests/fixtures/desktop-476/metadata-acceptance.cpp'), 'utf8')
const collector = fs.readFileSync(path.join(root, 'companion/tests/desktop-native-thread-metadata-476.test.ts'), 'utf8')
function body(source, signature) {
  const start = source.indexOf(signature)
  if (start < 0) return undefined
  assert.equal(source.indexOf(signature, start + signature.length), -1)
  const open = source.indexOf('{', start)
  let depth = 0, quote = false, escape = false
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (quote) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quote = false; continue }
    if (c === '"') { quote = true; continue }
    if (c === '{') depth++
    if (c === '}') { depth--; if (depth === 0) return source.slice(open + 1, i) }
  }
  assert.fail('complete actual native method body required')
}
function translate(text) {
  return text.replace(/D476Acceptance::emit/g, 'emit').replace(/L"/g, '"')
    .replace(/const wchar_t\* id/g, 'const id').replace(/const BOOL foregroundAccepted/g, 'const foregroundAccepted').replace(/&h\b/g, 'h').replace(/&info\b/g, 'info').replace(/h\.controller->/g, 'h.controller.')
    .replace('GUITHREADINFO info{};info.cbSize=sizeof(info);', 'const info={cbSize:1};')
    .replace('const LPARAM scan=(LPARAM)(MapVirtualKeyW(code,MAPVK_VK_TO_VSC)&0xffu)<<16;', 'const scan=(MapVirtualKeyW(code,MAPVK_VK_TO_VSC)&0xff)<<16;')
    .replace(/\(LPARAM\)1/g, '1')
}
const key = body(native, 'void D476MetadataAcceptance::key(')
const failure = body(native, 'void D476MetadataAcceptance::failure(')
const keyFailure = body(native, 'void D476MetadataAcceptance::keyFailure(')
assert.ok(key && failure)
test('the entire native action closure is byte-identical after removing only closed failure labels', () => {
  const combined = 'if(FAILED(h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC))||GetForegroundWindow()!=h.window){keyFailure(h,2);return;}'
  const split = /if\(FAILED\(h\.controller->MoveFocus\(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC\)\)\)\{keyFailure\(h,2\);return;\}\r?\n if\(GetForegroundWindow\(\)!=h\.window\)\{keyFailure\(h,5\);return;\}/
  const originalLabels = key.replace('const BOOL foregroundAccepted=SetForegroundWindow(h.window);', 'SetForegroundWindow(h.window);').replace('keyFailure(h,foregroundAccepted?5:6)', 'keyFailure(h,5)')
  const restored = originalLabels.replace(split, combined).replace(/keyFailure\(h,[1-4]\)/g, 'failure(h)')
  // Exact complete original LF or Git's pure-CRLF checkout; never normalize
  // the executed file or silently accept mixed/different action bodies.
  assert.ok(['0414e39c06bbeb727081fc02eb1be1332b0b436d23840ea98745ada0866a7287',
    'd3ce687f376f15ab5b392393dbfe4b80a7dfa04e1e5260d074b1659d38ca4ef3'].includes(createHash('sha256').update(restored).digest('hex')))
})
const collectorLine = collector.split('\n').find(line => line.includes('if(typeof f.id===') && line.includes('failureCode='))
assert.ok(collectorLine)
function collect(id) {
  const code = `(function(f){let failureCode=0,failed=false,completed=0;const complete=()=>completed++;${collectorLine.replace(/as string\[\]/g, '')};return {failureCode,failed,completed}})`
  return vm.runInNewContext(code, Object.create(null))({ id })
}
function run(changes = {}, code = 27) {
  const calls = [], ids = [], h = { ready: true, generation: 'owned-document', controller: { MoveFocus: () => { calls.push('MoveFocus'); return changes.moveFailure ? -1 : 0 } }, window: 10 }
  Object.assign(h, changes.host || {})
  const context = { h, code, owner: changes.foreignOwner ? {} : h, loss: changes.loss || false, document: 'owned-document',
    emit: (_, id) => ids.push(id), IsWindowVisible: () => { calls.push('IsWindowVisible'); return !changes.invisible },
    SetForegroundWindow: () => { calls.push('SetForegroundWindow'); return !changes.requestDenied }, FAILED: n => n < 0,
    COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC: 0, GetForegroundWindow: () => { calls.push('GetForegroundWindow'); return changes.foreignForeground ? 99 : 10 },
    GetGUIThreadInfo: (_, info) => { calls.push('GetGUIThreadInfo'); info.hwndFocus = changes.noFocus ? 0 : 11; return !changes.guiFailure },
    GetAncestor: () => { calls.push('GetAncestor'); return changes.foreignAncestor ? 99 : 10 }, GA_ROOT: 2,
    MapVirtualKeyW: value => { calls.push('MapVirtualKeyW'); return value }, MAPVK_VK_TO_VSC: 0, WM_KEYDOWN: 256, WM_KEYUP: 257,
    PostMessageW: (_, message) => { calls.push(message === 256 ? 'PostKeyDown' : 'PostKeyUp'); return !(message === 256 ? changes.downFailure : changes.upFailure) } }
  const script = `function failure(h){${translate(failure)}};${keyFailure ? `function keyFailure(h,reason){${translate(keyFailure)}};` : ''}function key(h,code){${translate(key)}};key(h,code)`
  vm.runInNewContext(script, context)
  return { calls, ids }
}
const cases = [
  ['foreign owner', { foreignOwner: true }, 7], ['lost connection', { loss: true }, 7],
  ['not ready', { host: { ready: false } }, 7], ['old document', { host: { generation: 'old' } }, 7],
  ['no controller', { host: { controller: null } }, 7], ['no window', { host: { window: 0 } }, 7], ['invisible', { invisible: true }, 7],
  ['MoveFocus rejected', { moveFailure: true }, 8], ['foreign foreground', { foreignForeground: true }, 11], ['foreground request denied', { foreignForeground: true, requestDenied: true }, 12],
  ['GUI thread rejected', { guiFailure: true }, 9], ['no focused HWND', { noFocus: true }, 9], ['foreign focused root', { foreignAncestor: true }, 9],
  ['keydown rejected', { downFailure: true }, 10], ['keyup rejected', { upFailure: true }, 10],
]
for (const code of [27, 13]) {
  test(`actual owned native key ${code} successful path posts exactly its original two messages and no diagnostic`, () => {
    const result = run({}, code)
    assert.deepEqual(result.ids, [])
    assert.deepEqual(result.calls, ['IsWindowVisible', 'SetForegroundWindow', 'MoveFocus', 'GetForegroundWindow', 'GetGUIThreadInfo', 'GetAncestor', 'MapVirtualKeyW', 'PostKeyDown', 'PostKeyUp'])
  })
  for (const [name, scenario, expected] of cases) test(`actual owned native key ${code} ${name} reports its closed failure without an extra action`, () => {
    const result = run(scenario, code)
    assert.equal(result.ids.length, 1)
    const value = collect(result.ids[0])
    assert.equal(value.failureCode, expected)
    assert.equal(value.failed, true)
    assert.equal(value.completed, 1)
    assert.ok(result.calls.filter(x => x.startsWith('PostKey')).length <= (expected === 10 ? 2 : 0))
  })
}
test('existing metadata failure codes and unknown-prefix handling remain unchanged', () => {
  for (const [id, expected] of [['D476_FAIL_SCRIPT', 1], ['D476_FAIL_METADATA_PHASE', 2], ['D476_FAIL_NATIVE_WINDOW', 3], ['D476_FAIL_DEFAULT_SECRET', 4], ['D476_FAIL_FULL_VIEW', 5], ['D476_FAIL_BUTTON', 6], ['D476_FAIL_UNKNOWN', 0]]) {
    const actual = collect(id)
    assert.equal(actual.failureCode, expected); assert.equal(actual.failed, true); assert.equal(actual.completed, 1)
  }
  const ignored = collect('OTHER_PRIVATE_SENTINEL')
  assert.equal(ignored.failed, false); assert.equal(ignored.completed, 0)
})

test('a refused activation call never replaces actual owned foreground/ancestry checks', () => {
  const result = run({ requestDenied: true })
  assert.deepEqual(result.ids, [])
  assert.deepEqual(result.calls, ['IsWindowVisible', 'SetForegroundWindow', 'MoveFocus', 'GetForegroundWindow', 'GetGUIThreadInfo', 'GetAncestor', 'MapVirtualKeyW', 'PostKeyDown', 'PostKeyUp'])
})
