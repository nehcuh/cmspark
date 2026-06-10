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
