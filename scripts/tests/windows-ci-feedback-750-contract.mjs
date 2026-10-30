// #750 finite parsed-workflow conservation; never runs a workflow command.
import assert from 'node:assert/strict'
import { collapseNativeStages760 } from './native-ci-stages-760-contract.mjs'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const yaml = createRequire(new URL('../../companion/package.json', import.meta.url))('js-yaml')
const baseline = JSON.parse(fs.readFileSync(new URL('./windows-ci-feedback-750-baseline.json', import.meta.url), 'utf8'))
const cockpit = JSON.parse(fs.readFileSync(new URL('./windows-ci-feedback-748-supplement.json', import.meta.url), 'utf8'))
assert.deepEqual(Object.keys(cockpit).sort(), ['sourceCommit', 'sourceWorkflowSha256', 'steps'])
assert.equal(cockpit.sourceCommit, '6521db567a06c01711b6527e96cdfcde65094342')
assert.equal(cockpit.sourceWorkflowSha256, '5cc02dfea08c5357a90c437f5ee6bbf5bdec4df054dd137c14fa9f061c280c2a')
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
// Recorded from the actual #758 YAML producer, not a hand-built shadow job.
const activity758 = JSON.parse(fs.readFileSync(new URL('./activity-platform-758-workflow.json', import.meta.url), 'utf8'))
assert.equal(digest(activity758), '401ffbb6db6f576120cf2765deabfbba02795ab6f1d75f2367433277ec8fc56f')
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
const key = step => step.name ?? step.uses
export const MATRIX750 = Object.freeze([
  { os: 'ubuntu-latest', lane: 'smoke', name: 'smoke (ubuntu-latest)' },
  { os: 'macos-latest', lane: 'smoke', name: 'smoke (macos-latest)' },
  { os: 'windows-latest', lane: 'census', name: 'smoke (windows-latest)' },
  { os: 'windows-latest', lane: 'native', name: 'smoke (windows-native)' },
])
const FRONT = 'Install native-lane frontend dependencies (#750)'
const STAGE = 'Stage native-lane Windows scripts (#750)'
const INSTALL = 'Install + build companion'
const NSIS = 'Pinned NSIS dependency transport and integrity (#633)'
const CENSUS_ONLY = new Set(['Read-only fixed-release gallery certificate sampling (#70)', 'Publish only gallery certificate metadata (#70)', 'Complete Windows Companion census (#650)', 'Windows census finite public receipts (#650)', 'Post-census isolated module-scope diagnostic (#650)'])
const directedAt = baseline.steps.findIndex(step => step.key === 'Office compatibility and relocated runtime (#611)')
assert.ok(directedAt > 0)
const DIRECTED = new Set(baseline.steps.slice(directedAt).map(step => step.key).filter(name => !CENSUS_ONLY.has(name)))
const COCKPIT_NAMES = ['Windows cockpit Node scalar selection (#723)', 'Windows cockpit native bridge first identity STOP gate (#723)', 'Publish finite cockpit first failure (#723)']
assert.deepEqual(cockpit.steps.map(key), COCKPIT_NAMES)

