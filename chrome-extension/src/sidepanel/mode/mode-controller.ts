// Pure ModeController — no React, no chrome APIs.
// Spec: docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md

import type { CapabilityLevel } from "../types"

/** Browser CDP/extension tools that elevate to L1 (not host_*). */
export const BROWSER_TOOL_NAMES: ReadonlySet<string> = new Set([
  "list_tabs",
  "create_tab",
  "close_tab",
  "navigate",
  "screenshot",
  "get_page_text",
  "get_page_html",
  "get_element_info",
  "click",
  "dblclick",
  "type",
  "fill_form",
  "scroll",
  "press_key",
  "hover",
  "select_option",
  "drag_and_drop",
  "wait_for",
  "evaluate",
  "get_cookies",
  "set_cookie",
  "delete_cookie",
  "list_all_cookies",
  "set_tab_url",
])

/** Desktop-class tools that elevate to L2 via confirm queue even without live task. */
export const COMPUTER_CLASS_TOOLS: ReadonlySet<string> = new Set([
  "host_computer",
  "host_app",
  "host_read",
  "host_write",
])

export const DEFAULT_QUIESCENCE_MS = 30_000

export type ComputerTaskStatusInput = "running" | "paused" | "finished" | null

export interface ModeInput {
  now: number
  computerTaskStatus: ComputerTaskStatusInput
  /** When status is finished, keep L2 until now - finishedAt <= quiescenceMs (D15 stub). */
  computerTaskFinishedAt: number | null
  pendingConfirmToolNames: string[]
  lastBrowserToolAt: number | null
  quiescenceMs: number
  /** User pin: blocks auto-down only (never blocks up). */
  modePin: CapabilityLevel | null
}

export function isBrowserTool(name: string): boolean {
  return BROWSER_TOOL_NAMES.has(name)
}

export function isComputerClassTool(name: string): boolean {
  return COMPUTER_CLASS_TOOLS.has(name)
}

/**
 * Highest-wins derivation.
 * L2: active computer task (running|paused) OR computer-class confirm pending
 * L1: last browser tool within quiescence window
 * L0: else
 * Pin: max(derived, pin) with level order chat < browser < computer
 */
export function deriveCapabilityLevel(input: ModeInput): CapabilityLevel {
  const order: Record<CapabilityLevel, number> = {
    chat: 0,
    browser: 1,
    computer: 2,
  }

  let derived: CapabilityLevel = "chat"

  const taskActive =
    input.computerTaskStatus === "running" ||
    input.computerTaskStatus === "paused"
  const taskFinishedInWindow =
    input.computerTaskStatus === "finished" &&
    input.computerTaskFinishedAt != null &&
    input.now - input.computerTaskFinishedAt <= input.quiescenceMs
  const pendingNames = Array.isArray(input.pendingConfirmToolNames)
    ? input.pendingConfirmToolNames
    : []
  const confirmComputer = pendingNames.some((n) => isComputerClassTool(n))
  const confirmBrowser = pendingNames.some((n) => isBrowserTool(n))

  if (taskActive || taskFinishedInWindow || confirmComputer) {
    derived = "computer"
  } else if (
    confirmBrowser ||
    (input.lastBrowserToolAt != null &&
      input.now - input.lastBrowserToolAt <= input.quiescenceMs)
  ) {
    derived = "browser"
  }

  if (input.modePin) {
    if (order[input.modePin] > order[derived]) {
      return input.modePin
    }
  }

  return derived
}

export type ContextBarTabId =
  | "tabs"
  | "history"
  | "skills"
  | "knowledge"
  | "packs"
  | "board"
  | "mcp"
  | "apps"

/** Mode-split context bar (spec D5 / P0). */
export function contextBarTabsForLevel(
  level: CapabilityLevel,
): ContextBarTabId[] {
  switch (level) {
    case "chat":
      return ["skills", "knowledge", "packs", "board", "history"]
    case "browser":
      return ["tabs", "skills", "packs", "board"]
    case "computer":
      return ["tabs", "apps", "mcp", "board"]
  }
}

export function levelBadgeLabel(
  level: CapabilityLevel,
  opts?: { live?: boolean },
): string {
  switch (level) {
    case "chat":
      return "聊"
    case "browser":
      return "网页"
    case "computer":
      return opts?.live ? "计算机 · LIVE" : "计算机"
  }
}

export function levelEscalateToast(level: CapabilityLevel): string | null {
  switch (level) {
    case "browser":
      return "已升级至网页 Agent — 可操作浏览器标签页"
    case "computer":
      return "已升级至 Computer Use — 桌面操控进行中"
    default:
      return null
  }
}
