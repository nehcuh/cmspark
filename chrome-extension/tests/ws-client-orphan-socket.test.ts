// #290: orphan CONNECTING socket must never be dropped without close(), and
// stale socket handlers (onclose/onmessage/challenge reply) must never
// crosstalk with the new connection after a reconnect.

import { readFileSync } from "node:fs"
import test from "node:test"
import assert from "node:assert/strict"
import { WSClient } from "../src/background/ws-client"
import { attachTerminalPort } from "../src/background/terminal"

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

test("socket replacement ends the old terminal even on silent wake/reconnect paths", async () => {
  for (const cause of ["close", "wake", "send", "force", "pairing"] as const) {
    installGlobals()
    Object.assign((globalThis as any).chrome.runtime = {}, {
      id: "test", getURL: () => "chrome-extension://test/tabs/embedded-terminal.html",
    })
    let onPortMessage: (message: unknown) => void = () => {}
    const delivered: any[] = []
    let relay: ReturnType<typeof attachTerminalPort>
    const options = {
      url: "ws://127.0.0.1:8787/ws", onStateChange() {}, onMessage: (msg: unknown) => relay?.handleWsFrame(msg),
      onConnectionLost: () => relay?.handleConnectionLost(),
    }
    const client = new WSClient(options)
    const port = {
      sender: { id: "test", url: "chrome-extension://test/tabs/embedded-terminal.html" },
      postMessage: (msg: unknown) => delivered.push(msg),
      onMessage: { addListener: (fn: typeof onPortMessage) => { onPortMessage = fn } },
      onDisconnect: { addListener() {} },
    }
    relay = attachTerminalPort(port as never, frame => client.send(frame), () => {})!
    client.connect()
    const old = MockWebSocket.instances[0]
    old.simulateOpen()
    old.simulateMessage({ type: "auth.ok" })
    onPortMessage({ type: "terminal.open", id: "old-pty", user_gesture: true })
    old.simulateMessage({ type: "terminal.opened", id: "old-pty", pid: 1, platform: "darwin" })
    if (cause === "close") { old.readyState = MockWebSocket.CLOSED; old.onclose?.() }
    if (cause === "wake") { old.readyState = MockWebSocket.CLOSING; client.checkAndReconnect() }
    if (cause === "send") { old.readyState = MockWebSocket.CLOSING; client.send({ type: "system.ping" }) }
    if (cause === "force") client.forceReconnect()
    if (cause === "pairing") client.setSecret("deadbeef")
    await flush()
    assert.equal(delivered.at(-1)?.code, "disconnected", cause)
    assert.equal(delivered.filter(frame => frame.code === "disconnected").length, 1, "notify once")
    if (cause === "close") client.connect()
    const current = MockWebSocket.instances.at(-1)!
    current.simulateOpen()
    current.simulateMessage({ type: "auth.ok" })
    onPortMessage({ type: "terminal.input", id: "old-pty", b64: "eA==" })
    onPortMessage({ type: "terminal.ping", id: "old-pty" })
    current.simulateMessage({ type: "terminal.heartbeat", id: "old-pty" })
    assert.deepEqual(current.sent, [], "old terminal must never send into replacement socket")
  }
})

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

test("q1 uses the actual backend response fixture, clears on auth reset, and never enters legacy pending/flush", () => {
  installGlobals(null)
  const received: any[] = []
  const client = new WSClient({ url: "ws://OWNED_NO_NETWORK", onStateChange() {}, onMessage: message => received.push(message) })
  client.connect(); const first = MockWebSocket.instances[0]; first.simulateOpen()
  const fixture = JSON.parse(readFileSync(`${process.cwd()}/tests/fixtures/meeting-pcm-responses.json`, "utf8")).responses
  const status = fixture["meeting.start"].continuous_capture, capture = status.capture_id
  const begin = { type: "meeting.start", v: 1, id: "owned-begin", meeting_id: status.meeting_id,
    queue_contract: 1, capture_id: capture, expected_capture_epoch: status.capture_epoch - 1, privacy_ack_v1: true, privacy_ack_v2: true }
  assert.equal(client.send(begin), false, "preauth q1 must not enqueue")
  assert.equal(client.getDiag().pending, 0)
  first.simulateMessage({ type: "auth.ok" })
  assert.equal(first.sent.length, 0, "auth cannot flush a q1 Begin")
  assert.equal(client.observeMeetingPcm("observed-current"), true)
  first.simulateMessage({ ...fixture.pong, id: "observed-current" })
  assert.equal(client.send(begin), true)
  first.simulateMessage({ ...fixture["meeting.start"], id: "owned-begin" })
  assert.equal(client.send({ type: "voice.stt.chunk", v: 1, id: "owned-chunk", queue_contract: 1, sessionId: capture, capture_epoch: status.capture_epoch,
    credit_id: 1, sample_offset: 0, frame_count: 1, data: "AAA=" }), true)
  first.simulateMessage({ type: "auth.failed" })
  assert.equal(received.filter(m => m.type === "thread.mutation.connection" && m.state === "disconnected").length, 1)
  assert.equal(client.send(begin), false); assert.equal(client.getDiag().pending, 0)
  first.readyState = MockWebSocket.CLOSED; client.connect()
  const replacement = MockWebSocket.instances.at(-1)!; replacement.simulateOpen(); replacement.simulateMessage({ type: "auth.ok" })
  assert.equal(replacement.sent.length, 0)
  client.observeMeetingPcm("new-current"); replacement.simulateMessage({ ...fixture.pong, id: "new-current" })
  assert.equal(client.send({ type: "voice.stt.abort", v: 1, queue_contract: 1, sessionId: capture, capture_epoch: status.capture_epoch }), false,
    "new capability does not transfer the accepted old owner")
})

test("q1 serialization completes before the final actual-socket fence", () => {
  installGlobals(null)
  const client = new WSClient({ url: "ws://OWNED_NO_NETWORK", onStateChange() {}, onMessage() {} })
  client.connect(); const first = MockWebSocket.instances[0]; first.simulateOpen(); first.simulateMessage({ type: "auth.ok" })
  const fixture = JSON.parse(readFileSync(`${process.cwd()}/tests/fixtures/meeting-pcm-responses.json`, "utf8")).responses
  client.observeMeetingPcm("old-pong"); first.simulateMessage({ ...fixture.pong, id: "old-pong" })
  const before = first.sent.length
  const begin = { type: "meeting.start", queue_contract: 1, id: "owned-begin", capture_id: fixture["meeting.start"].continuous_capture.capture_id,
    get meeting_id() { client.forceReconnect(); return "mtg_owned" } }
  assert.equal(client.send(begin), false)
  assert.equal(first.sent.length, before, "replacement during serialization must cause zero q1 send")
  assert.equal(client.getDiag().pending, 0)
  const replacement = MockWebSocket.instances.at(-1)!; replacement.simulateOpen(); replacement.simulateMessage({ type: "auth.ok" })
  assert.equal(replacement.sent.length, 0, "reconnect cannot replay the refused operation")
})
