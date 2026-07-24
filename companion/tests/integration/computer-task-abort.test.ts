// Integration test: F1 — the computer.task.abort WS handler, extracted from
// the server.ts message dispatch (WP2 §E.6), driven at the REAL socket
// boundary with the REAL registry (seeded via getComputerTaskRegistryForTests).
//
// Covered:
//   ① specific task_id flips ONLY that task's abort flag; ack reports matched 1
//   ② "*" panic flips EVERY running task's flag; ack reports the count
//   ③ unknown / non-string / missing task_id matches nothing (matched 0) —
//     the ack is still sent (the panel learns its stop targeted nothing)
//   ④ WS seam: when the socket is already CLOSED at the boundary the abort
//     STILL takes effect (the flag flip is unconditional — stopping injection
//     is the safe direction) and the handler neither throws nor acks.

import "./_security-gates-setup.js"
import test, { afterEach, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { WebSocketServer, WebSocket } from "ws"

import { getComputerTaskRegistryForTests, handleComputerTaskAbort } from "../../src/server.js"

let wss: WebSocketServer
let serverWs: WebSocket
let clientWs: WebSocket
let recv: any[]

beforeEach(async () => {
  recv = []
  getComputerTaskRegistryForTests().clear()
  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => resolve())
  })
  const port = (wss.address() as { port: number }).port
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("client connect timeout")), 2000)
    wss.once("connection", (ws) => {
      clearTimeout(timeout)
      serverWs = ws
      ws.on("error", () => { /* expected during teardown */ })
      resolve()
    })
    clientWs = new WebSocket(`ws://127.0.0.1:${port}`)
    clientWs.on("error", () => { /* expected during teardown */ })
    clientWs.on("message", (raw) => { try { recv.push(JSON.parse(raw.toString())) } catch { /* */ } })
  })
})

afterEach(async () => {
  getComputerTaskRegistryForTests().clear()
  const safeTerminate = (ws: WebSocket | undefined) => { try { (ws as any)?.terminate?.() } catch { /* */ } }
  safeTerminate(clientWs)
  safeTerminate(serverWs)
  try { wss?.clients.forEach((c) => safeTerminate(c)) } catch { /* */ }
  await new Promise<void>((resolve) => {
    try { wss?.close(() => resolve()) } catch { resolve() }
  })
})

/** Let any pending sends flush to the client. */
async function settle(ms = 300): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

test("F1: specific task_id aborts ONLY that run; ack matched 1 reaches the panel", async () => {
  const registry = getComputerTaskRegistryForTests()
  registry.set("task-a", false)
  registry.set("task-b", false)
  const ack = handleComputerTaskAbort(serverWs, { task_id: "task-a" })
  assert.deepEqual(ack, { taskId: "task-a", matched: 1 })
  assert.equal(registry.get("task-a"), true, "targeted run flagged")
  assert.equal(registry.get("task-b"), false, "the other run is NOT disturbed")
  await settle()
  const wire = recv.filter((m) => m.type === "computer.task.abort.ack")
  assert.equal(wire.length, 1)
  assert.equal(wire[0].task_id, "task-a")
  assert.equal(wire[0].matched, 1)
})

test("F1: \"*\" panic aborts EVERY running task; ack reports the count", async () => {
  const registry = getComputerTaskRegistryForTests()
  registry.set("task-a", false)
  registry.set("task-b", false)
  const ack = handleComputerTaskAbort(serverWs, { task_id: "*" })
  assert.deepEqual(ack, { taskId: "*", matched: 2 })
  assert.equal(registry.get("task-a"), true)
  assert.equal(registry.get("task-b"), true)
  await settle()
  const wire = recv.filter((m) => m.type === "computer.task.abort.ack")
  assert.equal(wire.length, 1)
  assert.equal(wire[0].task_id, "*")
  assert.equal(wire[0].matched, 2)
})

test("F1: unknown / non-string / missing task_id matches nothing — ack still sent (matched 0)", async () => {
  const registry = getComputerTaskRegistryForTests()
  registry.set("task-a", false)
  assert.deepEqual(handleComputerTaskAbort(serverWs, { task_id: "nope" }), { taskId: "nope", matched: 0 })
  assert.deepEqual(handleComputerTaskAbort(serverWs, { task_id: 42 }), { taskId: "", matched: 0 })
  assert.deepEqual(handleComputerTaskAbort(serverWs, {}), { taskId: "", matched: 0 })
  assert.equal(registry.get("task-a"), false, "no flag flipped by a miss")
  await settle()
  const wire = recv.filter((m) => m.type === "computer.task.abort.ack")
  assert.equal(wire.length, 3, "every abort message is acked, even a miss")
  assert.ok(wire.every((m) => m.matched === 0))
})

test("F1: WS seam — socket CLOSED at the boundary: abort still takes effect, no throw, no ack", async () => {
  const registry = getComputerTaskRegistryForTests()
  registry.set("task-a", false)
  // Drive the server-side socket to CLOSED, then deliver the abort AT the seam.
  clientWs.terminate()
  await new Promise<void>((resolve) => {
    if (serverWs.readyState === WebSocket.CLOSED) return resolve()
    serverWs.once("close", () => resolve())
  })
  assert.equal(serverWs.readyState, WebSocket.CLOSED)
  const ack = handleComputerTaskAbort(serverWs, { task_id: "task-a" })
  assert.deepEqual(ack, { taskId: "task-a", matched: 1 }, "the match is computed regardless of socket state")
  assert.equal(registry.get("task-a"), true, "flag flip is unconditional — stopping injection is the safe direction")
  await settle()
  assert.equal(
    recv.filter((m) => m.type === "computer.task.abort.ack").length,
    0,
    "no ack send attempted on a closed socket",
  )
})
