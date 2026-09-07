# Actual model: deepseek-v4-pro

## Independent review — #456 outbound_context_v1, authorization lane (frozen R2)

**Override note:** the injected `commands` design-system skill targets UI generation; this is a read-only review that forbids running commands/edits, so the skill workflow does not apply (META-0). Review proceeds on the supplied packet only.

### Findings

**BLOCK — none.**

**MAJOR — none.** I could not construct a concrete authorization bypass within this lane. The compose-security pattern holds under the supplied interfaces: `requireLiveGrant` (identity/revocation/unparseable-or-past expiry → `GRANT_DENIED`, fail-closed; empty-string `expires_at` correctly parses as NaN → denied), `requireContextGrant` (profile + boolean gate), grant-bound opaque sessions, and exact-origin/normalized-origin permission with duplicate rejection. Sibling grants cannot lend permission (both `requireContextGrant` and `resolve`'s `entry.grant_id !== grantId` bind); a client-presented foreign `grant_id` or `caller_id` fails at `requireLiveGrant` before any handle check. The session handle is `randomUUID`, server-issued, never client-chosen; a client cannot mint a scope for another grant's session even knowing the handle, because `resolve` is gated by live-grant liveness for the presented IDs first. The `origin` transform is robust: it rejects userinfo/query/fragment/non-root path/`*` host, and normalizes via `url.origin` so default ports, case, and trivial format variations collapse before the duplicate check; anything odd that slips through (`%2A` host percent-encoding, `https:///…` shapes) still yields a normalized exact origin that simply cannot match a real page origin, so at worst the permission is inert, never broader. The `profile.ts` loop fix is correct and fail-closed (unknown/empty sets fall back to default eight; context tooling no longer leaks into empty-profile callers).

**NIT-1 — `context-session.ts:issue()` lacks a profile assertion.** `issue` calls only `requireLiveGrant`, so a holder of a live *non-context* grant can mint sessions (16 per grant, 256 global) that can never drive `site_context` — capacity consumed without capability. No privilege escalation (the tool path still needs `requireContextGrant`), but `requireContextGrant` in `issue` would make capacity allocation proportional to actual permission. Repro: issue default-profile grant → `registry.issue(grantId, caller)` succeeds → repeat 16× → `CAPACITY`.

**NIT-2 — `ws/validate.ts` is shallow for context fields.** It checks types/array bounds but defers exact-origin parsing, trim, duplicates, and the `allow_context_export ⇒ non-empty origins` implication to `parseContextPermission` inside `issueOutboundGrant`, which throws. Since the WS dispatch handler for `outbound_mcp.grants.issue` is outside this diff, I cannot verify the throw is caught and mapped to a protocol error rather than surfacing as an unhandled message exception. Fail-closed either way; friendly-error parity would run `parseContextPermission` in the validator.

**NIT-3 — `outbound-grants.ts:normalizeGrant` / `requireLiveGrant` treat `revoked_at: ""` (falsy) as not-revoked.** `requireLiveGrant` tests truthiness. The revoke path writes an ISO string, so this needs a hand-edited grants file — and that operator could equally delete the field — but the cost of `revoked_at !== null && revoked_at !== ""` is nil and makes the check symmetrically fail-closed with `expires_at` (where `""` is already denied via `Date.parse` → NaN).

**NIT-4 — `context-session.ts:resolve()` slides TTL on every successful resolve, including resolves preceding an operation that is then denied for its origin.** This is the documented R2 choice ("origin denial does not discard a valid session"), so it is design, not defect; a handle holder can keep their own session warm indefinitely. Noted only so "30-minute sliding window" is not mistaken for idle-timeout.

**NIT-5 — Unreviewed tail of the lane.** `context-experience.ts` (bounded 64-origin/64-KiB/4-MiB capture, success audit after final scope check), the in-request rechecks after HITL/metadata, post-revoke no-capture/no-retry, `site_context` dispatch, and the empty-set fallback in `outboundToolsForProfiles` after the shown loop are outside this diff. They are exercised by the shown targeted tests (profile deep-equal on `[]`, sibling-grant denial, expiry handling) and the claimed 4,975-pass suite, but the trust boundary crosses those files; I verify the interfaces (`EvidenceScope {kind:"mcp"}`, `ContextSessionUnavailable` type distinction) compose correctly from here, not the implementations.

**NIT-6 — `grant-cli.ts` `statSync`-then-`readFileSync` 64 KiB gate is TOCTOU** on a local, operator-supplied file; worst case is a parse failure, so cosmetic.

**NIT-7 — Extension background forwarding** of the three new issue-message fields isn't in this lane; the side-panel correctly omits them for non-context profiles and the component-level tests pass, but end-to-end field passthrough is only evidenced by the suite claim.

Minor cosmetic: `OutboundMcpSettingsSection` maps docs without id/name to `String(undefined)` in the checkbox list.

### Verdict

**PASS (no BLOCK/MAJOR) for the authorization lane.** Permission modeling (independent exact-origin + selected-document + boolean export flag, profile-gated issuance, legacy-deny, sibling-grant isolation, revocation/expiry fail-closed, opaque grant-bound handles, origin-normalized dedupe) is sound; I found no concrete authorization or correctness defect that blocks. NITs are hardening/observability items, none carrying an exploit in the reviewed surface. Approval remains scoped to this lane and to source review — no real pilot/release approval is claimed.

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 15849,
    "outputTokens": 20608,
    "cacheReadInputTokens": 0,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 0.594445,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
