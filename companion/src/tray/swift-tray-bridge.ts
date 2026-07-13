// Swift Tray Bridge — manages the native macOS NSStatusBar subprocess
//
// Spawns `dist/cmspark-tray` (compiled from Tray.swift) and communicates
// via line-delimited JSON on stdin/stdout.

import * as readline from "readline"
import * as child_process from "child_process"
import * as path from "path"
import * as fs from "fs"
import * as crypto from "crypto"

import {
  UnifiedTray,
  TrayConfig,
  TrayMenuAction,
  TrayActionType,
  TrayDataProvider,
  QuickActionItem,
  RecentThreadItem,
} from "./tray-adapter"

// ---------------------------------------------------------------------------
// Binary management
// ---------------------------------------------------------------------------

/** Expected SHA256 of the Swift tray binary (update via build-tray.sh) */
const SWIFT_TRAY_SHA256 = "10a586ea861746f756bcf04a9520cfe3484981d8be0b616ae6189d65fba56c6d"

function getSwiftTrayBinPath(): string {
  const { getSwiftTrayPath } = require("../paths")
  return getSwiftTrayPath()
}

function getBuildScriptPath(): string {
  const { getTrayBuildScript } = require("../paths")
  return getTrayBuildScript()
}

function verifyIntegrity(binPath: string): boolean {
  try {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(binPath)).digest("hex")
    return hash === SWIFT_TRAY_SHA256
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// SwiftTrayAdapter
// ---------------------------------------------------------------------------

export class SwiftTrayAdapter implements UnifiedTray {
  private proc: child_process.ChildProcess | null = null
  private reader: readline.Interface | null = null
  private actionCallback: ((action: TrayMenuAction) => void) | null = null
  private dataProvider: TrayDataProvider | null = null
  private restartCount = 0
  private maxRestarts = 3
  private shuttingDown = false
  private config: TrayConfig | null = null

  // Cached state for auto-restart
  private lastStatus: { status: string; wsConnected: boolean; pid: number | null } = {
    status: "unknown", wsConnected: false, pid: null,
  }
  private lastAutostart = false
  private lastQuickActions: QuickActionItem[] = []
  private lastThreads: RecentThreadItem[] = []

  // --- UnifiedTray ---

  async start(config: TrayConfig): Promise<void> {
    this.config = config
    const binPath = getSwiftTrayBinPath()

    // Auto-compile if binary is missing
    if (!fs.existsSync(binPath)) {
      await this.build()
    }

    if (!fs.existsSync(binPath)) {
      throw new Error(`Swift tray binary not found: ${binPath}`)
    }

    if (!verifyIntegrity(binPath)) {
      console.warn("[swift-tray] Binary hash mismatch — attempting rebuild")
      await this.build()
      if (!verifyIntegrity(binPath)) {
        throw new Error("Swift tray binary integrity check failed after rebuild")
      }
    }

    await this.spawn(binPath)
  }

  updateStatus(status: "running" | "stopped" | "unknown", wsConnected: boolean, pid: number | null): void {
    this.lastStatus = { status, wsConnected, pid }
    this.send({ cmd: "update", status, wsConnected, pid })
  }

  updateAutostart(enabled: boolean): void {
    this.lastAutostart = enabled
    this.send({ cmd: "update-autostart", enabled })
  }

  setQuickActions(actions: QuickActionItem[]): void {
    this.lastQuickActions = actions
    this.send({
      cmd: "update-quick-actions",
      actions: actions.map(a => ({ id: a.id, title: a.title })),
    })
  }

  setRecentThreads(threads: RecentThreadItem[]): void {
    this.lastThreads = threads
    this.send({
      cmd: "update-recent-threads",
      threads: threads.map(t => ({ id: t.id, title: t.title })),
    })
  }

  onAction(callback: (action: TrayMenuAction) => void): void {
    this.actionCallback = callback
  }

  setDataProvider(provider: TrayDataProvider): void {
    this.dataProvider = provider
  }

  showPairingWindow(secret: string, paired: boolean): void {
    // The secret travels only over this stdin pipe to the Swift binary; it is NEVER
    // logged. Tray.swift renders it in a native selectable window on receipt.
    this.send({ cmd: "show-pairing-window", secret, paired })
  }

  async stop(): Promise<void> {
    this.shuttingDown = true
    this.kill()
  }

  // --- Internals ---

  private async spawn(binPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let ready = false

      const proc = child_process.spawn(binPath, [], {
        stdio: ["pipe", "pipe", "pipe"],
      })
      this.proc = proc

      this.reader = readline.createInterface({
        input: proc.stdout!,
        crlfDelay: Infinity,
      })

      this.reader.on("line", (line) => {
        let event: any
        try {
          event = JSON.parse(line)
        } catch {
          return
        }

        if (event.type === "ready" && !ready) {
          ready = true
          console.log("[swift-tray] Ready")
          resolve()
          return
        }

        if (event.type === "click") {
          this.handleClick(event)
        }

        if (event.type === "exit") {
          if (!ready) {
            reject(new Error(`Swift tray exited during startup (code: ${event.code})`))
          } else if (!this.shuttingDown) {
            this.handleCrash()
          }
        }
      })

      proc.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) console.error("[swift-tray] stderr:", msg)
      })

      proc.on("error", (err) => {
        if (!ready) reject(err)
        else console.error("[swift-tray] Process error:", err)
      })

      proc.on("exit", (code) => {
        if (!ready) {
          reject(new Error(`Swift tray exited prematurely (code: ${code})`))
        } else if (!this.shuttingDown) {
          this.handleCrash()
        }
      })
    })
  }

  private handleClick(event: any): void {
    if (!this.actionCallback) return

    const action = event.action as string
    if (!action) return

    if (action === "quick-action" || action === "recent-thread") {
      this.actionCallback({ type: action as TrayActionType, payload: { id: event.id } })
    } else {
      this.actionCallback({ type: action as TrayActionType })
    }
  }

  private handleCrash(): void {
    if (this.shuttingDown) return

    if (this.restartCount < this.maxRestarts) {
      this.restartCount++
      console.warn(`[swift-tray] Process crashed — restarting (attempt ${this.restartCount}/${this.maxRestarts})`)

      const binPath = getSwiftTrayBinPath()
      this.spawn(binPath).then(() => {
        // Re-apply cached state after restart
        this.updateStatus(this.lastStatus.status as "running" | "stopped" | "unknown", this.lastStatus.wsConnected, this.lastStatus.pid)
        this.updateAutostart(this.lastAutostart)
        if (this.lastQuickActions.length) this.setQuickActions(this.lastQuickActions)
        if (this.lastThreads.length) this.setRecentThreads(this.lastThreads)
      }).catch((err) => {
        console.error(`[swift-tray] Restart failed: ${err.message}`)
        process.exit(1)
      })
    } else {
      console.error(`[swift-tray] Exceeded max restarts (${this.maxRestarts}) — exiting`)
      process.exit(1)
    }
  }

  private send(obj: Record<string, any>): void {
    if (!this.proc?.stdin?.writable) return
    try {
      this.proc.stdin.write(`${JSON.stringify(obj)}\n`)
    } catch {
      // EPIPE if process already exited
    }
  }

  private kill(): void {
    const proc = this.proc
    this.proc = null

    if (this.reader) {
      this.reader.close()
      this.reader = null
    }

    if (!proc) return

    // Graceful quit via protocol
    if (proc.stdin?.writable) {
      try { proc.stdin.write(`${JSON.stringify({ cmd: "quit" })}\n`) } catch { /* ignore */ }
    }

    if (!proc.killed) {
      proc.kill("SIGTERM")
      setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL") }, 2000)
    }
  }

  private async build(): Promise<void> {
    const script = getBuildScriptPath()
    if (!fs.existsSync(script)) {
      throw new Error(`Build script not found: ${script}`)
    }

    return new Promise((resolve, reject) => {
      const child = child_process.spawn("bash", [script], {
        cwd: (() => { const { getTrayCwd } = require("../paths"); return getTrayCwd() })(),
        stdio: "inherit",
      })
      child.on("exit", (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Swift tray build failed (exit code: ${code})`))
      })
      child.on("error", reject)
    })
  }
}
