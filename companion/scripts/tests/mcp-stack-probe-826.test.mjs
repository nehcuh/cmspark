import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import yaml from 'js-yaml'
import { deriveMcpStackProbe826, withTemporaryStackProbe826, classifyMcpStackOutcome826, runMcpStackProbe826 } from '../mcp-stack-probe-826.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = fs.readFileSync(path.join(root, 'tests/desktop-native-mcp-476.test.ts'), 'utf8')
const raw = ts.readConfigFile(path.join(root, 'tsconfig.test.json'), ts.sys.readFile)
const config = ts.parseJsonConfigFileContent(raw.config, ts.sys, root)
assert.equal(raw.error, undefined); assert.equal(config.errors.length, 0)
const compiled = ts.transpileModule(source, { fileName: 'tests/desktop-native-mcp-476.test.ts', compilerOptions: config.options }).outputText
const sha = text => createHash('sha256').update(text).digest('hex')

test('post-timeout probe derives the actual emitter output with only two insertions and original20 intact', () => {
  for (const eol of ['\n', '\r\n']) {
    const actual = compiled.replace(/\r\n/g, '\n').replace(/\n/g, eol)
    const derived = deriveMcpStackProbe826(source.replace(/\r\n/g, '\n').replace(/\n/g, eol), actual)
    const parsed = ts.createSourceFile('derived.js', derived, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    assert.equal(parsed.parseDiagnostics.length, 0)
    assert.equal((derived.match(/timeout: 20000/g) || []).length, 1)
    assert.equal((derived.match(/snapshotDeadline825 = Date\.now\(\) \+ 20000/g) || []).length, 1)
    assert.match(derived, /const originalSignal826 = t\.signal;/)
    assert.match(derived, /originalSignal826\.aborted && Date\.now\(\) >= snapshotDeadline825 && child && !settled && snapshot825\?\.binary/)
    const inserted = /            try \{\r?\n                if \(originalSignal826\.aborted[\s\S]*?\/\* This experiment cannot replace the original failure or cleanup\. \*\/ \}\r?\n/g
    assert.equal([...derived.matchAll(inserted)].length, 1)
    const restored = derived.replace(inserted, '').replace(eol + '    const originalSignal826 = t.signal;', '')
    assert.equal(restored, actual)
    assert.ok(derived.indexOf('collectMcpStacks826') < derived.indexOf('manager.rejectAll("disconnect")'))
    assert.ok(derived.indexOf('manager.rejectAll("disconnect")') < derived.indexOf('child?.terminate()'))
  }
})

test('actual source or emitted business/registration/cleanup drift cannot enter this experiment', () => {
  assert.throws(() => deriveMcpStackProbe826(source + '\n', compiled), /SOURCE_DRIFT/)
  for (const changed of [compiled + '\n', compiled.replace('timeout: 20000', 'timeout: 60000'), compiled.replace('child?.terminate();', ''), compiled.replace('strict_1.default.equal(auth, true)', 'strict_1.default.equal(auth, false)')]) {
    assert.notEqual(changed, compiled)
    assert.throws(() => deriveMcpStackProbe826(source, changed), /SOURCE_DRIFT/)
  }
})

test('exclusive discoverable sibling preserves real source layout and is removed after returned/throwing execution only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stack-loader-826-'))
  const canonical = path.join(dir, 'desktop-native-mcp-476.test.js')
  const derived = deriveMcpStackProbe826(source, compiled)
  fs.writeFileSync(canonical, compiled)
  try {
    for (const throwing of [false, true]) {
      let file
      const run = () => withTemporaryStackProbe826(canonical, derived, input => {
        file = input
        assert.equal(path.dirname(input), path.dirname(canonical))
        assert.match(input, /\.test\.js$/)
        assert.equal(fs.readFileSync(input, 'utf8'), derived)
        if (throwing) throw Error('OWNED_EXECUTOR_FAILURE')
        return 37
      })
      if (throwing) assert.throws(run, /OWNED_EXECUTOR_FAILURE/)
      else assert.equal(run(), 37)
      assert.equal(fs.existsSync(file), false)
      assert.equal(fs.readFileSync(canonical, 'utf8'), compiled)
    }
    const collision = path.join(dir, 'desktop-native-mcp-stack-826.test.js')
    fs.writeFileSync(collision, 'OWNED_PREEXISTING')
    assert.throws(() => withTemporaryStackProbe826(canonical, derived, () => assert.fail()), { code: 'EEXIST' })
    assert.equal(fs.readFileSync(collision, 'utf8'), 'OWNED_PREEXISTING')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('outcome classifier consumes real Node22 TAP; original20000 timeout remains a failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stack-tap-826-'))
  try {
    const programs = {
      PASS: "const test=require('node:test');test('owned pass',()=>{});",
      FAIL: "const test=require('node:test');test('owned assertion',()=>{throw Error('OWNED_FAILURE')});",
      TIMEOUT: "const test=require('node:test');test('owned original20 timeout',{timeout:20000},async t=>{const keep=setInterval(()=>{},1000);try{await new Promise((_,reject)=>t.signal.addEventListener('abort',()=>reject(Error('OWNED_ABORT')),{once:true}))}finally{clearInterval(keep)}});",
    }
    for (const [expected, body] of Object.entries(programs)) {
      const file = path.join(dir, expected + '.test.cjs'); fs.writeFileSync(file, body)
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
      const result = spawnSync(process.execPath, ['--test', file], { env, encoding: 'utf8', timeout: 30000 })
      assert.equal(result.error, undefined)
      assert.equal(classifyMcpStackOutcome826(result), expected)
      assert.equal(result.status, expected === 'PASS' ? 0 : 1)
      if (expected === 'TIMEOUT') assert.match(result.stdout, /failureType: 'testTimeoutFailure'/)
      assert.equal(classifyMcpStackOutcome826({ ...result, signal: 'SIGTERM' }), 'INCOMPLETE')
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('diagnostic workflow is read-only and restricted to the probe branch', () => {
  const doc = yaml.load(fs.readFileSync(path.join(root, '../.github/workflows/diagnose-mcp-869.yml'), 'utf8'))
  assert.deepEqual(doc.on, {push: {branches: ['codex/mcp-869-stack-probe']}})
  assert.deepEqual(doc.permissions, {contents: 'read'})
  assert.deepEqual(Object.keys(doc.jobs), ['collect'])
  const job = doc.jobs.collect
  assert.equal(job['runs-on'], 'windows-latest')
  assert.deepEqual(job.steps[0].with, {'persist-credentials': false})
  const upload = job.steps.find(step => step.uses === 'actions/upload-artifact@v4')
  assert.equal(upload.if, 'always()')
  assert.deepEqual(upload.with.path.trim().split(/\r?\n/).map(line => path.posix.basename(line)),
    ['qualification.json','run.json','capture.json'])
})
test('probe execution refuses without the explicit opt-in before touching files or tools', async () => {
  const before = process.env.CMSPARK_MCP_STACK_PROBE_826
  delete process.env.CMSPARK_MCP_STACK_PROBE_826
  try { await assert.rejects(runMcpStackProbe826, /EXPLICIT_WINDOWS_CI_REQUIRED/) }
  finally { if (before === undefined) delete process.env.CMSPARK_MCP_STACK_PROBE_826; else process.env.CMSPARK_MCP_STACK_PROBE_826 = before }
})
