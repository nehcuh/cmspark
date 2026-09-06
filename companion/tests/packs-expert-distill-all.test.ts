// #411 — 从全部历史归纳专家（方案 A 两级聚类）：spy 红线 + 行为。
//
// 红线（全部钉死）：
//   1. expert-distill-all.ts 不 import pack-engine / saveUserPack / installPack
//      （已装专家面由调用方传参；结构性零写入面）
//   2. 无定时器（setInterval/setTimeout）——一次性手点扫描，无后台
//   3. 草稿只进回包与内存 pendingDrafts（__all__:N），不落盘、不进 pack.list
//   4. LLM 调用数 = 批次数 + 归并 1 次（与 thread 数解耦）；总量 cap ≤200
//   5. 浅层画像优先（fresh digest → 首末问），深读 ≤20；伪造 thread_id 一律丢弃
//   6. user_gesture 强校验（validator + router 既有闸门）
import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-distill-all-"))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
fs.mkdirSync(process.env.CMSPARK_DATA_DIR!, { recursive: true })
process.on("exit", () => {
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

import {
  DISTILL_ALL_BATCH_SIZE,
  DISTILL_ALL_DEEP_READ_MAX,
  DISTILL_ALL_MAX_DRAFTS,
  DISTILL_ALL_MAX_THREADS,
  buildDistillAllCandidatePool,
  detectExpertConflict,
  distillAllExperts,
  distillAllScanCount,
} from "../src/packs/expert-distill-all"
import {
  clearPendingDistillDraft,
  listPendingDistillDrafts,
} from "../src/packs/expert-distill"
import { validateWsMessage } from "../src/ws/validate"
import type { LlmExtractConfig } from "../src/llm/llm-extract"

const SRC = path.resolve(__dirname, "..", "..", "src", "packs", "expert-distill-all.ts")

const LLM: LlmExtractConfig = {
  base_url: "https://example.test/v1",
  api_key: "k",
  model_name: "test-model",
  temperature: 0.3,
}

type Th = {
  id: string
  alias?: string
  agent_role?: "normal" | "orchestrator" | "worker" | null
  trashed_at?: string | null
  digest?: any
  topic_folder?: string | null
  created_at?: string
  updated_at?: string
  last_message_at?: string | null
}
type Msg = { id: string; role: string; content?: string }

function makeTm(threads: Th[], messages: Record<string, Msg[]>) {
  const byId = new Map(threads.map((t) => [t.id, t]))
  return {
    list: () => threads,
    get: (id: string) => byId.get(id),
    getMessages: (id: string) => messages[id] || [],
  }
}

/** 与 messages 对齐的 fresh digest（content_fingerprint = `${len}:${lastId}`）。 */
function freshDigest(messages: Msg[], tldr: string) {
  const last = messages[messages.length - 1]
  return {
    extracted_at: "2026-09-01T00:00:00.000Z",
    content_fingerprint: `${messages.length}:${last ? last.id : "empty"}`,
    tldr,
    tags: ["a"],
    bullets: ["要点一"],
    source: "manual",
  }
}

function userMsgs(...texts: string[]): Msg[] {
  return texts.map((t, i) => ({ id: `m${i + 1}`, role: "user", content: t }))
}

/** 批次/归并两阶段 mock：按 systemPrompt 关键字分流。 */
function twoPhaseImpl(opts: {
  batch: (ids: string[], call: number) => any
  merge: (callsSoFar: number) => any
}) {
  const calls: Array<{ systemPrompt: string; userContent: string }> = []
  const impl = async (p: { systemPrompt: string; userContent: string }) => {
    calls.push({ systemPrompt: p.systemPrompt, userContent: p.userContent })
    if (p.systemPrompt.includes("聚类")) {
      const ids = Array.from(p.userContent.matchAll(/\[(t[0-9a-z-]+)\]/g)).map((m) => m[1])
      return JSON.stringify(opts.batch(ids, calls.length))
    }
    return JSON.stringify(opts.merge(calls.length))
  }
  return { calls, impl }
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

function clearAllPending() {
  for (const p of listPendingDistillDrafts()) {
    if (p.thread_id.startsWith("__all__:")) clearPendingDistillDraft(p.thread_id)
  }
}

afterEach(() => clearAllPending())

// ---------------------------------------------------------------------------
// 红线（结构性）
// ---------------------------------------------------------------------------

test("spy: expert-distill-all.ts 无 pack-engine / saveUserPack / installPack / 定时器", () => {
  const src = stripComments(fs.readFileSync(SRC, "utf-8"))
  assert.ok(!/from ["'].*pack-engine/.test(src), "must not import pack-engine")
  assert.ok(!src.includes("saveUserPack"))
  assert.ok(!src.includes("installPack"))
  assert.ok(!src.includes("setInterval"))
  assert.ok(!src.includes("setTimeout"), "one-shot scan only — no timers")
})

test("spy: 常量符合票面（cap 200 / 批 20-30 / 深读 20 / 草稿 5）", () => {
  assert.equal(DISTILL_ALL_MAX_THREADS, 200)
  assert.ok(DISTILL_ALL_BATCH_SIZE >= 20 && DISTILL_ALL_BATCH_SIZE <= 30)
  assert.equal(DISTILL_ALL_DEEP_READ_MAX, 20)
  assert.equal(DISTILL_ALL_MAX_DRAFTS, 5)
})

// ---------------------------------------------------------------------------
// 候选池 + 预点数（零 LLM）
// ---------------------------------------------------------------------------

test("count: skip 规则 + digest 覆盖统计", () => {
  const digestMsgs = userMsgs("帮我分析财报")
  const tm = makeTm(
    [
      { id: "t-digest", alias: "投研", digest: freshDigest(digestMsgs, "财报分析") },
      { id: "t-plain", alias: "调研" },
      { id: "t-worker", alias: "工人", agent_role: "worker" },
      { id: "t-trash", alias: "垃圾", trashed_at: "2026-09-01T00:00:00.000Z" },
      { id: "t-empty", alias: "空的" },
      { id: "t-orch", alias: "编排", agent_role: "orchestrator" },
    ],
    {
      "t-digest": digestMsgs,
      "t-plain": userMsgs("做页面竞品分析"),
      "t-worker": userMsgs("x"),
      "t-trash": userMsgs("x"),
      "t-orch": userMsgs("x"),
    },
  )
  const c = distillAllScanCount(tm)
  assert.equal(c.eligible, 2)
  assert.equal(c.with_digest, 1)
  assert.equal(c.without_digest, 1)
  assert.equal(c.skipped.worker_or_orchestrator_thread, 2)
  assert.equal(c.skipped.trashed_thread, 1)
  assert.equal(c.skipped.empty_thread, 1)
  assert.equal(c.capped, false)
})

test("count: 排除项 — 话题夹 / 时间窗 / 关键词（命中别名或首末问）", () => {
  const tm = makeTm(
    [
      { id: "t-a", alias: "会议记录", topic_folder: "会议", last_message_at: "2026-09-05T00:00:00.000Z" },
      { id: "t-b", alias: "调研", last_message_at: "2026-08-01T00:00:00.000Z" },
      { id: "t-c", alias: "测试杂项", last_message_at: "2026-09-05T00:00:00.000Z" },
      { id: "t-d", alias: "正文命中", last_message_at: "2026-09-05T00:00:00.000Z" },
    ],
    {
      "t-a": userMsgs("开会"),
      "t-b": userMsgs("做调研"),
      "t-c": userMsgs("测试"),
      "t-d": userMsgs("这句话提到 sec-keyword 词"),
    },
  )
  const folders = distillAllScanCount(tm, { topic_folders: ["会议"] })
  assert.equal(folders.eligible, 3)
  const since = distillAllScanCount(tm, { since: "2026-08-15T00:00:00.000Z" })
  assert.equal(since.eligible, 3)
  const kw = distillAllScanCount(tm, { exclude_keyword: "sec-keyword" })
  assert.equal(kw.eligible, 3, "keyword hits alias or first/last user preview")
})

// pi 复审（PR #416）：digest.bullets 非数组（手改 index.json 的垃圾形状）且
// 指纹相等时，`(bullets ?? []).slice` 抛 TypeError —— tags 有守卫 bullets 没有。
test("count/scan: digest.bullets 非数组（如 42）不抛 TypeError，画像退回 TL;DR 行", async () => {
  const msgs = userMsgs("帮我分析财报", "再补充一下")
  const junkDigest = {
    ...freshDigest(msgs, "财报分析要点"),
    bullets: 42,
    tags: "not-array-either",
  }
  const tm = makeTm([{ id: "t-junk", alias: "坏摘要", digest: junkDigest }], { "t-junk": msgs })
  // count 路径（同步）不抛
  const c = distillAllScanCount(tm)
  assert.equal(c.eligible, 1)
  assert.equal(c.with_digest, 1, "TL;DR 行仍在 → 画像仍走 digest 路径")
  // 全量扫描路径同样不抛（batch userContent 含 TL;DR、不含垃圾 bullets）
  const { calls, impl } = twoPhaseImpl({
    batch: (ids) => ({ candidates: [{ name: "A", description: "d", thread_ids: ids.slice(0, 2), signal: "s" }], deep_read: [] }),
    merge: () => ({ drafts: [] }),
  })
  const r = await distillAllExperts({
    threadManager: tm,
    llm: LLM,
    deps: { llmExtractImpl: impl as any },
  })
  assert.ok(r.ok)
  const batchCall = calls.find((x) => x.systemPrompt.includes("聚类"))
  assert.ok(batchCall)
  assert.ok(batchCall.userContent.includes("财报分析要点"), "TL;DR survives junk bullets")
})

test("候选池按最近活跃倒序 + cap 200", () => {  const threads: Th[] = []
  const messages: Record<string, Msg[]> = {}
  for (let i = 0; i < 205; i++) {
    const id = `t${String(i).padStart(3, "0")}`
    threads.push({
      id,
      alias: id,
      last_message_at: new Date(2026, 0, 1 + i).toISOString(),
    })
    messages[id] = userMsgs(`内容 ${i}`)
  }
  const pool = buildDistillAllCandidatePool(makeTm(threads, messages))
  assert.equal(pool.candidates.length, 205)
  const count = distillAllScanCount(makeTm(threads, messages))
  assert.equal(count.eligible, DISTILL_ALL_MAX_THREADS, "capped at 200")
  assert.equal(count.capped, true)
  assert.equal(pool.candidates[0].id, "t204", "most recent first")
})

// ---------------------------------------------------------------------------
// 全量扫描：分批 → 深读 → 归并
// ---------------------------------------------------------------------------

function genThreads(n: number): { threads: Th[]; messages: Record<string, Msg[]> } {
  const threads: Th[] = []
  const messages: Record<string, Msg[]> = {}
  for (let i = 1; i <= n; i++) {
    const id = `t${String(i).padStart(3, "0")}`
    threads.push({ id, alias: `对话${i}`, last_message_at: new Date(2026, 8, 1, 0, i).toISOString() })
    messages[id] = userMsgs(`第 ${i} 条对话的首问`, `第 ${i} 条对话的补充`)
  }
  return { threads, messages }
}

const MERGE_DRAFTS = {
  drafts: [
    {
      name: "投研助手",
      description: "分析财报与研报",
      system_prompt_append: "你是投研助手。只基于页面内容做分析。",
      tools: ["get_page_text", "screenshot", "shell_exec"],
      suitable_for: ["页面信息抽取"],
      unsuitable_for: ["需要主机操作的任务"],
      evidence: [
        { quote: "帮我分析这份财报", hint: "用户核心诉求", thread_ids: ["t001", "t002", "FAKE-ID"] },
      ],
      thread_ids: ["t001", "t026", "FAKE-ID"],
    },
    {
      name: "发布工程",
      description: "出包与发布",
      system_prompt_append: "你是发布工程专家。",
      tools: ["get_page_text"],
      evidence: [],
      thread_ids: ["t002", "t027"],
    },
    {
      name: "坏草稿-单线程",
      description: "会被丢弃",
      system_prompt_append: "x",
      tools: [],
      evidence: [],
      thread_ids: ["t003"],
    },
    {
      name: "",
      description: "无名也被丢弃",
      system_prompt_append: "x",
      tools: [],
      evidence: [],
      thread_ids: ["t003", "t004"],
    },
  ],
}

test("scan: 200 条 → 8 批 + 1 归并；伪造 id 丢弃；单线程草稿丢弃；深读 cap 20", async () => {
  const { threads, messages } = genThreads(200)
  const tm = makeTm(threads, messages)

  const { calls, impl } = twoPhaseImpl({
    batch: (ids) => ({
      candidates: [
        { name: "角色A", description: "职责", thread_ids: ids.slice(0, 2), signal: "跨线程" },
        { name: "角色B", description: "职责", thread_ids: [ids[0]], signal: "单线程被companion丢弃" },
        { name: "角色C", description: "职责", thread_ids: ["FAKE"], signal: "伪造id被丢弃" },
      ],
      deep_read: ids.slice(0, 3),
    }),
    merge: () => MERGE_DRAFTS,
  })

  const r = await distillAllExperts({
    threadManager: tm,
    llm: LLM,
    deps: { llmExtractImpl: impl as any },
  })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.scanned, 200)
  assert.equal(r.batches, 8)
  assert.equal(r.llm_calls, 9, "8 batch calls + 1 merge")
  assert.equal(r.deep_read, 20, "24 wanted (8×3) capped at 20")
  assert.equal(r.drafts.length, 2, "single-thread & nameless drafts dropped")

  const d1 = r.drafts[0]
  assert.equal(d1.name, "投研助手")
  assert.deepEqual(d1.thread_ids, ["t001", "t026"], "fabricated ids dropped")
  assert.ok(!d1.thread_ids.includes("FAKE-ID"))
  assert.ok(!d1.evidence[0].thread_ids?.includes("FAKE-ID"))
  // shell_exec 被保守面 clamp
  assert.deepEqual(d1.tools.allow, ["get_page_text", "screenshot"])
  assert.equal(d1.tools.mode, "allowlist")
  // 证据带多 thread 出处
  assert.ok((d1.evidence[0].thread_ids?.length ?? 0) >= 2)

  // 草稿进内存 pending（__all__:N），不落盘：DATA_DIR 下任何文件都不含草稿文本
  const pending = listPendingDistillDrafts().filter((p) => p.thread_id.startsWith("__all__:"))
  assert.equal(pending.length, 2)
  const hits: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name)
      if (e.isDirectory()) walk(fp)
      else if (fs.readFileSync(fp, "utf-8").includes("投研助手")) hits.push(fp)
    }
  }
  walk(process.env.CMSPARK_DATA_DIR!)
  assert.deepEqual(hits, [], "draft text must never land anywhere under DATA_DIR")
  assert.ok(!fs.existsSync(path.join(process.env.CMSPARK_DATA_DIR!, "packs")), "no packs dir materialized")

  // 浅层画像不读全量正文：userContent 只有每线程一行画像（≤ 200 行 × cap）
  const batchCall = calls.find((c) => c.systemPrompt.includes("聚类"))
  assert.ok(batchCall)
  const lines = batchCall.userContent.split("\n").filter((l) => l.trim())
  assert.equal(lines.length, DISTILL_ALL_BATCH_SIZE, "one shallow line per thread per batch")
})

test("scan: 批内无有效候选 → 跳过归并、ok 降级（fallback_reason）", async () => {
  const { threads, messages } = genThreads(30)
  const { calls, impl } = twoPhaseImpl({
    batch: () => ({ candidates: [], deep_read: [] }),
    merge: () => MERGE_DRAFTS,
  })
  const r = await distillAllExperts({
    threadManager: makeTm(threads, messages),
    llm: LLM,
    deps: { llmExtractImpl: impl as any },
  })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.batches, 2)
  assert.equal(r.llm_calls, 2, "merge never called without candidates")
  assert.equal(r.drafts.length, 0)
  assert.ok(r.fallback_reason?.includes("没有跨线程"))
  assert.equal(calls.filter((c) => c.systemPrompt.includes("归并")).length, 0)
})

