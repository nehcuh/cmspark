// Security confirmation flow — request/response queue for high-risk tool execution

import { randomUUID } from "crypto"
import type { WebSocket } from "ws"

export const DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS = 45000
const CODE_PREVIEW_LIMIT = 1200

/**
 * Phase 1 W8-windows / W9 — max manual-nonce attempts before the confirmation
 * resolves denied (lockout). Attempts are tracked per pending confirmation;
 * origin-mismatch responses are rejected BEFORE nonce logic so a rogue
 * loopback peer cannot burn attempts (adversary amendment A1).
 */
export const MAX_NONCE_ATTEMPTS = 3

/**
 * Outcome of respondFrom — replaces the bare boolean so nonce retries /
 * lockouts are NEVER logged as security.confirmation.origin_mismatch_or_unknown
 * (adversary amendment A4: they get their own dedicated audit events).
 */
export type ConfirmationRespondOutcome =
  | "resolved"
  | "unknown"
  | "origin_mismatch"
  | "nonce_retry"
  | "nonce_locked"

export interface ConfirmationRespondResult {
  outcome: ConfirmationRespondOutcome
  /** Remaining nonce attempts after this response (nonce_retry / nonce_locked only). */
  attemptsLeft?: number
}

export interface SecurityConfirmationDetails {
  toolName: string
  dangerousApis: string[]
  code: string
  riskScore?: number
  riskCategory?: string
  riskLevel?: 'low' | 'medium' | 'high'
  autoConfirmEligible?: boolean
  defenseLayer?: number
  /** Plan A: offer enterprise session-trust checkbox on this confirm. */
  offerEnterpriseSessionTrust?: boolean
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
  /**
   * Phase 1 W9 — Linux manual nonce for biometric tier. When set (Linux only),
   * the dialog displays the code prominently + a paste-blocked text input.
   * User must type the code back to confirm. Round 2 §2.3 Kimi加严:
   * "手动输入 6 位 nonce，不可复制粘贴". Empty on darwin (uses Touch ID instead).
   */
  nonceChallenge?: string
  /**
   * WP4 (§F.1) — host_computer L2 对话框的标注截图(base64 JPEG,凭证区已
   * 黑化,十字线标注首动作当前位置)。可选;仅存在时随请求下发。绝不进入
   * 工具结果/LLM 上下文(P2 不变量——本字段只流向 originWs 面板的确认对话框)。
   */
  previewImage?: string
  /** 截图说明行(三段式非绑定声明;companion 侧已过 P3 字符类清洗)。 */
  previewCaption?: string
  /**
   * P1 (WP4 对抗裁决) — computer 类确认的完整预览文本独立字段。
   * code_preview 经 codePreview() 截断(CODE_PREVIEW_LIMIT=1200)——30 动作 +
   * 2000 字符语料的逐条枚举必然被截尾,排在清单尾部的动作与待输入文本对人
   * 不可见(WP1 起存在的现网洞)。实现选择:独立字段绕过截断(而非对
   * host_computer 豁免/提限 code_preview)——其余工具的 1200 截断行为完全
   * 不变,修复面刻意收窄;旧扩展忽略本字段即回退截断版 code_preview。
   */
  fullPreview?: string
  /** ADR-015 multi-agent: acting worker / run identity for Confirm Center */
  workerId?: string
  parentThreadId?: string
  orchestratorRunId?: string
  workerRoleLabel?: string
  tabId?: number
  /**
   * ADR-016 G6: board_complete Confirm Center digest.
   * goal, trust histogram, claim previews, residual_risks, empty_complete flag.
   */
  boardCompleteDigest?: {
    goal: string | null
    trust_histogram: Record<string, number>
    claim_previews: Array<{ id: string; trust: string; trust_label: string; preview: string }>
    residual_risks: string[]
    empty_complete: boolean
    empty_complete_reason: string | null
    supporting_fact_ids: string[]
    status: string
  }
  /**
   * #371: spawn_expert_team Confirm Center card — members, HARD_DENY-effective
   * tools, full editable task slices, orchestrator/Board promotion.
   */
  expertTeam?: {
    will_promote_orchestrator: boolean
    will_open_board: boolean
    cap_note: string
    members: Array<{
      pack_id: string
      name: string
      role_label: string
      effective_tools: string[]
      brief: string
    }>
  }
}

