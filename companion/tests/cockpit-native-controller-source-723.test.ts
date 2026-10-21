import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

// Execute the actual remote controller's terminal catch/finally. Inert child
// outcomes are fault inputs, not Windows job/Chrome/native-positive receipts.
const file = path.resolve(__dirname, "../../../scripts/tests/cockpit-bridge-real-first.cjs")
const evidence = require(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-first-evidence.cjs')).createObserver((bytes: Buffer) => bytes.length)
const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const terminals: ts.TryStatement[] = []
function visit(node: ts.Node) {
  if (ts.isTryStatement(node) && node.finallyBlock?.getText(source).includes("COCKPIT_BRIDGE_JOB_TREE_CLEANUP_UNPROVEN") &&
    node.tryBlock.getText(source).includes("const secret = randomBytes(32)")) terminals.push(node)
  ts.forEachChild(node, visit)
}
visit(source); assert.equal(terminals.length, 1, "actual controller terminal must remain unique")
const terminal = terminals[0]
async function run(primary: boolean, jobEmpty: boolean, serverFails = false) {
  let settled = 0, unregistered = 0
  const diagnostics: string[] = [], original = Error("ORIGINAL_NATIVE_GATE_FAILURE")
  const chromeChild = { exitCode: 1, signalCode: null }, server = { exitCode: 0, signalCode: null }
  const closes = new Map<object, Promise<{ code: number }>>([
    [chromeChild, Promise.resolve({ code: jobEmpty ? 0 : 1 })],
    [server, serverFails ? Promise.reject(Error("OWNED_SERVER_CLEANUP_FAILED")) : Promise.resolve({ code: 0 })],
  ])
  // Handle injected rejection immediately; the actual finally still awaits it.
  closes.get(server)!.catch(() => {})
  const sandbox = { assert, evidence, original, primaryFailure: null, chromeChild, cleanupObserved: jobEmpty, closes, server,
    registered: true, sourceRepo: "owned-public-source", install: "owned-test-install", path,
    cdp: undefined, t: { diagnostic: (value: string) => diagnostics.push(value) },
    lease: { settled: () => { settled++ } }, runPs: async () => { unregistered++ },
  }
  const body = primary ? "throw original" : "void 0"
  const code = `(async()=>{ try { ${body} } ${terminal.catchClause?.getText(source) ?? ""} finally ${terminal.finallyBlock!.getText(source)} })()`
  let error: unknown
  try { await new vm.Script(code, { filename: file }).runInNewContext(sandbox) } catch (value) { error = value }
  return { error, original, settled, unregistered, diagnostics }
}
test("cleanup failure preserves the original native gate assertion", async () => {
  const result = await run(true, false)
  assert.equal(result.error, result.original)
  assert.equal(result.settled, 0); assert.equal(result.unregistered, 1)
})
test("a missing job-empty receipt still fails an otherwise successful gate", async () => {
  const result = await run(false, false)
  assert.match(String(result.error), /COCKPIT_BRIDGE_JOB_TREE_CLEANUP_UNPROVEN/)
  assert.equal(result.settled, 0); assert.equal(result.unregistered, 1)
})
test("server cleanup failure still attempts exact owned unregistration", async () => {
  const result = await run(true, true, true)
  assert.equal(result.error, result.original)
  assert.equal(result.unregistered, 1); assert.equal(result.settled, 0)
})
test("proved job-empty and all cleanup success may settle without hiding primary", async () => {
  const result = await run(true, true)
  assert.equal(result.error, result.original); assert.equal(result.unregistered, 1); assert.equal(result.settled, 1)
})

// Extract the real helper/launch code. EventEmitter children are controlled CPU
// fault inputs; no PowerShell, server, job wrapper, or browser is executed.
function declaration(name: string, optional = false) {
  const matches: ts.VariableDeclaration[] = []
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node)
    ts.forEachChild(node, find)
  }
  find(source)
  assert.equal(matches.length, optional && matches.length === 0 ? 0 : 1, `unique actual ${name}`)
  return matches[0] ? `const ${matches[0].getText(source)};` : ""
}
const abortFunctions = source.statements.filter((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "aborted")
assert.equal(abortFunctions.length, 1)
const helperCode = [abortFunctions[0].getText(source), declaration("track"), declaration("admitChild", true), declaration("runPs")].join("\n")
function launchCode(marker: string) {
  const statements = terminal.tryBlock.statements
  const found = statements.map((node, index) => ({ node, index })).filter(({ node }) => node.getText(source).includes(marker))
  assert.equal(found.length, 1, `unique actual launch ${marker}`)
  const { node, index } = found[0]
  // Include the actual adjacent admission statement when present; the old
  // producer has none and must fail the same negative control.
  const before = index > 0 && statements[index - 1].getText(source) === "admitChild()" ? statements[index - 1].getText(source) + ";" : ""
  return before + node.getText(source)
}
async function controllerHarness() {
  const { EventEmitter } = await import("node:events")
  type Child = InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>;
    stdin: { end: () => void }; exitCode: number | null; signalCode: string | null; kill: () => boolean; send: () => void }
  const abort = new AbortController(), reason = Error("CONTROLLED_LEASE_EXPIRED"), original = Error("CONTROLLED_CHILD_ERROR")
  const children: Child[] = [], kinds: string[] = [], descriptors = new Set<number>()
  let killed = 0, closedDescriptors = 0, settled = 0, nextDescriptor = 10, checkpoints = 0, checkpointError: Error | undefined
  const child = (kind: string): Child => {
    kinds.push(kind)
    const value = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(),
      stdin: { end() {} }, exitCode: null as number | null, signalCode: null as string | null,
      kill: () => { killed++; if (kind === "fork") { value.exitCode = 0; value.emit("close", 0, null) }; return true }, send() {} })
    return value
  }
  const context = vm.createContext({ assert, evidence, path, signal: abort.signal, children, closes: new WeakMap(),
    lease: { checkpoint() { checkpoints++; if (checkpointError) throw checkpointError }, settled() { settled++ }, borrow: () => ({ nonce: "controlled-owned-fixture" }) },
    powershell: "owned-inert-powershell", childEnvironment: { OWNED_CPU: "yes" }, root: "owned-root", install: "owned-install",
    sourceRepo: "public-source", serverFile: "owned-server", jobBuild: "owned-job", chrome: "fixed-browser", chromeSHA256: "fixed-sha",
    extension: "owned-extension", profile: "owned-profile", outerDeadline: 1, secret: "controlled-not-a-token",
    randomBytes: () => ({ toString: () => "controlled-not-a-token" }),
    cp: { spawn: () => child("spawn"), fork: () => child("fork") },
    fs: { openSync() { const fd = nextDescriptor++; descriptors.add(fd); return fd },
      closeSync(fd: number) { assert.ok(descriptors.delete(fd)); closedDescriptors++ }, writeSync() {} },
    server: undefined, chromeChild: undefined, cdp: undefined, cleanupObserved: false, primaryFailure: null, registered: false,
    t: { diagnostic() {} }, messages: [], observers: new Set(),
    waitMessage: async () => { abort.signal.throwIfAborted() },
  })
  new vm.Script(helperCode + "\nglobalThis.actualRunPs = runPs;").runInContext(context)
  const actualRunPs = context.actualRunPs as (script: string, args: string[], cleanup?: boolean) => Promise<void>
  function close(value: Child, code = 0) { value.exitCode = code; value.emit("close", code, null) }
  function launch(marker: string) { return new vm.Script(launchCode(marker)).runInContext(context) }
  async function turn() { for (let index = 0; index < 8; index++) await Promise.resolve() }
  return { abort, reason, original, children, kinds, context, actualRunPs, close, launch, turn,
    checkpointFails() { checkpointError = reason },
    facts: () => ({ killed, closedDescriptors, openDescriptors: descriptors.size, settled, checkpoints }) }
}

