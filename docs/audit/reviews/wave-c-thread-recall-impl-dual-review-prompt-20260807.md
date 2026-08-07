# Dual review: Wave C `thread_recall` — **implementation**

**Batch:** `wave-c-thread-recall-impl`  
**Plan:** `docs/superpowers/plans/2026-08-07-wave-c-thread-recall.md` (R2 Pi required synthetic assistant for orphans)  

## Capability declaration

```text
Surface:      L0 companion tool thread_recall
Trust:        no elevation; F-S5 redact
```

## Spot-check

1. `companion/src/threads/thread-recall.ts` — toCanonicalForRedact synthetic orphan path  
2. `companion/src/server.ts` case thread_recall — only `__thread_id`, no query in logs  
3. `tool-definitions-catalog.json` entry  
4. `appendRecallHintToNotices` + adapter `isToolAllowed` gate  
5. `companion/tests/thread-recall.test.ts` — cookie orphan + shell paired  

## Rejection gates

| # | Gate |
|---|------|
| R1 | Cross-thread via client thread id |
| R2 | Cookie/shell excerpts leak raw values (paired or orphan) |
| R3 | L2 / Trust elevation |
| R4 | Query text or excerpts in logs |
| R5 | Tests red |

## Machine

```
npx tsc -p tsconfig.test.json  # clean
node --test thread-recall + context-budget → 22/22
```

Final line:
```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
