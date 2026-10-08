import test from "node:test"
import assert from "node:assert/strict"
const clockTest = test as unknown as (name: string, fn: (t: any) => void) => void
import { WSClient } from "../src/background/ws-client"

class Socket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  static all: Socket[] = []
  readyState = 0; sent: any[] = []; closed = false
  onopen?: () => void; onclose?: () => void; onerror?: () => void
  onmessage?: (event: { data: string }) => void
  constructor(_url: string) { Socket.all.push(this) }
  send(value: string) { this.sent.push(JSON.parse(value)) }
  close() { this.closed = true; this.readyState = 3; this.onclose?.() }
  receive(value: object) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
function setup(t: any) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] })
  Socket.all = []
  ;(globalThis as any).WebSocket = Socket
  ;(globalThis as any).chrome = { alarms: { create() {}, clear() {} } }
  let lost = 0
  const client = new WSClient({ url: "ws://local", onMessage() {}, onStateChange() {}, onConnectionLost() { lost++ } })
  client.connect()
  return { client, socket: Socket.all[0], lost: () => lost }
}
clockTest("authenticated idle socket exchanges app messages before MV3's 30 second idle window", t => {
  const { socket } = setup(t)
  socket.readyState = 1; socket.onopen?.(); socket.receive({ type: "auth.ok" })
  t.mock.timers.tick(20_000)
  assert.ok(socket.sent.some(msg => msg.type === "system.ping"))
})
clockTest("CONNECTING and OPEN without auth cannot wedge reconnection indefinitely", t => {
  const { client, socket } = setup(t)
  t.mock.timers.tick(16_000)
  client.checkAndReconnect()
  assert.equal(socket.closed, true)
  assert.ok(Socket.all.length > 1)
})
clockTest("OPEN blackhole reconnects; stale frames cannot heal its replacement", t => {
  const { client, socket, lost } = setup(t)
  socket.readyState = 1; socket.onopen?.(); socket.receive({ type: "auth.ok" })
  t.mock.timers.tick(61_000)
  client.checkAndReconnect()
  assert.equal(socket.closed, true)
  assert.equal(lost(), 1)
  socket.receive({ type: "auth.ok" })
  assert.equal(client.getDiag().authenticated, false)
})
clockTest("pong and reconnect do not accumulate heartbeat timers", t => {
  const { client, socket } = setup(t)
  socket.readyState = 1; socket.onopen?.(); socket.receive({ type: "auth.ok" })
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(20_000); socket.receive({ type: "system.pong" }) }
  assert.equal(socket.sent.length, 4)
  client.forceReconnect()
  const current = Socket.all.at(-1)!
  current.readyState = 1; current.onopen?.(); current.receive({ type: "auth.ok" })
  t.mock.timers.tick(20_000)
  assert.equal(socket.sent.length, 4)
  assert.equal(current.sent.length, 1)
})
