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
let aliasFromFirstUserText: typeof import("../src/threads/alias-commit").aliasFromFirstUserText
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
  aliasFromFirstUserText = ac.aliasFromFirstUserText
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

test("T-alias-3: hostname leftover is not classifyAlias === user", () => {
  assert.notEqual(classifyAlias("cruise-wl"), "user")
  assert.equal(classifyAlias("cruise-wl"), "hostname")
  assert.equal(classifyAlias("github.com"), "hostname")
  // handwritten short code with a digit stays user (hygiene p1-wl)
  assert.equal(classifyAlias("p1-wl"), "user")
})

test("T-alias-3: hostname leftover allows llm auto-title overwrite", () => {
  const tm = new ThreadManager()
  const t = tm.create("cruise-wl", "w2k8z9")
  tm.addMessage(t.id, { thread_id: t.id, role: "user", content: "立项风险分析" })
  const committed = commitThreadAlias({
    threadManager: tm,
    threadId: t.id,
    next: "立项风险分析",
    class: "llm",
    firstUserText: "立项风险分析",
  })
  assert.equal(committed.ok, true)
  assert.equal(tm.get(t.id)?.alias, "立项风险分析")
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

// F10 round-trip: an alias derived from first user text by the SHARED
// aliasFromFirstUserText (what thread.batch_auto_title writes) must classify
// as provisional_user so commitThreadAlias allows the →llm transition.
const F10_FIRST_TEXTS: Array<[string, string]> = [
  ["long >16 chars", "今天我们来讨论一下关于季度财报的几个关键问题和现金流安排"],
  ["politeness prefix", "请帮我分析一下这个代码库的整体架构和模块划分"],
  ["file prefix + politeness", "[文件 report.pdf] 帮我总结这份报告的要点和结论"],
  ["pure file prefix", "[文件 report.pdf]"],
]

for (const [label, text] of F10_FIRST_TEXTS) {
  test(`F10 round-trip: batch-written alias classifies provisional_user (${label})`, () => {
    const alias = aliasFromFirstUserText(text, 16)
    assert.ok(alias, "alias must be derivable")
    assert.equal(classifyAlias(alias, text), "provisional_user")

    const tm = new ThreadManager()
    const thr = tm.create(alias, `f10-${label.length}-${text.length}`)
    tm.addMessage(thr.id, { thread_id: thr.id, role: "user", content: text })
    const committed = commitThreadAlias({
      threadManager: tm,
      threadId: thr.id,
      next: "LLM 自动标题",
      class: "llm",
      firstUserText: text,
    })
    assert.equal(committed.ok, true, "provisional_user → llm must be allowed")
    assert.equal(tm.get(thr.id)?.alias, "LLM 自动标题")
  })
}

test("F10: shared derivation pins politeness strip + truncation", () => {
  assert.equal(aliasFromFirstUserText("帮我对比定价", 16), "对比定价")
  assert.ok(aliasFromFirstUserText("a".repeat(20), 16).endsWith("…"))
  assert.equal(aliasFromFirstUserText("[文件 a.pdf]", 16), "[文件 a.pdf]")
})

// Pre-F10 legacy aliases: the old immediate-title path persisted titles with a
// DIFFERENT formula (no politeness strip, [文件 …] strip only, slice(0,15)+"…"
// = 16 chars). Those on-disk aliases must still classify as provisional_user,
// or canTransition refuses →llm and old threads never get an LLM title.
function legacyTitle(text: string): string {
  const t = String(text || "").replace(/\s+/g, " ").trim()
  if (!t) return ""
  const cleaned = t.replace(/^\[文件[^\]]*\]\s*/g, "").trim() || t
  if (cleaned.length <= 16) return cleaned
  return cleaned.slice(0, 15) + "…"
}

const LEGACY_FIRST_TEXTS: Array<[string, string]> = [
  ["politeness + >15 chars", "请帮我详细分析一下当前这个大型代码库的整体架构和模块划分"],
  ["politeness + short (no ellipsis)", "请帮我看看这个方案"],
  ["file prefix + politeness", "[文件 report.pdf] 请帮我总结这份报告的要点和主要结论"],
]

for (const [label, text] of LEGACY_FIRST_TEXTS) {
  test(`legacy pre-F10 alias classifies provisional_user, →llm allowed (${label})`, () => {
    const alias = legacyTitle(text)
    assert.ok(alias, "legacy alias must be derivable")
    // Guard: these cases only exercise the fallback if the NEW shared
    // derivation would NOT produce this alias (politeness prefix kept).
    assert.notEqual(aliasFromFirstUserText(text, 16), alias)
    assert.equal(classifyAlias(alias, text), "provisional_user")

    const tm = new ThreadManager()
    const thr = tm.create(alias, `legacy-${label.length}-${text.length}`)
    tm.addMessage(thr.id, { thread_id: thr.id, role: "user", content: text })
    const committed = commitThreadAlias({
      threadManager: tm,
      threadId: thr.id,
      next: "LLM 自动标题",
      class: "llm",
      firstUserText: text,
    })
    assert.equal(committed.ok, true, "legacy provisional_user → llm must be allowed")
    assert.equal(tm.get(thr.id)?.alias, "LLM 自动标题")
  })
}

test("legacy fallback does not widen: handwritten aliases still classify user", () => {
  const text = "请帮我详细分析一下当前这个大型代码库的整体架构和模块划分"
  for (const alias of ["我的架构笔记", "sprint 复盘", "今晚吃什么好呢", "p1-wl"]) {
    assert.equal(classifyAlias(alias, text), "user", alias)
  }
  // A handwritten alias that matches NEITHER formula's reference stays user.
  assert.equal(classifyAlias("请帮我详细分析", text), "user")
})
