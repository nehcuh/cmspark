import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { deriveMcpLatencyProbe826, withTemporaryProbe826, runMcpLatencyProbe826 } from '../mcp-latency-probe-826.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = fs.readFileSync(path.join(root, 'tests/desktop-native-mcp-476.test.ts'), 'utf8')
const canonical = path.join(root, '.test-dist/tests/desktop-native-mcp-476.test.js')
const compiled = fs.readFileSync(canonical, 'utf8')

test('actual compiled MCP differs only in its registration timeout; canonical source and snapshot remain unchanged', () => {
  const derived = deriveMcpLatencyProbe826(source, compiled)
  assert.notEqual(derived, compiled)
  assert.equal(derived.replace('timeout: 60000', 'timeout: 20000'), compiled)
  assert.ok(derived.includes('const snapshotDeadline825 = Date.now() + 20000;'))
  assert.equal(deriveMcpLatencyProbe826(source.replace(/\r?\n/g, '\r\n'), compiled), derived)
  for (const [ts, js] of [[source + ' ', compiled], [source, compiled.replace('timeout: 20000', 'timeout: 20001')], [source, compiled + compiled], [source, compiled.replace('snapshotDeadline825 = Date.now() + 20000', 'snapshotDeadline825 = Date.now() + 60000')]]) assert.throws(() => deriveMcpLatencyProbe826(ts, js), /DRIFT/)
  assert.equal(fs.readFileSync(canonical, 'utf8'), compiled)
})

