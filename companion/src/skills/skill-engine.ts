// Skill engine — load, inject, and manage skills

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as crypto from "crypto"
import { tokenize, tfidfVec, idfFromDocs, cosineSimilarity } from "./semantic-match"
import matter from "gray-matter"
import AdmZip from "adm-zip"
import * as yaml from "js-yaml"
import { getConfigDir, type LlmConfig as CompanionLlmConfig } from "../config"
import { createProvider } from "../llm/provider"
import { fallbackThreadManager, type ThreadManager } from "../threads/thread-manager"
import { matchSite } from "./site-matcher"
import { sanitizeKnowledgeContent, wrapKnowledgeBlock } from "./content-sanitizer"
import { chunkFile, searchChunks, type FileChunk } from "../file-chunker"
import {
  allocateDocIdentity,
  cleanTitle,
  FOLDER_META_FILENAME,
  isLegacySafeId,
  isSymlinkOrJunction,
  isUnsafePathComponent,
  listStemSet,
  nfc,
  writeRestrictedFile,
} from "./doc-identity"
import { validateWildcardPattern } from "../security"
import { redactSecrets } from "../threads/distill"
import { normalizeTags } from "../threads/digest"
import { findRelatedKnowledge, KNOWLEDGE_RELATED_LIMIT, type RelatedKnowledgeInput } from "./knowledge-related"
import { hashKnowledgeBody, knowledgeDuplicateExempt, stripPdfFilenameHeading } from "./knowledge-duplicate"
import {
  KNOWLEDGE_GROUPMAP_CHARS,
  buildKnowledgeDistribution,
  compareCodepoint,
  fitGroupmap,
  knowledgeIndexPath,
  knowledgeIndexVec,
  knowledgeRouteFolderBranchOn,
  knowledgeRouteGroupBranchOn,
  readKnowledgeIndexFile,
  toDistributionChannel,
  writeKnowledgeIndexFile,
  KNOWLEDGE_INDEX_DEBOUNCE_MS,
  type GroupmapSection,
  type KnowledgeDistributionChannel,
  type KnowledgeIndexDoc,
  type KnowledgeIndexFile,
  type KnowledgeGraphLabelEntry,
} from "./knowledge-clusters"
import {
  KNOWLEDGE_GRAPH_DISPLAY_MAX_ENTRIES,
  buildKnowledgeGraph,
  type KnowledgeGraphCore,
} from "./knowledge-graph"

export const KNOWLEDGE_BODY_WIRE_CAP = 512 * 1024
export const KNOWLEDGE_FILE_CAP = 6 * 1024 * 1024

// --- Knowledge folders (#274): 磁盘目录 = SoT，桶内 ≤3 级 ---
// Spec: docs/superpowers/specs/2026-09-02-knowledge-folders-design.md
/** 用户文件夹最大级数（桶根 = 第 0 级）。 */
export const KNOWLEDGE_FOLDER_MAX_DEPTH = 3
/** 单层（一个父目录直下）最大条目数。 */
export const KNOWLEDGE_FOLDER_MAX_CHILDREN = 50
/** _folder.md 说明上限（与文档 description 同预算）。 */
export const KNOWLEDGE_FOLDER_DESCRIPTION_MAX = 500

// --- Knowledge retrieval scoring constants (#273 Wave A, spec §2.4) ---
// Centralized here; no magic numbers at call sites.
/** auto 模式文档级 top-k。 */
export const KNOWLEDGE_DOC_TOPK_AUTO = 5
/** all 模式文档级 top-k。 */
export const KNOWLEDGE_DOC_TOPK_ALL = 8
/** 跨文档注入总字符硬预算（只记 summary 正文，不含 wrap 包装）。 */
export const KNOWLEDGE_INJECT_BUDGET_CHARS = 8000
/** 注入阈值：看未加 SITE_BOOST 的裸 cosine。 */
export const KNOWLEDGE_SCORE_MIN = 0.10
/** auto 模式当前站点加权（只改排序，不改阈值，不是硬过滤也不是硬灌）。 */
export const KNOWLEDGE_SITE_BOOST = 0.15
/** 空 query + 智能匹配开的 auto 退化：每篇只注入 description 的上限字符。 */
export const KNOWLEDGE_EMPTY_QUERY_DESCRIPTION_CHARS = 500
/**
 * wrapKnowledgeBlock 每篇包装的固定标记字符数（AC-2 上界口径）：
 * = 标题行骨架（"## Knowledge: " + " []" + 换行）+ fence 开闭标记（含 12 位
 * wrapId 与 source="knowledge"）+ 免责行 + 各换行，不含 title/id 变长部分。
 * 用空串实调 wrapKnowledgeBlock 算得；不进 8000 知识预算。
 */
export const KNOWLEDGE_WRAP_OVERHEAD_CHARS = wrapKnowledgeBlock("", "", "").length
/** 预算内截断标记（与 getKnowledgeSummary 的 2000 字截断同形）。 */
const KNOWLEDGE_TRUNC_MARK = "\n... (truncated)"
/** Body update after a truncated get — not the download copy. */
export const KNOWLEDGE_TRUNCATED_BODY_UPDATE_ERROR =
  "正文已截断，禁止保存覆盖未读到的尾部"

export type KnowledgeUpdatePatch = {
  title?: string
  tags?: string[]
  description?: string
  body?: string
}

export type KnowledgeListItem = {
  name: string
  id?: string
  title?: string
  description: string
  type: Skill["type"]
  site?: string
  tags?: string[]
  builtin: boolean
  /** #274: 相对桶根的 posix 文件夹路径（"" = 桶根）。派生自磁盘，不是 frontmatter 真相。 */
  folder?: string
  related?: Array<{ id: string; title: string }>
}

/** #274: 桶内一个真实目录的元数据（_folder.md 已保存说明 + 过期标记）。 */
export type KnowledgeFolderItem = {
  bucket: "global" | "sites"
  /** 相对桶根的 posix 路径（如 "竞品/2025"）。 */
  path: string
  title: string
  description: string
  /** 已保存说明后文件夹内容指纹又发生变化。 */
  stale: boolean
}

export type KnowledgeDocView = {
  id: string
  name: string
  title: string
  tags?: string[]
  description: string
  type: Skill["type"]
  site?: string
  builtin: boolean
  body: string
  char_count: number
  truncated: boolean
  related: Array<{ id: string; title: string }>
}

export type RetrievedSource = {
  id: string
  title: string
  chunk_index?: number
  chars: number
  /** #273 Wave B (AC-18): 路由 ON 时来源分组标签（派生、可选、不进文档 SoT）。 */
  group_label?: string
}

/**
 * #273 Wave B：buildSystemPromptWithSources 附带的路由元数据。
 * 仅在「按堆选文」开关 ON 且前置满足（auto + 智能匹配开 + 非空 query +
 * 分布可渲染）的轮次出现。s_pre = 第二趟完整候选 id 有序（预算前）；
 * groupmap = omitted 时即 §6.5/AC-10 的 groupmap_omitted 态
 * （标记放在 retrieved_sources 同层 sibling 而非数组元素，保 N=|S_post| 口径干净）。
 */
export type KnowledgeRoutingMeta = {
  s_pre: string[]
  groupmap: "injected" | "omitted"
  groupmap_chars?: number
}

/** buildSystemPromptWithSources 的知识侧选项。 */
export type BuildPromptKnowledgeOpts = {
  /** 空 query + 智能匹配开的 auto 退化：每篇只注入 description。 */
  knowledgeDescriptionOnly?: boolean
  /** Wave B 路由上下文（缺省从 thread 记录推导；测试/评测可显式覆盖）。 */
  knowledgeMode?: "auto" | "all" | "manual"
  knowledgeSmartMatch?: boolean
  /** 用户侧「按堆选文」开关（默认关）。 */
  knowledgeRouteByGroup?: boolean
}

/**
 * #273 Wave B §6.5: 簇路由计划（引擎内部）。
 * 打分语料 = Wave A 入选集 ∪ pinned ∪（FOLDER_BRANCH ∧ 命中夹 ? 夹全部成员）
 * ∪（GROUP_BRANCH ∧ 无命中夹 ? top-1-2 派生组成员）；第二趟不重截 k。
 */
interface KnowledgeRoutingPlan {
  /** 该边分支常数 false → no-op 回 Wave A：不扩张、不灌概览，打 groupmap_omitted。 */
  edgeClosed: boolean
  /** ① 全部 pinned（resolve 的 pinned 顺序，不得被挤）。 */
  pinnedDocs: Skill[]
  /** ② Wave A 入选非 pinned，按排序分降序（并列 id 字典序最小）。 */
  picked: Skill[]
  /** 过阈扩张尾部（语料 \ 入选集 \ pinned，裸分 ≥ SCORE_MIN），按排序分降序。 */
  tail: Skill[]
  /** 第二趟完整候选 = pinned ∪ { 语料过阈 }（pinned 在前，其余按分）。 */
  candidates: Skill[]
  /** 分组概览小节（只列本轮实际使用的粗索引；组间序/组内序已按钉死键排好）。 */
  sections: GroupmapSection[]
  /** 粗索引零成员过阈 → 省略概览 + groupmap_omitted。 */
  zeroPassing: boolean
  /** doc name → 来源分组标签（真分组成员才有；「未分组」无标签）。 */
  labelByName: Map<string, string>
  /** 第二趟完整候选 id 有序（概览与 8000 前）。 */
  sPre: string[]
}

interface ExperienceEntry {
  id: string
  category: "problem" | "success" | "tip" | "rule"
  content: string
  recorded_at: string
  confirmed_at: string | null
  stale: boolean
  stale_reason: string
  replaced_by: string
}

interface SkillMeta {
  name: string
  /** Stable id when distinct from name (new CJK docs). */
  id?: string
  /** Display heading; CJK allowed. Falls back to name. */
  title?: string
  description: string
  type: "prompt_template" | "tool_chain" | "sub_agent" | "site_knowledge" | "domain_knowledge"
  site?: string
  tags?: string[]
  priority?: "high" | "normal" | "low"
  entries?: ExperienceEntry[]
  builtin: boolean
  source_file: string
  dir?: string
  resources: string[]
  /** #274: 知识文档相对桶根的 posix 文件夹路径（""/缺省 = 桶根）。loader 从 source_file 推导。 */
  folder?: string
}

/** #274: 已加载文件夹元数据（_folder.md 落盘内容；草稿从不进这里）。 */
interface KnowledgeFolderState {
  title: string
  description: string
  /** 保存说明时的内容指纹（"" = 未记录，不标过期）。 */
  fingerprint: string
}

interface Skill extends SkillMeta {
  content: string  // markdown body (without frontmatter)
}

/** Accept full companion llm config so protocol/profile reach createProvider. */
type LlmConfig = CompanionLlmConfig

/** Result of Side Panel `/技能` pin (`/^\/(\S+)/` on this-turn message). */
export type SlashSkillPin = {
  skillName: string
  skill_selection_mode: "manual"
  active_skill_ids: string[]
}

/**
 * Matching-honesty pin door: a leading `/name` token in the user message that
 * matches a skill doc (case-insensitive) switches the thread to 按需 (`manual`)
 * and ensures that skill is in `active_skill_ids`.
 *
 * Detect from `rest.message`, NOT `rest.skill_ids` (the extension always sends
 * activeSkillIds). Overlay `skill.activate` must not call this — it must not
 * write `skill_selection_mode`.
 */
export function pinSlashSkill(
  thread: { skill_selection_mode?: "auto" | "all" | "manual"; active_skill_ids?: string[] } | null | undefined,
  message: string,
  skills: Array<{ name: string }>,
): SlashSkillPin | null {
  if (!thread || typeof message !== "string") return null
  const m = message.match(/^\/(\S+)/)
  if (!m) return null
  const token = m[1].toLowerCase()
  const skill = skills.find((s) => typeof s.name === "string" && s.name.toLowerCase() === token)
  if (!skill) return null
  const active = Array.isArray(thread.active_skill_ids) ? [...thread.active_skill_ids] : []
  if (!active.includes(skill.name)) active.push(skill.name)
  return {
    skillName: skill.name,
    skill_selection_mode: "manual",
    active_skill_ids: active,
  }
}

const KNOWLEDGE_SEARCH_THRESHOLD_TOKENS = 1000
const KNOWLEDGE_SEARCH_TOPK = 3

/**
 * 150-char heuristic description fallback — cleans markdown (code blocks,
 * headings, lists, bold) and truncates. Single source shared by
 * ensureKnowledgeFrontmatter (stamping) and previewKnowledge (#272 F2: modal
 * draft must never be empty for a non-empty body).
 */
function heuristicKnowledgeDescription(body: string): string {
  const cleaned = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim()
  return cleaned.slice(0, 150) + (cleaned.length > 150 ? "..." : "")
}

export class SkillEngine {
  private skillsDir: string
  private builtinDir: string
  private knowledgeDir: string
  private skillsCache: Skill[] = []
  private threadSkillMap: Map<string, string[]> = new Map() // threadId → skill names
  private llmConfig?: LlmConfig
  private knowledgeChunks: Map<string, FileChunk[]> = new Map()
  /** #274: `${bucket}/${folderPath}` → _folder.md 落盘元数据（仅已保存内容）。 */
  private knowledgeFolders: Map<string, KnowledgeFolderState> = new Map()
  /**
   * Cheap disk fingerprint (path|mtimeMs|size lines, sorted).
   * Used by refreshIfStale() so external drops into skills/ are picked up without
   * re-parsing every skill.list click when nothing changed (audit item 10).
   */
  private diskFingerprint: string | null = null

  // --- #273 Wave B: 派生索引生命周期（§6.1） ---
  /** 内存中的派生索引（null = 不可用/重建失败；undefined = 尚未尝试）。 */
  private knowledgeIndex: KnowledgeIndexFile | null | undefined = undefined
  /** 防抖重建定时器（single-flight：重建是同步的，防抖窗口合并连续触发）。 */
  private knowledgeIndexTimer: ReturnType<typeof setTimeout> | null = null

  private boundThreads: ThreadManager | null = null

  constructor(llmConfig?: LlmConfig) {
    this.skillsDir = path.join(getConfigDir(), "skills")
    this.builtinDir = path.join(getConfigDir(), "builtin-skills")
    this.knowledgeDir = path.join(getConfigDir(), "knowledge")
    this.llmConfig = llmConfig
    this.refresh()
  }

  /** Batch D D1: production binds the process singleton. Tests may skip. */
  bindThreadManager(tm: ThreadManager): void {
    this.boundThreads = tm
  }

  private threads(): ThreadManager {
    return this.boundThreads || fallbackThreadManager()
  }

  /** Roots watched for external skill/knowledge file changes. */
  private scanRoots(): string[] {
    return [
      this.skillsDir,
      this.builtinDir,
      path.join(this.knowledgeDir, "global"),
      path.join(this.knowledgeDir, "sites"),
    ]
  }

