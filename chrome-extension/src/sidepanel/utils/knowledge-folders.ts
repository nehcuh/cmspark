// #274 — 知识文件夹视图纯函数（面板渲染与测试共用；无 React 依赖）。
// Spec: docs/superpowers/specs/2026-09-02-knowledge-folders-design.md §5/§6

import type { KnowledgeFolderMeta, KnowledgeMeta } from "../types"

/** 文件夹视图展示级数上限（与磁盘 ≤3 级对齐；超深磁盘结构拍扁渲染到第 3 级）。 */
export const KNOWLEDGE_FOLDER_VIEW_DEPTH = 3

export interface KnowledgeFolderNode {
  /** 相对桶根的 posix 路径（展示口径，已拍扁到 ≤3 级）。 */
  path: string
  name: string
  description: string
  stale: boolean
  /**
   * 文件夹写操作的目标桶：folders 元数据为准；纯文档推导的节点按成员文档的
   * site 字段近似（有 site → sites）。同名跨桶合并行取第一个已知桶。
   */
  bucket: "global" | "sites"
  children: KnowledgeFolderNode[]
  docs: KnowledgeMeta[]
}

export interface KnowledgeFolderTree {
  rootDocs: KnowledgeMeta[]
  tree: KnowledgeFolderNode[]
}

/**
 * #274 AC-10: 筛选 bag = title + name + description + site + tags + folder
 *（folder 的 "/" 换成空格，文件夹名可被筛选命中）。修现状缺口：此前不含 tags。
 */
export function filterKnowledgeDocs(docs: KnowledgeMeta[], query: string): KnowledgeMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return docs
  return docs.filter((d) => {
    const bag = [
      d.title || "",
      d.name,
      d.description || "",
      d.site || "",
      (d.tags || []).join(" "),
      (d.folder || "").split("/").join(" "),
    ]
      .join(" ")
      .toLowerCase()
    return bag.includes(q)
  })
}

/** 展示口径的文件夹路径：超过 3 级的磁盘路径拍扁到第 3 级（§3.4 面板侧拍扁）。 */
export function displayFolderPath(folder: string): string {
  const segs = (folder || "").split("/").filter(Boolean)
  return segs.slice(0, KNOWLEDGE_FOLDER_VIEW_DEPTH).join("/")
}

/**
 * 由文档的 folder 字段 + companion 的 folders 元数据构建 ≤3 级手风琴树。
 * 空文件夹（只有 _folder.md、没有文档）也出现；桶根文档进 rootDocs。
 * global / sites 两个桶在同一个面板里合并展示（文件夹名相同的行合并，
 * 说明优先取非空的那个）。
 */
export function buildKnowledgeFolderTree(
  docs: KnowledgeMeta[],
  folders: KnowledgeFolderMeta[] = [],
): KnowledgeFolderTree {
  const nodes = new Map<string, KnowledgeFolderNode>()
  const ensureNode = (path: string): KnowledgeFolderNode => {
    const existing = nodes.get(path)
    if (existing) return existing
    const segs = path.split("/")
    const node: KnowledgeFolderNode = {
      path,
      name: segs[segs.length - 1],
      description: "",
      stale: false,
      bucket: "global",
      children: [],
      docs: [],
    }
    nodes.set(path, node)
    if (segs.length > 1) {
      ensureNode(segs.slice(0, -1).join("/")).children.push(node)
    }
    return node
  }

  for (const f of folders) {
    const path = displayFolderPath(f.path)
    if (!path) continue
    const node = ensureNode(path)
    if (f.description) node.description = f.description
    if (f.title) node.name = f.title
    node.bucket = f.bucket
    node.stale = node.stale || f.stale
  }

  const rootDocs: KnowledgeMeta[] = []
  for (const d of docs) {
    const path = displayFolderPath(d.folder || "")
    if (!path) {
      rootDocs.push(d)
      continue
    }
    const node = ensureNode(path)
    // Doc-derived node without folders metadata: approximate the bucket.
    if (!folders.some((f) => displayFolderPath(f.path) === path)) {
      node.bucket = d.site ? "sites" : "global"
    }
    node.docs.push(d)
  }

  const sortTree = (list: KnowledgeFolderNode[]) => {
    list.sort((a, b) => a.path.localeCompare(b.path))
    for (const n of list) sortTree(n.children)
  }
  const roots = Array.from(nodes.values()).filter((n) => n.path.split("/").length === 1)
  sortTree(roots)
  return { rootDocs, tree: roots }
}

/** 「移到…」候选路径列表：桶根 + 全部已知文件夹（≤3 级展示口径去重）。 */
export function knowledgeMoveTargets(docs: KnowledgeMeta[], folders: KnowledgeFolderMeta[]): string[] {
  const set = new Set<string>()
  for (const f of folders) {
    const p = displayFolderPath(f.path)
    if (p) set.add(p)
  }
  for (const d of docs) {
    const p = displayFolderPath(d.folder || "")
    if (p) set.add(p)
  }
  return Array.from(set).sort()
}