test("pending real PowerShell abort joins close before output release and admits no late server", async t => {
  const h = await controllerHarness()
  const statements = terminal.tryBlock.statements
  const ready = statements.findIndex(node => node.getText(source).includes("waitMessage(value => value?.type === 'ready')"))
  assert.ok(ready > 0, "actual main initialization prefix must exist")
  const prefix = statements.slice(0, ready + 1).map(node => node.getText(source)).join("\n")
  let done = false, result: unknown
  const running = new vm.Script(`(async()=>{try {${prefix}} ${terminal.catchClause!.getText(source)} finally ${terminal.finallyBlock!.getText(source)}})()`).runInContext(h.context) as Promise<void>
  running.then(() => { done = true }, value => { result = value; done = true })
  assert.equal(h.children.length, 1)
  h.abort.abort(h.reason); await h.turn()
  const beforeClose = { ...h.facts(), done }
  h.close(h.children[0]); await running.catch(() => {}); await h.turn()
  // Old code may create a late server: close it so the counterexample exits
  // naturally, while preserving the zero-new-child assertion below.
  if (!done && h.children[1]) { h.close(h.children[1]); await running.catch(() => {}); await h.turn() }
  t.diagnostic(JSON.stringify({ beforeClose, lateServerForks: h.kinds.filter(kind => kind === "fork").length, descriptorsAfterClose: h.facts().closedDescriptors }))
  assert.equal(beforeClose.killed, 1, "abort must request only the owned pending helper's termination")
  assert.equal(beforeClose.done, false); assert.equal(beforeClose.closedDescriptors, 0); assert.equal(beforeClose.openDescriptors, 2)
  assert.equal(result, h.reason); assert.equal(h.kinds.filter(kind => kind === "fork").length, 0, "no server may launch after expiry")
  assert.equal(h.facts().closedDescriptors, 2)
})

