// CPU-only controls. No original native module, child, GUI or provider is run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { reconcile } from '../../windows-census.mjs'

export const confirmationCases772 = [
  { role: 'LOCAL', title: '#476 native local-work keys→real PTY/ACP→explicit handback→same history' },
  { role: 'TERMINAL', title: '#476 terminal-only native confirmation→real user PTY→selected partial excerpt→canonical reopen' },
]
const hash = value => createHash('sha256').update(value).digest('hex')
// Fixed synthetic input follows the actual C++ ping producer and TS parser.
// This is an observer input, never a hand-written positive output snapshot.
export function nativeConfirmationFrame772(role, point, ordinal, bucket, value) {
  return { type: 'system.ping', id: `D476_CF_${role}_${point}_${ordinal}_${bucket}_${value ? 1 : 0}` }
}
export const confirmationCpuSlot772 = 'cmspark.owned.confirmation772.normal-emits'

/** Select only original normal-emitted pure helpers and the actual local DTO expression. */
export function extractActualLocalObservation772(ts, normalJavaScript) {
  const sf = ts.createSourceFile('desktop-native-thread-metadata-476.test.js', normalJavaScript, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  assert.equal(sf.parseDiagnostics.length, 0)
  const names = ['parseLocalFirstSite705', 'parseLocalFocus705', 'parseLocalActivation705', 'createLocalDataObservation705', 'createLocalProgress705']
  const helpers = names.map(name => {
    const found = sf.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.equal(found.length, 1, name)
    return found[0].getText(sf)
  })
  const registrations = []
  function findTest(node) {
    if (ts.isCallExpression(node) && node.arguments.length >= 3 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === confirmationCases772[0].title) registrations.push(node)
    ts.forEachChild(node, findTest)
  }
  findTest(sf); assert.equal(registrations.length, 1)
  const diagnostic = [], required = [], first = []
  function inspect(node) {
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'diagnostic') {
      const argument = node.arguments[0]
      if (ts.isBinaryExpression(argument) && argument.operatorToken.kind === ts.SyntaxKind.PlusToken && ts.isStringLiteral(argument.left) && argument.left.text === 'D476_LOCAL_NATIVE_PHASE ') diagnostic.push(argument.getText(sf))
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (node.name.text === 'required') required.push(node.initializer.getText(sf))
      if (node.name.text === 'localFirstSite') first.push(node.initializer.getText(sf))
    }
    ts.forEachChild(node, inspect)
  }
  inspect(registrations[0]); assert.equal(diagnostic.length, 1); assert.equal(required.length, 1); assert.equal(first.length, 1)
  // Only the lexical scalar input is synthetic. The complete serialized object,
  // receipt-mask expression and nested observation objects are original producers.
  const factoryCode = `(() => {
    ${helpers.join('\n')}
    const dataObservation=createLocalDataObservation705(),localProgress=createLocalProgress705();
    return {dataObservation,localProgress,marker(seed={}){
      const required=${required[0]},receipts=new Set((seed.receiptIndexes??[]).map(index=>required[index]));
      const localFirstSite=${first[0]};
      for(const text of seed.first??[]){const result=parseLocalFirstSite705(text);if(result&&localFirstSite[result.origin]===null)localFirstSite[result.origin]=result.site;}
      const localFocusResult=parseLocalFocus705(seed.focus),localActivation=parseLocalActivation705(seed.activation);
      const {failed=true,protocolStarts=0,saved=0,inputUnicode=false,resizeCalls=0,terminalStops=0,authenticated=true,windowRequested=true,connections=1,settled=false}=seed;
      return ${diagnostic[0]};
    }};
  })()`
  return { factoryCode, create: () => vm.runInNewContext(factoryCode, { Buffer, Set }, { timeout: 1000 }),
    proof: { normalJavaScriptSHA256: hash(normalJavaScript), helperNames: names, helperSHA256: helpers.map(hash), payloadExpressionSHA256: hash(diagnostic[0]), requiredExpressionSHA256: hash(required[0]), firstInitializerSHA256: hash(first[0]), wholeNativeModuleExecuted: false } }
}

/** Immutable CPU donor source, staged at the canonical filename, not native execution. */
export function confirmationDonorSource772() {
  return `const test=require('node:test'),assert=require('node:assert/strict');
const supplied=globalThis[Symbol.for(${JSON.stringify(confirmationCpuSlot772)})];
assert.equal(supplied?.normalEmitBound,true);
const {createConfirmationObservation772,actualLocal}=supplied;
function observe(t,role){
 const observation=createConfirmationObservation772(role,()=>1000,message=>t.diagnostic(message));
 observation.server(1,1);observation.server(2,1);
 observation.native({type:'system.ping',id:'D476_CF_'+role+'_1_1_0_1'});
 observation.emit('ABORT');observation.emit('FINALLY');
 if(role==='LOCAL'){const local=actualLocal.create();local.localProgress.runtime();local.localProgress.attempt();t.diagnostic(local.marker({first:['D476_LOCAL_FIRST_W_8'],focus:'D476_LOCAL_FOCUS_FOREGROUND_MISMATCH',activation:'D476_LOCAL_ACTIVATE_1_2'}));}
 assert.fail('EXPECTED_CPU_PROJECTION_DONOR_FAILURE');
}
test(${JSON.stringify(confirmationCases772[0].title)},t=>observe(t,'LOCAL'));
test(${JSON.stringify(confirmationCases772[1].title)},t=>observe(t,'TERMINAL'));
\n`
}

