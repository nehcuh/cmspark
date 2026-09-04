// #290: orphan CONNECTING socket must never be dropped without close(), and
// stale socket handlers (onclose/onmessage/challenge reply) must never
// crosstalk with the new connection after a reconnect.

import test from "node:test"
import assert from "node:assert/strict"
import { WSClient } from "../src/background/ws-client"

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  sent: string[] = []
  closeCalls = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  close() {
    this.closeCalls++
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    // Real sockets deliver onclose asynchronously.
    queueMicrotask(() => this.onclose?.())
  }

  send(data: string) {
    this.sent.push(data)
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

function installGlobals(secret: string | null = "deadbeef") {
  MockWebSocket.instances = []
  ;(globalThis as any).WebSocket = MockWebSocket
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        get(_keys: string[], cb: (result: Record<string, string>) => void) {
          cb(secret ? { wsSharedSecret: secret } : {})
        },
        set(_kv: object, cb?: () => void) {
          cb?.()
        },
      },
    },
    alarms: {
      create() {},
      clear() {},
    },
  }
}

function makeClient() {
  const states: string[] = []
  const client = new WSClient({
    url: "ws://127.0.0.1:8787/ws",
    onMessage: () => {},
    onStateChange: (s) => states.push(s),
  })
  return { client, states }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

test("checkAndReconnect treats a CONNECTING socket as alive: no close, no new socket", () => {
  installGlobals()
  const { client } = makeClient()
  client.connect()
  const s1 = MockWebSocket.instances[0]
  assert.equal(s1.readyState, MockWebSocket.CONNECTING)

  client.checkAndReconnect()

  // The CONNECTING socket is a live connection-in-progress. It must NOT be
  // discarded — and if it ever is discarded, it must be closed first. What is
  // forbidden is "null it out without close()".
  assert.equal(s1.closeCalls, 0, "live CONNECTING socket must not be closed")
  assert.equal(
    MockWebSocket.instances.length,
    1,
    "live CONNECTING socket must not be replaced by a new socket",
  )
  assert.equal(client.getDiag().readyState, MockWebSocket.CONNECTING)
})

test("stale onclose from a replaced socket does not tear down the new connection", async () => {
  installGlobals()
  const { client } = makeClient()
  client.connect()
  const s1 = MockWebSocket.instances[0]
  s1.simulateOpen()

  client.forceReconnect()
  assert.equal(MockWebSocket.instances.length, 2)
  const s2 = MockWebSocket.instances[1]

  // s1's queued onclose now fires — it is stale and must be ignored.
  await flush()

  assert.equal(s1.closeCalls, 1, "forceReconnect closes before discarding")
  assert.equal(
    client.getDiag().readyState,
    s2.readyState,
    "new socket must survive the stale onclose",
  )
  assert.notStrictEqual(client.getState(), "disconnected")
})

test("challenge reply is never sent after the challenged socket was replaced", async () => {
  installGlobals()
  const { client } = makeClient()
  client.connect()
  const s1 = MockWebSocket.instances[0]
  s1.simulateOpen()
  s1.simulateMessage({ type: "auth.challenge", nonce: "nonce-for-s1" })

  // Worker suspends mid-handshake; user (or wake path) forces a new socket
  // before the async HMAC continuation runs.
  client.forceReconnect()
  const s2 = MockWebSocket.instances[1]
  s2.simulateOpen()

  await flush()
  await flush()

  assert.deepEqual(s1.sent, [], "orphan socket must not receive the proof")
  assert.deepEqual(
    s2.sent,
    [],
    "new socket must not receive a proof for the orphan's nonce",
  )
})

test("checkAndReconnect closes a dead socket before discarding it", async () => {
  installGlobals()
  const { client } = makeClient()
  client.connect()
  const s1 = MockWebSocket.instances[0]
  s1.simulateOpen()
  // Server-initiated close while the worker was suspended: readyState moved
  // on but the onclose event never fired.
  s1.readyState = MockWebSocket.CLOSING

  client.checkAndReconnect()

  assert.equal(s1.closeCalls, 1, "discard path must close() before null (#290)")
  assert.equal(MockWebSocket.instances.length, 2, "dead socket is replaced")
  await flush()
  // The late onclose from s1 is stale: it must not kill the new socket.
  assert.equal(client.getDiag().readyState, MockWebSocket.instances[1].readyState)
})
