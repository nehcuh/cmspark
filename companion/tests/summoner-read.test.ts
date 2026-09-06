// #433 P1 读路径 companion 侧 — thread.search / thread.peek / knowledge.search。
// 覆盖：检索正确性/拼音首字母/脱敏/peek 限长/ACL 矩阵/select 不流（纯函数形状）。
import test from "node:test"
import assert from "node:assert/strict"
import {
  searchThreadRows,
  peekThreadDistilled,
  knowledgeSearchRows,
  clampSearchLimit,
  normalizeSearchQuery,
  pinyinInitialsOf,
} from "../src/summoner/read-search"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { validateWsMessage } from "../src/ws/validate"

function thr(
  id: string,
  alias: string,
  digest?: { tldr?: string; tags?: string[]; bullets?: string[] },
  updated = "2026-09-06T10:00:00.000Z",
) {
  return { id, alias, digest, last_message_at: updated }
}

// ------------------------------------------------------------- thread.search ---

test("thread.search: alias word-prefix ranks first; unrelated excluded", () => {
  const rows = [
    thr("a1", "brew 排障记录", { tldr: "Homebrew 安装问题" }),
    thr("a2", "会议纪要：知识库规划", { tags: ["知识库"] }),
    thr("a3", "zsh 配置", { tldr: "terminal prompt" }),
  ]
  const hits = searchThreadRows(rows as any, "brew", 10)
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].thread_id, "a1")
  assert.ok(hits.some((h) => h.thread_id === "a3") === false, "无关联线程不进结果")
})

test("thread.search: matches digest tldr/tags (lower weight) and alias contains", () => {
  const rows = [
    thr("t1", "日常", { tags: ["排障", "brew"] }),
    thr("t2", "另一条", { tldr: "修复了 homebrew 升级失败" }),
    thr("t3", "无关", { tldr: "做饭" }),
  ]
  const byTag = searchThreadRows(rows as any, "brew", 10)
  assert.ok(byTag.some((h) => h.thread_id === "t1"), "tag 命中")
  const byTldr = searchThreadRows(rows as any, "homebrew", 10)
  assert.ok(byTldr.some((h) => h.thread_id === "t2"), "tldr 命中")
})

test("thread.search: CJK 拼音首字母命中 alias（'wb'→微博）", () => {
  const rows = [
    thr("p1", "微博抓取脚本", { tldr: "抓微博热搜" }),
    thr("p2", "其他笔记", { tldr: "无关" }),
  ]
  const hits = searchThreadRows(rows as any, "wb", 10)
  assert.ok(hits.length === 1, JSON.stringify(hits))
  assert.equal(hits[0].thread_id, "p1")
  assert.ok(pinyinInitialsOf("微博抓取脚本").includes("wb"))
})

test("thread.search: snippet only from digest (redacted), never messages", () => {
  const rows = [
    thr("s1", "密钥排查", { tldr: "发现了 sk-ABCDEFGH12345678 需要轮换" }),
  ]
  const hits = searchThreadRows(rows as any, "密钥", 10)
  assert.equal(hits.length, 1)
  assert.ok(!hits[0].snippet.includes("sk-ABCDEFGH12345678"), "snippet 必须脱敏")
  assert.ok(hits[0].snippet.includes("[REDACTED]") || !hits[0].snippet.includes("sk-"))
})

test("thread.search: limit clamp + recency tie-break", () => {
  const rows = [
    thr("r1", "alpha", { tldr: "x" }, "2026-09-01T00:00:00.000Z"),
    thr("r2", "alphabet", { tldr: "x" }, "2026-09-06T00:00:00.000Z"),
  ]
  const one = searchThreadRows(rows as any, "alpha", 1)
  assert.equal(one.length, 1)
  assert.equal(one[0].thread_id, "r2", "平局取最近活跃")
  assert.equal(clampSearchLimit(999), 20)
  assert.equal(clampSearchLimit(-1), 1)
  assert.equal(clampSearchLimit(undefined), 10)
})

// -------------------------------------------------------------- knowledge.search ---

