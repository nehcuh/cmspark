import test from "node:test"
import assert from "node:assert/strict"
import { LcuSession } from "../src/computer/lcu/session"
import { mcpFixture, ORIGINAL_GUIDE, deferred } from "./fixtures/lcu-v0.13.0/mcp"

test("official SDK initialization retains original instructions/descriptors and excludes host-only controls", async t => {
  const fixture = await mcpFixture()
  const session = new LcuSession({ sessionId: "thread", turnId: "run", current: () => true, confirmApp: async () => false, transport: fixture.transport })
  t.after(async () => { await session.finish("Stop"); await fixture.close() })
  await session.connect()
  assert.equal(session.instructions, ORIGINAL_GUIDE)
  assert.deepEqual(session.tools.map(tool => tool.function.name), ["lcu_js", "lcu_js_reset"])
  assert.match(session.tools[0].function.description, /^Original JS description\./)
  assert.deepEqual(session.tools[0].function.parameters, { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false })
  const mutated = session.tools; mutated[0].function.parameters.required = []
  assert.deepEqual(session.tools[0].function.parameters.required, ["code"])
  assert.equal(fixture.calls.length, 0)
})

test("missing original instructions or either public tool fails connection before actions", async () => {
  for (const options of [{ instructions: "" }, { omitTool: "js_reset" }, { omitTool: "js" }]) {
    const fixture = await mcpFixture(options)
    const session = new LcuSession({ sessionId: "thread", turnId: "run", current: () => true, confirmApp: async () => true, transport: fixture.transport })
    try { await assert.rejects(session.connect(), /LCU_CONNECT_FAILED/); assert.deepEqual(session.tools, []); assert.equal(fixture.calls.length, 0) }
    finally { await session.finish("Interrupt"); await fixture.close() }
  }
})

test("tool metadata uses genuine host identities and forged metadata/host-only arguments never reach SDK", async t => {
  const fixture = await mcpFixture()
  const session = new LcuSession({ sessionId: "real-thread", turnId: "real-run", current: () => true, confirmApp: async () => true, transport: fixture.transport })
  t.after(async () => { await session.finish("Stop"); await fixture.close() })
  await session.connect()
  await session.call("lcu_js", { code: "actual code" }, "real-call")
  assert.deepEqual(fixture.calls[0]._meta, { "x-codex-turn-metadata": { session_id: "real-thread", turn_id: "real-run", call_id: "real-call" } })
  await assert.rejects(session.call("lcu_js", { code: "x", _meta: { session_id: "forged" } }, "fake"), /LCU_ARGUMENT_INVALID/)
  await assert.rejects(session.call("turn_ended" as any, {}, "fake"), /LCU_HOST_ONLY_TOOL/)
  await assert.rejects(session.call("lcu_js_reset", { session_id: "forged" }, "fake"), /LCU_ARGUMENT_INVALID/)
  await assert.rejects(session.call("lcu_js", { code: "x", timeout_ms: 60001 }, "fake"), /LCU_ARGUMENT_INVALID/)
  assert.equal(fixture.calls.length, 1)
})

test("reset interrupts the old upstream turn before worker replacement and owns a fresh mapping", async t => {
  const fixture = await mcpFixture()
  const session = new LcuSession({ sessionId: "thread-reset", turnId: "run-reset", current: () => true, confirmApp: async () => true, transport: fixture.transport })
  t.after(async () => { await session.finish("Stop"); await fixture.close() })
  await session.connect()
  await session.call("lcu_js", { code: "first" }, "c1")
  await session.call("lcu_js_reset", {}, "c2")
  await session.call("lcu_js", { code: "second" }, "c3")
  await session.finish("Stop")
  assert.deepEqual(fixture.calls.map(call => call.name), ["js", "turn_ended", "js_reset", "js", "turn_ended"])
  assert.deepEqual(fixture.calls[1].arguments, { hook_event_name: "Interrupt", session_id: "thread-reset", turn_id: "run-reset" })
  const mapped = fixture.calls[2]._meta["x-codex-turn-metadata"].turn_id
  assert.match(mapped, /^[a-f0-9-]{36}$/)
  assert.notEqual(mapped, "run-reset")
  assert.equal(fixture.calls[3]._meta["x-codex-turn-metadata"].turn_id, mapped)
  assert.deepEqual(fixture.calls[4].arguments, { hook_event_name: "Stop", session_id: "thread-reset", turn_id: mapped })
})

