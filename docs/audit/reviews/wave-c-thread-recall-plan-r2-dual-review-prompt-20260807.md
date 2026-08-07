# Dual review R2: Wave C `thread_recall` plan (post-REJECT fix)

**Batch:** `wave-c-thread-recall-plan-r2`  
**Prior:** both REJECT on R2 — bare `{role,content}` bypasses F-S5 sensitive tool branches  

## Required reading

1. **Patched plan** — `docs/superpowers/plans/2026-08-07-wave-c-thread-recall.md`  
   Focus: C-D6, Task 1 `toCanonicalForRedact` / fail-closed, C-D4 CJK, C-D10 gated hint  
2. Prior REJECT reviews (optional): `wave-c-thread-recall-plan-claude|pi-20260807-113810.md`  
3. `redactMessagesForCompaction` in `context-budget.ts` + persisted Message shape in adapter `createToolResultMessage`

## Must confirm

1. B1 fixed: F-S5 cookie/shell branches can engage for recall hits  
2. Unresolvable tool → drop hit  
3. CJK bigrams specified  
4. Hint gated by allowlist  

## Rejection gates

| # | Gate |
|---|------|
| R1 | Still bare content-only mini messages without tool identity |
| R2 | Cross-thread |
| R3 | Trust elevation |
| R4 | Logs query/excerpts |

Final line:
```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
