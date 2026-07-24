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
  TrayConfirmRequest,
  TrayConfirmResponse,
} from "./tray-adapter"

// ---------------------------------------------------------------------------
// Binary management
// ---------------------------------------------------------------------------

/** Expected SHA256 of the Swift tray binary (update via build-tray.sh) */
const SWIFT_TRAY_SHA256 = "ab183edff34ae211e569a871284fd32d1f389541b038317cba6b78238e499030"

function getSwiftTrayBinPath(): string {
  const { getSwiftTrayPath } = require("../paths")
  return getSwiftTrayPath()
}

function getBuildScriptPath(): string {
  const { getTrayBuildScript } = require("../paths")
  return getTrayBuildScript()
}

/**
 * S-P0-2 (2026-07-24 diagnosis): TOCTOU hardening.
 *
 * Old: `readFileSync` then `spawn` — race window between hash and exec.
 * Attacker who can substitute `dist/cmspark-tray` between these two calls
 * gains the privileged `respond()` path (bypasses originWs on
 * SecurityConfirmationManager) — malicious tray self-approves any L2.
 *
 * New: open fd once, hash from the fd, fstat to capture inode+device,
 * spawn via realpath, then post-spawn re-fstat. If inode/dev changed
 * between pre- and post-spawn, the file was substituted during the race
 * window — kill the proc immediately and refuse to use it.
 *
 * Auto-rebuild is now ONLY for "binary missing" — hash mismatch is treated
 * as suspicious (refuse, log, require manual intervention) per Grok review
 * amendment: never auto-rebuild on integrity failure.
 */
interface IntegrityCheck {
  ok: boolean
  inode: number
  dev: number
  realpath: string
}

/**
 * Exported for unit testing (A5 — Grok round 2). Production callers should
 * go through `SwiftTrayAdapter.start()` which orchestrates checkIntegrity +
 * spawn + post-spawn re-stat.
 */
export function checkIntegrity(binPath: string): IntegrityCheck {
  let fd: number | null = null
  try {
    const realpath = fs.realpathSync(binPath)
    fd = fs.openSync(realpath, "r")
    const stat = fs.fstatSync(fd)
    const hash = crypto.createHash("sha256")
    const BUF = Buffer.alloc(64 * 1024)
    while (true) {
      const n = fs.readSync(fd, BUF, 0, BUF.length, null)
      if (n === 0) break
      hash.update(BUF.slice(0, n))
    }
    const digest = hash.digest("hex")
    return {
      ok: digest === SWIFT_TRAY_SHA256,
      inode: stat.ino,
      dev: stat.dev,
      realpath,
    }
  } catch {
    return { ok: false, inode: -1, dev: -1, realpath: "" }
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch { /* ignore */ }
    }
  }
}

/** Exported for unit testing (A5 — Grok round 2). */
export function getExpectedHash(): string {
  return SWIFT_TRAY_SHA256
}

