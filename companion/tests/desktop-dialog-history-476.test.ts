import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ThreadManager } from "../src/threads/thread-manager"

function owned(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dialog-history-476-"))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = dir
  t.after(() => {
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const manager = new ThreadManager()
  manager.create("标题", "history-A")
  const file = path.join(dir, "threads", "history-A.json")
  const read = () => (manager as any).readDesktopDialog("history-A")
  return { dir, manager, file, read }
}
function unavailable(fn: () => unknown) {
  assert.throws(fn, (e: any) => e instanceof Error && e.message === "DESKTOP_HISTORY_UNAVAILABLE" && e.cause === undefined)
}

test("strict native history reads actual canonical empty and persisted rows without mutating the store", t => {
  const { dir, manager, file, read } = owned(t)
  assert.deepEqual(read(), { thread_id: "history-A", title: "标题", messages: [], hidden_messages: 0 })
  const first = manager.addMessage("history-A", { thread_id: "history-A", role: "user", content: "第一句", id: "owned-user" })
  manager.addMessage("history-A", { thread_id: "history-A", role: "tool", content: "private tool body", id: "owned-tool" })
  const last = manager.addMessage("history-A", { thread_id: "history-A", role: "assistant", content: "回答", id: "owned-assistant", reasoning_content: "private reasoning", tool_calls: [{ arguments: "private args" }] })
  const before = fs.readFileSync(file), index = fs.readFileSync(path.join(dir, "threads/index.json"))
  assert.deepEqual(read(), { thread_id: "history-A", title: "标题", messages: [
    { id: first.id, role: "user", content: first.content, created_at: first.created_at },
    { id: last.id, role: "assistant", content: last.content, created_at: last.created_at },
  ], hidden_messages: 1 })
  assert.deepEqual(fs.readFileSync(file), before)
  assert.deepEqual(fs.readFileSync(path.join(dir, "threads/index.json")), index)
  assert.deepEqual((new ThreadManager() as any).readDesktopDialog("history-A"), read())
})

test("native history redacts complete text and projects no tool/reasoning/config/attachment fields", t => {
  const { manager, read } = owned(t), secret = "sk-" + "A".repeat(32)
  manager.update("history-A", { alias: secret })
  manager.addMessage("history-A", { thread_id: "history-A", role: "user", content: "正文 " + secret, id: "owned-user" })
  manager.addMessage("history-A", { thread_id: "history-A", role: "assistant", content: "-----BEGIN PRIVATE KEY-----\nowned hidden material\n-----END PRIVATE KEY-----", id: "owned-answer", reasoning_content: "reasoning sentinel", tool_calls: [{ name: "private-tool", arguments: "args sentinel" }] })
  manager.addMessage("history-A", { thread_id: "history-A", role: "system", content: "system sentinel", id: "owned-system" })
  const result = read(), wire = JSON.stringify(result)
  for (const sentinel of [secret, "owned hidden material", "reasoning sentinel", "args sentinel", "private-tool", "system sentinel", "config_override", "attachments"]) assert.equal(wire.includes(sentinel), false)
  assert.equal(result.title, "[REDACTED]")
  assert.equal(result.messages[0].content, "正文 [REDACTED]")
  assert.equal(result.messages[1].content, "[REDACTED]")
  assert.equal(result.hidden_messages, 1)
})

for (const raw of ["{", "null", "[]", "{}", '{"messages":null}', '{"messages":{}}', '{"messages":[null]}', '{"messages":[{"role":"user","content":"x"}]}']) {
  test("corrupt canonical history is an unavailable result rather than empty: " + raw, t => {
    const { file, manager, read } = owned(t)
    fs.writeFileSync(file, raw)
    unavailable(read)
    if (raw === "{") assert.deepEqual(manager.getMessages("history-A"), [], "legacy tolerant caller is unchanged")
  })
}

for (const mutation of ["foreign-thread", "unknown-role", "duplicate-id", "private-id", "bad-date", "non-text"] as const) {
  test("strict native history refuses malformed record " + mutation, t => {
    const { manager, file, read } = owned(t)
    manager.addMessage("history-A", { thread_id: "history-A", role: "user", content: "正文", id: "owned-user" })
    const value = JSON.parse(fs.readFileSync(file, "utf8")), row = value.messages[0]
    if (mutation === "foreign-thread") row.thread_id = "history-B"
    if (mutation === "unknown-role") row.role = "developer"
    if (mutation === "duplicate-id") value.messages.push({ ...row })
    if (mutation === "private-id") row.id = "sk-" + "A".repeat(32)
    if (mutation === "bad-date") row.created_at = "private timestamp sentinel"
    if (mutation === "non-text") row.content = { text: "private shape" }
    fs.writeFileSync(file, JSON.stringify(value))
    unavailable(read)
  })
}

test("missing, trashed and unsafe targets never become successful empty history", t => {
  const { manager, file, read } = owned(t)
  for (const id of ["missing", "../config", "", null]) unavailable(() => (manager as any).readDesktopDialog(id))
  fs.unlinkSync(file)
  unavailable(read)
  fs.writeFileSync(file, '{"messages":[]}')
  manager.update("history-A", { trashed_at: new Date().toISOString() })
  unavailable(read)
})

test("strict native history masks a real filesystem read failure without rewriting disk", t => {
  const { file, read } = owned(t), before = fs.readFileSync(file), open = fs.openSync
  t.mock.method(fs, "openSync", (...args: any[]) => {
    if (args[0] === file) throw Error("private filesystem sentinel")
    return Reflect.apply(open, fs, args)
  })
  unavailable(read)
  t.mock.restoreAll()
  assert.deepEqual(fs.readFileSync(file), before)
})

test("index-only partial create is unavailable; a message committed before index failure remains readable", t => {
  const { dir, manager, read } = owned(t), rename = fs.renameSync
  t.mock.method(fs, "renameSync", (...args: any[]) => {
    if (args[1] === path.join(dir, "threads", "partial-B.json")) throw Error("owned messages commit fault")
    return Reflect.apply(rename, fs, args)
  })
  assert.throws(() => manager.create("部分", "partial-B"), /owned messages commit fault/)
  assert.ok(new ThreadManager().get("partial-B"))
  unavailable(() => (manager as any).readDesktopDialog("partial-B"))
  t.mock.restoreAll()
  t.mock.method(fs, "renameSync", (...args: any[]) => {
    if (args[1] === path.join(dir, "threads", "index.json")) throw Error("owned index commit fault")
    return Reflect.apply(rename, fs, args)
  })
  assert.throws(() => manager.addMessage("history-A", { thread_id: "history-A", role: "user", content: "actually committed once", id: "owned-partial-message" }), /owned index commit fault/)
  t.mock.restoreAll()
  assert.equal(read().messages[0].content, "actually committed once")
  assert.equal(read().messages.length, 1)
})

test("strict history retains the store's 1000-row boundary and refuses excess instead of silently truncating", t => {
  const { file, read } = owned(t)
  const messages = Array.from({ length: 1000 }, (_, i) => ({ thread_id: "history-A", id: "owned-" + i, role: "user", content: "正文", created_at: "2026-10-18T00:00:00.000Z" }))
  fs.writeFileSync(file, JSON.stringify({ messages }))
  assert.equal(read().messages.length, 1000)
  messages.push({ ...messages[0], id: "owned-1000" })
  fs.writeFileSync(file, JSON.stringify({ messages }))
  unavailable(read)
})

test("a real file replaced between lstat and open is refused before any replacement transcript read", t => {
  const { file, read } = owned(t), open = fs.openSync, replacement = file + ".replacement"
  fs.writeFileSync(replacement, '{"messages":[]}')
  t.mock.method(fs, "openSync", (...args: any[]) => {
    if (args[0] === file) {
      fs.renameSync(file, file + ".old")
      fs.renameSync(replacement, file)
    }
    return Reflect.apply(open, fs, args)
  })
  unavailable(read)
})

for (const field of ["dev", "ino"] as const) {
  for (const replaced of [false, true]) {
    test(`strict native history compares exact 64-bit ${field} with replacement=${replaced}`, t => {
      const { file, read } = owned(t)
      const lstat = fs.lstatSync, fstat = fs.fstatSync, open = fs.openSync, readFile = fs.readFileSync
      const beforeId = 9007199254740992n, openedId = replaced ? beforeId + 1n : beforeId
      assert.equal(Number(beforeId), Number(openedId), "the Number domain cannot distinguish these IDs")
      let fd: number | undefined, transcriptReads = 0
      t.mock.method(fs, "openSync", (...args: any[]) => {
        const opened = Reflect.apply(open, fs, args)
        if (args[0] === file) fd = opened
        return opened
      })
      t.mock.method(fs, "lstatSync", (...args: any[]) => {
        const stat = Reflect.apply(lstat, fs, args)
        if (args[0] === file) {
          const bigint = args[1]?.bigint === true
          Object.defineProperty(stat, field, { value: bigint ? beforeId : Number(beforeId) })
        }
        return stat
      })
      t.mock.method(fs, "fstatSync", (...args: any[]) => {
        const stat = Reflect.apply(fstat, fs, args)
        if (args[0] === fd) {
          const bigint = args[1]?.bigint === true
          Object.defineProperty(stat, field, { value: bigint ? openedId : Number(openedId) })
        }
        return stat
      })
      t.mock.method(fs, "readFileSync", (...args: any[]) => {
        if (args[0] === fd) transcriptReads++
        return Reflect.apply(readFile, fs, args)
      })
      if (replaced) unavailable(read)
      else assert.equal(read().messages.length, 0)
      assert.equal(transcriptReads, replaced ? 0 : 1)
    })
  }
}

test("a syntactically ISO-shaped but impossible timestamp is not projected", t => {
  const { manager, file, read } = owned(t)
  manager.addMessage("history-A", { thread_id: "history-A", role: "user", content: "正文", id: "owned-user" })
  const value = JSON.parse(fs.readFileSync(file, "utf8"))
  value.messages[0].created_at = "2026-02-30T00:00:00.000Z"
  fs.writeFileSync(file, JSON.stringify(value))
  unavailable(read)
})
