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
async function controllerHarness(rawSinkFailure?: { child: number; stream: "stdout" | "stderr"; listener?: boolean }) {
  const { EventEmitter } = await import("node:events")
  type Child = InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>;
    stdin: { end: () => void }; exitCode: number | null; signalCode: string | null; kill: () => boolean; send: () => void }
  const abort = new AbortController(), reason = Error("CONTROLLED_LEASE_EXPIRED"), original = Error("CONTROLLED_CHILD_ERROR")
  const children: Child[] = [], kinds: string[] = [], descriptors = new Set<number>()
  let releaseStage!: () => void, completeStage!: () => void, stageFailure: unknown, queryPhase = "stage"
  const stageGate = new Promise<void>(resolve => { releaseStage = resolve }), stageCompletion = new Promise<void>(resolve => { completeStage = resolve })
  const stages: any[] = [], launches: { kind: string; args: any[] }[] = []
  const stage = async (options: any) => {
    stages.push(options); await stageGate
    if (stageFailure) throw stageFailure
    await options.verifyFiles(queryPhase)
    await stageCompletion
    if (stageFailure) throw stageFailure
  }
  let killed = 0, closedDescriptors = 0, settled = 0, nextDescriptor = 10, checkpoints = 0, checkpointError: Error | undefined
  const child = (kind: string): Child => {
    kinds.push(kind)
    const value = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(),
      stdin: { end() {} }, exitCode: null as number | null, signalCode: null as string | null,
      kill: () => { killed++; if (kind === "fork") { value.exitCode = 0; value.emit("close", 0, null) }; return true }, send() {} })
    if (rawSinkFailure?.listener && rawSinkFailure.child === children.length + 1) {
      const stream = value[rawSinkFailure.stream], on = stream.on
      stream.on = function (name: string | symbol, callback: (...args: any[]) => void) {
        if (name === "data") throw original
        return on.call(this, name, callback)
      }
    }
    return value
  }
  const context = vm.createContext({ assert, evidence, path, signal: abort.signal, children, closes: new WeakMap(),
    lease: { checkpoint() { checkpoints++; if (checkpointError) throw checkpointError }, settled() { settled++ }, borrow: () => ({ nonce: "controlled-owned-fixture" }) },
    powershell: "owned-inert-powershell", childEnvironment: { OWNED_CPU: "yes" }, root: "owned-root", install: "owned-install",
    sourceRepo: "public-source", serverFile: "owned-server", jobBuild: "owned-job", chrome: "fixed-browser", chromeSHA256: "fixed-sha",
    preparedNonce: "a".repeat(32), require(id: string) { assert.equal(id, "./cockpit-bridge-prepared-build.cjs"); return { stage } },
    extension: "owned-extension", profile: "owned-profile", outerDeadline: 1, secret: "controlled-not-a-token",
    randomBytes: () => ({ toString: () => "controlled-not-a-token" }),
    cp: { spawn: (...args: any[]) => { launches.push({ kind: "spawn", args }); return child("spawn") }, fork: (...args: any[]) => { launches.push({ kind: "fork", args }); return child("fork") } },
    fs: { openSync(name: string) {
      if (rawSinkFailure && !rawSinkFailure.listener && path.basename(name) === `operator-${rawSinkFailure.child}.${rawSinkFailure.stream}`) throw original
      const fd = nextDescriptor++; descriptors.add(fd); return fd },
      mkdirSync() {}, closeSync(fd: number) { assert.ok(descriptors.delete(fd)); closedDescriptors++ }, writeSync() {} },
    server: undefined, chromeChild: undefined, cdp: undefined, cleanupObserved: false, primaryFailure: null, registered: false,
    t: { diagnostic() {} }, messages: [], observers: new Set(),
    waitMessage: async () => { abort.signal.throwIfAborted() },
  })
  new vm.Script(helperCode + "\nglobalThis.actualRunPs = runPs;").runInContext(context)
  const actualRunPs = context.actualRunPs as (script: string, args: string[], cleanup?: boolean) => Promise<void>
  function close(value: Child, code = 0) { value.exitCode = code; value.emit("close", code, null) }
  // Deliberate finite schedule fixture for the actual runPs helper. This is
  // not the production compiler prefix: preparation now belongs to its own gate.
  function parallelHelpers(retire = false) {
    const body = `await Promise.allSettled([runPs('controlled-host-helper.ps1', []), runPs('controlled-job-helper.ps1', [])]).then(results => {
      if (results[0].status === 'rejected') throw results[0].reason;
      if (results[1].status === 'rejected') throw results[1].reason;
    });`
    const code = retire ? `try {${body}} ${terminal.catchClause!.getText(source)} finally ${terminal.finallyBlock!.getText(source)}` : body
    return new vm.Script(`(async()=>{${code}})()`).runInContext(context) as Promise<void>
  }
  function productionPrefix() {
    const statements = terminal.tryBlock.statements
    const cpu = statements.findIndex(node => node.getText(source).startsWith("const cpu ="))
    assert.ok(cpu > 0); assert.equal(statements[cpu - 1].getText(source), "admitChild()")
    const body = statements.slice(0, cpu + 1).map(node => node.getText(source)).join("\n")
    return new vm.Script(`(async()=>{${body}})()`).runInContext(context) as Promise<void>
  }
  function launch(marker: string) { return new vm.Script(launchCode(marker)).runInContext(context) }
  async function turn() { for (let index = 0; index < 32; index++) await Promise.resolve() }
  return { abort, reason, original, children, kinds, context, actualRunPs, close, launch, parallelHelpers, productionPrefix, turn, stages, launches,
    releaseStage, completeStage, stageFails(error: unknown) { stageFailure = error }, queryPhase(value: string) { queryPhase = value },
    checkpointFails() { checkpointError = reason },
    facts: () => ({ killed, closedDescriptors, openDescriptors: descriptors.size, settled, checkpoints }) }
}

