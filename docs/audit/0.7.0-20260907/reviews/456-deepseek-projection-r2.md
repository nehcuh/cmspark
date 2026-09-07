# Actual model: deepseek-v4-pro

Note: The injected `commands`/design-system skill is irrelevant here (no UI being built); this is a T3 code review, so I'm proceeding with the review per the task spec.

# Review — #456 outbound_context_v1 projection lane (frozen R2)

Scope reviewed: `context-projection.ts`, `context-experience.ts`, `context-permission.ts`, `context-session.ts`, `skill-engine.ts` diff, `message-router.ts` diff, `ws/lifecycle.ts` diff, plus full-context `site-context/{browser-resolver,service,target}.ts`, `business-evidence/executor.ts`. `companion-http.ts` (MCP handler, grant construction, HITL/session_invalid mapping, success audit) is not supplied — findings that depend on it are flagged as such.

## MAJOR

**M1 — Raw grant-field intake with unguarded `.includes()`; string-typed `context_origins` widens exact-origin grants by substring matching.**
`message-router.ts` (~line 5002 diff) forwards `context_origins: rest.context_origins` (and `context_knowledge_ids`, `allow_context_export`) into the grant record with no visible `parseContextPermission` applied at intake, while the consumer (`context-projection.ts`, both origin gates: `firstGrant.context_origins.includes(target.origin)` and `current.context_origins.includes(target.origin)`) calls `.includes()` directly on the looked-up grant's fields. `requireContextGrant`/`requireLiveGrant` (context-permission.ts) re-validate id/caller/profile/expiry but never re-parse `context_origins`.

Repro (reachable iff the grant store/`GrantLookup` returns the record without schema parse — neither path is visible in this lane): authenticated caller creates/updates a grant with `context_origins: "https://portal.test"` (str ing, not array — `.array()` schema would only stop this if the message-command schema enforces it). Then a tab at `https://portal.test.attacker.net` yields `target.origin = "https://portal.test.attacker.net"`, and JS `String.prototype.includes` returns true (prefix match). Both origin checks pass and `portal.test` knowledge is projected for a non-granted origin — a direct breach of the exact-origin authorization that is the core security claim.

Even in the array case, nothing in the shown lane normalizes/validates persisted origins at lookup (compare: dupes are rejected only inside `parseContextPermission`, which is demonstrably wired only to the legacy-record fallback `contextPermissionFromRecord`). Hardening: `Array.isArray` + exact `===` set membership in `requireContextGrant`/projection, and validate via `parseContextPermission` at grant creation before persistence. If the unseen grant-creation command schema does call `parseContextPermission`, this degrades to a NIT (deny-biased raw storage otherwise), but it is currently an unverified trust-boundary dependency — blocking per protocol.

**Related minor:** `message-router` sets `allow_context_export: rest.allow_context_export` without the `=== true` coercion applied to `allow_page_export`. Deny-safe only because the backstop is `grant.allow_context_export !== true`; a string `"false"` is persisted truthy. Fold into M1 fix.

## NITs

**N1 — `ContextSessionUnavailable` message is `"SCOPE_DENIED"`** (context-session.ts). IF the HTTP handler classifies by `error.message` rather than `instanceof`, expired handles get counted as origin failures in `contextExperience` and mis-render as scope denials — contradicting R2's session_invalid flag. Confirm the handler uses `instanceof`; give the class a distinct message anyway.

**N2 — Projection never asserts `target.tab_id === request.tabId`** (context-projection.ts); it only compares the two resolver results to each other. Production safety rests entirely on `resolveBrowserSiteTarget`'s `target.tab_id !== tabId` check (target.ts/picker). Cheap defense-in-depth addition.

**N3 — Granted docs are not cross-checked against target origin.** A knowledge doc with `site: X` is exportable while browsing granted origin Y. This is explicit per-document authorization, so not a bypass — but the UI/audit should surface it to avoid admin misconfiguration.

**N4 — `siteTargetFromBridge` accepts the browser-supplied `navigation_key` without comparing the locally recomputed HMAC** (target.ts). The `TARGET_CHANGED` gate therefore depends entirely on bridge-side key correctness/change-on-navigation. Note as cross-module dependency on extension behavior.

**N5 — `knowledgeVersion` hash excludes `source.id`** (skill-engine.ts diff). Two different doc ids with identical hashed fields compare equal at the version gate — harmless today (ids compared separately) but fragile.

**N6 — "Bounded internal audit" bounds not visible.** MCP capture via `captureLocalPageResult` writes under session-scoped evidence; no TTL/count cap for mcp scopes is shown in this lane.

**N7 — `resolveBrowserSiteTarget` calls `applyTabNavigated`** (browser-resolver.ts) — a Chat-cache side effect if reused from the MCP path. Confirm the MCP wiring tolerates this.

## What held up

Grant re-checked before async work, after target resolution, and finally; final filter is fully synchronous (no await after last resolve) with version pinning via shared `knowledgeVersion`; revocation/edit/delete/navigate paths all deny (GRANT_DENIED/REDACTED/NOT_FOUND/TARGET_CHANGED); `knowledgeView` excludes prompt/safety guards; handle issuance uses UUID + registry TTL/capacity, with session_invalid separated via `ContextSessionUnavailable`; origin normalization is consistent both sides; experience memory is ephemeral, origin-validated, bounded; structuredClone of the first grant prevents mid-call mutation; test coverage matches the stated mutations.

## VERDICT

**BLOCK on M1** — the exact-origin guarantee depends on grant-field validation that is not present anywhere in the supplied lane, and the direct `.includes()` on looked-up fields turns a type violation into substring origin-widening. If the orchestrator confirms the grant-creation command applies `parseContextPermission` before persistence (and lookup returns parsed/normalized values), M1 degrades to NIT and the lane stands with the NITs above.

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 14895,
    "outputTokens": 25281,
    "cacheReadInputTokens": 0,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 0.7065,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
