import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { validateWindowsCiFeedback750, condition750, parseWorkflow750, printWorkflow750 } from './windows-ci-feedback-750-contract.mjs'

const workflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
for (const [label, source] of [['LF', workflow], ['CRLF', workflow.replaceAll('\n', '\r\n')]]) {
  test('#750 actual parsed workflow conserves every original gate and independent lane: ' + label, () => {
    validateWindowsCiFeedback750(source)
  })
}
test('#750 finite condition grammar retains status and refuses unknown syntax', () => {
  const context = { success: false, cancelled: false, values: { 'matrix.lane': 'census' } }
  assert.equal(condition750("matrix.lane == 'census'", context), false)
  assert.equal(condition750("always() && !cancelled() && matrix.lane == 'census'", context), true)
  assert.equal(condition750("always() && !cancelled()", { ...context, cancelled: true }), false)
  assert.equal(condition750(undefined, { ...context, success: true }), true)
  assert.throws(() => condition750('unknown()', context))
  assert.throws(() => condition750('true; process.exit()', context))
})

const find = (doc, name) => doc.jobs['smoke-os'].steps.find(step => step.name === name)
const census = 'Complete Windows Companion census (#650)'
const artifact = 'Windows census finite public receipts (#650)'
const office = 'Office compatibility and relocated runtime (#611)'
const native = 'Build native desktop fixtures (#480)'
const nativeCompile = 'Compile native desktop acceptance tests (#480)'
const front = 'Install native-lane frontend dependencies (#750)'
const mutations = [
  ['#759 security contract omitted', d => { find(d, 'Pinned NSIS dependency transport and integrity (#633)').run = find(d, 'Pinned NSIS dependency transport and integrity (#633)').run.replace(' scripts/tests/node-security-runtime-759.test.mjs', '') }],
  ...['build', 'smoke-os', 'acp-history-restart', 'activity-linux-x11'].map(job => ['#759 vulnerable or floating Node in ' + job, d => { d.jobs[job].steps.find(s => s.uses?.startsWith('actions/setup-node@')).with['node-version'] = '22.23.2' }]),
  ['missing activity native addition', d => { d.jobs['smoke-os'].steps = d.jobs['smoke-os'].steps.filter(s => s.name !== 'Actual passive activity capture and local OCR (#758)') }],
  ['activity native runs on census desktop', d => { find(d, 'Actual passive activity capture and local OCR (#758)').if = "matrix.os == 'windows-latest'" }],
  ['activity native failure waived', d => { find(d, 'Actual passive activity capture and local OCR (#758)')['continue-on-error'] = true }],
  ['activity native runs before compilation', d => { const a = d.jobs['smoke-os'].steps; a.unshift(a.splice(a.findIndex(s => s.name === 'Actual passive activity capture and local OCR (#758)'), 1)[0]) }],
  ['activity X11 job removed', d => { delete d.jobs['activity-linux-x11'] }],
  ['activity X11 unknown command', d => { d.jobs['activity-linux-x11'].steps.at(-1).run += 'echo ignored\n' }],
  ['activity X11 failure waived', d => { d.jobs['activity-linux-x11']['continue-on-error'] = true }],
  ['activity bundle regression omitted', d => { const a = d.jobs.build.steps.find(s => s.name === 'Package fail-closed gates (P0-D nits)'); a.run = a.run.replace('node --test scripts/tests/activity-notifier-package.test.cjs\n', '') }],
  ['missing original census', d => { d.jobs['smoke-os'].steps = d.jobs['smoke-os'].steps.filter(s => s.name !== census) }],
  ['duplicate directed native', d => { d.jobs['smoke-os'].steps.push(structuredClone(find(d, native))) }],
  ['wrong census lane', d => { find(d, census).if = find(d, census).if.replace("'census'", "'native'") }],
  ['directed tests leak to census', d => { delete find(d, office).if }],
  ['native body changed', d => { find(d, native).run = find(d, native).run.replace('--test-fixtures', '') }],
  ['test compile deleted', d => { find(d, nativeCompile).run = find(d, nativeCompile).run.replace('./node_modules/.bin/tsc -p tsconfig.test.json\n', '') }],
  ['census body changed', d => { find(d, census).run += '\nexit 0\n' }],
  ['waived test failure', d => { find(d, native)['continue-on-error'] = true }],
  ['waived whole job', d => { d.jobs['smoke-os']['continue-on-error'] = true }],
  ['broad artifact paths', d => { find(d, artifact).with.path = '${{ runner.temp }}/**' }],
  ['artifact loss silently accepted', d => { find(d, artifact).with['if-no-files-found'] = 'ignore' }],
  ['artifact runs on both Windows lanes', d => { find(d, artifact).if = "always() && matrix.os == 'windows-latest'" }],
  ['post diagnostic detached from seal', d => { delete find(d, 'Post-census isolated module-scope diagnostic (#650)').env }],
  ['post diagnostic also native', d => { find(d, 'Post-census isolated module-scope diagnostic (#650)').if = "always() && !cancelled() && matrix.os == 'windows-latest'" }],
  ['lost always failure artifact', d => { find(d, artifact).if = "matrix.lane == 'census' && steps.windows-census.outputs.public_dir != ''" }],
  ['cancelled census is run', d => { find(d, census).if = find(d, census).if.replace('!cancelled()', 'always()') }],
  ['missing native staged scripts', d => { d.jobs['smoke-os'].steps = d.jobs['smoke-os'].steps.filter(s => s.name !== 'Stage native-lane Windows scripts (#750)') }],
  ['native script stage wrong lane', d => { find(d, 'Stage native-lane Windows scripts (#750)').if = "matrix.lane == 'census'" }],
  ['native script stage omitted command', d => { find(d, 'Stage native-lane Windows scripts (#750)').run = 'echo not-staged' }],
  ['missing frontend dependency', d => { d.jobs['smoke-os'].steps = d.jobs['smoke-os'].steps.filter(s => s.name !== front) }],
  ['frontend is not native only', d => { find(d, front).if = "matrix.os == 'windows-latest'" }],
  ['frontend skips lifecycle scripts', d => { find(d, front).run = 'cd chrome-extension\nnpm ci --ignore-scripts\n' }],
  ['frontend moves after original tests', d => { const a = d.jobs['smoke-os'].steps; a.push(a.splice(a.findIndex(s => s.name === front), 1)[0]) }],
  ['CPU preflight remains late', d => { const a = d.jobs['smoke-os'].steps; a.push(a.splice(a.findIndex(s => s.name === 'Pinned NSIS dependency transport and integrity (#633)'), 1)[0]) }],
  ['contract is not CI invoked', d => { find(d, 'Pinned NSIS dependency transport and integrity (#633)').run = 'node --test scripts/tests/nsis-ci-setup.test.mjs' }],
  ['matrix omits fresh native desktop', d => { d.jobs['smoke-os'].strategy.matrix.include.pop() }],
  ['matrix duplicate check name', d => { const a = d.jobs['smoke-os'].strategy.matrix.include; a[3].name = a[2].name }],
  ['matrix native not Windows', d => { d.jobs['smoke-os'].strategy.matrix.include[3].os = 'ubuntu-latest' }],
  ['native waits for census job', d => { d.jobs['smoke-os'].needs = 'build' }],
  ['matrix cancels other evidence', d => { d.jobs['smoke-os'].strategy['fail-fast'] = true }],
  ['credential free Windows removed', d => { d.jobs['smoke-os'].steps[0].with['persist-credentials'] = true }],
  ['wrong download cache key closure', d => { find(d, 'Setup Node.js').with['cache-dependency-path'] = 'companion/package-lock.json' }],
  ['unrelated build tests lost', d => { d.jobs.build.steps = d.jobs.build.steps.filter(s => s.name !== 'Run companion tests') }],
  ['history dependency weakened', d => { delete d.jobs['acp-history-restart'].needs }],
]
for (const [label, mutate] of mutations) {
  test('#750 actual parsed YAML mutation refuses: ' + label, () => {
    // Validate the genuine source before mutating. A broken baseline cannot
    // manufacture a passing negative by failing for an unrelated old defect.
    validateWindowsCiFeedback750(workflow)
    const doc = parseWorkflow750(workflow); mutate(doc)
    const source = printWorkflow750(doc)
    for (const value of [source, source.replaceAll('\n', '\r\n')]) assert.throws(() => validateWindowsCiFeedback750(value))
  })
}

