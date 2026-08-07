# Dual review: Wave A Scene Knowledge — **implementation**

**Batch:** `wave-a-scene-knowledge-impl`  
**Stage:** G2 implementation gate  
**Date:** 2026-08-07  
**Plan:** `docs/superpowers/plans/2026-08-07-wave-a-scene-knowledge.md` (G1b APPROVE_WITH_NITS)

## Capability declaration

```text
Surface:      L0 scene editor + thread field
L2-classes:   (none)
Compose:      knowledge + pack
Autonomy:     n/a
Trust:        no elevation
Channel:      unchanged
```

## Required reading / spot-check

1. Plan (D1–D9, Task 4 allowlist)  
2. Diff / working tree — especially:  
   - `companion/src/message-router.ts` allowlist includes `active_knowledge_ids`  
   - `companion/src/threads/thread-manager.ts` field + validate + applyPackPatch  
   - `companion/src/skills/skill-engine.ts` `getActiveKnowledgeForThread`  
   - `companion/src/packs/*` knowledge_refs, install return, apply/unapply/snapshot  
   - `PacksPanel.tsx` knowledge multi-select + save  
   - `agentStore.tsx` hydrate activeKnowledgeIds  
   - `companion/tests/knowledge-active-ids.test.ts` (6 tests)

## Rejection gates

| # | Gate |
|---|------|
| R1 | `thread.update` allowlist still missing `active_knowledge_ids` |
| R2 | Manual KnowledgeSubPanel path still dead (update not persisted or resolve ignores field) |
| R3 | Trust elevation via knowledge/pack |
| R4 | Apply with empty knowledge wipes user active_knowledge_ids (violates D8 preserve) |
| R5 | Tests missing or failing for core contracts (allowlist, apply activate, saveUserPack refs) |

## Machine evidence (implementer)

```
node --test .test-dist/tests/knowledge-active-ids.test.js → 6/6 pass
node --test packs-engine + packs-validator + thread-pack-patch → 33/33 pass
```

## Output

Blocking / nits. Final line exactly:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
