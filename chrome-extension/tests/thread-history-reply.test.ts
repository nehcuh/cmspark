import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import vm from "node:vm"
import * as store from "../src/sidepanel/store/agentStore"

type Frame = { type: string; [key: string]: unknown }

function mountPanel() {
  let state = store.initialState
  const dispatch = (action: store.AgentAction) => { state = store.agentReducer(state, action) }
  const requests: Frame[] = []
  const notices: string[] = []
  let listener: (frame: Frame) => void
  const chrome = {
    runtime: {
      onMessage: { addListener(fn: typeof listener) { listener = fn } },
      sendMessage(frame: Frame) { requests.push(frame) },
      connect: () => ({ disconnect() {} }),
    },
    storage: { local: { get() {} } },
  }

  // Mount the compiled hook with its real message classifiers, reducer and effect dependencies.
  const refs: Array<{ current: unknown }> = []
  const dependencies: Array<unknown[] | undefined> = []
  const effects: Array<() => void> = []
  let refIndex = 0, effectIndex = 0
  const react = {
    useRef(value: unknown) { return refs[refIndex++] ??= { current: value } },
    useEffect(fn: () => void, deps?: unknown[]) {
      const previous = dependencies[effectIndex]
      dependencies[effectIndex++] = deps
      if (!previous || !deps || deps.length !== previous.length || deps.some((v, i) => !Object.is(v, previous[i]))) {
        effects.push(fn)
      }
    },
  }
  const filename = resolve(__dirname, "../src/sidepanel/hooks/useWebSocket.js")
  const requireDependency = createRequire(filename)
  const hook = { exports: {} as typeof import("../src/sidepanel/hooks/useWebSocket") }
  vm.runInNewContext(readFileSync(filename, "utf8"), {
    exports: hook.exports, chrome, console,
    require(id: string) {
      if (id === "react") return react
      if (id === "../store/agentStore") return { ...store, useAgentStore: () => ({ state, dispatch }) }
      return requireDependency(id)
    },
    document: { addEventListener() {} }, CustomEvent,
    window: { dispatchEvent(event: CustomEvent<string>) { if (event.type === "cmspark:toast") notices.push(event.detail) } },
    setInterval: () => 1, clearInterval() {},
  }, { filename })

  function render() {
    refIndex = effectIndex = 0
    hook.exports.useWebSocket()
    for (const effect of effects.splice(0)) effect()
  }
  render()
  return {
    select(threadId: string, renderImmediately = true) {
      dispatch({ type: "SET_ACTIVE_THREAD", threadId })
      chrome.runtime.sendMessage({ type: "thread.select", threadId })
      if (renderImmediately) render()
    },
    receive(frame: Frame) { listener(frame); render() },
    state: () => state,
    notices, requests,
  }
}

test("ordinary errors still appear in the active conversation", () => {
  const panel = mountPanel()
  panel.select("B")
  panel.receive({ type: "error", error: "Service is temporarily unavailable" })
  const message = panel.state().messages.at(-1)
  assert.equal(message?.thread_id, "B")
  assert.match(message?.content ?? "", /Service is temporarily unavailable/)
})

const lateFailures = [
  { label: "owned selection", reply: { request_type: "thread.select", thread_id: "A", id: "thread-select:A" } },
  { label: "legacy echoed request id", reply: { id: "thread-select:A" } },
  { label: "legacy owner in the error text", reply: {} },
]

for (const { label, reply } of lateFailures) {
  test(`late history error (${label}) leaves the newly selected conversation intact`, () => {
    const panel = mountPanel()
    panel.select("A")
    panel.select("B")
    panel.receive({ type: "thread.messages", thread_id: "B", messages: [
      { id: "msg-B", thread_id: "B", role: "user", content: "Question B", created_at: "t" },
    ] })
    panel.receive({ type: "chat.token", thread_id: "B", content: "Reply in progress" })
    const before = panel.state()
    const requests = [...panel.requests]
    assert.equal(before.threadBusyById.B, true)
    assert.equal(before.streamingContent, "Reply in progress")
    assert.equal(before.messages[0]?.content, "Question B")

    panel.receive({ type: "error", error: "Thread not found: A", ...reply })

    const after = panel.state()
    assert.deepEqual({
      threadId: after.activeThreadId, busy: after.threadBusyById.B,
      token: after.streamingContent, messages: after.messages, requests: panel.requests,
    }, {
      threadId: "B", busy: true, token: before.streamingContent, messages: before.messages, requests,
    })
  })
}

test("the selected thread retries a missing history once and reports a second failure", () => {
  const panel = mountPanel()
  panel.select("A")
  const missing = { type: "error", id: "thread-select:A", error: "Thread not found: A" }
  const selectCount = () => panel.requests.filter(request => request.type === "thread.select" && request.threadId === "A").length
  panel.receive(missing)
  assert.equal(selectCount(), 2)
  panel.receive(missing)
  assert.equal(selectCount(), 2)
  assert.equal(panel.state().processingStatus, "加载失败")
  assert.equal(panel.state().messages.length, 0)
  panel.receive({ type: "thread.messages", thread_id: "A", messages: [] })
  assert.equal(panel.state().processingStatus, null)
  panel.receive(missing)
  assert.equal(selectCount(), 3)
})

test("an untagged failure for a deleted row gives feedback without changing a queued selection", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.receive({ type: "thread.messages", thread_id: "A", messages: [] })
  panel.select("B", false)
  panel.receive({ type: "error", error: "Thread not found: A" })
  assert.deepEqual(panel.notices, ["找不到对话 A"])
  assert.equal(panel.state().activeThreadId, "B")
  assert.equal(panel.state().processingStatus, "加载中")
  assert.equal(panel.state().hydrating, true)
  assert.deepEqual(panel.state().messages, [])
})
