# Pi re-review — Outbound MCP P0c (after independent adversary)

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Reviewer | Pi (stage 2 of locked confirmation order) |
| Adversary | `outbound-mcp-p0c-adversary-claude-20260804-105153.md` (APPROVE_WITH_NITS) |
| MACHINE | 18/18 pass — **re-run this session** (fresh `tsc -p tsconfig.test.json` + `node --test .test-dist/tests/outbound-mcp-*.test.js`; 18 pass / 0 fail) |
| Diff | `docs/audit/reviews/outbound-mcp-p0c-adversary-diff-20260804-105153.patch` |
| Gate plan | `docs/superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md` |

## Confirmation-order status

1. MACHINE green — 18/18 (re-verified this session).
2. Adversary VERDICT: APPROVE_WITH_NITS (read in full).
3. Pi: **confirm** adversary conclusions; every file:line re-checked against live tree (not patch narrative only).

## 1. Agree / disagree with adversary findings

| # | Adversary finding | My check (live tree) | Agree? |
|---|-------------------|----------------------|--------|
| — | **No blocking issues**; security invariants hold | Loopback bind `httpServer.listen(port, "127.0.0.1")` `server.ts:5587`; Bearer auth via `safeEqualStr`+`timingSafeEqual` `companion-http.ts:62-88`; fail-closed profile gate `facade.ts:79-95` (DISCLOSURE_REQUIRED at :86/:92); caller `disclosure_accepted` ignored (server session is truth, asserted by test "caller disclosure_accepted true WITHOUT server session still refused"); M7 not default-on `index.ts:346-350` (only `case "mcp-outbound"` lazily imports; start/daemon never touch it) | **Agree** |
| N1 | **M6 wiring gap** — synthetic origin is dead metadata in production | `bridge.ts:62` and `companion-http.ts:177` create `makeOutboundMcpOrigin(caller_id)` but it is only returned in the response envelope. Production runner is `ensureOutboundToolRunnerWired` → `createToolExecutor(ws)` (`server.ts:216-219`); every confirm in that closure binds the **Extension WS** via `securityConfirmations.request(..., { originWs: ws })` (`server.ts:2076, 2272, 4416, …`). Synthetic MCP origin never reaches the confirm stack. Note: M6 DoD is "request 带 **originWs 或 synthetic MCP origin**" — the letter (originWs branch) is met; the spirit (MCP caller identity in confirm UX) is not. Correctly rated a nit, not a blocker. | **Agree (nit)** |
| N2 | Default `caller_id = "stdio-default"` | `stdio-server.ts:31-33` `(process.env[CMSPARK_OUTBOUND_CALLER_ID] || "stdio-default")`. Two `mcp-outbound` processes that omit the env var share one disclosure session on the companion. Real, low impact, documented in `mcp.md`. | **Agree (nit)** |
| N3 | `safeEqualStr` length early-return leaks length | `companion-http.ts:65` `if (ba.length !== bb.length) return false`. Impact ~zero (secret is fixed 64-hex). Same pattern as `ws-auth.ts verifyProof` (:75). | **Agree (nit)** |
| N4 | INTERNAL_NAME_MISSING audit skip in companion-http | `companion-http.ts:174` returns `INTERNAL_NAME_MISSING` with **no** `appendOutboundMcpAudit`; `bridge.ts:69-74` audits the same branch. Inconsistent, but the branch is **unreachable**: `gateOutboundCall` only returns `ok:true` for allowlisted tools and `outboundToInternalName` is non-null for every allowlisted name — so both audits guard dead code. Cosmetic. | **Agree (nit)** |
| N5 | No HTTP-layer integration test | Only `outbound-mcp-{facade,companion-http}.test.ts` exist (pure-function, mocked runner/dispatcher). Nothing exercises `handleLoopbackHttp` → `handleOutboundMcpHttp` → `executeTool(createToolExecutor)`, nor `ensureOutboundToolRunnerWired` rebind-on-WS-close, nor refresh/invoke concurrency. M4 verified only via mocked-runner unit tests. Gate plan M4 permits "集成测 mock WS 或 fixture companion" but the real bridge is unexercised. | **Agree (nit, real coverage gap)** |
| N6 | Health endpoint leaks `wired\|none` unauthenticated | `companion-http.ts:260-267` — served **before** `authorizeOutboundHttp`, loopback-only, no secrets. Acceptable; pre-existing `/healthz` precedent. | **Agree (nit)** |
| N7 | First-run ws_secret read-then-write race | `ws-auth.ts:55-78` — `getOrCreateSharedSecret` reads, then `randomBytes` + `atomicWriteText` (tmp+rename, so no corrupt file; last-writer-wins). Two processes first-starting simultaneously could diverge (one holds in-memory secret A, disk holds B) → extension pairs to B, A's peer fails. Doc says "companion first"; `atomicWriteText` keeps the file non-corrupt. Acceptable for P0c. | **Agree (nit)** |

