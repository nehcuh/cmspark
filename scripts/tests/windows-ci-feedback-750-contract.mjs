// #750 finite parsed-workflow conservation; never runs a workflow command.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const yaml = createRequire(new URL('../../companion/package.json', import.meta.url))('js-yaml')
const baseline = JSON.parse(fs.readFileSync(new URL('./windows-ci-feedback-750-baseline.json', import.meta.url), 'utf8'))
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
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

function cache750(step, nodeVersion) {
  assert.equal(step.uses, 'actions/setup-node@v4')
  assert.deepEqual(omit(step.with, ['cache-dependency-path']), { 'node-version': nodeVersion, cache: 'npm' })
  assert.equal(typeof step.with['cache-dependency-path'], 'string')
  assert.deepEqual(step.with['cache-dependency-path'].trim().split(/\r?\n/).map(s => s.trim()).sort(), ['chrome-extension/package-lock.json', 'companion/package-lock.json'])
}

export function validateWindowsCiFeedback750(text) {
  const doc = yaml.load(text)
  assert.equal(digest(omit(doc, ['jobs'])), baseline.workflowWithoutJobs)
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['acp-history-restart', 'build', 'smoke-os'])
  assert.equal(digest(doc.jobs['acp-history-restart']), baseline.history)
  const job = doc.jobs['smoke-os'], steps = job.steps
  assert.equal(digest(omit(job, ['name', 'runs-on', 'strategy', 'steps'])), baseline.smokeOther)
  assert.equal(job.name, '${{ matrix.name }}'); assert.equal(job['runs-on'], '${{ matrix.os }}')
  assert.deepEqual(job.strategy, { 'fail-fast': false, matrix: { include: MATRIX750 } })
  const keys = steps.map(key)
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
  cache750(steps.find(step => step.name === 'Setup Node.js'), '22.23.2')
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
    if (old.key === 'Setup Node.js') conserved = { ...conserved, with: omit(conserved.with, ['cache-dependency-path']) }
    if (old.key === NSIS) {
      assert.equal(step.run, 'node --test scripts/tests/nsis-ci-setup.test.mjs scripts/tests/windows-ci-feedback-750.test.mjs')
      conserved = { ...conserved, run: 'node --test scripts/tests/nsis-ci-setup.test.mjs' }
    }
    assert.equal(digest(conserved), old.objectWithoutIf, 'original command/body/env/failure/artifact changed: ' + old.key)
    for (const matrix of MATRIX750) for (const state of states) {
      const context = { ...state, values: { 'matrix.os': matrix.os, 'matrix.lane': matrix.lane, 'steps.windows-census-compile.outcome': state.compile, 'steps.windows-registry-prerequisites.outputs.ready': state.registry, 'steps.windows-census.outputs.public_dir': state.public } }
      const original = condition750(old.if, context)
      const allowed = CENSUS_ONLY.has(old.key) ? matrix.lane === 'census' : DIRECTED.has(old.key) ? matrix.lane !== 'census' : true
      assert.equal(condition750(step.if, context), Boolean(original && allowed), 'wrong lane/failure/cancellation semantics: ' + old.key + '/' + matrix.name)
    }
  }
  const build = doc.jobs.build
  assert.equal(digest(omit(build, ['steps'])), baseline.buildOther)
  assert.deepEqual(build.steps.map(key), baseline.buildSteps.filter(s => s.key !== 'Setup chrome-extension Node.js').map(s => s.key))
  cache750(build.steps.find(s => s.name === 'Setup Node.js'), '22')
  for (const old of baseline.buildSteps.filter(s => s.key !== 'Setup chrome-extension Node.js')) {
    let step = build.steps.find(s => key(s) === old.key)
    if (old.key === 'Setup Node.js') step = { ...step, with: omit(step.with, ['cache-dependency-path']) }
    assert.equal(digest(step), old.object, 'unrelated build command/permission changed: ' + old.key)
  }
  return doc
}

export const parseWorkflow750 = text => yaml.load(text)
export const printWorkflow750 = doc => yaml.dump(doc, { lineWidth: -1, noRefs: true })
