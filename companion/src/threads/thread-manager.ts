// Thread manager — CRUD for conversation threads

import * as fs from "fs"
import * as path from "path"
import { getConfigDir } from "../config"

interface Thread {
  id: string
  alias: string
  created_at: string
  updated_at: string
  config_override: Record<string, any>
  tool_whitelist: string[] | null
  pinned_tabs: number[]
  active_skill_ids: string[]
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
}

const MAX_CONFIG_STRING_LENGTH = 2000
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
      if (val.length > MAX_CONFIG_STRING_LENGTH) {
        return { valid: false, error: `Config key ${key} exceeds max length`, sanitized: {} }
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

export class ThreadManager {
  private index: ThreadIndex
  private indexPath: string

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
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2))
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
    const now = new Date().toISOString()
    const thread: Thread = {
      id: safeId,
      alias: safeAlias,
      created_at: now,
      updated_at: now,
      config_override: safeConfigOverride,
      tool_whitelist: null,
      pinned_tabs: [],
      active_skill_ids: ["browse"],
    }

    this.index.threads.unshift(thread)
    this.saveIndex()

    // Create messages file
    fs.writeFileSync(this.threadFilePath(thread.id), JSON.stringify({ messages: [] }, null, 2))

    return thread
  }

  delete(threadId: string): void {
    this.index.threads = this.index.threads.filter(t => t.id !== threadId)
    this.saveIndex()
    try { fs.unlinkSync(this.threadFilePath(threadId)) } catch { /* ignore */ }
  }

  list(): Thread[] {
    return this.index.threads
  }

  get(threadId: string): Thread | undefined {
    return this.index.threads.find(t => t.id === threadId)
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
    Object.assign(thread, updates, { updated_at: new Date().toISOString() })
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
      created_at: new Date().toISOString(),
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
    if (data.messages.length > MAX_MESSAGES_PER_THREAD + 100) {
      data.messages = data.messages.slice(-MAX_MESSAGES_PER_THREAD)
      console.warn(`[Thread ${threadId}] Message cap reached, trimmed oldest messages`)
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))

    // Update thread timestamp
    const thread = this.index.threads.find(t => t.id === threadId)
    if (thread) {
      thread.updated_at = new Date().toISOString()
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
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    } catch { /* ignore */ }
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
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
      return true
    } catch {
      return false
    }
  }
}