export interface SecurityConfirmationDecision {
  confirmationId: string
  approved: boolean
  reason: "approved" | "denied" | "timeout" | "disconnect"
  /**
   * Grill Q2 (2026-07-26): user checked "本会话自动同意同类操作" on host_computer L2.
   * Only meaningful when approved===true. Server uses this for explicitOptIn grant.
   */
  addToSessionTrust?: boolean
  /**
   * Plan A: user checked enterprise session trust on shell/netsec L2.
   * Only honored when pending.enterpriseSessionTrustOffered (anti-injection G5).
   */
  addToEnterpriseSessionTrust?: boolean
  /**
   * #371: origin-bound edited task slices from Confirm Center. Pack ids must
   * be a subset of the members shown on the card (anti-injection).
   */
  expertTeamSlices?: Array<{ pack_id: string; brief: string }>
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
  /**
   * Phase 1 W8-windows / W9 — manual nonce challenge shown in the dialog
   * (Windows Hello-unavailable fallback / Linux biometric tier). When set,
   * an approval resolves only after the typed response matches; mismatches
   * consume attempts (MAX_NONCE_ATTEMPTS) while the entry stays pending.
   */
  nonceChallenge?: string
  /** Consumed manual-nonce attempts for this confirmation (starts at 0). */
  nonceAttempts: number
  /** ADR-015: stamped worker/thread for authoritative stop_thread drain. */
  workerId?: string
  /**
   * Plan A G5: true only when companion offered the enterprise session-trust
   * checkbox for this confirmation (shell_exec / netsec_port_scan).
   */
  enterpriseSessionTrustOffered?: boolean
  /** #371: pack ids shown on the spawn_expert_team card (edit allowlist). */
  expertTeamPackIds?: string[]
}

function codePreview(code: string): string {
  const trimmed = String(code || "").trim()
  if (trimmed.length <= CODE_PREVIEW_LIMIT) return trimmed
  return `${trimmed.slice(0, CODE_PREVIEW_LIMIT)}\n…`
}

/** N5 fan-out payload — fired once when a pending confirmation becomes terminal. */
export type SecurityConfirmationTerminalEvent = {
  confirmationId: string
  approved: boolean
  reason: SecurityConfirmationDecision["reason"]
}

export type SecurityConfirmationTerminalListener = (
  event: SecurityConfirmationTerminalEvent,
) => void

export class SecurityConfirmationManager {
  private pending = new Map<string, PendingConfirmation>()
  /**
   * N5: optional multi-surface fan-out hook (HUD stdin, tray cancelConfirm, …).
   * Invoked exactly once per confirmation that reaches a terminal decision.
   * Late respond / respondFrom (`unknown`) do not call this.
   */
  private onTerminal: SecurityConfirmationTerminalListener | null = null

  constructor(private timeoutMs = DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS) {}

  /**
   * Register (or clear with null) the N5 terminal fan-out listener.
   * Listener errors are swallowed — resolve path must never throw.
   */
  setOnTerminal(cb: SecurityConfirmationTerminalListener | null): void {
    this.onTerminal = cb
  }

  /**
   * Fire onTerminal once after pending has been deleted and resolve is about to run.
   * Never re-enter from late respond paths (those never reach here).
   */
  private fireTerminal(decision: SecurityConfirmationDecision): void {
    if (!this.onTerminal) return
    try {
      this.onTerminal({
        confirmationId: decision.confirmationId,
        approved: decision.approved,
        reason: decision.reason,
      })
    } catch {
      /* never break resolve path */
    }
  }

