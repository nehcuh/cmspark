/**
 * P1.5: cleanup rules + context-refs + trash/restore
 */
import "./_threads-history-setup.js"
import test, { before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let getConfigDir: typeof import("../src/config").getConfigDir
let initDataDir: typeof import("../src/config").initDataDir
let handleMessage: typeof import("../src/message-router").handleMessage
let suggestCleanupRules: typeof import("../src/threads/cleanup-rules").suggestCleanupRules
let buildContextRefsSystemSegment: typeof import("../src/threads/context-refs").buildContextRefsSystemSegment
let buildSummaryCard: typeof import("../src/threads/context-refs").buildSummaryCard

before(async () => {
  const configMod = await import("../src/config")
  getConfigDir = configMod.getConfigDir
  initDataDir = configMod.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  handleMessage = (await import("../src/message-router")).handleMessage
  suggestCleanupRules = (await import("../src/threads/cleanup-rules")).suggestCleanupRules
  const cr = await import("../src/threads/context-refs")
  buildContextRefsSystemSegment = cr.buildContextRefsSystemSegment
  buildSummaryCard = cr.buildSummaryCard
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

test("suggestCleanupRules: empty + short_orphan + duplicate", () => {
  const now = new Date("2026-08-06T12:00:00Z")
  const cands = suggestCleanupRules(
    [
      { id: "e1", message_count: 0, alias: "" },
      {
        id: "s1",
        message_count: 1,
        has_assistant: false,
        first_user_len: 3,
        alias: "x",
      },
      { id: "d1", message_count: 5, alias: "同名" },
      { id: "d2", message_count: 4, alias: "同名" },
      {
        id: "old",
        message_count: 2,
        updated_at: "2026-01-01T00:00:00Z",
        alias: "old",
      },
    ],
    { now, stale_days: 30 },
  )
  assert.ok(cands.some((c) => c.thread_id === "e1" && c.reason === "empty"))
  assert.ok(cands.some((c) => c.thread_id === "s1" && c.reason === "short_orphan"))
  assert.ok(cands.some((c) => c.thread_id === "d2" && c.reason === "duplicate_alias"))
  assert.ok(!cands.some((c) => c.thread_id === "d1" && c.reason === "duplicate_alias"))
  assert.ok(cands.some((c) => c.thread_id === "old" && c.reason === "stale_thin"))
})

test("hygiene gold fixtures: rny77t / 4j6l6f / t4s8kw / vpfb7g", () => {
  const now = new Date("2026-08-17T12:00:00Z")
  const cands = suggestCleanupRules(
    [
      {
        id: "2b8ckp",
        alias: "",
        message_count: 0,
        user_message_count: 0,
        updated_at: "2026-08-17T05:41:03.494Z",
      },
      {
        id: "rny77t",
        alias: "",
        message_count: 2,
        user_message_count: 0,
        has_assistant: true,
        assistant_chars: 80,
        looks_like_acp: true,
        assistant_excerpt: "【编程接力 · pi · propose_diff】完成\nNo API key found",
        updated_at: "2026-08-14T08:35:03.695Z",
      },
      {
        id: "4j6l6f",
        alias: "p1-wl",
        message_count: 1,
        user_message_count: 0,
        has_assistant: true,
        assistant_chars: 80,
        looks_like_acp: true,
        assistant_excerpt: "【编程接力 · pi · propose_diff】完成\nNo API key found",
        updated_at: "2026-08-17T05:38:53.039Z",
      },
      {
        id: "t4s8kw",
        alias: "p1-wl",
        message_count: 1,
        user_message_count: 0,
        has_assistant: true,
        assistant_chars: 4000,
        looks_like_acp: true,
        assistant_excerpt: "【编程接力 · claude · propose_diff】完成\n## 模块映射",
        updated_at: "2026-08-14T00:14:19.473Z",
      },
      {
        id: "vpfb7g",
        alias: "p1-wl",
        message_count: 215,
        user_message_count: 3,
        has_assistant: true,
        first_user_len: 20,
        first_user_preview: "上海弘积调研",
        updated_at: "2026-08-13T13:56:07.325Z",
      },
      {
        id: "cxzzjr",
        alias: "p1-wl",
        message_count: 1,
        user_message_count: 1,
        has_assistant: false,
        first_user_len: 16,
        first_user_preview: "从投资角度看阿基视觉",
        updated_at: "2026-08-13T03:08:24.062Z",
      },
    ],
    { now },
  )
  const byId = Object.fromEntries(cands.map((c) => [c.thread_id, c]))
  assert.equal(byId["2b8ckp"]?.reason, "empty")
  assert.equal(byId["2b8ckp"]?.precheck, true)
  assert.equal(byId["rny77t"]?.reason, "acp_husk")
  assert.equal(byId["rny77t"]?.precheck, true)
  assert.equal(byId["4j6l6f"]?.reason, "acp_husk")
  assert.equal(byId["4j6l6f"]?.precheck, true)
  assert.equal(byId["t4s8kw"], undefined)
  assert.equal(byId["vpfb7g"], undefined)
  assert.equal(byId["cxzzjr"], undefined)
})

test("substantial ACP with timeout in body is omitted, not husk", () => {
  const body =
    "【编程接力 · claude · propose_diff】完成\n### 摘要\n" +
    "The review mentioned a timeout in the old path. ".repeat(20)
  const cands = suggestCleanupRules(
    [
      {
        id: "t4s8kw",
        alias: "p1-wl",
        message_count: 1,
        user_message_count: 0,
        has_assistant: true,
        assistant_chars: body.replace(/\s+/g, "").length,
        looks_like_acp: true,
        assistant_excerpt: body.slice(0, 400),
      },
    ],
    { now: new Date("2026-08-17T12:00:00Z") },
  )
  assert.equal(cands.length, 0)
})

test("active empty draft is excluded from suggestions", () => {
  const cands = suggestCleanupRules(
    [
      { id: "draft", alias: "", message_count: 0 },
      { id: "other", alias: "", message_count: 0 },
    ],
    { except_thread_id: "draft" },
  )
  assert.ok(!cands.some((c) => c.thread_id === "draft"))
  assert.ok(cands.some((c) => c.thread_id === "other" && c.reason === "empty" && c.precheck))
})

test("buildSummaryCard fallback without digest", () => {
  const card = buildSummaryCard({
    id: "abc",
    alias: "调研",
    first_user_preview: "对比三家定价",
  })
  assert.match(card, /调研/)
  assert.match(card, /对比三家/)
  assert.match(card, /ref|完整对话未注入|资料/)
})

test("buildContextRefsSystemSegment wraps fence and budget", () => {
  const seg = buildContextRefsSystemSegment([
    { id: "a", alias: "A", digest: { tldr: "t", tags: ["x"], content_fingerprint: "1:a", extracted_at: "", source: "manual" } },
    { id: "b", alias: "B", first_user_preview: "hello" },
  ])
  assert.match(seg, /```ref-thread/)
  assert.match(seg, /引用会话/)
  assert.match(seg, /#a/)
})

test("trash + restore + list filters", async () => {
  const tm = new ThreadManager()
  tm.create("A", "ta")
  tm.create("B", "tb")
  assert.equal(tm.list().length, 2)
  tm.trash("ta")
  assert.equal(tm.list().length, 1)
  assert.equal(tm.list({ only_trashed: true }).length, 1)
  assert.ok(tm.get("ta")?.trashed_at)
  tm.restore("ta")
  assert.equal(tm.list().length, 2)
  assert.equal(tm.get("ta")?.trashed_at, null)
})

test("suggest_cleanup via router", async () => {
  const tm = new ThreadManager()
  tm.create("empty", "e1")
  const resp = await handleMessage(
    { type: "thread.suggest_cleanup" },
    { threadManager: tm, skillEngine: {} as any, historyStore: {} as any },
  )
  assert.equal(resp.type, "thread.cleanup_suggestions")
  assert.ok(resp.suggestions.some((s: any) => s.thread_id === "e1" && s.reason === "empty"))
})

test("thread.list echoes list_scope for trash isolation (B2)", async () => {
  const tm = new ThreadManager()
  tm.create("A", "a1")
  tm.trash("a1")
  const active = await handleMessage(
    { type: "thread.list" },
    { threadManager: tm, skillEngine: {} as any, historyStore: {} as any },
  )
  assert.equal(active.list_scope, "active")
  assert.equal(active.threads.length, 0)
  assert.equal(active.trash_count, 1)

  const all = await handleMessage(
    { type: "thread.list", include_trashed: true },
    { threadManager: tm, skillEngine: {} as any, historyStore: {} as any },
  )
  assert.equal(all.list_scope, "all")
  assert.equal(all.threads.length, 1)
  assert.ok(all.threads[0].trashed_at)

  const only = await handleMessage(
    { type: "thread.list", only_trashed: true },
    { threadManager: tm, skillEngine: {} as any, historyStore: {} as any },
  )
  assert.equal(only.list_scope, "trash")
})

test("thread.delete default hard; explicit trash soft", async () => {
  const tm = new ThreadManager()
  tm.create("H", "h1")
  tm.create("S", "s1")
  const hard = await handleMessage(
    { type: "thread.delete", thread_id: "h1" },
    { threadManager: tm, skillEngine: {} as any, historyStore: {} as any },
  )
  assert.equal(hard.type, "thread.deleted")
  assert.equal(hard.mode, "hard")
  assert.equal(tm.get("h1"), undefined)

  const soft = await handleMessage(
    { type: "thread.delete", thread_id: "s1", mode: "trash" },
    { threadManager: tm, skillEngine: {} as any, historyStore: {} as any },
  )
  assert.equal(soft.type, "thread.trashed")
  assert.ok(tm.get("s1")?.trashed_at)
})

test("chat.create rejects trashed threads", async () => {
  const tm = new ThreadManager()
  tm.create("T", "tr1")
  tm.trash("tr1")
  const resp = await handleMessage(
    { type: "chat.create", thread_id: "tr1", message: "hi" },
    { threadManager: tm, skillEngine: {} as any, historyStore: {} as any },
    {
      sendToExtension: () => {},
      executeTool: async () => ({ success: true }),
    } as any,
  )
  assert.equal(resp.type, "chat.error")
  assert.equal(resp.error, "thread_trashed")
})

test("purgeExpiredTrash removes old trashed", () => {
  const tm = new ThreadManager()
  tm.create("old", "old1")
  tm.trash("old1")
  const indexPath = path.join(getConfigDir(), "threads", "index.json")
  const idx = JSON.parse(fs.readFileSync(indexPath, "utf-8"))
  const row = idx.threads.find((x: any) => x.id === "old1")
  assert.ok(row)
  row.trashed_at = "2020-01-01T00:00:00.000Z"
  fs.writeFileSync(indexPath, JSON.stringify(idx))
  const tm2 = new ThreadManager()
  const purged = tm2.purgeExpiredTrash(30, new Date("2026-08-06T00:00:00Z"))
  assert.ok(purged.includes("old1"))
  assert.equal(tm2.get("old1"), undefined)
})

test("purgeExpiredTrash batches multiple expired ids in one index rewrite", () => {
  const tm = new ThreadManager()
  for (const id of ["p1", "p2", "p3"]) {
    tm.create(id, id)
    tm.trash(id)
  }
  const indexPath = path.join(getConfigDir(), "threads", "index.json")
  const idx = JSON.parse(fs.readFileSync(indexPath, "utf-8"))
  for (const row of idx.threads) {
    if (["p1", "p2", "p3"].includes(row.id)) {
      row.trashed_at = "2020-01-01T00:00:00.000Z"
    }
  }
  fs.writeFileSync(indexPath, JSON.stringify(idx))
  const tm2 = new ThreadManager()
  const purged = tm2.purgeExpiredTrash(30, new Date("2026-08-06T00:00:00Z"))
  assert.equal(purged.length, 3)
  assert.equal(tm2.list({ include_trashed: true }).length, 0)
})