test("scan: 全部批次 LLM 失败 → 降级不抛出", async () => {
  const { threads, messages } = genThreads(10)
  const impl = async (p: { systemPrompt: string }) => {
    if (p.systemPrompt.includes("聚类")) throw new Error("boom")
    return JSON.stringify(MERGE_DRAFTS)
  }
  const r = await distillAllExperts({
    threadManager: makeTm(threads, messages),
    llm: LLM,
    deps: { llmExtractImpl: impl as any },
  })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.fallback_reason, "全部批次的 LLM 调用失败")
  assert.equal(r.drafts.length, 0)
})

test("scan: LLM 输出围栏/噪声容错解析", async () => {
  const { threads, messages } = genThreads(30)
  const impl = async (p: { systemPrompt: string; userContent: string }) => {
    if (p.systemPrompt.includes("聚类")) {
      const ids = Array.from(p.userContent.matchAll(/\[(t[0-9a-z-]+)\]/g)).map((m) => m[1])
      return (
        "前置噪声```json\n" +
        JSON.stringify({
          candidates: [
            { name: "角色A", description: "d", thread_ids: ids.slice(0, 2), signal: "s" },
          ],
          deep_read: [],
        }) +
        "\n```后置"
      )
    }
    return "```json\n" + JSON.stringify(MERGE_DRAFTS) + "\n```"
  }
  const r = await distillAllExperts({
    threadManager: makeTm(threads, messages),
    llm: LLM,
    deps: { llmExtractImpl: impl as any },
  })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.drafts.length, 2, "fenced JSON parsed for both stages")
})