  /**
   * Build a stable fingerprint of skill-relevant files under scan roots.
   * Only stats metadata — no file content reads. Missing dirs contribute nothing.
   */
  computeDiskFingerprint(): string {
    const lines: string[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > 6) return
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      // Stable order
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          walk(full, depth + 1)
          continue
        }
        if (!ent.isFile()) continue
        // Skills: .md / SKILL.md; knowledge: same
        if (!ent.name.endsWith(".md") && !ent.name.endsWith(".markdown")) continue
        try {
          const st = fs.statSync(full)
          lines.push(`${full}|${st.mtimeMs}|${st.size}`)
        } catch {
          /* race: file removed mid-walk */
        }
      }
    }
    for (const root of this.scanRoots()) {
      walk(root, 0)
    }
    return lines.join("\n")
  }

  /**
   * Re-scan filesystem only when mtime/size fingerprint changed.
   * @returns true if a full refresh ran
   */
  refreshIfStale(): boolean {
    const fp = this.computeDiskFingerprint()
    if (this.diskFingerprint !== null && fp === this.diskFingerprint) {
      return false
    }
    this.refresh()
    return true
  }

  /** Ensure cache matches disk before list/match (no-op if fingerprint unchanged). */
  ensureFresh(): void {
    this.refreshIfStale()
  }

  refresh(): void {
    this.skillsCache = []
    this.knowledgeFolders = new Map()
    // Load user skills
    this.loadFromDir(this.skillsDir, false)
    // Load builtin skills (including security/ subdirectory)
    this.loadFromDir(this.builtinDir, true)
    // #274: knowledge buckets use a dedicated RECURSIVE tree loader — never the
    // loadFromDir SKILL.md skill-package branch (a nested knowledge/global/foo/
    // SKILL.md is an ordinary knowledge doc and must not leak into skill.list).
    this.loadKnowledgeTree("global", path.join(this.knowledgeDir, "global"))
    this.loadKnowledgeTree("sites", path.join(this.knowledgeDir, "sites"))
    // Pre-chunk large knowledge docs for RAG
    this.rebuildKnowledgeChunks()
    // Capture fingerprint after load so API mutations + disk drops stay in sync
    const prevFingerprint = this.diskFingerprint
    this.diskFingerprint = this.computeDiskFingerprint()
    // #273 Wave B: WS 写路径 ∪ 指纹变化的重建触发（防抖 + single-flight）。
    // 所有写路径（导入/保存/删除/移动/文件夹）都过 refresh()；读路径另兜
    // 文件缺失/损坏（ensureKnowledgeIndex 立即重建）。指纹没变不排重建
    // （Gate9 F5：无条件调度会让无变化的 refresh 也白重建一次）。
    if (prevFingerprint !== this.diskFingerprint) {
      this.scheduleKnowledgeIndexRebuild()
    }
  }

  // --- #273 Wave B: 派生索引（§6.1；纯派生、可丢、可重建，SoT 仍是磁盘 .md） ---

  /**
   * 防抖重建（KNOWLEDGE_INDEX_DEBOUNCE_MS）。single-flight：重建本身同步执行，
   * 不并发写；窗口内连续触发合并为最后一次（原子写兜底）。
   */
  private scheduleKnowledgeIndexRebuild(): void {
    if (this.knowledgeIndexTimer) clearTimeout(this.knowledgeIndexTimer)
    this.knowledgeIndexTimer = setTimeout(() => {
      this.knowledgeIndexTimer = null
      this.rebuildKnowledgeIndexSafe()
    }, KNOWLEDGE_INDEX_DEBOUNCE_MS)
    this.knowledgeIndexTimer.unref?.()
  }

  /** 聚类/索引层任何异常 → 仅日志、索引置不可用，降级 Wave A 扁平打分（§6.1/§2.5）。 */
  private rebuildKnowledgeIndexSafe(): void {
    try {
      const docs = this.buildKnowledgeIndexDocs()
      const prevDisplay = this.knowledgeIndex?.display
      const index: KnowledgeIndexFile = {
        version: 1,
        built_at: new Date().toISOString(),
        fingerprint: this.diskFingerprint || this.computeDiskFingerprint(),
        docs,
        // display 是可丢派生缓存：重建时按软界携带（分组键漂移自然失效）
        ...(prevDisplay && Object.keys(prevDisplay).length <= KNOWLEDGE_GRAPH_DISPLAY_MAX_ENTRIES
          ? { display: prevDisplay }
          : {}),
      }
      writeKnowledgeIndexFile(knowledgeIndexPath(), index)
      this.knowledgeIndex = index
    } catch (e) {
      console.warn("[skills] knowledge index rebuild failed; routing/distribution degraded:", e)
      this.knowledgeIndex = null
    }
  }

  /** 每篇文档的稀疏纯 TF 向量（title + description + tags + 首块）。 */
  private buildKnowledgeIndexDocs(): KnowledgeIndexDoc[] {
    const pool = this.skillsCache.filter((s) => this.isKnowledgeDoc(s))
    const docs = pool.map((s): KnowledgeIndexDoc => {
      const chunked = chunkFile(s.name, s.content || "", KNOWLEDGE_SEARCH_THRESHOLD_TOKENS)
      const firstChunk = chunked.chunks[0]?.text || ""
      const tags = Array.isArray(s.tags) ? s.tags.map(String) : []
      const title = s.title || s.name
      return {
        id: s.id || s.name,
        name: s.name,
        title,
        tags,
        folder: s.folder || "",
        bucket: this.knowledgeBucketOf(s.source_file) || "",
        vec: knowledgeIndexVec({
          title,
          description: s.description || "",
          tags,
          firstChunk,
        }),
      }
    })
    docs.sort((a, b) => compareCodepoint(a.id, b.id))
    return docs
  }

  /**
   * 读路径确保索引可用：内存命中 → 磁盘文件（缺失/半截/损坏按缺失处理，
   * 不 throw）→ 指纹漂移或缺失则立即重建（并取消挂起的防抖重建）。
   * 重建失败返回 null —— 调用方按「无分布」降级，不阻塞注入。
   */
  private ensureKnowledgeIndex(): KnowledgeIndexFile | null {
    try {
      this.ensureFresh()
      const fp = this.diskFingerprint || ""
      if (this.knowledgeIndex && this.knowledgeIndex.fingerprint === fp) {
        return this.knowledgeIndex
      }
      const fromDisk = readKnowledgeIndexFile(knowledgeIndexPath())
      if (fromDisk && fromDisk.fingerprint === fp) {
        this.knowledgeIndex = fromDisk
        return fromDisk
      }
      if (this.knowledgeIndexTimer) {
        clearTimeout(this.knowledgeIndexTimer)
        this.knowledgeIndexTimer = null
      }
      this.rebuildKnowledgeIndexSafe()
      return this.knowledgeIndex ?? null
    } catch (e) {
      console.warn("[skills] knowledge index unavailable; degraded:", e)
      return null
    }
  }

  /**
   * 分布视图数据（knowledge.list 顶层 distribution 通道；§6.4）。
   * null = 索引不可用（字段缺席）；非 ok 态返回 { groups: [], reason }。
   */
  getKnowledgeDistribution(): KnowledgeDistributionChannel | null {
    const index = this.ensureKnowledgeIndex()
    if (!index) return null
    try {
      return toDistributionChannel(buildKnowledgeDistribution(index.docs))
    } catch (e) {
      console.warn("[skills] knowledge distribution failed; degraded:", e)
      return null
    }
  }

  /**
   * 图谱视图数据（#296 knowledge.graph 通道）。null = 索引不可用
   * （handler 映射为 status:"rebuilding"，不假装结构）。
   */
  getKnowledgeGraph(opts?: { llmLabels?: boolean }): KnowledgeGraphCore | null {
    const index = this.ensureKnowledgeIndex()
    if (!index) return null
    try {
      return buildKnowledgeGraph(index.docs, index.display, opts)
    } catch (e) {
      console.warn("[skills] knowledge graph build failed; degraded:", e)
      return null
    }
  }

  /** LLM 分组标签写回 display 派生缓存（内存 + 索引文件；失败仅日志，不阻塞）。 */
  setKnowledgeGraphDisplay(entries: Record<string, KnowledgeGraphLabelEntry>): void {
    try {
      const index = this.ensureKnowledgeIndex()
      if (!index) return
      const display = { ...index.display, ...entries }
      if (Object.keys(display).length > KNOWLEDGE_GRAPH_DISPLAY_MAX_ENTRIES) return
      index.display = display
      writeKnowledgeIndexFile(knowledgeIndexPath(), index)
    } catch (e) {
      console.warn("[skills] knowledge graph display write failed; degraded:", e)
    }
  }

  /**
   * Knowledge vs skill separation.
   * Knowledge docs live under knowledge/{global,sites}/ and may use Obsidian
   * frontmatter types (goal/task/meeting/…) — not only site_knowledge /
   * domain_knowledge. Classifying by path (plus classic knowledge types for
   * legacy files under skills/) keeps Skills panel free of vault notes.
   */
  private isUnderKnowledgeDir(sourceFile: string): boolean {
    try {
      const src = path.resolve(sourceFile)
      const root = path.resolve(this.knowledgeDir)
      return src === root || src.startsWith(root + path.sep)
    } catch {
      return false
    }
  }

  private isKnowledgeDoc(skill: Pick<Skill, "type" | "source_file">): boolean {
    // #274: _folder.md 标记位 — 文件夹元数据永远不是知识文档（不进列表/注入/related）。
    if ((skill as { type?: string }).type === "knowledge_folder") return false
    if (this.isUnderKnowledgeDir(skill.source_file)) return true
    return skill.type === "site_knowledge" || skill.type === "domain_knowledge"
  }

  private isSkillDoc(skill: Pick<Skill, "type" | "source_file">): boolean {
    return !this.isKnowledgeDoc(skill)
  }

  /** Stems already used as skill/knowledge id or filename (F-I-6). */
  private collectTakenStems(): Set<string> {
    this.ensureFresh()
    const taken = new Set<string>()
    for (const dir of [
      this.skillsDir,
      this.builtinDir,
      path.join(this.knowledgeDir, "global"),
      path.join(this.knowledgeDir, "sites"),
    ]) {
      for (const stem of listStemSet(dir)) taken.add(stem)
    }
    for (const s of this.skillsCache) {
      if (s.name) taken.add(s.name.toLowerCase())
      if (s.id) taken.add(s.id.toLowerCase())
    }
    return taken
  }

  private rebuildKnowledgeChunks(): void {
    this.knowledgeChunks.clear()
    for (const skill of this.skillsCache) {
      if (!this.isKnowledgeDoc(skill)) continue
      const chunked = chunkFile(skill.name, skill.content, KNOWLEDGE_SEARCH_THRESHOLD_TOKENS)
      // Only store chunks if the doc is actually large enough to need splitting
      if (chunked.chunks.length > 1 || chunked.totalTokens > KNOWLEDGE_SEARCH_THRESHOLD_TOKENS) {
        this.knowledgeChunks.set(skill.name, chunked.chunks)
        if (skill.id && skill.id !== skill.name) {
          this.knowledgeChunks.set(skill.id, chunked.chunks)
        }
      }
    }
  }

  /** Get all security skills from builtin-skills/security/ */
  getSecuritySkills(): Skill[] {
    return this.skillsCache.filter(
      s => s.builtin && s.source_file.includes(path.sep + "security" + path.sep),
    )
  }

  private loadFromDir(dir: string, builtin: boolean): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (isSymlinkOrJunction(dir, entry)) continue
        const entryPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          // Folder-based skill: look for SKILL.md inside
          const skillMdPath = path.join(entryPath, "SKILL.md")
          if (fs.existsSync(skillMdPath)) {
            try {
              const raw = fs.readFileSync(skillMdPath, "utf-8")
              const parsed = matter(raw)
              const name = parsed.data.name || entry.name
              const id = typeof parsed.data.id === "string" ? parsed.data.id : undefined
              const title = typeof parsed.data.title === "string" ? parsed.data.title : undefined
              const description = parsed.data.description || ""
              const type = parsed.data.type || "prompt_template"
              const site = parsed.data.site
              const tags = parsed.data.tags
              const priority = parsed.data.priority
              const entries = parsed.data.entries

              // Collect resource files (all non-SKILL.md files in directory)
              const resources = fs.readdirSync(entryPath)
                .filter(f => f !== "SKILL.md")
                .filter(f => {
                  const stat = fs.statSync(path.join(entryPath, f))
                  return stat.isFile()
                })

              this.skillsCache.push({
                name,
                id,
                title,
                description,
                type,
                builtin,
                source_file: skillMdPath,
                dir: entryPath,
                content: parsed.content,
                resources,
                site,
                tags,
                priority,
                entries,
              })
            } catch {
              // skip malformed folder skills
            }
          }
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          // Flat .md skill file (backward compat)
          try {
            const raw = fs.readFileSync(entryPath, "utf-8")
            const parsed = matter(raw)
            const name = parsed.data.name || entry.name.replace(".md", "")
            const id = typeof parsed.data.id === "string" ? parsed.data.id : undefined
            const title = typeof parsed.data.title === "string" ? parsed.data.title : undefined
            const description = parsed.data.description || ""
            const type = parsed.data.type || "prompt_template"
            const site = parsed.data.site
            const tags = parsed.data.tags
            const priority = parsed.data.priority
            const entries = parsed.data.entries

            this.skillsCache.push({
              name,
              id,
              title,
              description,
              type,
              builtin,
              source_file: entryPath,
              content: parsed.content,
              resources: [],
              site,
              tags,
              priority,
              entries,
            })
          } catch {
            // skip malformed skills
          }
        }
      }
    } catch {
      // directory may not exist yet
    }
  }

  // --- #274: knowledge folder tree (disk directories are the SoT) ---

  /**
   * Recursive knowledge bucket loader. Distinct from loadFromDir on purpose:
   * no SKILL.md skill-package branch (a SKILL.md inside a knowledge tree is an
   * ordinary knowledge doc), `_folder.md` becomes folder metadata instead of a
   * doc, and each doc gets `folder` derived from its path relative to the
   * bucket root (frontmatter `folder:` is ignored — disk wins, F-I-防漂移).
   */
  private loadKnowledgeTree(bucket: "global" | "sites", root: string): void {
    const walk = (dir: string, rel: string, depth: number) => {
      // Scan deeper than the 3-level user cap so over-deep drops still load
      // (aligned with the depth≤6 disk fingerprint); the UI flattens display.
      if (depth > 6) return
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue
        if (isSymlinkOrJunction(dir, entry)) continue
        const entryPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const childRel = rel ? `${rel}/${nfc(entry.name)}` : nfc(entry.name)
          this.registerKnowledgeFolder(bucket, childRel)
          walk(entryPath, childRel, depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        if (!entry.name.endsWith(".md") && !entry.name.endsWith(".markdown")) continue
        if (entry.name === FOLDER_META_FILENAME) {
          // Bucket-root _folder.md is meaningless (root is not a user folder).
          if (rel) this.loadKnowledgeFolderMeta(bucket, rel, entryPath)
          continue
        }
        try {
          const raw = fs.readFileSync(entryPath, "utf-8")
          const parsed = matter(raw)
          const name = parsed.data.name || entry.name.replace(/\.(md|markdown)$/, "")
          const id = typeof parsed.data.id === "string" ? parsed.data.id : undefined
          const title = typeof parsed.data.title === "string" ? parsed.data.title : undefined
          this.skillsCache.push({
            name,
            id,
            title,
            description: parsed.data.description || "",
            type: parsed.data.type || "prompt_template",
            builtin: false,
            source_file: entryPath,
            content: parsed.content,
            resources: [],
            site: parsed.data.site,
            tags: parsed.data.tags,
            priority: parsed.data.priority,
            entries: parsed.data.entries,
            folder: rel,
          })
        } catch {
          // skip malformed knowledge docs (same tolerance as loadFromDir)
        }
      }
    }
    walk(root, "", 0)
  }

  private knowledgeFolderKey(bucket: "global" | "sites", folderPath: string): string {
    return `${bucket}/${folderPath}`
  }

  /** Every real directory under a bucket root is a folder, even without _folder.md. */
  private registerKnowledgeFolder(bucket: "global" | "sites", folderPath: string): void {
    const key = this.knowledgeFolderKey(bucket, folderPath)
    if (this.knowledgeFolders.has(key)) return
    const last = folderPath.split("/").pop() || folderPath
    this.knowledgeFolders.set(key, { title: last, description: "", fingerprint: "" })
  }

  /** Best-effort _folder.md parse; corrupt files degrade to "folder without description". */
  private loadKnowledgeFolderMeta(bucket: "global" | "sites", folderPath: string, filePath: string): void {
    this.registerKnowledgeFolder(bucket, folderPath)
    const key = this.knowledgeFolderKey(bucket, folderPath)
    const cur = this.knowledgeFolders.get(key) as KnowledgeFolderState
    try {
      const parsed = matter(fs.readFileSync(filePath, "utf-8"))
      const title = typeof parsed.data.title === "string" && parsed.data.title.trim()
        ? parsed.data.title.trim()
        : cur.title
      const description = typeof parsed.data.description === "string"
        ? parsed.data.description.slice(0, KNOWLEDGE_FOLDER_DESCRIPTION_MAX)
        : ""
      const fingerprint = typeof parsed.data.content_fingerprint === "string"
        ? parsed.data.content_fingerprint
        : ""
      this.knowledgeFolders.set(key, { title, description, fingerprint })
    } catch {
      // corrupt _folder.md → folder renders without a description; docs unaffected
    }
  }

  /** Bucket that owns a knowledge source file (null for legacy skills/ knowledge). */
  private knowledgeBucketOf(sourceFile: string): "global" | "sites" | null {
    try {
      const src = path.resolve(sourceFile)
      for (const bucket of ["global", "sites"] as const) {
        const root = path.resolve(this.knowledgeDir, bucket)
        if (src.startsWith(root + path.sep)) return bucket
      }
      return null
    } catch {
      return null
    }
  }

  /** Public bucket lookup by doc id/name (import carry-over accounting). */
  knowledgeBucketOfDoc(id: string): "global" | "sites" | null {
    const s = this.get(id)
    return s ? this.knowledgeBucketOf(s.source_file) : null
  }

  /**
   * Validate + normalize a bucket-relative posix folder path.
   * Rejects absolute paths, drive letters, backslashes, `..`/`.`/empty
   * segments, unsafe components, and depth > KNOWLEDGE_FOLDER_MAX_DEPTH.
   */
  normalizeKnowledgeFolderPath(
    raw: unknown,
    opts: { allowEmpty?: boolean } = {},
  ): { ok: true; path: string } | { ok: false; error: string } {
    if (typeof raw !== "string") return { ok: false, error: "folder path must be a string" }
    const p = nfc(raw).trim()
    if (!p) {
      return opts.allowEmpty
        ? { ok: true, path: "" }
        : { ok: false, error: "folder path must not be empty" }
    }
    if (
      p.includes("\0") ||
      p.includes("\\") ||
      p.startsWith("/") ||
      /^[a-zA-Z]:/.test(p) ||
      p.endsWith("/")
    ) {
      return { ok: false, error: `Invalid folder path: ${raw}` }
    }
    const segs = p.split("/")
    for (const seg of segs) {
      if (!seg || seg === "." || seg === ".." || isUnsafePathComponent(seg)) {
        return { ok: false, error: `Invalid folder path segment: ${seg}` }
      }
    }
    if (segs.length > KNOWLEDGE_FOLDER_MAX_DEPTH) {
      return { ok: false, error: `文件夹最多 ${KNOWLEDGE_FOLDER_MAX_DEPTH} 级: ${p}` }
    }
    return { ok: true, path: segs.join("/") }
  }

  private knowledgeBucketRoot(bucket: "global" | "sites"): string {
    return path.join(this.knowledgeDir, bucket)
  }

  private knowledgeFolderAbsDir(bucket: "global" | "sites", folderPath: string): string {
    const root = this.knowledgeBucketRoot(bucket)
    if (!folderPath) return root
    const abs = path.resolve(root, ...folderPath.split("/"))
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`Path traversal detected in folder path: ${folderPath}`)
    }
    return abs
  }

  /** Entries directly under a directory (per-layer cap accounting). */
  private countDirChildren(dir: string): number {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith("."))
        .length
    } catch {
      return 0
    }
  }

  /**
   * Content fingerprint of a folder subtree (member docs only — `_folder.md`
   * itself is excluded so saving a description never marks itself stale).
   * Same shape as computeDiskFingerprint, hashed to keep _folder.md small.
   */
  private knowledgeFolderFingerprint(absDir: string): string {
    const lines: string[] = []
    const walk = (dir: string, rel: string, depth: number) => {
      if (depth > 6) return
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue
        const childRel = rel ? `${rel}/${ent.name}` : ent.name
        if (ent.isDirectory()) {
          walk(path.join(dir, ent.name), childRel, depth + 1)
          continue
        }
        if (!ent.isFile()) continue
        if (ent.name === FOLDER_META_FILENAME) continue
        if (!ent.name.endsWith(".md") && !ent.name.endsWith(".markdown")) continue
        try {
          const st = fs.statSync(path.join(dir, ent.name))
          lines.push(`${childRel}|${st.mtimeMs}|${st.size}`)
        } catch {
          /* race */
        }
      }
    }
    walk(absDir, "", 0)
    return crypto.createHash("sha256").update(lines.join("\n"), "utf8").digest("hex").slice(0, 16)
  }

  /** Write `_folder.md` (0o600, no symlink follow) and record the content fingerprint. */
  private writeKnowledgeFolderMeta(
    bucket: "global" | "sites",
    folderPath: string,
    description: string,
    title?: string,
  ): void {
    const absDir = this.knowledgeFolderAbsDir(bucket, folderPath)
    fs.mkdirSync(absDir, { recursive: true, mode: 0o700 })
    const last = folderPath.split("/").pop() || folderPath
    const data: Record<string, unknown> = {
      type: "knowledge_folder",
      title: title || last,
      description: description.slice(0, KNOWLEDGE_FOLDER_DESCRIPTION_MAX),
      content_fingerprint: this.knowledgeFolderFingerprint(absDir),
    }
    const yamlStr = yaml.dump(data, { lineWidth: -1, noRefs: true, quotingType: '"' })
    writeRestrictedFile(path.join(absDir, FOLDER_META_FILENAME), `---\n${yamlStr}---\n`)
  }

  /** Folder list for the panel (folders array on knowledge.list). */
  listKnowledgeFolders(): KnowledgeFolderItem[] {
    this.ensureFresh()
    const out: KnowledgeFolderItem[] = []
    for (const [key, meta] of this.knowledgeFolders) {
      const slash = key.indexOf("/")
      const bucket = key.slice(0, slash) as "global" | "sites"
      const folderPath = key.slice(slash + 1)
      const current = this.knowledgeFolderFingerprint(this.knowledgeFolderAbsDir(bucket, folderPath))
      out.push({
        bucket,
        path: folderPath,
        title: meta.title,
        description: meta.description,
        stale: !!meta.fingerprint && meta.fingerprint !== current,
      })
    }
    out.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.path.localeCompare(b.path))
    return out
  }

  /** Ancestor-chain saved descriptions for the scoring bag (#274 §5). */
  private ancestorFolderDescriptions(bucket: "global" | "sites" | null, folder: string): string {
    if (!bucket || !folder) return ""
    const segs = folder.split("/").filter(Boolean)
    const parts: string[] = []
    for (let i = 1; i <= segs.length; i++) {
      const meta = this.knowledgeFolders.get(this.knowledgeFolderKey(bucket, segs.slice(0, i).join("/")))
      if (meta?.description) parts.push(meta.description)
    }
    return parts.join(" ")
  }

  list(): SkillMeta[] {
    this.ensureFresh()
    return this.skillsCache
      .filter(s => this.isSkillDoc(s))
      .map(s => ({
        name: s.name,
        id: s.id,
        title: s.title,
        description: s.description,
        type: s.type,
        site: s.site,
        tags: s.tags,
        entries: s.entries,
        builtin: s.builtin,
        source_file: s.source_file,
        dir: s.dir,
        resources: s.resources,
      }))
  }

  get(name: string): Skill | undefined {
    this.ensureFresh()
    return this.skillsCache.find(s => s.name === name || s.id === name)
  }

  getBySite(hostname: string): Skill[] {
    return this.skillsCache.filter(s => s.type === "site_knowledge" && s.site && matchSite(s.site, hostname))
  }

  getByType(type: string): Skill[] {
    return this.skillsCache.filter(s => s.type === type)
  }

  activate(threadId: string, skillName: string): void {
    const skill = this.get(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)

    const active = this.threadSkillMap.get(threadId) || []
    if (!active.includes(skillName)) {
      active.push(skillName)
      this.threadSkillMap.set(threadId, active)
    }
  }

  deactivate(threadId: string, skillName: string): void {
    const active = this.threadSkillMap.get(threadId) || []
    this.threadSkillMap.set(threadId, active.filter(s => s !== skillName))
  }

  /**
   * Replace the in-memory active skill list for a thread (pack apply / restore).
   * Without this, pack writes ThreadManager.active_skill_ids but getActiveForThread
   * keeps a stale threadSkillMap entry until process restart.
   */
  setActiveSkillsForThread(threadId: string, skillIds: string[]): void {
    const ids = Array.isArray(skillIds) ? [...skillIds] : []
    this.threadSkillMap.set(threadId, ids)
  }

  /** Drop cached map entry so next getActiveForThread reloads from ThreadManager. */
  invalidateThreadSkills(threadId: string): void {
    this.threadSkillMap.delete(threadId)
  }

  getActiveForThread(threadId: string): Skill[] {
    let active = this.threadSkillMap.get(threadId)
    if (!active) {
      try {
        const tm = this.threads()
        const thread = tm.get(threadId)
        active = thread?.active_skill_ids || ["browse"]
        this.threadSkillMap.set(threadId, active)
      } catch {
        active = ["browse"]
      }
    }
    return active.map(name => this.get(name)).filter(Boolean) as Skill[]
  }

  /** Return full content of a skill by name. Files under knowledge/ are not use_skill (F-I-6). */
  loadContent(name: string): string | null {
    const skill = this.get(name)
    if (!skill || this.isUnderKnowledgeDir(skill.source_file)) return null
    return skill.content || null
  }

  /** LLM semantic re-ranking for low-confidence TF-IDF matches.
   * Sends top candidates to LLM for precise relevance scoring. */
  private async llmRerank(
    message: string,
    candidates: Skill[],
  ): Promise<Array<{ name: string; confidence: number }>> {
    if (!this.llmConfig || candidates.length === 0) {
      return candidates.map(s => ({ name: s.name, confidence: 50 }))
    }

    const skillList = candidates.map((s, i) =>
      `${i + 1}. name: ${s.name}, description: ${s.description || "(no description)"}, tags: ${(s.tags || []).join(", ") || "none"}`,
    ).join("\n")

    const prompt = `You are a skill matching assistant. Given a user message and a list of skills, identify the top 3 most relevant skills.

User message: "${message}"

Available skills:
${skillList}

Respond with a JSON array of objects: [{"name": "skill_name", "confidence": 95}]
- name must match exactly from the skill list above
- confidence is 0-100, where 100 means perfectly relevant
- Only include skills that are truly relevant to the user message
- Return at most 3 items, sorted by confidence descending`

    try {
      const provider = createProvider({
        ...this.llmConfig,
        api_key: this.llmConfig.api_key || "sk-placeholder",
      })
      const complete = await provider.complete({
        model: this.llmConfig.model_name,
        temperature: 0.1,
        signal: AbortSignal.timeout(15000),
        messages: [
          { role: "system", content: "You are a skill matching assistant. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
      })

      const content = complete.content || "[]"
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "[]")

      if (!Array.isArray(parsed)) return []

      const valid = parsed
        .filter((p: any) => p && typeof p.name === "string" && typeof p.confidence === "number")
        .map((p: any) => ({
          name: p.name,
          confidence: Math.max(0, Math.min(100, Math.round(p.confidence))),
        }))
        .sort((a: any, b: any) => b.confidence - a.confidence)

      return valid.slice(0, 3)
    } catch {
      // LLM re-ranking failed: gracefully fall back to mid-confidence candidates
      return candidates.slice(0, 3).map(s => ({ name: s.name, confidence: 50 }))
    }
  }

  /** Match user message against all skill descriptions using dual-track strategy:
   * - High confidence (>= 70%): TF-IDF fast path (corpus IDF is live; millisecond-level)
   * - Low confidence (< 70%): LLM semantic re-ranking (precise, one-shot) */
  async matchSkills(message: string): Promise<Array<{ name: string; confidence: number }>> {
    this.ensureFresh()
    const queryTokens = tokenize(message)
    // Only match real skills — vault/knowledge notes must not rank into skill auto-match
    const skillPool = this.skillsCache.filter(s => this.isSkillDoc(s))

    const skillTokenLists = skillPool.map(skill => {
      const skillText = `${skill.name} ${skill.description || ""} ${(skill.tags || []).join(" ")}`
      return tokenize(skillText)
    })
    const idf = idfFromDocs(skillTokenLists)
    const queryVec = tfidfVec(queryTokens, idf)

    const results: Array<{ name: string; confidence: number }> = []
    for (let i = 0; i < skillPool.length; i++) {
      const skillVec = tfidfVec(skillTokenLists[i], idf)
      const score = cosineSimilarity(queryVec, skillVec)
      if (score > 0.1) {
        results.push({ name: skillPool[i].name, confidence: Math.round(score * 100) })
      }
    }
    results.sort((a, b) => b.confidence - a.confidence)

    const topScore = results[0]?.confidence || 0

    // Dual-track: high confidence → TF-IDF fast path (IDF is live)
    if (topScore >= 70) {
      return results.slice(0, 3)
    }

    // Low confidence → LLM semantic re-ranking (precise)
    const candidates = skillPool.filter((_, i) => {
      const skillVec = tfidfVec(skillTokenLists[i], idf)
      const score = cosineSimilarity(queryVec, skillVec)
      return score > 0.05
    })

    const llmResults = await this.llmRerank(message, candidates)

    // If LLM returned results, use them; otherwise fall back to TF-IDF (IDF is live)
    return llmResults.length > 0 ? llmResults : results.slice(0, 3)
  }

  /** Resolve skill IDs for a thread based on the selection mode.
   * - auto: active ∪ matchSkills(message) ∪ getBySite(hostname)
   * - all: all skill docs (excludes knowledge/ vault notes)
   * - manual: active only */
  async resolveSkillIdsForThread(
    threadId: string,
    mode?: "auto" | "all" | "manual",
    message?: string,
    hostname?: string,
  ): Promise<string[]> {
    this.ensureFresh()
    const resolvedMode = mode || "auto"

    if (resolvedMode === "manual") {
      return this.getActiveForThread(threadId)
        .filter(s => this.isSkillDoc(s))
        .map(s => s.name)
    }

    if (resolvedMode === "all") {
      return this.skillsCache
        .filter(s => this.isSkillDoc(s))
        .map(s => s.name)
    }

    // auto mode (default)
    const active = this.getActiveForThread(threadId)
      .filter(s => this.isSkillDoc(s))
      .map(s => s.name)
    const matched = message ? (await this.matchSkills(message)).map(m => m.name) : []
    // getBySite returns site_knowledge experience skills (legacy under skills/ or knowledge/)
    const site = hostname ? this.getBySite(hostname).map(s => s.name) : []
    return [...new Set([...active, ...matched, ...site])]
  }

  /**
   * Active knowledge docs for a thread.
   * Wave A: primary source is thread.active_knowledge_ids.
   * D2 back-compat: also include knowledge-typed names still listed in active_skill_ids
   * (TODO(wave-a-d2): remove skill-path knowledge union after 1 release).
   */
  getActiveKnowledgeForThread(threadId: string): Skill[] {
    this.ensureFresh()
    let ids: string[] = []
    try {
      const tm = this.threads()
      const thread = tm.get(threadId)
      if (Array.isArray(thread?.active_knowledge_ids)) {
        ids = [...thread.active_knowledge_ids]
      }
      // TODO(wave-a-d2): remove skill-path knowledge union after 1 release
      const skillActive = thread?.active_skill_ids || []
      for (const name of skillActive) {
        const s = this.get(name)
        if (s && this.isKnowledgeDoc(s) && !ids.includes(name)) ids.push(name)
      }
    } catch {
      /* empty */
    }
    return ids
      .map((n) => this.get(n))
      .filter((s): s is Skill => !!s && this.isKnowledgeDoc(s))
  }

  /** Resolve knowledge IDs for a thread based on the selection mode (#273 Wave A).
   * - manual: activeKnowledge only (pure user selection, never scored/truncated)
   * - smartMatch=false: legacy selection (auto→active∪site, all→全库), no scoring
   * - smartMatch=true + 非空 query: TF-IDF 打分（复用 semantic-match 同套机器，
   *   全库当次调用内 IDF；零 LLM）→ pinned 全量先入选 + 非 pinned 按
   *   裸分≥KNOWLEDGE_SCORE_MIN 过滤、按（裸分+SITE_BOOST(auto 站点命中)）降序
   *   取 top-k（auto=5/all=8），并列取 id（k.id||k.name）字典序最小
   * - smartMatch=true + 空 query: 退化为 legacy 选择（auto→pinned∪site，all→全库）
   * - 打分模块任何异常 → try/catch 整段回退 legacy（仅日志），不得半新半旧 */
  resolveKnowledgeIdsForThread(
    threadId: string,
    mode?: "auto" | "all" | "manual",
    hostname?: string,
    query?: string,
    smartMatch = true,
  ): string[] {
    this.ensureFresh()
    const resolvedMode = mode || "auto"

    if (resolvedMode === "manual") {
      return this.getActiveKnowledgeForThread(threadId).map(s => s.name)
    }

    // Pre-scoring selection behavior (also the byte-identical degradation target).
    const legacyResolve = (): string[] => {
      if (resolvedMode === "all") {
        return this.skillsCache
          .filter(s => this.isKnowledgeDoc(s))
          .map(s => s.name)
      }
      const active = this.getActiveKnowledgeForThread(threadId).map(s => s.name)
      const site = hostname ? this.getBySite(hostname).map(s => s.name) : []
      return [...new Set([...active, ...site])]
    }

    const q = (query || "").trim()
    if (!smartMatch || !q) return legacyResolve()

    try {
      const pinned = this.getActiveKnowledgeForThread(threadId)
      const pinnedNames = new Set(pinned.map(s => s.name))
      const pool = this.skillsCache.filter(s => this.isKnowledgeDoc(s))
      const siteNames = new Set(
        resolvedMode === "auto" && hostname
          ? this.getBySite(hostname).map(s => s.name)
          : [],
      )
      const scored = this.scoreKnowledgePool(pool, q, siteNames, pinnedNames)
      const topk = resolvedMode === "all" ? KNOWLEDGE_DOC_TOPK_ALL : KNOWLEDGE_DOC_TOPK_AUTO
      const picked = scored.filter(x => x.raw >= KNOWLEDGE_SCORE_MIN).slice(0, topk)
      return [...pinned.map(s => s.name), ...picked.map(x => x.skill.name)]
    } catch (e) {
      console.warn("[skills] knowledge scoring failed; falling back to legacy selection:", e)
      return legacyResolve()
    }
  }

  /**
   * TF-IDF 打分基（#273 Wave A §2.2 / Wave B §6.5 同基复用）：
   * bag = title + description + tags[≤8] + #274 两字段（路径段 + 祖先链已保存说明）。
   * IDF 当次调用内对全库 knowledge bag 计算（N≤200 毫秒级，无缓存）。
   * 路由轮复用此全库 IDF 基（s(F) 同基），禁止语料级重算。
   */
  private knowledgeTfidfBase(
    pool: Skill[],
    query: string,
  ): { tokenLists: string[][]; idf: Record<string, number>; queryVec: Record<string, number> } {
    const tokenLists = pool.map(s => {
      const folderSegs = (s.folder || "").split("/").filter(Boolean).join(" ")
      const ancestorDesc = this.ancestorFolderDescriptions(this.knowledgeBucketOf(s.source_file), s.folder || "")
      return tokenize(
        `${s.title || ""} ${s.description || ""} ${(s.tags || []).slice(0, 8).join(" ")} ${folderSegs} ${ancestorDesc}`,
      )
    })
    const idf = idfFromDocs(tokenLists)
    const queryVec = tfidfVec(tokenize(query), idf)
    return { tokenLists, idf, queryVec }
  }

  /**
   * TF-IDF 打分（#273 Wave A §2.2）：返回按排序分（裸分 + 站点加权）降序、
   * 并列取 id 字典序最小的列表；阈值过滤（裸分 ≥ KNOWLEDGE_SCORE_MIN）在
   * 调用方做。纯本地，零 LLM。
   */
  private scoreKnowledgePool(
    pool: Skill[],
    query: string,
    siteNames: Set<string>,
    pinnedNames: Set<string>,
  ): Array<{ skill: Skill; raw: number; rank: number }> {
    const { tokenLists, idf, queryVec } = this.knowledgeTfidfBase(pool, query)

    const scored: Array<{ skill: Skill; raw: number; rank: number }> = []
    for (let i = 0; i < pool.length; i++) {
      if (pinnedNames.has(pool[i].name)) continue
      const raw = cosineSimilarity(queryVec, tfidfVec(tokenLists[i], idf))
      const rank = raw + (siteNames.has(pool[i].name) ? KNOWLEDGE_SITE_BOOST : 0)
      scored.push({ skill: pool[i], raw, rank })
    }
    // 排序看加权分；并列取 id 字典序最小（codepoint 序，跨平台确定）
    scored.sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank
      const ka = a.skill.id || a.skill.name
      const kb = b.skill.id || b.skill.name
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })
    return scored
  }

  /**
   * #273 Wave B §6.5 簇路由计划（「按堆选文」）。
   * no-op 前置（公式钉死）：开关关 / 非 auto（all 硬排除、manual 强制 no-op）/
   * 智能匹配关 / 空 query / 分布不渲染（n<20、超 cap、全离群）。
   * 命中谓词 s(F)：cosine(tfidf(query), tfidf(F.title + 已保存 description))，
   * 全库 IDF 基裸 cosine ≥ KNOWLEDGE_SCORE_MIN（不加 SITE_BOOST）。
   * 夹边 no-op 不把本轮改写成「无命中夹」（不回落组臂）；边关闭 → edgeClosed
   * 计划（不扩张、sections 空、调用方打 groupmap_omitted）。
   * 聚类/路由层任何运行时异常 → null（降级 Wave A 扁平打分，仅日志）。
   */
  private planKnowledgeRouting(args: {
    threadId: string
    hostname?: string
    query: string
    knowledgeIds: string[]
    mode: "auto" | "all" | "manual"
    smartMatch: boolean
    routeByGroup: boolean
  }): KnowledgeRoutingPlan | null {
    if (!args.routeByGroup) return null
    if (args.mode !== "auto") return null
    if (!args.smartMatch) return null
    const query = args.query.trim()
    if (!query) return null
    try {
      const index = this.ensureKnowledgeIndex()
      if (!index) return null
      const dist = buildKnowledgeDistribution(index.docs)
      if (dist.status !== "ok") return null

      const pool = this.skillsCache.filter(s => this.isKnowledgeDoc(s))
      const byId = new Map<string, Skill>()
      for (const s of pool) byId.set(s.id || s.name, s)

      const pinnedAll = this.getActiveKnowledgeForThread(args.threadId)
      const pinnedNames = new Set(pinnedAll.map(s => s.name))
      const idSet = new Set(args.knowledgeIds)
      // ① pinned（resolve 的输出顺序 = getActiveKnowledgeForThread 顺序）
      const pinnedDocs = pinnedAll.filter(s => idSet.has(s.name) || (!!s.id && idSet.has(s.id)))
      const picked = args.knowledgeIds
        .map(id => this.get(id))
        .filter((s): s is Skill => !!s && this.isKnowledgeDoc(s) && !pinnedNames.has(s.name))

      // 全库 IDF 基打分（§6.5：同基复用，禁止语料级重算；pinned 也算分供组粗选）
      const base = this.knowledgeTfidfBase(pool, query)
      const siteNames = new Set(args.hostname ? this.getBySite(args.hostname).map(s => s.name) : [])
      const rawByName = new Map<string, number>()
      const rankByName = new Map<string, number>()
      for (let i = 0; i < pool.length; i++) {
        const raw = cosineSimilarity(base.queryVec, tfidfVec(base.tokenLists[i], base.idf))
        rawByName.set(pool[i].name, raw)
        rankByName.set(pool[i].name, raw + (siteNames.has(pool[i].name) ? KNOWLEDGE_SITE_BOOST : 0))
      }
      // 按排序分降序、并列取 id 字典序最小（阈值判定一律看裸分，SITE_BOOST 只改排序）
      const byRankDesc = (a: Skill, b: Skill) => {
        const ra = rankByName.get(a.name) ?? 0
        const rb = rankByName.get(b.name) ?? 0
        if (rb !== ra) return rb - ra
        return compareCodepoint(a.id || a.name, b.id || b.name)
      }
      picked.sort(byRankDesc)

      const oneLine = (s: Skill) => String(s.title || s.name).replace(/\s+/g, " ").trim()

      // 命中谓词 s(F)（§6.5 钉一条；桶根 folder="" 不是夹，不参与）
      const hitFolders = this.listKnowledgeFolders()
        .map(F => ({
          F,
          s: cosineSimilarity(base.queryVec, tfidfVec(tokenize(`${F.title} ${F.description}`), base.idf)),
        }))
        .filter(x => x.s >= KNOWLEDGE_SCORE_MIN)
        // 组间序：s(F) 降序、并列 path 字典序（+bucket 收尾保证全序确定）
        .sort((a, b) => b.s - a.s || compareCodepoint(a.F.path, b.F.path) || compareCodepoint(a.F.bucket, b.F.bucket))

      const labelByName = new Map<string, string>()
      for (const g of dist.groups) {
        for (const id of g.ids) {
          const s = byId.get(id)
          if (s) labelByName.set(s.name, g.label)
        }
      }

      const folderMembers = (F: { bucket: "global" | "sites"; path: string }): Skill[] =>
        pool.filter(s => {
          if (this.knowledgeBucketOf(s.source_file) !== F.bucket) return false
          const f = s.folder || ""
          return f === F.path || f.startsWith(F.path + "/")
        })

      // 按边计算：命中夹 → 夹边；无命中夹 → 组边（边关闭则不回落另一臂）
      let expansion: Skill[] = []
      let sections: GroupmapSection[] = []
      let zeroPassing = true
      if (hitFolders.length > 0) {
        if (!knowledgeRouteFolderBranchOn()) {
          return this.closedRoutingPlan(pinnedDocs, picked, labelByName)
        }
        const memberNames = new Set<string>()
        for (const { F } of hitFolders) {
          for (const m of folderMembers(F)) memberNames.add(m.name)
        }
        expansion = pool.filter(s => memberNames.has(s.name))
        zeroPassing = ![...memberNames].some(n => (rawByName.get(n) ?? 0) >= KNOWLEDGE_SCORE_MIN)
        // 概览行集 = 命中夹全部成员标题（含未过阈），组内按文档分降序；
        // 零成员命中夹（有说明但没文档）不占小节（Gate9 F2）
        sections = hitFolders
          .map(({ F }) => ({
            label: F.path,
            lines: folderMembers(F).sort(byRankDesc).map(oneLine),
          }))
          .filter((s) => s.lines.length > 0)
      } else {
        if (!knowledgeRouteGroupBranchOn()) {
          return this.closedRoutingPlan(pinnedDocs, picked, labelByName)
        }
        // 组粗选：组分 = 成员元数据分 max（裸分）；top-1 恒取；第 2 组仅当
        // 组分 ≥ SCORE_MIN；并列取簇键字典序最小；「未分组」不参与。
        const scoredGroups = dist.groups
          .map(g => ({
            g,
            score: Math.max(0, ...g.ids.map(id => {
              const s = byId.get(id)
              return s ? (rawByName.get(s.name) ?? 0) : 0
            })),
          }))
          .sort((a, b) => b.score - a.score || compareCodepoint(a.g.key, b.g.key))
        const selected = scoredGroups.slice(0, 1)
        if (scoredGroups[1] && scoredGroups[1].score >= KNOWLEDGE_SCORE_MIN) {
          selected.push(scoredGroups[1])
        }
        const memberNames = new Set<string>()
        for (const { g } of selected) {
          for (const id of g.ids) {
            const s = byId.get(id)
            if (s) memberNames.add(s.name)
          }
        }
        expansion = pool.filter(s => memberNames.has(s.name))
        zeroPassing = ![...memberNames].some(n => (rawByName.get(n) ?? 0) >= KNOWLEDGE_SCORE_MIN)
        // 组间序：组分降序、并列簇键字典序；行集 = top-1-2 组全部成员标题（含未过阈）
        sections = selected.map(({ g }) => ({
          label: g.label,
          lines: g.ids
            .map(id => byId.get(id))
            .filter((s): s is Skill => !!s)
            .sort(byRankDesc)
            .map(oneLine),
        }))
      }

      // 语料 ⊇ 入选集；候选 = pinned ∪ { 语料过阈 }（第二趟不重截 k，输出扩张）
      const corpusNames = new Set<string>([...pinnedNames, ...expansion.map(s => s.name)])
      for (const id of args.knowledgeIds) {
        const s = this.get(id)
        if (s && this.isKnowledgeDoc(s)) corpusNames.add(s.name)
      }
      const passing = pool
        .filter(s => corpusNames.has(s.name) && !pinnedNames.has(s.name) && (rawByName.get(s.name) ?? 0) >= KNOWLEDGE_SCORE_MIN)
        .sort(byRankDesc)
      const inWaveA = new Set(picked.map(s => s.name))
      const tail = passing.filter(s => !inWaveA.has(s.name))
      const candidates = [...pinnedDocs, ...passing]
      const sPre: string[] = []
      const seen = new Set<string>()
      for (const s of candidates) {
        const id = s.id || s.name
        if (!seen.has(id)) {
          seen.add(id)
          sPre.push(id)
        }
      }
      return { edgeClosed: false, pinnedDocs, picked, tail, candidates, sections, zeroPassing, labelByName, sPre }
    } catch (e) {
      console.warn("[skills] knowledge routing failed; degrading to flat Wave A:", e)
      return null
    }
  }

  /** 边关闭态计划：不扩张、不灌概览（调用方打 groupmap_omitted），S_pre 与 flat 恒等。 */
  private closedRoutingPlan(
    pinnedDocs: Skill[],
    picked: Skill[],
    labelByName: Map<string, string>,
  ): KnowledgeRoutingPlan {
    return {
      edgeClosed: true,
      pinnedDocs,
      picked,
      tail: [],
      candidates: [...pinnedDocs, ...picked],
      sections: [],
      zeroPassing: true,
      labelByName,
      sPre: [...pinnedDocs, ...picked].map(s => s.id || s.name),
    }
  }

  /** Build compact skill index for system prompt.
   * LLM calls use_skill(name) to load full instructions on demand.
   * For site_knowledge/domain_knowledge, inject entries summary directly.
   * Also injects global knowledge and matching site knowledge summaries.
   * If skillIds is provided, only includes those skills.
   * If knowledgeIds is provided, only includes those knowledge docs.
   * Security skills are ALWAYS injected and cannot be disabled.
   * opts.knowledgeDescriptionOnly: 空 query + 智能匹配开的 auto 退化——
   * 每篇只注入 description（≤KNOWLEDGE_EMPTY_QUERY_DESCRIPTION_CHARS），无 description 跳过。 */
  /** Wave B 路由上下文（缺省从 thread 记录推导；测试/评测可显式覆盖）。 */
  buildSystemPrompt(
    threadId: string,
    hostname?: string,
    skillIds?: string[],
    knowledgeIds?: string[],
    query?: string,
    opts?: BuildPromptKnowledgeOpts,
  ): string {
    return this.buildSystemPromptWithSources(threadId, hostname, skillIds, knowledgeIds, query, opts).prompt
  }

  buildSystemPromptWithSources(
    threadId: string,
    hostname?: string,
    skillIds?: string[],
    knowledgeIds?: string[],
    query?: string,
    opts?: BuildPromptKnowledgeOpts,
  ): { prompt: string; retrieved_sources: RetrievedSource[]; knowledge_routing?: KnowledgeRoutingMeta } {
    const skills = skillIds
      ? skillIds.map(id => this.get(id)).filter(Boolean) as Skill[]
      : this.getActiveForThread(threadId)

    const parts: string[] = []
    const injectedNames = new Set<string>()
    const retrieved_sources: RetrievedSource[] = []

    // 跨文档知识注入硬预算（#273 Wave A §2.3）：只记注入的 summary 正文字符，
    // 不含 wrapKnowledgeBlock 包装（包装上界 = KNOWLEDGE_WRAP_OVERHEAD_CHARS×篇数
    // + title/id 变长）。作用于所有 pushKnowledge 漏斗（含 experience skills 与
    // legacy global+site 分支），不影响 Safety Guard / skills 索引。
    let knowledgeBudgetLeft = KNOWLEDGE_INJECT_BUDGET_CHARS
    let knowledgeBudgetStop = false

    const pushKnowledge = (k: Skill, summary: string, chunkIndex?: number, groupLabel?: string) => {
      if (knowledgeBudgetStop) return
      const id = k.id || k.name
      const title = sanitizeKnowledgeContent(k.title || k.name)
      let body = summary
      if (body.length > knowledgeBudgetLeft) {
        // 剩余 = 0 直接停；剩余 > 0 截断到剩余额度（末尾加截断标记）然后停止
        if (knowledgeBudgetLeft <= 0) {
          knowledgeBudgetStop = true
          return
        }
        body = knowledgeBudgetLeft > KNOWLEDGE_TRUNC_MARK.length
          ? body.slice(0, knowledgeBudgetLeft - KNOWLEDGE_TRUNC_MARK.length) + KNOWLEDGE_TRUNC_MARK
          : body.slice(0, knowledgeBudgetLeft)
        knowledgeBudgetStop = true
      }
      knowledgeBudgetLeft -= body.length
      injectedNames.add(k.name)
      retrieved_sources.push({
        id,
        title,
        chunk_index: chunkIndex,
        chars: body.length,
        ...(groupLabel ? { group_label: groupLabel } : {}),
      })
      parts.push(wrapKnowledgeBlock(id, title, body))
    }

    // --- Safety Guard: ALWAYS inject security skills (immutable, builtin) ---
    const securitySkills = this.getSecuritySkills()
    for (const s of securitySkills) {
      injectedNames.add(s.name)
      parts.push(`## Safety Guard: ${s.name}\n${s.content}`)
    }

    const promptSkills = skills.filter(s => this.isSkillDoc(s))
    const experienceSkills = skills.filter(s => this.isKnowledgeDoc(s))

    // Experience skills: inject entry summaries directly (no use_skill needed)
    for (const s of experienceSkills) {
      const summary = this.getEntriesSummary(s.name)
      if (summary) pushKnowledge(s, summary)
    }

    // Knowledge IDs filtering: if knowledgeIds provided, only include matching knowledge
    const knowledgeToInject = knowledgeIds
      ? knowledgeIds.map(id => this.get(id)).filter(Boolean) as Skill[]
      : undefined

    let knowledgeRoutingMeta: KnowledgeRoutingMeta | undefined

    if (knowledgeToInject) {
      // #273 Wave B §6.5 簇路由：不适用返回 null（Wave A 扁平路径）；
      // 边关闭返回 edgeClosed 计划（不扩张、不灌概览，打 groupmap_omitted）。
      let routing: KnowledgeRoutingPlan | null = null
      if (!opts?.knowledgeDescriptionOnly) {
        let routingThread: {
          knowledge_selection_mode?: "auto" | "all" | "manual"
          knowledge_smart_match?: boolean
          knowledge_route_by_group?: boolean
        } | undefined
        try {
          routingThread = this.threads().get(threadId) as typeof routingThread
        } catch {
          /* no thread context — defaults apply */
        }
        routing = this.planKnowledgeRouting({
          threadId,
          hostname,
          query: query || "",
          knowledgeIds: knowledgeIds || [],
          mode: opts?.knowledgeMode ?? routingThread?.knowledge_selection_mode ?? "auto",
          smartMatch: opts?.knowledgeSmartMatch ?? (routingThread?.knowledge_smart_match !== false),
          routeByGroup: opts?.knowledgeRouteByGroup ?? (routingThread?.knowledge_route_by_group === true),
        })
      }

      if (!routing || routing.edgeClosed) {
        // Wave A 扁平路径（边关闭 = 同路径 + groupmap_omitted 标记）
        const labelOf = (k: Skill) => routing?.labelByName.get(k.name)
        for (const k of knowledgeToInject) {
          if (injectedNames.has(k.name)) continue
          if (!this.isKnowledgeDoc(k)) continue
          if (opts?.knowledgeDescriptionOnly) {
            // 空 query + 智能匹配开的 auto 退化：只注入 description，不灌正文；
            // 无 description 的篇跳过不注入。
            const desc = sanitizeKnowledgeContent(k.description || "")
              .slice(0, KNOWLEDGE_EMPTY_QUERY_DESCRIPTION_CHARS)
              .trim()
            if (desc) pushKnowledge(k, desc)
            continue
          }
          const summary = this.getEntriesSummary(k.name) || this.getKnowledgeSummary(k, query)
          if (summary) pushKnowledge(k, summary, undefined, labelOf(k))
        }
        if (routing?.edgeClosed) {
          knowledgeRoutingMeta = { s_pre: routing.sPre, groupmap: "omitted" }
        }
      } else {
        // 路由 ON：注入序四步（§6.5 钉死）。虚拟记账先行（与 pushKnowledge
        // 截断语义逐字节对齐），再按序实灌——recall 槽的「让位」因此只是
        // 计划层的末位移出，不需要实灌撤回。
        type PlannedDoc = { k: Skill; body: string; groupLabel?: string }
        const summaryOf = (k: Skill) => this.getEntriesSummary(k.name) || this.getKnowledgeSummary(k, query)
        const labelOf = (k: Skill) => routing.labelByName.get(k.name)
        let left = knowledgeBudgetLeft
        let stop = false
        const plannedNames = new Set<string>()
        const before: PlannedDoc[] = []
        const after: PlannedDoc[] = []
        const vPlace = (target: PlannedDoc[], k: Skill, summary: string, allowTruncate: boolean): void => {
          if (stop || plannedNames.has(k.name) || injectedNames.has(k.name)) return
          let body = summary
          if (body.length > left) {
            if (!allowTruncate) return
            if (left <= 0) {
              stop = true
              return
            }
            body = left > KNOWLEDGE_TRUNC_MARK.length
              ? summary.slice(0, left - KNOWLEDGE_TRUNC_MARK.length) + KNOWLEDGE_TRUNC_MARK
              : summary.slice(0, left)
            stop = true
          }
          left -= body.length
          plannedNames.add(k.name)
          target.push({ k, body, groupLabel: labelOf(k) })
        }

        // ① 全部 pinned（不得被挤；截断语义同 Wave A）
        for (const p of routing.pinnedDocs) {
          if (stop) break
          const summary = summaryOf(p)
          if (summary) vPlace(before, p, summary, true)
        }
        // ② Wave A 入选文档按分填预算（整灌，不截断占槽）
        const placedPicked: Array<{ k: Skill; summary: string }> = []
        const pickedPend: Array<{ k: Skill; summary: string }> = []
        for (const k of routing.picked) {
          if (plannedNames.has(k.name) || injectedNames.has(k.name)) continue
          const summary = summaryOf(k)
          if (summary) pickedPend.push({ k, summary })
        }
        let qi = 0
        while (!stop && qi < pickedPend.length) {
          const d = pickedPend[qi]
          if (d.summary.length > left) break
          vPlace(before, d.k, d.summary, false)
          placedPicked.push(d)
          qi++
        }
        // ② recall 槽：存在过阈扩张尾部时，最后一个文档槽让位给最佳尾部一篇
        //（至多一篇；尾部裸 cosine ≥ SCORE_MIN 即可，不需要赢过末位）
        if (!stop) {
          const tailDoc = routing.tail.find(k => !plannedNames.has(k.name) && !injectedNames.has(k.name))
          const tailSummary = tailDoc ? summaryOf(tailDoc) : ""
          if (tailDoc && tailSummary) {
            if (tailSummary.length <= left) {
              // 剩余 ≥ 尾部全长 ⇒ 零 displacement 直接放进该文档槽（仍算②、在概览前）
              vPlace(before, tailDoc, tailSummary, false)
            } else if (
              placedPicked.length > 0 &&
              placedPicked[placedPicked.length - 1].summary.length + left >= tailSummary.length
            ) {
              // 让位 ⇔（末位完整占用 + 剩余）≥ 尾部全长：计划层移出末位、尾部整灌；
              // 末位下放④（④ 可截断，但截断不算⑤）
              const last = placedPicked.pop()!
              const lastPlanned = before.pop()!
              left += lastPlanned.body.length
              plannedNames.delete(last.k.name)
              vPlace(before, tailDoc, tailSummary, false)
            }
            // 否则不让位、不截断占 recall 槽，尾部留待④
          }
        }
        // ③ 分组概览吃剩余（≤KNOWLEDGE_GROUPMAP_CHARS 含 wrap，计入 8000 总预算；
        //    剩余不足完整最小行 / 粗索引零成员过阈 → 省略 + groupmap_omitted）
        let groupmapChars = 0
        let groupmapWrapped: string | null = null
        let groupmapState: "injected" | "omitted" = "omitted"
        if (!stop && !routing.zeroPassing && routing.sections.length > 0) {
          const fitted = fitGroupmap(routing.sections, Math.min(left, KNOWLEDGE_GROUPMAP_CHARS))
          if (fitted) {
            groupmapChars = fitted.wrapped.length
            left -= fitted.wrapped.length
            groupmapState = "injected"
            groupmapWrapped = fitted.wrapped
          }
        }
        // ④ 仍有剩余则继续按分填（含其余尾部；照常截断填满剩余）
        if (!stop) {
          for (const k of routing.candidates) {
            if (stop) break
            if (plannedNames.has(k.name) || injectedNames.has(k.name)) continue
            const summary = summaryOf(k)
            if (summary) vPlace(after, k, summary, true)
          }
        }

        // 实灌：②（含 recall 槽）→ 概览 → ④。虚拟记账与 pushKnowledge 逐字节
        // 对齐，执行期不会再触发截断。
        for (const d of before) pushKnowledge(d.k, d.body, undefined, d.groupLabel)
        if (groupmapWrapped !== null) {
          parts.push(groupmapWrapped)
          knowledgeBudgetLeft -= groupmapChars
        }
        for (const d of after) pushKnowledge(d.k, d.body, undefined, d.groupLabel)
        knowledgeRoutingMeta = {
          s_pre: routing.sPre,
          groupmap: groupmapState,
          ...(groupmapChars > 0 ? { groupmap_chars: groupmapChars } : {}),
        }
      }
    } else {
      const globalKnowledge = this.getGlobalKnowledge()
      for (const k of globalKnowledge) {
        if (injectedNames.has(k.name)) continue
        const summary = this.getKnowledgeSummary(k, query)
        if (summary) pushKnowledge(k, summary)
      }

      if (hostname) {
        const siteKnowledge = this.getBySite(hostname)
        for (const k of siteKnowledge) {
          if (injectedNames.has(k.name)) continue
          const summary = this.getKnowledgeSummary(k, query)
          if (summary) pushKnowledge(k, summary)
        }
      }
    }

    if (promptSkills.length > 0) {
      const index = promptSkills.map(s =>
        `- \`${s.name}\`: ${s.description || "(no description)"}`
      ).join("\n")
      parts.push(`Available skills (call use_skill(name) to load full instructions when relevant):\n${index}`)
    }

    return {
      prompt: parts.join("\n\n"),
      retrieved_sources,
      ...(knowledgeRoutingMeta ? { knowledge_routing: knowledgeRoutingMeta } : {}),
    }
  }

  /** Get all global knowledge docs from knowledge/global/ directory. */
  private getGlobalKnowledge(): Skill[] {
    return this.skillsCache.filter(s => {
      if (!this.isKnowledgeDoc(s)) return false
      // Global knowledge: no site field (site-scoped lives under knowledge/sites/ or has site:)
      return !s.site
    })
  }

  /** Build a sanitized knowledge summary.
   * - Small docs: return full content (capped at 2000 chars)
   * - Large docs with query: search relevant chunks via RAG
   * - Large docs without query: return truncated summary */
  private getKnowledgeSummary(skill: Skill, query?: string): string {
    const chunks = this.knowledgeChunks.get(skill.name)

    // Large doc + query → RAG chunk retrieval (tags + description in the query bag)
    if (chunks && chunks.length > 0 && query && query.trim()) {
      const bag = [query.trim(), skill.title || "", skill.description || "", ...(skill.tags || [])]
        .filter(Boolean)
        .join(" ")
      const matched = searchChunks(chunks, bag, KNOWLEDGE_SEARCH_TOPK)
      if (matched.length) {
        return matched.map(c => sanitizeKnowledgeContent(c.text)).join("\n\n---\n\n").trim()
      }
      // If no chunks matched the query, fall through to truncated summary
    }

    let content = skill.content || ""
    // Sanitize before injection
    content = sanitizeKnowledgeContent(content)
    // Rough token estimate: 1 token ≈ 4 chars for English, 1 token ≈ 1 char for CJK
    // Use a conservative char-based limit (~2000 chars ≈ 500 tokens for mixed content)
    const MAX_CHARS = 2000
    if (content.length > MAX_CHARS) {
      content = content.slice(0, MAX_CHARS) + "\n... (truncated)"
    }
    return content.trim()
  }

  // --- Experience entry management ---

  /** Get formatted summary of entries for a skill. */
  getEntriesSummary(skillName: string): string {
    const skill = this.get(skillName)
    if (!skill?.entries?.length) return ""
    const active = skill.entries.filter(e => !e.stale)
    const stale = skill.entries.filter(e => e.stale)
    const parts: string[] = []
    if (active.length) {
      parts.push(`Active entries (${active.length}):`)
      for (const e of active) {
        parts.push(`  [${e.category}] ${e.content}`)
      }
    }
    if (stale.length) {
      parts.push(`Stale entries (${stale.length}, may be outdated):`)
      for (const e of stale) {
        parts.push(`  [${e.category}] ${e.content} — ${e.stale_reason}`)
      }
    }
    return sanitizeKnowledgeContent(parts.join("\n"))
  }

  /** Add an entry to a skill and persist to disk. */
  addEntry(skillName: string, entry: ExperienceEntry): void {
    const skill = this.get(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)
    if (!skill.entries) skill.entries = []
    const exists = skill.entries.some(e => e.id === entry.id || e.content === entry.content)
    if (exists) return
    skill.entries.push(entry)
    this.saveSkillFile(skillName)
  }

  /** Mark an entry as stale with a reason. */
  markEntryStale(skillName: string, entryId: string, reason: string): void {
    const skill = this.get(skillName)
    if (!skill?.entries) return
    const entry = skill.entries.find(e => e.id === entryId)
    if (entry) {
      entry.stale = true
      entry.stale_reason = reason
      this.saveSkillFile(skillName)
    }
  }

  /** Save a skill back to its source file, updating frontmatter from current metadata.
   * Uses js-yaml for safe serialization to prevent YAML injection (P0). */
  private saveSkillFile(skillName: string): void {
    const skill = this.get(skillName)
    if (!skill || !skill.source_file) return
    const body = this.buildEntriesMarkdown(skill)
    const frontmatter: Record<string, any> = {
      name: skill.name,
      description: skill.description,
      type: skill.type,
    }
    if (skill.id) frontmatter.id = skill.id
    if (skill.title) frontmatter.title = skill.title
    if (skill.site) frontmatter.site = skill.site
    if (skill.tags?.length) frontmatter.tags = skill.tags
    if (skill.priority) frontmatter.priority = skill.priority
    if (skill.entries?.length) {
      frontmatter.entries = skill.entries.map(e => ({
        id: e.id,
        category: e.category,
        content: e.content,
        recorded_at: e.recorded_at,
        stale: e.stale,
        stale_reason: e.stale_reason || "",
        ...(e.confirmed_at ? { confirmed_at: e.confirmed_at } : {}),
        ...(e.replaced_by ? { replaced_by: e.replaced_by } : {}),
      }))
    }
    const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, quotingType: '"' })
    const md = `---\n${yamlStr}---\n\n${body}`
    writeRestrictedFile(skill.source_file, md)
  }

  /** Build human-readable markdown from entries. */
  private buildEntriesMarkdown(skill: Skill): string {
    if (!skill.entries?.length) return skill.content || ""
    const lines = ["# 记录列表", ""]
    for (const e of skill.entries) {
      const icon = e.stale ? "⚠️" : e.category === "problem" ? "🐛" : e.category === "success" ? "✅" : e.category === "tip" ? "💡" : "📋"
      const staleTag = e.stale ? ` [已过期: ${e.stale_reason}]` : ""
      lines.push(`- ${icon} ${e.content}${staleTag}`)
    }
    if (skill.content) {
      lines.push("")
      lines.push("# 说明")
      lines.push(skill.content)
    }
    return lines.join("\n")
  }

  exportSkill(name: string): { content: string; format: "markdown" | "zip"; skill_name: string } {
    const skill = this.get(name)
    if (!skill) throw new Error(`Skill not found: ${name}`)
    if (this.isKnowledgeDoc(skill)) throw new Error(`'${name}' is knowledge; use knowledge.export`)

    if (skill.dir) {
      // Folder-based skill: zip the entire directory
      const zip = new AdmZip()
      const dirName = path.basename(skill.dir)
      for (const f of fs.readdirSync(skill.dir)) {
        const filePath = path.join(skill.dir, f)
        if (fs.statSync(filePath).isFile()) {
          zip.addLocalFile(filePath, dirName)
        }
      }
      return {
        content: zip.toBuffer().toString("base64"),
        format: "zip",
        skill_name: name,
      }
    }

    // Flat .md skill: export as markdown text (backward compat)
    const extra: string[] = []
    if (skill.type === "site_knowledge" && skill.site) extra.push(`site: ${skill.site}`)
    if (skill.type === "domain_knowledge" && skill.tags?.length) extra.push(`tags: [${skill.tags.join(", ")}]`)

    const frontmatter = [
      "---",
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `type: ${skill.type}`,
      ...extra,
      "---",
    ].join("\n")

    return {
      content: `${frontmatter}\n\n${skill.content}`,
      format: "markdown",
      skill_name: name,
    }
  }

  /**
   * Import a single-file skill. Returns dest for agent path honesty (S41 multi-adv).
   */
  importSkill(content: string): { name: string; destPath: string } {
    let parsed: { data: { name?: string }; content: string }
    try {
      parsed = matter(content)
    } catch (e: any) {
      throw new Error(`Failed to parse skill frontmatter: ${e.message || String(e)}. Ensure the file starts with --- and valid YAML.`)
    }
    const name = parsed.data.name
    if (!name) throw new Error("Skill must have a 'name' field in frontmatter (e.g. ---\\nname: my-skill\\n---)")

    const ident = allocateDocIdentity({
      title: String(name),
      preferredId: isLegacySafeId(String(name)) ? String(name) : undefined,
      takenStems: listStemSet(this.skillsDir),
    })
    const filePath = path.join(this.skillsDir, `${ident.filenameStem}.md`)
    writeRestrictedFile(filePath, content)
    this.refresh()
    return { name: String(name), destPath: filePath }
  }

  /**
   * Zip extract budgets (skill packs with themes/fonts need headroom).
   * Defense-in-depth: only entries under the chosen SKILL.md directory count;
   * monorepo zips (repo-main.zip) no longer bill the whole archive.
   * 2026-08-12: raised after dashiai-ppt-skill (~46MB zip / ~81MB skill tree / ~365 files).
   */
  static readonly MAX_ZIP_EXTRACT_BYTES = 120 * 1024 * 1024
  static readonly MAX_ZIP_EXTRACT_FILES = 2000

  /**
   * Shared SKILL.md picker for L2 preview + install (must stay lock-step).
   * Prefer a single entry under `skills/`; fail-closed when multiple skill packs
   * are present (no silent deepest-wins).
   */
  static pickSkillMdEntryResult(
    entries: Array<{ entryName: string; isDirectory?: boolean }>,
  ): {
    entryName: string | null
    error?: string
    candidates?: string[]
  } {
    const candidates = entries.filter((e) => {
      if (e.isDirectory) return false
      const n = e.entryName.replace(/\\/g, "/")
      return /(^|\/)SKILL\.md$/i.test(n)
    })
    if (candidates.length === 0) {
      return { entryName: null, error: "Zip must contain a SKILL.md file" }
    }
    const underSkills = candidates.filter((e) => {
      const n = e.entryName.replace(/\\/g, "/").toLowerCase()
      return n.includes("/skills/") || n.startsWith("skills/")
    })
    const pool = underSkills.length > 0 ? underSkills : candidates
    if (pool.length > 1) {
      const names = pool.map((e) => e.entryName.replace(/\\/g, "/"))
      return {
        entryName: null,
        error:
          `Zip contains multiple SKILL.md entries (${names.length}); ` +
          `refuse silent pick. Unpack and skill_install({ path }) for one skills/<name>/, ` +
          `or ship a single-skill zip. Candidates: ${names.slice(0, 8).join(", ")}`,
        candidates: names,
      }
    }
    return { entryName: pool[0].entryName }
  }

  private static pickSkillMdEntry(
    entries: AdmZip.IZipEntry[],
  ): AdmZip.IZipEntry {
    const r = SkillEngine.pickSkillMdEntryResult(entries)
    if (!r.entryName) {
      throw new Error(r.error || "Zip must contain a SKILL.md file")
    }
    const hit = entries.find((e) => e.entryName === r.entryName)
    if (!hit) {
      throw new Error(r.error || "Zip must contain a SKILL.md file")
    }
    return hit
  }

  /** Import from base64 (legacy / tests). Prefer importSkillFolderFromPath for large zips. */
  importSkillFolder(zipBase64: string): { name: string; destPath: string } {
    const buffer = Buffer.from(zipBase64, "base64")
    return this.importSkillFolderFromZip(new AdmZip(buffer))
  }

  /**
   * Import from on-disk zip (no base64 blow-up). AdmZip reads the file path directly.
   */
  importSkillFolderFromPath(zipPath: string): { name: string; destPath: string } {
    const resolved = path.resolve(zipPath)
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`Zip not found: ${zipPath}`)
    }
    return this.importSkillFolderFromZip(new AdmZip(resolved))
  }

  private importSkillFolderFromZip(zip: AdmZip): { name: string; destPath: string } {
    const entries = zip.getEntries()
    const skillMdEntry = SkillEngine.pickSkillMdEntry(entries)

    // Directory containing SKILL.md (posix-normalized, no trailing slash)
    const skillMdNorm = skillMdEntry.entryName.replace(/\\/g, "/")
    const skillDirName = skillMdNorm.replace(/\/?SKILL\.md$/i, "").replace(/\/$/, "")
    const folderName = path.basename(skillDirName) || "skill"

    const raw = zip.readAsText(skillMdEntry)
    const parsed = matter(raw)
    const skillName = parsed.data.name || folderName
    const ident = allocateDocIdentity({
      title: String(skillName),
      preferredId: isLegacySafeId(String(skillName)) ? String(skillName) : undefined,
      takenStems: listStemSet(this.skillsDir),
    })
    const safeName = ident.filenameStem
    const destDir = path.join(this.skillsDir, safeName)
    // Atomic overwrite: extract to tmp under skills root, then rename into place.
    // On failure only tmp is removed — existing skill at destDir is preserved.
    const tmpDir = path.join(
      this.skillsDir,
      `.${safeName}.extract-tmp-${process.pid}-${Date.now()}`,
    )

    // Scope extract to the skill tree:
    // - monorepo (…/skills/foo/SKILL.md): only that directory
    // - SKILL.md at zip root: whole archive (path safety still rejects ..)
    const skillEntries = entries.filter((entry) => {
      if (entry.isDirectory) return false
      const n = entry.entryName.replace(/\\/g, "/")
      if (!skillDirName) return true
      return n === skillMdNorm || n.startsWith(skillDirName + "/")
    })
    if (skillEntries.length === 0) {
      throw new Error("Zip skill directory has no extractable files")
    }

    // S42 P1: pre-check central-directory sizes for skill subtree only.
    // Refuse non-trivial entries with missing/zero uncompressed size (zip-bomb class:
    // getData() would otherwise inflate before post-check — R2 nit M5).
    const MAX_ZERO_SIZE_COMPRESSED = 64 * 1024
    let headerFiles = 0
    let headerBytes = 0
    for (const entry of skillEntries) {
      headerFiles++
      const hdr = (entry as any).header
      const claimed = Number(hdr?.size)
      const compressed = Number(hdr?.compressedSize)
      if (!Number.isFinite(claimed) || claimed <= 0) {
        if (Number.isFinite(compressed) && compressed > MAX_ZERO_SIZE_COMPRESSED) {
          throw new Error(
            `Zip entry has missing/zero uncompressed size but compressedSize=${compressed}: ${entry.entryName}`,
          )
        }
      } else {
        headerBytes += claimed
      }
      if (headerFiles > SkillEngine.MAX_ZIP_EXTRACT_FILES) {
        throw new Error(
          `Zip extract has too many files (max ${SkillEngine.MAX_ZIP_EXTRACT_FILES})`,
        )
      }
      if (headerBytes > SkillEngine.MAX_ZIP_EXTRACT_BYTES) {
        throw new Error(
          `Zip extract too large (max ${SkillEngine.MAX_ZIP_EXTRACT_BYTES} uncompressed bytes, per central directory)`,
        )
      }
    }

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
    fs.mkdirSync(tmpDir, { recursive: true })

    const bakDir = path.join(
      this.skillsDir,
      `.${safeName}.replace-bak-${process.pid}-${Date.now()}`,
    )
    let extractBytes = 0
    let extractFiles = 0
    try {
      for (const entry of skillEntries) {
        const n = entry.entryName.replace(/\\/g, "/")
        let relativePath = n
        if (skillDirName && n.startsWith(skillDirName + "/")) {
          relativePath = n.slice(skillDirName.length + 1)
        } else if (skillDirName && n === skillMdNorm) {
          relativePath = "SKILL.md"
        }

        relativePath = path.normalize(relativePath).replace(/\\/g, "/")
        if (
          path.isAbsolute(relativePath) ||
          relativePath.startsWith("..") ||
          relativePath.includes("\0") ||
          relativePath === "" ||
          relativePath === "."
        ) {
          throw new Error(`Security Violation: Invalid zip entry path: ${entry.entryName}`)
        }
        const zipBase = path.basename(relativePath)
        const zipStem = zipBase.replace(/\.[^.]+$/, "") || zipBase
        if (isUnsafePathComponent(zipStem) || isUnsafePathComponent(zipBase)) {
          throw new Error(`Security Violation: Reserved or unsafe zip entry name: ${entry.entryName}`)
        }

        const resolvedPath = path.resolve(tmpDir, relativePath)
        const normalizedTmp = path.resolve(tmpDir)
        if (
          !resolvedPath.startsWith(normalizedTmp + path.sep) &&
          resolvedPath !== normalizedTmp
        ) {
          throw new Error(
            `Security Violation: Path traversal detected in zip entry: ${entry.entryName}`,
          )
        }

        const hdr = (entry as any).header
        const claimed = Number(hdr?.size)
        const compressed = Number(hdr?.compressedSize)
        if (!Number.isFinite(claimed) || claimed <= 0) {
          if (Number.isFinite(compressed) && compressed > MAX_ZERO_SIZE_COMPRESSED) {
            throw new Error(
              `Zip entry has missing/zero uncompressed size but compressedSize=${compressed}: ${entry.entryName}`,
            )
          }
        } else if (extractBytes + claimed > SkillEngine.MAX_ZIP_EXTRACT_BYTES) {
          throw new Error(
            `Zip extract too large (max ${SkillEngine.MAX_ZIP_EXTRACT_BYTES} uncompressed bytes)`,
          )
        }

        const data = entry.getData()
        extractFiles++
        extractBytes += data.length
        if (extractFiles > SkillEngine.MAX_ZIP_EXTRACT_FILES) {
          throw new Error(
            `Zip extract has too many files (max ${SkillEngine.MAX_ZIP_EXTRACT_FILES})`,
          )
        }
        if (extractBytes > SkillEngine.MAX_ZIP_EXTRACT_BYTES) {
          throw new Error(
            `Zip extract too large (max ${SkillEngine.MAX_ZIP_EXTRACT_BYTES} uncompressed bytes)`,
          )
        }

        if (relativePath.includes("/")) {
          fs.mkdirSync(path.join(tmpDir, path.dirname(relativePath)), { recursive: true })
        }
        writeRestrictedFile(resolvedPath, data)
      }

      // Commit without rm-then-rename gap: dest → bak, tmp → dest, then drop bak.
      // If tmp→dest fails, restore bak → dest so the previous skill is not lost.
      if (fs.existsSync(bakDir)) {
        fs.rmSync(bakDir, { recursive: true, force: true })
      }
      if (fs.existsSync(destDir)) {
        fs.renameSync(destDir, bakDir)
      }
      try {
        fs.renameSync(tmpDir, destDir)
      } catch (renameErr) {
        try {
          if (!fs.existsSync(destDir) && fs.existsSync(bakDir)) {
            fs.renameSync(bakDir, destDir)
          }
        } catch {
          /* best-effort restore */
        }
        throw renameErr
      }
      if (fs.existsSync(bakDir)) {
        fs.rmSync(bakDir, { recursive: true, force: true })
      }
    } catch (e) {
      try {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      try {
        // If we moved dest→bak but never landed tmp as dest, restore.
        if (!fs.existsSync(destDir) && fs.existsSync(bakDir)) {
          fs.renameSync(bakDir, destDir)
        } else if (fs.existsSync(bakDir)) {
          fs.rmSync(bakDir, { recursive: true, force: true })
        }
      } catch {
        /* ignore */
      }
      throw e
    }

    this.refresh()
    return { name: String(skillName), destPath: destDir }
  }

  /**
   * Import a skill folder from an absolute path on the local machine.
   * Source may be anywhere the companion process can read (e.g. ~/.claude/skills/foo,
   * Downloads, a project tree). Destination is always ~/.cmspark-agent/skills/<name>/
   * via importSkillFiles — source is never executed in-place.
   *
   * Previously this wrongly required source ⊆ getConfigDir(), which made the
   * Skills-panel "import path" feature reject every realistic source
   * (~/.claude/skills/…, ~/Downloads/…) with "Path traversal not allowed".
   */
  importSkillFromPath(dirPath: string): { name: string; destPath: string } {
    if (typeof dirPath !== "string" || dirPath.includes("\0")) {
      throw new Error("Invalid directory path")
    }
    const trimmed = dirPath.trim()
    if (!trimmed) throw new Error("Invalid directory path")

    // Expand ~/… and bare ~ (UI placeholder shows ~/.claude/skills/…)
    let expanded = trimmed
    if (expanded === "~") {
      expanded = os.homedir()
    } else if (expanded.startsWith("~/") || expanded.startsWith("~" + path.sep)) {
      expanded = path.join(os.homedir(), expanded.slice(2))
    }

    let resolved: string
    try {
      // realpath rejects missing paths and collapses symlinks (no TOCTOU sneak-out)
      resolved = fs.realpathSync(path.resolve(expanded))
    } catch {
      throw new Error(`Directory not found: ${dirPath}`)
    }

    const stat = fs.statSync(resolved, { throwIfNoEntry: false })
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Directory not found: ${dirPath}`)
    }

    const skillMdPath = path.join(resolved, "SKILL.md")
    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`No SKILL.md found in: ${dirPath}`)
    }

    // Defense in depth: refuse a few always-sensitive roots (not a full sandbox —
    // shell_exec already has broader FS access; this is import-only read + copy).
    const blocked = [
      path.resolve("/"),
      path.resolve("/etc"),
      path.resolve("/System"),
      path.resolve("/private/etc"),
    ]
    if (blocked.some((b) => resolved === b)) {
      throw new Error(`Refusing to import from system path: ${dirPath}`)
    }

    const files = this.readDirectoryFiles(resolved)
    // Strip a leading "<folder>/" prefix if files were nested (shouldn't for
    // flat skill dirs); importSkillFiles expects SKILL.md at top or …/SKILL.md.
    return this.importSkillFiles(files)
  }

  private readDirectoryFiles(dir: string, prefix = ""): { path: string; content: string }[] {
    const results: { path: string; content: string }[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (isSymlinkOrJunction(dir, entry)) continue
      if (entry.isDirectory()) {
        results.push(...this.readDirectoryFiles(fullPath, relPath))
      } else if (entry.isFile()) {
        results.push({ path: relPath, content: fs.readFileSync(fullPath, "utf-8") })
      }
    }
    return results
  }

  importSkillFiles(files: { path: string; content: string }[]): { name: string; destPath: string } {
    // Find SKILL.md to determine skill name
    const skillMd = files.find(f => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"))
    if (!skillMd) throw new Error("Folder must contain a SKILL.md file")

    const parsed = matter(skillMd.content)
    const name = parsed.data.name
    if (!name) throw new Error("SKILL.md must have a 'name' field in frontmatter")

    const ident = allocateDocIdentity({
      title: String(name),
      preferredId: isLegacySafeId(String(name)) ? String(name) : undefined,
      takenStems: listStemSet(this.skillsDir),
    })
    const destDir = path.join(this.skillsDir, ident.filenameStem)

    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true })
    }
    fs.mkdirSync(destDir, { recursive: true })

    const normalizedDest = path.resolve(destDir)
    for (const file of files) {
      // Secure path traversal check (P0)
      // Normalize and reject absolute paths, parent traversal, and null bytes
      let relPath = path.normalize(file.path).replace(/\\/g, "/")
      if (path.isAbsolute(relPath) || relPath.startsWith("..") || relPath.includes("\0")) {
        throw new Error(`Security Violation: Invalid skill file path: ${file.path}`)
      }
      const resolvedPath = path.resolve(destDir, relPath)
      if (!resolvedPath.startsWith(normalizedDest + path.sep) && resolvedPath !== normalizedDest) {
        throw new Error(`Security Violation: Path traversal detected in skill file: ${file.path}`)
      }

      // Ensure subdirectories exist
      if (relPath.includes("/")) {
        const subDir = path.dirname(relPath)
        if (subDir !== ".") {
          fs.mkdirSync(path.join(destDir, subDir), { recursive: true })
        }
      }
      writeRestrictedFile(resolvedPath, file.content)
    }

    this.refresh()
    return { name: String(name), destPath: destDir }
  }

  deleteSkill(name: string): void {
    const skill = this.get(name)
    if (!skill) throw new Error(`Skill not found: ${name}`)
    if (skill.builtin) throw new Error(`Cannot delete builtin skill: ${name}`)

    if (skill.dir) {
      fs.rmSync(skill.dir, { recursive: true })
    } else {
      fs.unlinkSync(skill.source_file)
    }
    this.refresh()
  }

  // --- Knowledge management (operates on knowledge/ directory) ---

  listKnowledge(): KnowledgeListItem[] {
    this.ensureFresh()
    return this.skillsCache
      .filter(s => this.isKnowledgeDoc(s))
      .map(s => ({
        name: s.name,
        id: s.id,
        title: s.title,
        description: s.description,
        type: s.type,
        site: s.site,
        tags: s.tags,
        builtin: s.builtin,
        folder: s.folder || "",
      }))
  }

  /**
   * #281: exact-duplicate lookup on parsed markdown body (sha256).
   * Exempts empty / scan-placeholder bodies. Id = `id || name`.
   */
  findKnowledgeDuplicate(raw: string, fallbackName?: string): { id: string; title: string } | null {
    const { body } = this.previewKnowledge(raw, fallbackName)
    if (knowledgeDuplicateExempt(body)) return null
    // #293: hash without the parsePdf `# <filename>.pdf` heading so the same
    // file under a different name still collides (symmetric on both sides).
    const incoming = hashKnowledgeBody(stripPdfFilenameHeading(body))
    this.ensureFresh()
    const hits: { id: string; title: string }[] = []
    for (const s of this.skillsCache) {
      if (!this.isKnowledgeDoc(s)) continue
      const existingBody = typeof s.content === "string" ? s.content : ""
      if (knowledgeDuplicateExempt(existingBody)) continue
      if (hashKnowledgeBody(stripPdfFilenameHeading(existingBody)) !== incoming) continue
      const id = s.id || s.name
      hits.push({ id, title: String(s.title || s.name) })
    }
    hits.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return hits[0] || null
  }

  private knowledgeMeta(skill: Skill): RelatedKnowledgeInput & { id: string; name: string; title: string; description: string; type: Skill["type"]; site?: string; tags?: string[]; builtin: boolean } {
    const id = skill.id || skill.name
    return {
      name: skill.name,
      id,
      title: skill.title || skill.name,
      description: skill.description,
      type: skill.type,
      site: skill.site,
      tags: skill.tags,
      builtin: skill.builtin,
    }
  }

  getKnowledge(id: string): KnowledgeDocView | undefined {
    const skill = this.get(id)
    if (!skill || !this.isKnowledgeDoc(skill)) return undefined
    const body = skill.content || ""
    const bodyBytes = Buffer.byteLength(body, "utf8")
    const truncated = bodyBytes > KNOWLEDGE_BODY_WIRE_CAP
    const metas = this.listKnowledge().map((d) => ({
      id: d.id || d.name,
      name: d.name,
      title: d.title,
      description: d.description,
      tags: d.tags,
    }))
    const seed = skill.id || skill.name
    const related = findRelatedKnowledge(seed, metas, KNOWLEDGE_RELATED_LIMIT).map((h) => ({
      id: h.id,
      title: h.title,
    }))
    const meta = this.knowledgeMeta(skill)
    return {
      ...meta,
      body: truncated ? Buffer.from(body, "utf8").subarray(0, KNOWLEDGE_BODY_WIRE_CAP).toString("utf8") : body,
      char_count: body.length,
      truncated,
      related,
    }
  }

  updateKnowledge(id: string, patch: KnowledgeUpdatePatch): { id: string; title: string } {
    const skill = this.get(id)
    if (!skill || !this.isKnowledgeDoc(skill)) throw new Error(`Knowledge not found: ${id}`)
    if (skill.builtin) throw new Error(`Cannot update builtin knowledge: ${id}`)
    const ident = skill.id || skill.name
    const title = patch.title !== undefined ? cleanTitle(patch.title) : (skill.title || skill.name)
    const description = patch.description !== undefined
      ? String(patch.description).slice(0, 500)
      : skill.description
    const tags = patch.tags !== undefined
      ? normalizeTags(patch.tags)
      : skill.tags
    // Pin 11 / B1: reject body when a get would be truncated (no full-read).
    // Not a patch.body-vs-disk length compare — a larger replacement of a
    // truncated doc is still refused so a 512KiB prefix cannot clobber the tail.
    if (patch.body !== undefined) {
      const onDiskBytes = Buffer.byteLength(skill.content || "", "utf8")
      if (onDiskBytes > KNOWLEDGE_BODY_WIRE_CAP) {
        throw new Error(KNOWLEDGE_TRUNCATED_BODY_UPDATE_ERROR)
      }
    }
    const body = patch.body !== undefined ? String(patch.body) : (skill.content || "")
    if (Buffer.byteLength(body, "utf8") > KNOWLEDGE_FILE_CAP) {
      throw new Error("Knowledge body exceeds 6MB")
    }
    const data = this.allowlistKnowledgeFrontmatter({
      description,
      type: skill.type,
      site: skill.site,
      tags,
    })
    // F-I-1/9: keep legacy name when it differs from id. Title is display only.
    data.name = skill.name
    data.id = ident
    data.title = title
    const yamlStr = yaml.dump(data, { lineWidth: -1, noRefs: true, quotingType: '"' })
    const stamped = `---\n${yamlStr}---\n\n${body.trimStart()}`
    writeRestrictedFile(skill.source_file, stamped)
    this.refresh()
    return { id: ident, title }
  }

  exportKnowledge(id: string): { format: "markdown"; filename: string; content: string; redacted_hits: number } {
    const skill = this.get(id)
    if (!skill) throw new Error(`Knowledge not found: ${id}`)
    if (!this.isKnowledgeDoc(skill)) throw new Error(`'${id}' is a skill; use skill.export`)
    const raw = fs.readFileSync(skill.source_file, "utf8")
    if (Buffer.byteLength(raw, "utf8") > KNOWLEDGE_BODY_WIRE_CAP) {
      throw new Error("正文超过 512KiB，无法下载")
    }
    const redacted = redactSecrets(raw)
    return {
      format: "markdown",
      filename: path.basename(skill.source_file),
      content: redacted.text,
      redacted_hits: redacted.hits,
    }
  }

  previewKnowledge(content: string, fallbackName?: string): { title: string; description: string; preview: string; char_count: number; tags: string[]; body: string } {
    const stamped = this.ensureKnowledgeFrontmatter(content, fallbackName)
    let parsed: { data: Record<string, unknown>; content: string }
    try {
      parsed = matter(stamped)
    } catch {
      parsed = { data: {}, content: content.trimStart() }
    }
    const title = String(parsed.data.title || parsed.data.name || fallbackName || "未命名")
    const body = parsed.content || ""
    // #272 F2: frontmatter with a name but no description used to surface an
    // EMPTY description in the modal (ensureKnowledgeFrontmatter early-returns
    // on a valid name, so its own 150-char fallback never ran). Fall back to
    // the same heuristic here so the draft is never empty for a non-empty body.
    const rawDescription = typeof parsed.data.description === "string" ? parsed.data.description.trim() : ""
    const description = rawDescription || heuristicKnowledgeDescription(body)
    return {
      title,
      description,
      preview: body.slice(0, 4000),
      char_count: body.length,
      // #272: surface the source file's own frontmatter tags so the import
      // modal can prefill them (was silently dropped by the UI's setTags("")).
      // Same normalizeTags pipeline as LLM-suggested tags (secret shapes dropped).
      tags: normalizeTags(parsed.data.tags),
      // Full parsed body — consumed by the companion-side draft extraction
      // (capped to 8000 chars there); never spread onto the wire.
      body,
    }
  }

  importKnowledge(
    content: string,
    fallbackName?: string,
    nameOverride?: string,
    overrides?: { title?: string; description?: string; tags?: string[] },
    destFolder?: string,
  ): { id: string; title: string; folder: string } {
    content = this.ensureKnowledgeFrontmatter(content, fallbackName, nameOverride)

    let parsed: { data: { name?: string; site?: string; type?: string }; content: string }
    try {
      parsed = matter(content)
    } catch (e: any) {
      throw new Error(`Failed to parse knowledge frontmatter: ${e.message || String(e)}`)
    }
    const name = parsed.data.name
    if (!name) throw new Error("Knowledge doc must have a 'name' field")

    const title = String((parsed.data as { title?: string }).title || name)
    const isSiteKnowledge = parsed.data.type === "site_knowledge" || parsed.data.site
    const subDir = isSiteKnowledge ? "sites" : "global"
    // #274: import_directory preserves the relative tree (≤3 levels). Folder is
    // derived from the destination path only — frontmatter never carries it.
    let folderSegs: string[] = []
    if (destFolder) {
      const norm = this.normalizeKnowledgeFolderPath(destFolder)
      if (!norm.ok) throw new Error(norm.error)
      folderSegs = norm.path ? norm.path.split("/") : []
    }
    // Gate8 MAJOR-5: per-layer 50 applies to imports too. A full target folder
    // bumps the doc UP one layer (repeatedly) instead of silently writing the
    // 51st entry — no file is lost; the router counts this as layerOverflow.
    // The bucket root itself is exempt (the total-200 import cap guards it).
    // F-R2-1: the same check applies to EVERY level the import would CREATE —
    // mkdir(recursive) must not grow a full parent layer to 51 either.
    while (folderSegs.length > 0) {
      const candidate = path.join(this.knowledgeDir, subDir, ...folderSegs)
      if (this.countDirChildren(candidate) >= KNOWLEDGE_FOLDER_MAX_CHILDREN) {
        folderSegs = folderSegs.slice(0, -1)
        continue
      }
      let blocked = false
      for (let i = 1; i <= folderSegs.length; i++) {
        const levelAbs = path.join(this.knowledgeDir, subDir, ...folderSegs.slice(0, i))
        if (fs.existsSync(levelAbs)) continue // existing level grows nothing
        const parentAbs = path.join(this.knowledgeDir, subDir, ...folderSegs.slice(0, i - 1))
        if (this.countDirChildren(parentAbs) >= KNOWLEDGE_FOLDER_MAX_CHILDREN) {
          blocked = true
          break
        }
      }
      if (!blocked) break
      folderSegs = folderSegs.slice(0, -1)
    }
    const targetDir = path.join(this.knowledgeDir, subDir, ...folderSegs)
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 })

    const taken = this.collectTakenStems()
    const preferred = isLegacySafeId(String(name)) ? String(name) : undefined
    // F-I-5: never drop an occupied stem. Re-import of the same ASCII heading
    // must allocate a suffix (`notes-2`), not silently overwrite notes.md.
    let ident = allocateDocIdentity({
      title,
      preferredId: preferred,
      seed: nameOverride || title,
      takenStems: taken,
    })

    const data = this.allowlistKnowledgeFrontmatter(parsed.data as Record<string, unknown>)
    if (overrides?.title) ident = { ...ident, title: cleanTitle(overrides.title) }
    if (overrides?.description) data.description = String(overrides.description).slice(0, 500)
    if (overrides?.tags) data.tags = normalizeTags(overrides.tags)
    data.name = ident.id
    data.id = ident.id
    data.title = ident.title
    const yamlStr = yaml.dump(data, { lineWidth: -1, noRefs: true, quotingType: '"' })
    const stamped = `---\n${yamlStr}---\n\n${parsed.content.trimStart()}`

    const filePath = path.join(targetDir, `${ident.filenameStem}.md`)
    writeRestrictedFile(filePath, stamped)
    this.refresh()
    return { id: ident.id, title: ident.title, folder: folderSegs.join("/") }
  }

  /** F-S-4: untrusted ingest may only keep a small allowlist of frontmatter keys. */
  private allowlistKnowledgeFrontmatter(raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (typeof raw.description === "string") out.description = raw.description.slice(0, 500)
    const type = raw.type
    if (type === "site_knowledge" || type === "domain_knowledge") out.type = type
    else out.type = "domain_knowledge"
    if (typeof raw.site === "string" && raw.site.trim()) {
      const check = validateWildcardPattern(raw.site.trim())
      if (check.ok) out.site = raw.site.trim()
    }
    if (Array.isArray(raw.tags)) {
      // #272 M3: ingest-side tags pass normalizeTags too — secret-shaped tags
      // (SENSITIVE_TAG_RE) are dropped, lowercase + ≤8 enforced, so nothing the
      // LLM or a source file smuggles in reaches disk.
      out.tags = normalizeTags(raw.tags)
    }
    return out
  }

  /** Auto-generate frontmatter for knowledge docs that lack it.
   * - name: nameOverride > frontmatter > first # heading > fallbackName > "未命名知识库"
   * - description: frontmatter > first 150 chars of body (cleaned)
   * - type: frontmatter > "domain_knowledge"
   * Preserves existing frontmatter fields.
   *
   * `nameOverride` (when provided) takes precedence over every other name source.
   * Used by directory import to guarantee unique doc names per file — without it,
   * two files sharing the same first-#-heading would sanitize to the same filename
   * and silently overwrite each other. */
  private ensureKnowledgeFrontmatter(content: string, fallbackName?: string, nameOverride?: string): string {
    let parsed: { data: Record<string, any>; content: string }
    try {
      parsed = matter(content)
    } catch {
      // If matter fails entirely, treat whole content as body
      parsed = { data: {}, content: content.trimStart() }
    }

    // If already has a valid name AND no override, assume frontmatter is complete
    if (!nameOverride && parsed.data.name && typeof parsed.data.name === "string") {
      return content
    }

    // --- Infer name ---
    let inferredName = ""
    if (nameOverride) {
      inferredName = nameOverride
    } else {
      const firstHeading = parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim()
      if (firstHeading) {
        inferredName = firstHeading
      } else if (fallbackName) {
        inferredName = fallbackName
      } else {
        inferredName = "未命名知识库"
      }
    }

    // --- Infer description ---
    let inferredDescription = ""
    if (parsed.data.description && typeof parsed.data.description === "string") {
      inferredDescription = parsed.data.description
    } else {
      inferredDescription = heuristicKnowledgeDescription(parsed.content)
    }

    // --- Infer type ---
    const inferredType = parsed.data.type || "domain_knowledge"

    const frontmatter: Record<string, any> = {
      name: inferredName,
      description: inferredDescription,
      type: inferredType,
    }
    if (parsed.data.site) frontmatter.site = parsed.data.site
    if (parsed.data.tags) frontmatter.tags = parsed.data.tags

    const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, quotingType: '"' })
    return `---\n${yamlStr}---\n\n${parsed.content.trimStart()}`
  }

  deleteKnowledge(name: string): void {
    const skill = this.get(name)
    if (!skill) throw new Error(`Knowledge not found: ${name}`)
    if (skill.builtin) throw new Error(`Cannot delete builtin knowledge: ${name}`)
    if (!this.isKnowledgeDoc(skill)) {
      throw new Error(`'${name}' is not a knowledge doc`)
    }

    if (skill.dir) {
      fs.rmSync(skill.dir, { recursive: true })
    } else {
      fs.unlinkSync(skill.source_file)
    }
    this.refresh()
  }

  // --- #274: knowledge folders + move (same-bucket, id-stable) ---

  /**
   * Build the post-pin content in memory (id + name frontmatter added) for
   * docs that lack an explicit id (F-I-1). Pure function over the raw text —
   * the move transaction writes it on the TARGET side, so a failed move never
   * rewrites the source (Gate8 grok-B1: pin-then-rename left the pin behind).
   */
  private pinnedKnowledgeContent(skill: Skill, raw: string): string {
    const effectiveId = skill.id || skill.name
    let parsed: { data: Record<string, unknown>; content: string }
    try {
      parsed = matter(raw)
    } catch {
      parsed = { data: {}, content: raw }
    }
    // gray-matter caches `data` BY CONTENT by default — mutating parsed.data
    // poisons every later parse of identical bytes (fresh engines would see an
    // id that was never written to disk). Clone before mutating.
    const data = { ...parsed.data }
    data.id = effectiveId
    if (!data.name) data.name = skill.name
    const yamlStr = yaml.dump(data, { lineWidth: -1, noRefs: true, quotingType: '"' })
    return `---\n${yamlStr}---\n\n${parsed.content.trimStart()}`
  }

  /**
   * Transactional same-directory-tree move of one knowledge file:
   * collision-safe target stem → write final content (id pinned when the doc
   * had no explicit frontmatter id) to a TARGET-side temp file → renameSync
   * into place → unlink the source last. Any failure before the unlink leaves
   * the source byte-identical and removes the temp/dest residue; an unlink
   * failure drops dest (unlink is atomic — failure means the source kept its
   * original bytes, so dest is the only correct thing to remove). Never routes
   * through importKnowledge / allocateDocIdentity for the moved doc itself (id
   * must not change); the allocator only picks a fresh FILENAME stem on a
   * same-name collision. The target folder must already exist (no implicit
   * folder creation — per-layer cap would be bypassed, Gate8 MAJOR-3).
   */
  private moveKnowledgeFileAbs(
    skill: Skill,
    bucket: "global" | "sites",
    targetFolder: string,
    /** Entries in the target dir to exclude from the per-layer count (the folder being deleted by move_to_parent). */
    capExempt = 0,
  ): string {
    const targetDir = this.knowledgeFolderAbsDir(bucket, targetFolder)
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      throw new Error(`目标文件夹不存在: ${targetFolder || "(桶根)"}，请先创建文件夹`)
    }
    if (this.countDirChildren(targetDir) - capExempt >= KNOWLEDGE_FOLDER_MAX_CHILDREN) {
      throw new Error(`目标文件夹已满（单层最多 ${KNOWLEDGE_FOLDER_MAX_CHILDREN} 项）`)
    }
    const srcPath = skill.source_file
    const ext = path.extname(srcPath)
    const srcStem = path.basename(srcPath, ext)
    let destName = path.basename(srcPath)
    const firstChoice = path.join(targetDir, destName)
    if (firstChoice !== srcPath && fs.existsSync(firstChoice)) {
      // Same-name collision in the target folder: allocate a fresh stem.
      const ident = allocateDocIdentity({
        title: skill.title || skill.name,
        preferredId: isLegacySafeId(srcStem) ? srcStem : undefined,
        seed: `${srcStem}@${targetFolder}`,
        takenStems: this.collectTakenStems(),
      })
      destName = `${ident.filenameStem}${ext}`
    }
    const destPath = path.join(targetDir, destName)
    if (destPath === srcPath) return srcPath // already there
    // Final bytes in memory: pin the id when the doc lacks one so a forced
    // stem change can never retitle the doc's identity.
    const raw = fs.readFileSync(srcPath, "utf-8")
    const finalContent = skill.id ? raw : this.pinnedKnowledgeContent(skill, raw)
    const tmpPath = path.join(targetDir, `.${destName}.move-tmp-${process.pid}-${Date.now()}`)
    try {
      writeRestrictedFile(tmpPath, finalContent)
      fs.renameSync(tmpPath, destPath)
    } catch (e) {
      try {
        if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true })
        if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true })
      } catch {
        /* best-effort residue cleanup */
      }
      throw e
    }
    try {
      fs.unlinkSync(srcPath)
    } catch (e) {
      // dest landed but source removal failed. unlink is atomic — failure means
      // the source is STILL there with its original bytes, so the only correct
      // rollback is dropping dest (F-R2-2: never rename dest back over src,
      // that would clobber the original bytes with the pinned copy).
      try {
        if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true })
      } catch {
        /* best-effort: dest residue is a byte-copy; source of truth intact */
      }
      throw e
    }
    return destPath
  }

  /**
   * knowledge.move — same-bucket rename, id unchanged (F-I-1/F-I-8).
   * The protocol has no bucket parameter: the target folder is relative to the
   * doc's OWN bucket, so cross-bucket moves are unrepresentable (rejected by
   * construction); `folder: ""` moves to the bucket root.
   */
  moveKnowledge(id: string, folderRaw: unknown): { id: string; folder: string } {
    const norm = this.normalizeKnowledgeFolderPath(folderRaw, { allowEmpty: true })
    if (!norm.ok) throw new Error(norm.error)
    const skill = this.get(id)
    if (!skill || !this.isKnowledgeDoc(skill)) throw new Error(`Knowledge not found: ${id}`)
    if (skill.builtin) throw new Error(`Cannot move builtin knowledge: ${id}`)
    const bucket = this.knowledgeBucketOf(skill.source_file)
    if (!bucket) throw new Error(`Knowledge doc is not inside a bucket: ${id}`)
    const effectiveId = skill.id || skill.name
    const curFolder = path
      .dirname(path.relative(this.knowledgeBucketRoot(bucket), skill.source_file))
      .split(path.sep).filter((s) => s && s !== ".").join("/")
    if (curFolder === norm.path) {
      return { id: effectiveId, folder: norm.path }
    }
    this.moveKnowledgeFileAbs(skill, bucket, norm.path)
    this.refresh()
    return { id: effectiveId, folder: norm.path }
  }

  createKnowledgeFolder(
    bucket: "global" | "sites",
    folderRaw: unknown,
    description?: string,
  ): { path: string } {
    const norm = this.normalizeKnowledgeFolderPath(folderRaw)
    if (!norm.ok) throw new Error(norm.error)
    const absDir = this.knowledgeFolderAbsDir(bucket, norm.path)
    if (fs.existsSync(absDir)) throw new Error(`文件夹已存在: ${norm.path}`)
    // Gate8 MAJOR-3: per-layer cap applies to EVERY level this create would
    // grow (mkdir recursive otherwise bypasses a full bucket root for a/b).
    const segs = norm.path.split("/")
    for (let i = 1; i <= segs.length; i++) {
      const levelAbs = this.knowledgeFolderAbsDir(bucket, segs.slice(0, i).join("/"))
      if (fs.existsSync(levelAbs)) continue // existing level grows nothing
      const parentAbs = i === 1
        ? this.knowledgeBucketRoot(bucket)
        : this.knowledgeFolderAbsDir(bucket, segs.slice(0, i - 1).join("/"))
      if (this.countDirChildren(parentAbs) >= KNOWLEDGE_FOLDER_MAX_CHILDREN) {
        throw new Error(`上层文件夹已满（单层最多 ${KNOWLEDGE_FOLDER_MAX_CHILDREN} 项）`)
      }
    }
    fs.mkdirSync(absDir, { recursive: true, mode: 0o700 })
    if (typeof description === "string" && description.trim()) {
      this.writeKnowledgeFolderMeta(bucket, norm.path, description)
    }
    this.refresh()
    return { path: norm.path }
  }

  renameKnowledgeFolder(
    bucket: "global" | "sites",
    pathRaw: unknown,
    newPathRaw: unknown,
  ): { path: string; new_path: string } {
    const norm = this.normalizeKnowledgeFolderPath(pathRaw)
    if (!norm.ok) throw new Error(norm.error)
    const normNew = this.normalizeKnowledgeFolderPath(newPathRaw)
    if (!normNew.ok) throw new Error(normNew.error)
    if (norm.path === normNew.path) return { path: norm.path, new_path: normNew.path }
    // Renaming a parent into its own child would create a cycle.
    if (normNew.path.startsWith(norm.path + "/")) {
      throw new Error("不能把文件夹移动到它自己内部")
    }
    const srcAbs = this.knowledgeFolderAbsDir(bucket, norm.path)
    const destAbs = this.knowledgeFolderAbsDir(bucket, normNew.path)
    if (!fs.existsSync(srcAbs)) throw new Error(`文件夹不存在: ${norm.path}`)
    if (fs.existsSync(destAbs)) throw new Error(`目标文件夹已存在: ${normNew.path}`)
    const destParent = path.dirname(destAbs)
    if (!fs.existsSync(destParent)) throw new Error(`目标上层文件夹不存在: ${path.dirname(normNew.path) || "(桶根)"}`)
    if (this.countDirChildren(destParent) >= KNOWLEDGE_FOLDER_MAX_CHILDREN) {
      throw new Error(`目标上层文件夹已满（单层最多 ${KNOWLEDGE_FOLDER_MAX_CHILDREN} 项）`)
    }
    // Gate8 F-B: renaming also MOVES the subtree — the deepest member's level
    // after the move (new_path depth + deepest relative subtree level) must
    // stay ≤ KNOWLEDGE_FOLDER_MAX_DEPTH.
    const maxSubDepth = (dir: string, depth: number): number => {
      let max = depth
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return max
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue
        if (isSymlinkOrJunction(dir, entry)) continue
        if (entry.isDirectory()) max = Math.max(max, maxSubDepth(path.join(dir, entry.name), depth + 1))
      }
      return max
    }
    const newDepth = normNew.path.split("/").length + maxSubDepth(srcAbs, 0)
    if (newDepth > KNOWLEDGE_FOLDER_MAX_DEPTH) {
      throw new Error(`移动后子树最深 ${newDepth} 级，超过 ${KNOWLEDGE_FOLDER_MAX_DEPTH} 级上限`)
    }
    fs.renameSync(srcAbs, destAbs)
    this.refresh()
    return { path: norm.path, new_path: normNew.path }
  }

  /** folder_update: save the user description → _folder.md (F-S-7: 保存才落盘). */
  updateKnowledgeFolder(
    bucket: "global" | "sites",
    pathRaw: unknown,
    description: string,
  ): { path: string; description: string } {
    const norm = this.normalizeKnowledgeFolderPath(pathRaw)
    if (!norm.ok) throw new Error(norm.error)
    const absDir = this.knowledgeFolderAbsDir(bucket, norm.path)
    if (!fs.existsSync(absDir)) throw new Error(`文件夹不存在: ${norm.path}`)
    const desc = String(description ?? "").slice(0, KNOWLEDGE_FOLDER_DESCRIPTION_MAX)
    this.writeKnowledgeFolderMeta(bucket, norm.path, desc)
    this.refresh()
    return { path: norm.path, description: desc }
  }

  /**
   * Import carry-over: a vault `_folder.md` becomes folder metadata for the
   * bucket(s) its sibling docs landed in. Returns true when the folder ends
   * up WITH a description on disk (written now, or a pre-existing one wins),
   * false when nothing was carried (caller counts folderMetaDropped).
   *
   * opts.createIfMissing === false: only carry into folders that already
   * exist on disk (ancestor-of-a-landed-doc carry, F-R4-1) — never mkdir.
   */
  applyImportedFolderMeta(
    bucket: "global" | "sites",
    folderRaw: string,
    description: string,
    opts?: { createIfMissing?: boolean },
  ): boolean {
    const norm = this.normalizeKnowledgeFolderPath(folderRaw)
    if (!norm.ok || !norm.path) return false
    const absDir = this.knowledgeFolderAbsDir(bucket, norm.path)
    if (!fs.existsSync(absDir)) {
      if (opts?.createIfMissing === false) return false
      // Gate8 r3 F-R3-1 defense-in-depth: creating the folder must not grow a
      // full parent layer either (mirror createKnowledgeFolder's per-level 50
      // check). A blocked carry-over simply skips — the docs are imported.
      const segs = norm.path.split("/")
      for (let i = 1; i <= segs.length; i++) {
        const levelAbs = this.knowledgeFolderAbsDir(bucket, segs.slice(0, i).join("/"))
        if (fs.existsSync(levelAbs)) continue
        const parentAbs = i === 1
          ? this.knowledgeBucketRoot(bucket)
          : this.knowledgeFolderAbsDir(bucket, segs.slice(0, i - 1).join("/"))
        if (this.countDirChildren(parentAbs) >= KNOWLEDGE_FOLDER_MAX_CHILDREN) return false
      }
      fs.mkdirSync(absDir, { recursive: true, mode: 0o700 })
    }
    // An already-saved user description wins over an import carry-over.
    const metaPath = path.join(absDir, FOLDER_META_FILENAME)
    if (fs.existsSync(metaPath)) return true
    // Gate8 F-F: the carry-over writes a new entry — respect the per-layer cap
    // (a full folder skips the carry-over; nothing is overwritten or broken).
    if (this.countDirChildren(absDir) >= KNOWLEDGE_FOLDER_MAX_CHILDREN) return false
    this.writeKnowledgeFolderMeta(bucket, norm.path, description)
    return true
  }

  /**
   * folder_delete — default reject_if_docs: any knowledge doc anywhere in the
   * subtree refuses the delete. move_to_parent lifts DIRECT member docs one
   * level up (same atomic rename as knowledge.move, ids unchanged), then
   * removes the empty dir + its _folder.md. Folders containing subfolders are
   * refused in both modes (honest error, nothing moved).
   */
  deleteKnowledgeFolder(
    bucket: "global" | "sites",
    pathRaw: unknown,
    mode: "reject_if_docs" | "move_to_parent" = "reject_if_docs",
  ): { path: string; moved: number } {
    const norm = this.normalizeKnowledgeFolderPath(pathRaw)
    if (!norm.ok) throw new Error(norm.error)
    const absDir = this.knowledgeFolderAbsDir(bucket, norm.path)
    if (!fs.existsSync(absDir)) throw new Error(`文件夹不存在: ${norm.path}`)
    this.ensureFresh()

    const directDocs: Skill[] = []
    let subfolderCount = 0
    let subtreeDocs = 0
    let otherFiles = 0
    const scan = (dir: string, isRoot: boolean) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue
        if (isSymlinkOrJunction(dir, entry)) throw new Error(`文件夹内含链接条目，拒绝删除: ${entry.name}`)
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (isRoot) subfolderCount++
          scan(full, false)
          continue
        }
        if (!entry.isFile()) continue
        if (entry.name === FOLDER_META_FILENAME) continue
        if (entry.name.endsWith(".md") || entry.name.endsWith(".markdown")) {
          subtreeDocs++
          if (isRoot) {
            const skill = this.skillsCache.find((s) => s.source_file === full)
            if (skill) directDocs.push(skill)
          }
        } else {
          otherFiles++
        }
      }
    }
    scan(absDir, true)

    if (mode === "reject_if_docs") {
      if (subtreeDocs > 0) throw new Error(`文件夹非空（含 ${subtreeDocs} 篇文档），拒绝删除`)
      if (subfolderCount > 0) throw new Error("文件夹含子文件夹，拒绝删除")
      if (otherFiles > 0) throw new Error("文件夹内还有非知识文件，拒绝删除")
      fs.rmSync(absDir, { recursive: true })
      this.refresh()
      return { path: norm.path, moved: 0 }
    }

    // move_to_parent
    if (subfolderCount > 0) throw new Error("请先移动或删除子文件夹")
    if (otherFiles > 0) throw new Error("文件夹内还有非知识文件，拒绝删除")
    const parentFolder = norm.path.split("/").slice(0, -1).join("/")
    const parentAbs = this.knowledgeFolderAbsDir(bucket, parentFolder)
    // Direct .md files that the loader skipped (unparseable) still move as files.
    const directFiles = fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile() && (e.name.endsWith(".md") || e.name.endsWith(".markdown")) && e.name !== FOLDER_META_FILENAME)
    // Gate8 MAJOR-4: the parent's child count includes the folder being
    // deleted itself — exclude it before judging whether the lift fits.
    if ((this.countDirChildren(parentAbs) - 1) + directFiles.length > KNOWLEDGE_FOLDER_MAX_CHILDREN) {
      throw new Error(`上层文件夹放不下（单层最多 ${KNOWLEDGE_FOLDER_MAX_CHILDREN} 项）`)
    }
    const movedPairs: Array<{ from: string; to: string }> = []
    try {
      for (const f of directFiles) {
        const srcPath = path.join(absDir, f.name)
        const skill = directDocs.find((s) => s.source_file === srcPath)
        let dest = ""
        if (skill) {
          // capExempt=1: the doomed subfolder still counts in the parent's
          // child list until the final rm — exclude it per moved file too.
          dest = this.moveKnowledgeFileAbs(skill, bucket, parentFolder, 1)
        } else {
          dest = path.join(parentAbs, f.name)
          if (fs.existsSync(dest)) throw new Error(`目标位置已有同名文件: ${f.name}`)
          fs.renameSync(srcPath, dest)
        }
        if (dest !== srcPath) movedPairs.push({ from: dest, to: srcPath })
      }
    } catch (e) {
      // Rollback everything already moved (reverse order).
      for (const pair of movedPairs.reverse()) {
        try {
          if (fs.existsSync(pair.from) && !fs.existsSync(pair.to)) fs.renameSync(pair.from, pair.to)
        } catch {
          /* best-effort restore */
        }
      }
      throw e
    }
    fs.rmSync(absDir, { recursive: true })
    this.refresh()
    return { path: norm.path, moved: directFiles.length }
  }

  /**
   * folder_suggest input: member (subtree) doc title+description one-liners,
   * ≤30 docs. Router redacts + sends to the LLM; nothing is written here.
   */
  knowledgeFolderMemberLines(bucket: "global" | "sites", pathRaw: unknown): string[] {
    const norm = this.normalizeKnowledgeFolderPath(pathRaw)
    if (!norm.ok) throw new Error(norm.error)
    const absDir = this.knowledgeFolderAbsDir(bucket, norm.path)
    if (!fs.existsSync(absDir)) throw new Error(`文件夹不存在: ${norm.path}`)
    const prefix = path.resolve(absDir) + path.sep
    this.ensureFresh()
    const members = this.skillsCache.filter((s) => {
      if (!this.isKnowledgeDoc(s)) return false
      try {
        return path.resolve(s.source_file).startsWith(prefix)
      } catch {
        return false
      }
    })
    return members.slice(0, 30).map((s) =>
      `${(s.title || s.name).replace(/\s+/g, " ").trim()} — ${(s.description || "").replace(/\s+/g, " ").trim()}`,
    )
  }

  /** Search relevant chunks from given knowledge docs based on query.
   *  Returns concatenated text of top matching chunks. */
  searchKnowledge(knowledgeNames: string[], query: string, topK = KNOWLEDGE_SEARCH_TOPK): string {
    if (!query || !knowledgeNames.length) return ""

    const allChunks: FileChunk[] = []
    for (const name of knowledgeNames) {
      const chunks = this.knowledgeChunks.get(name)
      if (chunks) {
        allChunks.push(...chunks)
      }
    }
    if (!allChunks.length) return ""

    const matched = searchChunks(allChunks, query, topK)
    if (!matched.length) return ""

    return matched.map(c => sanitizeKnowledgeContent(c.text)).join("\n\n---\n\n")
  }

  /** Create a new site_knowledge or domain_knowledge skill with initial entry. */
  createExperienceSkill(
    name: string,
    type: "site_knowledge" | "domain_knowledge",
    site?: string,
    tags?: string[],
    entry?: ExperienceEntry,
  ): void {
    const ident = allocateDocIdentity({
      title: name,
      preferredId: isLegacySafeId(name) ? name : undefined,
      takenStems: listStemSet(this.skillsDir),
    })
    const filePath = path.join(this.skillsDir, `${ident.filenameStem}.md`)
    if (fs.existsSync(filePath)) {
      // Skill already exists, just add entry
      const existing = this.get(name)
      if (existing && entry) {
        if (!existing.entries) existing.entries = []
        existing.entries.push(entry)
        this.saveSkillFile(name)
      }
      return
    }

    const frontmatter: Record<string, any> = {
      name,
      description: type === "site_knowledge" ? `Site experience for ${site}` : `Domain knowledge: ${name}`,
      type,
    }
    if (site) frontmatter.site = site
    if (tags?.length) frontmatter.tags = tags
    if (entry) {
      frontmatter.entries = [{
        id: entry.id,
        category: entry.category,
        content: entry.content,
        recorded_at: entry.recorded_at,
        confirmed_at: entry.confirmed_at,
        stale: entry.stale,
        stale_reason: entry.stale_reason || "",
        replaced_by: "",
      }]
    }
    const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, quotingType: '"' })
    let md = `---\n${yamlStr}---\n`
    if (entry) {
      const icon = entry.category === "problem" ? "🐛" : entry.category === "success" ? "✅" : entry.category === "tip" ? "💡" : "📋"
      md += `\n# 记录列表\n\n- ${icon} ${entry.content}`
    }

    writeRestrictedFile(filePath, md)
    this.refresh()
  }
}
