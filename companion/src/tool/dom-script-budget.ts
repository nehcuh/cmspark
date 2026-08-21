/**
 * Web act-loop W3′ — success-loop budget for DOM-script family.
 * SoT: docs/superpowers/specs/2026-08-21-web-act-loop-design.md §5.3
 *
 * Two counters, thread-scoped (survives chatCreate / 「继续」 in-process):
 *   A identical (family, exprHash, tabKey) success → cap 3
 *   B volume (family, origin) success → cap 24
 */

import { createHash } from "node:crypto"

export const DOM_SCRIPT_LOOP_MAX = 3
export const DOM_SCRIPT_VOLUME_MAX = 24

const INJECT_PAYLOAD = [
  "execute javascript",
  "chrome.automation",
  "runtime.evaluate",
  "document.queryselector",
  "el.click(",
  "chrome.debugger",
  "--remote-debugging-port",
  "osascript",
  "osacript",
  'tell application "google chrome"',
]

const LAUNCH_ALLOW = [/start-process\s+chrome/, /get-process\s+chrome/, /tasklist/]

export function isDomInjectShellCommand(cmd: string): boolean {
  const s = (cmd || "").toLowerCase()
  if (!s.trim()) return false
  if (LAUNCH_ALLOW.some((re) => re.test(s)) && !INJECT_PAYLOAD.some((p) => s.includes(p))) {
    return false
  }
  return INJECT_PAYLOAD.some((p) => s.includes(p))
}

export function isDomScriptTool(toolName: string, params: Record<string, unknown>): boolean {
  if (toolName === "evaluate" || toolName === "osascript_eval") return true
  if (toolName === "shell_exec") {
    const cmd = typeof params.command === "string" ? params.command : ""
    return isDomInjectShellCommand(cmd)
  }
  return false
}

/** Whitespace-collapse only (budget-lane nit: comments stay; volume cap bounds bypass). */
export function normalizeDomScriptSource(raw: string): string {
  return String(raw || "").replace(/\s+/g, " ").trim()
}

export function exprHashForDomScript(toolName: string, params: Record<string, unknown>): string {
  const raw =
    toolName === "evaluate"
      ? String(params.code || "")
      : toolName === "osascript_eval"
        ? String(params.expression || params.url || "")
        : String(params.command || "")
  return createHash("sha256").update(normalizeDomScriptSource(raw)).digest("hex").slice(0, 12)
}

/** Counter B key. Missing/unparseable URL → shared origin:unknown (fail-closed). */
export function originKeyFromUrl(url?: string | null): string {
  const s = String(url || "").trim()
  if (!s) return "origin:unknown"
  try {
    const u = new URL(s)
    if (!u.protocol || !u.host) return "origin:unknown"
    return `${u.protocol}//${u.host}`
  } catch {
    return "origin:unknown"
  }
}

export function resolveDomScriptBudgetMeta(
  toolName: string,
  params: Record<string, unknown>,
  tabUrl?: string | null,
): { key: string; origin: string } {
  const hash = exprHashForDomScript(toolName, params)
  const tab = tabKeyForDomScript(toolName, params)
  const url = typeof params.url === "string" && params.url.trim() ? params.url : tabUrl
  return { key: `${hash}|${tab}`, origin: originKeyFromUrl(url) }
}

export function cappedDomScriptResult(
  code: "DOM_SCRIPT_LOOP_CAPPED" | "DOM_SCRIPT_VOLUME_CAPPED",
): { success: false; error: string; data: { error_code: string; suggested_action: "stop_or_change_task" } } {
  return {
    success: false,
    error: `${code}: stop or change the task (DOM script family cap)`,
    data: { error_code: code, suggested_action: "stop_or_change_task" },
  }
}

export function tabKeyForDomScript(toolName: string, params: Record<string, unknown>): string {
  if (typeof params.tabId === "number" && Number.isFinite(params.tabId)) return `tab:${params.tabId}`
  if (typeof params.url === "string" && params.url.trim()) return `url:${params.url.trim()}`
  return "tab:unknown"
}

export type DomScriptBudgetState = {
  keys: Record<string, number>
  origins: Record<string, number>
}

const budgets = new Map<string, DomScriptBudgetState>()

export function resetDomScriptBudgetsForTests(): void {
  budgets.clear()
}

function stateFor(threadId: string): DomScriptBudgetState {
  let s = budgets.get(threadId)
  if (!s) {
    s = { keys: {}, origins: {} }
    budgets.set(threadId, s)
  }
  return s
}

export type DomScriptCap =
  | { capped: false }
  | { capped: true; error_code: "DOM_SCRIPT_LOOP_CAPPED" | "DOM_SCRIPT_VOLUME_CAPPED" }

/**
 * Record a completed success. The success itself is never refused here —
 * DoD 13/14: after 3 / 24 successes, the *next* call is peek-capped.
 */
export function recordDomScriptSuccess(
  threadId: string,
  key: string,
  origin: string,
): void {
  const s = stateFor(threadId)
  const k = `${key}`
  s.keys[k] = (s.keys[k] || 0) + 1
  const orig = origin || "origin:unknown"
  s.origins[orig] = (s.origins[orig] || 0) + 1
}

/** Peek without increment — used to refuse *before* execute when already capped. */
export function peekDomScriptCap(threadId: string, key: string, origin: string): DomScriptCap {
  const s = stateFor(threadId)
  if ((s.keys[key] || 0) >= DOM_SCRIPT_LOOP_MAX) {
    return { capped: true, error_code: "DOM_SCRIPT_LOOP_CAPPED" }
  }
  if ((s.origins[origin || "origin:unknown"] || 0) >= DOM_SCRIPT_VOLUME_MAX) {
    return { capped: true, error_code: "DOM_SCRIPT_VOLUME_CAPPED" }
  }
  return { capped: false }
}
