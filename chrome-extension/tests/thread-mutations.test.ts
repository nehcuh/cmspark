import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { createThreadMutator, isManagedThreadMutationReply } from "../src/sidepanel/utils/thread-mutations"
import { recordedThreadMutationResponses as recorded } from "./fixtures/thread-mutation-responses"
declare const __dirname: string

function harness(timeout = 100) {
  const listeners = new Set<(message: any) => void>()
  const calls: Array<{ request: any; ack: (value: any) => void }> = []
  const runtime = {
    onMessage: { addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn) },
    sendMessage: (request: any, ack: any) => { calls.push({ request, ack }) },
    lastError: undefined as { message: string } | undefined,
  }
  const emit = (message: any) => { for (const fn of [...listeners]) fn(message) }
  return { calls, listeners, runtime, emit, mutate: createThreadMutator(runtime as any, timeout) }
}

// Scale the recorded production shape to requested synthetic IDs, keeping real
// field names and counters (restore intentionally has neither mode nor ok).
function success(request: any) {
  const restoring = request.type === "thread.restore"
  const value: any = structuredClone(recorded[restoring ? "restore" : request.mode as "trash" | "hard"])
  value.id = request.id
  value.failed = []
  if (restoring) { value.restored = request.thread_ids; value.restored_count = request.thread_ids.length }
  else { value.ok = request.thread_ids; value.deleted_ids = request.thread_ids; value.deleted_count = request.thread_ids.length }
  return value
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

for (const mode of ["trash", "hard", "restore"] as const) {
  test(`${mode}: exact recorded durable response, ACK alone never commits`, async () => {
    const h = harness()
    let done = false
    const pending = h.mutate(["fixture-a", "fixture-b", "fixture-missing"], mode, new AbortController().signal).then(r => { done = true; return r })
    const { request, ack } = h.calls[0]
    assert.equal(request.require_connected, true)
    ack({ id: request.id, ok: true })
    await tick()
    assert.equal(done, false)
    h.emit({ ...recorded[mode], id: "other-request" })
    assert.equal(done, false)
    h.emit({ ...recorded[mode], id: request.id })
    const result = await pending
    assert.deepEqual(result, { ok: ["fixture-a", "fixture-b"], failed: [{ id: "fixture-missing", reason: "not_found" }] })
    assert.equal(h.listeners.size, 0)
    if (mode === "restore") { assert.equal("mode" in recorded.restore, false); assert.equal("ok" in recorded.restore, false) }
  })
}

test("51+ IDs use serial batches of 50, preserving partial failures and exact successes", async () => {
  const h = harness()
  const ids = Array.from({ length: 102 }, (_, i) => `t${i}`)
  const pending = h.mutate(ids, "trash", new AbortController().signal)
  assert.equal(h.calls.length, 1)
  const first = success(h.calls[0].request)
  first.ok = first.ok.slice(1); first.deleted_ids = first.ok; first.deleted_count--
  first.failed = [{ id: "t0", reason: "thread_busy" }]
  h.emit(first)
  await tick()
  assert.equal(h.calls.length, 2)
  h.emit(success(h.calls[1].request))
  await tick()
  h.emit(success(h.calls[2].request))
  const result = await pending
  assert.deepEqual(h.calls.map(c => c.request.thread_ids.length), [50, 50, 2])
  assert.equal(new Set(h.calls.map(c => c.request.id)).size, 3)
  assert.deepEqual(result.ok, ids.slice(1))
  assert.deepEqual(result.failed, [{ id: "t0", reason: "thread_busy" }])
  assert.equal(h.listeners.size, 0)
})

test("empty cleanup uses bounded hard requests with only_empty and never expands targets", async () => {
  const h = harness()
  const ids = Array.from({ length: 51 }, (_, i) => `empty-${i}`)
  const pending = h.mutate(ids, "empty", new AbortController().signal)
  assert.deepEqual(h.calls[0].request.thread_ids, [])
  assert.equal(h.calls[0].request.probe, "only_empty")
  h.emit({ ...recorded.capabilities, id: h.calls[0].request.id })
  await tick()
  assert.equal(h.calls[1].request.mode, "hard")
  assert.equal(h.calls[1].request.only_empty, true)
  h.emit(success(h.calls[1].request))
  await tick()
  assert.equal(h.calls[2].request.only_empty, true)
  h.emit(success(h.calls[2].request))
  assert.deepEqual((await pending).ok, ids)
  assert.deepEqual(h.calls.flatMap(c => c.request.thread_ids), ids)
  assert.equal(h.listeners.size, 0)
})

for (const failure of ["old-server", "missing-id", "wrong-shape", "disconnect"] as const) {
  test(`empty probe ${failure} never sends mutation targets`, async () => {
    const h = harness(15)
    const pending = h.mutate(["valuable"], "empty", new AbortController().signal)
    const { request } = h.calls[0]
    if (failure === "old-server") h.emit({ type: "error", id: request.id, error: "thread.batch_delete requires non-empty thread_ids" })
    if (failure === "missing-id") h.emit(recorded.capabilities)
    if (failure === "wrong-shape") h.emit({ ...recorded.capabilities, only_empty: false, id: request.id })
    if (failure === "disconnect") h.emit({ type: "thread.mutation.connection", state: "disconnected" })
    const result = await pending
    assert.deepEqual(result.ok, [])
    assert.equal(result.failed[0].reason, failure === "disconnect" ? "not_sent" : "not_sent_unsupported")
    assert.equal(h.calls.length, 1)
    assert.deepEqual(request.thread_ids, [])
    assert.equal(h.listeners.size, 0)
  })
}

test("connection loss immediately after probe invalidates capability before any deletion", async () => {
  const h = harness()
  const pending = h.mutate(["keep"], "empty", new AbortController().signal)
  h.emit({ ...recorded.capabilities, id: h.calls[0].request.id })
  h.emit({ type: "thread.mutation.connection", state: "disconnected" })
  h.emit({ type: "thread.mutation.connection", state: "connected" })
  assert.deepEqual(await pending, { ok: [], failed: [{ id: "keep", reason: "not_sent" }] })
  assert.equal(h.calls.length, 1)
  assert.equal(h.listeners.size, 0)
})

for (const defect of ["mode", "duplicate", "unrequested", "omitted", "wrong-type", "counter"] as const) {
  test(`reject ${defect} result without claiming any successful mutation`, async () => {
    const h = harness()
    const pending = h.mutate(["a", "b"], "hard", new AbortController().signal)
    const value = success(h.calls[0].request)
    if (defect === "mode") value.mode = "trash"
    if (defect === "duplicate") value.ok = ["a", "a"]
    if (defect === "unrequested") value.ok = ["a", "other"]
    if (defect === "omitted") value.ok = ["a"]
    if (defect === "wrong-type") value.type = "thread.restored"
    if (defect === "counter") value.deleted_count = 1
    h.emit(value)
    const result = await pending
    assert.deepEqual(result.ok, [])
    assert.ok(result.failed.every(f => f.reason === "unknown_invalid_response"))
    assert.equal(h.listeners.size, 0)
  })
}

test("wrong ACK id is uncertain; definite not-sent ACK stops remaining batches", async () => {
  for (const wrongId of [true, false]) {
    const h = harness()
    const ids = Array.from({ length: 51 }, (_, i) => String(i))
    const pending = h.mutate(ids, "hard", new AbortController().signal)
    h.calls[0].ack({ id: wrongId ? "wrong" : h.calls[0].request.id, ok: false })
    const result = await pending
    assert.equal(result.failed[0].reason, wrongId ? "unknown_transport" : "not_sent")
    assert.equal(result.failed[50].reason, "not_sent")
    assert.equal(h.calls.length, 1)
    assert.equal(h.listeners.size, 0)
  }
})

test("timeout after a successful batch keeps successes, stops remainder, and ignores late response", async () => {
  const h = harness(15)
  const ids = Array.from({ length: 101 }, (_, i) => String(i))
  const pending = h.mutate(ids, "hard", new AbortController().signal)
  h.emit(success(h.calls[0].request))
  const result = await pending
  assert.deepEqual(result.ok, ids.slice(0, 50))
  assert.equal(result.failed[0].reason, "unknown_timeout")
  assert.equal(result.failed[50].reason, "not_sent")
  assert.equal(h.calls.length, 2)
  h.emit(success(h.calls[1].request))
  assert.equal(result.ok.length, 50)
  assert.equal(h.listeners.size, 0)
})

test("abort before send is not_sent; abort in flight is unknown and listeners are removed", async () => {
  for (const before of [true, false]) {
    const h = harness()
    const controller = new AbortController()
    if (before) controller.abort()
    const pending = h.mutate(["a"], "trash", controller.signal)
    if (!before) controller.abort()
    const result = await pending
    assert.equal(result.failed[0].reason, before ? "not_sent" : "unknown_aborted")
    assert.equal(h.calls.length, before ? 0 : 1)
    assert.equal(h.listeners.size, 0)
  }
})

test("disconnect and runtime channel loss are uncertain, without retry", async () => {
  for (const channelLoss of [false, true]) {
    const h = harness()
    const pending = h.mutate(["a"], "restore", new AbortController().signal)
    if (channelLoss) {
      h.runtime.lastError = { message: "channel closed" }
      h.calls[0].ack(undefined)
    } else h.emit({ type: "thread.mutation.connection", state: "disconnected" })
    assert.equal((await pending).failed[0].reason, channelLoss ? "unknown_transport" : "unknown_disconnected")
    assert.equal(h.calls.length, 1)
    assert.equal(h.listeners.size, 0)
  }
})

test("server response can beat runtime ACK; late ACK/duplicate do not overwrite committed result", async () => {
  const h = harness()
  const pending = h.mutate(["a", "a"], "trash", new AbortController().signal)
  assert.deepEqual(h.calls[0].request.thread_ids, ["a"])
  h.emit(success(h.calls[0].request))
  h.calls[0].ack({ id: h.calls[0].request.id, ok: false })
  h.emit(success(h.calls[0].request))
  assert.deepEqual(await pending, { ok: ["a"], failed: [] })
  assert.equal(h.listeners.size, 0)
})

test("managed restore identity is explicit; legacy restore keeps its normal refresh behavior", () => {
  assert.equal(isManagedThreadMutationReply({ id: "thread-mutation:123" }), true)
  assert.equal(isManagedThreadMutationReply({ id: "legacy" }), false)
  assert.equal(isManagedThreadMutationReply({}), false)
})

test("actual background mutation branches reject disconnected/handshaking without buffering, retain correlation", () => {
  const srcPath = [path.join(__dirname, "../src/background/index.ts"), path.join(__dirname, "../../src/background/index.ts")].find(p => fs.existsSync(p))!
  const source = fs.readFileSync(srcPath, "utf8")
  const start = source.indexOf('      case "thread.delete":')
  const end = source.indexOf('      case "thread.suggest_cleanup":', start)
  const code = `(function(){switch(message.type){${source.slice(start, end)}}})()`
  for (const type of ["thread.delete", "thread.batch_delete", "thread.restore"]) {
    for (const state of ["disconnected", "connecting", "connected"]) {
      for (const sent of [true, false]) {
        const calls: any[] = []; let ack: any
        vm.runInNewContext(code, {
          message: { type, id: "request", thread_ids: ["a"], thread_id: "a", require_connected: true, mode: "hard", only_empty: true },
          wsClient: { getState: () => state, send: (message: any) => { calls.push(message); return sent } },
          sendResponse: (value: any) => { ack = value },
        })
        assert.equal(calls.length, state === "connected" ? 1 : 0)
        assert.equal(ack.id, "request")
        assert.equal(ack.ok, state === "connected" && sent)
        if (calls.length) {
          assert.equal(calls[0].id, "request")
          if (type === "thread.batch_delete") assert.equal(calls[0].only_empty, true)
        }
      }
    }
  }
})
