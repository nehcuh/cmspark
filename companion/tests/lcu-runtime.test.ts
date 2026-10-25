import test from "node:test"
import assert from "node:assert/strict"
import { LcuRuntime, type LcuRunOwner, type LcuRuntimeConfig } from "../src/computer/lcu/runtime"
import { projectLcuStatus } from "../src/computer/lcu/contract"
import type { LcuCommandIdentity, LcuProbe } from "../src/computer/lcu/discovery"
import { upstreamStatus } from "./fixtures/lcu-v0.13.0/producer"
import { mcpFixture, deferred } from "./fixtures/lcu-v0.13.0/mcp"

const identity: LcuCommandIdentity = { command: "/owned/bin/lcu", realPath: "/owned/release/bin/lcu", dev: 1, ino: 2, size: 3, mtimeMs: 4 }
const owner = (id: string, patch: Partial<LcuRunOwner> = {}): LcuRunOwner => ({ threadId: `thread-${id}`, runId: `run-${id}`, current: () => true, confirmTool: async () => true, confirmApp: async () => true, ...patch })
const checked = async (): Promise<LcuProbe> => ({ status: "checked", identity, observed: projectLcuStatus(await upstreamStatus())! })

test("disabled runtime performs no status execution or transport creation", async () => {
  let inspected = 0, transports = 0
  const runtime = new LcuRuntime({ config: () => ({ enabled: false, coordinateEnabled: true }), inspect: async () => { inspected++; return checked() }, identity: async () => identity, transport: () => { transports++; throw new Error("unreachable") }, tasks: new Map() })
  await assert.rejects(runtime.open(owner("one")), /LCU_DISABLED_OR_REVOKED/)
  assert.equal(inspected, 0); assert.equal(transports, 0)
  assert.deepEqual(runtime.state, { activeRuns: 0, pendingRuns: 0, cleanupUnknown: false })
})

test("two genuine runs retain separate upstream sessions and only one can own native input at a time", async t => {
  const firstStarted = deferred<void>(), firstRelease = deferred<void>()
  const fixtures = await Promise.all([mcpFixture({ onCall: async params => { if (params.name === "js") { firstStarted.resolve(); await firstRelease.promise; return { content: [{ type: "text", text: "first result" }] } } } }), mcpFixture()])
  const tasks = new Map<string, boolean>(), queue = [...fixtures], probe = await checked()
  const runtime = new LcuRuntime({ config: () => ({ enabled: true, coordinateEnabled: true }), inspect: async () => probe, identity: async () => identity, transport: () => queue.shift()!.transport, tasks })
  const a = await runtime.open(owner("one")), b = await runtime.open(owner("two"))
  t.after(async () => { firstRelease.resolve(); await a.finish("Interrupt"); await b.finish("Interrupt"); for (const fixture of fixtures) await fixture.close() })
  const pending = a.call("lcu_js", { code: "owned pending" }, "call-one")
  await firstStarted.promise
  assert.deepEqual([...tasks.entries()], [["run-one", false]])
  assert.deepEqual(await b.call("lcu_js", { code: "must wait" }, "call-busy"), { result: { success: false, error: "COMPUTER_TASK_BUSY" }, images: [] })
  assert.equal(fixtures[1].calls.length, 0)
  firstRelease.resolve(); assert.equal((await pending).result.success, true)
  assert.equal(tasks.size, 0)
  assert.equal((await b.call("lcu_js", { code: "second owns input" }, "call-two")).result.success, true)
  assert.deepEqual(fixtures[0].calls[0]._meta["x-codex-turn-metadata"], { session_id: "thread-one", turn_id: "run-one", call_id: "call-one" })
  assert.deepEqual(fixtures[1].calls[0]._meta["x-codex-turn-metadata"], { session_id: "thread-two", turn_id: "run-two", call_id: "call-two" })
})

test("an existing native CU task blocks LCU without deleting or replacing its owner", async t => {
  const fixture = await mcpFixture(), probe = await checked(), tasks = new Map([["legacy-task", false]])
  const runtime = new LcuRuntime({ config: () => ({ enabled: true, coordinateEnabled: true }), inspect: async () => probe, identity: async () => identity, transport: () => fixture.transport, tasks })
  const turn = await runtime.open(owner("one"))
  t.after(async () => { await turn.finish("Interrupt"); await fixture.close() })
  assert.equal((await turn.call("lcu_js", { code: "x" }, "call")).result.error, "COMPUTER_TASK_BUSY")
  assert.deepEqual([...tasks.entries()], [["legacy-task", false]])
  assert.equal(fixture.calls.length, 0)
})

