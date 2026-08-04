Based on my comprehensive review of the Outbound MCP L4+ Grant implementation, here are my findings:

---

## Review Summary

**Design Fidelity: CONFIRMED** ✓
- Hashed `cmg_` grants store (SHA256 only on disk, raw token returned once)
- ≥32 random bytes (64 hex chars after `cmg_` prefix) ✓
- `require_grant` defaults to `false` (P0 bake-off preserved) ✓
- When `require_grant=true`, `ws_secret` is explicitly rejected at companion-http.ts:153-163 ✓
- HTTP error codes correct: GRANT_REQUIRED→401, EXPIRED/REVOKED/MISMATCH→403 ✓
- Caller bind on BOTH `/invoke` AND `/disclosure` paths ✓
- Settings UI issues one-time token, list/revoke, require_grant toggle ✓
- Token never re-fetchable; `listOutboundGrants` omits `token_hash` ✓

**Security: CONFIRMED** ✓
- No fallback to `ws_secret` when require_grant true (stdio-server.ts:79-84 throws) ✓
- Confirm-skip not introduced (grant is parallel auth, doesn't touch confirm gates) ✓
- L1 profile only; `verifyOutboundGrantToken` rejects unsupported profiles ✓
- Trust monotonicity: grant doesn't weaken L2/URL/disclosure gates ✓
- Timing-safe comparison (`safeEqualHex`, `timingSafeEqual`) ✓
- Audit: `grant_issue`, `grant_use`, `grant_revoke`, `grant_revoke_all` ✓
- Windows 0o600 via `atomicWriteJSON` ✓
- UI shows token once only; hide button clears state ✓

**Tests: 12 passing** ✓
- issue, verify, caller_bind, revoked, expired, auth_matrix, revoke_all, TTL

**ADR-020 Capability: CONFIRMED** ✓
- Surface: L1 outbound export only (grant adds no L2 tools)
- L2-classes: none
- Compose: mcp-server (outbound) auth packaging + Settings UI
- Autonomy: n/a
- Trust: separate MCP-caller grant from ws_secret; require_grant default false
- Channel: community

---

## Nits (Non-blocking)

1. **Tool audit lacks `grant_id`**: The `appendOutboundMcpAudit` call in `companionInvokeOutbound` (companion-http.ts:379-386) doesn't include the `grant_id`. The `verifyOutboundGrantToken` function already logs `grant_use` with `grant_id`, so correlation is possible via timestamp+caller_id, but including `grant_id` directly in the tool audit would be cleaner.

2. **Missing WS handler unit tests**: No direct unit tests for the message-router WS handlers (`outbound_mcp.grants.*`), though integration is covered by the grant store tests.

3. **Documentation**: Could add comments about the Windows ACL advisory nature in the code, not just the design doc.

---

## Blocking Issues
**None identified**

---

VERDICT: APPROVE_WITH_NITS
