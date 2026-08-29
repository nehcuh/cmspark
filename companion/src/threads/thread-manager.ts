// Thread manager — CRUD for conversation threads

import * as fs from "fs"
import * as path from "path"
import { getConfig, getConfigDir } from "../config"
import { atomicWriteJSON } from "../io"
import type { MissionBoard } from "../board/schema"
import type { ThreadDigest } from "./digest"
import { isDigestStale, sanitizeDigest } from "./digest"
import { sanitizeTopicFolder } from "./distill"
import { inspectThreadMessages } from "./thread-inspect"
import {
  sanitizeRuntimeContextBudget,
  type RuntimeContextBudgetMeta,
} from "./runtime-context-budget"
import { sanitizeRunProgress, seedRunProgress, type RunProgress } from "./run-progress"
import type { ImageAttachmentMeta } from "../llm/image-parts"
import { sniffedExt, type RasterMime } from "../llm/image-sniff"
import {
  deleteSidecarsForMessages,
  readImageAttachment as readImageAttachmentBytes,
  removeAttachmentsDir,
} from "./image-sidecar"

interface ThreadPackSnapshot {
  tool_whitelist: string[] | null
  active_skill_ids: string[]
  /** Wave A: knowledge docs activated for this thread (independent of skills). */
  active_knowledge_ids?: string[]
  skill_selection_mode?: "auto" | "all" | "manual"
  knowledge_selection_mode?: "auto" | "all" | "manual"
  mcp_selection_mode?: "auto" | "all" | "manual"
  active_mcp_server_ids?: string[]
  system_prompt_append: string | null
}

interface Thread {
  id: string
  alias: string
  created_at: string
  updated_at: string
  config_override: Record<string, any>
  tool_whitelist: string[] | null
  pinned_tabs: number[]
  active_skill_ids: string[]
  /** Knowledge doc names active for this thread (manual / pack apply). */
  active_knowledge_ids?: string[]
  skill_selection_mode?: "auto" | "all" | "manual"
  knowledge_selection_mode?: "auto" | "all" | "manual"
  // Audit item 7: per-thread MCP server selection. "auto" exposes every
  // connected server's tools to the LLM (legacy default). "all" exposes every
  // connected server explicitly. "manual" restricts to active_mcp_server_ids.
  mcp_selection_mode?: "auto" | "all" | "manual"
  active_mcp_server_ids?: string[]
  /** Mission Pack currently applied (null/undefined = none). */
  mission_pack_id?: string | null
  /** Pre-apply snapshot for uninstall/re-apply rollback. */
  mission_pack_snapshot?: ThreadPackSnapshot | null
  /**
   * Product B: global Trust snapshot taken when a user pack with trust applied.
   * Restored on unapply so scene exit reverts auto_approve/modules when possible.
   */
  mission_pack_trust_snapshot?: Record<string, unknown> | null
  /** DevSec workspace root (absolute path). */
  workspace_root?: string | null
  /** NetSec per-task authorization (user confirmed ownership of targets). */
  netsec_task_auth?: {
    authorized: boolean
    targets: string[]
    at?: string
  } | null
  /** Multi-agent (ADR-015): role of this thread in an orchestrator run. */
  agent_role?: "normal" | "orchestrator" | "worker"
  /** Parent orchestrator thread id when agent_role=worker. */
  parent_thread_id?: string | null
  /** Shared id for one orchestrator fan-out episode. */
  orchestrator_run_id?: string | null
  /** Human-readable worker role label. */
  worker_role_label?: string | null
  /** Optional elevation marker (audited grants only). */
  capability_elevation_level?: string | null
  /** Pause freezes LLM loop + new tool dispatch; leases retained until TTL/cancel. */
  paused?: boolean
  /** ADR-016 Stage 3: worker bound to host-board intent id. */
  assigned_intent_id?: string | null
  /**
   * MissionBoard (ADR-016): structured Fact/Intent/Hint run state.
   * null/undefined = no board (board mode off or never initialized).
   * Canonical board lives only on host threads (orchestrator / sole single-thread).
   * Workers must never persist mission_board.
   */
  mission_board?: MissionBoard | null
  /**
   * When true, ensureBoardDefaults may initialize mission_board.
   * Default false/undefined = off (rollback-friendly).
   */
  board_mode?: boolean
  /**
   * Thread History IA P1: short searchable index (tldr/tags/bullets).
   * Rebuildable — messages remain source of truth.
   */
  digest?: ThreadDigest | null
  /**
   * Runtime context budget meta (M1/M2). Distinct from digest/export.
   * Rolling summary is redacted, for UI "查看摘要"; not injected cross-thread.
   */
  runtime_context_budget?: RuntimeContextBudgetMeta | null
  /**
   * L0 chat-column RunProgress (slice 6). Seeded from H1 handoff.open_todos;
   * ticks bind to tool_result or a later user gesture — not model JSON.
   */
  run_progress?: RunProgress | null
  /**
   * Soft-delete timestamp (ISO). null/undefined = active.
   * P1.5 recycle bin; hard delete clears file + index entry.
   */
  trashed_at?: string | null
  /** Wave 2 话题夹 — user folder label, not Project/Pack. */
  topic_folder?: string | null
}

// Allowed config_override keys and their expected types
const ALLOWED_CONFIG_OVERRIDE_KEYS: Record<string, string> = {
  temperature: "number",
  context_window: "number",
  max_tokens: "number",
  top_p: "number",
  model_name: "string",
  base_url: "string",
  system_prompt: "string",
  system_prompt_append: "string",
  vision_enabled: "boolean",
}

