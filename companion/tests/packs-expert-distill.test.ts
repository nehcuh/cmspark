// #370 I4 — 从本对话归纳专家草稿：spy 红线（票面验收）+ 行为。
//
// 红线（全部钉死）：
//   1. preview 路径 saveUserPack/installPack 零调用（结构性 + 行为性）
//   2. 草稿不进 pack.list（listInstalledPacks 前后不变）
//   3. 全库路径 0 次 llmExtract（注入计数 impl；无定时器/全库扫描面）
//   4. armed 默认 off；未 armed drain 拒绝
//   5. 队列文件仅任务指针 + 语料 id（无正文、无草稿）
//   6. 无 LLM 配置 → 启发式空草稿，面板照常可用
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-distill-"))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
process.on("exit", () => {
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

import {
  DISTILL_LLM_NOTICE,
  DISTILL_RESTART_LOSS_NOTE,
  SAFE_DISTILL_TOOLS,
  armDistillQueue,
  buildDistillCorpus,
  clampDistillTools,
  disarmDistillQueue,
  distillExpertDraft,
  distillQueueStatus,
  drainDistillQueue,
  getPendingDistillDraft,
  loadDistillQueue,
  type DistillDraft,
} from "../src/packs/expert-distill"
import { listInstalledPacks } from "../src/packs/pack-engine"
import type { LlmExtractConfig } from "../src/llm/llm-extract"

const SRC = path.resolve(__dirname, "..", "..", "src", "packs", "expert-distill.ts")
const ROUTER_SRC = path.resolve(__dirname, "..", "..", "src", "message-router.ts")
const QUEUE_FILE = path.join(process.env.CMSPARK_DATA_DIR!, "cache", "expert-distill-queue.json")

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
}
type Msg = { id: string; role: string; content?: string }

function makeTm(threads: Record<string, Th>, messages: Record<string, Msg[]>) {
  return {
    get: (id: string) => threads[id],
    getMessages: (id: string) => messages[id] || [],
  }
}

const GOOD_DRAFT_JSON = JSON.stringify({
  name: "投研助手",
  description: "分析财报与研报",
  system_prompt_append: "你是投研助手。只基于页面内容做分析，不做交易建议。",
  tools: ["get_page_text", "screenshot", "shell_exec", "get_page_text"],
  suitable_for: ["页面信息抽取"],
  unsuitable_for: ["需要主机操作的任务"],
  evidence: [{ quote: "帮我分析这份财报", hint: "用户核心诉求" }],
})

function countingImpl(raw: string) {
  const calls: Array<{ systemPrompt: string; userContent: string }> = []
  const impl = async (p: { systemPrompt: string; userContent: string }) => {
    calls.push({ systemPrompt: p.systemPrompt, userContent: p.userContent })
    return raw
  }
  return { calls, impl }
}

// ---------------------------------------------------------------------------
// 红线 1+3（结构性）：模块源不 import pack-engine / 无定时器 / 无 threads 扫描
// ---------------------------------------------------------------------------

/** 去注释后做结构性断言——模块文档里「不 import saveUserPack」的说明本身不该踩雷。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

test("spy: expert-distill.ts 无 pack-engine / saveUserPack / installPack / 定时器", () => {
  const src = stripComments(fs.readFileSync(SRC, "utf-8"))
  assert.ok(!/from ["'].*pack-engine/.test(src), "must not import pack-engine")
  assert.ok(!src.includes("saveUserPack"))
  assert.ok(!src.includes("installPack"))
  assert.ok(!src.includes("setInterval"))
  assert.ok(!src.includes("setTimeout"))
  assert.ok(!/readdirSync\([^)]*threads/.test(src), "no threads-dir scan (全库路径)")
})

test("spy: router distill case 块内零 saveUserPack/installPack（保存只走 pack.save_user 既有路径）", () => {
  const src = stripComments(fs.readFileSync(ROUTER_SRC, "utf-8"))
  const start = src.indexOf('case "pack.distill_expert"')
  const end = src.indexOf('case "modules.list"', start)
  assert.ok(start > 0 && end > start, "distill case block found")
  const block = src.slice(start, end)
  assert.ok(!block.includes("saveUserPack"))
  assert.ok(!block.includes("installPack"))
})

// ---------------------------------------------------------------------------
// 红线 2（行为性）：preview 后 pack.list 计数不变
// ---------------------------------------------------------------------------

test("spy: distill preview 后 listInstalledPacks 集合不变（草稿不进 pack.list）", async () => {
  const tm = makeTm(
    { "t-ok": { id: "t-ok", alias: "调研" } },
    { "t-ok": [{ id: "m1", role: "user", content: "帮我做页面竞品分析" }] },
  )
  const before = listInstalledPacks().map((p: any) => p.id).sort()
  const { impl } = countingImpl(GOOD_DRAFT_JSON)
  const r = await distillExpertDraft({ thread_id: "t-ok", threadManager: tm, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  const after = listInstalledPacks().map((p: any) => p.id).sort()
  assert.deepEqual(after, before, "pack.list must be unchanged by preview")
  // pack 存档目录（listInstalledPacks 首调会物化 builtin）里绝无草稿痕迹
  const packsRoot = path.join(process.env.CMSPARK_DATA_DIR!, "packs")
  if (fs.existsSync(packsRoot)) {
    const names: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name)
        if (e.isDirectory()) walk(fp)
        else names.push(fs.readFileSync(fp, "utf-8").slice(0, 20000))
      }
    }
    walk(packsRoot)
    for (const content of names) {
      assert.ok(!content.includes("投研助手"), "draft text must never land in pack storage")
    }
  }
})

// ---------------------------------------------------------------------------
// distillExpertDraft：一次 llmExtract + clamp + redact + fallback
// ---------------------------------------------------------------------------

test("llm 路径：恰好 1 次 llmExtract；工具 clamp 到保守面；证据带出", async () => {
  const tm = makeTm(
    { "t-ok": { id: "t-ok", alias: "调研" } },
    { "t-ok": [{ id: "m1", role: "user", content: "帮我做页面竞品分析" }] },
  )
  const { calls, impl } = countingImpl(GOOD_DRAFT_JSON)
  const r = await distillExpertDraft({ thread_id: "t-ok", threadManager: tm, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.source, "llm")
  assert.equal(calls.length, 1, "exactly one llmExtract per manual distill")
  assert.equal(r.draft.name, "投研助手")
  // shell_exec 被丢；重复 get_page_text 去重
  assert.deepEqual(r.draft.tools.allow, ["get_page_text", "screenshot"])
  assert.deepEqual(r.draft.tools.mode, "allowlist")
  assert.equal(r.draft.evidence[0]?.quote, "帮我分析这份财报")
  assert.ok(r.notice.includes("LLM"))
  assert.ok(SAFE_DISTILL_TOOLS.includes("get_page_text"))
  assert.ok(!SAFE_DISTILL_TOOLS.includes("shell_exec"))
})

test("redact spy：语料先脱敏再发 LLM（裸密钥不进 userContent）", async () => {
  const tm = makeTm(
    { "t-sec": { id: "t-sec" } },
    {
      "t-sec": [
        { id: "m1", role: "user", content: "用 api_key=sk-ant-api03-abcdef1234567890abcdef 查一下" },
        { id: "m2", role: "assistant", content: "好的" },
      ],
    },
  )
  const { calls, impl } = countingImpl(GOOD_DRAFT_JSON)
  const r = await distillExpertDraft({ thread_id: "t-sec", threadManager: tm, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  const sent = calls[0]?.userContent || ""
  assert.ok(!sent.includes("sk-ant-api03"), "raw key must never reach LLM")
  assert.ok(sent.includes("[已脱敏]"))
})

test("LLM 输出不可解析 → 启发式空草稿 + fallback_reason（面板仍可用）", async () => {
  const tm = makeTm({ "t-x": { id: "t-x", alias: "测试线程" } }, { "t-x": [{ id: "m1", role: "user", content: "内容" }] })
  const { impl } = countingImpl("这不是 JSON")
  const r = await distillExpertDraft({ thread_id: "t-x", threadManager: tm, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.source, "heuristic")
  assert.equal(r.fallback_reason, "LLM 输出无法解析为草稿")
  assert.equal(r.draft.system_prompt_append, "")
  assert.deepEqual(r.draft.tools.allow, [])
})

test("LLM 抛错 → 启发式空草稿（不抛出到 UI）", async () => {
  const tm = makeTm({ "t-x": { id: "t-x" } }, { "t-x": [{ id: "m1", role: "user", content: "内容" }] })
  const impl = async () => {
    throw new Error("boom")
  }
  const r = await distillExpertDraft({ thread_id: "t-x", threadManager: tm, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.source, "heuristic")
  assert.equal(r.fallback_reason, "LLM 调用失败")
})

test("红线 6：无 LLM 配置 → 0 次 llmExtract + 启发式空草稿", async () => {
  const tm = makeTm({ "t-x": { id: "t-x", alias: "离线" } }, { "t-x": [{ id: "m1", role: "user", content: "内容" }] })
  const { calls, impl } = countingImpl(GOOD_DRAFT_JSON)
  const r = await distillExpertDraft({ thread_id: "t-x", threadManager: tm, llm: null, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.source, "heuristic")
  assert.equal(r.fallback_reason, "未配置 LLM")
  assert.equal(calls.length, 0, "no llmExtract without llm config")
  assert.equal(r.draft.name, "离线")
})

// ---------------------------------------------------------------------------
// 跳过规则：worker/orchestrator/trashed/会议/不存在/空 → 0 次 llmExtract
// ---------------------------------------------------------------------------

test("skip spy：worker/orchestrator/回收站/不存在/空线程 → 0 次 llmExtract", async () => {
  const threads: Record<string, Th> = {
    "t-worker": { id: "t-worker", agent_role: "worker" },
    "t-orch": { id: "t-orch", agent_role: "orchestrator" },
    "t-trash": { id: "t-trash", trashed_at: "2026-09-01T00:00:00Z" },
    "t-empty": { id: "t-empty" },
  }
  const messages: Record<string, Msg[]> = {
    "t-worker": [{ id: "w1", role: "user", content: "内容" }],
    "t-orch": [{ id: "o1", role: "user", content: "内容" }],
    "t-trash": [{ id: "tr1", role: "user", content: "内容" }],
    "t-empty": [],
  }
  const tm = makeTm(threads, messages)
  const { calls, impl } = countingImpl(GOOD_DRAFT_JSON)
  for (const tid of ["t-worker", "t-orch", "t-trash", "t-empty", "t-missing"]) {
    const r = await distillExpertDraft({ thread_id: tid, threadManager: tm, llm: LLM, deps: { llmExtractImpl: impl as any } })
    assert.ok(!r.ok, `${tid} should skip`)
  }
  assert.equal(calls.length, 0, "skip paths never call llmExtract")
})

test("skip spy：会议 thread（meetings/<id>/meta.json.thread_id 回指）→ 0 次 llmExtract", async () => {
  const meetRoot = path.join(process.env.CMSPARK_DATA_DIR!, "meetings", "meet-1")
  fs.mkdirSync(meetRoot, { recursive: true })
  fs.writeFileSync(path.join(meetRoot, "meta.json"), JSON.stringify({ id: "meet-1", thread_id: "t-meet", title: "周会", started_at: "2026-09-05T00:00:00Z" }))
  const tm = makeTm({ "t-meet": { id: "t-meet" } }, { "t-meet": [{ id: "m1", role: "user", content: "会议" }] })
  const { calls, impl } = countingImpl(GOOD_DRAFT_JSON)
  const r = await distillExpertDraft({ thread_id: "t-meet", threadManager: tm, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(!r.ok)
  if (!r.ok) assert.equal(r.code, "meeting_thread")
  assert.equal(calls.length, 0)
})

// ---------------------------------------------------------------------------
// 语料：digest 优先 + 8k cap
// ---------------------------------------------------------------------------

test("digest 优先：未过期 digest → used_digest=true，语料走 TL;DR", async () => {
  const msgs: Msg[] = [{ id: "m1", role: "user", content: "帮我做页面竞品分析" }, { id: "m2", role: "assistant", content: "已完成" }]
  const th: Th = {
    id: "t-d",
    digest: { extracted_at: "2026-09-05T00:00:00Z", content_fingerprint: "2:m2", tldr: "用户要求竞品分析并完成", tags: ["竞品"], bullets: ["页面级对比"], source: "auto" },
  }
  const tm = makeTm({ "t-d": th }, { "t-d": msgs })
  const { calls, impl } = countingImpl(GOOD_DRAFT_JSON)
  const r = await distillExpertDraft({ thread_id: "t-d", threadManager: tm, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.used_digest, true)
  assert.ok(calls[0]?.userContent.startsWith("TL;DR:"))
})

test("正文路径：cap 8k + 过期 digest 回落正文", async () => {
  const big: Msg[] = Array.from({ length: 60 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: "很长的内容".repeat(60),
  }))
  const th: Th = { id: "t-big", digest: { extracted_at: "2026-09-01T00:00:00Z", content_fingerprint: "0:empty", tldr: "过期", tags: [], source: "auto" } }
  const tm = makeTm({ "t-big": th }, { "t-big": big })
  const { calls, impl } = countingImpl(GOOD_DRAFT_JSON)
  const r = await distillExpertDraft({ thread_id: "t-big", threadManager: tm, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.used_digest, false)
  assert.ok((calls[0]?.userContent.length || 0) <= 8000 + 128, `corpus capped, got ${calls[0]?.userContent.length}`)
})

test("clampDistillTools：只留保守面 + 去重", () => {
  assert.deepEqual(
    clampDistillTools(["navigate", "shell_exec", "evaluate", "navigate", "spawn_worker", "click"]),
    ["navigate", "click"],
  )
  assert.deepEqual(clampDistillTools("not-array"), [])
  assert.deepEqual(clampDistillTools([undefined, 42, ""]), [])
})

// ---------------------------------------------------------------------------
// armed 队列（默认 off；仅指针落盘；一次手点 drain 一条）
// ---------------------------------------------------------------------------

test("红线 4：armed 默认 off；未 armed drain 拒绝", async () => {
  const st = loadDistillQueue()
  assert.equal(st.armed, false)
  assert.deepEqual(st.items, [])
  const tm = makeTm({}, {})
  const r = await drainDistillQueue({ threadManager: tm, llm: LLM })
  assert.ok(!r.ok)
  if (!r.ok) assert.equal(r.code, "not_armed")
})

test("红线 5：队列文件只存指针（thread_id/enqueued_at/corpus_ids），0600，无正文无草稿", async () => {
  const msgs: Msg[] = [{ id: "m1", role: "user", content: "SECRET-FREE-CONTENT" }]
  const tm = makeTm({ "t-q": { id: "t-q" } }, { "t-q": msgs })
  const built = buildDistillCorpus("t-q", tm as any)
  assert.ok(built.ok)
  const r = armDistillQueue("t-q", built.ok ? built.corpus.corpus_ids : [])
  assert.deepEqual(r, { ok: true, armed: true, queue_len: 1 })
  assert.ok(fs.existsSync(QUEUE_FILE))
  const raw = fs.readFileSync(QUEUE_FILE, "utf-8")
  const parsed = JSON.parse(raw)
  assert.equal(parsed.armed, true)
  assert.equal(parsed.items.length, 1)
  const item = parsed.items[0]
  assert.deepEqual(Object.keys(item).sort(), ["corpus_ids", "enqueued_at", "thread_id"])
  assert.deepEqual(item.corpus_ids, ["m1"])
  // 指针纪律：正文与草稿字符串绝不落盘
  assert.ok(!raw.includes("SECRET-FREE-CONTENT"))
  assert.ok(!raw.includes("system_prompt_append"))
  const mode = fs.statSync(QUEUE_FILE).mode & 0o777
  assert.equal(mode, 0o600)
})

test("drain：一次一条；草稿进内存 pending（getPendingDistillDraft），队列指针弹出", async () => {
  disarmDistillQueue() // 队列文件跨测试共享——每个队列测试自行复位
  const threads: Record<string, Th> = { "t-a": { id: "t-a" }, "t-b": { id: "t-b" } }
  const messages: Record<string, Msg[]> = {
    "t-a": [{ id: "a1", role: "user", content: "A 内容" }],
    "t-b": [{ id: "b1", role: "user", content: "B 内容" }],
  }
  const tm = makeTm(threads, messages)
  armDistillQueue("t-a", ["a1"])
  armDistillQueue("t-b", ["b1"])
  const { calls, impl } = countingImpl(GOOD_DRAFT_JSON)
  const r = await drainDistillQueue({ threadManager: tm as any, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.drained, true)
  assert.equal(r.thread_id, "t-a")
  assert.equal(r.remaining, 1)
  assert.equal(calls.length, 1, "drain processes exactly ONE item per call")
  const pending = getPendingDistillDraft("t-a")
  assert.ok(pending, "draft kept in memory pending")
  // 队列文件只剩 t-b 指针；草稿不落盘
  const after = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"))
  assert.deepEqual(after.items.map((i: any) => i.thread_id), ["t-b"])
  assert.ok(!fs.readFileSync(QUEUE_FILE, "utf-8").includes("投研助手"))
})

test("drain skip：目标 thread 已删 → 弹出并报告，不消耗 LLM", async () => {
  disarmDistillQueue()
  armDistillQueue("t-gone", ["g1"])
  const tm = makeTm({}, {})
  const { calls, impl } = countingImpl(GOOD_DRAFT_JSON)
  const r = await drainDistillQueue({ threadManager: tm as any, llm: LLM, deps: { llmExtractImpl: impl as any } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.skip, "thread_not_found")
  assert.equal(r.source, "heuristic")
  assert.equal(calls.length, 0)
  const after = loadDistillQueue()
  assert.equal(after.items.length, 0)
})

test("arm 去重 + disarm 清空", () => {
  disarmDistillQueue()
  armDistillQueue("t-dup", ["d1"])
  const r2 = armDistillQueue("t-dup", ["d1"])
  assert.equal(r2.queue_len, 1, "same thread enqueued once")
  const d = disarmDistillQueue()
  assert.deepEqual(d, { ok: true, armed: false, queue_len: 0 })
  const st = loadDistillQueue()
  assert.equal(st.armed, false)
  assert.equal(st.items.length, 0)
})

test("status：restart_note 写明未审草稿重启即丢", () => {
  disarmDistillQueue()
  const s = distillQueueStatus()
  assert.equal(s.armed, false)
  assert.ok(s.restart_note.includes("重启"))
  assert.ok(DISTILL_RESTART_LOSS_NOTE.includes("不会保留"))
  assert.ok(DISTILL_LLM_NOTICE.includes("LLM"))
})
