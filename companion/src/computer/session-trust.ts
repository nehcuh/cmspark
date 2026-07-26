// Per-session re-L2 suppression + initial-L2 skip for computer-use.
//
// PROBLEM: every re-L2 in a task (FOREGROUND-YIELD pause, budget-exhausted
// pause, uncross-verified-click pause, dialog-suspected pause) re-asks the
// user. After the initial task L2 already gated the WHOLE task (every type
// literal, the action budget, the target app), these mid-task re-asks are
// almost always the same human saying "yes, continue" repeatedly — pure UX
// friction.
//
// =====================================================================
// v4.1 (Grok v4.1 §D3.1–D3.4 / Pi v4.1 RESOLVED-WITH-CAVEAT)
// =====================================================================
// Three hardening layers added on top of the original grant store:
//
//   1. reL2ShouldPrompt(reason): predicate that splits re-L2 reasons into
//      "silent auto-approve when trusted" vs "always prompt". Previously
//      reL2() auto-approved ALL reasons when trusted — too permissive for
//      danger/experimental surfaces. Unknown tags fail-closed (prompt).
//
//   2. Idle expiry (30 min default, configurable). Grants carry a timestamp;
//      a grant older than IDLE_EXPIRY_MS ago is treated as expired and the
//      next action re-prompts. Reduces blast radius of a hijacked session.
//
//   3. credentialSurfaceSeen latch: when after-frame OCR detects a credential
//      surface (password field, login form, etc.), the NEXT initial-L2 cannot
//      be skipped even if the session is trusted. The latch is set defensively
//      on OCR failure (null result → set TRUE) per Pi v4.1 caveat.
//
// SCOPE / SAFETY (intentionally narrower than ThreadApprovals):
//   - This map ONLY suppresses re-L2 (mid-task pauses) AND enables initial-L2
//     skip at server.ts gate when (trusted + non-expired + no credential latch
//     + corpus ⊆ prior + no T3-only flags).
//   - It is NOT a ThreadApprovals kind. W7 Blocker 1
//     (host-use/thread-approvals.ts header) forbids new ThreadApprovals
//     kinds without an owner decision; this structure lives outside that
//     module and governs a different gate.
//   - Process lifetime only (companion restart clears all trust). No
//     persistent cross-session trust.
//   - Keyed by (trustKey, appToken). Grill Q1=C (2026-07-26): trustKey is
//     `thread:<chatThreadId>` when the chat thread is known, else
//     `ws:<wsSessionId>`. Initial-L2 **skip** is allowed only for thread:
//     keys (no thread → no silent multi-task trust). Mid-task re-L2 silence
//     still uses isTrusted() for either key form after an interactive approve.
//   - Force-interactive carve-out (PROMPT_ALWAYS_TAGS + reL2ShouldPrompt /
//     executor reL2): computer.danger_detected and
//     computer.experimental_suggestion (TinyClick G4) NEVER auto-approve under
//     session trust. v4.1 also keeps computer.foreground_yielded always-prompt.
//
//   - Grill Q2 (2026-07-26): grant.explicitOptIn is set only when the user
//     checks "本会话自动同意同类操作". Without it, mid-task reL2 may still
//     silent-approve (task-local), but G1 **initial** L2 skip is denied.
//
// The grant is recorded by the server once the initial task L2 is approved
// (server.ts). The executor consults it at the top of reL2() and at the
// initial-L2 gate (server.ts:465-470, :823-940).

/** Idle expiry for grants. After this much inactivity, re-prompt. */
export const IDLE_EXPIRY_MS = 30 * 60 * 1000 // 30 min (Pi v4.1 D3.4 mandatory default)

/**
 * Build the outer trust map key (grill Q1=C).
 * - Prefer chat thread id so "本会话" matches user mental model across WS reconnect.
 * - Fall back to WS session id when thread is unknown; caller must not initial-skip.
 */
export function resolveComputerTrustKey(
  threadId: string | undefined | null,
  wsSessionId: string,
): string {
  const t = typeof threadId === "string" ? threadId.trim() : ""
  if (t.length > 0) return `thread:${t}`
  return `ws:${wsSessionId}`
}

/** True when this key may participate in G1 multi-task initial-L2 skip. */
export function trustKeyAllowsInitialSkip(trustKey: string): boolean {
  return typeof trustKey === "string" && trustKey.startsWith("thread:")
}

