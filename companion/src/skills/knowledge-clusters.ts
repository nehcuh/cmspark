// Knowledge derived index + clustering (#273 Wave B, spec §6.1/§6.2/§6.3/§6.5)
// Spec: docs/superpowers/specs/2026-09-02-knowledge-retrieval-scoring-design.md
// ADR: docs/adr/027-knowledge-distribution-view-f-e-3-exemption.md
//
// 纯派生、可重建、可丢：SoT 仍是磁盘 .md（F-I-2）。本模块只做纯函数与
// index 文件 IO；引擎接线（重建触发 / 注入序）在 skill-engine.ts。

import * as fs from "fs"
import * as path from "path"
import { DATA_DIR } from "../config"
import { atomicWriteJSON } from "../io"
import { tokenize, tokensToVec, cosineSimilarity } from "./semantic-match"
import { sanitizeKnowledgeContent, wrapKnowledgeBlock } from "./content-sanitizer"
import { normalizeTag, SENSITIVE_TAG_RE } from "../threads/digest"
import { redactSecrets } from "../threads/distill"

// --- Wave B 常数表（spec §6.2；可测、可调，不要藏） ---
/** 参与聚类的文档上限。超限：视图诚实文案 + 路由 no-op。 */
export const KNOWLEDGE_CLUSTER_DOC_CAP = 200
/** n<20：分布视图不渲染且簇路由 no-op。 */
export const KNOWLEDGE_CLUSTER_MIN_DOCS = 20
/** 成组最小文档数；不足的簇解散为「未分组」。 */
export const KNOWLEDGE_CLUSTER_MIN_SIZE = 3
/** average-link 合并阈值（cosine over 纯 TF）。 */
export const KNOWLEDGE_CLUSTER_MERGE_MIN = 0.25
/** 索引重建防抖窗口（single-flight 合并）。 */
export const KNOWLEDGE_INDEX_DEBOUNCE_MS = 2000
/** 分组概览注入字符上限（含 wrap 标记），计入 8000 总预算。 */
export const KNOWLEDGE_GROUPMAP_CHARS = 2000

/**
 * 诚实门分支常数（spec §6.2 表 / §6.6 / AC-14）：2026-09-03 评测双栏
 * pass（`node scripts/knowledge-route-eval.mjs` → folder: pass / group: pass，
 * --strict 同过）后开闸为 true。
 * **漂移扳机仍在**：路由输入面任何改动（#272 bag、MERGE_MIN、#274 bag 两字段、
 * 注入序、常数表数值等）⇒ 对应分支常数必须回 false、重跑评测重证（spec §6.6）。
 * 这两个值 = 声称该分支认证通过，改动必须随附最新评测分栏输出。
 * 注意：开闸 ≠ 替用户打开——用户侧「按堆选文」开关（thread.knowledge_route_by_group）
 * 默认仍关，undefined = false。
 */
export const KNOWLEDGE_ROUTE_FOLDER_BRANCH = true
export const KNOWLEDGE_ROUTE_GROUP_BRANCH = true

/**
 * 评测/测试专用 seam：覆盖分支常数（不改动出厂常量本身）。
 * 生产代码从不调用；评测脚本用它测量「若开边会怎样」，测试用它走通两条边。
 */
let branchOverrides: { folder?: boolean; group?: boolean } | null = null
export function setKnowledgeRouteBranchOverrides(
  overrides: { folder?: boolean; group?: boolean } | null,
): void {
  branchOverrides = overrides
}
/** 当前生效的夹分支门（覆盖优先于出厂常数）。 */
export function knowledgeRouteFolderBranchOn(): boolean {
  return branchOverrides?.folder ?? KNOWLEDGE_ROUTE_FOLDER_BRANCH
}
/** 当前生效的组分支门（覆盖优先于出厂常数）。 */
export function knowledgeRouteGroupBranchOn(): boolean {
  return branchOverrides?.group ?? KNOWLEDGE_ROUTE_GROUP_BRANCH
}

// --- 派生索引文件（§6.1） ---

export const KNOWLEDGE_INDEX_FILENAME = "knowledge-index.json"

export type KnowledgeIndexDoc = {
  /** 文档 id（id || name），聚类 tie-break 与通道 ids 用。 */
  id: string
  name: string
  title: string
  tags: string[]
  /** 桶相对 posix 文件夹路径（"" = 桶根）。 */
  folder: string
  bucket: "global" | "sites" | ""
  /** 稀疏纯 TF 向量（title + description + tags + 首块），cosine 用。 */
  vec: Record<string, number>
}

