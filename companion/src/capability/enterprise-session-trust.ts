/**
 * Enterprise L2 session trust (Plan A) — per-thread, process-memory grants
 * that skip interactive L2 for shell_exec / netsec_port_scan under scope ∩.
 *
 * G3: per-family only (netsec grant ≠ shell grant)
 * G4: idle 30m + hard 8h from last **interactive** grant (no touch on auto-approve)
 *
 * Upstream: docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md
 */

import * as crypto from "crypto"

export type EnterpriseToolFamily = "netsec" | "shell"

/** Idle: no interactive re-approval within this window → grant inactive. */
export const ENTERPRISE_IDLE_MS = 30 * 60 * 1000

/** Hard cap from first grant. */
export const ENTERPRISE_HARD_TTL_MS = 8 * 60 * 60 * 1000

export type EnterpriseSessionGrant = {
  grantedAt: number
  lastInteractiveAt: number
  families: EnterpriseToolFamily[]
  /** Netsec: fingerprint of allowlist + task_auth at grant time */
  scopeFingerprint?: string
}

export function resolveEnterpriseTrustKey(
  threadId: string | undefined | null,
): string | null {
  const t = typeof threadId === "string" ? threadId.trim() : ""
  if (!t) return null
  return `thread:${t}`
}

export function familyOfTool(toolName: string): EnterpriseToolFamily | null {
  if (toolName === "netsec_port_scan") return "netsec"
  if (toolName === "shell_exec") return "shell"
  return null
}

/** Stable fingerprint for netsec scope (allowlist + task auth targets). */
export function netsecScopeFingerprint(
  allowlist: string[],
  taskAuthTargets: string[] | null | undefined,
): string {
  const a = [...(allowlist || [])].map((x) => x.trim().toLowerCase()).filter(Boolean).sort()
  const t = [...(taskAuthTargets || [])].map((x) => x.trim().toLowerCase()).filter(Boolean).sort()
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ a, t }))
    .digest("hex")
    .slice(0, 24)
}

export class EnterpriseSessionTrust {
  private grants = new Map<string, EnterpriseSessionGrant>()

  grant(
    trustKey: string,
    families: EnterpriseToolFamily[],
    opts?: { scopeFingerprint?: string; now?: number },
  ): void {
    if (!trustKey.startsWith("thread:")) return
    const now = opts?.now ?? Date.now()
    const uniq = [...new Set(families)].filter(
      (f): f is EnterpriseToolFamily => f === "netsec" || f === "shell",
    )
    if (uniq.length === 0) return

    const prev = this.grants.get(trustKey)
    const merged = new Set<EnterpriseToolFamily>(prev?.families || [])
    for (const f of uniq) merged.add(f)

    this.grants.set(trustKey, {
      grantedAt: prev?.grantedAt ?? now,
      lastInteractiveAt: now,
      families: [...merged],
      scopeFingerprint:
        opts?.scopeFingerprint !== undefined
          ? opts.scopeFingerprint
          : prev?.scopeFingerprint,
    })
  }

  /**
   * Pure read — does NOT refresh lastInteractiveAt (G4).
   * Optional expectedFingerprint: if grant has fingerprint and mismatch → inactive.
   */
  isActive(
    trustKey: string,
    family: EnterpriseToolFamily,
    now = Date.now(),
    expectedFingerprint?: string | null,
  ): boolean {
    const g = this.grants.get(trustKey)
    if (!g) return false
    if (!g.families.includes(family)) return false
    if (now - g.lastInteractiveAt > ENTERPRISE_IDLE_MS) return false
    if (now - g.grantedAt > ENTERPRISE_HARD_TTL_MS) return false
    if (
      family === "netsec" &&
      g.scopeFingerprint &&
      expectedFingerprint != null &&
      expectedFingerprint !== "" &&
      g.scopeFingerprint !== expectedFingerprint
    ) {
      return false
    }
    return true
  }

  getGrant(trustKey: string): EnterpriseSessionGrant | null {
    return this.grants.get(trustKey) ?? null
  }

  /** Remaining ms until idle or hard expiry (min), or 0 if inactive. */
  remainingMs(trustKey: string, family: EnterpriseToolFamily, now = Date.now()): number {
    if (!this.isActive(trustKey, family, now)) return 0
    const g = this.grants.get(trustKey)!
    const idleLeft = ENTERPRISE_IDLE_MS - (now - g.lastInteractiveAt)
    const hardLeft = ENTERPRISE_HARD_TTL_MS - (now - g.grantedAt)
    return Math.max(0, Math.min(idleLeft, hardLeft))
  }

  revoke(trustKey: string): void {
    this.grants.delete(trustKey)
  }

  revokeFamily(trustKey: string, family: EnterpriseToolFamily): void {
    const g = this.grants.get(trustKey)
    if (!g) return
    const next = g.families.filter((f) => f !== family)
    if (next.length === 0) this.grants.delete(trustKey)
    else this.grants.set(trustKey, { ...g, families: next })
  }

  revokeAll(): void {
    this.grants.clear()
  }

  /** Test/debug */
  size(): number {
    return this.grants.size
  }
}

/** Process-lifetime singleton (companion restart clears). */
export const enterpriseSessionTrust = new EnterpriseSessionTrust()
