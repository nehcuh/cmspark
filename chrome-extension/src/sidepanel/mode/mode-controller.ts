// Pure ModeController — no React, no chrome APIs.
// Spec: docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md
// C11: tool class tables derived from SURFACE_BY_TOOL (surface-by-tool.ts).

import type { CapabilityLevel } from "../types"
import { toolsAtSurface } from "./surface-by-tool"

/** Browser CDP/extension tools that elevate to L1 (not host_*). */
export const BROWSER_TOOL_NAMES: ReadonlySet<string> = toolsAtSurface("L1")

/** Desktop-class tools that elevate to L2 via confirm queue even without live task. */
export const COMPUTER_CLASS_TOOLS: ReadonlySet<string> = toolsAtSurface("L2")

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
  | "meeting"
  | "board"
  | "mcp"
  | "apps"

/**
 * Mode-split context bar tab sets (spec D5 / §4 / P0 IA cut 2026-07-27).
 * L0 Skills·Know·Hist · L1 Tabs·Skills · L2 Panel empty (Cockpit owns Tabs·Apps·MCP).
 * packs/board/mcp/apps demoted from permanent chrome.
 * #321 PR-1: the legacy permanent BottomBar strip is deleted (was PR5-gated off);
 * these helpers still document demotion order and drive Host overflow grouping.
 */
export function contextBarTabsForLevel(
  level: CapabilityLevel,
): ContextBarTabId[] {
  switch (level) {
    case "chat":
      return ["skills", "knowledge", "history"]
    case "browser":
      return ["tabs", "skills"]
    case "computer":
      return []
  }
}

/** Secondary panels (legacy BottomBar overflow set; not permanent tabs). */
export function contextBarOverflowTabsForLevel(
  level: CapabilityLevel,
): ContextBarTabId[] {
  const primary = new Set(contextBarTabsForLevel(level))
  // Prefer product-useful demotions; keep stable order
  const candidates: ContextBarTabId[] = [
    "packs",
    "meeting",
    "board",
    "knowledge",
    "history",
    "tabs",
    "skills",
    "mcp",
    "apps",
  ]
  return candidates.filter((id) => !primary.has(id))
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