/** LLM 分组展示条目（#296 display 派生字段；可丢可重建，不进检索/路由/导出）。 */
export type KnowledgeGraphLabelEntry = { name: string; summary?: string }

export type KnowledgeIndexFile = {
  version: 1
  built_at: string
  /** 构建时的磁盘指纹（与 computeDiskFingerprint 同形）；漂移即重建。 */
  fingerprint: string
  docs: KnowledgeIndexDoc[]
  /** 可选派生缓存（spec §5）：缺失容忍；条目形状不符整体丢弃。 */
  display?: Record<string, KnowledgeGraphLabelEntry>
}

export function knowledgeIndexPath(): string {
  return path.join(DATA_DIR, "cache", KNOWLEDGE_INDEX_FILENAME)
}

/** 读取派生索引；缺失 / 半截 / 损坏 / 形状不符一律按缺失处理（null），不 throw。 */
export function readKnowledgeIndexFile(p: string): KnowledgeIndexFile | null {
  try {
    const raw = fs.readFileSync(p, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    if (parsed.version !== 1) return null
    if (typeof parsed.fingerprint !== "string") return null
    if (!Array.isArray(parsed.docs)) return null
    for (const d of parsed.docs) {
      if (!d || typeof d.id !== "string" || typeof d.name !== "string") return null
      if (!d.vec || typeof d.vec !== "object") return null
    }
    // display 可选（#296）：形状不符整体丢弃，不连累索引本身
    if (parsed.display !== undefined) {
      const display = parsed.display as unknown
      if (!display || typeof display !== "object" || Array.isArray(display)) {
        delete parsed.display
      } else {
        for (const v of Object.values(display as Record<string, unknown>)) {
          if (!v || typeof v !== "object" || typeof (v as { name?: unknown }).name !== "string") {
            delete parsed.display
            break
          }
        }
      }
    }
    return parsed as KnowledgeIndexFile
  } catch {
    return null
  }
}

/** 0o600 + atomicWriteJSON 落盘（§6.1）。 */
export function writeKnowledgeIndexFile(p: string, index: KnowledgeIndexFile): void {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 })
  atomicWriteJSON(p, index, 0o600)
}

/** 索引向量：title + description + tags + 首块，纯 TF（不用 TF-IDF，§6.2 反 IDF 漂移）。 */
export function knowledgeIndexVec(doc: {
  title: string
  description: string
  tags: string[]
  firstChunk: string
}): Record<string, number> {
  return tokensToVec(
    tokenize(
      `${doc.title} ${doc.description} ${doc.tags.join(" ")} ${doc.firstChunk}`,
    ),
  )
}

// --- 聚类（§6.2）：average-link 凝聚，确定性三钉 ---

export type KnowledgeCluster = {
  /** 簇键 = 成员 id 的 min（字典序）。 */
  key: string
  label: string
  /** 成员 id，字典序。 */
  ids: string[]
}

/** codepoint 字典序比较（跨平台确定，与 Wave A 文档级 tie-break 同口径）。 */
export function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * average-link 凝聚聚类。
 * 确定性三钉（AC-8）：文档按 id 字典序进距离矩阵；合并平局按（簇键A, 簇键B）
 * 字典序先并（簇键 = 成员 id min；文档级 = 单例 id）；同一文档集 → 同一分组，
 * 跨索引重建与输入乱序不变。
 */