export function assertObservedConfirmationCases772(result) {
  assert.equal(result.outcome, 'FAIL', 'the real donor failures must remain failures')
  for (const { role, title } of confirmationCases772) {
    const rows = result.cases.filter(row => row.name_hash === hash(title) && row.outcome === 'FAIL')
    assert.equal(rows.length, 1)
    assert.equal(Number(rows[0].confirmation_phase?.status === 'OBSERVED'), 1)
    assert.equal(rows[0].confirmation_phase.snapshot.role, role)
    assert.equal(rows[0].failure.status, 'OBSERVED')
    // TestsStream reports the outer test failure; builtin TAP retains the inner assertion.
    assert.equal(rows[0].failure.error_code, 'ERR_TEST_FAILURE')
    assert.equal(rows[0].failure.failure_type, 'testCodeFailure')
    if (role === 'LOCAL') assert.equal(rows[0].local_phase.status, 'OBSERVED')
    else assert.equal(rows[0].local_phase, undefined)
  }
}

/** Receipts/TAP must come from the separate real Node donor, never fabricated events. */
export async function confirmationReconcileControls772(input, ownedRoot) {
  assert.ok(path.isAbsolute(ownedRoot)); assert.equal(fs.existsSync(ownedRoot), false)
  fs.mkdirSync(ownedRoot, { mode: 0o700 })
  const tap = fs.readFileSync(input.rawFile, 'utf8')
  // These are the actual separate donor's builtin TAP bytes, not projected metadata.
  for (const pattern of [/^  code: 'ERR_ASSERTION'$/gm, /^  operator: 'fail'$/gm, /^  error: 'EXPECTED_CPU_PROJECTION_DONOR_FAILURE'$/gm, /^  failureType: 'testCodeFailure'$/gm]) {
    assert.equal([...tap.matchAll(pattern)].length, confirmationCases772.length)
  }
  const original = await reconcile(input); assertObservedConfirmationCases772(original)
  const negativeFailureMutants = []
  for (const { role, title } of confirmationCases772) {
    for (const [field, value, expected] of [['error_code', 'ERR_ASSERTION', 'ERR_TEST_FAILURE'], ['failure_type', 'testTimeoutFailure', 'testCodeFailure']]) {
      const mutant = structuredClone(original)
      const row = mutant.cases.find(candidate => candidate.name_hash === hash(title) && candidate.outcome === 'FAIL')
      assert.ok(row); row.failure[field] = value
      assert.throws(() => assertObservedConfirmationCases772(mutant), error => error.code === 'ERR_ASSERTION' && error.actual === value && error.expected === expected)
      negativeFailureMutants.push(`${role}:${field}`)
    }
  }
  const docs = fs.readdirSync(input.receipts).sort().map(name => ({ name, rows: fs.readFileSync(path.join(input.receipts, name), 'utf8').trim().split('\n').map(JSON.parse) }))
  assert.equal(docs.length, 1)
  const localHash = hash(confirmationCases772[0].title), localFailure = docs[0].rows.find(row => row.type === 'test:fail' && row.name_hash === localHash)
  assert.ok(localFailure)
  const same = row => row.file === localFailure.file && row.line === localFailure.line && row.column === localFailure.column && row.nesting === localFailure.nesting
  const originals = docs[0].rows.filter(row => row.type === 'test:diagnostic' && row.confirmation_phase && same(row))
  assert.equal(originals.length, 1)
  const qualified = []
  for (const mode of ['wrong-location', 'duplicate', 'wrong-role', 'auxiliary-only']) {
    // These are explicit negative mutants of genuine producer receipts, not new
    // TestsStream observations or claims that an auxiliary process was executed.
    const copy = structuredClone(docs), rows = copy[0].rows, index = rows.findIndex(row => row.type === 'test:diagnostic' && row.confirmation_phase && same(row)), event = rows[index]
    assert.ok(index > 0)
    if (mode === 'wrong-location') event.line += 1
    if (mode === 'duplicate') rows.splice(index, 0, structuredClone(event))
    if (mode === 'wrong-role') {
      const other = rows.find(row => row.type === 'test:diagnostic' && row.confirmation_phase?.snapshot?.role === 'TERMINAL')
      assert.ok(other); event.confirmation_phase = structuredClone(other.confirmation_phase)
    }
    if (mode === 'auxiliary-only') {
      rows.splice(index, 1)
      const begin = structuredClone(rows[0]); begin.test_argv = ['.test-dist/tests/auxiliary-confirmation-772.test.js']
      copy.push({ name: 'events-772-00000000-0000-4000-8000-000000000772.jsonl', rows: [begin, structuredClone(event), { kind: 'end', events: 1 }] })
    }
    const receipts = path.join(ownedRoot, mode); fs.mkdirSync(receipts)
    for (const document of copy) {
      const events = document.rows.slice(1, -1); events.forEach((row, seq) => { row.seq = seq }); document.rows.at(-1).events = events.length
      fs.writeFileSync(path.join(receipts, document.name), document.rows.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx', mode: 0o600 })
    }
    const result = await reconcile({ ...input, receipts }); assert.equal(result.outcome, 'FAIL')
    const row = result.cases.find(row => row.name_hash === localHash && row.outcome === 'FAIL'); assert.ok(row)
    assert.equal(row.confirmation_phase.status, mode === 'duplicate' || mode === 'wrong-role' ? 'UNKNOWN' : 'MISSING')
    if (mode === 'duplicate') assert.equal(row.confirmation_phase.reason, 'AMBIGUOUS')
    if (mode === 'wrong-role') assert.equal(row.confirmation_phase.reason, 'ROLE_MISMATCH')
    qualified.push(mode)
  }
  return { original, negativeReceiptMutants: qualified, negativeFailureMutants, actualDonorCases: 2, innerTAPAssertionCode: 'ERR_ASSERTION', outerTestFailureCode: 'ERR_TEST_FAILURE', donorOutcome: 'EXPECTED_FAIL_NOT_NATIVE_PASS' }
}
