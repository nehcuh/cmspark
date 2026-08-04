Re-review complete. Report written to `docs/audit/reviews/outbound-mcp-p0c-pi-rereview-20260804-110310.md`.

## Summary

**MACHINE**: Re-ran fresh — `tsc -p tsconfig.test.json` + `node --test` → **18/18 pass** (confirms adversary's 18/18 claim).

**Adversary spot-check (all file:line citations verified against live tree, not just the patch narrative):**

| Adversary claim | Verification |
|---|---|
| No blockers; loopback-only + Bearer + fail-closed | ✓ `server.ts:5587` bind 127.0.0.1; `companion-http.ts:62-88` timing-safe Bearer; `facade.ts:86-92` server-side disclosure; caller `disclosure_accepted` ignored (test asserts) |
| M7 not default-on | ✓ `index.ts:346-350` only `case "mcp-outbound"`; start/daemon never touch it |
| M6 wiring gap (nit 1) | ✓ Confirmed — synthetic origin created (`bridge.ts:62`, `companion-http.ts:177`) but production runner binds Extension WS as `originWs` in every confirm (`server.ts:2076, 2272, 4416`). Note: M6 DoD letter ("originWs **或** synthetic origin") is met via the originWs branch; the spirit gap is correctly rated a nit |
| Nits 2–7 | ✓ All verified: `stdio-server.ts:31-33` default caller; `companion-http.ts:65` length early-return; `:174` INTERNAL_NAME_MISSING audit skip (unreachable branch); no HTTP-layer integration test (only 2 pure-function test files); `:260-267` pre-auth health; `ws-auth.ts:55-78` first-run race |
| Wires / grace / trajectory | ✓ auth.ok wire `:5767`, close rebind `:6043`, refresh hook `:5509`, 5s grace `:2807`; diff scope = runtime only in `outbound-mcp/*` + `server.ts` + `index.ts` + 2 tests, rest docs |

**New blockers missed by adversary**: none found after independent sweep (unauth invoke, disclosure bypass, body limit, audit coverage, method confusion all clean).

**M1 meta-tool deviation** (stdio `tools/list` adds 2 non-CDP meta tools): letter-of-DoD miss, no dangerous-surface expansion — kept as note, matches adversary's adjudication.

**L8/L9**: open, not claimed shipped (gate plan H-7/8/10 unchecked) — allowed residual.

**Nits I keep**: M6 DoD tightening / origin override before L8, default `caller_id` per-process, missing HTTP-layer e2e test (must add before P0d bake-off), audit inconsistency on unreachable branch, plus accepted trivia (N3/N6/N7).

VERDICT: APPROVE_WITH_NITS
