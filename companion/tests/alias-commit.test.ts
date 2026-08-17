import "./_threads-history-setup.js"
import test, { before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let getConfigDir: typeof import("../src/config").getConfigDir
let initDataDir: typeof import("../src/config").initDataDir
let commitThreadAlias: typeof import("../src/threads/alias-commit").commitThreadAlias
let formatAcpProvisionalAlias: typeof import("../src/threads/alias-commit").formatAcpProvisionalAlias
let classifyAlias: typeof import("../src/threads/alias-commit").classifyAlias
let inspectThreadMessages: typeof import("../src/threads/thread-inspect").inspectThreadMessages

before(async () => {
  const configMod = await import("../src/config")
  getConfigDir = configMod.getConfigDir
  initDataDir = configMod.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  const ac = await import("../src/threads/alias-commit")
  commitThreadAlias = ac.commitThreadAlias
  formatAcpProvisionalAlias = ac.formatAcpProvisionalAlias
  classifyAlias = ac.classifyAlias
  inspectThreadMessages = (await import("../src/threads/thread-inspect")).inspectThreadMessages
})

beforeEach(() => {
  const threadsDir = path.join(getConfigDir(), "threads")
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir)) {
      try {
        fs.rmSync(path.join(threadsDir, f), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
})

test("formatAcpProvisionalAlias is closed enum", () => {
  assert.equal(formatAcpProvisionalAlias("pi", "失败"), "接力·pi·失败")
  assert.equal(formatAcpProvisionalAlias("Claude Code!!", "起草"), "接力·agent·起草")
  assert.equal(classifyAlias("接力·pi·失败"), "provisional_acp")
  assert.equal(classifyAlias("p1-wl"), "user")
  assert.equal(classifyAlias(""), "empty")
})

test("commitThreadAlias: empty → ACP; cryptic p1-wl blocked", () => {
  const tm = new ThreadManager()
  const empty = tm.create("", "rny77t")
  const cryptic = tm.create("p1-wl", "4j6l6f")
  const a = commitThreadAlias({
    threadManager: tm,
    threadId: empty.id,
    next: formatAcpProvisionalAlias("pi", "失败"),
    class: "provisional_acp",
  })
  assert.equal(a.ok, true)
  assert.equal(tm.get("rny77t")?.alias, "接力·pi·失败")
  const b = commitThreadAlias({
    threadManager: tm,
    threadId: cryptic.id,
    next: formatAcpProvisionalAlias("pi", "失败"),
    class: "provisional_acp",
  })
  assert.equal(b.ok, false)
  assert.equal(tm.get("4j6l6f")?.alias, "p1-wl")
})

test("inspectThreadMessages: ACP fail head, no body leak into acp_list", () => {
  const info = inspectThreadMessages([
    {
      role: "assistant",
      content: "【编程接力 · pi · propose_diff】完成\n### 摘要\nNo API key found for the selected model.",
    },
  ])
  assert.equal(info.message_count, 1)
  assert.equal(info.user_message_count, 0)
  assert.equal(info.looks_like_acp, true)
  assert.equal(info.acp_list?.agent_id, "pi")
  // Head is 「完成」; fail words in the body must not flip first-party outcome.
  assert.equal(info.acp_list?.outcome, "ok")
  assert.equal(info.acp_list?.goal_preview, undefined)
})

test("cleanupEmpty skips exceptId", () => {
  const tm = new ThreadManager()
  tm.create("", "keep")
  tm.create("", "drop")
  const deleted = tm.cleanupEmpty("keep")
  assert.deepEqual(deleted, ["drop"])
  assert.ok(tm.get("keep"))
  assert.equal(tm.get("drop"), undefined)
})
