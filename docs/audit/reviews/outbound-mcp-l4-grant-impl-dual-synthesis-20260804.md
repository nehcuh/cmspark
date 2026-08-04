# Dual-review synthesis — Outbound MCP L4+ Grant **implementation** (M1–M4)

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Range | `9b84f14` → `da4a420` (PR #120) |
| Order | MACHINE (unit tests) → Claude + Pi dual · both_ok |

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Claude Code | **APPROVE_WITH_NITS** |
| Pi Agent | **APPROVE_WITH_NITS** |
| **Combined** | **`both_approve: true`** — merge-ready for Trust packaging (not GA) |

Artifacts:

- [claude](outbound-mcp-l4-grant-impl-claude-20260804-223409.md)
- [pi](outbound-mcp-l4-grant-impl-pi-20260804-223409.md)
- [verdict JSON](outbound-mcp-l4-grant-impl-verdict-20260804-223409.json)

## Confirmed (both)

| Claim | Status |
|-------|--------|
| Hashed `cmg_` store, one-shot raw token | ✓ |
| `require_grant=true` rejects ws_secret (HTTP + stdio) | ✓ |
| Default `require_grant=false` preserves P0 bake-off | ✓ |
| Caller bind on invoke **and** disclosure | ✓ |
| HTTP 401/403 mapping | ✓ |
| Settings issue/list/revoke/require_grant | ✓ |
| No confirm-skip; Trust monotonicity | ✓ |
| No REJECT-level issues | ✓ |

## Shared nits (non-blocking)

| ID | Nit | Owner |
|----|-----|-------|
| N1 | Tool audit line missing `grant_id` on invoke (use audit still has it) | follow-up |
| N2 | No WS handler / HTTP e2e tests for grants.issue / require_grant throw path | follow-up |
| N3 | Dead no-op block at end of `handleOutboundMcpHttp` | cleanup |
| N4 | session.md “32 tests” overclaim → actual **12** grant unit tests | fix docs |
| N5 | Any authenticated extension peer can issue grants (same trust domain as Settings; P2 optional HITL) | HANDOFF P2 |
| N6 | Grants file RMW without lock (single-user OK) | HANDOFF |

## Merge recommendation

**YES** — PR #120 may merge as L4+ grant packaging with `require_grant` default false.  
**Not yet:** product claim “require_grant GA / multi-tenant safe” — still needs P0d T1 + GA cutover.

## Next

1. Merge #120 (optional: quick N3/N4 nits first)  
2. Human P0d T1 bake-off  
3. P1 GA: default `require_grant=true` + docs cutover  
