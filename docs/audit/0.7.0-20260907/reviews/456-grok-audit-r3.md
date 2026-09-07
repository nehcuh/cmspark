I'll read only the frozen audit packet and review that delta from the file itself.## BLOCK
None.

## MAJOR
None.

## NIT
1. `companion/tests/outbound-mcp-http-e2e.test.ts` (HTTP bind test) — redaction list omits `grantToken("ordinary")`; 401/403 session audits are not asserted (`GRANT_DENIED`, `ok: false`). Repro: forged/ordinary 403s are inside `auditOffset` but only `GRANT_REQUIRED`/`CAPACITY`/one success are checked; a future `auth.error_code` leak of that token would not fail.

2. Same file (TTL test ~993) — parses the **entire** JSONL, not an offset. Isolation is `grant.id` + `SCOPE_DENIED` only. Repro: a non-JSON line from an earlier test throws; a leftover same-shaped event from a reused id would be a false pass.

3. `companion/src/outbound-mcp/companion-http.ts` session route — `auditSession(true)` then `json(...)` in the same `try`. If `json` throws after `issue()`, catch writes a second `BAD_BODY` line for an already-issued handle (per-grant 16 still consumed).

4. Session events reuse `type: "outbound_mcp.tool"` + synthetic `cmspark__context_session` (not on the tool list). Fine for this packet; metrics that treat `tool` as allowlist usage will over-count.

## Review (delta only)
Session route binds `caller_id`/`grant_id`/`profile` only after `auth.ok`; failures stay `http-unknown` and never take `body.caller_id`. Catch maps unknown throws to `BAD_BODY` (no raw messages/handles). `appendOutboundMcpAudit` emits `session_invalid` only when `=== true`.

`ContextSessionRegistry.resolve` (unchanged): missing/expired → `ContextSessionUnavailable` (`SCOPE_DENIED`); grant/caller mismatch → plain `Error("SCOPE_DENIED")`. Early invoke catch and outer catch both use `instanceof`, so stale vs origin/sibling deny match the tests (`nonexistent-handle` vs sibling handle vs origin `site_context`). Wire `error`/`error_code`/`session_invalid` shapes are unchanged.

Capacity: grant session + `second` + 14 = 16, then `CAPACITY` with that `grant_id`. Secret substring checks cover grant/sibling tokens and both handles.

## VERDICT
**APPROVE**
