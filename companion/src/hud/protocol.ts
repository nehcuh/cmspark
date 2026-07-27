/**
 * Companion Native HUD — spike v0 protocol types & codecs.
 *
 * Line-delimited JSON on the tray stdin/stdout pipe (same channel as tray).
 * Companion → Swift uses `cmd`; Swift → Companion uses `type`.
 *
 * Upstream locks: N1–N10 (docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md)
 * Plan: docs/superpowers/plans/2026-07-27-companion-native-hud-p3a-spike.md
 */

// ── Companion → Swift payloads ──────────────────────────────────────────────

export type HudOpenPayload = {
  thread_id: string
  reason?: "spike" | "escalate" | "tray" | "debug"
}

export type ShellStandbyPayload = {
  thread_id: string
  active_shell: "hud" | "cockpit"
  message: string
}

export type HudHydratePendingConfirmation = {
  confirmation_id: string
  tool_name: string
  risk_level?: string
  summary: string
  timeout_ms: number
}

export type HudHydratePayload = {
  thread_id: string
  shell: "hud" | "cockpit" | "standby"
  connection: "connected" | "disconnected" | "unknown"
  capability_level?: string
  pending_confirmations: HudHydratePendingConfirmation[]
  task?: {
    task_id: string
    goal?: string
    status: string
  } | null
  /** Dual-track intentionally empty in P3a spike */
  dual_track?: { conclusions: never[]; steps: never[] }
}

export type HudConfirmRequestPayload = {
  id: string
  tool_name: string
  risk_level: string
  summary: string
  timeout_ms: number
}

export type HudConfirmCancelPayload = {
  id: string
}

/** N5 NEW — resolved/expired fan-out so HUD clears UI */
export type HudConfirmResolvedPayload = {
  id: string
  outcome: "approved" | "denied" | "timeout" | "disconnect" | "unknown"
}

export type HudPingPayload = {
  nonce: string
}

// ── Companion → Swift command objects ───────────────────────────────────────

export type HudOpenCmd = { cmd: "hud.open" } & HudOpenPayload
export type HudHydrateCmd = { cmd: "hud.hydrate" } & HudHydratePayload
export type HudConfirmRequestCmd = { cmd: "hud.confirm.request" } & HudConfirmRequestPayload
export type HudConfirmCancelCmd = { cmd: "hud.confirm.cancel" } & HudConfirmCancelPayload
export type HudConfirmResolvedCmd = { cmd: "hud.confirm.resolved" } & HudConfirmResolvedPayload
export type ShellStandbyCmd = { cmd: "shell.standby" } & ShellStandbyPayload
export type HudPingCmd = { cmd: "hud.ping" } & HudPingPayload
export type HudCloseCmd = { cmd: "hud.close" }

export type HudOutboundCmd =
  | HudOpenCmd
  | HudHydrateCmd
  | HudConfirmRequestCmd
  | HudConfirmCancelCmd
  | HudConfirmResolvedCmd
  | ShellStandbyCmd
  | HudPingCmd
  | HudCloseCmd

// ── Swift → Companion events ────────────────────────────────────────────────

export type HudReadyEvt = { type: "hud.ready" }
export type HudClosedEvt = { type: "hud.closed"; reason: "user" | "cmd" | "crash" | string }
export type HudHeartbeatEvt = { type: "hud.heartbeat"; ts: number }
export type HudPongEvt = { type: "hud.pong"; nonce: string }
export type HudConfirmResponseEvt = {
  type: "hud.confirm.response"
  id: string
  approved: boolean
}
export type HudAbortEvt = {
  type: "hud.abort"
  thread_id?: string
  task_id?: string
}

export type HudInboundEvt =
  | HudReadyEvt
  | HudClosedEvt
  | HudHeartbeatEvt
  | HudPongEvt
  | HudConfirmResponseEvt
  | HudAbortEvt

// ── Encoders ────────────────────────────────────────────────────────────────

export function encodeHudOpen(p: HudOpenPayload): HudOpenCmd {
  return { cmd: "hud.open" as const, ...p }
}

export function encodeHudHydrate(p: HudHydratePayload): HudHydrateCmd {
  return { cmd: "hud.hydrate" as const, ...p }
}

export function encodeShellStandby(p: ShellStandbyPayload): ShellStandbyCmd {
  return { cmd: "shell.standby" as const, ...p }
}

export function encodeHudConfirmRequest(p: HudConfirmRequestPayload): HudConfirmRequestCmd {
  return { cmd: "hud.confirm.request" as const, ...p }
}

export function encodeHudConfirmCancel(p: HudConfirmCancelPayload): HudConfirmCancelCmd {
  return { cmd: "hud.confirm.cancel" as const, ...p }
}

export function encodeHudConfirmResolved(p: HudConfirmResolvedPayload): HudConfirmResolvedCmd {
  return { cmd: "hud.confirm.resolved" as const, ...p }
}

export function encodeHudPing(p: HudPingPayload): HudPingCmd {
  return { cmd: "hud.ping" as const, ...p }
}

export function encodeHudClose(): HudCloseCmd {
  return { cmd: "hud.close" as const }
}

// ── Parser + type guards ────────────────────────────────────────────────────

/** Parse one stdout line from Swift. Returns null on invalid JSON (never throws). */
export function parseSwiftLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch {
    return null
  }
}

export function isHudConfirmResponse(ev: unknown): ev is HudConfirmResponseEvt {
  if (!ev || typeof ev !== "object") return false
  const o = ev as Record<string, unknown>
  return (
    o.type === "hud.confirm.response" &&
    typeof o.id === "string" &&
    typeof o.approved === "boolean"
  )
}

export function isHudReady(ev: unknown): ev is HudReadyEvt {
  return !!ev && typeof ev === "object" && (ev as { type?: string }).type === "hud.ready"
}

export function isHudHeartbeat(ev: unknown): ev is HudHeartbeatEvt {
  if (!ev || typeof ev !== "object") return false
  const o = ev as Record<string, unknown>
  return o.type === "hud.heartbeat" && typeof o.ts === "number"
}

export function isHudPong(ev: unknown): ev is HudPongEvt {
  if (!ev || typeof ev !== "object") return false
  const o = ev as Record<string, unknown>
  return o.type === "hud.pong" && typeof o.nonce === "string"
}

export function isHudAbort(ev: unknown): ev is HudAbortEvt {
  return !!ev && typeof ev === "object" && (ev as { type?: string }).type === "hud.abort"
}

export function isHudClosed(ev: unknown): ev is HudClosedEvt {
  if (!ev || typeof ev !== "object") return false
  const o = ev as Record<string, unknown>
  return o.type === "hud.closed" && typeof o.reason === "string"
}
