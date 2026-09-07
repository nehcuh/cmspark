# Actual model: deepseek-v4-pro

## Standalone NIT list — R2 transport source (unchanged)

Scope restated in one line: frozen R2 adds grant-bound context sessions (issue/resolve/scope) + HTTP endpoints, session-scoped exfil denial with pre/post-read grant re-checks, and no-retry client session caching. Prior notes omitted by output truncation are not reconstructed; findings below are fresh analysis of the shipped source only.

Nothing found at P0/P1 in the correctness or security passes: grant/session binding, pre/post-async revocation checks, L9 lease gating, HITL-disconnect, and no-retry semantics all trace to the code as claimed. The prior PASS verdict survives. The following are P2 audit-fidelity/TOCTOU nits with concrete repro, in severity order.

---

**NIT-1 (P2, audit fidelity) — silent denials on session-bound invoke preflight.** `companion-http.ts` (session resolve try/catch, ~L496–504 in diff): when `resolve()` throws (forged/expired/borrowed handle) the function returns `{ok:false, ...}` **without** `appendOutboundMcpAudit`, unlike every other denial path in this handler. Failure mode: an attacker probing random handles against a stolen-but-live grant token, or repeated expiry recoveries, generate zero audit entries — incident triage cannot see the attempt series. The sibling `POST /session` handler (~L804–820) has the same gap for `CAPACITY` and issue-time `GRANT_DENIED` (test observes sessions via a server listener, not the audit log). Fix: append an audit record with the resolved `error_code` before both early returns.

**NIT-2 (P2, audit/wire conflation) — expiry is coded as `SCOPE_DENIED`.** `context-session.ts` L17: `ContextSessionUnavailable` calls `super("SCOPE_DENIED")`, and the catch path (`companion-http.ts` ~L751–765) maps `e.message` into `error_code`, so a session expiring mid-metadata-resolve is logged — and returned — as `SCOPE_DENIED`, the same code as a genuine origin denial. Only the `session_invalid: true` boolean distinguishes them. Failure mode: operators/audit consumers cannot distinguish "wrong origin denied" (security-relevant) from "stale handle, benign" without correlating the boolean, and the bare-code-as-error text (`error: "CAPACITY"`, `"SCOPE_DENIED"`) gives the end-user no actionable message. Fix: give `ContextSessionUnavailable` a distinct message (`SESSION_EXPIRED`) surfaced as `error_code` (keep `session_invalid` for client cache reset), and emit human-readable error text for boundary codes.

**NIT-3 (P2, TOCTOU — success-path navigation drift unexamined).** `companion-http.ts` ~L706–710: after the async read, `targetAfter` is re-resolved and compared (`origin` + `navigation_key`) **only when `!result.success`** — it gates `recordContextFailure`, never the capture. A successful read raced against tab navigation (origin A resolved pre-read, tab lands on B mid-read, `navigation_key` changed) is still captured with no `TARGET_CHANGED` signal, even though `TARGET_CHANGED` is an accepted boundary code for exactly this condition. Failure mode: evidence captured with provenance derived from a stale pre-read target state. Caveat `[inspected]`: `resolveBrowserSiteTarget` internals are not in this diff and may raise drift itself; if so this degrades to a defense-in-depth nit. Fix: on success with `navigation_key` drift, emit `TARGET_CHANGED` and discard, or at minimum flag the capture in the audit record.

---

**Verdict: PASS — approve lane (pad-ready).** No BLOCK, no MAJOR in the transport bounded lane of frozen R2; three P2 nits above are audit-fidelity/TOCTOU hardening for a future lane and do not gate. Source-only T3 lane verdict; no pilot/release approval claimed.

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 15784,
    "outputTokens": 6901,
    "cacheReadInputTokens": 0,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 0.25144500000000003,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