// ---------------------------------------------------------------------------
// 与已装专家去重（覆盖/另存语义）
// ---------------------------------------------------------------------------

test("conflicts: 名字相同或工具面 Jaccard ≥0.8 → conflicts_with", async () => {
  const { threads, messages } = genThreads(30)
  const mk = (installed: Array<{ name: string; tools_allow: string[] }>) =>
    distillAllExperts({
      threadManager: makeTm(threads, messages),
      llm: LLM,
      installedExperts: installed,
      deps: { llmExtractImpl: twoPhaseImpl({
        batch: (ids) => ({ candidates: [{ name: "A", description: "d", thread_ids: ids.slice(0, 2), signal: "s" }], deep_read: [] }),
        merge: () => MERGE_DRAFTS,
      }).impl as any },
    })
  const byName = await mk([{ name: "投研助手", tools_allow: [] }])
  assert.ok(byName.ok && byName.drafts[0].conflicts_with === "投研助手")

  const byTools = await mk([{ name: "别的专家", tools_allow: ["get_page_text", "screenshot"] }])
  assert.ok(byTools.ok && byTools.drafts[0].conflicts_with === "别的专家", "Jaccard=1.0 on same tool face")

  const clean = await mk([{ name: "无关专家", tools_allow: ["navigate", "click"] }])
  assert.ok(clean.ok && clean.drafts[0].conflicts_with === undefined)
})

