# Pi re-review — Outbound MCP L8/L9 (after adversary REJECT + fix)

You are **Pi**, second-stage re-review. Read the **full adversary report** and verify the **B1 fix**.

## Inputs

| Artifact | Path |
|----------|------|
| Adversary (REJECT) | `docs/audit/reviews/outbound-mcp-l8l9-adversary-claude-20260804-131603.md` |
| Adversary prompt | `docs/audit/reviews/_prompts/outbound-mcp-l8l9-adversary.md` |
| Fix claim | `server.ts` skips multi-agent/`isToolAllowed` when `isOutboundMcpCall`; N1 regex tightened in `companion-http.ts` |
| Live code | `dual-entry.ts`, `companion-http.ts`, `server.ts` (isOutboundMcpCall block) |
| Tests | `outbound-mcp-*.test.ts` — claim **42/40+ pass** after fix |

## Job

1. Confirm B1 was real (synthetic thread + isToolAllowed).  
2. Confirm fix closes B1 without re-opening L9 (lease still works; Side Panel wins intact).  
3. Spot-check N1–N4; say which remain.  
4. New blockers?  
5. Final line exactly:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
