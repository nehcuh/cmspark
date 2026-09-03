import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// #274 — 知识文件夹视图：筛选 bag（AC-10）、文件夹树构建、视图默认、copy 禁令
// Spec: docs/superpowers/specs/2026-09-02-knowledge-folders-design.md §5/§6/§10

import {
  buildKnowledgeFolderTree,
  displayFolderPath,
  filterKnowledgeDocs,
  knowledgeMoveTargets,
} from "../src/sidepanel/utils/knowledge-folders"
import type { KnowledgeFolderMeta, KnowledgeMeta } from "../src/sidepanel/types"

const SRC_ROOT = join(process.cwd(), "src")
const PANEL = readFileSync(
  join(SRC_ROOT, "sidepanel/components/KnowledgeSubPanel.tsx"),
  "utf8",
)

function walkSource(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkSource(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

function doc(name: string, extra: Partial<KnowledgeMeta> = {}): KnowledgeMeta {
  return { name, description: "", builtin: false, type: "domain_knowledge", ...extra }
}

// --- AC-10: 筛选 bag 含 tags + folder ---

test("AC-10: filter bag hits tags and folder names (「退款」命中 tag 或文件夹名)", () => {
  const docs = [
    doc("a", { title: "普通文档", description: "说明", tags: ["退款"] }),
    doc("b", { title: "另一篇", description: "说明", folder: "退款/2025" }),
    doc("c", { title: "无关文档", description: "烹饪指南" }),
  ]
  const hits = filterKnowledgeDocs(docs, "退款").map((d) => d.name)
  assert.ok(hits.includes("a"), "tag 命中")
  assert.ok(hits.includes("b"), "文件夹名命中")
  assert.ok(!hits.includes("c"), "不相关文档不命中")
  // 深层路径段也可命中（"/" 换成空格进 bag）
  const deep = filterKnowledgeDocs([doc("d", { folder: "竞品/2025" })], "2025")
  assert.equal(deep.length, 1)
  // 空 query 原样返回
  assert.equal(filterKnowledgeDocs(docs, "  ").length, 3)
})

// --- 文件夹树：≤3 级手风琴数据 ---

test("folder tree: docs grouped by folder; empty folders from meta; root docs separate", () => {
  const docs = [
    doc("root-doc"),
    doc("x", { folder: "竞品" }),
    doc("y", { folder: "竞品/2025" }),
  ]
  const folders: KnowledgeFolderMeta[] = [
    { bucket: "global", path: "空夹", title: "空夹", description: "", stale: false },
    { bucket: "global", path: "竞品", title: "竞品", description: "竞品资料", stale: true },
  ]
  const { rootDocs, tree } = buildKnowledgeFolderTree(docs, folders)
  assert.equal(rootDocs.length, 1)
  assert.equal(rootDocs[0].name, "root-doc")
  const top = tree.map((n) => n.path).sort()
  assert.deepEqual(top, ["空夹", "竞品"])
  const comp = tree.find((n) => n.path === "竞品")!
  assert.equal(comp.description, "竞品资料")
  assert.equal(comp.stale, true, "可能过期透传")
  assert.equal(comp.docs[0].name, "x")
  assert.equal(comp.children.length, 1)
  assert.equal(comp.children[0].path, "竞品/2025")
  assert.equal(comp.children[0].docs[0].name, "y")
  assert.equal(tree.find((n) => n.path === "空夹")!.docs.length, 0, "空文件夹也出现")
})

test("folder tree: depth-4 disk paths flatten into level 3 for display", () => {
  assert.equal(displayFolderPath("a/b/c/d"), "a/b/c")
  const { tree } = buildKnowledgeFolderTree([doc("deep", { folder: "a/b/c/d" })], [])
  const a = tree.find((n) => n.path === "a")!
  assert.equal(a.children[0].path, "a/b")
  assert.equal(a.children[0].children[0].path, "a/b/c")
  assert.equal(a.children[0].children[0].docs[0].name, "deep", "超深文档渲染在第 3 级")
  assert.equal(a.children[0].children[0].children.length, 0, "手风琴最多 3 级")
})

test("move targets: 桶根外的全部已知文件夹（去重、排序、≤3 级口径）", () => {
  const docs = [doc("x", { folder: "竞品/2025" })]
  const folders: KnowledgeFolderMeta[] = [
    { bucket: "global", path: "调研", title: "调研", description: "", stale: false },
  ]
  assert.deepEqual(knowledgeMoveTargets(docs, folders), ["竞品/2025", "调研"])
})

// --- 视图切换默认文件夹 + copy 禁令（KnowledgeSubPanel 面，沿用 knowledge-panel-copy 模式） ---

test("view toggle: 站点|文件夹 switch exists, 文件夹 is the default", () => {
  assert.ok(PANEL.includes('useState<"folder" | "site">("folder")'), "默认文件夹视图")
  assert.ok(PANEL.includes('"文件夹"') && PANEL.includes('"站点"'), "切换按钮文案")
})

test("copy scan: 分类树/图谱/自动分类 banned across the whole extension src", () => {
  const offenders: string[] = []
  for (const file of walkSource(SRC_ROOT)) {
    const text = readFileSync(file, "utf8")
    if (text.includes("分类树") || text.includes("自动分类") || text.includes("知识图谱")) {
      offenders.push(file)
    }
  }
  assert.deepEqual(offenders, [], "全 src 零命中（F-UX-NOUN-1）")
})

test("copy: 移到… menu item, honest import confirm, stale badge wording", () => {
  assert.ok(PANEL.includes("移到…"), "文档行菜单「移到…」（验收必须）")
  assert.ok(
    PANEL.includes("将保留文件夹结构（最多 3 级，200 个文件）。每篇不单独解读。"),
    "导入确认句改诚实",
  )
  assert.ok(PANEL.includes("可能过期"), "指纹变化标记")
  assert.ok(PANEL.includes("建议说明"), "文件夹菜单「建议说明」")
  assert.ok(PANEL.includes("knowledge.move"), "move 动词接线")
})

// --- Gate8 评审修复钉 ---

test("Gate8 B-1: all six folder verbs are in the background SW bulk-forward list", () => {
  const bg = readFileSync(join(SRC_ROOT, "background/index.ts"), "utf8")
  // The bulk-forward region: from the knowledge family to the thread_graph case
  // (the forward group's shared tail does wsClient.send(message)).
  const slice = bg.slice(
    bg.indexOf('case "knowledge.list"'),
    bg.indexOf('case "thread_graph.prepare"'),
  )
  for (const verb of [
    "knowledge.folder_create",
    "knowledge.folder_rename",
    "knowledge.folder_update",
    "knowledge.folder_suggest",
    "knowledge.folder_delete",
    "knowledge.move",
  ]) {
    assert.ok(slice.includes(`case "${verb}":`), `${verb} must be bulk-forwarded to the companion WS`)
  }
  // The forward group's tail sends the message verbatim over the WS.
  assert.match(slice, /wsClient\.send\(message\)/)
})

test("Gate8 M-6/N-1/N-8: panel checks send acks, renders suggest errors, drafts never clobber a dirty editor", () => {
  // M-6: folder write ops check the SW ack via knowledgePreviewSendFailureText
  // before showing any success text (no optimistic 「已移到」).
  assert.ok(PANEL.includes("操作失败："), "send failure surfaces as an error status")
  assert.ok(PANEL.includes("已请求移到"), "success copy says 已请求 (request reached companion)")
  assert.ok(!PANEL.includes("已移到 ${value}"), "no optimistic move-success copy")
  // F-C: describe save uses the same honest 已请求… wording as the group.
  assert.ok(PANEL.includes("已请求保存文件夹说明"), "describe save copy is honest")
  assert.ok(!PANEL.includes('"已保存文件夹说明"'), "no optimistic save-success copy")
  // N-1: folder_suggest failure renders visibly.
  assert.ok(PANEL.includes("建议说明不可用"), "suggest error rendered")
  // N-8: an open editor row is not clobbered by an arriving draft.
  assert.ok(PANEL.includes("if (prev) return prev"), "user-dirty guard on the suggest effect")
  // M-6 companion side: family-tagged error frames route to the knowledge status.
  const ws = readFileSync(join(SRC_ROOT, "sidepanel/hooks/useWebSocket.ts"), "utf8")
  assert.ok(ws.includes('msg.family === "knowledge_folder"'), "family error routing in useWebSocket")
  assert.ok(ws.includes("layerOverflow"), "layerOverflow honestly surfaced in the import status")
})
