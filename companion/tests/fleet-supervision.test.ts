import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { superviseFleet } from "../src/orchestrator/fleet-supervision"
import type { ThreadManager as Manager } from "../src/threads/thread-manager"

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-fleet-supervision-"))
let ThreadManager: typeof Manager
before(async () => {
  process.env.HOME = temp; process.env.CMSPARK_DATA_DIR = temp
  await (await import("../src/config")).initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
})
after(() => fs.rmSync(temp, { recursive: true, force: true }))

function fleet() {
  const tm = new ThreadManager()
  const p = tm.create("parent")
  tm.update(p.id, { agent_role: "orchestrator", orchestrator_run_id: p.id })
  const w = tm.create("worker")
  tm.update(w.id, { agent_role: "worker", parent_thread_id: p.id, orchestrator_run_id: p.id })
  const calls: string[] = []
  return { tm, p, w, calls, opts: { tm, parentId: p.id, isActive: () => false,
    collect: async (id: string) => { calls.push(id); return { success: true, data: { last_assistant: { content: "report" } } } }, pollMs: 1, timeoutMs: 100 } }
}

test("finished/failed workers are actually collected once per terminal version, with ownership isolation", async () => {
  const { tm, p, w, calls, opts } = fleet()
  tm.update(w.id, { last_run_ended_at: "one", last_run_terminal: "circuit_breaker" })
  const foreign = tm.create("foreign")
  tm.update(foreign.id, { agent_role: "worker", parent_thread_id: "elsewhere", orchestrator_run_id: p.id })
  const first = await superviseFleet(opts)
  assert.equal(first[0].status, "circuit_breaker")
  assert.deepEqual(calls, [w.id])
  assert.deepEqual(await superviseFleet(opts), [])
  tm.update(w.id, { last_run_ended_at: "two", last_run_terminal: null })
  assert.equal((await superviseFleet(opts))[0].status, "completed")
})

test("queued/live worker is awaited without a model poll; collection happens after actual end", async () => {
  const { tm, w, calls, opts } = fleet()
  let active = true; let waits = 0
  const timer = setTimeout(() => { tm.update(w.id, { last_run_ended_at: "done", last_run_terminal: null }); active = false }, 10)
  const result = await superviseFleet({ ...opts, isActive: () => active, onWait: () => { waits++; assert.equal(calls.length, 0) } })
  clearTimeout(timer)
  assert.equal(waits, 1)
  assert.equal(result[0].status, "completed")
  assert.deepEqual(calls, [w.id])
})

test("paused/unstarted and timed-out tasks are not restarted or falsely completed", async () => {
  const { tm, w, calls, opts } = fleet()
  tm.update(w.id, { paused: true })
  assert.equal((await superviseFleet({ ...opts, isActive: () => true }))[0].status, "paused")
  tm.update(w.id, { paused: false })
  assert.equal((await superviseFleet(opts))[0].status, "not_started")
  calls.length = 0
  const reportedTimeouts = new Set<string>()
  const timed = { ...opts, isActive: () => true, timeoutMs: 1, reportedTimeouts }
  assert.equal((await superviseFleet(timed))[0].status, "waiting_timeout")
  assert.equal(calls.length, 0)
  assert.deepEqual(await superviseFleet(timed), [])
})

test("user cancellation stops wait promptly and cannot collect/retry after abort", async () => {
  const { calls, opts } = fleet()
  const controller = new AbortController()
  await assert.rejects(superviseFleet({ ...opts, signal: controller.signal, isActive: () => true,
    onWait: () => controller.abort() }), { name: "AbortError" })
  assert.equal(calls.length, 0)
})

test("failed collection is delivered as a failure instead of silently ending parent", async () => {
  const { opts } = fleet()
  const result = await superviseFleet({ ...opts, collect: async () => { throw new Error("transport closed") } })
  assert.deepEqual(result[0].handback, { success: false, error: "transport closed" })
})

test("normal terminal cannot turn an empty or partial handback into completed work", async () => {
  for (const [data, expected] of [[{ last_assistant: null }, "empty_report"],
    [{ partial: true, last_assistant: { content: "draft" } }, "partial_report"]] as const) {
    const { tm, w, opts } = fleet()
    tm.update(w.id, { last_run_ended_at: "end", last_run_terminal: null })
    const report = await superviseFleet({ ...opts, collect: async () => ({ success: true, data }) })
    assert.equal(report[0].status, expected)
    assert.ok(report[0].recovery)
  }
})
