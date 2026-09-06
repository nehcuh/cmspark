// #370 I4: 从本对话归纳专家草稿 — 纯逻辑 + 红线源码 spy（extension 侧）
//
// 红线（票面）：
//   - 工具不预勾：normalizeDistillPreview 永远给 tools_allow=[]，建议只进 suggested_tools
//   - UI 明示「摘要将发给你配置的 LLM」：文案与 companion 逐字 lock-step
//   - 入口在 #369 专家分段；确认弹窗嵌入 notice / restart-loss 文案
//   - background 转发白名单含 5 个 pack.distill_* 消息
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import { join } from "node:path"
import {
  DISTILL_DISARM_LABEL,
  DISTILL_DRAIN_LABEL,
  DISTILL_ENTRY_LABEL,
  DISTILL_LLM_NOTICE,
  DISTILL_RESTART_LOSS_NOTE,
  DISTILL_SUGGESTED_TOOLS_LABEL,
  distillSourceLabel,
  distillStatusLine,
  normalizeDistillPreview,
} from "../src/sidepanel/packs-panel-logic"

// npm test 从 chrome-extension 目录跑（与 chat-abort-ack.test.ts 同款 process.cwd() 解析）
const BG_SRC = join(process.cwd(), "src", "background", "index.ts")
const PANEL_SRC = join(process.cwd(), "src", "sidepanel", "components", "PacksPanel.tsx")
const COMPANION_SRC = join(process.cwd(), "..", "companion", "src", "packs", "expert-distill.ts")

const PREVIEW = {
  type: "pack.distill_preview",
  thread_id: "t-1",
  source: "llm",
  used_digest: false,
  notice: "摘要将发给你配置的 LLM（与聊天同一服务商）",
  corpus_chars: 120,
  draft: {
    name: "投研助手",
    description: "分析财报",
    system_prompt_append: "你是投研助手。",
    tools: { mode: "allowlist", allow: ["get_page_text", "screenshot", "get_page_text"] },
    suitable_for: ["页面抽取"],
    unsuitable_for: ["主机操作"],
    evidence: [{ quote: "帮我分析这份财报", hint: "用户诉求" }],
  },
}

test("normalizeDistillPreview：形状归一 + 工具不预勾（tools_allow 恒空）+ 建议去重", () => {
  const r = normalizeDistillPreview(PREVIEW)
  assert.ok(r)
  if (!r) return
  assert.equal(r.draft.name, "投研助手")
  assert.equal(r.draft.system_prompt_append, "你是投研助手。")
  // 红线：不预勾 —— 编辑器勾选框由用户手动勾，建议只出现在 suggested_tools
  assert.deepEqual(r.draft.tools_allow, [])
  assert.deepEqual(r.meta.suggested_tools, ["get_page_text", "screenshot"])
  assert.equal(r.meta.used_digest, false)
  assert.equal(r.meta.source, "llm")
  assert.deepEqual(r.draft.evidence, [{ quote: "帮我分析这份财报", hint: "用户诉求" }])
})

test("normalizeDistillPreview：坏形状防御（null / 无 draft / 垃圾字段）不崩 UI", () => {
  assert.equal(normalizeDistillPreview(null), null)
  assert.equal(normalizeDistillPreview({}), null)
  assert.equal(normalizeDistillPreview({ draft: "string" }), null)
  const junk = normalizeDistillPreview({
    source: "heuristic",
    fallback_reason: "未配置 LLM",
    draft: {
      name: 42,
      tools: { allow: ["ok", 7, null, ""] },
      evidence: [{ quote: "" }, { quote: "有quote" }, "not-object"],
      suitable_for: "not-array",
    },
  })
  assert.ok(junk)
  if (!junk) return
  assert.equal(junk.draft.name, "")
  assert.deepEqual(junk.draft.tools_allow, [])
  assert.deepEqual(junk.meta.suggested_tools, ["ok"])
  assert.deepEqual(junk.draft.evidence, [{ quote: "有quote" }])
  assert.deepEqual(junk.draft.suitable_for, [])
  assert.equal(junk.meta.source, "heuristic")
  assert.equal(junk.meta.fallback_reason, "未配置 LLM")
  // notice 缺失时兜底为 lock-step 常量
  assert.equal(junk.meta.notice, DISTILL_LLM_NOTICE)
})

