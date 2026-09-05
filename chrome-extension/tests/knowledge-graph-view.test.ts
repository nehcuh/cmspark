import test from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// #296 知识分布图谱视图 — 扩展清单（spec §8）
// Spec: docs/superpowers/specs/2026-09-04-knowledge-graph-view-design.md

import {
  KNOWLEDGE_GRAPH_AI_BADGE,
  KNOWLEDGE_GRAPH_COLOR_FOLDER,
  KNOWLEDGE_GRAPH_COLOR_GROUP,
  KNOWLEDGE_GRAPH_ENTRY_LABEL,
  KNOWLEDGE_GRAPH_ERROR_COPY,
  KNOWLEDGE_GRAPH_ERROR_DETAIL_LABEL,
  KNOWLEDGE_GRAPH_OVER_CAP_COPY,
  KNOWLEDGE_GRAPH_REBUILDING_COPY,
  KNOWLEDGE_GRAPH_REGENERATE,
  KNOWLEDGE_GRAPH_TOO_FEW_COPY,
  KNOWLEDGE_GRAPH_UNGROUPED_LABEL,
  graphBannerCopy,
  shouldRenderGraphCanvas,
} from "../src/knowledge-graph/copy"
import {
  buildKnowledgeGraphRequest,
  mockKnowledgeGraphPayload,
  parseKnowledgeGraphPayload,
  type KnowledgeGraphPayload,
} from "../src/knowledge-graph/wire"
import {
  hoverCaption,
  isUngroupedKey,
  nodeColor,
  nodeColorKey,
} from "../src/knowledge-graph/coloring"
import { UNTAGGED_COLOR } from "../src/thread-graph/tag-colors"
import {
  KNOWLEDGE_GRAPH_LLM_LABELS_KEY,
  parseLlmLabelsPref,
} from "../src/knowledge-graph/llm-pref"
import { groupCardModel } from "../src/knowledge-graph/labels"
import {
  KnowledgeGraphColorSwitch,
  KnowledgeGraphEntryButton,
  KnowledgeGraphGroupCard,
  KnowledgeGraphLlmSwitch,
  KnowledgeGraphStatusView,
} from "../src/knowledge-graph/chrome"

const SRC_ROOT = join(process.cwd(), "src")

