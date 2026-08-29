# Dual re-review — CMspark 0.5.3 Batch F path (#253)

You are an **independent** senior reviewer. You did **not** write the strawman or the four-lane synthesis. Confirm, refute, or block the **path**.

Work in: `/Users/huchen/.grok/worktrees/projects-cmspark/fix-253-integrity-p2`

## Capability declaration

```text
Surface:      Operate L2 / extension SW / MCP args
L2-classes:   existing
Compose:      n/a
Autonomy:     n/a
Trust:        unknown L2 cannot issue empty bind ; tab.navigated Origin
Channel:      community
Blast:        T3
```

## Inputs

1. Spec (folded): `docs/superpowers/specs/2026-08-29-post-diagnosis-batch-f.md`
2. Synthesis: `docs/audit/reviews/batch-f-adversary-synthesis-2026-08-29.md`
3. Spot-check: `security-policy.ts` default `""`; `lifecycle.ts` tab.navigated; `handshake-surface.ts` panel; `background/index.ts` user_gesture; `modules.ts` + `netsec/scope.ts`; `mcp/dispatch.ts` callTool

## Rules

1. REJECT if implementing as written would: ignore handshake `panel` (drops real tab.navigated); change SUMMONER_ALLOW; add overlay HTTP to WS Origin; strip `/^__/` so hard it breaks MCP `__meta`; split message-router.ts; expand #228.
2. F1 is a lockstep footgun, not cross-tool empty-ticket. Do not REJECT for rewriting that product sentence.
3. Final line exactly:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
