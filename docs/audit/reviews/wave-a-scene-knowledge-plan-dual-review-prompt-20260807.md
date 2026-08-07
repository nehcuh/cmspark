# Dual review: Wave A Scene Knowledge — **implementation plan** (pre-code)

**Batch:** `wave-a-scene-knowledge-plan`  
**Stage:** Plan gate G1 — approve before coding  
**Date:** 2026-08-07  

## Capability declaration

```text
Surface:      L0 scene editor
L2-classes:   (none)
Compose:      knowledge + pack
Autonomy:     n/a
Trust:        no elevation
Channel:      unchanged
```

## Required reading

1. **Plan** — `docs/superpowers/plans/2026-08-07-wave-a-scene-knowledge.md`
2. **Parent analysis** — `docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md` § Wave A + §9 nits
3. **Grounding (spot-check plan claims)**  
   - `companion/src/skills/skill-engine.ts` `getActiveKnowledgeForThread` / `resolveKnowledgeIdsForThread`  
   - `chrome-extension/.../KnowledgeSubPanel.tsx` sends `active_knowledge_ids`  
   - `companion/src/threads/thread-manager.ts` Thread fields (no active_knowledge_ids today?)  
   - `companion/src/packs/pack-engine.ts` saveUserPack `knowledge: []`, install knowledge without activating  
   - `PacksPanel.tsx` no knowledge UI  

## Premise

```text
1. Fix orphan: UI active_knowledge_ids → companion must resolve it.
2. User scenes get knowledge_refs parallel to skill_refs.
3. Pack-local knowledge files install + activate on apply.
4. Snapshot/unapply restores knowledge activation.
5. Trust untouched.
```

## Must answer

1. Is D1 (independent active_knowledge_ids) correct vs stuffing into active_skill_ids?  
2. Is D2 back-compat union necessary or harmful?  
3. Does installAssets return signature change risk miss call sites?  
4. When pack has empty knowledge, preserve baseSnap knowledge — correct?  
5. Any Trust / ADR-020 violation?  
6. Plan closed enough to implement without invention?

## Rejection gates

| # | Gate |
|---|------|
| R1 | Plan would elevate Trust via knowledge |
| R2 | Plan leaves manual KnowledgeSubPanel still non-functional |
| R3 | Plan wipes user knowledge selection on every pack apply with empty knowledge |
| R4 | Plan invents second knowledge runtime instead of thread field + pack refs |
| R5 | Major false claim about current code |

## Output

Blocking / nits / plan readiness. Final line exactly:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
