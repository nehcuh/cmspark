# Dual review: Wave B H1 ThreadHandoff — **implementation**

**Batch:** `wave-b-h1-thread-handoff-impl`  
**Plan:** `docs/superpowers/plans/2026-08-07-wave-b-h1-thread-handoff.md` (G3 APPROVE_WITH_NITS)  
**Date:** 2026-08-07  

## Capability declaration

```text
Surface:      L0 request-path H1 handoff
Compose:      none
Trust:        no elevation; F-S5 redact
```

## Required reading / spot-check

1. Plan H-D1–H-D10  
2. Diff — especially:  
   - `companion/src/llm/context-handoff.ts`  
   - `companion/src/llm/context-budget.ts` (HANDOFF_PREFIX, retain)  
   - `companion/src/llm/adapter.ts` H1 cascade  
   - `companion/src/threads/runtime-context-budget.ts` mode h1 + handoff  
   - ChatView chip structured sections  
   - `companion/tests/context-handoff.test.ts`  

## Rejection gates

| # | Gate |
|---|------|
| R1 | Handoff written into Digest/Export/global knowledge |
| R2 | Raw reasoning_content as notice body |
| R3 | M1 floor removed |
| R4 | mid_loop runs new H1 LLM extract |
| R5 | Circular import / tests red on context-handoff + context-budget |

## Machine evidence

```
npx tsc -p tsconfig.test.json  # clean
node --test context-handoff + context-budget + knowledge-active-ids → 26/26 pass
```

Final line:
```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
