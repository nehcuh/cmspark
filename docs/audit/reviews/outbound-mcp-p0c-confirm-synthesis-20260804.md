# Outbound MCP P0c — confirmation synthesis (adversary → Pi)

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Order | MACHINE → independent adversary → Pi re-review |
| HEAD | `63d36af` (+ docs commits) |
| Base | `origin/main` merge-base |

## MACHINE

| Suite | Result |
|-------|--------|
| `outbound-mcp-facade.test` + `outbound-mcp-companion-http.test` | **18/18 pass** (adversary claim + Pi re-run) |

## Verdicts

| Stage | Reviewer | Verdict | Artifact |
|-------|----------|---------|----------|
| 1 Adversary | Claude (independent CLI) | **APPROVE_WITH_NITS** | [outbound-mcp-p0c-adversary-claude-20260804-105153.md](outbound-mcp-p0c-adversary-claude-20260804-105153.md) |
| 2 Pi re-review | Pi | **APPROVE_WITH_NITS** | [outbound-mcp-p0c-pi-rereview-20260804-110035.md](outbound-mcp-p0c-pi-rereview-20260804-110035.md) |
| Combined | — | **both_ok=true** (no REJECT) | — |

## Blockers

**None.** Adversary found zero blockers; Pi confirmed no missed blockers.

## Nits kept (follow-up, non-blocking for P0c gate layer)

| # | Topic | Owner / when |
|---|--------|----------------|
| N1 | M6: synthetic origin not bound into L2 confirm; production uses Extension `originWs` | Before L8 / interactive bake-off — document or bind synthetic |
| N2 | Default `caller_id=stdio-default` shared across clients | Prefer unique `CMSPARK_OUTBOUND_CALLER_ID` per agent (docs) |
| N3 | timingSafeEqual length early-return (minor) | Optional harden |
| N4 | INTERNAL_NAME_MISSING audit skip on HTTP path (unreachable) | Optional consistency |
| N5 | No HTTP-layer e2e test | **FIXED** — `tests/outbound-mcp-http-e2e.test.ts` (2026-08-04) |
| N6 | Unauth `/outbound-mcp/v1/health` leaks runner wired\|none | Acceptable P0c (loopback) |
| N7 | First-run ws_secret dual-process race | Doc: start companion before mcp-outbound |

## Residual (explicitly not claimed done)

- L8 tray/global confirm  
- L9 dual-entry tab lease  
- Live SSO bake-off (P0d)  
- Per-caller grant (P1 / L4+)  

## MERGE claim

| Claim | Allowed? |
|-------|----------|
| Gate + disclosure + loopback HTTP dispatcher **library/P0c code path** ready for human bake-off | **YES** (APPROVE_WITH_NITS both) |
| Product ship / default-on / CWS | **NO** |
| P0c “fully complete” including L8/L9 | **NO** |

## Eval gate card

```text
Blast tier: T3
MACHINE: PASS (18/18)
ADVERSARY: APPROVE_WITH_NITS
PI_REREVIEW: APPROVE_WITH_NITS
MERGE (code path for bake-off): YES — nits tracked above
```
