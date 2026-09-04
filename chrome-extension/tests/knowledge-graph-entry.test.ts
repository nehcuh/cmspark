import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// #296 AC-1：知识面板 chips 行右侧「分布图谱」入口
// Spec: docs/superpowers/specs/2026-09-04-knowledge-graph-view-design.md §4 AC-1 / §7 名词

const SRC = join(process.cwd(), "src")
const PANEL = readFileSync(join(SRC, "sidepanel/components/KnowledgeSubPanel.tsx"), "utf8")
const TAB = readFileSync(join(SRC, "tabs/knowledge-graph.tsx"), "utf8")
const APP = readFileSync(join(SRC, "knowledge-graph/KnowledgeGraphApp.tsx"), "utf8")
const HOST = readFileSync(join(SRC, "sidepanel/components/ContextPanelHost.tsx"), "utf8")

test("AC-1: 面板 chips 行有「分布图谱」入口并打开 knowledge-graph tab", () => {
  assert.ok(
    PANEL.includes("KnowledgeGraphEntryButton") || PANEL.includes("分布图谱"),
    "入口组件或文案",
  )
  assert.ok(PANEL.includes("knowledge_graph.open"), "点击走 SW open（镜像 thread_graph.open）")
  const chipsIdx = PANEL.indexOf('aria-label="分布"')
  const clickIdx = PANEL.indexOf("knowledge_graph.open")
  assert.ok(chipsIdx >= 0 && clickIdx > chipsIdx, "入口在 chips 行右侧（源码顺序 chips 后）")
})

test("tab 壳复用 thread-graph 一行 Plasmo page", () => {
  assert.ok(TAB.includes("KnowledgeGraphApp"), "tabs/knowledge-graph.tsx 挂应用")
  assert.ok(APP.includes("forceLayoutTick") || APP.includes("seedLayoutNodes"), "复用力导向")
  assert.ok(APP.includes("knowledge_graph_llm_labels") || APP.includes("KNOWLEDGE_GRAPH_LLM_LABELS_KEY"), "开关持久化")
  assert.ok(APP.includes("knowledge_graph.open_doc"), "点击节点打开文档")
})

test("点击节点：SW 通知侧栏聚焦知识面板并选中文档", () => {
  assert.ok(HOST.includes("knowledge_graph.doc_selected") || HOST.includes("cmspark:open-knowledge"), "Host 接文档焦点")
})

test("rebuilding 自动刷新：tab 会 refresh", () => {
  assert.ok(APP.includes("knowledge_graph.refresh") || APP.includes("rebuilding"), "重建中会再拉")
})
