# Dual review R2: Wave A Scene Knowledge plan (post-REJECT fix)

**Batch:** `wave-a-scene-knowledge-plan-r2`  
**Prior:** both REJECT on missing `message-router` `thread.update` allowlist for `active_knowledge_ids`  
**Date:** 2026-08-07  

## Required reading

1. **Plan (patched)** — `docs/superpowers/plans/2026-08-07-wave-a-scene-knowledge.md`  
   Focus: D8/D9, Task 4 (allowlist), Workflow G1 nits absorbed  
2. Prior REJECT reviews (optional):  
   - `docs/audit/reviews/wave-a-scene-knowledge-plan-claude-20260807-101501.md`  
   - `docs/audit/reviews/wave-a-scene-knowledge-plan-pi-20260807-101501.md`  
3. Spot-check: `message-router.ts` allowlist ~1617–1630 still lacks key (plan must add it)

## Must confirm

1. B1 fixed: plan explicitly adds `active_knowledge_ids` to WS allowlist + test  
2. No new Trust elevation  
3. Apply replace vs preserve (D8) coherent  
4. Plan implementable without invention  

## Rejection gates

| # | Gate |
|---|------|
| R1 | B1 still missing (no allowlist task) |
| R2 | Manual KnowledgeSubPanel path still not end-to-end in plan |
| R3 | Trust elevation |
| R4 | Major false code claims |

Final line:
```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