test("real PowerShell pre-abort refuses spawn, while cleanup still runs and joins close", async () => {
  const h = await controllerHarness(); h.abort.abort(h.reason)
  let error: unknown
  const ordinary = h.actualRunPs("owned.ps1", []).catch(value => { error = value })
  await h.turn(); const admitted = h.children.length
  // Drain an incorrectly admitted old-producer child, preserving natural exit.
  if (h.children[0]) h.close(h.children[0]); await ordinary
  assert.equal(error, h.reason); assert.equal(admitted, 0)
  let done = false
  const cleanup = h.actualRunPs("owned-unregister.ps1", [], true).then(() => { done = true })
  await h.turn(); assert.equal(done, false); assert.equal(h.children.length, 1); assert.equal(h.facts().killed, 0)
  h.close(h.children[0]); await cleanup
  assert.equal(done, true); assert.equal(h.facts().closedDescriptors, 2)
})

for (const marker of ["cp.fork(", "'cockpit-chrome-job-cpu.exe'", "'cockpit-chrome-job.exe'"]) {
  test(`actual ${marker} launch rejects aborted signal and failed lease before admission`, async () => {
    for (const mode of ["signal", "lease"] as const) {
      const h = await controllerHarness()
      if (mode === "signal") h.abort.abort(h.reason); else h.checkpointFails()
      let error: unknown
      try { h.launch(marker) } catch (value) { error = value }
      assert.equal(error, h.reason); assert.equal(h.kinds.length, 0)
    }
  })
}

test("real helper normal close succeeds and real child admission remains available", async () => {
  const h = await controllerHarness()
  const normal = h.actualRunPs("owned.ps1", [])
  assert.equal(h.children.length, 1); h.close(h.children[0]); await normal
  assert.equal(h.facts().closedDescriptors, 2); assert.equal(h.facts().killed, 0)
  for (const marker of ["cp.fork(", "'cockpit-chrome-job-cpu.exe'", "'cockpit-chrome-job.exe'"]) h.launch(marker)
  assert.equal(h.kinds.length, 4)
})

test("real helper error still awaits actual close before descriptor cleanup", async () => {
  const h = await controllerHarness(); let done = false, error: unknown
  const result = h.actualRunPs("owned.ps1", []).then(() => { done = true }, value => { error = value; done = true })
  h.children[0].emit("error", h.original); await h.turn()
  const beforeClose = { ...h.facts(), done }
  h.close(h.children[0]); await result
  assert.equal(beforeClose.done, false); assert.equal(beforeClose.closedDescriptors, 0)
  assert.equal(error, h.original); assert.equal(h.facts().closedDescriptors, 2)
})

