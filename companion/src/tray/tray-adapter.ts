// Unified Tray Adapter — abstracts Swift / systray2 / readline backends
//
// Every backend implements the same `UnifiedTray` interface so that
// `menu-bar-agent.ts` only talks to one contract regardless of platform.

import * as path from "path"
import * as fs from "fs"
import { getPlatform } from "../platform"
import { getSwiftTrayPath as resolveSwiftTrayPath } from "../paths"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrayBackend = "swift" | "systray2" | "readline"

export type TrayActionType =
  | "start" | "stop" | "restart"
  | "status" | "logs" | "chrome" | "settings"
  | "autostart" | "quit"
  | "quick-action" | "recent-thread"
  | "show-pairing"

export interface TrayMenuAction {
  type: TrayActionType
  payload?: Record<string, any>
}

export interface QuickActionItem {
  id: string
  title: string
  icon?: string
}

export interface RecentThreadItem {
  id: string
  title: string
  lastActivity?: string
}

export interface TrayConfig {
  wsPort: number
  wsHost: string
  pollIntervalMs: number
  statusFile: string
  configDir: string
}

export interface TrayDataProvider {
  getQuickActions(): QuickActionItem[] | Promise<QuickActionItem[]>
  getRecentThreads(): RecentThreadItem[] | Promise<RecentThreadItem[]>
}

// ---------------------------------------------------------------------------
// P0a Tray native confirmation — parallel channel to the WS Side Panel.
// ---------------------------------------------------------------------------

export interface TrayConfirmRequest {
  /** confirmationId from SecurityConfirmationManager — must echo back in response. */
  id: string
  toolName: string
  riskLevel: "low" | "medium" | "high" | "critical"
  /** Human-readable summary (from `fullPreview` / `code_preview`); user content. */
  summary: string
  /** Critical-API subset — drives "不可逆操作" badge. */
  criticalApis: string[]
  /** Milliseconds before auto-deny (mirrors SecurityConfirmationManager timeout). */
  timeoutMs: number
}

export interface TrayConfirmResponse {
  id: string
  approved: boolean
}

// ---------------------------------------------------------------------------
// Unified interface
// ---------------------------------------------------------------------------

export interface UnifiedTray {
  start(config: TrayConfig): Promise<void>
  updateStatus(status: "running" | "stopped" | "unknown", wsConnected: boolean, pid: number | null): void
  updateAutostart(enabled: boolean): void
  setQuickActions(actions: QuickActionItem[]): void
  setRecentThreads(threads: RecentThreadItem[]): void
  onAction(callback: (action: TrayMenuAction) => void): void
  setDataProvider(provider: TrayDataProvider): void
  /**
   * Pop up a native window showing the WS pairing secret (Swift backend). Non-Swift
   * backends no-op here — the launcher falls back to clipboard-copy + notification.
   * `paired` hints whether the extension has ever paired (drives the window copy). */
  showPairingWindow(secret: string, paired: boolean): void
  /**
   * P0a — Pop a native confirmation dialog (Swift backend only). Resolves when the
   * user clicks Allow/Deny, when the timeout expires, or when cancelConfirm() is
   * called for this id. Non-Swift backends reject (caller falls back to WS only).
   *
   * Why: Side Panel confirmation makes Chrome frontmost → target app loses
   * foreground → CGEvent click lands wrong. Tray is a separate process; clicking
   * Allow here does not change foreground. See `tcc_cdhash_vs_activate` memory +
   * `capability-token-round1-synthesis` §P0a.
   */
  showConfirmDialog(req: TrayConfirmRequest): Promise<TrayConfirmResponse>
  /** Notify tray that a confirmation was resolved via another channel (close dialog). */
  cancelConfirm(id: string): void
  stop(): Promise<void>
}

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

/** Path to the compiled Swift tray binary */
function getSwiftTrayPath(): string {
  return resolveSwiftTrayPath()
}

/** Check whether the Swift tray binary exists on disk */
export function isSwiftTrayAvailable(): boolean {
  const binPath = getSwiftTrayPath()
  return fs.existsSync(binPath)
}

/**
 * Detect the best tray backend for the current platform.
 *
 * Priority:
 *  1. macOS ARM64 + Swift binary → 'swift'
 *  2. macOS x86 / Windows (x64 + ARM64 via emulation) / Linux → 'systray2'
 *  3. Fallback → 'readline'
 */
export function detectTrayBackend(): TrayBackend {
  const platform = getPlatform()

  if (platform === "darwin" && process.arch === "arm64" && isSwiftTrayAvailable()) {
    return "swift"
  }

  // systray2 works on darwin-x86, win32 (x64 native + ARM64 via x86-64 emulation), linux-x64
  return "systray2"
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createTray(backend?: TrayBackend): Promise<UnifiedTray> {
  const detected = backend || detectTrayBackend()

  switch (detected) {
    case "swift": {
      const { SwiftTrayAdapter } = require("./swift-tray-bridge") as typeof import("./swift-tray-bridge")
      return new SwiftTrayAdapter()
    }
    case "systray2": {
      const { SysTray2Adapter } = require("./systray2-bridge") as typeof import("./systray2-bridge")
      return new SysTray2Adapter()
    }
    case "readline": {
      const { ReadlineTrayAdapter } = require("./readline-tray") as typeof import("./readline-tray")
      return new ReadlineTrayAdapter()
    }
  }
}