test("distillSourceLabel：llm 明示未保存不自动生效；heuristic 给 fallback 原因且面板可用", () => {
  assert.match(distillSourceLabel({ source: "llm" }), /未保存/)
  assert.match(distillSourceLabel({ source: "llm" }), /不会自动生效/)
  const h = distillSourceLabel({ source: "heuristic", fallback_reason: "未配置 LLM" })
  assert.match(h, /启发式空草稿/)
  assert.match(h, /未配置 LLM/)
  assert.match(h, /可手动补全后保存/)
  assert.match(distillSourceLabel({ source: "heuristic" }), /LLM 不可用/)
})

test("distillStatusLine：默认关闭 + 未审草稿重启即丢 必须可见", () => {
  const off = distillStatusLine({ armed: false, queue_len: 0, pending_len: 0 })
  assert.match(off, /未开启（默认）/)
  assert.match(off, /重启即丢/)
  const on = distillStatusLine({ armed: true, queue_len: 3, pending_len: 2 })
  assert.match(on, /已开启/)
  assert.match(on, /待归纳 3/)
  assert.match(on, /未审草稿 2/)
})

test("文案 lock-step：notice / restart-loss 与 companion 源码逐字一致（改文案两侧同步）", () => {
  const src = fs.readFileSync(COMPANION_SRC, "utf-8")
  const notice = src.match(/DISTILL_LLM_NOTICE\s*=\s*"([^"]+)"/)?.[1]
  const note = src.match(/DISTILL_RESTART_LOSS_NOTE\s*=\s*\n?\s*"([^"]+)"/)?.[1]
  assert.ok(notice, "companion DISTILL_LLM_NOTICE literal found")
  assert.ok(note, "companion DISTILL_RESTART_LOSS_NOTE literal found")
  assert.equal(DISTILL_LLM_NOTICE, notice)
  assert.equal(DISTILL_RESTART_LOSS_NOTE, note)
  assert.equal(DISTILL_LLM_NOTICE, "摘要将发给你配置的 LLM（与聊天同一服务商）")
  assert.match(DISTILL_RESTART_LOSS_NOTE, /不会保留/)
  assert.equal(DISTILL_ENTRY_LABEL, "从本对话归纳专家")
  assert.match(DISTILL_SUGGESTED_TOOLS_LABEL, /未预勾/)
})

test("spy: background 转发白名单含全部 6 个 pack.distill_* 消息（含 #411 distill_all_scan）", () => {
  const src = fs.readFileSync(BG_SRC, "utf-8")
  for (const t of [
    "pack.distill_expert",
    "pack.distill_arm",
    "pack.distill_disarm",
    "pack.distill_drain",
    "pack.distill_status",
    "pack.distill_all_scan",
  ]) {
    assert.ok(src.includes(`case "${t}":`), `background whitelist missing ${t}`)
  }
})

test("spy: PacksPanel 入口/状态/横幅 testid + 确认弹窗嵌入 notice 与 restart-loss", () => {
  const src = fs.readFileSync(PANEL_SRC, "utf-8")
  for (const id of ["distill-card", "distill-entry-btn", "distill-status-line", "distill-banner"]) {
    assert.ok(src.includes(`data-testid="${id}"`), `PacksPanel missing testid ${id}`)
  }
  // 发送前 confirm 必须原文带出隐私/损失告知
  assert.ok(src.includes("DISTILL_LLM_NOTICE"), "confirm embeds LLM notice")
  assert.ok(src.includes("DISTILL_RESTART_LOSS_NOTE"), "arm confirm embeds restart-loss note")
  // 红线：建议工具不预勾 —— 编辑器来自草稿时强制 allowlist + 空勾选
  assert.ok(/tools_mode:\s*"allowlist"/.test(src) || /tools_mode:\s*'allowlist'/.test(src))
  assert.ok(src.includes("DISTILL_SUGGESTED_TOOLS_LABEL"))
})

// ---------------------------------------------------------------------------
// #411: 从全部历史归纳专家（方案 A 两级聚类）— 纯逻辑 + spy
// ---------------------------------------------------------------------------