  request(
    send: (data: any) => void,
    details: SecurityConfirmationDetails,
    options?: SecurityConfirmationRequestOptions,
    /**
     * Optional pre-generated confirmationId. P0a Tray confirmation needs the id
     * up-front to share between manager (WS channel) and SwiftTrayAdapter (tray
     * channel) — whichever resolves first calls respond(confirmationId, ...).
     * When omitted, a fresh UUID is generated (existing behavior).
     */
    preGeneratedId?: string,
  ): Promise<SecurityConfirmationDecision> {
    const confirmationId = preGeneratedId ?? randomUUID()

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(confirmationId)
        send({ type: "security.confirmation.expired", confirmation_id: confirmationId })
        const decision: SecurityConfirmationDecision = {
          confirmationId,
          approved: false,
          reason: "timeout",
        }
        resolve(decision)
        this.fireTerminal(decision)
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
        nonceChallenge: typeof details.nonceChallenge === "string" && details.nonceChallenge.length > 0
          ? details.nonceChallenge
          : undefined,
        nonceAttempts: 0,
        workerId: typeof details.workerId === "string" && details.workerId.length > 0
          ? details.workerId
          : undefined,
        enterpriseSessionTrustOffered: details.offerEnterpriseSessionTrust === true,
        expertTeamPackIds: Array.isArray(details.expertTeam?.members)
          ? details.expertTeam.members.map((m) => String(m.pack_id || "").trim()).filter(Boolean)
          : undefined,
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
        nonce_challenge: details.nonceChallenge,
        // WP4: 可选字段,仅存在时下发(旧扩展忽略即回退现版对话框)。
        ...(typeof details.previewImage === "string" && details.previewImage
          ? { preview_image: details.previewImage }
          : {}),
        ...(typeof details.previewCaption === "string" && details.previewCaption
          ? { preview_caption: details.previewCaption }
          : {}),
        // P1: 完整预览文本独立字段,绕过 codePreview 的 1200 截断。
        ...(typeof details.fullPreview === "string" && details.fullPreview
          ? { full_preview: details.fullPreview }
          : {}),
        // ADR-015 Confirm Center identity fields (optional; old clients ignore)
        ...(typeof details.workerId === "string" && details.workerId
          ? { worker_id: details.workerId }
          : {}),
        ...(typeof details.parentThreadId === "string" && details.parentThreadId
          ? { parent_thread_id: details.parentThreadId }
          : {}),
        ...(typeof details.orchestratorRunId === "string" && details.orchestratorRunId
          ? { orchestrator_run_id: details.orchestratorRunId }
          : {}),
        ...(typeof details.workerRoleLabel === "string" && details.workerRoleLabel
          ? { worker_role_label: details.workerRoleLabel }
          : {}),
        ...(typeof details.tabId === "number" && Number.isFinite(details.tabId)
          ? { tab_id: details.tabId }
          : {}),
        // ADR-016 G6: board_complete digest (old clients ignore)
        ...(details.boardCompleteDigest
          ? { board_complete_digest: details.boardCompleteDigest }
          : {}),
        // Plan A: offer enterprise session-trust checkbox (shell/netsec only)
        ...(details.offerEnterpriseSessionTrust === true
          ? { offer_enterprise_session_trust: true }
          : {}),
        ...(details.expertTeam
          ? { expert_team: details.expertTeam }
          : {}),
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
   * ADR-015 — Return the worker/thread id stamped when the confirmation was
   * issued. Used by handleSecurityConfirmationResponse for authoritative
   * stop_thread abort+drain (prefer server stamp over client stop_thread_id).
   */
  getWorkerId(confirmationId: string): string | undefined {
    return this.pending.get(confirmationId)?.workerId
  }

  /**
   * Phase 1 W8-windows / W9 — Return the manual-nonce challenge for this
   * confirmation (undefined when the dialog carries no nonce or the entry is
   * gone). Test/debug surface; response validation lives in respondFrom.
   */
  getNonceChallenge(confirmationId: string): string | undefined {
    return this.pending.get(confirmationId)?.nonceChallenge
  }

  /**
   * Resolve a confirmation in response to an inbound security.confirmation.response
   * arriving from `sourceWs`. If the pending entry has originWs set, sourceWs MUST
   * match — otherwise the response is rejected (outcome "origin_mismatch") and the
   * original confirmation stays pending. Outcome "unknown" means no pending entry.
   *
   * Phase 1 W8-windows / W9 manual nonce: when the entry carries a
   * nonceChallenge and the response is an approval, `nonceResponse` must match
   * (case-insensitive). A mismatch consumes one attempt, emits
   * security.confirmation.nonce_retry to the client, and keeps the entry
   * pending (outcome "nonce_retry"); the MAX_NONCE_ATTEMPTS-th mismatch
   * resolves the confirmation denied (outcome "nonce_locked"). Origin check
   * runs BEFORE nonce logic so a rogue loopback peer cannot burn attempts
   * (adversary amendment A1).
   */
  respondFrom(
    confirmationId: string,
    approved: boolean,
    sourceWs?: WebSocket,
    nonceResponse?: string,
    extras?: {
      addToSessionTrust?: boolean
      addToEnterpriseSessionTrust?: boolean
      expertTeamSlices?: Array<{ pack_id: string; brief: string }>
    },
  ): ConfirmationRespondResult {
    const pending = this.pending.get(confirmationId)
    if (!pending) return { outcome: "unknown" }

    if (pending.originWs !== undefined && pending.originWs !== sourceWs) {
      // Origin mismatch — a different socket attempted to answer this
      // confirmation. Leave the pending entry intact so the legitimate
      // origin can still respond (or it times out).
      return { outcome: "origin_mismatch" }
    }

    // Manual-nonce gate: only approvals carry a nonce worth validating;
    // denials resolve immediately regardless of the typed code.
    if (approved && pending.nonceChallenge !== undefined) {
      const expected = pending.nonceChallenge.toUpperCase()
      const got = (nonceResponse ?? "").trim().toUpperCase()
      if (got !== expected) {
        pending.nonceAttempts += 1
        const attemptsLeft = MAX_NONCE_ATTEMPTS - pending.nonceAttempts
        if (attemptsLeft <= 0) {
          clearTimeout(pending.timer)
          this.pending.delete(confirmationId)
          pending.send({ type: "security.confirmation.resolved", confirmation_id: confirmationId, approved: false })
          const decision: SecurityConfirmationDecision = {
            confirmationId,
            approved: false,
            reason: "denied",
          }
          pending.resolve(decision)
          this.fireTerminal(decision)
          return { outcome: "nonce_locked", attemptsLeft: 0 }
        }
        pending.send({
          type: "security.confirmation.nonce_retry",
          confirmation_id: confirmationId,
          attempts_left: attemptsLeft,
        })
        return { outcome: "nonce_retry", attemptsLeft }
      }
    }

    clearTimeout(pending.timer)
    this.pending.delete(confirmationId)
    pending.send({ type: "security.confirmation.resolved", confirmation_id: confirmationId, approved })
    const decision: SecurityConfirmationDecision = {
      confirmationId,
      approved,
      reason: approved ? "approved" : "denied",
      // Only honor session-trust opt-in when the dialog offered relevantApps
      // (host_computer) — blocks WS injection of the flag on other tools.
      ...(approved && extras?.addToSessionTrust === true && pending.relevantApps.length > 0
        ? { addToSessionTrust: true }
        : {}),
      // Plan A G5: only when this confirm offered enterprise checkbox + shell/netsec tool
      ...(approved &&
      extras?.addToEnterpriseSessionTrust === true &&
      pending.enterpriseSessionTrustOffered === true &&
      (pending.toolName === "shell_exec" || pending.toolName === "netsec_port_scan")
        ? { addToEnterpriseSessionTrust: true }
        : {}),
      ...(approved && pending.toolName === "spawn_expert_team" && Array.isArray(pending.expertTeamPackIds)
        ? {
            expertTeamSlices: (Array.isArray(extras?.expertTeamSlices) ? extras.expertTeamSlices : [])
              .map((s) => ({
                pack_id: String(s?.pack_id || "").trim(),
                brief: String(s?.brief ?? ""),
              }))
              .filter((s) => s.pack_id && pending.expertTeamPackIds!.includes(s.pack_id)),
          }
        : {}),
    }
    pending.resolve(decision)
    this.fireTerminal(decision)
    return { outcome: "resolved" }
  }

  /**
   * Privileged respond() — bypasses origin binding. ONE production caller: the
   * P0a Swift tray adapter (`companion/src/server.ts` Promise.race), which
   * dispatches confirmations over the tray's local stdin pipe AND the WS Side
   * Panel simultaneously using a pre-shared confirmationId. When tray responds
   * first, server.ts calls respond(confirmationId, approved) so the WS panel
   * also gets its `security.confirmation.resolved` event and closes.
   *
   * Safety contract: tray is a single-instance local subprocess (no remote
   * peers), its stdin pipe is owned exclusively by companion, and the binary
   * is hash-gated (SWIFT_TRAY_SHA256 in swift-tray-bridge.ts). Residual risk =
   * compromised local tray binary — same threat class as any host helper
   * (cmspark-host binary, etc.). Tests also use this path for non-origin-bound
   * simulation.
   *
   * NEVER call from request-handling code paths that route inbound WS messages
   * — those must go through respondFrom() which enforces the origin check.
   */
  respond(confirmationId: string, approved: boolean): boolean {
    const pending = this.pending.get(confirmationId)
    if (!pending) return false

    clearTimeout(pending.timer)
    this.pending.delete(confirmationId)
    pending.send({ type: "security.confirmation.resolved", confirmation_id: confirmationId, approved })
    const decision: SecurityConfirmationDecision = {
      confirmationId,
      approved,
      reason: approved ? "approved" : "denied",
    }
    pending.resolve(decision)
    this.fireTerminal(decision)
    return true
  }

  /**
   * Reject pending confirmations. If `ws` is provided, only entries whose
   * originWs === that socket are rejected. Unbound entries (originWs undefined)
   * survive a single-peer close — overlay disconnect must not kill outbound
   * L8 or retargeted overlay confirms; the 45s timeout remains the reaper.
   * Entries owned by a different socket also survive — closes [C-SRV-1]
   * where a disconnect on one connection would reject prompts on other
   * connections. If `ws` is omitted, all pending entries are rejected
   * (shutdown / backward-compatible drain).
   */
  rejectAll(reason: "disconnect" | "timeout" = "disconnect", ws?: WebSocket) {
    if (ws === undefined) {
      for (const [confirmationId, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.send({ type: "security.confirmation.resolved", confirmation_id: confirmationId, approved: false })
        const decision: SecurityConfirmationDecision = {
          confirmationId,
          approved: false,
          reason,
        }
        pending.resolve(decision)
        this.fireTerminal(decision)
      }
      this.pending.clear()
      return
    }

    for (const [confirmationId, pending] of this.pending) {
      if (pending.originWs !== ws) continue
      clearTimeout(pending.timer)
      pending.send({ type: "security.confirmation.resolved", confirmation_id: confirmationId, approved: false })
      const decision: SecurityConfirmationDecision = {
        confirmationId,
        approved: false,
        reason,
      }
      pending.resolve(decision)
      this.fireTerminal(decision)
      this.pending.delete(confirmationId)
    }
  }

  /**
   * ADR-015 GATE2: deny all pending confirmations stamped with `workerId`.
   * Called from chat.abort / fleet.stop_all / worker_cancel **before** lease release
   * so L2 finally can free admission + flight and zombie approve cannot re-HARD.
   * Emits security.confirmation.resolved (denied) so Confirm Center UI closes.
   * @returns count of confirmations rejected
   */
  rejectForWorker(workerId: string, reason: "denied" | "disconnect" = "denied"): number {
    if (!workerId) return 0
    let n = 0
    for (const [confirmationId, pending] of [...this.pending.entries()]) {
      if (pending.workerId !== workerId) continue
      clearTimeout(pending.timer)
      this.pending.delete(confirmationId)
      try {
        pending.send({
          type: "security.confirmation.resolved",
          confirmation_id: confirmationId,
          approved: false,
        })
      } catch {
        /* best-effort UI close */
      }
      const decision: SecurityConfirmationDecision = {
        confirmationId,
        approved: false,
        reason,
      }
      pending.resolve(decision)
      this.fireTerminal(decision)
      n++
    }
    return n
  }

  /** Test/debug: count pending entries (optionally filtered by workerId). */
  pendingCount(workerId?: string): number {
    if (workerId === undefined) return this.pending.size
    let n = 0
    for (const p of this.pending.values()) {
      if (p.workerId === workerId) n++
    }
    return n
  }

  /** True if any pending confirmation is stamped with workerId (cancel / soft-expire bind). */
  hasPendingForWorker(workerId: string): boolean {
    if (!workerId) return false
    for (const p of this.pending.values()) {
      if (p.workerId === workerId) return true
    }
    return false
  }

  /** True if confirmationId is still in the pending map. */
  isPending(confirmationId: string): boolean {
    return this.pending.has(confirmationId)
  }
}