function statInodeDev(p: string): { inode: number; dev: number } | null {
  try {
    const s = fs.statSync(p)
    return { inode: s.ino, dev: s.dev }
  } catch {
    return null
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
  /**
   * Pending tray confirmations keyed by id. Each entry holds the resolve callback
   * + a timeout. Companion's SecurityConfirmationManager has its own timeout; if
   * Swift responds first we resolve, if manager times out first we cancelConfirm
   * (which sends `cancel-confirm` to Swift so it closes the dialog silently).
   */
  private pendingConfirms = new Map<string, {
    resolve: (r: TrayConfirmResponse) => void
    timer: NodeJS.Timeout
  }>()

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

    // Auto-compile ONLY when the binary is missing (benign dev case).
    // Hash mismatch is NOT auto-rebuilt — that's a suspicious signal and
    // must be surfaced to the operator (Grok amendment A4 on S-P0-2).
    if (!fs.existsSync(binPath)) {
      await this.build()
    }

    if (!fs.existsSync(binPath)) {
      throw new Error(`Swift tray binary not found: ${binPath}`)
    }

    const pre = checkIntegrity(binPath)
    if (!pre.ok) {
      // S-P0-2: do NOT auto-rebuild. Hash mismatch may indicate tampering;
      // rebuilding silently would replace the evidence and re-open the hole.
      throw new Error(
        `[swift-tray] Binary integrity check FAILED — refusing to spawn. ` +
        `Expected SHA256 ${SWIFT_TRAY_SHA256.slice(0, 16)}…, got mismatched binary at ${binPath}. ` +
        `If you just rebuilt the binary, update SWIFT_TRAY_SHA256 in swift-tray-bridge.ts. ` +
        `If not, treat the binary as compromised.`,
      )
    }

    await this.spawn(pre.realpath)

    // Post-spawn inode check: narrows TOCTOU window to microseconds.
    // If inode/dev changed between pre- and post-spawn, the file was
    // substituted during the race — kill the proc and refuse to use it.
    const post = statInodeDev(pre.realpath)
    if (!post || post.inode !== pre.inode || post.dev !== pre.dev) {
      console.error("[swift-tray] Binary substituted between hash check and spawn — killing process")
      this.kill()
      throw new Error("Swift tray binary TOCTOU detected: inode changed during spawn")
    }
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

  showConfirmDialog(req: TrayConfirmRequest): Promise<TrayConfirmResponse> {
    return new Promise<TrayConfirmResponse>((resolve) => {
      // Self-timeout as a safety net — companion's SecurityConfirmationManager
      // ALSO has a timeout and normally calls cancelConfirm first. If for some
      // reason it doesn't (bug, race), the Swift binary's own timeout + this
      // backstop ensure we don't leak the pending entry.
      const timer = setTimeout(() => {
        if (this.pendingConfirms.delete(req.id)) {
          resolve({ id: req.id, approved: false })
        }
      }, req.timeoutMs + 1000)

      // Track pending so confirm-response from Swift can resolve it.
      this.pendingConfirms.set(req.id, { resolve, timer })

      this.send({
        cmd: "show-confirm",
        id: req.id,
        tool_name: req.toolName,
        risk_level: req.riskLevel,
        summary: req.summary,
        critical_apis: req.criticalApis,
        timeout_ms: req.timeoutMs,
      })
    })
  }

  cancelConfirm(id: string): void {
    const entry = this.pendingConfirms.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pendingConfirms.delete(id)
    // C-P0-7 / Grok C5: resolve the promise with approved=false so any future
    // `await trayPromise` after cancel doesn't hang. The race in server.ts
    // already picked a winner (WS-side), so this resolution is observed only
    // by code that awaits trayPromise directly — currently nothing, but
    // defensive against future regressions.
    entry.resolve({ id, approved: false })
    // Notify Swift to close its dialog without emitting a response — companion
    // already has the answer from another channel (Side Panel approve / timeout).
    this.send({ cmd: "cancel-confirm", id })
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

        if (event.type === "confirm-response") {
          // Swift emitted Allow/Deny/timeout. Resolve the matching pending entry.
          const id = typeof event.id === "string" ? event.id : ""
          const approved = event.approved === true
          const entry = id ? this.pendingConfirms.get(id) : undefined
          if (id && entry) {
            clearTimeout(entry.timer)
            this.pendingConfirms.delete(id)
            entry.resolve({ id, approved })
          }
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

      // EPIPE / stream errors on stdin/stdout fire ASYNC and would crash the
      // process via uncaughtException if not listened to. The 'exit' handler
      // below already deals with dead Swift tray; these handlers just prevent
      // the stream-error from killing the companion. (W9 tray-launch bugfix.)
      proc.stdin?.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EPIPE") return  // expected when Swift tray exits first
        console.error("[swift-tray] stdin error:", err.message)
      })
      proc.stdout?.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EPIPE") return
        console.error("[swift-tray] stdout error:", err.message)
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

      // S-P0-2: re-verify integrity before respawn. A crashed tray should
      // not auto-respawn a tampered binary; refuse and require operator action.
      const binPath = getSwiftTrayBinPath()
      const recheck = checkIntegrity(binPath)
      if (!recheck.ok) {
        console.error("[swift-tray] Binary integrity check failed on restart — refusing to respawn tampered binary")
        process.exit(1)
        return
      }
      this.spawn(recheck.realpath).then(() => {
        // Post-spawn TOCTOU check
        const post = statInodeDev(recheck.realpath)
        if (!post || post.inode !== recheck.inode || post.dev !== recheck.dev) {
          console.error("[swift-tray] Binary TOCTOU on restart — killing")
          this.kill()
          process.exit(1)
          return
        }
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
    // proc.stdin.destroyed means the Swift tray process exited; the 'exit'
    // handler in spawn() will trigger restart. Skip the write to avoid
    // spurious EPIPE noise between exit-detected and restart.
    if (this.proc.stdin.destroyed) return
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