test("concurrent status inspections reserve a bounded two-run capacity before awaits", async () => {
  const release = deferred<void>(), probe = await checked()
  let inspections = 0, transport = 0
  const runtime = new LcuRuntime({ config: () => ({ enabled: true, coordinateEnabled: true }), inspect: async () => { inspections++; await release.promise; return probe }, identity: async () => identity, transport: () => { transport++; throw new Error("unreachable after abort") }, tasks: new Map() })
  const a = runtime.open(owner("one")), b = runtime.open(owner("two"))
  const settled = Promise.allSettled([a, b])
  await assert.rejects(runtime.open(owner("three")), /LCU_SESSION_BUSY/)
  assert.equal(inspections, 2)
  assert.equal(runtime.state.pendingRuns, 2)
  runtime.abort("*"); release.resolve()
  assert.deepEqual((await settled).map(result => result.status), ["rejected", "rejected"])
  assert.equal(transport, 0)
  assert.equal(runtime.state.pendingRuns, 0)
})

test("installation identity changed during admission never starts a runtime transport", async () => {
  const probe = await checked(); let transports = 0
  const runtime = new LcuRuntime({ config: () => ({ enabled: true, coordinateEnabled: true }), inspect: async () => probe, identity: async () => ({ ...identity, ino: 999 }), transport: () => { transports++; throw new Error("unreachable") }, tasks: new Map() })
  await assert.rejects(runtime.open(owner("one")), /LCU_INSTALLATION_CHANGED_OR_REVOKED/)
  assert.equal(transports, 0)
})

test("configuration revocation while human confirmation is pending refuses late success", async t => {
  const fixture = await mcpFixture(), probe = await checked(), prompting = deferred<void>(), decision = deferred<boolean>()
  let config: LcuRuntimeConfig = { enabled: true, coordinateEnabled: true }
  const runtime = new LcuRuntime({ config: () => config, inspect: async () => probe, identity: async () => identity, transport: () => fixture.transport, tasks: new Map() })
  const turn = await runtime.open(owner("one", { confirmTool: async () => { prompting.resolve(); return decision.promise } }))
  t.after(async () => { decision.resolve(false); await turn.finish("Interrupt"); await fixture.close() })
  const call = turn.call("lcu_js", { code: "must not execute" }, "call")
  await prompting.promise
  config = { enabled: false, coordinateEnabled: true }; runtime.abortStale(); decision.resolve(true)
  assert.equal((await call).result.success, false)
  assert.equal(fixture.calls.filter(params => params.name === "js").length, 0)
})

test("a refused human approval does not acquire a native task slot or execute any JS", async t => {
  const fixture = await mcpFixture(), probe = await checked(), tasks = new Map<string, boolean>()
  const runtime = new LcuRuntime({ config: () => ({ enabled: true, coordinateEnabled: true }), inspect: async () => probe, identity: async () => identity, transport: () => fixture.transport, tasks })
  const turn = await runtime.open(owner("one", { confirmTool: async () => false }))
  t.after(async () => { await turn.finish("Stop"); await fixture.close() })
  assert.equal((await turn.call("lcu_js", { code: "x" }, "call")).result.error, "LCU_HUMAN_APPROVAL_REQUIRED")
  assert.equal(tasks.size, 0); assert.equal(fixture.calls.length, 0)
})

test("unknown host cleanup quarantines future runs instead of claiming completion or replaying JS", async () => {
  const fixture = await mcpFixture({ onCall: async params => params.name === "turn_ended" ? { isError: true, content: [{ type: "text", text: "owned cleanup failure" }] } : undefined }), probe = await checked()
  const runtime = new LcuRuntime({ config: () => ({ enabled: true, coordinateEnabled: true }), inspect: async () => probe, identity: async () => identity, transport: () => fixture.transport, tasks: new Map() })
  const turn = await runtime.open(owner("one"))
  assert.equal((await turn.call("lcu_js", { code: "once" }, "call")).result.success, true)
  await turn.finish("Stop")
  assert.deepEqual(runtime.state, { activeRuns: 0, pendingRuns: 0, cleanupUnknown: true })
  await assert.rejects(runtime.open(owner("two")), /LCU_SESSION_BUSY|LCU_CLEANUP_UNKNOWN/)
  assert.equal(fixture.calls.filter(params => params.name === "js").length, 1)
  await fixture.close()
})

test("a throwing observational changed callback cannot strand admission or native task ownership", async () => {
  const fixture = await mcpFixture(), probe = await checked(), tasks = new Map<string, boolean>()
  const runtime = new LcuRuntime({ config: () => ({ enabled: true, coordinateEnabled: true }), inspect: async () => probe, identity: async () => identity, transport: () => fixture.transport, tasks, changed: () => { throw new Error("observer unavailable") } })
  let turn: Awaited<ReturnType<LcuRuntime["open"]>> | undefined
  try {
    turn = await runtime.open(owner("one"))
    assert.equal((await turn.call("lcu_js", { code: "owned code" }, "call")).result.success, true)
    await turn.finish("Stop")
    assert.deepEqual(runtime.state, { activeRuns: 0, pendingRuns: 0, cleanupUnknown: false })
    assert.equal(tasks.size, 0)
  } finally { await turn?.finish("Interrupt"); await fixture.close() }
})