const MAX_CONFIG_STRING_LENGTH = 2000
const MAX_SYSTEM_PROMPT_APPEND_LENGTH = 16 * 1024
const MAX_CONFIG_NUMBER = 1000000

function validateConfigOverride(config: any): { valid: boolean; error?: string; sanitized: Record<string, any> } {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { valid: true, sanitized: {} }
  }
  const sanitized: Record<string, any> = {}
  for (const key of Object.keys(config)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return { valid: false, error: `Invalid config key: ${key}`, sanitized: {} }
    }
    const expectedType = ALLOWED_CONFIG_OVERRIDE_KEYS[key]
    if (!expectedType) {
      return { valid: false, error: `Unknown config_override key: ${key}`, sanitized: {} }
    }
    const val = config[key]
    if (val === null || val === undefined) {
      continue
    }
    if (expectedType === "number") {
      if (typeof val !== "number" || isNaN(val)) {
        return { valid: false, error: `Config key ${key} must be a number`, sanitized: {} }
      }
      if (val > MAX_CONFIG_NUMBER || val < -MAX_CONFIG_NUMBER) {
        return { valid: false, error: `Config key ${key} out of range`, sanitized: {} }
      }
      sanitized[key] = val
    } else if (expectedType === "string") {
      if (typeof val !== "string") {
        return { valid: false, error: `Config key ${key} must be a string`, sanitized: {} }
      }
      const maxLen = key === "system_prompt_append" ? MAX_SYSTEM_PROMPT_APPEND_LENGTH : MAX_CONFIG_STRING_LENGTH
      if (val.length > maxLen) {
        return { valid: false, error: `Config key ${key} exceeds max length`, sanitized: {} }
      }
      sanitized[key] = val
    } else if (expectedType === "boolean") {
      if (typeof val !== "boolean") {
        return { valid: false, error: `Config key ${key} must be a boolean`, sanitized: {} }
      }
      sanitized[key] = val
    }
  }
  return { valid: true, sanitized }
}

interface ThreadIndex {
  threads: Thread[]
}

interface Message {
  id: string
  thread_id: string
  role: "user" | "assistant" | "tool" | "system"
  content: string
  tool_calls?: any[]
  /** DeepSeek / Anthropic thinking text (optional; UI shows as collapsible). */
  reasoning_content?: string
  created_at: string
  /** Image attachments (metadata only; bytes live in `threads/<id>.files/`). */
  attachments?: ImageAttachmentMeta[]
  /** Companion-attached knowledge ledger for this assistant turn (Wave 1). */
  retrieved_sources?: Array<{ id: string; title: string; chunk_index?: number; chars: number }>
}

const RASTER_MIMES = new Set<RasterMime>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

/** ~300KB binary as base64; makePreviewB64 caps at ~11K chars, so this only bounds hostile/legacy payloads. */
const MAX_PREVIEW_B64_CHARS = 400_000

/** Stamp companion-chosen rel/msg_id/index; never persist a client-supplied path. */
function stampAttachments(msgId: string, atts: ImageAttachmentMeta[]): ImageAttachmentMeta[] {
  return atts
    .filter((a): a is ImageAttachmentMeta => !!a && a.kind === "image" && RASTER_MIMES.has(a.mime))
    .map((a, i) => ({
      kind: "image" as const,
      name: String(a.name || "image").slice(0, 200),
      mime: a.mime,
      sha256: String(a.sha256 || "").slice(0, 128),
      bytes: typeof a.bytes === "number" && Number.isFinite(a.bytes) ? a.bytes : 0,
      ...(typeof a.width === "number" ? { width: a.width } : {}),
      ...(typeof a.height === "number" ? { height: a.height } : {}),
      ...(typeof a.preview_jpeg_b64 === "string"
        ? { preview_jpeg_b64: a.preview_jpeg_b64.slice(0, MAX_PREVIEW_B64_CHARS) }
        : {}),
      ...(typeof a.dest_host === "string" && a.dest_host
        ? { dest_host: a.dest_host.replace(/[\n\r]/g, "").slice(0, 200) }
        : {}),
      msg_id: msgId,
      index: i,
      rel: `${msgId}-${i}.${sniffedExt(a.mime)}`,
    }))
}

export const MAX_MESSAGES_PER_THREAD = 1000

/** Drop oldest rows but never start mid tool-block (assistant + following tools). */
export function trimMessagesTurnSafe<T extends { role: string; tool_calls?: unknown[] }>(
  messages: T[],
  max: number,
): T[] {
  if (max < 1 || messages.length <= max) return messages
  let start = messages.length - max
  if (messages[start]?.role === "tool") {
    let a = start
    while (a > 0 && messages[a].role === "tool") a--
    if (messages[a]?.role === "assistant") {
      let k = a + 1
      while (k < messages.length && messages[k].role === "tool") k++
      // Prefer over-cap (keep assistant+tools) over an empty tape.
      start = k < messages.length ? k : a
    } else {
      // No assistant owner behind the block (orphan tool rows): scan forward
      // for a non-tool boundary; when the whole suffix is tool rows keep the
      // anchor side (a + block, over-cap) instead of a tool-leading window.
      let k = start
      while (k < messages.length && messages[k].role === "tool") k++
      start = k < messages.length ? k : a
    }
  }
  const kept = messages.slice(Math.max(0, start))
  return kept.length > 0 ? kept : messages.slice(-Math.max(1, max))
}

