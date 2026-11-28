import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { agentReducer, initialState, type AgentState } from "../src/sidepanel/store/agentStore"
import type { Message } from "../src/sidepanel/types"
import { newTempUserMessageId } from "../src/utils/temp-message-id"

const thread = "thread-a"
const started = 1730000000000
const firstId = newTempUserMessageId(thread, started, "panel")
const secondId = newTempUserMessageId(thread, started + 2, "cockpit")
const storedId = `${thread}_${started + 1}_r1`
const nextStoredId = `${thread}_${started + 3}_r2`

function turn(id: string, content: string, file?: string): Message {
  return {
    id, thread_id: thread, role: "user", content, created_at: new Date(started).toISOString(),
    ...(file ? { attachments: [{ kind: "image", name: file, mime: "image/png" }] } : {}),
  }
}
function add(state: AgentState, message: Message) {
  return agentReducer(state, { type: "ADD_MESSAGE", message })
}

for (const [label, first, second, image] of [
  ["different text", "first", "second", undefined],
  ["repeated text", "repeat", "repeat", undefined],
  ["distinct images with the same caption", "look", "look", "second.png"],
] as const) {
  test(`the next optimistic turn remains visible after a confirmed turn: ${label}`, () => {
    const previous = turn(firstId, first, image && "first.png")
    const current = turn(secondId, second, image)
    let state = add(initialState, previous)
    state = add(state, { ...previous, id: storedId, client_message_id: firstId })
    state = add(state, current)
    assert.deepEqual(state.messages.map(m => [m.id, m.content, m.attachments?.[0]?.name]), [
      [storedId, first, previous.attachments?.[0]?.name], [secondId, second, image],
    ])
    state = agentReducer(state, { type: "REMOVE_MESSAGE", id: secondId })
    assert.deepEqual(state.messages.map(m => [m.id, m.attachments?.[0]?.name]), [[storedId, previous.attachments?.[0]?.name]])
  })
}

test("a late cross-panel echo keeps its original owner after history and a newer confirmation", () => {
  const first = turn(firstId, "same caption", "first.png")
  const second = turn(secondId, "same caption", "second.png")
  let state = add(initialState, { ...first, id: storedId, client_message_id: firstId })
  state = add(state, second)
  state = add(state, { ...second, id: nextStoredId, client_message_id: secondId })
  state = agentReducer(state, { type: "SET_MESSAGES", messages: [
    { ...first, id: storedId }, { ...second, id: nextStoredId },
  ] })
  state = add(state, first)
  assert.deepEqual(state.messages.map(m => [m.id, m.attachments?.[0]?.name]), [
    [storedId, "first.png"], [nextStoredId, "second.png"],
  ])
})

test("an unacknowledged repeated send survives a history containing only the preceding turn", () => {
  const previous = turn(storedId, "again")
  const current = turn(secondId, "again")
  const state = add(add(initialState, previous), current)
  const loaded = agentReducer(state, { type: "SET_MESSAGES", messages: [previous] })
  assert.deepEqual(loaded.messages.map(m => m.id), [storedId, secondId])
})

test("different images survive an uncorrelated same-caption history, then an exact receipt can adopt either id", () => {
  const own = turn(firstId, "image", "mine.png")
  const foreign = turn(storedId, "image", "other.png")
  let state = add(initialState, own)
  state = agentReducer(state, { type: "SET_MESSAGES", messages: [foreign] })
  assert.deepEqual(state.messages.map(m => m.id), [storedId, firstId])
  state = add(state, { ...own, id: nextStoredId, client_message_id: firstId })
  assert.deepEqual(state.messages.map(m => [m.id, m.attachments?.[0]?.name]), [
    [storedId, "other.png"], [nextStoredId, "mine.png"],
  ])
})