test('exclusive temporary sibling is removed after success, assertion failure and cancellation; pre-existing file survives', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-probe-826-')), original = path.join(dir, 'canonical.js')
  try {
    fs.writeFileSync(original, 'original')
    assert.equal(withTemporaryProbe826(original, 'derived', file => { assert.equal(fs.readFileSync(file, 'utf8'), 'derived'); return 7 }), 7)
    for (const error of [new Error('controlled assertion'), Object.assign(new Error('controlled cancellation'), { name: 'AbortError' })]) assert.throws(() => withTemporaryProbe826(original, 'derived', () => { throw error }), actual => actual === error)
    const target = path.join(dir, 'desktop-native-mcp-latency-826.test.js')
    assert.equal(fs.existsSync(target), false)
    fs.writeFileSync(target, 'pre-existing')
    assert.throws(() => withTemporaryProbe826(original, 'derived', () => assert.fail('must not execute')), /EEXIST/)
    assert.equal(fs.readFileSync(target, 'utf8'), 'pre-existing')
    assert.equal(fs.readFileSync(original, 'utf8'), 'original')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('real official runner discovers the sibling, preserves CJS dirname/imports and isolates actual config writes', () => {
  const dir = fs.mkdtempSync(path.join(root, '.test-dist/tests/mcp-probe-loader-826-')), original = path.join(dir, 'canonical.js')
  try {
    fs.writeFileSync(original, 'original')
    fs.writeFileSync(path.join(dir, 'sibling.cjs'), 'module.exports = 826')
    const payload = `const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('controlled real loader and config isolation',()=>{
  assert.equal(__dirname,${JSON.stringify(dir)});assert.equal(require('./sibling.cjs'),826);
  const config=require('../../src/config');
  assert.equal(config.DATA_DIR,process.env.CMSPARK_DATA_DIR);
  const relative=path.relative(process.env.CMSPARK_TEST_RUN_DIR,config.DATA_DIR);
  assert.ok(relative && relative!=='..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative));
  config.replaceMcpServers({owned_probe_826:{transport:'stdio',command:'inert_probe_826',args:[],enabled:false,trust_level:'manual'}});
  assert.equal(JSON.parse(fs.readFileSync(path.join(config.DATA_DIR,'config.json'),'utf8')).mcp.servers.owned_probe_826.command,'inert_probe_826');
  fs.writeFileSync(path.join(__dirname,'loader-ran.json'),JSON.stringify({isolated:true,sibling:826}));
});`
    withTemporaryProbe826(original, payload, file => {
      // This child is a standalone official-runner invocation, outside our
      // parent's internal Node:test IPC protocol, just like the real probe CLI.
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-tests.mjs'), file], { cwd: root, env, encoding: 'utf8', timeout: 30000 })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /ok 1 - controlled real loader and config isolation/)
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'loader-ran.json'), 'utf8')), { isolated: true, sibling: 826 })
    })
    assert.equal(fs.existsSync(path.join(dir, 'desktop-native-mcp-latency-826.test.js')), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('probe refuses a normal local invocation before reading or launching the case', { skip: process.platform === 'win32' && process.env.GITHUB_ACTIONS === 'true' && process.env.CMSPARK_MCP_LATENCY_PROBE_826 === '1' }, () => {
  assert.throws(() => runMcpLatencyProbe826(), /EXPLICIT_WINDOWS_CI_REQUIRED/)
})

test('actual release YAML preserves normal release paths and never packages or publishes an explicit probe', () => {
  const require = createRequire(import.meta.url), yaml = require('js-yaml')
  const actual = yaml.load(fs.readFileSync(path.join(root, '../.github/workflows/release.yml'), 'utf8'))
  // Generated from actual parsed jobs at 67c5e209; raw release.yml SHA256:
  // 484078da169a63dfbe5d4fe174568d597dfc48f38d57d05a1e86a67265244480.
  // No historical Git object is needed in Actions' depth-one checkout.
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const baseline = {
    preflight: '40a951cde0fd388eb9ad6a682b8adfe35b44f9459480d4d0d668bc2a5f69c441',
    package: '69e2fd8ad3f2fa4580803602abeba619c092ed17569fe2ac1b407807699f65ae',
    release: '9f8bd997430e9d68fcd4f016a1250cfd72e175398b0e2257d231f52cf78120c6',
  }
  assert.equal(digest(actual.jobs.preflight), baseline.preflight)
  assert.equal(digest(actual.jobs.release), baseline.release)
  const packageJob = { ...actual.jobs.package }; delete packageJob.if
  assert.equal(digest(packageJob), baseline.package)
  for (const name of ['preflight', 'release']) assert.notEqual(digest({ ...actual.jobs[name], needs: 'changed' }), baseline[name])
  assert.notEqual(digest({ ...packageJob, steps: [] }), baseline.package)
  assert.deepEqual(actual.on.workflow_dispatch.inputs.mcp_latency_probe_826, { description: 'One diagnostic 60s MCP measurement; NOT acceptance or a release dry-run', type: 'boolean', required: false, default: false })
  const evaluate = (expression, github, inputs) => Function('github', 'inputs', 'startsWith', 'return (' + expression + ')')(github, inputs, (text, prefix) => text.startsWith(prefix))
  for (const [event_name, ref, value, packages, probe, publishes] of [
    ['push', 'refs/tags/v0.8.0', undefined, true, false, true],
    ['workflow_dispatch', 'refs/heads/test', undefined, true, false, false],
    ['workflow_dispatch', 'refs/heads/test', false, true, false, false],
    ['workflow_dispatch', 'refs/heads/test', true, false, true, false],
    ['workflow_dispatch', 'refs/tags/v0.8.0', false, true, false, true],
    ['workflow_dispatch', 'refs/tags/v0.8.0', true, false, true, false],
  ]) {
    const github = { event_name, ref }, inputs = { mcp_latency_probe_826: value }
    assert.equal(evaluate(actual.jobs.package.if, github, inputs), packages)
    assert.equal(Boolean(evaluate(actual.jobs['mcp-latency-probe-826'].if, github, inputs)), probe)
    assert.equal(packages && evaluate(actual.jobs.release.if, github, inputs), publishes)
  }
  const job = actual.jobs['mcp-latency-probe-826']
  assert.equal(job.needs, 'preflight'); assert.equal(job['runs-on'], 'windows-latest')
  assert.deepEqual(job.permissions, { contents: 'read' }); assert.equal(job.steps[0].with['persist-credentials'], false)
  assert.ok(job.steps.some(step => step.run?.includes('node scripts/build-desktop-native.mjs --test-fixtures')))
  assert.ok(job.steps.some(step => step.run?.includes('./node_modules/.bin/tsc -p tsconfig.test.json')))
  assert.equal(job.steps.at(-1).run, 'node scripts/mcp-latency-probe-826.mjs')
  assert.equal(job.steps.at(-1).env.CMSPARK_MCP_LATENCY_PROBE_826, '1')
})
