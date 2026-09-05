// security.confirmation.response handler (whitelist persistence + stop_thread).
// Extracted from server.ts (C10 Phase H1 mechanical split) — zero behavior change.
//
// FREEZE: confirmation-response algebra (origin-bound resolve, domain whitelist
// validation, thread whitelist, stop_thread abort/drain) lives HERE.
// Do NOT re-inflate server.ts with this body.
// Manager singleton stays server-owned; inject via ConfirmResponseDeps.

import type { WebSocket } from "ws"
import { logger } from "../logger"
import type { SecurityConfirmationManager } from "../security-confirmation"
import type { ThreadManager } from "../threads/thread-manager"
import { getThreadApprovals } from "../host-use/thread-approvals"

export type ConfirmResponseDeps = {
  securityConfirmations: SecurityConfirmationManager
  getConfig: () => { auto_approved_domains?: string[] }
  saveConfig: (partial: { auto_approved_domains: string[] }) => unknown
  getThreadManager: () => ThreadManager | null | undefined
  rejectPendingForThread: (threadId: string, reason: string) => number
  hasPendingForTab: (tabId: number, holderThreadId: string) => boolean
  rejectPendingForTab: (tabId: number, holderThreadId: string, reason: string) => number
}

/**
 * Process a `security.confirmation.response` from a WS peer: resolve the
 * pending confirmation (origin-bound via respondFrom), then — only when this
 * response is authoritative AND approved — persist the add_to_whitelist
 * patterns into auto_approved_domains. Patterns are validated against the
 * domains actually shown in the dialog, so a loopback peer cannot ship
 * ["*", "*.com", "attacker.com"] and poison the gate.
 *
 * Extracted from the ws.on("message") handler in startServer() so integration
 * tests can exercise the persistence path (the extension's add_to_whitelist
 * forwarding) without booting the full server. Logic is unchanged.
 */