test("real helper abort with a failed kill request still joins close and preserves abort", async () => {
  const h = await controllerHarness(); let done = false, error: unknown, killAttempts = 0
  const running = h.actualRunPs("owned.ps1", []).then(() => { done = true }, value => { error = value; done = true })
  h.children[0].kill = () => { killAttempts++; throw Error("CONTROLLED_KILL_REFUSED") }
  h.abort.abort(h.reason); await h.turn()
  const beforeClose = { ...h.facts(), done, killAttempts }
  h.close(h.children[0]); await running
  assert.equal(beforeClose.killAttempts, 1); assert.equal(beforeClose.done, false); assert.equal(beforeClose.closedDescriptors, 0)
  assert.equal(error, h.reason); assert.equal(h.facts().closedDescriptors, 2)
})

test("actual registration attempt always reaches exact owned cleanup, including abort after side effects", async t => {
  const statements = terminal.tryBlock.statements
  const indexes = statements.map((node, index) => ({ node, index })).filter(({ node }) =>
    ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression) &&
    node.expression.getText(source).includes("runPs(path.join(sourceRepo,") && node.getText(source).includes("scripts/register-cockpit-native-bridge.ps1"))
  assert.equal(indexes.length, 1, "unique actual registration invocation")
  const registrationIndex = indexes[0].index
  const flags = [registrationIndex - 1, registrationIndex + 1].filter(index =>
    index >= 0 && statements[index]?.getText(source) === "registered = true")
  assert.equal(flags.length, 1, "actual adjacent registration-attempt flag")
  const registration = [registrationIndex, flags[0]].sort((a, b) => a - b).map(index => statements[index].getText(source)).join("\n")
  const facts: { schedule: string; cleanupCalls: number; settled: number; ownedState: boolean; primaryPreserved: boolean }[] = []
  for (const schedule of ["owned-then-abort", "owned-then-abort-cleanup-unknown", "no-record-cleanup-not-owned", "normal"]) {
    const primary = Error("CONTROLLED_REGISTRATION_ABORT"), cleanupError = Error("CONTROLLED_REGISTRATION_NOT_OWNED")
    let ownedState = false, cleanupCalls = 0, settled = 0, error: unknown
    const install = "owned-test-install", sourceRepo = "owned-public-source", observedId = "a".repeat(32)
    const sandbox = { assert, evidence, path, install, sourceRepo, observedId, registered: false, primaryFailure: null,
      chromeChild: undefined, server: undefined, cdp: undefined, cleanupObserved: false,
      t: { diagnostic() {} }, lease: { settled() { settled++ } },
      runPs: async (script: string, args: string[], cleanup = false) => {
        assert.equal(script, path.join(sourceRepo, "scripts/register-cockpit-native-bridge.ps1"))
        if (cleanup) {
          cleanupCalls++; assert.deepEqual(Array.from(args), ["-InstallRoot", install, "-Unregister"])
          if (schedule.includes("cleanup-")) throw cleanupError
          ownedState = false; return
        }
        assert.deepEqual(Array.from(args), ["-InstallRoot", install, "-ExtensionId", observedId])
        // Controlled interruption of the real helper seam. The registrar
        // writes its exclusive owned files and registry before its final
        // success output; this is not an OS/registry-positive receipt.
        ownedState = schedule !== "no-record-cleanup-not-owned"
        if (schedule !== "normal") throw primary
      },
    }
    const code = `(async()=>{try {${registration}} ${terminal.catchClause!.getText(source)} finally ${terminal.finallyBlock!.getText(source)}})()`
    try { await new vm.Script(code).runInNewContext(sandbox) } catch (value) { error = value }
    facts.push({ schedule, cleanupCalls, settled, ownedState, primaryPreserved: schedule === "normal" ? error === undefined : error === primary })
  }
  t.diagnostic(JSON.stringify(facts))
  for (const fact of facts) {
    assert.equal(fact.cleanupCalls, 1, `${fact.schedule}: every attempt requires exact owned unregistration`)
    assert.equal(fact.primaryPreserved, true, fact.schedule)
    assert.equal(fact.settled, fact.schedule.includes("cleanup-") ? 0 : 1, fact.schedule)
    assert.equal(fact.ownedState, fact.schedule === "owned-then-abort-cleanup-unknown", fact.schedule)
  }
})
