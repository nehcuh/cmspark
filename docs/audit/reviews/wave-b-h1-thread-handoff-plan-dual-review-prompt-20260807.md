# Dual review: Wave B H1 ThreadHandoff — **plan** (pre-code)

**Batch:** `wave-b-h1-thread-handoff-plan`  
**Date:** 2026-08-07  

## Capability declaration

```text
Surface:      L0 request-path context budget (H1)
Compose:      none
Trust:        no elevation; F-S5 redact
```

## Required reading

1. **Plan** — `docs/superpowers/plans/2026-08-07-wave-b-h1-thread-handoff.md`
2. **Parent analysis** — `docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md` §4.1 §4.3 Wave B
3. **Grounding**  
   - `companion/src/llm/context-budget.ts` / `context-budget-m2.ts`  
   - `companion/src/llm/adapter.ts` `runContextBudgetPass`  
   - `companion/src/threads/runtime-context-budget.ts`  
   - compact-ux SoT: three-system glossary; M3 ≠ this H1

## Premise

```text
1. H1 = structured anchored handoff; extends runtime budget only.
2. No raw CoT as compressed payload.
3. M1 floor + H1 fail → M2 → M1 cascade.
4. mid_loop no new extract.
5. Schema frozen in plan; challenge caps/fields if wrong.
```

## Rejection gates

| # | Gate |
|---|------|
| R1 | Merges H1 into Digest/Export or auto global knowledge |
| R2 | Raw reasoning_content as primary notice body |
| R3 | Removes M1 turn-safe drop as only path |
| R4 | Schema inventable / unclosed (no caps, no inject prefix) |
| R5 | mid_loop re-extracts every tool round (latency bomb) without acknowledge |

## Must answer

1. Schema fields + caps adequate?  
2. Reuse `context_compaction_m2` gate OK vs new flag?  
3. Cascades and retain correct?  
4. Implementable without invention?

Final line:
```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