export async function handleSecurityConfirmationResponse(
  ws: WebSocket,
  msg: any,
  sessionId: string | undefined,
  deps: ConfirmResponseDeps,
): Promise<void> {
  const {
    securityConfirmations,
    getConfig,
    saveConfig,
    getThreadManager,
    rejectPendingForThread,
    hasPendingForTab,
    rejectPendingForTab,
  } = deps

  const confirmationId = String(msg.confirmation_id || "")
  const approved = msg.approved === true
  // stop_thread: Confirm Center "stop" — deny confirm AND authoritatively
  // abort+drain the stamped worker (do not rely solely on client chat.abort).
  const stopThread = msg.stop_thread === true
  const clientStopThreadId =
    typeof msg.stop_thread_id === "string" && msg.stop_thread_id.length > 0
      ? String(msg.stop_thread_id)
      : undefined

  // Validate add_to_whitelist against the domains actually shown in the
  // dialog. Without this check, any loopback WS peer could ship a
  // crafted response with add_to_whitelist: ["*", "*.com", "attacker.com"]
  // and permanently bypass the dangerous-tool gate.
  const rawWhitelist: string[] = Array.isArray(msg.add_to_whitelist)
    ? msg.add_to_whitelist.map((p: any) => String(p || "").trim()).filter(Boolean)
    : []
  const relevantDomains = securityConfirmations.getRelevantDomains(confirmationId) || []
  const allowedPatterns = new Set<string>()
  for (const d of relevantDomains) {
    const lower = d.toLowerCase()
    allowedPatterns.add(lower)
    allowedPatterns.add(`*.${lower}`)
  }
  const validPatterns: string[] = []
  const rejectedPatterns: string[] = []
  for (const p of rawWhitelist) {
    if (allowedPatterns.has(p.toLowerCase())) {
      validPatterns.push(p)
    } else {
      rejectedPatterns.push(p)
    }
  }
  if (rejectedPatterns.length > 0) {
    logger.warn("security.whitelist.invalid_patterns_rejected", {
      confirmation_id: confirmationId,
      relevant_domains: relevantDomains,
      rejected: rejectedPatterns,
    })
  }

  // Phase 1 W7 — Validate add_to_thread_whitelist (boolean) for host_use tools.
  // Validates the requested bundle id against relevantApps originally shown.
  // Same anti-injection contract as add_to_whitelist above.
  const rawThreadWhitelist: boolean = msg.add_to_thread_whitelist === true
  const relevantApps = securityConfirmations.getRelevantApps(confirmationId) || []
  // Capture metadata BEFORE respondFrom() deletes the pending entry.
  const confirmationToolName = securityConfirmations.getToolName(confirmationId)
  const stampedWorkerId = securityConfirmations.getWorkerId(confirmationId)
  let threadWhitelistApp: string | null = null
  if (rawThreadWhitelist && relevantApps.length > 0) {
    // The first (and currently only) relevant app is what the user was shown.
    // User cannot type a different bundle id — the checkbox is grayed-out
    // pre-filled by the extension UI.
    threadWhitelistApp = relevantApps[0]
  } else if (rawThreadWhitelist && relevantApps.length === 0) {
    // WS injection attempt: client sent add_to_thread_whitelist=true for a
    // confirmation that didn't show any app checkbox.
    logger.warn("security.thread_whitelist.relevant_apps_missing", {
      confirmation_id: confirmationId,
    })
  }

  // Resolve the confirmation FIRST so a saveConfig failure cannot hang the
  // approved tool call. Persistence runs after, best-effort. By the time the
  // LLM's next tool call reaches the whitelist gate (next macrotask),
  // fs.writeFileSync has completed.
  //
  // Phase 1 W8-windows / W9: pass the typed manual nonce into respondFrom.
  // The extension sends nonce_response (uppercased by the UI); matching is
  // case-insensitive. Adversary amendment A4: nonce_retry / nonce_locked are
  // dedicated audit events and must NOT be lumped into
  // origin_mismatch_or_unknown.
  const nonceResponse = typeof msg.nonce_response === "string" ? msg.nonce_response : undefined
  // Grill Q2: host_computer session auto-approve checkbox (validated in respondFrom
  // against relevantApps non-empty).
  const addToSessionTrust = msg.add_to_session_trust === true
  const addToEnterpriseSessionTrust = msg.add_to_enterprise_session_trust === true
  // stop_thread always resolves as deny (even if client sent approved:true)
  const effectiveApproved = stopThread ? false : approved
  const expertTeamSlices = Array.isArray(msg.expert_team_slices)
    ? msg.expert_team_slices
        .map((s: any) => ({
          pack_id: String(s?.pack_id || "").trim(),
          brief: String(s?.brief ?? ""),
        }))
        .filter((s: { pack_id: string }) => s.pack_id)
    : undefined
  const respondResult = securityConfirmations.respondFrom(confirmationId, effectiveApproved, ws, nonceResponse, {
    addToSessionTrust: stopThread ? false : addToSessionTrust,
    addToEnterpriseSessionTrust: stopThread ? false : addToEnterpriseSessionTrust,
    expertTeamSlices,
  })
  const responded = respondResult.outcome === "resolved"
  if (respondResult.outcome === "unknown" || respondResult.outcome === "origin_mismatch") {
    // Either no such pending entry, or the response arrived on a different
    // socket than the one the confirmation was issued to. [C-SEC-2]: do not
    // silently drop — log so operators can spot the pattern (e.g., a rogue
    // local process trying to self-approve).
    logger.warn("security.confirmation.origin_mismatch_or_unknown", {
      confirmation_id: confirmationId,
      approved_requested: approved,
      stop_thread: stopThread,
    })
  } else if (respondResult.outcome === "nonce_retry") {
    // Wrong code typed — entry stays pending; the client got a
    // security.confirmation.nonce_retry with attempts_left.
    logger.warn("security.confirmation.nonce_retry", {
      confirmation_id: confirmationId,
      attempts_left: respondResult.attemptsLeft,
    })
  } else if (respondResult.outcome === "nonce_locked") {
    // Max attempts exhausted — confirmation resolved denied.
    logger.warn("security.confirmation.nonce_locked", {
      confirmation_id: confirmationId,
      attempts_left: 0,
      reason: "max nonce attempts exceeded",
    })
  }

  // ADR-015 GATE1/GATE2: authoritative stop — abort LLM + reject pending + release leases.
  // Prefer server-stamped worker_id over client stop_thread_id (anti-wrong-target).
  // Note: this response already denied the *current* confirmation via respondFrom;
  // rejectForWorker clears any *other* open confirms for the same worker.
  if (stopThread && responded) {
    const stopTarget =
      (stampedWorkerId && stampedWorkerId.length > 0 ? stampedWorkerId : undefined) ||
      clientStopThreadId
    if (stopTarget) {
      try {
        // #307: cockpit stop is user-initiated — abort + clear queue BEFORE any await,
        // so a finishing chat.create finally cannot drain the queue mid-stop.
        let nextRunCancelled = 0
        try {
          const { abortThreadChat } = await import("../message-router")
          if (typeof abortThreadChat === "function") {
            nextRunCancelled = abortThreadChat(stopTarget, { clearQueue: true }).cancelled
          }
        } catch {
          /* optional if router not loaded */
        }
        // G13: abandon intents before pending reject + lease release
        let intentsAbandoned = 0
        try {
          const { abandonWorkerIntents } = await import("../board")
          const ab = await abandonWorkerIntents(getThreadManager() as ThreadManager, stopTarget, {
            reason: "stop_thread",
          })
          intentsAbandoned = ab.abandoned
        } catch {
          /* best-effort */
        }
        const confirmsRejected = securityConfirmations.rejectForWorker(stopTarget, "denied")
        const rejected = rejectPendingForThread(stopTarget, `stop_thread:${confirmationId}`)
        const { releaseLeasesForThreadPendingAware } = await import("../orchestrator/tab-lease")
        const { released, drained } = releaseLeasesForThreadPendingAware(
          stopTarget,
          `stop_thread:${confirmationId}`,
          { hasPendingForTab, rejectPendingForTab },
        )
        // stop_thread must also kill in-flight shell_exec (same gap as chat.abort)
        try {
          const { abortShellRunsForThread } = await import("../capability/shell")
          const shellKilled = abortShellRunsForThread(stopTarget)
          if (shellKilled > 0) {
            logger.warn("shell.abort.stop_thread", {
              stop_target: stopTarget,
              matched: shellKilled,
            })
          }
        } catch {
          /* best-effort */
        }
        logger.info("security.confirmation.stop_thread", {
          confirmation_id: confirmationId,
          stop_target: stopTarget,
          stamped_worker_id: stampedWorkerId || null,
          client_stop_thread_id: clientStopThreadId || null,
          rejected_pending: rejected,
          leases_released: released,
          confirms_rejected: confirmsRejected,
          leases_drained: drained,
          intents_abandoned: intentsAbandoned,
          cancelled_next_run: nextRunCancelled,
        })
      } catch (err: any) {
        logger.warn("security.confirmation.stop_thread_failed", {
          confirmation_id: confirmationId,
          stop_target: stopTarget,
          error: err?.message || String(err),
        })
      }
    } else {
      logger.warn("security.confirmation.stop_thread_no_target", {
        confirmation_id: confirmationId,
      })
    }
  }

  // Only persist whitelist additions when the confirmation was actually
  // resolved by THIS response. If respondFrom returned false (origin mismatch,
  // unknown id, or already-expired entry), the response is not authoritative —
  // accepting its add_to_whitelist payload would let any loopback WS peer that
  // can guess a confirmation_id poison auto_approved_domains without ever
  // resolving the prompt.
  if (responded && effectiveApproved && validPatterns.length > 0) {
    try {
      const current = getConfig().auto_approved_domains || []
      const seen = new Set(current.map((d: string) => d.toLowerCase()))
      // Lowercase + dedupe on persist. validPatterns is already validated
      // case-insensitively, so storing the lowercase form keeps config tidy
      // (matchDomain lowercases both sides, so matching is unaffected). Adding
      // to `seen` as we go also dedupes within this single response.
      const newPatterns: string[] = []
      for (const p of validPatterns) {
        const lower = p.toLowerCase()
        if (!seen.has(lower)) {
          seen.add(lower)
          newPatterns.push(lower)
        }
      }
      if (newPatterns.length > 0) {
        saveConfig({ auto_approved_domains: [...current, ...newPatterns] })
        logger.info("security.whitelist.added", {
          confirmation_id: confirmationId,
          patterns: newPatterns,
        })
      }
    } catch (err: any) {
      // Persistence is best-effort — don't fail the tool call.
      logger.error("security.whitelist.persist_failed", {
        confirmation_id: confirmationId,
        error: err?.message || String(err),
      })
    }
  } else if (!responded && validPatterns.length > 0) {
    // Defensive: log every attempt to add via a non-authoritative response so
    // operators can spot a peer probing confirmation ids.
    logger.warn("security.whitelist.add_ignored_non_authoritative", {
      confirmation_id: confirmationId,
      valid_patterns: validPatterns,
    })
  }

  // Phase 1 W7 — Record thread-scoped trust when user approved with
  // add_to_thread_whitelist=true. Only for read operations (Q1 blocker:
  // writes always require biometric per call, never thread-trusted).
  if (responded && effectiveApproved && threadWhitelistApp) {
    const toolName = confirmationToolName
    if (toolName === "host_read" && sessionId) {
      getThreadApprovals().add(sessionId, threadWhitelistApp, "read")
      logger.info("security.thread_whitelist.added", {
        confirmation_id: confirmationId,
        thread_id: sessionId,
        bundle_id: threadWhitelistApp,
        kind: "read",
      })
    } else if (toolName === "host_app" && sessionId) {
      // App tab WP3 — owner decision 2 (2026-07-18, W7 Blocker-1 amendment):
      // L0 no-arg app launch MAY be thread-trusted under kind "app-launch".
      // Reachable only when the gate offered the checkbox (policy "ai" —
      // "manual" never offers it; the checkbox payload is validated against
      // the relevantApps shown, so an injected grant for a manual app is
      // impossible here). The gate additionally never consults trust for
      // "manual", and apps.remove/set_policy/set_enabled(false) clear it.
      getThreadApprovals().add(sessionId, threadWhitelistApp, "app-launch")
      logger.info("security.thread_whitelist.added", {
        confirmation_id: confirmationId,
        thread_id: sessionId,
        bundle_id: threadWhitelistApp,
        kind: "app-launch",
      })
    } else if (toolName === "host_write") {
      // Q1 ship blocker: writes NEVER thread-trust. Log rejection so
      // operators can spot a buggy/malicious client attempting bypass.
      logger.warn("security.thread_whitelist.write_rejected", {
        confirmation_id: confirmationId,
        bundle_id: threadWhitelistApp,
        reason: "biometric per-call is non-negotiable for writes (W7 Q1 blocker)",
      })
    }
  }
}
