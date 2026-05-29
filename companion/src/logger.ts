// Lightweight JSONL logger with sensitive-field redaction

import * as fs from "fs"
import * as path from "path"
import { getConfigDir } from "./config"

export type LogLevel = "debug" | "info" | "warn" | "error"

let currentLevel: LogLevel = "info"

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const REDACTED = "[REDACTED]"
const MAX_STRING_LENGTH = 2000
const MAX_ARRAY_LENGTH = 50
const MAX_DEPTH = 6
const SENSITIVE_KEY_RE = /(api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|set-cookie|session|bearer)/i

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value
  return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`
}

export function redactLogData(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: value.stack ? truncateString(value.stack) : undefined,
    }
  }

  if (typeof value === "string") return truncateString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (typeof value !== "object") return String(value)

  if (depth >= MAX_DEPTH) return "[MaxDepth]"
  if (seen.has(value)) return "[Circular]"
  seen.add(value)

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_LENGTH).map(item => redactLogData(item, depth + 1, seen))
    if (value.length > MAX_ARRAY_LENGTH) items.push(`…[${value.length - MAX_ARRAY_LENGTH} more items]`)
    return items
  }

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_RE.test(key)
      ? REDACTED
      : redactLogData(item, depth + 1, seen)
  }
  return output
}

export function getLogFilePath(now = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  return path.join(getConfigDir(), "logs", `companion-${day}.log`)
}

export function logEvent(
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {},
  source = "companion",
  now = new Date(),
): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return
  try {
    const filePath = getLogFilePath(now)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const entry = {
      ts: now.toISOString(),
      level,
      source,
      event,
      data: redactLogData(data),
    }
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`)
  } catch (err: any) {
    // Logging must never break runtime behavior.
    console.error("[cmspark-agent] Failed to write log:", err?.message || String(err))
  }
}

export const logger = {
  log: logEvent,
  debug: (event: string, data?: Record<string, unknown>, source?: string) => logEvent("debug", event, data || {}, source),
  info: (event: string, data?: Record<string, unknown>, source?: string) => logEvent("info", event, data || {}, source),
  warn: (event: string, data?: Record<string, unknown>, source?: string) => logEvent("warn", event, data || {}, source),
  error: (event: string, data?: Record<string, unknown>, source?: string) => logEvent("error", event, data || {}, source),
}
