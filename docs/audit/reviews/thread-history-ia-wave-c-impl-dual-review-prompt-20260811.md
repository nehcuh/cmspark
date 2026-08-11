# Dual external review: Thread History IA — **Wave C implementation**

**Batch:** `thread-history-ia-wave-c-impl`  
**Stage:** Implementation review  
**Date:** 2026-08-11  
**Prerequisite:** Wave A r2 + Wave B both_ok

## Capability declaration

```text
Surface:      L0 chat UX exploration (related list + graph popup)
L2-classes:   (none)
Compose:      none — related edges are ephemeral scores, not Knowledge
Autonomy:     n/a
Trust:        unchanged
Channel:      community | enterprise unchanged
```

## Wave C acceptance

| ID | Requirement |
|----|-------------|
| C-1 | `thread.related` pure local (companion) + client mirror; co-tag + TF + time; **no @ edges** (C.1b deferred) |
| C-2 | Related top-3 UI (🔗); click opens thread |
| C-3 | Graph **popup** (not default nav); edges from digests; empty state if no edges |
| C-4 | Cleanup lint: untagged / stale / isolated counts |
| S9 | Weights are code constants |

## Required reading

1. Design Wave C + GAP-16/17: `docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md`  
2. `companion/src/threads/related.ts` + `message-router` `thread.related`  
3. `chrome-extension/src/sidepanel/utils/thread-related.ts` + `ThreadList.tsx` related/graph  
4. Tests: `chrome-extension/tests/thread-related.test.ts`, `companion/tests/thread-related.test.ts`  
5. Machine: extension 614 pass; companion related tests pass

## Rejection gates

| # | Gate |
|---|------|
| R1 | Graph becomes default navigation / replaces time axis |
| R2 | Requires embedding / graph DB / llm_wiki entity pages |
| R3 | `@` edges required (must be deferred) |
| R4 | Knowledge dual-write |
| R5 | L2 / new confirm |
| R6 | Tests fail or scoring untested |

## Must answer

1. C-1..C-4 + S6/S9 met?  
2. Still L0 only?  
3. Full A→B→C pipeline shippable?

Final line: `VERDICT: APPROVE` | `APPROVE_WITH_NITS` | `REJECT`