Adversary component/trajectory audit re-checked: profile exactly 8 curated L1 tools (`profile.ts`, no expansion); inbound `mcp/` untouched; no god-mode/auto-approve wiring for outbound; `stdio-server` adds two meta-tools to `tools/list` (`cmspark__accept_data_disclosure`, `cmspark__list_outbound_profile`) — letter-of-M1 deviation (DoD: "仅 OUTBOUND_MCP_ALLOWLIST 名"), but neither dispatches to CDP and `accept` still requires `acknowledge:true` + bearer-authed companion POST, so no dangerous-surface expansion. Correctly kept as note, not blocker. Wires verified at `server.ts:5509-5514` (refresh hook), `:5767-5771` (wire on auth.ok), `:6043-6047` (rebind/clear on close), `:2807-2819` (`applyConnectionCloseGracePeriod`, 5s grace). Diff scope = runtime only in `outbound-mcp/*` + `server.ts` + `index.ts` + 2 test files; rest docs/memory.

## 2. New blockers adversary missed

**None.** Independent adversarial sweep of the live tree found no additional security gap:

- Unauthenticated invoke: impossible — all POST paths require Bearer; health is pre-auth but read-only and loopback-only.
- Disclosure bypass: impossible without the secret — `companionAcceptDisclosure` is bearer-gated and requires `acknowledge:true`; stdio local accept without companion accept does **not** unlock execute (dispatch re-checks the companion session).
- Body limit 1MB enforced (`readJsonBody`, `companion-http.ts:97-116`).
- Every gate/dispatch outcome is audited except the unreachable `INTERNAL_NAME_MISSING` in companion-http (N4).
- No method/404 confusion: unauthenticated non-health `/outbound-mcp/*` → 401; auth checked before dispatch paths.

## 3. Nits I keep

1. **M6/N1 wiring gap** — tighten the M6 DoD wording or wire origin override into `executeTool` before L8. Real gap between DoD intent and confirm-stack reality; not a P0c blocker (originWs-bound confirms keep the security invariant).
2. **N2 default caller_id** — prefer `stdio-${process.pid}` / startup UUID so un-configured clients don't share a disclosure session.
3. **N5 no HTTP-layer integration test** — add at least one end-to-end test through `handleLoopbackHttp` (real secret, mock WS via `createToolExecutor`) before P0d bake-off.
4. **N4 audit inconsistency** (unreachable branch, cosmetic).
5. **N3/N6/N7** — accepted as-is; all documented, negligible practical impact.

## 4. L8/L9 residual

Open and **not claimed shipped** — gate plan H step 7/8/10 unchecked, ADR §9 non-goals. Allowed residual per prompt.

## Verdict

Adversary was accurate (all file:line citations verified), not too harsh (nits correctly non-blocking), not too soft (no missed blockers). MACHINE 18/18 re-verified.

VERDICT: APPROVE_WITH_NITS
