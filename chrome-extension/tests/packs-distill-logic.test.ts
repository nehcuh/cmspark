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

test("spy: background 转发白名单含全部 5 个 pack.distill_* 消息", () => {
  const src = fs.readFileSync(BG_SRC, "utf-8")
  for (const t of [
    "pack.distill_expert",
    "pack.distill_arm",
    "pack.distill_disarm",
    "pack.distill_drain",
    "pack.distill_status",
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
