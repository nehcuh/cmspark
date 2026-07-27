/**
 * P3a Native HUD spike helpers — env-gated open/hydrate/confirm/standby sequence.
 *
 * Dual-process note: tray (menu-bar) owns the Swift stdin pipe; server owns
 * SecurityConfirmationManager. Co-located path uses getTrayInstance(); dual
 * process uses WS messages between tray client and server (see menu-bar-agent).
 *
 * Gate: process.env.CMSPARK_HUD_SPIKE === "1"
 */

import { randomUUID } from "crypto"
import type { UnifiedTray } from "../tray/tray-adapter"
import type { SecurityConfirmationManager } from "../security-confirmation"
import { HudShellRouter } from "./shell-router"
import type { HudHydratePayload } from "./protocol"

export const HUD_SPIKE_ENV = "CMSPARK_HUD_SPIKE"
export const HUD_SPIKE_THREAD_ID = "spike-thread"
export const HUD_SPIKE_TASK_ID = "spike"

export function isHudSpikeEnabled(): boolean {
  return process.env[HUD_SPIKE_ENV] === "1"
}

export function buildSpikeHydrate(
  connection: HudHydratePayload["connection"] = "connected",
): HudHydratePayload {
  return {
    thread_id: HUD_SPIKE_THREAD_ID,
    shell: "hud",
    connection,
    pending_confirmations: [],
    task: {
      task_id: HUD_SPIKE_TASK_ID,
      status: "running",
      goal: "spike goal",
    },
    dual_track: { conclusions: [], steps: [] },
  }
}

export type HudSpikeDeps = {
  tray: UnifiedTray
  securityConfirmations: SecurityConfirmationManager
  /** Optional router for standby emit; created if omitted. */
  router?: HudShellRouter
  log?: (msg: string, extra?: Record<string, unknown>) => void
  /** Confirm timeout for spike (short for manual tests). */
  confirmTimeoutMs?: number
  openTimeoutMs?: number
}

export type HudSpikeResult = {
  ok: boolean
  phase: string
  error?: string
  confirmApproved?: boolean
  confirmationId?: string
}

/**
 * In-process spike: open HUD → hydrate → one elevated confirm race → standby.
 * Requires tray methods (Swift). Fails soft if open times out.
 */
export async function runHudSpikeInProcess(deps: HudSpikeDeps): Promise<HudSpikeResult> {
  const log = deps.log ?? ((m, e) => console.log(`[hud-spike] ${m}`, e ?? ""))
  const tray = deps.tray
  const openMs = deps.openTimeoutMs ?? 2000
  const confirmMs = deps.confirmTimeoutMs ?? 45_000

  if (!tray.openHudAsync || !tray.hydrateHud || !tray.showHudConfirm) {
    return { ok: false, phase: "precheck", error: "tray lacks HUD methods (non-Swift backend?)" }
  }

  // Optional: attach shell router to Swift adapter for heartbeat/pong
  const router =
    deps.router ??
    new HudShellRouter({
      sendToHud: (m) => {
        // standbyHud if payload is shell.standby; otherwise ignore for spike
        if (m && typeof m === "object" && (m as { cmd?: string }).cmd === "shell.standby") {
          const s = m as { thread_id: string; active_shell: "hud" | "cockpit"; message: string }
          tray.standbyHud?.(s.thread_id, s.active_shell, s.message)
        }
      },
      sendToCockpit: () => {
        /* cockpit not in-process during spike */
      },
    })
  const anyTray = tray as { setShellRouter?: (r: HudShellRouter | null) => void }
  anyTray.setShellRouter?.(router)

  try {
    log("openHudAsync…")
    await tray.openHudAsync(HUD_SPIKE_THREAD_ID, "spike", openMs)
  } catch (err: any) {
    const msg = err?.message || String(err)
    log("openHudAsync failed", { error: msg })
    return { ok: false, phase: "open", error: msg }
  }

  log("hydrate")
  tray.hydrateHud(buildSpikeHydrate("connected"))
  router.setActiveShell(HUD_SPIKE_THREAD_ID, "hud")

  const confirmationId = randomUUID()
  log("request confirm", { confirmationId })

  const hudPromise = tray.showHudConfirm!({
    id: confirmationId,
    toolName: "evaluate",
    riskLevel: "high",
    summary: "HUD spike confirm — Allow or Deny",
    timeoutMs: confirmMs,
  })
    .then((r) => ({ source: "hud" as const, approved: r.approved }))
    .catch(() => null as null | { source: "hud"; approved: boolean })

  const wsPromise = deps.securityConfirmations.request(
    () => {
      /* no WS panel in pure spike; HUD is the elevated surface */
    },
    {
      toolName: "evaluate",
      dangerousApis: [],
      code: "/* hud spike */",
      riskLevel: "high",
    },
    undefined,
    confirmationId,
  )

  const winner = await Promise.race([
    wsPromise.then((d) => ({ source: "manager" as const, decision: d })),
    hudPromise,
  ])

  if (winner === null) {
    return { ok: false, phase: "confirm", error: "HUD confirm rejected/crashed", confirmationId }
  }

  if (winner.source === "manager") {
    tray.cancelHudConfirm?.(confirmationId)
    tray.notifyHudConfirmResolved?.(confirmationId, winner.decision.reason)
    log("manager won race (timeout/other)", { reason: winner.decision.reason })
    // Still run standby so UI path is exercised
    router.setActiveShell(HUD_SPIKE_THREAD_ID, "cockpit")
    return {
      ok: winner.decision.reason === "timeout",
      phase: "confirm",
      confirmationId,
      confirmApproved: winner.decision.approved,
      error: winner.decision.reason === "timeout" ? "confirm timed out" : undefined,
    }
  }

  // HUD responded first
  deps.securityConfirmations.respond(confirmationId, winner.approved)
  await wsPromise
  log("HUD confirm resolved", { approved: winner.approved })

  // Standby after short delay so operator can see the card clear
  await new Promise((r) => setTimeout(r, 800))
  router.setActiveShell(HUD_SPIKE_THREAD_ID, "cockpit")
  log("standby → cockpit")

  return {
    ok: true,
    phase: "done",
    confirmationId,
    confirmApproved: winner.approved,
  }
}
