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
  KNOWLEDGE_GRAPH_AI_RELATION,
  KNOWLEDGE_GRAPH_LLM_LANE_MAX,
  KNOWLEDGE_GRAPH_LLM_NOT_CONFIGURED,
  KNOWLEDGE_GRAPH_LOCK_DISSOLVED,
  KNOWLEDGE_GRAPH_LOCK_GROUP,
  KNOWLEDGE_GRAPH_NO_RELATIONS,
  KNOWLEDGE_GRAPH_ORGANIZE_RETRY,
  KNOWLEDGE_GRAPH_REORGANIZE,
  KNOWLEDGE_GRAPH_STALE_BADGE,
  KNOWLEDGE_GRAPH_TF_SWITCH_BANNER,
  KNOWLEDGE_GRAPH_UNLOCK_GROUP,
  graphBannerCopy,
  isKnowledgeGraphLlmLane,
  knowledgeGraphBarMeta,
  knowledgeGraphOrganizeCta,
  shouldRenderGraphCanvas,
} from "../src/knowledge-graph/copy"
import {
  buildKnowledgeGraphRequest,
  hasKnowledgeGraphLlmCache,
  knowledgeGraphPairKey,
  knowledgeGraphViewModel,
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
  KnowledgeGraphLockDissolvedBanner,
  KnowledgeGraphNoRelationsNote,
  KnowledgeGraphOrganizeCta,
  KnowledgeGraphOrganizeErrorBar,
  KnowledgeGraphReorganizeButton,
  KnowledgeGraphStaleBadge,
  KnowledgeGraphStatusView,
  KnowledgeGraphTfSwitchBanner,
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

// --- #427 低语料整理 lane ---

test("#427 copy: CTA 插值 N；lane 2–19；新文案走常量", () => {
  assert.equal(knowledgeGraphOrganizeCta(4), "让 AI 整理现有 4 篇")
  assert.equal(knowledgeGraphOrganizeCta(19), "让 AI 整理现有 19 篇")
  assert.equal(KNOWLEDGE_GRAPH_LLM_LANE_MAX, 19)
  assert.equal(isKnowledgeGraphLlmLane(1), false)
  assert.equal(isKnowledgeGraphLlmLane(2), true)
  assert.equal(isKnowledgeGraphLlmLane(19), true)
  assert.equal(isKnowledgeGraphLlmLane(20), false)
  assert.equal(KNOWLEDGE_GRAPH_REORGANIZE, "重新整理")
  assert.equal(KNOWLEDGE_GRAPH_STALE_BADGE, "语料已变化 · 可重新整理")
  assert.equal(KNOWLEDGE_GRAPH_NO_RELATIONS, "AI 未发现明确关联")
  assert.equal(KNOWLEDGE_GRAPH_TF_SWITCH_BANNER, "知识已满 20 篇，分组改按统计聚类（更稳定）")
  assert.equal(KNOWLEDGE_GRAPH_LOCK_DISSOLVED, "不足两篇的锁定分组已解散")
  assert.equal(KNOWLEDGE_GRAPH_AI_RELATION, "AI 关联")
  assert.equal(KNOWLEDGE_GRAPH_LOCK_GROUP, "保留这版分组")
  assert.equal(KNOWLEDGE_GRAPH_UNLOCK_GROUP, "解锁")
  assert.equal(KNOWLEDGE_GRAPH_ORGANIZE_RETRY, "重试")
  assert.equal(KNOWLEDGE_GRAPH_LLM_NOT_CONFIGURED, "未配置 LLM")
})

test("#427 shouldRenderGraphCanvas 仍只放行 ok|over_cap（不新增 status）", () => {
  assert.equal(shouldRenderGraphCanvas("ok"), true)
  assert.equal(shouldRenderGraphCanvas("over_cap"), true)
  assert.equal(shouldRenderGraphCanvas("too_few"), false)
  assert.equal(shouldRenderGraphCanvas("error"), false)
  assert.equal(shouldRenderGraphCanvas("rebuilding"), false)
})

test("#427 parseKnowledgeGraphPayload: 旧帧无新字段照常；relations/llm_ready/organize_error 可选", () => {
  const old = parseKnowledgeGraphPayload({
    status: "ok",
    truncated: false,
    nodes: [{ id: "a", title: "A", group_key: "u:ungrouped", folder: "" }],
    edges: [{ a: "a", b: "b", score: 0.2 }],
    labels: {},
  })
  assert.ok(old)
  assert.equal(old!.relations, undefined)
  assert.equal(old!.llm_ready, undefined)
  assert.equal(old!.organize_error, undefined)
  assert.equal(old!.stale, undefined)

  const full = parseKnowledgeGraphPayload({
    status: "ok",
    nodes: [
      { id: "a", title: "A", group_key: "l:abc", folder: "" },
      { id: "b", title: "B", group_key: "l:abc", folder: "" },
    ],
    edges: [{ a: "a", b: "b", score: 0.3 }],
    labels: { "l:abc": { name: "组", summary: "摘要", ai: true, locked: true } },
    relations: [
      { a: "a", b: "b", reason: "同主题", confidence: 0.8, ai: true },
      { a: "a", b: "a", reason: "自环", confidence: 1 },
      { a: "a", b: "c", reason: "" },
    ],
    llm_ready: false,
    organize_error: "timeout",
    stale: true,
    tf_switch_notice: true,
    lock_dissolved: true,
  })
  assert.ok(full)
  assert.equal(full!.llm_ready, false)
  assert.equal(full!.organize_error, "timeout")
  assert.equal(full!.stale, true)
  assert.equal(full!.tf_switch_notice, true)
  assert.equal(full!.lock_dissolved, true)
  assert.equal(full!.labels["l:abc"]!.locked, true)
  assert.equal(full!.relations!.length, 1)
  assert.equal(full!.relations![0].reason, "同主题")
  assert.equal(full!.relations![0].ai, true)
  assert.equal(hasKnowledgeGraphLlmCache(full!), true)
  assert.equal(hasKnowledgeGraphLlmCache(old!), false)

  const emptyOk = parseKnowledgeGraphPayload({
    status: "ok",
    nodes: [
      { id: "a", title: "A", group_key: "u:ungrouped", folder: "" },
      { id: "b", title: "B", group_key: "u:ungrouped", folder: "" },
      { id: "c", title: "C", group_key: "u:ungrouped", folder: "" },
      { id: "d", title: "D", group_key: "u:ungrouped", folder: "" },
    ],
    edges: [],
    labels: {},
    relations: [],
    organized: true,
  })
  assert.ok(emptyOk)
  assert.equal(emptyOk!.organized, true)
  assert.equal(hasKnowledgeGraphLlmCache(emptyOk!), true, "合法空结果仍算已整理")
})

test("#427 buildKnowledgeGraphRequest: organize + user_gesture 成对", () => {
  assert.deepEqual(buildKnowledgeGraphRequest({ llmLabels: false, organize: true }), {
    type: "knowledge.graph",
    organize: true,
    user_gesture: true,
  })
  const lock = buildKnowledgeGraphRequest({ llmLabels: false, lockGroup: "l:abc" })
  assert.equal(lock.lock_group, "l:abc")
  assert.equal(lock.user_gesture, true)
})

test("#427 pair key 无向", () => {
  assert.equal(knowledgeGraphPairKey("b", "a"), knowledgeGraphPairKey("a", "b"))
})

test("#427 OrganizeCta 插值 + llm_ready 禁用；error 条带重试", () => {
  const cta = renderToStaticMarkup(
    createElement(KnowledgeGraphOrganizeCta, {
      n: 4,
      disabled: true,
      organizing: false,
      onOrganize: () => {},
    }),
  )
  assert.ok(cta.includes("让 AI 整理现有 4 篇"), cta)
  assert.ok(cta.includes("disabled") || cta.includes('disabled=""') || cta.includes("not-allowed"), cta)
  assert.ok(cta.includes(KNOWLEDGE_GRAPH_LLM_NOT_CONFIGURED), cta)

  const err = renderToStaticMarkup(
    createElement(KnowledgeGraphOrganizeErrorBar, { error: "timeout", onRetry: () => {} }),
  )
  assert.ok(err.includes("timeout"), err)
  assert.ok(err.includes(KNOWLEDGE_GRAPH_ORGANIZE_RETRY), err)

  const stale = renderToStaticMarkup(createElement(KnowledgeGraphStaleBadge))
  assert.ok(stale.includes(KNOWLEDGE_GRAPH_STALE_BADGE), stale)
  const tf = renderToStaticMarkup(createElement(KnowledgeGraphTfSwitchBanner))
  assert.ok(tf.includes(KNOWLEDGE_GRAPH_TF_SWITCH_BANNER), tf)
  const diss = renderToStaticMarkup(createElement(KnowledgeGraphLockDissolvedBanner))
  assert.ok(diss.includes(KNOWLEDGE_GRAPH_LOCK_DISSOLVED), diss)
  const none = renderToStaticMarkup(createElement(KnowledgeGraphNoRelationsNote))
  assert.ok(none.includes(KNOWLEDGE_GRAPH_NO_RELATIONS), none)
  const re = renderToStaticMarkup(
    createElement(KnowledgeGraphReorganizeButton, {
      organizing: false,
      disabled: false,
      onClick: () => {},
    }),
  )
  assert.ok(re.includes(KNOWLEDGE_GRAPH_REORGANIZE), re)
})

test("#427 groupCard: l: 分组关命名开关仍带 AI 标；锁按钮", () => {
  const off = groupCardModel({ name: "投研", summary: "摘要", ai: true }, false, { llmLaneGroup: true })
  assert.equal(off.showAiBadge, true)
  assert.equal(off.summary, "摘要")
  const html = renderToStaticMarkup(
    createElement(KnowledgeGraphGroupCard, {
      groupKey: "l:abc",
      label: { name: "投研", summary: "摘要", ai: true },
      llmEnabled: false,
      llmLaneGroup: true,
      onLock: () => {},
    }),
  )
  assert.ok(html.includes(KNOWLEDGE_GRAPH_AI_BADGE), html)
  assert.ok(html.includes(KNOWLEDGE_GRAPH_LOCK_GROUP), html)
  const locked = renderToStaticMarkup(
    createElement(KnowledgeGraphGroupCard, {
      groupKey: "l:abc",
      label: { name: "投研", ai: true, locked: true },
      llmEnabled: false,
      llmLaneGroup: true,
      onUnlock: () => {},
    }),
  )
  assert.ok(locked.includes(KNOWLEDGE_GRAPH_UNLOCK_GROUP), locked)
})

test("#427 App 源码：CTA 发 organize+user_gesture；不内联新文案", () => {
  const app = readFileSync(join(SRC_ROOT, "knowledge-graph/KnowledgeGraphApp.tsx"), "utf8")
  assert.ok(app.includes("organize: true"), "CTA 走 organize")
  const bg = readFileSync(join(SRC_ROOT, "background/index.ts"), "utf8")
  assert.ok(bg.includes("organize"), "SW 透传 organize")
  assert.ok(bg.includes("lock_group") && bg.includes("unlock_group"), "SW 透传锁")
  assert.ok(!app.includes("让 AI 整理现有"), "CTA 文案不得内联")
  assert.ok(!app.includes("语料已变化"), "stale 文案不得内联")
  assert.ok(app.includes("labels[k]?.locked === true"), "≥20 锁组仍可解锁（不限 llmLane）")
  assert.ok(app.includes("knowledgeGraphViewModel"), "CTA 门走可测 view model")
  assert.ok(app.includes("knowledgeGraphBarMeta"), "边计数走常量函数")
})

test("#427 App 层：CTA 只在 ok+2–19+无缓存；空结果无 CTA 有散点 note", () => {
  const ungrouped4 = mockKnowledgeGraphPayload({
    status: "ok",
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, title: id, group_key: "u:ungrouped", folder: "" })),
  })
  const cta = knowledgeGraphViewModel(ungrouped4)
  assert.equal(cta.showOrganizeCta, true)
  assert.equal(cta.showNoRelations, false)
  assert.equal(cta.relationsToDraw.length, 0)

  const emptyOrg = mockKnowledgeGraphPayload({
    status: "ok",
    nodes: ungrouped4.nodes,
    relations: [],
    organized: true,
  })
  const empty = knowledgeGraphViewModel(emptyOrg)
  assert.equal(empty.showOrganizeCta, false, "合法空结果不再出 CTA")
  assert.equal(empty.showNoRelations, true)
  assert.equal(empty.showReorganize, true)

  assert.equal(knowledgeGraphViewModel(mockKnowledgeGraphPayload({ status: "too_few" })).showOrganizeCta, false)
  assert.equal(knowledgeGraphViewModel(mockKnowledgeGraphPayload({ status: "error" })).showOrganizeCta, false)
  assert.equal(
    knowledgeGraphViewModel(
      mockKnowledgeGraphPayload({
        status: "ok",
        nodes: [{ id: "only", title: "x", group_key: "u:ungrouped", folder: "" }],
      }),
    ).showOrganizeCta,
    false,
    "n=1 无 CTA",
  )
  const twenty = knowledgeGraphViewModel(
    mockKnowledgeGraphPayload({
      status: "ok",
      nodes: Array.from({ length: 20 }, (_, i) => ({
        id: `n${i}`,
        title: `n${i}`,
        group_key: "c:g",
        folder: "",
      })),
      relations: [{ a: "n0", b: "n1", reason: "leak", confidence: 1, ai: true }],
    }),
  )
  assert.equal(twenty.showOrganizeCta, false)
  assert.equal(twenty.relationsToDraw.length, 0, "≥20 不画 AI 虚线（双保险）")
})

test("#427 barMeta：有 AI 关联时拆 TF/AI", () => {
  assert.equal(knowledgeGraphBarMeta(4, 3, 0), "4 点 · 3 边")
  assert.equal(knowledgeGraphBarMeta(4, 3, 2), "4 点 · TF 3 边 · AI 2 关联")
})
