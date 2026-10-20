import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
const repo = path.basename(path.dirname(__dirname)) === '.test-dist' ? path.resolve(__dirname, '../../..') : path.resolve(__dirname, '../..')
const makeEnv = require(path.join(repo, 'scripts/tests/cockpit-bridge-child-env.cjs'))
const inputs = { root: 'C:\\owned\\cmspark-test-run-example', data: 'C:\\owned\\cmspark-test-run-example\\data', temp: 'C:\\owned\\cmspark-test-run-example\\temp', compiled: 'C:\\public\\companion\\dist' }
const parent = { SystemRoot: 'C:\\Windows', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', HOME: 'INERT_HOME', USERPROFILE: 'INERT_HOME', NODE_OPTIONS: '--require=INERT', DEEPSEEK_API_KEY: 'INERT_PROVIDER_SENTINEL', HTTPS_PROXY: 'INERT_PROXY', RUNNER_TRACKING_ID: 'INERT_EXISTING_JOB_TRACKING' }
test('723 remote child environment uses an exact allowlist and only existing runner tracking', () => {
  const env = makeEnv(parent, inputs)
  assert.deepEqual(Object.keys(env).sort(), ['SystemRoot','WINDIR','ComSpec','PATH','TEMP','TMP','GITHUB_ACTIONS','RUNNER_OS','CMSPARK_TEST_RUN_DIR','CMSPARK_DATA_DIR','CMSPARK_723_COMPILED_ROOT','RUNNER_TRACKING_ID'].sort())
  for (const key of ['HOME','USERPROFILE','NODE_OPTIONS','DEEPSEEK_API_KEY','HTTPS_PROXY']) assert.equal(env[key], undefined)
  assert.equal(env.RUNNER_TRACKING_ID, parent.RUNNER_TRACKING_ID)
  assert.equal(env.PATH, 'C:\\Windows\\System32')
  assert.equal(makeEnv({ ...parent, RUNNER_TRACKING_ID: undefined }, inputs).RUNNER_TRACKING_ID, undefined)
  for (const bad of [{ ...inputs, temp: 'C:\\outside' }, { ...inputs, data: inputs.root }, { ...inputs, root: 'relative' }, { ...inputs, compiled: 'relative' }]) assert.throws(() => makeEnv(parent, bad))
})
test('723 actual remote controller passes the closed environment at every child launch', () => {
  const source = fs.readFileSync(path.join(repo, 'scripts/tests/cockpit-bridge-real-first.cjs'), 'utf8')
  const sf = ts.createSourceFile('controller.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const launches: ts.CallExpression[] = []
  function walk(n: ts.Node) { if (ts.isCallExpression(n) && ['cp.spawn','cp.fork'].includes(n.expression.getText(sf))) launches.push(n); ts.forEachChild(n, walk) }
  walk(sf); assert.equal(launches.length, 4)
  for (const launch of launches) {
    const options = launch.arguments[2]; assert.ok(options && ts.isObjectLiteralExpression(options))
    const env = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'env') as ts.PropertyAssignment | undefined
    assert.ok(env, 'every actual launch declares its own bounded environment')
    const evaluated = vm.runInNewContext('(' + env.initializer.getText(sf) + ')', { process: { env: parent }, compiled: inputs.compiled, childEnvironment: makeEnv(parent, inputs) })
    assert.equal(evaluated.DEEPSEEK_API_KEY, undefined, 'provider variables must not enter child options')
    assert.equal(evaluated.NODE_OPTIONS, undefined)
    assert.deepEqual(Object.keys(evaluated).sort(), Object.keys(makeEnv(parent, inputs)).sort())
    if (launch.expression.getText(sf) === 'cp.fork') {
      const args = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'execArgv') as ts.PropertyAssignment | undefined
      assert.ok(args && ts.isArrayLiteralExpression(args.initializer) && args.initializer.elements.length === 0, 'server cannot inherit a parent test loader or Node hooks')
    }
  }
})
test('723 actual server fork options do not copy a provider key or parent Node hooks', () => {
  const source = fs.readFileSync(path.join(repo, 'scripts/tests/cockpit-bridge-real-first.cjs'), 'utf8')
  const sf = ts.createSourceFile('controller.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const forks: ts.CallExpression[] = []
  function walk(n: ts.Node) { if (ts.isCallExpression(n) && n.expression.getText(sf) === 'cp.fork') forks.push(n); ts.forEachChild(n, walk) }
  walk(sf); assert.equal(forks.length, 1)
  const options = forks[0].arguments[2]; assert.ok(options && ts.isObjectLiteralExpression(options))
  const env = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'env') as ts.PropertyAssignment | undefined
  assert.ok(env)
  const evaluated = vm.runInNewContext('(' + env.initializer.getText(sf) + ')', { process: { env: parent }, compiled: inputs.compiled, childEnvironment: makeEnv(parent, inputs) })
  assert.equal(evaluated.DEEPSEEK_API_KEY, undefined)
  assert.equal(evaluated.NODE_OPTIONS, undefined)
})