import {
  DISTILL_ALL_ENTRY_LABEL,
  distillAllConfirmBody,
  distillAllProgressLine,
  distillAllQueueLine,
  distillAllQueueStep,
  normalizeDistillAllDrafts,
  normalizeDistillAllProgress,
} from "../src/sidepanel/packs-panel-logic"

const ALL_RESULT = {
  type: "pack.distill_all_result",
  ok: true,
  scanned: 137,
  with_digest: 90,
  batches: 6,
  deep_read: 12,
  llm_calls: 7,
  notice: DISTILL_LLM_NOTICE,
  restart_note: DISTILL_RESTART_LOSS_NOTE,
  drafts: [
    {
      name: "投研助手",
      description: "分析财报",
      system_prompt_append: "你是投研助手。",
      tools: { mode: "allowlist", allow: ["get_page_text", "screenshot"] },
      suitable_for: ["页面抽取"],
      unsuitable_for: ["主机操作"],
      evidence: [
        { quote: "帮我分析这份财报", hint: "诉求", thread_ids: ["t1", "t2"] },
      ],
      thread_ids: ["t1", "t2", "t3"],
      conflicts_with: "已有投研",
    },
    {
      name: "发布工程",
      description: "出包",
      system_prompt_append: "你是发布工程专家。",
      tools: ["get_page_text"],
      evidence: [],
      thread_ids: ["t4", "t5"],
    },
    { name: "", description: "无名丢弃", system_prompt_append: "x", thread_ids: ["t1", "t2"] },
    "not-an-object",
  ],
}

test("#411 normalizeDistillAllDrafts：形状归一 + 坏份丢弃 + 工具不预勾 + 冲突/出处带出", () => {
  const r = normalizeDistillAllDrafts(ALL_RESULT)
  assert.ok(r)
  if (!r) return
  assert.equal(r.drafts.length, 2, "nameless / non-object drafts dropped")
  const d1 = r.drafts[0]
  assert.equal(d1.name, "投研助手")
  assert.equal(d1.conflicts_with, "已有投研")
  assert.deepEqual(d1.thread_ids, ["t1", "t2", "t3"])
  assert.deepEqual(d1.evidence[0].thread_ids, ["t1", "t2"])
  // 红线：工具不预勾（建议只进 suggested_tools，编辑器勾选由用户手动）
  assert.deepEqual(d1.tools_allow, [])
  // #418 NIT-1：AI 建议工具保留进 suggested 通道（此前 tools_allow 写死导致恒空）
  assert.deepEqual(d1.suggested_tools, ["get_page_text", "screenshot"])
  assert.deepEqual(r.drafts[1].suggested_tools, ["get_page_text"])
  assert.equal(r.scanned, 137)
  assert.equal(r.llm_calls, 7)
  assert.equal(r.restart_note, DISTILL_RESTART_LOSS_NOTE)
  assert.equal(r.drafts[1].conflicts_with, "")
})

test("#411 normalizeDistillAllDrafts：坏形状防御（null / ok:false / 无 drafts 容错为空）", () => {
  assert.equal(normalizeDistillAllDrafts(null), null)
  assert.equal(normalizeDistillAllDrafts({ ok: false }), null)
  // ok:true 但缺 drafts —— 容错为空视图（UI 走「未归纳出草稿」路径，不崩）
  const noDrafts = normalizeDistillAllDrafts({ ok: true })
  assert.ok(noDrafts)
  if (!noDrafts) return
  assert.deepEqual(noDrafts.drafts, [])
  const empty = normalizeDistillAllDrafts({
    ok: true,
    drafts: [],
    fallback_reason: "没有跨线程反复出现的角色",
  })
  assert.ok(empty)
  if (!empty) return
  assert.deepEqual(empty.drafts, [])
  assert.match(empty.fallback_reason, /没有跨线程/)
})

test("#411 distillAllQueueStep：clamp 边界（0 / total-1；total≤1 恒 0）", () => {
  assert.equal(distillAllQueueStep(0, 3, -1), 0)
  assert.equal(distillAllQueueStep(2, 3, 1), 2)
  assert.equal(distillAllQueueStep(1, 3, 1), 2)
  assert.equal(distillAllQueueStep(1, 3, -1), 0)
  assert.equal(distillAllQueueStep(0, 1, 1), 0)
})