for (const schedule of ["normal", "host-error", "job-error", "both-errors", "abort", "failed-kill"] as const) {
  test(`actual runPs finite parallel helper fixture joins both closes: ${schedule}`, async () => {
    const h = await controllerHarness(), jobError = Error("CONTROLLED_JOB_BUILD_ERROR")
    let done = false, error: unknown, killAttempts = 0
    const running = h.parallelHelpers().then(() => { done = true }, value => { error = value; done = true })
    const initial = { count: h.children.length, descriptors: h.facts().openDescriptors }
    // Drain a refused controlled admission too, so any regression exits
    // naturally rather than leaving an unresolved fake child.
    if (initial.count !== 2) {
      for (const child of h.children) h.close(child)
      await running
      assert.equal(initial.count, 2, "both controlled helper calls must be admitted before either closes")
    }
    assert.equal(initial.descriptors, 4); assert.deepEqual(h.kinds, ["spawn", "spawn"])
    if (schedule === "failed-kill") for (const child of h.children) child.kill = () => { killAttempts++; throw Error("CONTROLLED_KILL_REFUSED") }
    if (schedule === "host-error" || schedule === "both-errors") h.children[0].emit("error", h.original)
    if (schedule === "job-error" || schedule === "both-errors") h.children[1].emit("error", jobError)
    if (schedule === "abort" || schedule === "failed-kill") h.abort.abort(h.reason)
    await h.turn()
    assert.equal(done, false); assert.equal(h.facts().closedDescriptors, 0)
    if (schedule === "abort") assert.equal(h.facts().killed, 2)
    if (schedule === "failed-kill") assert.equal(killAttempts, 2)
    // Complete Job first, including both-fail: selection must still be host-first.
    h.close(h.children[1]); await h.turn()
    assert.equal(done, false); assert.equal(h.facts().closedDescriptors, 2)
    assert.deepEqual(h.kinds, ["spawn", "spawn"], "only the two controlled helper children exist while a sibling remains live")
    h.close(h.children[0]); await running
    assert.equal(done, true); assert.equal(h.facts().openDescriptors, 0); assert.equal(h.facts().closedDescriptors, 4)
    const expected = schedule === "normal" ? undefined : schedule === "job-error" ? jobError : schedule === "abort" || schedule === "failed-kill" ? h.reason : h.original
    assert.equal(error, expected, "host-first original rejection identity remains intact")
  })
}

for (const child of [1, 2]) for (const stream of ["stdout", "stderr"] as const) {
  test(`partial raw ${child}/${stream} setup joins both actual closes before lease retirement`, async () => {
    const h = await controllerHarness({ child, stream })
    let done = false, error: unknown
    const running = h.parallelHelpers(true).then(() => { done = true }, value => { done = true; error = value })
    await h.turn(); assert.equal(h.children.length, 2)
    h.close(h.children[child === 1 ? 1 : 0]); await h.turn()
    const beforeFaultClose = { done, ...h.facts() }
    // Always drain the actual fake child before assertions, including against
    // the immutable old helper; a missing join must fail naturally, not hang.
    h.close(h.children[child - 1]); await running; await h.turn()
    assert.equal(beforeFaultClose.done, false, "partial setup cannot return before its real close")
    assert.equal(beforeFaultClose.settled, 0, "a still-live controlled helper cannot retire the lease")
    assert.equal(h.facts().openDescriptors, 0); assert.equal(h.facts().settled, 1)
    assert.equal(error, h.original, "the original raw setup refusal is not replaced")
  })
}

