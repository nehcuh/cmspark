# Outbound MCP L8/L9 — confirmation synthesis (adversary → fix → Pi)

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Order | MACHINE → independent adversary → **fix B1** → Pi re-review |
| L8/L9 commit | `6d5790f` |
| Fix commit | `aa43a94` |

## MACHINE

| Result |
|--------|
| **42/42** outbound-mcp tests pass after fix (Pi re-ran) |

## Verdicts

| Stage | Reviewer | Verdict | Artifact |
|-------|----------|---------|----------|
| 1 Adversary | Claude | **REJECT** (B1 production-break) | [adversary-claude-20260804-131603](outbound-mcp-l8l9-adversary-claude-20260804-131603.md) |
| Fix | implementer | B1 + N1 + N3 doc | `aa43a94` |
| 2 Pi re-review | Pi | **APPROVE_WITH_NITS** | [pi-rereview-20260804-132508](outbound-mcp-l8l9-pi-rereview-20260804-132508.md) |

**Combined after fix:** both_ok for merge-of-code-path (adversary was correct to REJECT; Pi confirms fix).

## Blocker B1 (closed)

| | |
|--|--|
| **Bug** | `__thread_id: outbound_mcp:*` → `isToolAllowed` always false → all production outbound tools denied |
| **Fix** | `server.ts`: skip ThreadManager multi-agent / whitelist block when `isOutboundMcpCall` |
| **Pi** | Confirmed real + closed; L9 lease + Side Panel wins intact |

## Remaining nits

| ID | Status |
|----|--------|
| N1 confirm regex | **FIXED** |
| N2 mid-flight CDP on side_panel_wins | remains (design residual) |
| N3 lease cap 2 | **documented** in mcp.md |
| N4 audit `as any` | remains |
| Follow-up | real `createToolExecutor` + `__outbound_mcp` integration test | **FIXED** — `tests/integration/outbound-mcp-executor.test.ts` (B1 counterfactual + full stack) |

## MERGE claim

| Claim | Allowed? |
|-------|----------|
| L8/L9 code path after B1 fix | **YES** (Pi APPROVE_WITH_NITS) |
| Product ship / default-on | **NO** |
| P0d bake-off complete | **NO** (human still needed) |