// Deliberately small expression grammar. Unknown identifiers/functions/tokens
// refuse; no eval/Function or access to arbitrary workflow data.
export function condition750(source, context) {
  if (source === undefined) return context.success
  assert.equal(typeof source, 'string')
  const text = source.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1').trim()
  const tokens = []; let at = 0
  const pattern = /\s*(\&\&|\|\||==|!=|!|\(|\)|'[^'\r\n]*'|[A-Za-z_][A-Za-z0-9_.-]*)/y
  while (at < text.length) {
    pattern.lastIndex = at; const match = pattern.exec(text)
    assert.ok(match, 'unknown workflow condition token')
    tokens.push(match[1]); at = pattern.lastIndex
  }
  let index = 0
  const atom = () => {
    const token = tokens[index++]
    if (token === '!') return !atom()
    if (token === '(') { const value = or(); assert.equal(tokens[index++], ')'); return value }
    if (token?.startsWith("'")) return token.slice(1, -1)
    if (['always', 'success', 'failure', 'cancelled'].includes(token)) {
      assert.equal(tokens[index++], '('); assert.equal(tokens[index++], ')')
      return token === 'always' ? true : token === 'failure' ? !context.success && !context.cancelled : context[token]
    }
    if (token === 'true' || token === 'false') return token === 'true'
    assert.ok(Object.hasOwn(context.values, token), 'unknown workflow condition identifier')
    return context.values[token]
  }
  const equal = () => { let value = atom(); if (tokens[index] === '==' || tokens[index] === '!=') { const op = tokens[index++], right = atom(); value = op === '==' ? value === right : value !== right } return value }
  const and = () => { let value = equal(); while (tokens[index] === '&&') { index++; const right = equal(); value = Boolean(value && right) } return value }
  const or = () => { let value = and(); while (tokens[index] === '||') { index++; const right = and(); value = Boolean(value || right) } return value }
  const value = or(); assert.equal(index, tokens.length, 'trailing workflow condition tokens')
  // Actions adds success() unless an explicit status-check function is present.
  return Boolean(value && (/\b(?:always|success|failure|cancelled)\s*\(/.test(text) || context.success))
}

// Keep the source-derived scalar preflight. The human-approved CI policy
// removes only the experimental first-identity execution and its own upload;
// the archived supplement remains unchanged as evidence of the old schedule.
export function validateCockpitSteps748(steps) {
  const additions = steps.filter(step => key(step) === activity758.nativeStep.name)
  assert.equal(additions.length, 1, 'one exact #758 native addition')
  assert.deepEqual(additions[0], activity758.nativeStep, '#758 native command, lane, environment and failure semantics are exact')
  const compiled = steps.findIndex(step => step.name === 'Compile shared companion test inputs (#650)')
  assert.equal(steps.indexOf(additions[0]), compiled + 1, '#758 native consumes the just-compiled inputs')
  // Remove only this fully checked addition; all original pins remain intact.
  steps = steps.filter(step => step !== additions[0])
  const scalarName = COCKPIT_NAMES[0]
  const selected = steps.filter(step => key(step) === scalarName)
  assert.equal(selected.length, 1, 'one exact cockpit scalar step')
  for (const step of steps) {
    assert.equal(COCKPIT_NAMES.slice(1).includes(key(step)), false, 'retired first-identity pair is not automatic CI')
    assert.equal(/run-cockpit-bridge-first\.ps1|cockpit-first-identity/.test(JSON.stringify(step)), false, 'no renamed gate or dangling first-identity output')
  }
  const expected = structuredClone(cockpit.steps[0])
  const oldTests = 'node --test scripts/tests/cockpit-bridge-build-prerequisite.test.cjs scripts/tests/cockpit-bridge-first-evidence.test.mjs\n'
  assert.equal(expected.run.split(oldTests).length, 2)
  expected.run = expected.run.replace(oldTests, oldTests.trimEnd() + ' scripts/tests/cockpit-bridge-cdp-lifecycle.test.mjs scripts/tests/cockpit-bridge-prepared-build.test.mjs\n')
  assert.deepEqual(selected[0], expected, 'scalar command/body/failure attributes remain exact')
  const compile = steps.findIndex(step => step.name === 'Compile shared companion test inputs (#650)')
  const lastDirected = steps.findIndex(step => step.name === 'Windows native 8.3 filesystem paths (#604)')
  const probe = steps.find(step => step.name === 'Post-census isolated module-scope diagnostic (#650)')
  assert.ok(compile >= 0 && lastDirected > compile && probe)
  assert.equal(steps.indexOf(selected[0]), compile + 1)
  assert.equal(steps.indexOf(probe), lastDirected + 1)
  assert.equal(steps.at(-1), probe, 'the census diagnostic remains the final matrix step')
  assert.equal(probe.if, "${{ always() && !cancelled() && matrix.os == 'windows-latest' && matrix.lane == 'census' }}")
  for (const matrix of MATRIX750) for (const status of ['success', 'failure', 'cancelled']) {
    const context = { success: status === 'success', cancelled: status === 'cancelled', values: { 'matrix.os': matrix.os, 'matrix.lane': matrix.lane } }
    assert.equal(condition750(selected[0].if, context), matrix.os === 'windows-latest' && context.success)
  }
  return steps.filter(step => step !== selected[0])
}

// #796: record the actual reviewed YAML addition, then remove only this
// fully checked object for the unchanged historical whole-build comparison.
function conservedBuildSteps794(steps) {
  const expected = {
  "name": "Clean staged filesystem MCP closure (#796)",
  "timeout-minutes": 3,
  "run": ": \"${RUNNER_TEMP:?}\"\nNODE_BIN=\"$(command -v node)\"\n/usr/bin/env -i PATH=\"$(dirname \"${NODE_BIN}\"):/usr/bin:/bin\" HOME=\"${RUNNER_TEMP}\" TMPDIR=\"${RUNNER_TEMP}\" \\\n  LANG=C.UTF-8 LC_ALL=C.UTF-8 GITHUB_ACTIONS=\"${GITHUB_ACTIONS}\" RUNNER_OS=\"${RUNNER_OS}\" \\\n  CMSPARK_STAGED_FILESYSTEM_CI=1 \"${NODE_BIN}\" --max-old-space-size=3072 \\\n  --test --experimental-test-isolation=none scripts/tests/filesystem-staged-handshake-794.test.mjs\n"
}

  const selected = steps.filter(step => step.name === expected.name)
  assert.equal(selected.length, 1, 'one exact clean staged filesystem gate')
  assert.deepEqual(selected[0], expected, 'clean staged filesystem command and failure semantics are exact')
  const at = steps.indexOf(selected[0])
  assert.equal(steps[at - 1]?.name, 'Build companion', 'clean stage consumes the normal build')
  assert.equal(steps[at + 1]?.name, 'Run companion tests', 'clean stage precedes the original tests')
  assert.ok(steps.findIndex(step => step.name === 'Install dependencies') < at - 1, 'locked dependencies precede the normal build')
  return steps.filter(step => step !== selected[0])
}

// #806: admit only the exact cache control and keep all historic build gates.
function conservedBuildSteps806(steps) {
  const expected = { name: 'Settings cache commit boundary (#806)', run: 'node --test scripts/tests/config-cache-806.test.cjs' }
  const selected = steps.filter(step => step.name === expected.name)
  assert.equal(selected.length, 1, 'one exact settings cache gate')
  assert.deepEqual(selected[0], expected, 'settings cache command and failure semantics are exact')
  const at = steps.indexOf(selected[0])
  assert.equal(steps[at - 1]?.name, 'Package fail-closed gates (P0-D nits)')
  assert.equal(steps[at + 1]?.name, 'Build companion')
  return steps.filter(step => step !== selected[0])
}

function cache750(step, nodeVersion) {
  assert.equal(step.uses, 'actions/setup-node@v4')
  assert.deepEqual(omit(step.with, ['cache-dependency-path']), { 'node-version': nodeVersion, cache: 'npm' })
  assert.equal(typeof step.with['cache-dependency-path'], 'string')
  assert.deepEqual(step.with['cache-dependency-path'].trim().split(/\r?\n/).map(s => s.trim()).sort(), ['chrome-extension/package-lock.json', 'companion/package-lock.json'])
}

export function validateWindowsCiFeedback750(text) {
  const doc = yaml.load(text)
  doc.jobs['smoke-os'].steps = collapseNativeStages760(doc.jobs['smoke-os'].steps)
  assert.equal(digest(omit(doc, ['jobs'])), baseline.workflowWithoutJobs)
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['acp-history-restart', 'activity-linux-x11', 'build', 'smoke-os'])
  assert.deepEqual(doc.jobs['activity-linux-x11'], activity758.linuxJob, '#758 owned X11 job is exact, including dependencies and failure semantics')
  // #759 accepts only the exact reviewed security-pin delta; the historical
  // digest still guards every other history job field and command.
  const history = structuredClone(doc.jobs['acp-history-restart'])
  const historySetup = history.steps.filter(step => step.uses?.startsWith('actions/setup-node@'))
  assert.equal(historySetup.length, 1)
  assert.equal(historySetup[0].with['node-version'], '22.23.4')
  historySetup[0].with['node-version'] = '22'
  assert.equal(digest(history), baseline.history)
  const job = doc.jobs['smoke-os'], steps = job.steps
  assert.equal(digest(omit(job, ['name', 'runs-on', 'strategy', 'steps'])), baseline.smokeOther)
  assert.equal(job.name, '${{ matrix.name }}'); assert.equal(job['runs-on'], '${{ matrix.os }}')
  assert.deepEqual(job.strategy, { 'fail-fast': false, matrix: { include: MATRIX750 } })
  const runtimeHeaders = steps.filter(step => key(step) === 'Pinned runtime header controls (macOS)')
  assert.equal(runtimeHeaders.length, 1)
  assert.deepEqual(runtimeHeaders[0], { name: 'Pinned runtime header controls (macOS)', if: "matrix.os == 'macos-latest'", run: 'node --test companion/scripts/tests/desktop-runtime-headers-480.test.mjs' })
  assert.equal(steps.indexOf(runtimeHeaders[0]), steps.findIndex(step => key(step) === 'Desktop build helper controls (#480)') + 1)
  for (const matrix of MATRIX750) for (const success of [true, false]) {
    assert.equal(condition750(runtimeHeaders[0].if, { success, cancelled: false, values: { 'matrix.os': matrix.os, 'matrix.lane': matrix.lane } }), success && matrix.os === 'macos-latest')
  }
  const keys = validateCockpitSteps748(steps).filter(step => step !== runtimeHeaders[0]).map(key)
  assert.deepEqual(keys.filter(name => name !== NSIS && name !== FRONT && name !== STAGE), baseline.steps.map(s => s.key).filter(name => name !== NSIS), 'all old steps retain order/cardinality')
  assert.equal(keys.filter(name => name === NSIS).length, 1)
  assert.equal(keys.filter(name => name === FRONT).length, 1)
  assert.equal(keys.filter(name => name === STAGE).length, 1)
  assert.equal(keys.indexOf(STAGE), keys.indexOf(NSIS) + 1)
  assert.deepEqual(steps.find(step => key(step) === STAGE), { name: STAGE, if: "matrix.os == 'windows-latest' && matrix.lane == 'native'", shell: 'bash', run: 'cd companion\nnpm run stage:win-scripts\n' })
  assert.equal(keys.indexOf(NSIS), keys.indexOf(INSTALL) + 1)
  assert.equal(keys.indexOf(FRONT), keys.indexOf(INSTALL) - 1)
  const front = steps.find(step => key(step) === FRONT)
  assert.deepEqual(front, { name: FRONT, if: "matrix.os == 'windows-latest' && matrix.lane == 'native'", env: { ONNXRUNTIME_NODE_INSTALL: 'skip' }, run: 'cd chrome-extension\nnpm ci\n' })
  cache750(steps.find(step => step.name === 'Setup Node.js'), '22.23.4')
  const states = [
    { success: true, cancelled: false, compile: 'success', registry: 'true', public: 'owned-public' },
    { success: false, cancelled: false, compile: 'success', registry: 'true', public: 'owned-public' },
    { success: false, cancelled: true, compile: 'success', registry: 'true', public: 'owned-public' },
    { success: true, cancelled: false, compile: 'failure', registry: 'true', public: 'owned-public' },
    { success: true, cancelled: false, compile: 'success', registry: 'false', public: 'owned-public' },
    { success: false, cancelled: false, compile: 'failure', registry: 'false', public: '' },
  ]
  for (const old of baseline.steps) {
    const step = steps.find(s => key(s) === old.key)
    let conserved = omit(step, ['if'])
    if (old.key === 'Setup Node.js') conserved = { ...conserved, with: { ...omit(conserved.with, ['cache-dependency-path']), 'node-version': '22.23.2' } }
    if (old.key === NSIS) {
      assert.equal(step.run, 'node --test scripts/tests/nsis-ci-setup.test.mjs scripts/tests/windows-ci-feedback-750.test.mjs scripts/tests/node-security-runtime-759.test.mjs scripts/tests/native-ci-stages-760.test.mjs')
      conserved = { ...conserved, run: 'node --test scripts/tests/nsis-ci-setup.test.mjs' }
    }
    assert.equal(digest(conserved), old.objectWithoutIf, 'original command/body/env/failure/artifact changed: ' + old.key)
    for (const matrix of MATRIX750) for (const state of states) {
      const context = { ...state, values: { 'matrix.os': matrix.os, 'matrix.lane': matrix.lane, 'steps.windows-census-compile.outcome': state.compile, 'steps.windows-registry-prerequisites.outputs.ready': state.registry, 'steps.windows-census.outputs.public_dir': state.public, 'steps.cockpit-first-identity.outcome': 'success', 'steps.cockpit-first-identity.outputs.finite_summary': '' } }
      const original = condition750(old.if, context)
      const allowed = CENSUS_ONLY.has(old.key) ? matrix.lane === 'census' : DIRECTED.has(old.key) ? matrix.lane !== 'census' : true
      assert.equal(condition750(step.if, context), Boolean(original && allowed), 'wrong lane/failure/cancellation semantics: ' + old.key + '/' + matrix.name)
    }
  }
  const build = doc.jobs.build
  assert.equal(digest(omit(build, ['steps'])), baseline.buildOther)
  const trayControl = 'Swift tray packaging CPU controls'
  const traySteps = build.steps.filter(s => key(s) === trayControl)
  assert.equal(traySteps.length, 1, 'exactly one tray CPU control')
  assert.deepEqual(traySteps[0], { name: trayControl, run: 'node --test companion/scripts/tests/swift-tray-package-pin.test.mjs companion/scripts/tests/swift-tray-bundle-entry.test.mjs companion/scripts/tests/swift-tray-source-freshness.test.mjs companion/scripts/tests/swift-tray-build-output.test.mjs companion/scripts/tests/swift-tray-package-copy.test.mjs\n' })
  assert.equal(build.steps.indexOf(traySteps[0]), build.steps.findIndex(s => key(s) === 'Run companion tests') + 1)
  const buildSteps = conservedBuildSteps794(conservedBuildSteps806(build.steps.filter(s => key(s) !== trayControl)))
  assert.deepEqual(buildSteps.map(key), baseline.buildSteps.filter(s => s.key !== 'Setup chrome-extension Node.js').map(s => s.key))
  cache750(build.steps.find(s => s.name === 'Setup Node.js'), '22.23.4')
  for (const old of baseline.buildSteps.filter(s => s.key !== 'Setup chrome-extension Node.js')) {
    let step = buildSteps.find(s => key(s) === old.key)
    if (old.key === activity758.buildStep.name) {
      const join788 = 'node --test scripts/tests/native-join-observation-788.test.cjs\n'
      assert.deepEqual(step, { ...activity758.buildStep, run: activity758.buildStep.run + join788 }, '#788 CPU join controls retain exact package failure semantics')
      assert.equal(step.run.split(join788).length, 2)
      step = { ...step, run: step.run.replace(join788, '') }
      assert.deepEqual(step, activity758.buildStep, '#758 bundle resource control is exact')
      const command = 'node --test scripts/tests/activity-notifier-package.test.cjs\n'
      assert.equal(step.run.split(command).length, 2)
      step = { ...step, run: step.run.replace(command, '') }
    }
    if (old.key === 'Setup Node.js') step = { ...step, with: { ...omit(step.with, ['cache-dependency-path']), 'node-version': '22' } }
    assert.equal(digest(step), old.object, 'unrelated build command/permission changed: ' + old.key)
  }
  return doc
}

export const parseWorkflow750 = text => yaml.load(text)
export const printWorkflow750 = doc => yaml.dump(doc, { lineWidth: -1, noRefs: true })