test("detectExpertConflict 纯函数边界：空工具面不判 Jaccard 冲突", () => {
  assert.equal(detectExpertConflict({ name: "X", tools: [] }, [{ name: "Y", tools_allow: [] }]), null)
  assert.equal(
    detectExpertConflict({ name: "y", tools: ["get_page_text"] }, [{ name: "Y", tools_allow: ["get_page_text"] }]),
    "Y",
    "name match is case-insensitive",
  )
})

// ---------------------------------------------------------------------------
// 降级与门禁
// ---------------------------------------------------------------------------

test("无 LLM 配置 → llm_not_configured（聚类是 LLM 的活，不给启发式假象）", async () => {
  const { threads, messages } = genThreads(3)
  const r = await distillAllExperts({ threadManager: makeTm(threads, messages), llm: null })
  assert.ok(!r.ok)
  if (r.ok) return
  assert.equal(r.code, "llm_not_configured")
})

test("无可归纳线程 → no_candidates", async () => {
  const tm = makeTm([{ id: "t-w", alias: "w", agent_role: "worker" }], { "t-w": userMsgs("x") })
  const r = await distillAllExperts({ threadManager: tm, llm: LLM })
  assert.ok(!r.ok)
  if (r.ok) return
  assert.equal(r.code, "no_candidates")
})