/**
 * Re-L2 tag set that must ALWAYS prompt, even when the session is trusted.
 * Tags come from the `dangerous` array at each reL2() emit site — stable
 * strings like "computer.danger_detected". Narrative reasons (first arg)
 * are NOT matched here because they carry interpolated fgName / target text.
 *
 * Update together with emit sites — `reL2ReasonExhaustiveness.test.ts`
 * enumerates every emit-site tag and asserts membership.
 */
const PROMPT_ALWAYS_TAGS = new Set<string>([
  "computer.danger_detected",         // real risk surface detected
  "computer.experimental_suggestion", // TinyClick uncalibrated layer
  "computer.foreground_yielded",      // foreign process took frontmost
])

/**
 * The full set of re-L2 tags emitted by executor.ts. Adding a tag requires
 * updating this set + the exhaustiveness unit test.
 *
 * Source: grep `reL2(` call sites in executor.ts; second argument is the
 * stable tag array.
 */
const KNOWN_TAGS = new Set<string>([
  "computer.danger_detected",
  "computer.experimental_suggestion",
  "computer.foreground_yielded",
  "computer.task_induced_dialog",
  "computer.budget_exhausted",
  "computer.uncrossverified_exceeded",
])

/**
 * Decide whether a given re-L2 call MUST prompt despite trust.
 *
 * Returns `true` (must prompt) when ANY tag is in PROMPT_ALWAYS_TAGS, OR
 * when ANY tag is unknown (fail-closed per Pi v4.1 caveat: better to
 * over-prompt than to silently auto-approve a new risk class).
 *
 * Returns `false` (silent auto-approve OK) when the call has tags that are
 * all known AND none are in PROMPT_ALWAYS_TAGS.
 *
 * Caller is responsible for checking trust + expiry before consulting this.
 */
export function reL2ShouldPrompt(tags: string[]): boolean {
  if (tags.length === 0) return true // fail-closed on missing tags
  for (const tag of tags) {
    if (!KNOWN_TAGS.has(tag)) return true
    if (PROMPT_ALWAYS_TAGS.has(tag)) return true
  }
  return false
}

/**
 * Trust grant record. `grantedAt` enables idle expiry; the original per-app
 * grant set is preserved but now stores last-touched timestamps.
 *
 * `corpus` (P5 / Grok v4.1 §3.2): the accumulated set of type.text literals
 * the user has approved for this (sessionId, appToken). The G1 initial-L2
 * skip gate consults this — a new task whose type corpus is a subset of the
 * stored corpus is eligible for silent skip; any new literal forces a prompt.
 *
 * `maxBudgetSeen` (Pi final-review caveat 1, 2026-07-24): the largest task
 * budget the user has interactively approved for this (sessionId, appToken).
 * Skip-eligible tasks must have budget ≤ maxBudgetSeen — volume IS its own
 * blast-radius dimension independent of corpus identity.
 *
 * `maxActionsSeen` (grill Q3, 2026-07-26): largest actions[] length interactively
 * approved — skip requires actions.length ≤ maxActionsSeen.
 *
 * `explicitOptIn` (grill Q2): true only when user checked session auto-approve.
 * G1 initial-L2 skip requires this; mid-task reL2 silence does not.
 */
interface GrantRecord {
  appToken: string
  grantedAt: number
  lastTouchedAt: number
  /** Set TRUE when after-frame OCR detected a credential surface. Next initial-L2 cannot skip. */
  credentialSurfaceSeen: boolean
  /** Approved type.text literals accumulated across interactive approvals. P5 (Grok v4.1 §3.2). */
  corpus: Set<string>
  /** Largest budget ever interactively approved. P5 (Pi caveat 1, 2026-07-24). */
  maxBudgetSeen: number
  /** Largest actions[] length interactively approved (grill Q3). */
  maxActionsSeen: number
  /** User checked "本会话自动同意同类操作" (grill Q2). */
  explicitOptIn: boolean
}

export interface ComputerTrustGrantOptions {
  /** User checked session auto-approve checkbox. OR with existing flag (sticky true). */
  explicitOptIn?: boolean
}

/** Singleton store: trustKey -> appToken -> grant records. */
export class ComputerSessionTrust {
  private trusted = new Map<string, Map<string, GrantRecord>>()

