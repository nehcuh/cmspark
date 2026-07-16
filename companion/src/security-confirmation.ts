// Security confirmation flow — request/response queue for high-risk tool execution

import { randomUUID } from "crypto"
import type { WebSocket } from "ws"

export const DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS = 45000
const CODE_PREVIEW_LIMIT = 1200

export interface SecurityConfirmationDetails {
  toolName: string
  dangerousApis: string[]
  code: string
  riskScore?: number
  riskCategory?: string
  riskLevel?: 'low' | 'medium' | 'high'
  autoConfirmEligible?: boolean
  defenseLayer?: number
  /**
   * CRITICAL dangerous APIs (never-auto-approved subset, §6.2). When non-empty,
   * the confirmation was force-shown even under god-mode / auto-approve / domain
   * whitelist. Surfaced to the client so the dialog can render a high-risk
   * banner distinguishing "critical capability requires explicit OK" from a
   * routine dangerous-API preview.
   */
  criticalApis?: string[]
  /**
   * Domains the user might want to add to auto_approved_domains if they approve.
   * Surfaced in the confirmation dialog as an "add to whitelist" option. Empty
   * when companion can't determine the acting domain (e.g. evaluate with unknown
   * tabId) — in that case the dialog just hides the whitelist option.
   */
  relevantDomains?: string[]
  /**
   * Phase 1 W7 — bundle ids relevant to this confirmation (for host_read /
   * host_write tools). Surfaced in the dialog as an inline checkbox "信任此 app
   * 本线程内不再询问". When user approves with add_to_thread_whitelist=true,
   * companion validates the response payload's bundle id against this set
   * (same anti-WS-injection pattern as relevantDomains).
   */
  relevantApps?: string[]
}

export interface SecurityConfirmationDecision {
  confirmationId: string
  approved: boolean
  reason: "approved" | "denied" | "timeout" | "disconnect"
}

export interface SecurityConfirmationRequestOptions {
  /**
   * Originating WebSocket for this confirmation. When set, only responses
   * (security.confirmation.response) arriving on this same socket may resolve
   * the confirmation — closes [C-SEC-2] (a different connected client approving
   * its own request). When undefined, the confirmation is broadcast-style and
   * any inbound response may resolve it (backward-compatible behavior).
   */
  originWs?: WebSocket
}

interface PendingConfirmation {
  resolve: (decision: SecurityConfirmationDecision) => void
  timer: NodeJS.Timeout
  send: (data: any) => void
  originWs?: WebSocket
  toolName: string
  /**
   * Domains presented to the user as candidates for "add to whitelist" in this
   * confirmation's dialog. Tracked server-side so the response handler can
   * validate that any add_to_whitelist pattern returned by the client actually
   * corresponds to a domain the user was shown — prevents a compromised client
   * (or any loopback WS peer) from injecting arbitrary patterns like "*" or
   * "*.com" via a crafted response payload.
   */
  relevantDomains: string[]
  /**
   * Phase 1 W7 — bundle ids presented in the dialog as inline-checkbox
   * candidates for thread-scoped trust. Same anti-injection contract as
   * relevantDomains: server tracks what was shown, validates response.
   */
  relevantApps: string[]
}

function codePreview(code: string): string {
  const trimmed = String(code || "").trim()
  if (trimmed.length <= CODE_PREVIEW_LIMIT) return trimmed
  return `${trimmed.slice(0, CODE_PREVIEW_LIMIT)}\n…`
}

export class SecurityConfirmationManager {
  private pending = new Map<string, PendingConfirmation>()

  constructor(private timeoutMs = DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS) {}

