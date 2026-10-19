import test from "node:test"
import assert from "node:assert/strict"
import { attachTerminalPort, openOrFocusEmbeddedTerminal } from "../src/background/terminal"

test("terminal background answers heartbeat while the page sends no timer messages", () => {
  ;(globalThis as any).chrome = { runtime: { id: "test", getURL: () => "chrome-extension://test/tabs/embedded-terminal.html" } }
  let onMessage: (frame: unknown) => void = () => {}, onDisconnect: () => void = () => {}
  const sent: any[] = []
  const port = { sender: { id: "test", url: "chrome-extension://test/tabs/embedded-terminal.html" },
    postMessage() {}, onMessage: { addListener: (fn: typeof onMessage) => { onMessage = fn } },
    onDisconnect: { addListener: (fn: typeof onDisconnect) => { onDisconnect = fn } } }
  const relay = attachTerminalPort(port as never, frame => { sent.push(frame); return true }, () => {})!
  onMessage({ type: "terminal.open", id: "quiet", user_gesture: true })
  relay.handleWsFrame({ type: "terminal.heartbeat", id: "quiet" })
  assert.equal(sent.length, 1, "no pre-approval heartbeat")
  relay.handleWsFrame({ type: "terminal.opened", id: "quiet", pid: 1, platform: "darwin" })
  relay.handleWsFrame({ type: "terminal.heartbeat", id: "other" })
  assert.equal(sent.length, 1)
  for (let i = 0; i < 5; i++) relay.handleWsFrame({ type: "terminal.heartbeat", id: "quiet" })
  assert.equal(sent.filter(frame => frame.type === "terminal.ping").length, 5)
  onDisconnect()
  relay.handleWsFrame({ type: "terminal.heartbeat", id: "quiet" })
  assert.equal(sent.filter(frame => frame.type === "terminal.ping").length, 5)
})

test("terminal relay delivers no-id errors and keeps frames bound to its session", () => {
  ;(globalThis as any).chrome = { runtime: { id: "test", getURL: () => "chrome-extension://test/tabs/embedded-terminal.html" } }
  let onMessage: (message: unknown) => void = () => {}, onDisconnect: () => void = () => {}
  const delivered: unknown[] = [], sent: unknown[] = []
  const port = { sender: { id: "test", url: "chrome-extension://test/tabs/embedded-terminal.html", frameId: 0 }, onMessage: { addListener: (fn: typeof onMessage) => { onMessage = fn } },
    onDisconnect: { addListener: (fn: typeof onDisconnect) => { onDisconnect = fn } }, postMessage: (value: unknown) => delivered.push(value) }
  const relay = attachTerminalPort(port as never, frame => { sent.push(frame); return true }, () => {})!
  onMessage({ type: "terminal.open", id: "owned", user_gesture: true })
  onMessage({ type: "terminal.input", id: "other", b64: "eA==" })
  onMessage({ type: "terminal.open", id: "other", user_gesture: true })
  assert.equal(sent.length, 1)
  relay.handleWsFrame({ type: "terminal.error", code: "request_failed", error: "disabled" })
  assert.equal((delivered[0] as any).error, "disabled")
  relay.handleWsFrame({ type: "terminal.data", id: "other", seq: 1, b64: "eA==" })
  assert.equal(delivered.length, 1)
  onDisconnect()
  assert.deepEqual(sent.at(-1), { type: "terminal.close", id: "owned" })
})

test("opening another review cannot silently retarget an existing terminal tab", async () => {
  const url = "chrome-extension://test/tabs/embedded-terminal.html"
  const created: unknown[] = [], updated: unknown[] = []
  let existing: { id: number; url: string }[] = []
  ;(globalThis as any).chrome = { runtime: { id: "test", getURL: () => url }, tabs: {
    query: async () => existing, create: async (opts: unknown) => created.push(opts),
    update: async (...opts: unknown[]) => updated.push(opts),
  } }
  await openOrFocusEmbeddedTerminal({ thread_id: "thread", review_id: "review" })
  const requested = (created[0] as any).url
  assert.equal(new URL(requested).searchParams.get("thread_id"), "thread")
  existing = [{ id: 1, url: requested }]
  let rejected = ""
  try { await openOrFocusEmbeddedTerminal({ thread_id: "other", review_id: "review" }) } catch (error) { rejected = String(error) }
  assert.ok(rejected.includes("已有其他终端任务"))
  assert.equal(updated.length, 0)
  await openOrFocusEmbeddedTerminal({ thread_id: "thread", review_id: "review" })
  assert.equal(updated.length, 1)
})