for (const mode of ["normal", "stage-refused", "query-refused", "query-error", "abort-before-query", "lease-before-query", "abort-query", "abort-before-server", "lease-before-server", "wrong-phase"] as const) {
  test(`actual runtime stage/query/server/CPU prefix preserves admission ordering: ${mode}`, async () => {
    const h = await controllerHarness()
    let done = false, error: unknown
    const running = h.productionPrefix().then(() => { done = true }, value => { error = value; done = true })
    await h.turn()
    assert.equal(h.stages.length, 1); assert.equal(h.children.length, 0)
    const options = h.stages[0]
    assert.deepEqual(Object.keys(options).sort(), ["expectedNonce", "install", "jobBuild", "root", "sourceRepo", "verifyFiles"])
    assert.equal(options.expectedNonce, h.context.preparedNonce, "actual preparedNonce closure is passed unchanged")
    assert.equal(options.root, h.context.root); assert.equal(options.install, h.context.install)
    assert.equal(options.sourceRepo, h.context.sourceRepo); assert.equal(options.jobBuild, path.join(h.context.root, "job-build"))
    if (mode === "stage-refused") h.stageFails(h.original)
    if (mode === "wrong-phase") h.queryPhase("prepare")
    if (mode === "abort-before-query") h.abort.abort(h.reason)
    if (mode === "lease-before-query") h.checkpointFails()
    h.releaseStage(); await h.turn()
    if (["stage-refused", "wrong-phase", "abort-before-query", "lease-before-query"].includes(mode)) {
      await running
      assert.equal(h.children.length, 0, "stage/phase failure cannot start query, server or CPU")
      if (mode === "stage-refused") assert.equal(error, h.original)
      if (mode === "abort-before-query" || mode === "lease-before-query") assert.equal(error, h.reason)
      if (mode === "wrong-phase") assert.match(String(error), /PREPARATION_STAGE_REQUIRED/)
      assert.equal(done, true); return
    }
    assert.equal(h.children.length, 1); assert.deepEqual(h.kinds, ["spawn"])
    const query = h.launches[0]
    assert.equal(query.args[0], "owned-inert-powershell")
    assert.deepEqual(Array.from(query.args[1]), ["-NoProfile", "-NonInteractive", "-File", path.join("public-source", "scripts/tests/cockpit-bridge-prepared-paths.ps1"), "-Phase", "stage"])
    assert.equal(query.args[2].env, h.context.childEnvironment)
    assert.equal(h.facts().checkpoints, 1, "query uses original signal/lease admission")
    if (mode === "query-error") h.children[0].emit("error", h.original)
    if (mode === "abort-query") h.abort.abort(h.reason)
    await h.turn(); assert.equal(done, false); assert.deepEqual(h.kinds, ["spawn"])
    assert.equal(h.facts().closedDescriptors, 0, "query must actually close before stage publication")
    if (mode === "abort-query") assert.equal(h.facts().killed, 1)
    h.close(h.children[0], mode === "query-refused" ? 1 : 0); await h.turn()
    assert.equal(h.facts().openDescriptors, 0)
    if (["query-refused", "query-error", "abort-query"].includes(mode)) {
      await running; assert.equal(done, true); assert.deepEqual(h.kinds, ["spawn"])
      if (mode === "query-error") assert.equal(error, h.original)
      if (mode === "abort-query") assert.equal(error, h.reason)
      if (mode === "query-refused") assert.match(String(error), /OWNED_INSTALL_REFUSED/)
      return
    }
    assert.equal(done, false); assert.deepEqual(h.kinds, ["spawn"], "closed query alone is not stage success")
    if (mode === "abort-before-server") h.abort.abort(h.reason)
    if (mode === "lease-before-server") h.checkpointFails()
    h.completeStage(); await running
    if (mode !== "normal") {
      assert.equal(error, h.reason); assert.deepEqual(h.kinds, ["spawn"], "original signal/lease blocks server and CPU after stage")
    } else {
      assert.equal(error, undefined); assert.deepEqual(h.kinds, ["spawn", "fork", "spawn"])
      assert.equal(h.facts().checkpoints, 3, "same signal/lease guards query, server and CPU")
      assert.equal(h.launches[1].args[2].env, h.context.childEnvironment)
      assert.equal(h.launches[2].args[2].env, h.context.childEnvironment)
      h.close(h.children[1]); h.close(h.children[2])
    }
  })
}

