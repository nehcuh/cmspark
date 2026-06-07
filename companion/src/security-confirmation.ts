// Security confirmation flow — request/response queue for high-risk tool execution

import { randomUUID } from "crypto"

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
}

export interface SecurityConfirmationDecision {
  confirmationId: string
  approved: boolean
  reason: "approved" | "denied" | "timeout" | "disconnect"
}

interface PendingConfirmation {
  resolve: (decision: SecurityConfirmationDecision) => void
  timer: NodeJS.Timeout
  send: (data: any) => void
}

function codePreview(code: string): string {
  const trimmed = String(code || "").trim()
  if (trimmed.length <= CODE_PREVIEW_LIMIT) return trimmed
  return `${trimmed.slice(0, CODE_PREVIEW_LIMIT)}\n…`
}

export class SecurityConfirmationManager {
  private pending = new Map<string, PendingConfirmation>()

  constructor(private timeoutMs = DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS) {}

  request(send: (data: any) => void, details: SecurityConfirmationDetails): Promise<SecurityConfirmationDecision> {
    const confirmationId = randomUUID()

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(confirmationId)
        send({ type: "security.confirmation.expired", confirmation_id: confirmationId })
        resolve({ confirmationId, approved: false, reason: "timeout" })
      }, this.timeoutMs)

      this.pending.set(confirmationId, { resolve, timer, send })

      send({
        type: "security.confirmation.request",
        confirmation_id: confirmationId,
        tool_name: details.toolName,
        dangerous_apis: details.dangerousApis,
        code_preview: codePreview(details.code),
        timeout_ms: this.timeoutMs,
        requested_at: new Date().toISOString(),
        risk_score: details.riskScore,
        risk_category: details.riskCategory,
        risk_level: details.riskLevel,
        auto_confirm_eligible: details.autoConfirmEligible,
        defense_layer: details.defenseLayer,
      })
    })
  }

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

  rejectAll(reason: "disconnect" | "timeout" = "disconnect") {
    for (const [confirmationId, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({ confirmationId, approved: false, reason })
    }
    this.pending.clear()
  }
}