function walkSource(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkSource(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

// --- 三态诚实文案（AC-3 / AC-5） ---

test("copy pins: too_few / over_cap / rebuilding 逐字（AC-3/AC-5）", () => {
  assert.equal(KNOWLEDGE_GRAPH_TOO_FEW_COPY, "知识不足 20 篇，暂无图谱")
  assert.equal(
    KNOWLEDGE_GRAPH_OVER_CAP_COPY,
    "超过 200 篇，只画标题字典序前 200 篇；仅这 200 篇参与分组与着色",
  )
  assert.equal(KNOWLEDGE_GRAPH_REBUILDING_COPY, "图谱索引重建中…")
  assert.equal(KNOWLEDGE_GRAPH_ENTRY_LABEL, "分布图谱")
})

test("graphBannerCopy + shouldRenderGraphCanvas: 三态诚实，不渲染空图假装有结构", () => {
  assert.equal(graphBannerCopy("too_few"), KNOWLEDGE_GRAPH_TOO_FEW_COPY)
  assert.equal(shouldRenderGraphCanvas("too_few"), false)

  assert.equal(graphBannerCopy("rebuilding"), KNOWLEDGE_GRAPH_REBUILDING_COPY)
  assert.equal(shouldRenderGraphCanvas("rebuilding"), false)

  assert.equal(graphBannerCopy("over_cap"), KNOWLEDGE_GRAPH_OVER_CAP_COPY)
  assert.equal(graphBannerCopy("over_cap", true), KNOWLEDGE_GRAPH_OVER_CAP_COPY)
  assert.equal(shouldRenderGraphCanvas("over_cap"), true)

  assert.equal(graphBannerCopy("ok"), null)
  assert.equal(shouldRenderGraphCanvas("ok"), true)
})

// --- #356: error 帧映射为可见态（不再无限「图谱索引重建中…」） ---

test("#356: error 态有 banner 且不渲染画布", () => {
  assert.equal(graphBannerCopy("error"), KNOWLEDGE_GRAPH_ERROR_COPY)
  assert.equal(shouldRenderGraphCanvas("error"), false)
})

test("#356: wire 解析 error 态快照（fail-closed 名单含 error；error 文本可选透传）", () => {
  const parsed = parseKnowledgeGraphPayload({
    status: "error",
    truncated: false,
    nodes: [],
    edges: [],
    labels: {},
    error: "knowledge.graph is panel-only (Side Panel knowledge panel)",
  })
  assert.ok(parsed, "error 是合法 status")
  assert.equal(parsed!.status, "error")
  assert.equal(parsed!.error, "knowledge.graph is panel-only (Side Panel knowledge panel)")
  // 无 error 字段也可解析（旧 companion / 手写快照）
  const bare = parseKnowledgeGraphPayload(mockKnowledgeGraphPayload({ status: "error" }))
  assert.ok(bare && bare.status === "error" && bare.error === undefined)
})

test("#356: StatusView error 态渲染通用 banner，内部错误原文折叠进详情不铺开", () => {
  const html = renderToStaticMarkup(
    createElement(KnowledgeGraphStatusView, {
      status: "error",
      truncated: false,
      error: "knowledge.graph is panel-only",
    }),
  )
  assert.ok(html.includes(KNOWLEDGE_GRAPH_ERROR_COPY), html)
  // 通用文案直出；内部英文原文只在 <details> 折叠内（不 inline 铺开）
  assert.ok(html.includes("<details"), "错误详情折叠")
  assert.ok(html.includes(KNOWLEDGE_GRAPH_ERROR_DETAIL_LABEL), "折叠开关文案")
  const inline = html.split("<details")[0]
  assert.ok(!inline.includes("knowledge.graph is panel-only"), "详情原文不得 inline 铺开")
  // 无详情时只渲染 banner（无折叠块）
  const bare = renderToStaticMarkup(
    createElement(KnowledgeGraphStatusView, { status: "error", truncated: false }),
  )
  assert.ok(bare.includes(KNOWLEDGE_GRAPH_ERROR_COPY), bare)
  assert.ok(!bare.includes("<details"), "无详情不渲染折叠块")
})

test("KnowledgeGraphStatusView 真渲染三态文案", () => {
  const tooFew = renderToStaticMarkup(
    createElement(KnowledgeGraphStatusView, { status: "too_few", truncated: false }),
  )
  assert.ok(tooFew.includes("知识不足 20 篇，暂无图谱"), tooFew)
  assert.ok(!tooFew.includes("簇"), "视图内不得出现「簇」")

  const over = renderToStaticMarkup(
    createElement(KnowledgeGraphStatusView, { status: "over_cap", truncated: true }),
  )
  assert.ok(over.includes("超过 200 篇，只画标题字典序前 200 篇"), over)
  assert.ok(over.includes("仅这 200 篇参与分组与着色"), over)

  const rebuilding = renderToStaticMarkup(
    createElement(KnowledgeGraphStatusView, { status: "rebuilding", truncated: false }),
  )
  assert.ok(rebuilding.includes("图谱索引重建中…"), rebuilding)

  const ok = renderToStaticMarkup(
    createElement(KnowledgeGraphStatusView, { status: "ok", truncated: false }),
  )
  assert.equal(ok, "")
})

// --- 着色模式（AC-2） ---

test("着色：未分组灰色；按分组 / 按文件夹切 key", () => {
  assert.equal(isUngroupedKey(""), true)
  assert.equal(isUngroupedKey("u:ungrouped"), true)
  assert.equal(isUngroupedKey("ungrouped"), true)
  assert.equal(isUngroupedKey("c:abc"), false)

  const grouped = { id: "d1", title: "退款政策", group_key: "c:g1", folder: "政策/2025" }
  const lone = { id: "d2", title: "杂记", group_key: "u:ungrouped", folder: "" }

  assert.equal(nodeColorKey(grouped, "group"), "c:g1")
  assert.equal(nodeColorKey(grouped, "folder"), "政策/2025")
  assert.equal(nodeColorKey(lone, "group"), null)
  assert.equal(nodeColorKey(lone, "folder"), null)

  assert.equal(nodeColor(lone, "group"), UNTAGGED_COLOR)
  assert.equal(nodeColor(lone, "folder"), UNTAGGED_COLOR)
  assert.notStrictEqual(nodeColor(grouped, "group"), UNTAGGED_COLOR)
  assert.equal(nodeColor(grouped, "group"), nodeColor(grouped, "group"), "同组同色")
})

test("hover：title + 分组名（或文件夹名）；未分组用「未分组」", () => {
  const labels = { "c:g1": { name: "退款", ai: false } }
  const grouped = { id: "d1", title: "退款政策", group_key: "c:g1", folder: "政策/2025" }
  const lone = { id: "d2", title: "杂记", group_key: "u:ungrouped", folder: "" }
  assert.equal(hoverCaption(grouped, "group", labels), "退款政策 · 退款")
  assert.equal(hoverCaption(grouped, "folder", labels), "退款政策 · 政策/2025")
  assert.equal(hoverCaption(lone, "group", labels), `杂记 · ${KNOWLEDGE_GRAPH_UNGROUPED_LABEL}`)
  assert.equal(hoverCaption(lone, "folder", labels), `杂记 · ${KNOWLEDGE_GRAPH_UNGROUPED_LABEL}`)
})

test("KnowledgeGraphColorSwitch 默认按分组，可切到按文件夹", () => {
  const group = renderToStaticMarkup(
    createElement(KnowledgeGraphColorSwitch, { mode: "group", onChange: () => {} }),
  )
  assert.ok(group.includes(KNOWLEDGE_GRAPH_COLOR_GROUP))
  assert.ok(group.includes(KNOWLEDGE_GRAPH_COLOR_FOLDER))
  assert.ok(group.includes('aria-pressed="true"'))
  assert.ok(!group.includes("簇"))

  const folder = renderToStaticMarkup(
    createElement(KnowledgeGraphColorSwitch, { mode: "folder", onChange: () => {} }),
  )
  assert.ok(folder.includes(KNOWLEDGE_GRAPH_COLOR_FOLDER))
})

// --- LLM 开关默认关 + storage key（AC-4） ---

test("LLM 开关默认关；storage key 钉死 knowledge_graph_llm_labels", () => {
  assert.equal(KNOWLEDGE_GRAPH_LLM_LABELS_KEY, "knowledge_graph_llm_labels")
  assert.equal(parseLlmLabelsPref(undefined), false)
  assert.equal(parseLlmLabelsPref(null), false)
  assert.equal(parseLlmLabelsPref(false), false)
  assert.equal(parseLlmLabelsPref("false"), false)
  assert.equal(parseLlmLabelsPref(0), false)
  assert.equal(parseLlmLabelsPref(true), true)
})

test("buildKnowledgeGraphRequest: 默认不带 llm_labels；开时 llm_labels:true", () => {
  assert.deepEqual(buildKnowledgeGraphRequest({ llmLabels: false }), { type: "knowledge.graph" })
  assert.deepEqual(buildKnowledgeGraphRequest({ llmLabels: true }), {
    type: "knowledge.graph",
    llm_labels: true,
  })
  assert.deepEqual(buildKnowledgeGraphRequest({ llmLabels: true, regenerate: true }), {
    type: "knowledge.graph",
    llm_labels: true,
    regen_labels: true,
  })
  // #374: 可选 id 透传（companion 回带用于 error 帧精确关联）
  assert.deepEqual(buildKnowledgeGraphRequest({ llmLabels: false, id: "kg.1" }), {
    type: "knowledge.graph",
    id: "kg.1",
  })
})

test("KnowledgeGraphLlmSwitch 默认关，重新生成仅在开启时出现", () => {
  const off = renderToStaticMarkup(
    createElement(KnowledgeGraphLlmSwitch, {
      enabled: false,
      onChange: () => {},
      onRegenerate: () => {},
    }),
  )
  assert.ok(off.includes('aria-pressed="false"') || off.includes("aria-checked=\"false\""), off)
  assert.ok(!off.includes(KNOWLEDGE_GRAPH_REGENERATE), "关时不展示重新生成")

  const on = renderToStaticMarkup(
    createElement(KnowledgeGraphLlmSwitch, {
      enabled: true,
      onChange: () => {},
      onRegenerate: () => {},
    }),
  )
  assert.ok(on.includes(KNOWLEDGE_GRAPH_REGENERATE), on)
})

// --- AI 标识（AC-4） ---

test("groupCardModel: ai:true 才带「AI 生成」；关开关无摘要", () => {
  const ai = groupCardModel({ name: "退款政策组", summary: "处理退款与售后。", ai: true }, true)
  assert.equal(ai.name, "退款政策组")
  assert.equal(ai.summary, "处理退款与售后。")
  assert.equal(ai.showAiBadge, true)

  const fallback = groupCardModel({ name: "退款", summary: "不该显示", ai: false }, true)
  assert.equal(fallback.name, "退款")
  assert.equal(fallback.summary, null)
  assert.equal(fallback.showAiBadge, false)

  const off = groupCardModel({ name: "退款政策组", summary: "处理退款与售后。", ai: true }, false)
  assert.equal(off.summary, null)
  assert.equal(off.showAiBadge, false)
})

test("KnowledgeGraphGroupCard 真渲染 AI 标识 tooltip", () => {
  const html = renderToStaticMarkup(
    createElement(KnowledgeGraphGroupCard, {
      groupKey: "c:g1",
      label: { name: "退款政策组", summary: "处理退款与售后。", ai: true },
      llmEnabled: true,
    }),
  )
  assert.ok(html.includes("退款政策组"), html)
  assert.ok(html.includes("处理退款与售后。"), html)
  assert.ok(html.includes(KNOWLEDGE_GRAPH_AI_BADGE), html)
  assert.ok(html.includes('title="AI 生成"') || html.includes("title='AI 生成'"), html)
  assert.ok(!html.includes("簇"), html)
})

// --- wire 形状 ---

test("parseKnowledgeGraphPayload: 契约形状；未知 status 丢弃", () => {
  const ok: KnowledgeGraphPayload = mockKnowledgeGraphPayload({
    status: "ok",
    truncated: false,
    nodes: [{ id: "a", title: "A", group_key: "c:g1", folder: "f" }],
    edges: [{ a: "a", b: "b", score: 0.4 }],
    labels: { "c:g1": { name: "组", ai: false } },
  })
  const parsed = parseKnowledgeGraphPayload({
    type: "knowledge.graph",
    ...ok,
    extra: "drop",
  })
  assert.ok(parsed)
  assert.equal(parsed!.status, "ok")
  assert.equal(parsed!.nodes[0].id, "a")
  assert.equal((parsed as { extra?: unknown }).extra, undefined)
  assert.equal(parseKnowledgeGraphPayload({ status: "nope", nodes: [] }), null)
  assert.equal(parseKnowledgeGraphPayload(null), null)
})

// --- 入口按钮（AC-1） ---

test("KnowledgeGraphEntryButton 文案是「分布图谱」且不含「簇」", () => {
  const html = renderToStaticMarkup(
    createElement(KnowledgeGraphEntryButton, { onClick: () => {} }),
  )
  assert.ok(html.includes("分布图谱"), html)
  assert.ok(!html.includes("簇"))
  assert.ok(html.includes("button"))
})

// --- 名词纪律（spec §7） ---

test("名词：视图源码可用「图谱」，禁用「簇」", () => {
  const viewRoot = join(SRC_ROOT, "knowledge-graph")
  const tab = join(SRC_ROOT, "tabs/knowledge-graph.tsx")
  const files = [...walkSource(viewRoot), tab]
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    assert.ok(!text.includes("簇"), `${file} 视图内不得出现「簇」`)
  }
})