  /**
   * Record that this trust key approved a task for the given app token.
   * Idempotent. `sessionId` parameter name kept for call-site compatibility —
   * pass resolveComputerTrustKey(...) result.
   */
  grant(sessionId: string, appToken: string, opts?: ComputerTrustGrantOptions): void {
    if (!sessionId || !appToken) return
    let inner = this.trusted.get(sessionId)
    if (!inner) {
      inner = new Map()
      this.trusted.set(sessionId, inner)
    }
    const now = Date.now()
    const existing = inner.get(appToken)
    const explicit =
      opts?.explicitOptIn === true || existing?.explicitOptIn === true
    inner.set(appToken, {
      appToken,
      grantedAt: existing?.grantedAt ?? now,
      lastTouchedAt: now,
      credentialSurfaceSeen: existing?.credentialSurfaceSeen ?? false,
      corpus: existing?.corpus ?? new Set<string>(),
      maxBudgetSeen: existing?.maxBudgetSeen ?? 0,
      maxActionsSeen: existing?.maxActionsSeen ?? 0,
      explicitOptIn: explicit,
    })
  }

  /** True when grant has explicit session auto-approve opt-in (and is live). */
  hasExplicitOptIn(sessionId: string, appToken: string): boolean {
    const rec = this.record(sessionId, appToken)
    if (!rec || !rec.explicitOptIn) return false
    if (Date.now() - rec.lastTouchedAt > IDLE_EXPIRY_MS) return false
    if (rec.credentialSurfaceSeen) return false
    return true
  }

  /**
   * True when this session has already approved a task for the app token AND
   * the grant has not been idle-expired AND the credential latch is not set.
   *
   * **Pure read** (Pi final-review caveat 2, 2026-07-24): does NOT refresh
   * lastTouchedAt. The 30-min idle window is anchored to the LAST INTERACTIVE
   * APPROVAL (or explicit grant()), not to skip-path consults. This makes
   * "30 min idle" mean "30 min since the user last said yes" — a hot session
   * firing corpus-subset tasks every <30 min still expires 30 min after the
   * last interactive yes, bounding the silent-trust blast radius.
   *
   * Callers that want to check raw trust (regardless of expiry / latch)
   * should use `isTrustedRaw`.
   */
  isTrusted(sessionId: string, appToken: string): boolean {
    const rec = this.record(sessionId, appToken)
    if (!rec) return false
    if (Date.now() - rec.lastTouchedAt > IDLE_EXPIRY_MS) return false
    if (rec.credentialSurfaceSeen) return false
    return true
  }

  /** Raw trust check — ignores expiry / latch. For diagnostic / audit only. */
  isTrustedRaw(sessionId: string, appToken: string): boolean {
    return !!this.record(sessionId, appToken)
  }

  /**
   * Mark that the next initial-L2 for this (sessionId, appToken) MUST prompt
   * because a credential surface was detected in the latest OCR pass.
   *
   * Per Pi v4.1 caveat: when `seen === null` (OCR failed), set TRUE
   * defensively — never silently skip when the safety signal is missing.
   */
  markCredentialSurfaceSeen(sessionId: string, appToken: string, seen: boolean | null): void {
    if (!sessionId || !appToken) return
    let inner = this.trusted.get(sessionId)
    if (!inner) {
      inner = new Map()
      this.trusted.set(sessionId, inner)
    }
    const now = Date.now()
    const existing = inner.get(appToken)
    inner.set(appToken, {
      appToken,
      grantedAt: existing?.grantedAt ?? now,
      lastTouchedAt: now,
      // Defensive: seen === null (OCR failed) → treat as seen.
      credentialSurfaceSeen: seen === null ? true : (existing?.credentialSurfaceSeen || seen),
      corpus: existing?.corpus ?? new Set<string>(),
      maxBudgetSeen: existing?.maxBudgetSeen ?? 0,
      maxActionsSeen: existing?.maxActionsSeen ?? 0,
      explicitOptIn: existing?.explicitOptIn ?? false,
    })
  }

