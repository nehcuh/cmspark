# Dual external re-review: Outbound MCP L4+ Grant implementation (M1–M4)

**Batch:** `outbound-mcp-l4-grant-impl` · **Range:** `9b84f14` → `da4a420` · **Staleness check:** `git diff origin/main..HEAD` matches the provided patch exactly (same 16 files, same stats); patch is current.

## Claim verification (with file:line)

1. **M1–M3 Option D/A** — CONFIRMED. `companion/src/outbound-mcp/outbound-grants.ts` (new): `cmg_` + 32 random bytes token (`generateOutboundGrantToken`), sha256 hash-only store (`hashToken`/`token_hash`), 30d default TTL (`DEFAULT_GRANT_TTL_MS`), per-grant TTL override, caller_id binding, revoke/revoke-all, L1-profile-only fail-closed. Auth matrix in `companion-http.ts` `authorizeOutboundRequest`; stdio `resolveOutboundHttpBearer` in `stdio-server.ts:73`.
2. **require_grant=true rejects ws_secret** — CONFIRMED. `companion-http.ts`: `requireGrant` path returns 401 `GRANT_REQUIRED` when token matches ws_secret but not grant shape; grant verified otherwise. Tested (`authorizeOutboundRequest: require_grant rejects ws_secret`). stdio side hard-fails (`stdio-server.ts:80-84` throws; `createOutboundMcpServer` disclosure catches → isError; `wireDefaultOutboundHttpDispatcher` propagates). No fallback anywhere; the invoke dispatcher token is resolved once at wire time, and the server-side matrix is authoritative regardless.
3. **Default false preserves P0 bake-off** — CONFIRMED. `config.ts:292` `require_grant: false`; deepMerge (`config.ts:477`) fills for legacy files. P0 dual-mode: ws_secret accepted, cmg_-shaped invalid tokens still rejected (fail-closed, no fall-through).
4. **Settings UI** — CONFIRMED. `OutboundMcpSettingsSection.tsx`: issue (label/caller_id/TTL 1h–30d/never), one-time token + copy + env snippet, list with last-used, per-grant revoke (confirm), revoke-all (confirm), require_grant toggle (danger styling when ON), revoked history. Wired via `SettingsSlideout.tsx` and background forward list (`background/index.ts:904-908`); responses reach the panel via the existing companion→background→sidepanel relay (verified `handleCompanionMessage`).
5. **Token never re-fetchable; hash-only on disk** — CONFIRMED. Raw token returned only from `issueOutboundGrant`; `listOutboundGrants` strips `token_hash`; `grants.json` written via `atomicWriteJSON(…, 0o600)`; issue response goes to the requesting WS socket only (server.ts:6259 `ws.send`, not broadcast). UI holds token in component state, lost on unmount — "关闭面板后无法再看" is honest.
6. **Not claiming ship/GA** — CONFIRMED. Design status updated to "M1–M3 code landed (require_grant default false until P1 GA)"; no product-ship claims.

## Security hunts

- **Auth bypass:** none. Legacy `authorizeOutboundHttp` has zero callers (only re-exported). Only entry is `handleOutboundMcpHttp` (server.ts:173) which enforces the matrix inside each handler. Health stays unauthenticated (loopback, no secrets) per lock. Unknown paths → 404 with or without auth (no oracle).
- **caller_id spoof:** grant mode forces caller_id from grant binding at both verify layer and handlers (`companion-http.ts` disclosure+invoke → 403 `GRANT_CALLER_MISMATCH`); ws_secret mode retains P0 free-form caller (documented bake-off semantics).
- **WS issuance auth:** any authenticated extension peer can issue/revoke grants and toggle require_grant. Same trust domain as the human-operated Side Panel, and in P0 that peer could already invoke outbound directly — no privilege escalation. Intended for Phase 1, but see nit 4.
- **Token leaks:** audit lines carry grant_id/caller_id/label only — never raw token. The issued token is relayed to all extension contexts (sidepanel/cockpit/popup) via background broadcast, but all are the same user's extension.
- **Revoke race:** per-request store reload → revoke effective next request (no restart-only TOCTOU, per design lock). Read-modify-write has no lock (concurrent issue could drop a grant) — single-user desktop, low risk (nit 5).
- **Windows:** 0o600 advisory on NTFS — design-locked platform-honest; hash-only + user-profile dir is the real defense.

## ADR-020 checklist

Capability declaration present and accurate (Surface L1-outbound-only; Compose mcp-server auth packaging + Settings UI; Trust: grant≠ws_secret, no fallback when ON, no confirm-skip; Channel community). Axes fit — no "中层 Agent" misuse. Not a new scenario → no Pack-first conflict (admin surface for existing packaged surface; settings section, not primary chrome). No new confirmation family. **Trust monotonicity holds**: grant adds no L2 tools, L2/URL/disclosure gates unchanged, grant ≠ cloud-exfil consent. No new `securityConfirmations.request` → originWs n/a. P1 watchlist untouched.

## Non-blocking nits

1. **Test gaps vs design M5** (`companion/tests/outbound-mcp-grants.test.ts`, 12 tests): missing no-fallback test (`resolveOutboundHttpBearer` throwing when require_grant=true + no `CMSPARK_OUTBOUND_GRANT`), dual-presented reject, HTTP-handler integration for grant caller binding on `/invoke` and `/disclosure`, and TTL=0 no-expiry.
2. **Dead code** in `companion-http.ts` (end of `handleOutboundMcpHttp`): the no-op block with self-contradictory comment ("Auth required for unknown POST… 404 without auth") executes nothing — harmless (unknown paths 404 regardless) but should be removed.
3. **Over-claim in memory/session.md**: "32 unit tests pass" — actual run is 12 tests, all pass (docs-only).
4. Grant issuance/toggle has no additional human gesture beyond opening Settings (any authenticated peer can issue); consider a biometric/HITL gate at P2 per design G2 intent.
5. Grants file read-modify-write without a lock; acceptable on single-user desktop, but a serialized write would be more robust.

No REJECT conditions triggered: ws_secret is not accepted under require_grant, no confirm-skip, no raw token storage, no auth bypass, no design-lock violation.

VERDICT: APPROVE_WITH_NITS
