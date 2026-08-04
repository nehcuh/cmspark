# Dual external re-review: Outbound MCP L4+ Grant **implementation** (M1–M4)

**Stage:** Code implementation (post design dual-lock)  
**Date:** 2026-08-04  
**Batch id:** `outbound-mcp-l4-grant-impl`  
**Range:** `origin/main` (`9b84f14` docs dual-lock) → `HEAD` (`da4a420` M4 UI)  
**PR:** #120  

## Required reading

1. **Design SoT (locked direction)**  
   `docs/decisions/outbound-mcp-l4-grant-design-2026-08-04.md`  
   Especially §5 Phase 1 scheme, dual-review locks (no ws_secret fallback when require_grant, HTTP 401/403, caller bind, 30d TTL, multi-grant).

2. **Design dual-review synthesis**  
   `docs/audit/reviews/outbound-mcp-l4-grant-dual-synthesis-20260804.md`

3. **Implementation (inspect with tools — file:line)**  
   - `companion/src/outbound-mcp/outbound-grants.ts` — issue/verify/revoke/list, hash store  
   - `companion/src/outbound-mcp/companion-http.ts` — `authorizeOutboundRequest`, handle invoke/disclosure  
   - `companion/src/outbound-mcp/stdio-server.ts` — `resolveOutboundHttpBearer`, GRANT_ENV  
   - `companion/src/config.ts` — `outbound_mcp.require_grant` default false  
   - `companion/src/message-router.ts` — `outbound_mcp.grants.*` / `set_require_grant`  
   - `chrome-extension/src/sidepanel/components/OutboundMcpSettingsSection.tsx`  
   - `chrome-extension/src/background/index.ts` — message forward  
   - `companion/tests/outbound-mcp-grants.test.ts`

4. **ADR**  
   `docs/adr/022-outbound-mcp-server.md` L4 / L4+  
   Checklist: `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Capability declaration (implementer)

```text
Surface:      L1 outbound export only (grant does not add L2 tools)
L2-classes:   (none)
Compose:      mcp-server (outbound) auth packaging + Settings UI
Autonomy:     n/a
Trust:        separate MCP-caller grant from Extension ws_secret;
              require_grant default false (P0 bake-off); when true never fall back;
              L2/URL confirm unchanged; no confirm-skip
Channel:      community
```

## Product claims under review

1. M1–M3 implement dual-lock Option D/A (hashed `cmg_` grants, auth matrix).  
2. When `require_grant=true`, ws_secret is rejected on `/outbound-mcp/*`.  
3. Default `require_grant=false` preserves P0 bake-off.  
4. Settings UI issues one-time token, list/revoke, require_grant toggle.  
5. Token never re-fetchable after issue; only hash on disk.  
6. **Not claiming** product ship / require_grant GA / multi-tenant isolation complete.

## Your job

Independent **security + correctness + design-fidelity** re-review of the **diff**.

1. **Do not rubber-stamp.** Diff against design locks; confirm or refute each claim with file:line.  
2. Hunt: dual-auth bypass, require_grant false leaving silent holes, caller_id spoof, WS handler auth gaps (any authenticated extension peer can issue grants — is that intended?), token leak in logs/UI rebroadcast, race on revoke, Windows path/ACL, missing tests.  
3. **Trust monotonicity:** grant must not weaken L2/URL/disclosure; grant ≠ user cloud-exfil consent.  
4. UI: once-only token honesty; revoke UX; require_grant danger clarity.  
5. Tests: adequate for happy/mismatch/expired/require_grant reject? Gaps?  
6. Apply ADR-020 checklist.

## Verdict rules

- **REJECT** if confirmed HIGH: ws_secret still accepted when require_grant true; confirm-skip introduced; raw tokens stored; auth bypass; design lock violated without explicit HANDOFF.  
- **APPROVE_WITH_NITS** if direction-faithful with non-blocking gaps (UI polish, missing WS unit tests, docs).  
- **APPROVE** only if ready to merge as Trust packaging without nits worth tracking.

End with exactly one line:

VERDICT: APPROVE  
or  
VERDICT: APPROVE_WITH_NITS  
or  
VERDICT: REJECT  
