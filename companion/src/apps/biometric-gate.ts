// App tab (WP2) — D2 biometric gate for persistent auto-policy grants.
//
// add-auto / policy-upgrade→auto are PERSISTENT authorizations (unlike an L2
// approval of a single op), so they require the biometric tier: Windows Hello
// (OS-hosted dialog, companion-side spawn — a compromised renderer cannot
// forge it) with the manual-nonce downgrade when Hello hardware/policy is
// unavailable. Cancel → hard deny, NEVER downgrade on cancel (adversary H1).
//
// This is the same flow shape as server.ts's host_write skip-L2 path, built
// from the same primitives (tryWindowsHello + generateManualNonce +
// SecurityConfirmationManager.request with an origin-bound send). The
// confirmation channel is injected by the caller (message-router passes
// session.requestConfirmation, which server.ts wires with { originWs: ws }) —
// no duplication of the nonce attempt/lockout logic, which lives entirely in
// SecurityConfirmationManager.

import os from "os"
import { logger } from "../logger"
import { generateManualNonce } from "../host-use/nonce"
import type {
  SecurityConfirmationDecision,
  SecurityConfirmationDetails,
} from "../security-confirmation"

export type BiometricMethod = "windows-hello" | "manual-nonce"

export type BiometricGateOutcome =
  | { approved: true; method: BiometricMethod; nonce: string }
  | { approved: false; reason: "cancelled" | "denied" | "timeout" | "disconnect" | "error"; detail?: string }

export interface BiometricGateDeps {
  /**
   * Windows Hello attempt. Default: tryWindowsHello from host-use/win
   * (dynamically imported, mirroring server.ts, so non-win32 platforms never
   * load the win adapter). Injectable for tests.
   */
  tryHello?: (
    reason: string,
  ) => Promise<{ ok: true; nonce: string } | { unavailable: true } | { cancelled: true }>
  generateNonce?: () => string
  platform?: NodeJS.Platform
}

export interface BiometricGateRequest {
  /** Audit verb, e.g. "apps.add" / "apps.set_policy". */
  action: string
  /** Human-readable reason shown in the OS dialog, e.g. 'Add "网易云音乐" as auto-launch app'. */
  reason: string
  /** Origin-bound confirmation channel (session.requestConfirmation). */
  requestConfirmation: (
    details: SecurityConfirmationDetails,
  ) => Promise<SecurityConfirmationDecision>
  deps?: BiometricGateDeps
}

async function defaultTryHello(reason: string) {
  const { tryWindowsHello } = await import("../host-use/win")
  return tryWindowsHello("apps-biometric-gate", reason)
}

/**
 * Run the D2 biometric gate. Never throws for user-facing outcomes — denial
 * paths resolve to { approved: false }. Only unexpected infra exceptions
 * (e.g. malformed Hello payload) propagate as { approved:false, reason:"error" }.
 */
export async function requireAppsBiometric(req: BiometricGateRequest): Promise<BiometricGateOutcome> {
  const platform = req.deps?.platform ?? os.platform()
  const generateNonce = req.deps?.generateNonce ?? generateManualNonce

  const confirmWithNonce = async (): Promise<BiometricGateOutcome> => {
    const challenge = generateNonce()
    const decision = await req.requestConfirmation({
      toolName: req.action,
      dangerousApis: [],
      code: `${req.reason} — Windows Hello unavailable; type the 6-char code to approve`,
      nonceChallenge: challenge,
    })
    if (decision.approved) {
      logger.info("apps.biometric.verified", {
        tool_name: req.action,
        nonce: challenge,
        method: "manual-nonce",
      })
      return { approved: true, method: "manual-nonce", nonce: challenge }
    }
    logger.warn("apps.biometric.denied", {
      tool_name: req.action,
      method: "manual-nonce",
      reason: decision.reason,
    })
    return { approved: false, reason: decision.reason === "approved" ? "denied" : decision.reason }
  }

  if (platform === "win32") {
    const tryHello = req.deps?.tryHello ?? defaultTryHello
    let hello: Awaited<ReturnType<typeof defaultTryHello>>
    try {
      hello = await tryHello(req.reason)
    } catch (e: any) {
      logger.error("apps.biometric.error", {
        tool_name: req.action,
        error: e?.message || String(e),
      })
      return { approved: false, reason: "error", detail: e?.message || String(e) }
    }
    if ("ok" in hello) {
      logger.info("apps.biometric.verified", {
        tool_name: req.action,
        nonce: hello.nonce,
        method: "windows-hello",
      })
      return { approved: true, method: "windows-hello", nonce: hello.nonce }
    }
    if ("cancelled" in hello) {
      // Adversary H1: cancel → denied, NEVER downgrade to the nonce fallback.
      logger.warn("apps.biometric.denied", {
        tool_name: req.action,
        method: "windows-hello",
        reason: "cancelled",
      })
      return { approved: false, reason: "cancelled" }
    }
    // Hello unavailable → manual-nonce downgrade (triggered by real hardware
    // state — not process-forgeable). Dedicated downgrade audit event mirrors
    // security.biometric.downgrade (adversary amendment 7a).
    logger.info("apps.biometric.downgrade", {
      tool_name: req.action,
      reason: "windows_hello_unavailable",
    })
    return confirmWithNonce()
  }

  // Non-win32: the App tab is Windows-first; the manual-nonce flow is
  // platform-agnostic and stays the honest gate (Linux W9 parity). No Hello
  // probe is attempted off Windows.
  return confirmWithNonce()
}