const cockpitScalar = 'Windows cockpit Node scalar selection (#723)'
const retiredCockpit = JSON.parse(fs.readFileSync(new URL('./windows-ci-feedback-748-supplement.json', import.meta.url), 'utf8')).steps.slice(1)
const cockpitMutations = [
  ['missing prepared handoff control', d => { find(d, cockpitScalar).run = find(d, cockpitScalar).run.replace(' scripts/tests/cockpit-bridge-prepared-build.test.mjs', '') }],
  ['duplicate prepared handoff control', d => { find(d, cockpitScalar).run = find(d, cockpitScalar).run.replace(' scripts/tests/cockpit-bridge-prepared-build.test.mjs', ' scripts/tests/cockpit-bridge-prepared-build.test.mjs scripts/tests/cockpit-bridge-prepared-build.test.mjs') }],
  ['unreviewed prepared test argument', d => { find(d, cockpitScalar).run = find(d, cockpitScalar).run.replace(' scripts/tests/cockpit-bridge-prepared-build.test.mjs', ' scripts/tests/cockpit-bridge-other.test.mjs') }],
  ['missing scalar', d => { d.jobs['smoke-os'].steps = d.jobs['smoke-os'].steps.filter(s => s.name !== cockpitScalar) }],
  ['duplicate scalar', d => { d.jobs['smoke-os'].steps.push(structuredClone(find(d, cockpitScalar))) }],
  ['scalar no longer checks census VM', d => { find(d, cockpitScalar).if += " && matrix.lane == 'native'" }],
  ['missing newly required lifecycle control', d => { find(d, cockpitScalar).run = find(d, cockpitScalar).run.replace(' scripts/tests/cockpit-bridge-cdp-lifecycle.test.mjs', '') }],
  ['duplicate lifecycle control argument', d => { find(d, cockpitScalar).run = find(d, cockpitScalar).run.replace(' scripts/tests/cockpit-bridge-cdp-lifecycle.test.mjs', ' scripts/tests/cockpit-bridge-cdp-lifecycle.test.mjs scripts/tests/cockpit-bridge-cdp-lifecycle.test.mjs') }],
  ['extra scalar command', d => { find(d, cockpitScalar).run += 'echo unreviewed\n' }],
  ['scalar exit guard omitted', d => { find(d, cockpitScalar).run = find(d, cockpitScalar).run.replace('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n', '') }],
  ['scalar after Registry', d => { const a = d.jobs['smoke-os'].steps, s = a.splice(a.findIndex(s => s.name === cockpitScalar), 1)[0]; a.splice(a.findIndex(s => s.name === 'Native Windows read-only Registry discovery (#644)') + 1, 0, s) }],
  ...retiredCockpit.map(step => ['restored retired step: ' + step.name, d => { d.jobs['smoke-os'].steps.push(structuredClone(step)) }]),
  ['renamed retired gate', d => { d.jobs['smoke-os'].steps.push({ ...structuredClone(retiredCockpit[0]), name: 'renamed', id: 'renamed' }) }],
  ['dangling finite output', d => { d.jobs['smoke-os'].steps.push({ name: 'renamed upload', uses: 'actions/upload-artifact@v4', with: { path: '${{ steps.cockpit-first-identity.outputs.finite_summary }}' } }) }],

]
for (const [label, mutate] of cockpitMutations) {
  test('#748 source-derived cockpit union refuses: ' + label, () => {
    validateWindowsCiFeedback750(workflow)
    const doc = parseWorkflow750(workflow); mutate(doc)
    const source = printWorkflow750(doc)
    for (const value of [source, source.replaceAll('\n', '\r\n')]) assert.throws(() => validateWindowsCiFeedback750(value))
  })
}