test("redact spy：浅层画像先脱敏再发 LLM（裸密钥不进 userContent）", async () => {
  const msgs = userMsgs("用 api_key=sk-ant-api03-abcdef1234567890abcdef 查一下")
  const tm = makeTm([{ id: "t-sec", alias: "安全" }], { "t-sec": msgs })
  const { calls, impl } = twoPhaseImpl({
    batch: (ids) => ({ candidates: [{ name: "A", description: "d", thread_ids: ids.slice(0, 2), signal: "s" }], deep_read: [] }),
    merge: () => MERGE_DRAFTS,
  })
  const r = await distillAllExperts({
    threadManager: tm,
    llm: LLM,
    deps: { llmExtractImpl: impl as any },
  })
  assert.ok(r.ok)
  const batchCall = calls.find((c) => c.systemPrompt.includes("聚类"))
  assert.ok(batchCall)
  assert.ok(!batchCall.userContent.includes("sk-ant-api03"), "raw key never reaches LLM")
})

// ---------------------------------------------------------------------------
// validator：user_gesture 强校验 + exclude 形状
// ---------------------------------------------------------------------------

test("validator: pack.distill_all_scan 必须 user_gesture:true；exclude 形状校验", () => {
  assert.ok(!validateWsMessage({ type: "pack.distill_all_scan" }).valid, "gesture required")
  assert.ok(
    !validateWsMessage({ type: "pack.distill_all_scan", user_gesture: false }).valid,
  )
  assert.ok(
    validateWsMessage({ type: "pack.distill_all_scan", user_gesture: true }).valid,
  )
  assert.ok(
    validateWsMessage({
      type: "pack.distill_all_scan",
      user_gesture: true,
      count_only: true,
    }).valid,
  )
  assert.ok(
    !validateWsMessage({
      type: "pack.distill_all_scan",
      user_gesture: true,
      count_only: "yes",
    }).valid,
    "count_only must be boolean",
  )
  assert.ok(
    validateWsMessage({
      type: "pack.distill_all_scan",
      user_gesture: true,
      exclude: { topic_folders: ["会议"], since: "2026-08-01T00:00:00.000Z", exclude_keyword: "x" },
    }).valid,
  )
  assert.ok(
    !validateWsMessage({
      type: "pack.distill_all_scan",
      user_gesture: true,
      exclude: { topic_folders: "会议" },
    }).valid,
    "topic_folders must be string[]",
  )
})