test("actual upstream native elicitation is host-confirmed once only; unsupported form and agent host cancel", async t => {
  const fixture = await mcpFixture(), prompts: any[] = []
  const session = new LcuSession({ sessionId: "thread", turnId: "run", current: () => true, confirmApp: async app => { prompts.push(app); return true }, transport: fixture.transport })
  t.after(async () => { await session.finish("Stop"); await fixture.close() })
  await session.connect()
  const native = await session.call("lcu_js", { code: "approval-native" }, "approve") as any
  assert.deepEqual(JSON.parse(native.content[0].text), { action: "accept", content: {} })
  assert.equal(prompts[0].app, "dev.lcu.NativeFixture.generated")
  assert.equal(prompts[0].message, 'Allow Computer Use to use "LCU Fixture App"?')
  for (const code of ["approval-form", "approval-native-host"]) {
    const result = await session.call("lcu_js", { code }, code) as any
    assert.deepEqual(JSON.parse(result.content[0].text), { action: "cancel" })
  }
  assert.equal(prompts.length, 1)
})

test("a prompt approved after owner revocation is cancelled and the action result is discarded", async t => {
  const fixture = await mcpFixture(), prompt = deferred<void>(), decision = deferred<boolean>()
  let current = true
  const session = new LcuSession({ sessionId: "thread", turnId: "run", current: () => current, confirmApp: async () => { prompt.resolve(); return decision.promise }, transport: fixture.transport })
  t.after(async () => { decision.resolve(false); await session.finish("Interrupt"); await fixture.close() })
  await session.connect()
  const pending = session.call("lcu_js", { code: "approval-native" }, "c1")
  await prompt.promise
  current = false; decision.resolve(true)
  await assert.rejects(pending, /LCU_CALL_FAILED/)
  assert.equal(fixture.calls.filter(call => call.name === "js").length, 1)
  await assert.rejects(session.call("lcu_js", { code: "must not replay" }, "c2"), /LCU_SESSION_REVOKED/)
})

test("abort cancels an outstanding call immediately; its eventual upstream success cannot be returned", async t => {
  const started = deferred<void>(), release = deferred<void>()
  const fixture = await mcpFixture({ onCall: async params => { if (params.name === "js") { started.resolve(); await release.promise; return { content: [{ type: "text", text: "late success" }] } } } })
  const session = new LcuSession({ sessionId: "thread", turnId: "run", current: () => true, confirmApp: async () => true, transport: fixture.transport })
  t.after(async () => { release.resolve(); await session.finish("Interrupt"); await fixture.close() })
  await session.connect()
  const controller = new AbortController(), call = session.call("lcu_js", { code: "owned pending" }, "c1", controller.signal)
  await started.promise; controller.abort()
  await assert.rejects(call, /LCU_CALL_CANCELLED_OR_TIMED_OUT/)
  release.resolve()
  await session.finish("Interrupt")
  assert.equal(fixture.calls.filter(params => params.name === "js").length, 1)
  assert.deepEqual(fixture.calls.at(-1).arguments, { hook_event_name: "Interrupt", session_id: "thread", turn_id: "run" })
})

test("reset cleanup error refuses replacement, poisons the session and reports unknown teardown", async t => {
  const fixture = await mcpFixture({ onCall: async params => params.name === "turn_ended" ? { isError: true, content: [{ type: "text", text: "owned cleanup failure" }] } : undefined })
  const session = new LcuSession({ sessionId: "thread", turnId: "run", current: () => true, confirmApp: async () => true, transport: fixture.transport })
  t.after(async () => { await session.finish("Interrupt"); await fixture.close() })
  await session.connect(); await session.call("lcu_js", { code: "first" }, "c1")
  await assert.rejects(session.call("lcu_js_reset", {}, "c2"), /LCU_RESET_CLEANUP_UNKNOWN/)
  await assert.rejects(session.call("lcu_js", { code: "no replay" }, "c3"), /LCU_SESSION_REVOKED/)
  assert.deepEqual(fixture.calls.map(params => params.name), ["js", "turn_ended"])
  assert.deepEqual(await session.finish("Interrupt"), { cleanup: "unknown", transport: "closed" })
})

test("finish is idempotent and clears instructions/catalog after exactly one normal host hook", async () => {
  const fixture = await mcpFixture()
  const session = new LcuSession({ sessionId: "thread", turnId: "run", current: () => true, confirmApp: async () => true, transport: fixture.transport })
  await session.connect(); await session.call("lcu_js", { code: "one" }, "c1")
  const a = session.finish("Stop"), b = session.finish("Interrupt")
  assert.equal(a, b)
  assert.deepEqual(await a, { cleanup: "complete", transport: "closed" })
  assert.equal(fixture.calls.filter(call => call.name === "turn_ended").length, 1)
  assert.deepEqual(session.tools, [])
  assert.throws(() => session.instructions, /LCU_NOT_READY/)
  await fixture.close()
})