export function clusterKnowledgeDocs(
  docs: KnowledgeIndexDoc[],
): { groups: KnowledgeCluster[]; ungrouped: string[] } {
  const ordered = [...docs].sort((a, b) => compareCodepoint(a.id, b.id))
  const n = ordered.length
  if (n === 0) return { groups: [], ungrouped: [] }

  // N×N cosine 矩阵（纯 TF 向量）
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosineSimilarity(ordered[i].vec, ordered[j].vec)
      sim[i][j] = s
      sim[j][i] = s
    }
  }

  // 簇数组始终保持 key 字典序；扫描顺序即平局裁决顺序（strict > 保先见者）。
  let clusters: Array<{ key: string; members: number[] }> = ordered.map((d, i) => ({
    key: d.id,
    members: [i],
  }))

  for (;;) {
    let best: { a: number; b: number; sim: number } | null = null
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const ca = clusters[a]
        const cb = clusters[b]
        let sum = 0
        for (const i of ca.members) for (const j of cb.members) sum += sim[i][j]
        const avg = sum / (ca.members.length * cb.members.length)
        if (avg >= KNOWLEDGE_CLUSTER_MERGE_MIN && (!best || avg > best.sim)) {
          best = { a, b, sim: avg }
        }
      }
    }
    if (!best) break
    const merged = {
      key: compareCodepoint(clusters[best.a].key, clusters[best.b].key) <= 0
        ? clusters[best.a].key
        : clusters[best.b].key,
      members: [...clusters[best.a].members, ...clusters[best.b].members],
    }
    clusters = clusters.filter((_, i) => i !== best.a && i !== best.b)
    clusters.push(merged)
    clusters.sort((x, y) => compareCodepoint(x.key, y.key))
  }

  const byIndex = ordered
  const groups: KnowledgeCluster[] = []
  const ungrouped: string[] = []
  for (const c of clusters) {
    const ids = c.members.map((i) => byIndex[i].id).sort(compareCodepoint)
    if (c.members.length < KNOWLEDGE_CLUSTER_MIN_SIZE) {
      // 不足 MIN_SIZE 的簇解散为「未分组」
      ungrouped.push(...ids)
      continue
    }
    groups.push({ key: c.key, label: labelCluster(c.members.map((i) => byIndex[i])), ids })
  }
  ungrouped.sort(compareCodepoint)
  groups.sort((a, b) => compareCodepoint(a.key, b.key))
  return { groups, ungrouped }
}

// --- 簇标签（§6.3）：只从 title + tags；频次并列取字典序最小；过现成闸 ---

/**
 * 标签过闸：normalizeTag（含 SENSITIVE_TAG_RE、lowercase、≤MAX_TAG_LEN）+
 * redactSecrets（取 .text，不得把对象拼进字符串）。不过闸返回 null。
 */
export function gateClusterLabel(raw: string): string | null {
  const normalized = normalizeTag(raw)
  if (!normalized) return null
  if (SENSITIVE_TAG_RE.test(normalized)) return null
  const redacted = redactSecrets(normalized).text.trim()
  return redacted || null
}

/**
 * 簇标签：簇内共享高频 tags（df≥2）→ 共享标题词（df≥2）→ min id 成员标题截断；
 * 每步频次并列取字典序最小，逐候选过 gateClusterLabel。
 */
export function labelCluster(members: KnowledgeIndexDoc[]): string {
  // 1) 共享 tags
  const tagDf = new Map<string, number>()
  for (const m of members) {
    for (const t of new Set(m.tags.map((x) => String(x).toLowerCase()).filter(Boolean))) {
      tagDf.set(t, (tagDf.get(t) || 0) + 1)
    }
  }
  const tagCandidates = [...tagDf.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || compareCodepoint(a[0], b[0]))
  for (const [tag] of tagCandidates) {
    const gated = gateClusterLabel(tag)
    if (gated) return gated
  }

  // 2) 共享标题词
  const tokDf = new Map<string, number>()
  for (const m of members) {
    for (const t of new Set(tokenize(m.title))) {
      tokDf.set(t, (tokDf.get(t) || 0) + 1)
    }
  }
  const tokCandidates = [...tokDf.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || compareCodepoint(a[0], b[0]))
  for (const [tok] of tokCandidates) {
    const gated = gateClusterLabel(tok)
    if (gated) return gated
  }

  // 3) min id 成员标题截断
  const first = [...members].sort((a, b) => compareCodepoint(a.id, b.id))[0]
  const titleLine = String(first?.title || first?.id || "").replace(/\s+/g, " ").trim()
  const gated = gateClusterLabel(titleLine.slice(0, 24))
  if (gated) return gated
  return "分组"
}

// --- 分布视图（§6.2 表 / §6.4） ---

export type KnowledgeDistribution =
  | { status: "ok"; groups: KnowledgeCluster[]; ungrouped: string[] }
  | { status: "too_few" | "over_cap" | "all_ungrouped"; groups: []; ungrouped: string[] }

/**
 * 计算分布。不渲染态（too_few / over_cap / all_ungrouped）视图不渲染 chips，
 * 路由同步 no-op（AC-12/AC-15）；over_cap 由 UI 显示诚实文案。
 */
export function buildKnowledgeDistribution(docs: KnowledgeIndexDoc[]): KnowledgeDistribution {
  const ids = docs.map((d) => d.id).sort(compareCodepoint)
  if (docs.length < KNOWLEDGE_CLUSTER_MIN_DOCS) {
    return { status: "too_few", groups: [], ungrouped: ids }
  }
  if (docs.length > KNOWLEDGE_CLUSTER_DOC_CAP) {
    return { status: "over_cap", groups: [], ungrouped: ids }
  }
  const { groups, ungrouped } = clusterKnowledgeDocs(docs)
  if (groups.length === 0) {
    // 全离群只剩「未分组」一枚 chip 时不渲染（不假装结构）
    return { status: "all_ungrouped", groups: [], ungrouped }
  }
  return { status: "ok", groups, ungrouped }
}

