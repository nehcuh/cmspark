# Dual external review: Side Panel 「精密仪器台」**Phase 1 implementation**

**Batch:** `sidepanel-precision-instrument-p1-impl`  
**Stage:** Implementation gate after design dual APPROVE_WITH_NITS  
**Date:** 2026-08-11  
**Commit:** `feat/sidepanel-precision-instrument-p1` vs `origin/main`  
**Design gate:** `sidepanel-precision-instrument-design-verdict-20260811-203708` (both APPROVE_WITH_NITS)

## Capability declaration

```text
Surface:      L0 Panel chrome (tokens + shell presentation only)
L2-classes:   (none new)
Compose:      none
Autonomy:     none
Trust:        no elevation; FocusBand confirm/急停 weight must not drop
Channel:      unchanged
```

## Scope (in PR)

| Area | Files |
|------|--------|
| Tokens | `chrome-extension/src/sidepanel/ui/tokens.ts` |
| Shell | `App.tsx` container / inputArea / composer / send / stop |
| Rail | `StatusRail.tsx` |
| Stream | `ChatView.tsx` empty + user bubble |
| Focus | `FocusBand.tsx` padding / hairline card only |
| Tests | `tests/tokens-helpers.test.ts` |
| Docs | `PRODUCT.md`, `docs/DESIGN.md`, design SoT + design dual artifacts |

**Out of scope (must NOT appear in this PR):** Thread graph, icons regen, host-integrity SHA, Settings/MCP rewrite, Phase 2/3.

## Required reading

1. Design SoT — `docs/superpowers/specs/2026-08-11-sidepanel-precision-instrument-redesign.md` §3 Phase 1 + §6 acceptance R1–R6  
2. Design dual reviews (absorb nits N5–N7 / Pi notes on glass wording)  
3. Diff: commit `2a6797b` vs `origin/main` (working tree should be clean of graph WIP)  
4. ADR-020 checklist  

## Acceptance (re-check from code)

| # | Check |
|---|--------|
| R1 | No glass composer, no canvas gradient |
| R2 | Type scale 11/12/13/15 in StatusRail + empty + composer (empty title 15 not 18) |
| R3 | Send = solid accent; mode remains chip |
| R4 | FocusBand confirm/急停 still present; no dangerSurface removal |
| R5 | `npm --prefix chrome-extension test` green (implementer claims 622 pass) |
| R6 | Density budget heights unchanged (no minHeight constant growth); chip row ≤40 noted in DESIGN.md |

## Rejection gates

| # | Gate |
|---|------|
| B1 | Weakens 急停/confirm (removes dangerSurface, buries abort, shrinks FocusBand below usability) |
| B2 | Ships Thread Graph / host-integrity / unrelated features in this PR |
| B3 | Introduces new L2 tools or trust elevation |
| B4 | Leaves residual glass/`backdrop-filter` on primary shell or canvas gradient |
| B5 | Breaks token contract without updating tests |

## Must answer

1. Does the diff implement Phase 1 only and match design token table (§4)?  
2. Are design dual nits N5 (chip ≤40), N6 (motion freeze), N7 (budget doc) reflected enough for merge?  
3. FocusBand change is padding/shadow only — confirm 急停 path intact.  
4. Any over-claim or missing DESIGN.md sync?

## Output

Summary · file:line spot-checks · blocking · nits · scope ADR-020 · exact VERDICT line.