  request(
    send: (data: any) => void,
    details: SecurityConfirmationDetails,
    options?: SecurityConfirmationRequestOptions,
  ): Promise<SecurityConfirmationDecision> {
    const confirmationId = randomUUID()

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(confirmationId)
        send({ type: "security.confirmation.expired", confirmation_id: confirmationId })
        resolve({ confirmationId, approved: false, reason: "timeout" })
      }, this.timeoutMs)

      this.pending.set(confirmationId, {
        resolve,
        timer,
        send,
        originWs: options?.originWs,
        toolName: details.toolName,
        relevantDomains: Array.isArray(details.relevantDomains)
          ? details.relevantDomains.filter((d): d is string => typeof d === "string" && d.length > 0)
          : [],
        relevantApps: Array.isArray(details.relevantApps)
          ? details.relevantApps.filter((d): d is string => typeof d === "string" && d.length > 0)
          : [],
      })

      send({
        type: "security.confirmation.request",
        confirmation_id: confirmationId,
        tool_name: details.toolName,
        dangerous_apis: details.dangerousApis,
        critical_apis: details.criticalApis,
        code_preview: codePreview(details.code),
        timeout_ms: this.timeoutMs,
        requested_at: new Date().toISOString(),
        risk_score: details.riskScore,
        risk_category: details.riskCategory,
        risk_level: details.riskLevel,
        auto_confirm_eligible: details.autoConfirmEligible,
        defense_layer: details.defenseLayer,
        relevant_domains: details.relevantDomains,
        relevant_apps: details.relevantApps,
      })
    })
  }

  /**
   * Return the relevant_domains originally presented in the confirmation dialog
   * for `confirmationId`. Used by the response handler to validate that any
   * add_to_whitelist patterns in the inbound response actually match a domain
   * the user was shown. Returns undefined when the confirmation no longer
   * exists (already resolved, expired, or unknown id).
   */
  getRelevantDomains(confirmationId: string): string[] | undefined {
    return this.pending.get(confirmationId)?.relevantDomains
  }

  /**
   * Phase 1 W7 — Return the relevant_apps originally presented in the dialog.
   * Same anti-injection contract as getRelevantDomains: response handler
   * validates add_to_thread_whitelist payloads against this set.
   */
  getRelevantApps(confirmationId: string): string[] | undefined {
    return this.pending.get(confirmationId)?.relevantApps
  }

  /**
   * Phase 1 W7 — Return the toolName for this confirmation. Used by response
   * handler to decide whether to record thread-scoped trust (host_read only,
   * never host_write per Q1 ship blocker).
   */
  getToolName(confirmationId: string): string | undefined {
    return this.pending.get(confirmationId)?.toolName
  }

  /**
   * Resolve a confirmation in response to an inbound security.confirmation.response
   * arriving from `sourceWs`. If the pending entry has originWs set, sourceWs MUST
   * match — otherwise the response is rejected (returns false) and the original
   * confirmation stays pending. Returns false if no pending entry exists, or if
   * the origin check fails.
   */
  respondFrom(confirmationId: string, approved: boolean, sourceWs?: WebSocket): boolean {
    const pending = this.pending.get(confirmationId)
    if (!pending) return false

    if (pending.originWs !== undefined && pending.originWs !== sourceWs) {
      // Origin mismatch — a different socket attempted to answer this
      // confirmation. Leave the pending entry intact so the legitimate
      // origin can still respond (or it times out).
      return false
    }

    clearTimeout(pending.timer)
    this.pending.delete(confirmationId)
    pending.send({ type: "security.confirmation.resolved", confirmation_id: confirmationId, approved })
    pending.resolve({
      confirmationId,
      approved,
      reason: approved ? "approved" : "denied",
    })
    return true
  }

  /**
   * Legacy respond() — privileged test/admin path that bypasses origin binding.
   * Resolves any pending entry regardless of originWs. Existing test code and
   * integration-test paths that don't track a source ws continue to work; in
   * production the live server routes inbound responses through respondFrom(),
   * which enforces the origin check. Treat respond() as a privileged escape
   * hatch — never call it from request-handling code paths.
   */
  respond(confirmationId: string, approved: boolean): boolean {
    const pending = this.pending.get(confirmationId)
    if (!pending) return false

    clearTimeout(pending.timer)
    this.pending.delete(confirmationId)
    pending.send({ type: "security.confirmation.resolved", confirmation_id: confirmationId, approved })
    pending.resolve({
      confirmationId,
      approved,
      reason: approved ? "approved" : "denied",
    })
    return true
  }

  /**
   * Reject pending confirmations. If `ws` is provided, only entries whose
   * originWs matches (or is undefined — broadcast-style) are rejected; entries
   * owned by a different socket survive — closes [C-SRV-1] where a disconnect
   * on one connection would reject prompts on other connections. If `ws` is
   * undefined, all pending entries are rejected (backward-compatible).
   */
  rejectAll(reason: "disconnect" | "timeout" = "disconnect", ws?: WebSocket) {
    if (ws === undefined) {
      for (const [confirmationId, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.resolve({ confirmationId, approved: false, reason })
      }
      this.pending.clear()
      return
    }

    for (const [confirmationId, pending] of this.pending) {
      if (pending.originWs !== undefined && pending.originWs !== ws) continue
      clearTimeout(pending.timer)
      pending.resolve({ confirmationId, approved: false, reason })
      this.pending.delete(confirmationId)
    }
  }
}