for (const child of [1, 2]) {
  test(`partial raw setup plus child ${child} spawn error still joins actual close`, async () => {
    const h = await controllerHarness({ child, stream: "stderr" })
    let done = false, error: unknown
    const running = h.parallelHelpers(true).then(() => { done = true }, value => { done = true; error = value })
    assert.equal(h.children.length, 2)
    h.children[child - 1].emit("error", Error("CONTROLLED_SECONDARY_SPAWN_ERROR"))
    await h.turn(); h.close(h.children[child === 1 ? 1 : 0]); await h.turn()
    const beforeFaultClose = { done, ...h.facts() }
    h.close(h.children[child - 1], -1); await running; await h.turn()
    assert.equal(beforeFaultClose.done, false); assert.equal(beforeFaultClose.settled, 0)
    assert.equal(h.facts().openDescriptors, 0); assert.equal(h.facts().settled, 1)
    assert.equal(error, h.original, "secondary spawn error cannot overwrite the raw setup refusal")
  })
}

for (const child of [1, 2]) for (const stream of ["stdout", "stderr"] as const) for (const listener of [false, true]) {
  test(`late abort after partial ${child}/${stream}/${listener ? "listener" : "open"} setup still stops both owned children`, async () => {
    const h = await controllerHarness({ child, stream, listener })
    let done = false, error: unknown
    const running = h.parallelHelpers(true).then(() => { done = true }, value => { done = true; error = value })
    await h.turn(); assert.equal(h.children.length, 2)
    h.abort.abort(h.reason); await h.turn()
    const afterAbort = { done, ...h.facts() }
    h.close(h.children[child === 1 ? 1 : 0]); await h.turn()
    const beforeFaultClose = { done, ...h.facts() }
    h.close(h.children[child - 1]); await running; await h.turn()
    assert.equal(afterAbort.killed, 2, "late abort must reach the child already awaiting close")
    assert.equal(afterAbort.done, false); assert.equal(beforeFaultClose.done, false)
    assert.equal(beforeFaultClose.settled, 0)
    assert.equal(h.facts().openDescriptors, 0); assert.equal(h.facts().settled, 1)
    assert.equal(error, child === 1 ? h.original : h.reason, "host original reason keeps priority")
  })
}
for (const child of [1, 2]) {
  test(`late abort after partial child ${child} setup preserves failure even if kill throws`, async () => {
    const h = await controllerHarness({ child, stream: "stderr" })
    let done = false, error: unknown
    const running = h.parallelHelpers(true).then(() => { done = true }, value => { done = true; error = value })
    await h.turn()
    const target = h.children[child - 1], kill = target.kill
    target.kill = () => { kill(); throw Error("CONTROLLED_KILL_REFUSAL") }
    h.abort.abort(h.reason); await h.turn()
    const beforeClose = { done, ...h.facts() }
    h.close(h.children[0]); h.close(h.children[1]); await running; await h.turn()
    assert.equal(beforeClose.killed, 2); assert.equal(beforeClose.done, false); assert.equal(beforeClose.settled, 0)
    assert.equal(h.facts().openDescriptors, 0); assert.equal(h.facts().settled, 1); assert.equal(error, child === 1 ? h.original : h.reason, "host original reason keeps priority")
  })
}

test("actual runPs parallel fixture abort joins both closes before lease retirement", async t => {
  const h = await controllerHarness()
  let done = false, result: unknown
  const running = h.parallelHelpers(true).then(() => { done = true }, value => { result = value; done = true })
  assert.equal(h.children.length, 2)
  h.abort.abort(h.reason); await h.turn()
  const beforeClose = { ...h.facts(), done }
  h.close(h.children[1]); await h.turn(); assert.equal(done, false)
  h.close(h.children[0]); await running; await h.turn()
  t.diagnostic(JSON.stringify({ beforeClose, descriptorsAfterClose: h.facts().closedDescriptors }))
  assert.equal(beforeClose.killed, 2)
  assert.equal(beforeClose.done, false); assert.equal(beforeClose.closedDescriptors, 0); assert.equal(beforeClose.openDescriptors, 4)
  assert.equal(result, h.reason); assert.equal(h.facts().settled, 1); assert.equal(h.facts().closedDescriptors, 4)
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