  /**
   * Record the budget of an interactively-approved task. The G1 skip gate
   * rejects silent-skip for tasks whose budget EXCEEDS this stored value —
   * volume is its own blast-radius dimension independent of corpus identity.
   * Monotonically increasing (uses Math.max).
   *
   * P5 / Pi final-review caveat 1 (2026-07-24).
   */
  recordBudget(sessionId: string, appToken: string, budget: number): void {
    const rec = this.record(sessionId, appToken)
    if (!rec) return
    const b = Math.max(0, Math.floor(budget))
    if (b > rec.maxBudgetSeen) rec.maxBudgetSeen = b
  }

  /**
   * Record actions[] length of an interactively-approved task (grill Q3).
   * Monotonically increasing.
   */
  recordActions(sessionId: string, appToken: string, actionCount: number): void {
    const rec = this.record(sessionId, appToken)
    if (!rec) return
    const n = Math.max(0, Math.floor(actionCount))
    if (n > rec.maxActionsSeen) rec.maxActionsSeen = n
  }

  /**
   * Returns the largest budget ever interactively approved for this
   * (sessionId, appToken). Returns 0 when no grant exists. Skip gate should
   * treat 0 as "no budget ever approved" → must prompt.
   */
  maxBudgetSeen(sessionId: string, appToken: string): number {
    return this.record(sessionId, appToken)?.maxBudgetSeen ?? 0
  }

  /** Largest actions[] length ever interactively approved; 0 if none. */
  maxActionsSeen(sessionId: string, appToken: string): number {
    return this.record(sessionId, appToken)?.maxActionsSeen ?? 0
  }

  /**
   * Clear the credential latch for this (sessionId, appToken). Called by the
   * server after a successful INTERACTIVE initial-L2 approve — the user has
   * just re-consented with a fresh preview, so the latch's job is done.
   *
   * P5 / Grok v4.1 §3.2: "After a successful interactive initial L2 approve
   * while credentialSurfaceSeen was true: clear the flag."
   */
  clearCredentialLatch(sessionId: string, appToken: string): void {
    const rec = this.record(sessionId, appToken)
    if (rec) rec.credentialSurfaceSeen = false
  }

  /**
   * Add type.text literals to the approved corpus for (sessionId, appToken).
   * Called by the server after a successful interactive initial-L2 approve.
   *
   * Idempotent. No-op if no grant exists (defensive — caller should have
   * just called grant() first).
   */
  extendCorpus(sessionId: string, appToken: string, texts: string[]): void {
    if (!sessionId || !appToken) return
    const rec = this.record(sessionId, appToken)
    if (!rec) return
    for (const t of texts) {
      if (typeof t === "string" && t.length > 0) rec.corpus.add(t)
    }
  }

  /**
   * Returns true when EVERY text in `texts` is already in the approved corpus
   * for (sessionId, appToken). Used by the G1 skip gate (Grok v4.1 §3.2) to
   * decide whether the new task's type corpus is fully covered by prior
   * approval. Empty `texts` (no type actions) returns true.
   *
   * Does NOT consult idle expiry or credential latch — pair with isTrusted().
   */
  corpusContains(sessionId: string, appToken: string, texts: string[]): boolean {
    const rec = this.record(sessionId, appToken)
    if (!rec) return texts.length === 0
    for (const t of texts) {
      if (!rec.corpus.has(t)) return false
    }
    return true
  }

  /** Drop all trust for a session (companion calls this on thread delete). */
  clearSession(sessionId: string): void {
    this.trusted.delete(sessionId)
  }

  /** Drop every trust entry for an app token, across all sessions. */
  clearApp(appToken: string): number {
    let removed = 0
    for (const [, inner] of Array.from(this.trusted)) {
      for (const key of Array.from(inner.keys())) {
        if (key === appToken) {
          inner.delete(key)
          removed++
        }
      }
    }
    for (const [sid, inner] of Array.from(this.trusted)) {
      if (inner.size === 0) this.trusted.delete(sid)
    }
    return removed
  }

  /** For diagnostics / testing. */
  size(): number {
    let total = 0
    for (const inner of this.trusted.values()) total += inner.size
    return total
  }

  private record(sessionId: string, appToken: string): GrantRecord | undefined {
    const inner = this.trusted.get(sessionId)
    return inner?.get(appToken)
  }
}

// Singleton — process lifetime; dies on companion restart (intentional).
let _instance: ComputerSessionTrust | undefined
export function getComputerSessionTrust(): ComputerSessionTrust {
  if (!_instance) _instance = new ComputerSessionTrust()
  return _instance
}
