# Pi re-review — Outbound MCP P0c (after independent adversary)

You are **Pi**, performing a **second-stage re-review**. You must read the **adversary report in full** and the real code/diff. Do not rubber-stamp the adversary.

## Confirmation order (locked)

1. MACHINE green (unit tests)  
2. Independent adversary VERDICT (already run)  
3. **You (Pi)** confirm or reject adversary conclusions  

## Inputs (must open with tools)

| Artifact | Path |
|----------|------|
| Adversary report | `docs/audit/reviews/outbound-mcp-p0c-adversary-claude-20260804-105153.md` |
| Adversary prompt | `docs/audit/reviews/_prompts/outbound-mcp-p0c-adversary.md` |
| Diff | `docs/audit/reviews/outbound-mcp-p0c-adversary-diff-20260804-105153.patch` |
| Live code | `companion/src/outbound-mcp/*`, `companion/src/server.ts` (search handleLoopbackHttp, ensureOutboundToolRunnerWired) |
| ADR | `docs/adr/022-outbound-mcp-server.md` |
| Gate plan | `docs/superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md` |

## Capability declaration

```text
Surface:      L1 (export curated)
L2-classes:   (none)
Compose:      outbound-mcp-server (ADR-022)
Autonomy:     single
Trust:        domain + L2 + disclosure session; Bearer ws_secret; no grant skip
Channel:      community
```

## Your job

1. Spot-check adversary claims against **file:line** in live tree (not only the patch narrative).  
2. If adversary was **too soft** (missed blocker) → **REJECT**.  
3. If adversary was **too harsh** (nit as blocker incorrectly) → you may APPROVE_WITH_NITS and note it.  
4. Re-run or trust MACHINE: 18/18 outbound unit tests (optional re-run).  
5. Open items L8/L9 are allowed residual **only if not claimed shipped**.

## Output

1. Agree / disagree with each adversary finding (table)  
2. Any **new** blockers adversary missed (file:line)  
3. Nits you keep  
4. Final line exactly:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
