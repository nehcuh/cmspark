import test from "node:test"
import assert from "node:assert/strict"
import { attachTerminalPort, openOrFocusEmbeddedTerminal } from "../src/background/terminal"

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