test("only the extension terminal document can attach; disconnect feedback is delivered", () => {
  const terminalUrl = "chrome-extension://test/tabs/embedded-terminal.html"
  ;(globalThis as any).chrome = { runtime: { id: "test", getURL: () => terminalUrl } }
  for (const url of ["https://test/tabs/embedded-terminal.html", "chrome-extension://evil/tabs/embedded-terminal.html", "chrome-extension://test/sidepanel.html"]) {
    let disconnected = false
    const port = { sender: { id: "test", url }, postMessage() {}, disconnect: () => { disconnected = true } }
    assert.equal(attachTerminalPort(port as never, () => true, () => {}), null)
    assert.equal(disconnected, true)
  }
  let listener: (message: unknown) => void = () => {}
  const messages: any[] = []
  const port = { sender: { id: "test", url: terminalUrl }, postMessage: (m: unknown) => messages.push(m),
    onMessage: { addListener: (fn: typeof listener) => { listener = fn } }, onDisconnect: { addListener() {} } }
  attachTerminalPort(port as never, () => false, () => {})
  listener({ type: "terminal.open", id: "owned", user_gesture: true })
  assert.equal(messages[0].code, "disconnected")
})

test("#724 first owned output is sampled once, no contents, foreign/ended frames do not count", () => {
  ;(globalThis as any).chrome = { runtime: { id: "test", getURL: () => "chrome-extension://test/tabs/embedded-terminal.html" } }
  let message: (frame: unknown) => void = () => {}
  const logs: any[] = [], delivered: any[] = [], sent: any[] = []
  const port = { sender: { id: "test", url: "chrome-extension://test/tabs/embedded-terminal.html" }, postMessage: (frame: unknown) => delivered.push(frame),
    onMessage: { addListener: (fn: typeof message) => { message = fn } }, onDisconnect: { addListener() {} } }
  const relay = attachTerminalPort(port as never, frame => { sent.push(frame); return true }, (_level, event, data) => logs.push({ event, data }))!
  const frame = (id: string, seq: number) => ({ type: "terminal.data", id, seq, b64: btoa("SYNTHETIC_NOT_FOR_LOG") })
  relay.handleWsFrame(frame("unbound", 1)); assert.equal(logs.length, 0)
  message({ type: "terminal.open", id: "owned", user_gesture: true })
  relay.handleWsFrame({ type: "terminal.opened", id: "owned", platform: "win32", launch_kind: "embedded_agent" })
  relay.handleWsFrame(frame("foreign", 1)); relay.handleWsFrame(frame("owned", 1)); relay.handleWsFrame(frame("owned", 2))
  const output = logs.filter(row => row.event === "extension.terminal_output_observed")
  assert.equal(output.length, 1); assert.deepEqual(output[0].data, { id: "owned", seq: 1, bytes: 21 })
  assert.equal(JSON.stringify(logs).includes("SYNTHETIC_NOT_FOR_LOG"), false)
  assert.equal(JSON.stringify(logs).includes(btoa("SYNTHETIC_NOT_FOR_LOG")), false)
  const metrics = { seq: 2, output_bytes: 42, unacked_frames: 0, unacked_bytes: 0, ack_frames: 2, pause_count: 0, paused: false, last_output_age_ms: 9 }
  relay.handleWsFrame({ type: "terminal.heartbeat", id: "foreign", metrics }); assert.equal(sent.at(-1).type, "terminal.open")
  relay.handleWsFrame({ type: "terminal.heartbeat", id: "owned", metrics: { ...metrics, CONTENT: "SYNTHETIC_NOT_FOR_LOG" } })
  assert.equal(logs.at(-1).data.last_output_age_ms, 9); assert.equal(logs.at(-1).data.CONTENT, undefined)
  relay.handleWsFrame({ type: "terminal.heartbeat", id: "owned", metrics: { ...metrics, output_bytes: Infinity } })
  assert.equal(logs.at(-1).data.last_output_age_ms, undefined); assert.equal(sent.at(-1).type, "terminal.ping")
  relay.handleWsFrame({ type: "terminal.closed", id: "owned" }); relay.handleWsFrame(frame("owned", 3))
  assert.equal(logs.filter(row => row.event === "extension.terminal_output_observed").length, 1)
})

test("#724 independent terminal entry only focuses an existing bound Agent tab without relabel/rebind", async () => {
  const existingUrl = "chrome-extension://test/tabs/embedded-terminal.html?thread_id=owned-agent"
  const updates: unknown[] = []
  ;(globalThis as any).chrome = { runtime: { getURL: () => "chrome-extension://test/tabs/embedded-terminal.html" }, tabs: {
    query: async () => [{ id: 7, windowId: 3, url: existingUrl }],
    update: async (...args: unknown[]) => { updates.push(args) }, create: async () => { throw Error("NO_SECOND_TAB") },
  }, windows: { update: async () => {} } }
  await openOrFocusEmbeddedTerminal()
  assert.deepEqual(updates, [[7, { active: true }]])
  assert.equal(existingUrl.includes("thread_id=owned-agent"), true)
})
