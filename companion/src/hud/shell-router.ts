/**
 * HudShellRouter — per-thread active wide shell + N3 health numbers (P3a spike).
 *
 * N2: at most one wide shell per thread; on switch, send shell.standby to the prior shell.
 * N3: heartbeat stale > 3s; ping→pong within 400ms (full production selector deferred).
 *
 * Upstream: docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md
 * Protocol: ./protocol.ts
 */

import { encodeHudPing, encodeShellStandby } from "./protocol"

/** N3 lock: last hud.heartbeat must be ≤ this age */
export const HUD_HEARTBEAT_STALE_MS = 3000

/** N3 lock: hud.ping → hud.pong must complete within this budget */
export const HUD_PING_TIMEOUT_MS = 400

export type WideShell = "hud" | "cockpit"

export type HudShellRouterSinks = {
  sendToHud: (m: unknown) => void
  sendToCockpit: (m: unknown) => void
}

export class HudShellRouter {
  private active = new Map<string, WideShell>()
  private lastHeartbeat = 0
  private pendingPing: { nonce: string; t0: number } | null = null
  private lastPingOkFlag = false
  private hudPid: number | null = null

  constructor(private sinks: HudShellRouterSinks) {}

  getActiveShell(threadId: string): WideShell | null {
    return this.active.get(threadId) ?? null
  }

  /**
   * Set the active wide shell for a thread.
   * When switching away from a previous wide shell, emit shell.standby to that prior shell (N2).
   */
  setActiveShell(threadId: string, next: WideShell): void {
    const prev = this.active.get(threadId)
    this.active.set(threadId, next)
    if (prev && prev !== next) {
      const message =
        next === "hud"
          ? "任务进行中 — 在 HUD 查看"
          : "任务进行中 — 在 确认台 查看"
      const payload = encodeShellStandby({
        thread_id: threadId,
        active_shell: next,
        message,
      })
      if (prev === "hud") this.sinks.sendToHud(payload)
      else this.sinks.sendToCockpit(payload)
    }
  }

  noteHeartbeat(ts: number): void {
    this.lastHeartbeat = ts
  }

  /** Heartbeat-only health check (PID + ping are separate hooks for full N3 later). */
  isHealthy(now = Date.now()): boolean {
    if (!this.lastHeartbeat) return false
    return now - this.lastHeartbeat <= HUD_HEARTBEAT_STALE_MS
  }

  beginPing(now = Date.now()): string {
    const nonce = `p${now}`
    this.pendingPing = { nonce, t0: now }
    this.sinks.sendToHud(encodeHudPing({ nonce }))
    return nonce
  }

  notePong(nonce: string, now = Date.now()): void {
    if (!this.pendingPing || this.pendingPing.nonce !== nonce) return
    this.lastPingOkFlag = now - this.pendingPing.t0 <= HUD_PING_TIMEOUT_MS
    this.pendingPing = null
  }

  lastPingOk(): boolean {
    return this.lastPingOkFlag
  }

  setHudPid(pid: number | null): void {
    this.hudPid = pid
  }

  getHudPid(): number | null {
    return this.hudPid
  }
}
