import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NATIVE_STAGES760 } from './native-ci-stages-760-contract.mjs'
import { validateWindowsCiFeedback750, parseWorkflow750, printWorkflow750, condition750, MATRIX750 } from './windows-ci-feedback-750-contract.mjs'
const text = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const names = NATIVE_STAGES760.map(([name]) => name)
const actual = () => parseWorkflow750(text)
const stages = doc => doc.jobs['smoke-os'].steps.filter(s => names.includes(s.name))
test('#760 all four actual stages retain the original OS/failure/cancellation condition', () => {
  validateWindowsCiFeedback750(text)
  const selected = stages(actual()); assert.equal(selected.length, 4)
  for (const matrix of MATRIX750) for (const success of [true, false]) for (const cancelled of [true, false]) {
    // A cancelled Actions job cannot have a currently successful status.
    if (cancelled && success) continue
    const context = {success, cancelled, values: {'matrix.os': matrix.os, 'matrix.lane': matrix.lane}}
    for (const step of selected) assert.equal(condition750(step.if, context), success && !cancelled && matrix.os !== 'ubuntu-latest')
  }
})
test('#760 each first failure blocks all later actual stages without weakening job failure', () => {
  for (const matrix of MATRIX750.filter(v => v.os !== 'ubuntu-latest')) for (const failAt of [0,1,2,3,-1]) {
    let success = true; const executed = []
    for (const [index, step] of stages(actual()).entries()) {
      if (condition750(step.if, {success, cancelled:false, values:{'matrix.os':matrix.os,'matrix.lane':matrix.lane}})) {
        executed.push(index); if (index === failAt) success = false
      }
    }
    assert.deepEqual(executed, failAt < 0 ? [0,1,2,3] : Array.from({length:failAt+1},(_,i)=>i))
    assert.equal(success, failAt < 0)
  }
})
const mutations = [
  ['omitted stage', (steps, at) => steps.splice(at,1)],
  ['duplicate stage', (steps, at) => steps.push(structuredClone(steps[at]))],
  ['changed command', (steps, at) => { steps[at].run += 'exit 0\n' }],
  ['lost errexit', (steps, at) => { steps[at].run = steps[at].run.replace('set -euo pipefail\n','') }],
  ['run after failure', (steps, at) => { steps[at].if = 'always()' }],
  ['continue-on-error', (steps, at) => { steps[at]['continue-on-error'] = true }],
  ['new timeout', (steps, at) => { steps[at]['timeout-minutes'] = 99 }],
  ['conditional shell wrapper', (steps, at) => { steps[at].shell = 'bash {0} || true' }],
]
for (const [name] of NATIVE_STAGES760) for (const [label, mutate] of mutations) test('#760 refuses ' + label + ': ' + name, () => {
  validateWindowsCiFeedback750(text)
  const doc = actual(), steps = doc.jobs['smoke-os'].steps
  mutate(steps, steps.findIndex(s => s.name === name))
  const changed = printWorkflow750(doc)
  for (const input of [changed, changed.replaceAll('\n','\r\n')]) assert.throws(() => validateWindowsCiFeedback750(input))
})
test('#760 refuses reordering or interleaving native desktop ownership', () => {
  validateWindowsCiFeedback750(text)
  for (const insert of [false,true]) {
    const doc=actual(), steps=doc.jobs['smoke-os'].steps, at=steps.findIndex(s=>s.name===names[0])
    if(insert) steps.splice(at+1,0,{name:'unowned window',run:'echo forbidden'})
    else [steps[at+2],steps[at+3]]=[steps[at+3],steps[at+2]]
    assert.throws(()=>validateWindowsCiFeedback750(printWorkflow750(doc)))
  }
})
