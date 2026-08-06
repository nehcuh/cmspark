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
  assert.ok(cands.some((c) => c.reason === "duplicate_alias"))
  assert.ok(cands.some((c) => c.thread_id === "old" && c.reason === "stale_thin"))
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