test("#411 distillAllQueueLine：份号 + 冲突提示（覆盖/另存由用户裁决）", () => {
  const plain = distillAllQueueLine({ index: 0, total: 3 })
  assert.match(plain, /草稿 1\/3/)
  assert.match(plain, /逐份审阅/)
  const conflict = distillAllQueueLine({ index: 1, total: 3, conflicts_with: "已有投研" })
  assert.match(conflict, /草稿 2\/3/)
  assert.match(conflict, /已有投研/)
  assert.match(conflict, /另存|覆盖/)
})

test("#411 distillAllConfirmBody：N 条摘要发 LLM 必须写明 + 摘要来源 + 不自动保存", () => {
  const body = distillAllConfirmBody({ eligible: 137, with_digest: 90, capped: false })
  assert.match(body, /137 条历史对话的摘要/)
  assert.match(body, /LLM/)
  assert.match(body, /90 条有现成摘要/)
  assert.match(body, /不会自动保存/)
  assert.match(body, /不会保留/)
  const capped = distillAllConfirmBody({ eligible: 240, with_digest: 10, capped: true })
  assert.match(capped, /只取最近 200 条/)
  assert.equal(DISTILL_ALL_ENTRY_LABEL, "从全部历史归纳专家")
})

test("#411 distillSourceLabel：from_all_history 区分「全部历史」横幅", () => {
  assert.match(distillSourceLabel({ source: "llm", from_all_history: true }), /全部历史/)
  assert.match(distillSourceLabel({ source: "llm", from_all_history: true }), /逐份检查/)
  assert.match(distillSourceLabel({ source: "llm" }), /本对话/)
})

test("#411 spy: PacksPanel 全历史入口/确认弹窗/草稿队列 testid", () => {
  const src = fs.readFileSync(PANEL_SRC, "utf-8")
  for (const id of ["distill-all-entry-btn", "distill-all-start-btn", "distill-all-queue"]) {
    assert.ok(src.includes(`data-testid="${id}"`), `PacksPanel missing testid ${id}`)
  }
  // 确认弹窗写明摘要去向 + 排除项（时间窗/关键词）
  assert.ok(src.includes("distillAllConfirmBody"), "modal body states LLM destination + N")
  assert.ok(src.includes("只看最近"), "time-window exclude option")
  assert.ok(src.includes("排除关键词"), "keyword exclude option")
  // 队列逐份审阅：上一份/下一份
  assert.ok(src.includes("上一份") && src.includes("下一份"))
})

// ---------------------------------------------------------------------------
// #418: per-batch 扫描进度（normalize + 文案 + panel testid spy）
// ---------------------------------------------------------------------------

test("#418 normalizeDistillAllProgress：形状校验（坏形状丢弃，done>total 拒）", () => {
  assert.deepEqual(normalizeDistillAllProgress({ done_batches: 3, total_batches: 9 }), {
    done_batches: 3,
    total_batches: 9,
  })
  assert.deepEqual(normalizeDistillAllProgress({ done_batches: 0, total_batches: 8.5 }), {
    done_batches: 0,
    total_batches: 8,
  }, "fraction floored")
  assert.equal(normalizeDistillAllProgress(null), null)
  assert.equal(normalizeDistillAllProgress({}), null)
  assert.equal(normalizeDistillAllProgress({ done_batches: "3", total_batches: 9 }), null, "string rejected")
  assert.equal(normalizeDistillAllProgress({ done_batches: 10, total_batches: 9 }), null, "done>total rejected")
  assert.equal(normalizeDistillAllProgress({ done_batches: 1, total_batches: 0 }), null, "total≤0 rejected")
})

test("#418 distillAllProgressLine + PacksPanel 进度条 testid spy", () => {
  assert.match(distillAllProgressLine({ done_batches: 3, total_batches: 9 }), /3\/9/)
  assert.match(distillAllProgressLine({ done_batches: 8, total_batches: 9 }), /归并|归纳中/)
  const src = fs.readFileSync(PANEL_SRC, "utf-8")
  assert.ok(
    src.includes('data-testid="distill-all-progress"'),
    "PacksPanel renders progress line",
  )
  assert.ok(src.includes("normalizeDistillAllProgress"), "bad-shape progress dropped, not rendered")
})
