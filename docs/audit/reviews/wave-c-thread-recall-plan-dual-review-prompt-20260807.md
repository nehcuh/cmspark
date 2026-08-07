# Dual review: Wave C `thread_recall` — **plan** (pre-code)

**Batch:** `wave-c-thread-recall-plan`  
**Date:** 2026-08-07  

## Capability declaration

```text
Surface:      L0 companion tool thread_recall
L2-classes:   (none)
Compose:      none
Trust:        no elevation; F-S5 redact
```

## Required reading

1. **Plan** — `docs/superpowers/plans/2026-08-07-wave-c-thread-recall.md`
2. **Parent analysis** Wave C — `docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md`
3. **Grounding**  
   - `companion/src/llm/context-budget.ts` `redactMessagesForCompaction`  
   - `companion/src/server.ts` COMPANION_TOOLS + executeCompanionTool  
   - `companion/src/bridge/tool-definitions-catalog.json`  
   - `companion/src/threads/thread-manager.ts` getMessages  

## Premise

```text
1. Same-thread cold search after compact; no embeddings.
2. Reuse F-S5 redact; no cross-thread.
3. Audit without query text or excerpts.
4. Optional one-line hint on compact notices.
```

## Rejection gates

| # | Gate |
|---|------|
| R1 | Cross-thread search by default or client-supplied foreign thread id without hard reject |
| R2 | Skips redact for tool payloads (cookies/shell) |
| R3 | Requires L2 / elevates Trust |
| R4 | Embedding dependency |
| R5 | Logs full query or hit excerpts |

## Must answer

1. Keyword score adequate vs BM25 complexity?  
2. C-D9 whitelist stance OK?  
3. Notice hint spam risk?  
4. Implementable without invention?

Final line:
```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