export type KnowledgeDistributionChannel = {
  groups: Array<{
    /** 稳定身份键，带命名空间前缀（Gate9 r2 claude N2 防保留键碰撞）：
     * 分组 = `c:<成员 id min>`，「未分组」= `u:ungrouped`。label 仅显示用。 */
    key: string
    label: string
    count: number
    ids: string[]
  }>
  /** 不渲染原因（groups 为空时）：over_cap 由 UI 显示诚实文案。 */
  reason?: "too_few" | "over_cap" | "all_ungrouped"
}

/**
 * 「未分组」chip 的保留身份键。命名空间前缀（u:/c:）保证即使用户把文档命名为
 * `__ungrouped__` 且它恰是某分组的 id-min，两枚 chip 的 key 也不串。
 */
export const KNOWLEDGE_UNGROUPED_KEY = "u:ungrouped"

/**
 * 通道形状（§6.4）：顶层 distribution?，禁 per-doc cluster_id。
 * 有真分组时「未分组」作为最后一枚过滤 chip；chip 序 = count 降序、并列 ids[0] 字典序。
 */
export function toDistributionChannel(dist: KnowledgeDistribution): KnowledgeDistributionChannel {
  if (dist.status !== "ok") {
    return { groups: [], reason: dist.status }
  }
  const groups = [...dist.groups]
    .sort((a, b) => b.ids.length - a.ids.length || compareCodepoint(a.ids[0], b.ids[0]))
    .map((g) => ({ key: `c:${g.key}`, label: g.label, count: g.ids.length, ids: g.ids }))
  if (dist.ungrouped.length > 0) {
    groups.push({ key: KNOWLEDGE_UNGROUPED_KEY, label: "未分组", count: dist.ungrouped.length, ids: [...dist.ungrouped] })
  }
  return { groups }
}

// --- 分组概览（§6.5 构成钉死） ---

/** 概览的一个分组小节：组名 + 成员标题行（行序由调用方按钉死键排好）。 */
export type GroupmapSection = { label: string; lines: string[] }

/** 概览整串 sanitize + untrusted wrap（与知识块同款，不是可信指令块）。 */
export function wrapGroupmap(content: string): string {
  return wrapKnowledgeBlock("groupmap", "分组概览", sanitizeKnowledgeContent(content))
}

function sectionLines(section: GroupmapSection): string[] {
  return [`【${section.label}】`, ...section.lines.map((l) => `- ${l}`)]
}

/**
 * 概览装进字符上限：截断从尾部丢整行（不丢半截行）；
 * 剩余 < 完整最小行（一个分组名 + 一行标题）⇒ 返回 null（调用方省略 +
 * groupmap_omitted）。maxChars 含 wrap 标记（与 AC-2 包装开销同口径）。
 * 零成员小节自动跳过；最小行判定用第一个**非空**小节（Gate9 F2：首节空
 * 不得把后面有内容的小节一起丢掉）。
 */
export function fitGroupmap(
  sections: GroupmapSection[],
  maxChars: number,
): { wrapped: string; lines: string[] } | null {
  const nonEmpty = sections.filter((s) => s.lines.length > 0)
  if (nonEmpty.length === 0) return null
  const minimal = [`【${nonEmpty[0].label}】`, `- ${nonEmpty[0].lines[0]}`]
  if (wrapGroupmap(minimal.join("\n")).length > maxChars) return null

  const accepted: string[] = []
  for (const section of nonEmpty) {
    const lines = sectionLines(section)
    // 小节头至少带一行标题才进入（避免尾部孤 header）
    const headerWithFirst = [...accepted, lines[0], lines[1]]
    if (wrapGroupmap(headerWithFirst.join("\n")).length > maxChars) break
    accepted.push(lines[0], lines[1])
    for (const line of lines.slice(2)) {
      const candidate = [...accepted, line]
      if (wrapGroupmap(candidate.join("\n")).length > maxChars) {
        return { wrapped: wrapGroupmap(accepted.join("\n")), lines: accepted }
      }
      accepted.push(line)
    }
  }
  return accepted.length > 0 ? { wrapped: wrapGroupmap(accepted.join("\n")), lines: accepted } : null
}