test("knowledge.search: title prefix / description / tags matching", () => {
  const docs = [
    { id: "k1", name: "k1", title: "知识库索引设计", description: "派生索引与 display", tags: ["图谱"] },
    { id: "k2", name: "k2", title: "会议纪要模板", description: "议事与待办", tags: ["会议"] },
    { id: "k3", name: "k3", title: "其他", description: "", tags: [] },
  ]
  const titleHit = knowledgeSearchRows(docs as any, "知识库", 10)
  assert.ok(titleHit.length && titleHit[0].id === "k1")
  const descHit = knowledgeSearchRows(docs as any, "议事", 10)
  assert.ok(descHit.some((h) => h.id === "k2"))
  const none = knowledgeSearchRows(docs as any, "不存在的词", 10)
  assert.equal(none.length, 0)
  const pinyinHit = knowledgeSearchRows([{ id: "q", name: "q", title: "图谱可视化", description: "", tags: [] }] as any, "tp", 10)
  assert.ok(pinyinHit.length === 1, "拼音首字母 title 命中")
})

// -------------------------------------------------------------- peek（脱敏+限长） ---

test("thread.peek: redacts secrets from digest + messages; caps at 2000", () => {
  const digest = {
    extracted_at: "2026-09-01T00:00:00Z",
    content_fingerprint: "1:mid",
    tldr: "排查 api_key=sk-ABCDEFGH12345678 泄露",
    tags: ["安全"],
    bullets: ["轮换 ghpmock 已处理"],
    source: "manual" as const,
  }
  const manyMessages = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `第${i}段 ` + "y".repeat(700),
  }))
  const peek = peekThreadDistilled(
    "peek1",
    { alias: "密钥排查", digest },
    [
      { role: "user", content: "看一下 `sk-ABCDEFGH12345678` 是否有效" },
      ...manyMessages,
    ],
  )
  assert.equal(peek.ok, true)
  assert.ok(!peek.markdown.includes("sk-ABCDEFGH12345678"), "sk-… 必须被打码")
  assert.ok(!peek.markdown.includes("api_key=sk-"), "api_key= 形态必须打码")
  assert.ok(peek.markdown.includes("[REDACTED]"))
  assert.ok(peek.markdown.length <= 2000)
  assert.equal(peek.truncated, true)
  assert.equal(peek.thread_id, "peek1")
})

test("thread.peek: small thread not truncated; alias fallback title", () => {
  const peek = peekThreadDistilled("t", { alias: "短会话" }, [{ role: "user", content: "你好" }])
  assert.equal(peek.truncated, false)
  assert.ok(peek.title === "短会话" || peek.title.includes("短会话"))
})

// -------------------------------------------------------------- ACL + validate ---

test("#433: thread.search / thread.peek / knowledge.search 放行 summoner；distill_preview 仍拒", () => {
  for (const type of ["thread.search", "thread.peek", "knowledge.search", "thread.select", "history.query", "knowledge.list"]) {
    assert.deepEqual(assertSummonerAllowed("summoner", type), { ok: true }, `${type} 应放行 summoner`)
  }
  for (const type of ["thread.distill_preview", "config.set", "thread.execution_policy.set"]) {
    assert.equal(assertSummonerAllowed("summoner", type).ok, false, `${type} 不应放行 summoner`)
  }
})

test("validate: 三消息形状校验（query/limit/thread_id）", () => {
  assert.equal(validateWsMessage({ type: "thread.search", query: "brew" }).valid, true)
  assert.equal(validateWsMessage({ type: "thread.search", query: "" }).valid, false)
  assert.equal(validateWsMessage({ type: "thread.search", query: "x", limit: 99 }).valid, false)
  assert.equal(validateWsMessage({ type: "thread.peek", thread_id: "t1" }).valid, true)
  assert.equal(validateWsMessage({ type: "thread.peek" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.search", query: "图谱" }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.search", query: "  " }).valid, false)
})

test("normalizeSearchQuery trims + caps", () => {
  assert.equal(normalizeSearchQuery("  brew  排障 "), "brew 排障")
  assert.equal(normalizeSearchQuery("x".repeat(500)).length, 120)
})