test("a receipt after history resolves both the persisted row and its pending upload", () => {
  const pending = turn(firstId, "my caption")
  const stored = turn(storedId, "server caption with document metadata", "scan.png")
  let state = add(initialState, pending)
  state = agentReducer(state, { type: "SET_MESSAGES", messages: [stored] })
  assert.deepEqual(state.messages.map(m => m.id), [storedId, firstId])
  state = add(state, { ...stored, client_message_id: firstId })
  state = add(state, pending)
  assert.deepEqual(state.messages.map(m => [m.id, m.attachments?.[0]?.name]), [[storedId, "scan.png"]])
})

test("ambiguous legacy history cannot pick between two identical unconfirmed sends", () => {
  const otherTemp = newTempUserMessageId(thread, started, "other")
  const first = turn(firstId, "same")
  const second = turn(otherTemp, "same")
  const stored = turn(storedId, "same")
  let state = add(add(initialState, first), second)
  state = agentReducer(state, { type: "SET_MESSAGES", messages: [stored] })
  assert.deepEqual(state.messages.map(m => m.id), [storedId, firstId, otherTemp])
  state = add(state, { ...stored, client_message_id: otherTemp })
  assert.deepEqual(state.messages.map(m => m.id), [storedId, firstId])
})

test("an uncorrelated service-worker echo cannot take a distinct turn sent in the same millisecond", () => {
  const old = turn(storedId, "same")
  const concurrent = turn(newTempUserMessageId(thread, started + 1, "cockpit"), "same")
  const selected = agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: thread })
  const state = agentReducer(add(selected, old), { type: "ADD_MESSAGE", message: concurrent, source: "chat.user" })
  assert.deepEqual(state.messages.map(m => m.id), [storedId, concurrent.id])
})

test("legacy confirmations received in reverse order stay with their original uploads", () => {
  const a = turn(firstId, "look", "a.png")
  const b = turn(secondId, "look", "b.png")
  let state = add(add(agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: thread }), a), b)
  state = add(state, { ...b, id: nextStoredId })
  state = add(state, { ...a, id: storedId })
  state = agentReducer(state, { type: "ADD_MESSAGE", message: a, source: "chat.user" })
  assert.deepEqual(state.messages.map(m => [m.id, m.attachments?.[0]?.name]), [[storedId, "a.png"], [nextStoredId, "b.png"]])
})

test("the service worker echoes regular sends and waits for Companion to apply queued or steered turns", () => {
  const background = readFileSync(join(process.cwd(), "src/background/index.ts"), "utf8")
  const start = background.indexOf('case "chat.send":')
  const end = background.indexOf('case "computer.maximum.arm":', start)
  assert.ok(start >= 0 && end > start)
  const source = `function receive(message, sendResponse) { switch (message.type) { ${background.slice(start, end)} } }; receive`
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const broadcasts: any[] = [], sent: any[] = [], replies: any[] = []
  let connected = true
  const receive = vm.runInNewContext(code, {
    newTempUserMessageId, wsClient: { send(frame: unknown) { sent.push(frame); return connected } },
    chrome: { runtime: { async sendMessage(frame: unknown) { broadcasts.push(frame) } } },
  })
  function send(text: string, flags = {}) {
    receive({ type: "chat.send", threadId: thread, message: text, chat_context: { include_page: false }, ...flags },
      (response: any) => replies.push(response.ok))
  }
  send("regular", { clientMessageId: firstId })
  send("one", { steer: true })
  send("two", { steer: true })
  send("queued", { enqueue: true })
  connected = false
  send("failed", { steer: true })
  assert.deepEqual(sent.map(frame => [frame.type, frame.message]), [
    ["chat.create", "regular"], ["chat.steer", "one"], ["chat.steer", "two"], ["chat.create", "queued"], ["chat.steer", "failed"],
  ])
  assert.equal(sent[3].enqueue, true)
  assert.deepEqual(replies, [true, true, true, true, false])
  assert.deepEqual(broadcasts.map(frame => [frame.type, frame.message_id]), [["chat.user", firstId], ["error", undefined]])
})
