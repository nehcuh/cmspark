// Thread manager — CRUD for conversation threads

import * as fs from "fs"
import * as path from "path"
import { getConfigDir } from "../config"
import { atomicWriteJSON } from "../io"
import type { MissionBoard } from "../board/schema"

interface ThreadPackSnapshot {
  tool_whitelist: string[] | null
  active_skill_ids: string[]
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
  created_at: string
}

const MAX_MESSAGES_PER_THREAD = 1000

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

  private saveIndex(): void {
    atomicWriteJSON(this.indexPath, this.index)
  }

  private threadFilePath(threadId: string): string {
    return path.join(getConfigDir(), "threads", `${threadId}.json`)
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
    this.index.threads = this.index.threads.filter(t => t.id !== threadId)
    this.saveIndex()
    try { fs.unlinkSync(this.threadFilePath(threadId)) } catch { /* ignore */ }
  }

  cleanupEmpty(): string[] {
    const emptyThreads = this.index.threads.filter(t => this.getMessages(t.id).length === 0)
    const deletedIds: string[] = []
    for (const thread of emptyThreads) {
      this.delete(thread.id)
      deletedIds.push(thread.id)
    }
    return deletedIds
  }

  list(): Thread[] {
    return this.index.threads
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
      skill_selection_mode?: "auto" | "all" | "manual"
      knowledge_selection_mode?: "auto" | "all" | "manual"
      mcp_selection_mode?: "auto" | "all" | "manual"
      active_mcp_server_ids?: string[]
      system_prompt_append: string | null
      workspace_root?: string | null
      /** ADR-016: pack board_mode enable (only set when pack declares it). */
      board_mode?: boolean
    },
  ): Thread {
    const thread = this.index.threads.find((t) => t.id === threadId)
    if (!thread) throw new Error(`Thread not found: ${threadId}`)

    if (!Array.isArray(patch.active_skill_ids) || !patch.active_skill_ids.every((s) => typeof s === "string")) {
      throw new Error("active_skill_ids must be an array of strings")
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
    thread.config_override = validation.sanitized
    thread.updated_at = monotonicTimestamp()
    this.saveIndex()
    return thread
  }

  // --- Messages ---

  getMessages(threadId: string): Message[] {
    try {
      const raw = fs.readFileSync(this.threadFilePath(threadId), "utf-8")
      const data = JSON.parse(raw)
      return data.messages || []
    } catch {
      return []
    }
  }

  addMessage(threadId: string, message: Omit<Message, "id" | "created_at">): Message {
    const msg: Message = {
      ...message,
      id: `${threadId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      created_at: monotonicTimestamp(),
    }

    const filePath = this.threadFilePath(threadId)
    let data: { messages: Message[] }
    try {
      const raw = fs.readFileSync(filePath, "utf-8")
      data = JSON.parse(raw)
    } catch {
      data = { messages: [] }
    }

    data.messages.push(msg)

    // Soft cap enforcement
    if (data.messages.length > MAX_MESSAGES_PER_THREAD) {
      data.messages = data.messages.slice(-MAX_MESSAGES_PER_THREAD)
      if (!_capWarnedThreads.has(threadId)) {
        _capWarnedThreads.add(threadId)
        console.warn(`[Thread ${threadId}] Message cap reached, trimmed oldest messages`)
      }
    }

    atomicWriteJSON(filePath, data)

    // Update thread timestamp
    const thread = this.index.threads.find(t => t.id === threadId)
    if (thread) {
      thread.updated_at = monotonicTimestamp()
      this.saveIndex()
    }

    return msg
  }

  updateMessage(threadId: string, messageId: string, updates: Partial<Message>): void {
    const filePath = this.threadFilePath(threadId)
    try {
      const raw = fs.readFileSync(filePath, "utf-8")
      const data = JSON.parse(raw)
      const msg = data.messages.find((m: Message) => m.id === messageId)
      if (msg) Object.assign(msg, updates)
      atomicWriteJSON(filePath, data)
    } catch { /* ignore */ }
  }

  /** Check if a tool is in the thread's whitelist. Returns true if whitelist is null (no restriction) or tool is listed. */
  isToolAllowed(threadId: string, toolName: string): boolean {
    const thread = this.get(threadId)
    if (!thread) return false
    if (thread.tool_whitelist === null) return true
    return thread.tool_whitelist.includes(toolName)
  }

  /** Delete messages from a given message onwards (inclusive). */
  deleteMessagesFrom(threadId: string, messageId: string): boolean {
    const filePath = this.threadFilePath(threadId)
    try {
      const raw = fs.readFileSync(filePath, "utf-8")
      const data = JSON.parse(raw)
      const messages: Message[] = data.messages || []
      const idx = messages.findIndex(m => m.id === messageId)
      if (idx < 0) return false
      data.messages = messages.slice(0, idx)
      atomicWriteJSON(filePath, data)
      return true
    } catch {
      return false
    }
  }
}