// Monotonic timestamp: Date only has ms precision, so two creates/updates in the same tick get
// identical ISO strings — which breaks reverse-creation-order listing and "updated_at is newer"
// assertions (and makes ordering non-deterministic in general). This never returns the same
// value twice within a process: if Date.now() hasn't advanced, bump by 1ms.
//
// Scope: IN-PROCESS monotonic only (not cross-restart persistent). On restart _lastTs resets to
// 0, so a newly-created thread's ts starts from real Date.now() — which is normally > persisted
// timestamps (drift is at most +1ms per in-process collision), so "newer" holds in practice.
// Don't use these timestamps for wall-clock TTL/expiry; they're for ordering/display only.
let _lastTs = 0
function monotonicTimestamp(): string {
  const now = Date.now()
  _lastTs = now > _lastTs ? now : _lastTs + 1
  return new Date(_lastTs).toISOString()
}

// Track which threads have already logged the message-cap warning, so a long thread doesn't
// spam the log on every addMessage after hitting the cap.
const _capWarnedThreads = new Set<string>()

function truncatePreview(text: string, maxLen: number): string {
  const s = text.replace(/\s+/g, " ").trim()
  if (!s) return ""
  return s.length > maxLen ? s.slice(0, maxLen) : s
}

function firstUserPreviewFromMessages(
  msgs: Array<{ role: string; content?: string }>,
  maxLen: number,
): string {
  for (const m of msgs) {
    if (m.role !== "user") continue
    const text = truncatePreview(String(m.content || ""), maxLen)
    if (text) return text
  }
  return ""
}

function lastUserPreviewFromMessages(
  msgs: Array<{ role: string; content?: string }>,
  maxLen: number,
): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== "user") continue
    const text = truncatePreview(String(m.content || ""), maxLen)
    if (text) return text
  }
  return ""
}

/**
 * Known MCP server-id aliases for tool_whitelist patterns.
 * Real default server id is `filesystem` → tools `mcp__filesystem__*`.
 * Legacy UI/tests often wrote `mcp__fs__*`; match both directions.
 */
export const MCP_SERVER_ID_ALIASES: Readonly<Record<string, readonly string[]>> = {
  filesystem: ["fs"],
  fs: ["filesystem"],
}

/** Server ids that should match a whitelist server segment (self + aliases). */
export function mcpServerIdsForWhitelistMatch(serverId: string): string[] {
  const alts = MCP_SERVER_ID_ALIASES[serverId]
  return alts ? [serverId, ...alts] : [serverId]
}

/**
 * Whether an MCP tool name is allowed by a non-null thread tool_whitelist.
 * Pure helper for unit tests (same rules as ThreadManager.isToolAllowed MCP branch).
 */
export function isMcpToolAllowedByWhitelist(wl: string[], toolName: string): boolean {
  if (wl.includes(toolName)) return true
  if (wl.includes("mcp__*")) return true
  if (
    toolName === "mcp_list_resources" ||
    toolName === "mcp_read_resource" ||
    toolName === "mcp_get_prompt"
  ) {
    // Meta tools: exact name only (unless mcp__* already matched)
    return false
  }
  if (!toolName.startsWith("mcp__")) return false

  const parts = toolName.split("__")
  // mcp__server__tool…  (tool segment may itself contain __)
  if (parts.length < 3) return false
  const serverId = parts[1]!
  const rest = parts.slice(2).join("__")

  for (const sid of mcpServerIdsForWhitelistMatch(serverId)) {
    if (wl.includes(`mcp__${sid}__*`)) return true
    if (wl.includes(`mcp__${sid}__${rest}`)) return true
  }
  return false
}

export type CruiseSecurityFlags = {
  auto_approve_dangerous?: boolean
  auto_approve_enterprise_tools?: boolean
  allow_all_schemes?: boolean
}

/** Three-flag cruise (same predicate as L2). Pass `security` in tests. */
export function isFullAutonomyCruiseOpen(security?: CruiseSecurityFlags): boolean {
  let s: CruiseSecurityFlags
  if (security) {
    s = security
  } else {
    try {
      s = (getConfig().security || {}) as CruiseSecurityFlags
    } catch {
      s = {}
    }
  }
  return (
    s.auto_approve_dangerous === true &&
    s.auto_approve_enterprise_tools === true &&
    s.allow_all_schemes === true
  )
}

/**
 * Unbound SkillEngine (tests) reloads disk per call — same as the old
 * `new ThreadManager()` at each getActive*. Production binds the process
 * singleton so this path is unused.
 */
export function fallbackThreadManager(): ThreadManager {
  return new ThreadManager()
}

export class ThreadManager {
  private index: ThreadIndex
  private indexPath: string

  // C-P0-1 (2026-07-24 diagnosis): per-thread async serialization chain.
  //
  // Individual sync methods (addMessage / update / create / delete) are
  // atomic under Node's single-threaded model — sync code blocks the event
  // loop, so two concurrent calls execute strictly serially and cannot
  // interleave inside a single function.
  //
  // The remaining race class is compound operations that span `await`
  // boundaries (e.g. forking a thread: getMessages → async LLM call →
  // addMessage loop → update). Between awaits, another WS client can
  // mutate the same file. Callers performing compound ops MUST wrap the
  // sequence in `withThreadLock(threadId, async () => { ... })` so that
  // concurrent operations on the same thread serialize.
  //
  // Index-level operations (create / delete) are guarded by `indexLock`
  // because they mutate the shared index.json regardless of thread.
  private threadLocks = new Map<string, Promise<unknown>>()
  private indexLock: Promise<unknown> = Promise.resolve()

