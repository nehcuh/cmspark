import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { compilerFailureObservation758 } from './helpers/activity-compiler-observation-758'

test('#758 compiler failure observation emits only fixed finite data', () => {
  const error = Object.assign(new Error('PRIVATE_PATH'), { code: 1, killed: false, signal: null, stdout: 'PRIVATE_PATH error CS1002: PRIVATE_TEXT\nwarning CS0168: PRIVATE_TEXT', stderr: '' })
  const result = compilerFailureObservation758(error)
  assert.deepEqual(result, { version: 1, kind: 'COMPILER_FAILURE', code: 1, spawnCode: null, signal: null, killed: false, outputState: 'PRESENT', compilerCodes: ['CS0168', 'CS1002'], compilerMore: false })
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  assert.equal(error.message, 'PRIVATE_PATH')
})

test('#758 compiler failure observation handles cancellation and refuses hostile values', () => {
  const terminated = compilerFailureObservation758({ code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM', stderr: '' })
  assert.deepEqual(terminated, { version: 1, kind: 'COMPILER_FAILURE', code: null, spawnCode: 'ETIMEDOUT', signal: 'SIGTERM', killed: true, outputState: 'EMPTY', compilerCodes: [], compilerMore: false })
  const maxBuffer = compilerFailureObservation758({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
  assert.equal(maxBuffer.kind, 'COMPILER_FAILURE')
  if (maxBuffer.kind === 'COMPILER_FAILURE') assert.equal(maxBuffer.spawnCode, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
  const nativeExit = compilerFailureObservation758({ code: -1073741819 })
  assert.equal(nativeExit.kind, 'COMPILER_FAILURE')
  if (nativeExit.kind === 'COMPILER_FAILURE') assert.equal(nativeExit.code, -1073741819)
  let reads = 0
  const hostile = Object.defineProperty({}, 'stderr', { get() { reads++; throw Error('PRIVATE') } })
  assert.equal(compilerFailureObservation758(hostile).kind, 'COMPILER_FAILURE')
  assert.equal(reads, 0)
  const many = compilerFailureObservation758({ stdout: 'error CS1005 error CS1004 error CS1003 error CS1002 error CS1001', stderr: '' })
  assert.equal(many.kind, 'COMPILER_FAILURE')
  if (many.kind === 'COMPILER_FAILURE') {
    assert.deepEqual(many.compilerCodes, ['CS1001', 'CS1002', 'CS1003', 'CS1004'])
    assert.equal(many.compilerMore, true)
    assert.equal(many.outputState, 'PRESENT')
  }
  const tooLarge = compilerFailureObservation758({ stdout: 'x'.repeat(4097) })
  assert.equal(tooLarge.kind, 'COMPILER_FAILURE')
  if (tooLarge.kind === 'COMPILER_FAILURE') assert.equal(tooLarge.outputState, 'TOO_LARGE')
  const revoked = Proxy.revocable({}, {}); revoked.revoke()
  assert.deepEqual(compilerFailureObservation758(revoked.proxy), { version: 1, kind: 'UNAVAILABLE' })
})

for (const [eol, expected] of [['\n', '9898bc1278d7e5958ce01a06b12e046a2d64ba1ee04aea8370db983a66eb44db'], ['\r\n', '3692bea4f30d71a5c5e84d1c13ec32765ddb0de3c705e25c145e4562c99030c5']] as const) {
  test(`#758 compiler observation preserves the original native source ${eol === '\n' ? 'LF' : 'CRLF'}`, () => {
    let value = fs.readFileSync(path.resolve('tests/activity-platform-native-758.test.ts'), 'utf8').replace(/\r?\n/g, eol)
    const changes: [string, string][] = [
      ["import { compilerFailureObservation758 } from './helpers/activity-compiler-observation-758'\n", ''],
      ["try{t.diagnostic('ACTIVITY758_COMPILER_FAILURE '+JSON.stringify(compilerFailureObservation758(error)))}catch{}", ''],
    ]
    for (const [after, before] of changes) {
      const from = after.replace(/\n/g, eol)
      assert.equal(value.split(from).length, 2)
      value = value.replace(from, before.replace(/\n/g, eol))
    }
    assert.equal(createHash('sha256').update(value).digest('hex'), expected)
  })
}
