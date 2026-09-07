# Actual model: deepseek-v4-pro

**Scope**: Delta adds `session_invalid` to `outbound_mcp.tool` audit events and emits audit records at three new sites — early context-session resolve failures, HTTP session-route issuance/denials/rejects, and dispatch-time `ContextSessionUnavailable` — plus e2e assertions for discrimination, capacity, and secret absence. No wire contract, capability surface, or grant/session semantics change (`[inspected]` — every response object in the diff is byte-identical to the pre-delta version excepting the added audit calls).

## Correctness & Security passes

Walked all four hunks end-to-end. No new secret exposure: the session route logs only fixed codes (`GRANT_REQUIRED`/`GRANT_DENIED`/`CAPACITY`/`BAD_BODY`/success), verified `bound_caller_id`, constant tool name, and no handle/body/token — the raw `(error as Error).message` is deliberately *not* used there. The invoke-path early catch logs raw `error.message` as `error_code`, but those messages were already returned on the wire pre-delta (`companion-http.ts:501-509`), so no new surface. `caller_id` for auth failures remains `"http-unknown"` because assignment happens only after `auth.ok` (`companion-http.ts:818-821`) — the unverified-ID claim holds and is asserted by the `GRANT_REQUIRED` check. `appendOutboundMcpAudit` drops `session_invalid` unless `=== true` (`audit.ts:36`), matching both wire gating and the `=== undefined` test assertions. `false` values passed by call sites (`e instanceof ContextSessionUnavailable` → `false`) are correctly omitted. The dispatch-catch addition (`companion-http.ts:767`) is additive to an existing audit call; no double-audit path exists (early resolve returns before dispatch). `appendOutboundMcpAudit` cannot throw into the `catch` block and alter wire behavior — `appendCapabilityAudit` swallows internally (`audit-log.ts`). Rotation/permissions (0o600/0o700/10MB/3-files) unchanged. Test secret-absence assertions (`includes(secret) === false`) directly prove handles and tokens never reach the log `[per machine: 4975 pass / 0 fail]`.

## Findings

**P2/NIT 1 — internal faults permanently mislabeled `BAD_BODY` in audit** — `companion-http.ts:834-836`. The catch maps any non-`GRANT_DENIED`/`CAPACITY` throw (including a hypothetical internal `contextSessions.issue` fault) to `BAD_BODY` in the new audit record, conflating client errors with server faults in a log whose purpose is forensic. The wire label is pre-existing and correctly frozen; the audit label is new and could distinguish without touching wire. Failure mode: incident response misattributes a server defect as malformed client input. Not blocking.

**P2/NIT 2 — early-catch audit uses unmapped raw message** — `companion-http.ts:505-509`. Unlike the dispatch catch (whitelisted `boundaryCode`), this site audited/returns `error.message` directly. Today `resolve` throws only fixed codes (`SCOPE_DENIED`/`CONTEXT_SESSION_REQUIRED`, consistent with passing assertions), so risk is latent: a future internal error message (or one that echo-constructs input) would flow into both audit and wire. Recommend whitelisting here too for parity. Not blocking.

**P2/NIT 3 — TTL test reads whole audit file without offset** — `outbound-mcp-http-e2e.test.ts:1013`. Test 1 correctly uses `auditOffset`; test 2 reads the entire `capability-audit.jsonl` and relies solely on `grant_id` uniqueness for isolation. Correct today (machine-verified), brittle if grant IDs ever become deterministic/namespaced. Cheap to add an offset.

**P2/NIT 4 — audit write amplification on loopback rejects** — `companion-http.ts:815-820`. One line per failed request (including 401s) with no throttle. Loopback-bound and rotation-capped at ~40MB, same pattern as the pre-existing invoke audit, so it's noise-level; noted only for completeness.

No P0/P1 findings. Correctness contracts, security properties, and test evidence all check out against the stated delta.

**Verdict: /push-ready/ — 0 BLOCK, 0 MAJOR, 4 NIT (all P2, none blocking).**

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 14197,
    "outputTokens": 12888,
    "cacheReadInputTokens": 0,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 0.393185,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