  /**
   * Serialize async compound operations on a single thread. Sync methods
   * don't need this (Node single-thread guarantee), but any caller that
   * awaits between read and write MUST use this primitive.
   *
   * Usage:
   *   await manager.withThreadLock(threadId, async () => {
   *     const msgs = manager.getMessages(threadId)
   *     await llm.generate(msgs)
   *     manager.addMessage(threadId, result)
   *   })
   */
  async withThreadLock<T>(threadId: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.threadLocks.get(threadId) ?? Promise.resolve()
    const next = prev.then(() => fn())
    // Swallow rejections on the chained promise so one failing op doesn't
    // poison the chain for future callers. Caller sees the rejection via `next`.
    this.threadLocks.set(threadId, next.then(() => undefined, () => undefined))
    return await next
  }

  /** Like withThreadLock but for index-wide operations (create/delete). */
  async withIndexLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const prev = this.indexLock
    const next = prev.then(() => fn())
    this.indexLock = next.then(() => undefined, () => undefined)
    return await next
  }

  constructor() {
    const dir = getConfigDir()
    this.indexPath = path.join(dir, "threads", "index.json")
    this.index = this.loadIndex()
  }

  private loadIndex(): ThreadIndex {
    try {
      const raw = fs.readFileSync(this.indexPath, "utf-8")
      return JSON.parse(raw)
    } catch {
      return { threads: [] }
    }
  }

  /**
   * Persist index.json. Before write, merge peer-written digests from disk so a
   * second process (tray + daemon, or two companions) that loaded the index
   * *before* digests existed cannot wipe tags/tldr on its next addMessage/update.
   * Only fills `digest` when memory has `undefined` (not intentional `null` clear).
   */
  private saveIndex(): void {
    try {
      if (fs.existsSync(this.indexPath)) {
        const raw = fs.readFileSync(this.indexPath, "utf-8")
        const disk = JSON.parse(raw) as ThreadIndex
        if (disk && Array.isArray(disk.threads)) {
          const diskById = new Map(
            disk.threads
              .filter((t) => t && typeof t.id === "string")
              .map((t) => [t.id, t] as const),
          )
          for (const t of this.index.threads) {
            if (t.digest !== undefined) continue
            const d = diskById.get(t.id)
            if (d?.digest && typeof d.digest === "object") {
              const sanitized = sanitizeDigest(d.digest)
              if (sanitized) t.digest = sanitized
            }
          }
        }
      }
    } catch {
      /* best-effort merge; still write our memory snapshot */
    }
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true, mode: 0o700 })
    atomicWriteJSON(this.indexPath, this.index)
  }

  /**
   * SEC-A: only safe ids may touch the filesystem. Reject path seps / `..` so
   * thread_id cannot escape threads/ (e.g. `../config` → config.json overwrite).
   * create() still uses sanitizeId (strip + regenerate); path ops fail closed.
   */
  static isSafeThreadId(threadId: string): boolean {
    return typeof threadId === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(threadId)
  }

  private assertSafeThreadId(threadId: string): string {
    if (!ThreadManager.isSafeThreadId(threadId)) {
      throw new Error(
        `Invalid thread id for filesystem path: ${String(threadId).slice(0, 48)}`,
      )
    }
    return threadId
  }

  private threadFilePath(threadId: string): string {
    const safeId = this.assertSafeThreadId(threadId)
    const threadsDir = path.resolve(getConfigDir(), "threads")
    const filePath = path.resolve(threadsDir, `${safeId}.json`)
    const rel = path.relative(threadsDir, filePath)
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Thread path escape rejected")
    }
    return filePath
  }

  private generateId(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    let id = ""
    for (let i = 0; i < 6; i++) {
      id += chars[Math.floor(Math.random() * chars.length)]
    }
    // Check uniqueness
    if (this.index.threads.some(t => t.id === id)) return this.generateId()
    return id
  }

  private sanitizeAlias(alias: string): string {
    if (typeof alias !== "string") return ""
    // Strip control characters and limit length
    return alias
      .replace(/[\x00-\x1F\x7F]/g, "")
      .slice(0, 200)
  }

  private sanitizeId(id: string): string {
    if (typeof id !== "string") return this.generateId()
    // Only allow alphanumeric, hyphen, underscore
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
    return sanitized || this.generateId()
  }

  create(alias: string, id?: string, configOverride?: Record<string, any>): Thread {
    // Validate alias (P0)
    const safeAlias = this.sanitizeAlias(alias)
    const safeId = id ? this.sanitizeId(id) : this.generateId()
    // Validate config_override if provided
    let safeConfigOverride: Record<string, any> = {}
    if (configOverride) {
      const validation = validateConfigOverride(configOverride)
      if (!validation.valid) {
        throw new Error(`Invalid config_override: ${validation.error}`)
      }
      safeConfigOverride = validation.sanitized
    }
    const now = monotonicTimestamp()
    const thread: Thread = {
      id: safeId,
      alias: safeAlias,
      created_at: now,
      updated_at: now,
      config_override: safeConfigOverride,
      tool_whitelist: null,
      pinned_tabs: [],
      active_skill_ids: ["browse"],
      active_knowledge_ids: [],
      skill_selection_mode: "auto",
      knowledge_selection_mode: "auto",
      mcp_selection_mode: "auto",
      active_mcp_server_ids: [],
      mission_board: null,
      board_mode: false,
    }

    this.index.threads.unshift(thread)
    this.saveIndex()

    // Create messages file
    atomicWriteJSON(this.threadFilePath(thread.id), { messages: [] })

    return thread
  }

  delete(threadId: string): void {
    // Still drop from index even if id is malicious (no FS if unsafe).
    this.index.threads = this.index.threads.filter(t => t.id !== threadId)
    this.saveIndex()
    if (!ThreadManager.isSafeThreadId(threadId)) return
    try { fs.unlinkSync(this.threadFilePath(threadId)) } catch { /* ignore */ }
    removeAttachmentsDir(threadId)
  }

  /** Soft-delete into recycle bin. Returns false if not found. */
  trash(threadId: string): Thread | undefined {
    const thread = this.index.threads.find((t) => t.id === threadId)
    if (!thread) return undefined
    if (thread.trashed_at) return thread
    thread.trashed_at = monotonicTimestamp()
    thread.updated_at = monotonicTimestamp()
    this.saveIndex()
    return thread
  }

  /** Restore from recycle bin. */
  restore(threadId: string): Thread | undefined {
    const thread = this.index.threads.find((t) => t.id === threadId)
    if (!thread) return undefined
    thread.trashed_at = null
    thread.updated_at = monotonicTimestamp()
    this.saveIndex()
    return thread
  }

  isTrashed(thread: Thread): boolean {
    return !!(thread.trashed_at && String(thread.trashed_at).length > 0)
  }

  /**
   * Hard-delete trashed threads older than maxAgeDays (default 30).
   * Lazy purge — call on list / open trash.
   * Perf: single index write for the whole batch (not saveIndex per id).
   */
  purgeExpiredTrash(maxAgeDays = 30, now: Date = new Date()): string[] {
    const cutoff = now.getTime() - maxAgeDays * 86400_000
    const expired = this.index.threads.filter((t) => {
      if (!this.isTrashed(t)) return false
      const ts = Date.parse(t.trashed_at || "")
      return !Number.isNaN(ts) && ts < cutoff
    })
    if (expired.length === 0) return []
    const ids = expired.map((t) => t.id)
    const idSet = new Set(ids)
    this.index.threads = this.index.threads.filter((t) => !idSet.has(t.id))
    this.saveIndex()
    for (const id of ids) {
      try {
        fs.unlinkSync(this.threadFilePath(id))
      } catch {
        /* ignore missing file */
      }
      removeAttachmentsDir(id)
    }
    return ids
  }

  cleanupEmpty(exceptId?: string): string[] {
    const emptyThreads = this.index.threads.filter(
      (t) =>
        !this.isTrashed(t) &&
        t.id !== exceptId &&
        this.getMessages(t.id).length === 0,
    )
    const deletedIds: string[] = []
    for (const thread of emptyThreads) {
      this.delete(thread.id)
      deletedIds.push(thread.id)
    }
    return deletedIds
  }

  list(opts?: { include_trashed?: boolean; only_trashed?: boolean }): Thread[] {
    const all = this.index.threads
    if (opts?.only_trashed) return all.filter((t) => this.isTrashed(t))
    if (opts?.include_trashed) return all
    return all.filter((t) => !this.isTrashed(t))
  }

  /**
   * First user message preview for ThreadList search/display (P0 IA).
   * Cheap: scan messages until first user role; truncate whitespace.
   */
  getFirstUserPreview(threadId: string, maxLen = 80): string {
    return firstUserPreviewFromMessages(this.getMessages(threadId), maxLen)
  }

  /** Last user message preview (for @ ref fallback). */
  getLastUserPreview(threadId: string, maxLen = 80): string {
    return lastUserPreviewFromMessages(this.getMessages(threadId), maxLen)
  }

  /**
   * Single-pass list enrichment: one getMessages() per thread for preview +
   * digest stale flag (avoids double file read on thread.list).
   */
  listWithPreviews(opts?: {
    include_trashed?: boolean
    only_trashed?: boolean
  }): Array<
    Thread & {
      first_user_preview: string
      last_user_preview?: string
      message_count: number
      user_message_count: number
      acp_list: import("./thread-inspect").AcpListMeta | null
    }
  > {
    return this.list(opts).map((t) => {
      const msgs = this.getMessages(t.id)
      const first_user_preview = firstUserPreviewFromMessages(msgs, 80)
      const last_user_preview = lastUserPreviewFromMessages(msgs, 80)
      const inspected = inspectThreadMessages(msgs)
      let digest = t.digest
      if (digest) {
        if (isDigestStale(digest, msgs)) {
          digest = { ...digest, stale: true } as ThreadDigest & { stale: boolean }
        }
      }
      return {
        ...t,
        digest,
        first_user_preview,
        last_user_preview,
        message_count: inspected.message_count,
        user_message_count: inspected.user_message_count,
        acp_list: inspected.acp_list,
      }
    })
  }

  /**
   * One getMessages for both first/last user previews (context_refs path).
   */
  getUserPreviewPair(
    threadId: string,
    maxLen = 120,
  ): { first: string; last: string; messages: Message[] } {
    const messages = this.getMessages(threadId)
    return {
      first: firstUserPreviewFromMessages(messages, maxLen),
      last: lastUserPreviewFromMessages(messages, maxLen),
      messages,
    }
  }

  get(threadId: string): Thread | undefined {
    const thread = this.index.threads.find(t => t.id === threadId)
    if (thread && !thread.skill_selection_mode) {
      thread.skill_selection_mode = "auto"
    }
    if (thread && !thread.knowledge_selection_mode) {
      thread.knowledge_selection_mode = "auto"
    }
    // ADR-016: legacy threads without board fields stay board-off
    if (thread && thread.mission_board === undefined) {
      thread.mission_board = null
    }
    if (thread && thread.board_mode === undefined) {
      thread.board_mode = false
    }
    // Dual nit: sanitize runtime_context_budget (incl. handoff) on read so
    // mid_loop retain / UI never trust hand-edited index junk.
    if (thread && thread.runtime_context_budget != null) {
      const sanitized = sanitizeRuntimeContextBudget(thread.runtime_context_budget)
      thread.runtime_context_budget = sanitized
    }
    if (thread && thread.run_progress != null) {
      thread.run_progress = sanitizeRunProgress(thread.run_progress)
    }
    if (thread && (!thread.run_progress || thread.run_progress.items.length === 0)) {
      const seeded = seedRunProgress(thread)
      if (seeded.items.length > 0) {
        thread.run_progress = seeded
        // Batch D D1: seed memory-only. saveIndex on get() let a second
        // ThreadManager snapshot clobber the live index.
      }
    }
    return thread
  }

  update(threadId: string, updates: Partial<Thread>): Thread | undefined {
    const thread = this.index.threads.find(t => t.id === threadId)
    if (!thread) return undefined
    // Validate config_override if being updated
    if (updates.config_override !== undefined) {
      const validation = validateConfigOverride(updates.config_override)
      if (!validation.valid) {
        throw new Error(`Invalid config_override: ${validation.error}`)
      }
      updates = { ...updates, config_override: validation.sanitized }
    }
    // Digest is optional rebuildable index metadata
    if (updates.digest !== undefined) {
      if (updates.digest === null) {
        // ok — clear
      } else {
        const sanitized = sanitizeDigest(updates.digest)
        if (!sanitized) {
          throw new Error("Invalid digest payload")
        }
        updates = { ...updates, digest: sanitized }
      }
    }
    // Runtime context budget (M1/M2) — separate from digest
    if (updates.runtime_context_budget !== undefined) {
      if (updates.runtime_context_budget === null) {
        // ok — clear
      } else {
        const sanitized = sanitizeRuntimeContextBudget(updates.runtime_context_budget)
        if (!sanitized) {
          throw new Error("Invalid runtime_context_budget payload")
        }
        updates = { ...updates, runtime_context_budget: sanitized }
      }
    }
    // L0 RunProgress — cap 8×120; model_draft done forced false
    if (updates.run_progress !== undefined) {
      if (updates.run_progress === null) {
        // ok — clear
      } else {
        updates = { ...updates, run_progress: sanitizeRunProgress(updates.run_progress) }
      }
    }
    if (updates.alias !== undefined) {
      updates = { ...updates, alias: this.sanitizeAlias(String(updates.alias)) }
    }
    if (updates.topic_folder !== undefined) {
      updates = { ...updates, topic_folder: sanitizeTopicFolder(updates.topic_folder) }
    }
    // Validate skill_selection_mode if being updated
    if (updates.skill_selection_mode !== undefined) {
      const validModes = ["auto", "all", "manual"]
      if (!validModes.includes(updates.skill_selection_mode)) {
        throw new Error(`Invalid skill_selection_mode: ${updates.skill_selection_mode}. Must be one of ${validModes.join(", ")}`)
      }
    }
    // Validate knowledge_selection_mode if being updated
    if (updates.knowledge_selection_mode !== undefined) {
      const validModes = ["auto", "all", "manual"]
      if (!validModes.includes(updates.knowledge_selection_mode)) {
        throw new Error(`Invalid knowledge_selection_mode: ${updates.knowledge_selection_mode}. Must be one of ${validModes.join(", ")}`)
      }
    }
    if (updates.active_knowledge_ids !== undefined) {
      if (
        !Array.isArray(updates.active_knowledge_ids) ||
        !updates.active_knowledge_ids.every((s: any) => typeof s === "string")
      ) {
        throw new Error("active_knowledge_ids must be an array of strings")
      }
    }
    // Audit item 7: validate mcp_selection_mode + active_mcp_server_ids shape
    if (updates.mcp_selection_mode !== undefined) {
      const validMcpModes = ["auto", "all", "manual"]
      if (!validMcpModes.includes(updates.mcp_selection_mode)) {
        throw new Error(`Invalid mcp_selection_mode: ${updates.mcp_selection_mode}. Must be one of ${validMcpModes.join(", ")}`)
      }
    }
    if (updates.active_mcp_server_ids !== undefined) {
      if (!Array.isArray(updates.active_mcp_server_ids) ||
          !updates.active_mcp_server_ids.every((id: any) => typeof id === "string")) {
        throw new Error("active_mcp_server_ids must be an array of strings")
      }
    }
    // ADR-016: workers must never host mission_board
    if (updates.mission_board !== undefined && updates.mission_board !== null) {
      const role = updates.agent_role ?? thread.agent_role
      if (role === "worker") {
        throw new Error("workers cannot host mission_board (ADR-016)")
      }
    }
    if (updates.board_mode !== undefined && typeof updates.board_mode !== "boolean") {
      throw new Error("board_mode must be a boolean")
    }
    Object.assign(thread, updates, { updated_at: monotonicTimestamp() })
    if (!thread.run_progress || thread.run_progress.items.length === 0) {
      const seeded = seedRunProgress(thread)
      if (seeded.items.length > 0) {
        thread.run_progress = seeded
      }
    }
    this.saveIndex()
    return thread
  }

  /**
   * Atomic Mission Pack apply/restore: validate then single index mutation.
   * On validation failure, thread is unchanged.
   */
  applyPackPatch(
    threadId: string,
    patch: {
      mission_pack_id: string | null
      mission_pack_snapshot: ThreadPackSnapshot | null
      tool_whitelist: string[] | null
      active_skill_ids: string[]
      active_knowledge_ids?: string[]
      skill_selection_mode?: "auto" | "all" | "manual"
      knowledge_selection_mode?: "auto" | "all" | "manual"
      mcp_selection_mode?: "auto" | "all" | "manual"
      active_mcp_server_ids?: string[]
      system_prompt_append: string | null
      workspace_root?: string | null
      /** ADR-016: pack board_mode enable (only set when pack declares it). */
      board_mode?: boolean
      /** Product B: global Trust snapshot for restore on unapply */
      mission_pack_trust_snapshot?: Record<string, unknown> | null
    },
  ): Thread {
    const thread = this.index.threads.find((t) => t.id === threadId)
    if (!thread) throw new Error(`Thread not found: ${threadId}`)

    if (!Array.isArray(patch.active_skill_ids) || !patch.active_skill_ids.every((s) => typeof s === "string")) {
      throw new Error("active_skill_ids must be an array of strings")
    }
    if (
      patch.active_knowledge_ids !== undefined &&
      (!Array.isArray(patch.active_knowledge_ids) ||
        !patch.active_knowledge_ids.every((s) => typeof s === "string"))
    ) {
      throw new Error("active_knowledge_ids must be an array of strings")
    }
    if (patch.tool_whitelist !== null) {
      if (!Array.isArray(patch.tool_whitelist) || !patch.tool_whitelist.every((s) => typeof s === "string")) {
        throw new Error("tool_whitelist must be null or string[]")
      }
    }
    const validModes = ["auto", "all", "manual"]
    if (patch.skill_selection_mode !== undefined && !validModes.includes(patch.skill_selection_mode)) {
      throw new Error(`Invalid skill_selection_mode: ${patch.skill_selection_mode}`)
    }
    if (patch.knowledge_selection_mode !== undefined && !validModes.includes(patch.knowledge_selection_mode)) {
      throw new Error(`Invalid knowledge_selection_mode: ${patch.knowledge_selection_mode}`)
    }
    if (patch.mcp_selection_mode !== undefined && !validModes.includes(patch.mcp_selection_mode)) {
      throw new Error(`Invalid mcp_selection_mode: ${patch.mcp_selection_mode}`)
    }
    if (
      patch.active_mcp_server_ids !== undefined &&
      (!Array.isArray(patch.active_mcp_server_ids) ||
        !patch.active_mcp_server_ids.every((id) => typeof id === "string"))
    ) {
      throw new Error("active_mcp_server_ids must be an array of strings")
    }

    const nextOverride = { ...(thread.config_override || {}) }
    if (patch.system_prompt_append === null) {
      delete nextOverride.system_prompt_append
    } else {
      nextOverride.system_prompt_append = patch.system_prompt_append
    }
    const validation = validateConfigOverride(nextOverride)
    if (!validation.valid) {
      throw new Error(`Invalid config_override: ${validation.error}`)
    }

    // Commit only after all validation succeeds
    thread.mission_pack_id = patch.mission_pack_id
    thread.mission_pack_snapshot = patch.mission_pack_snapshot
    thread.tool_whitelist = patch.tool_whitelist
    thread.active_skill_ids = [...patch.active_skill_ids]
    if (patch.active_knowledge_ids !== undefined) {
      thread.active_knowledge_ids = [...patch.active_knowledge_ids]
    }
    if (patch.skill_selection_mode !== undefined) thread.skill_selection_mode = patch.skill_selection_mode
    if (patch.knowledge_selection_mode !== undefined) {
      thread.knowledge_selection_mode = patch.knowledge_selection_mode
    }
    if (patch.mcp_selection_mode !== undefined) thread.mcp_selection_mode = patch.mcp_selection_mode
    if (patch.active_mcp_server_ids !== undefined) {
      thread.active_mcp_server_ids = [...patch.active_mcp_server_ids]
    }
    if (patch.workspace_root !== undefined) thread.workspace_root = patch.workspace_root
    // ADR-016: pack board_mode — only enable when pack declares true; uninstall clears via explicit false
    if (patch.board_mode !== undefined) {
      if (typeof patch.board_mode !== "boolean") {
        throw new Error("board_mode must be a boolean")
      }
      thread.board_mode = patch.board_mode
    }
    if (patch.mission_pack_trust_snapshot !== undefined) {
      thread.mission_pack_trust_snapshot = patch.mission_pack_trust_snapshot
    }
    if (patch.mission_pack_id === null) {
      thread.mission_pack_trust_snapshot = null
    }
    thread.config_override = validation.sanitized
    thread.updated_at = monotonicTimestamp()
    this.saveIndex()
    return thread
  }

  // --- Messages ---

  getMessages(threadId: string): Message[] {
    if (!ThreadManager.isSafeThreadId(threadId)) return []
    try {
      const raw = fs.readFileSync(this.threadFilePath(threadId), "utf-8")
      const data = JSON.parse(raw)
      return data.messages || []
    } catch {
      return []
    }
  }

  addMessage(threadId: string, message: Omit<Message, "id" | "created_at"> & { id?: string }): Message {
    return this.insertMessageAt(threadId, Number.MAX_SAFE_INTEGER, message)
  }

  /** Insert a message at `index` (clamped to [0, length]). addMessage is append. */
  insertMessageAt(
    threadId: string,
    index: number,
    message: Omit<Message, "id" | "created_at"> & { id?: string },
  ): Message {
    this.assertSafeThreadId(threadId)
    const requested = typeof message.id === "string" ? message.id : ""
    const id = /^[a-zA-Z0-9_-]{1,128}$/.test(requested)
      ? requested
      : `${threadId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const msg: Message = {
      ...message,
      id,
      created_at: monotonicTimestamp(),
    }
    if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
      msg.attachments = stampAttachments(msg.id, msg.attachments)
      if (msg.attachments.length === 0) delete msg.attachments
    } else {
      delete msg.attachments
    }

    const filePath = this.threadFilePath(threadId)
    let data: { messages: Message[] }
    try {
      const raw = fs.readFileSync(filePath, "utf-8")
      data = JSON.parse(raw)
    } catch {
      data = { messages: [] }
    }

    const at = Math.max(0, Math.min(index, data.messages.length))
    data.messages.splice(at, 0, msg)

    if (data.messages.length > MAX_MESSAGES_PER_THREAD) {
      const kept = trimMessagesTurnSafe(data.messages, MAX_MESSAGES_PER_THREAD)
      const dropped = data.messages.slice(0, data.messages.length - kept.length)
      deleteSidecarsForMessages(threadId, dropped)
      data.messages = kept
      if (!_capWarnedThreads.has(threadId)) {
        _capWarnedThreads.add(threadId)
        console.warn(`[Thread ${threadId}] Message cap reached, trimmed oldest messages`)
      }
    }

    atomicWriteJSON(filePath, data)

    const thread = this.index.threads.find(t => t.id === threadId)
    if (thread) {
      thread.updated_at = monotonicTimestamp()
      this.saveIndex()
    }

    return msg
  }

  updateMessage(threadId: string, messageId: string, updates: Partial<Message>): void {
    if (!ThreadManager.isSafeThreadId(threadId)) return
    const filePath = this.threadFilePath(threadId)
    try {
      const raw = fs.readFileSync(filePath, "utf-8")
      const data = JSON.parse(raw)
      const msg = data.messages.find((m: Message) => m.id === messageId)
      if (msg) Object.assign(msg, updates)
      atomicWriteJSON(filePath, data)
    } catch { /* ignore */ }
  }

  /**
   * Check if a tool is in the thread's whitelist.
   * Returns true if whitelist is null (no restriction) or tool is listed.
   * C6 multi-adv: workers re-enforce WORKER_HARD_DENY at runtime (not only spawn-time).
   */
  /**
   * @param opts.cruiseOpen — test override for three-flag cruise (default: live config).
   */
  isToolAllowed(
    threadId: string,
    toolName: string,
    opts?: { cruiseOpen?: boolean },
  ): boolean {
    const thread = this.get(threadId)
    if (!thread) return false
    // C6: worker hard-deny always applies, even if whitelist was elevated via thread.update
    if (thread.agent_role === "worker") {
      try {
        // Lazy require avoids circular import with orchestrator at module load
        const { WORKER_HARD_DENY } = require("../orchestrator/constants") as typeof import("../orchestrator/constants")
        if (WORKER_HARD_DENY.has(toolName)) return false
      } catch {
        /* if constants fail to load, fail closed for known host/shell names */
        if (
          toolName === "shell_exec" ||
          toolName === "netsec_port_scan" ||
          toolName === "host_computer" ||
          toolName === "host_write" ||
          toolName === "spawn_worker"
        ) {
          return false
        }
      }
      // Workers never get cruise-expanded surface (spawn whitelist + HARD_DENY stay).
    } else if (opts?.cruiseOpen ?? isFullAutonomyCruiseOpen()) {
      // Product: three-flag full-autonomy cruise expands tool surface for normal
      // threads immediately (scene tool_whitelist still stored, but does not block).
      // L2 skip is separate (same flags); users arm cruise expecting tools to work
      // on the *current* chat without recreating the thread.
      return true
    }
    if (thread.tool_whitelist === null) return true
    // P1 / D8 revise: pack tool_whitelist constrains MCP too.
    // Allow mcp tools only when whitelist includes:
    //   - exact tool name, or
    //   - "mcp__*" (all MCP), or
    //   - "mcp__<server>__*" for that server (plus known aliases, e.g. fs ↔ filesystem), or
    //   - meta tools listed explicitly
    if (
      toolName.startsWith("mcp__") ||
      toolName === "mcp_list_resources" ||
      toolName === "mcp_read_resource" ||
      toolName === "mcp_get_prompt"
    ) {
      return isMcpToolAllowedByWhitelist(thread.tool_whitelist, toolName)
    }
    return thread.tool_whitelist.includes(toolName)
  }

  /** Delete messages from a given message onwards (inclusive). */
  deleteMessagesFrom(threadId: string, messageId: string): boolean {
    if (!ThreadManager.isSafeThreadId(threadId)) return false
    const filePath = this.threadFilePath(threadId)
    try {
      const raw = fs.readFileSync(filePath, "utf-8")
      const data = JSON.parse(raw)
      const messages: Message[] = data.messages || []
      const idx = messages.findIndex(m => m.id === messageId)
      if (idx < 0) return false
      const removed = messages.slice(idx)
      deleteSidecarsForMessages(threadId, removed)
      data.messages = messages.slice(0, idx)
      atomicWriteJSON(filePath, data)
      return true
    } catch {
      return false
    }
  }

  /**
   * Hydrate helper (Task 6): load sidecar bytes from companion-chosen name
   * (`${msgId}-${n}.${ext}`). Never follows `att.rel` as a path.
   */
  readImageAttachment(threadId: string, att: ImageAttachmentMeta): Buffer | null {
    if (!ThreadManager.isSafeThreadId(threadId)) return null
    return readImageAttachmentBytes(threadId, att)
  }
}
