// Integration test: adversary WP2 X3 — broadcastToClients filters auth state.
//
// WP2 turned outbound broadcasts sensitive: computer.task.event step events
// carry per-action desktop preview JPEGs. The inbound gate (P0-2B) rejects
// pre-handshake messages, but the outbound fan-out used to check only
// readyState — a forged-Origin localhost peer could siphon EVERY broadcast
// inside the 5s handshake window, reconnect, and keep siphoning.
//
// These tests drive the REAL broadcastToClients + REAL wsAuth registry
// (seeded via setupBroadcastAuthForTests) against real sockets: an
// authenticated panel client must keep receiving broadcasts; a
// pre-handshake connection must receive NOTHING — for the computer preview
// channel AND the older MCP channels (one shared fan-out function).

import "./_security-gates-setup.js"
import test, { afterEach, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { WebSocketServer, WebSocket } from "ws"

import {
  broadcastToClients,
  setupBroadcastAuthForTests,
} from "../../src/server.js"

let wss: WebSocketServer
let serverA: WebSocket // authenticated panel
let serverB: WebSocket // forged-origin peer, pre-handshake
let clientA: WebSocket
let clientB: WebSocket
let recvA: any[]
let recvB: any[]

beforeEach(async () => {
  recvA = []
  recvB = []
  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => resolve())
  })
  const port = (wss.address() as { port: number }).port
  const connected: WebSocket[] = []
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("client connect timeout")), 2000)
    wss.on("connection", (ws) => {
      connected.push(ws)
      ws.on("error", () => { /* expected during teardown */ })
      if (connected.length === 2) {
        clearTimeout(timeout)
        ;[serverA, serverB] = connected
        resolve()
      }
    })
    clientA = new WebSocket(`ws://127.0.0.1:${port}`)
    clientB = new WebSocket(`ws://127.0.0.1:${port}`)
    clientA.on("error", () => { /* expected during teardown */ })
    clientB.on("error", () => { /* expected during teardown */ })
    clientA.on("message", (raw) => { try { recvA.push(JSON.parse(raw.toString())) } catch { /* */ } })
    clientB.on("message", (raw) => { try { recvB.push(JSON.parse(raw.toString())) } catch { /* */ } })
  })
  // Aim the REAL broadcast path at this server: A = authenticated panel,
  // B = pre-handshake peer (wsAuth entry exists, authenticated:false — the
  // exact state of a forged-origin connection inside the handshake window).
  setupBroadcastAuthForTests(wss, [serverA], [serverB])
})

afterEach(async () => {
  setupBroadcastAuthForTests(null)
  const safeTerminate = (ws: WebSocket | undefined) => { try { (ws as any)?.terminate?.() } catch { /* */ } }
  safeTerminate(clientA)
  safeTerminate(clientB)
  try { wss?.clients.forEach((c) => safeTerminate(c)) } catch { /* */ }
  await new Promise<void>((resolve) => {
    try { wss?.close(() => resolve()) } catch { resolve() }
  })
})

/** Let any pending sends flush, then return the received lists. */
async function settle(ms = 300): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

test("X3: computer.task.event preview broadcast reaches the authenticated client ONLY", async () => {
  broadcastToClients({
    type: "computer.task.event",
    event: "step",
    taskId: "task-x3",
    seq: 1,
    action: "click",
    previewImage: { mime: "image/jpeg", base64: "ZmFrZS1qcGVn" },
  })
  await settle()
  assert.equal(recvA.length, 1, "authenticated panel receives the preview event")
  assert.equal(recvA[0]?.type, "computer.task.event")
  assert.equal(recvB.length, 0, "pre-handshake peer siphons NOTHING (no preview JPEG)")
})

test("X3: MCP-status broadcasts (shared fan-out) are filtered the same way", async () => {
  broadcastToClients({ type: "mcp.servers.updated", servers: [] })
  broadcastToClients({ type: "mcp.tool_call_finished", serverName: "s", toolName: "t", success: true })
  await settle()
  assert.equal(recvA.length, 2)
  assert.equal(recvB.length, 0, "the legacy MCP channels ride the same filtered fan-out")
})

test("X3: repeated broadcasts across the window — unauthenticated stays at zero (reconnect pattern)", async () => {
  for (let i = 0; i < 5; i++) {
    broadcastToClients({ type: "computer.task.event", event: "step", taskId: "task-x3", seq: i })
  }
  await settle()
  assert.equal(recvA.length, 5)
  assert.equal(recvB.length, 0, "every broadcast in the window is withheld, not just the first")
})
