/**
 * Thread History IA — digest normalize + batch_auto_title (no live LLM).
 */
import "./_threads-history-setup.js"
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let getConfigDir: typeof import("../src/config").getConfigDir
let initDataDir: typeof import("../src/config").initDataDir
let handleMessage: typeof import("../src/message-router").handleMessage
let normalizeTag: typeof import("../src/threads/digest").normalizeTag
let normalizeTags: typeof import("../src/threads/digest").normalizeTags
let contentFingerprint: typeof import("../src/threads/digest").contentFingerprint
let aliasFromFirstUserText: typeof import("../src/threads/digest").aliasFromFirstUserText
let isDigestStale: typeof import("../src/threads/digest").isDigestStale
let sanitizeDigest: typeof import("../src/threads/digest").sanitizeDigest

before(async () => {
  const configMod = await import("../src/config")
  getConfigDir = configMod.getConfigDir
  initDataDir = configMod.initDataDir
  await initDataDir()

  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  handleMessage = (await import("../src/message-router")).handleMessage
  const dig = await import("../src/threads/digest")
  normalizeTag = dig.normalizeTag
  normalizeTags = dig.normalizeTags
  contentFingerprint = dig.contentFingerprint
  aliasFromFirstUserText = dig.aliasFromFirstUserText
  isDigestStale = dig.isDigestStale
  sanitizeDigest = dig.sanitizeDigest
})

after(() => {
  /* setup tmp cleaned on process exit */
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

test("normalizeTag: lower, strip #, reject secrets", () => {
  assert.equal(normalizeTag("#竞品"), "竞品")
  assert.equal(normalizeTag("  Alpha  "), "alpha")
  assert.equal(normalizeTag("sk-abc123secret"), null)
  assert.equal(normalizeTag("api_key"), null)
  assert.equal(normalizeTag("bearer token-ish"), null)
  assert.equal(normalizeTag(""), null)
})

test("normalizeTags: dedupe + max 8", () => {
  const tags = normalizeTags(["A", "a", "B", "c", "d", "e", "f", "g", "h", "i", "j"])
  assert.equal(tags.length, 8)
  assert.deepEqual(tags.slice(0, 2), ["a", "b"])
})

test("contentFingerprint pin", () => {
  assert.equal(contentFingerprint([]), "0:empty")
  assert.equal(
    contentFingerprint([
      { id: "m1", role: "user" },
      { id: "m2", role: "assistant" },
    ]),
    "2:m2",
  )
})

test("isDigestStale", () => {
  const msgs = [{ id: "a", role: "user", content: "hi" }]
  const dig = {
    extracted_at: "2026-01-01T00:00:00.000Z",
    content_fingerprint: "1:a",
    tldr: "x",
    tags: [],
    source: "manual" as const,
  }
  assert.equal(isDigestStale(dig, msgs), false)
  assert.equal(isDigestStale(dig, [...msgs, { id: "b", role: "assistant", content: "y" }]), true)
})

test("sanitizeDigest clamps fields", () => {
  const d = sanitizeDigest({
    tldr: "x".repeat(200),
    tags: ["#OK", "sk-bad"],
    bullets: ["one", "two"],
    content_fingerprint: "1:x",
    source: "manual",
  })
  assert.ok(d)
  assert.ok(d!.tldr.length <= 120)
  assert.deepEqual(d!.tags, ["ok"])
  assert.deepEqual(d!.bullets, ["one", "two"])
})

test("aliasFromFirstUserText", () => {
  assert.equal(aliasFromFirstUserText("帮我对比定价"), "对比定价")
})

test("batch_auto_title fills empty aliases from first user message", async () => {
  const tm = new ThreadManager()
  const a = tm.create("", "ta")
  tm.addMessage(a.id, { thread_id: a.id, role: "user", content: "帮我写一份竞品分析大纲" })
  const b = tm.create("已有标题", "tb")
  tm.addMessage(b.id, { thread_id: b.id, role: "user", content: "不会被覆盖" })
  const c = tm.create("", "tc") // no messages

  const broadcasts: any[] = []
  const resp = await handleMessage(
    { type: "thread.batch_auto_title", only_empty: true },
    { threadManager: tm, skillEngine: {} as any, historyStore: {} as any },
    {
      sendToExtension: () => {},
      executeTool: async () => ({ success: true }),
      broadcast: (m: any) => broadcasts.push(m),
    } as any,
  )

  assert.equal(resp.type, "thread.batch_auto_title.completed")
  assert.equal(resp.updated_count, 1)
  assert.equal(tm.get("ta")?.alias.includes("竞品") || tm.get("ta")?.alias.includes("分析"), true)
  assert.equal(tm.get("tb")?.alias, "已有标题")
  assert.equal(tm.get("tc")?.alias, "")
  assert.ok(broadcasts.some((m) => m.type === "thread.updated" && m.thread?.id === "ta"))
})

test("thread update persists digest on index", () => {
  const tm = new ThreadManager()
  const t = tm.create("D", "td")
  const next = tm.update(t.id, {
    digest: {
      extracted_at: "2026-08-06T00:00:00.000Z",
      content_fingerprint: "0:empty",
      tldr: "摘要",
      tags: ["测试", "Digest"],
      source: "manual",
    },
  })
  assert.ok(next?.digest)
  assert.deepEqual(next!.digest!.tags, ["测试", "digest"])
  const reloaded = new ThreadManager().get("td")
  assert.equal(reloaded?.digest?.tldr, "摘要")
})

test("saveIndex merges peer digests so stale process cannot wipe tags", () => {
  // Process A: write digest
  const a = new ThreadManager()
  const t = a.create("peer", "peer1")
  a.update(t.id, {
    digest: {
      extracted_at: "2026-08-08T00:00:00.000Z",
      content_fingerprint: "0:empty",
      tldr: "peer-tldr",
      tags: ["标签甲", "标签乙"],
      source: "manual",
    },
  })
  assert.ok(a.get("peer1")?.digest?.tags?.length)

  // Process B: loaded before digests existed — only has alias/messages, then saveIndex
  // Simulate by constructing a manager that shares the same data dir but drops digest in memory.
  const b = new ThreadManager()
  const row = b.get("peer1")
  assert.ok(row)
  // Stale in-memory wipe: clear digest on the object without going through update(null)
  delete (row as { digest?: unknown }).digest
  assert.equal(b.get("peer1")?.digest, undefined)
  // Any index write (e.g. addMessage / alias bump) must not erase disk digests
  b.update("peer1", { alias: "peer-renamed" })
  const after = b.get("peer1")
  assert.equal(after?.alias, "peer-renamed")
  assert.ok(after?.digest, "digest restored from disk on save")
  assert.deepEqual(after!.digest!.tags, ["标签甲", "标签乙"])

  // Fresh process still sees tags
  const c = new ThreadManager()
  assert.deepEqual(c.get("peer1")?.digest?.tags, ["标签甲", "标签乙"])
})

test("listWithPreviews single-pass marks digest stale without second API", () => {
  const tm = new ThreadManager()
  const t = tm.create("S", "stale1")
  tm.addMessage(t.id, { thread_id: t.id, role: "user", content: "hello world preview" })
  tm.update(t.id, {
    digest: {
      extracted_at: "2026-01-01T00:00:00.000Z",
      content_fingerprint: "0:empty", // wrong on purpose
      tldr: "old",
      tags: ["x"],
      source: "manual",
    },
  })
  const list = tm.listWithPreviews()
  const row = list.find((x) => x.id === "stale1")
  assert.ok(row)
  assert.match(row!.first_user_preview, /hello/)
  assert.equal((row!.digest as any)?.stale, true)
})
