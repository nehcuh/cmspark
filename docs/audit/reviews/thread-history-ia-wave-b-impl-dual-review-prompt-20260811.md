# Dual external review: Thread History IA — **Wave B implementation**

**Batch:** `thread-history-ia-wave-b-impl`  
**Stage:** Implementation review  
**Date:** 2026-08-11  
**Prerequisite:** Wave A r2 both_ok (APPROVE_WITH_NITS)

## Capability declaration

```text
Surface:      L0 chat UX + companion config.thread_digest (metadata only)
L2-classes:   (none)
Compose:      none — no Knowledge/Pack dual-write
Autonomy:     n/a; workers excluded from lazy extract
Trust:        unchanged; config.set only nested thread_digest (no security arm)
Channel:      community | enterprise unchanged
```

## Wave B acceptance

| ID | Requirement |
|----|-------------|
| B-1 | `config.thread_digest` default enabled=false; Settings UI; config.set accepts nested/flat fields |
| B-2 | Lazy extract on ThreadList open when enabled; idle hours; max_per_day local quota; cap ≤20 |
| B-3 | Stale badge on time view for **non-today** only; tags view always |
| B-4 | Cleanup assistant 「仅提取要点」 (no delete) |

## Required reading

1. Design: `docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md` Wave B  
2. Code:  
   - `companion/src/config.ts` (`ThreadDigestConfig`)  
   - `companion/src/message-router/handlers/config.ts` (thread_digest set)  
   - `chrome-extension/.../useWebSocket.ts` normalizeConfig  
   - `chrome-extension/.../SettingsSlideout.tsx` 会话索引  
   - `ThreadList.tsx` lazy effect + cleanup extract  
   - `thread-timeline.ts` selectLazyDigestCandidates / showDigestStaleBadge / quota  
3. Machine: `npm --prefix chrome-extension test` (expect 0 fail)

## Pins / rejection gates

| # | Gate |
|---|------|
| R1 | Default enabled=true or silent full-library without cap |
| R2 | Lazy ignores max_per_day / exceeds 20 per request |
| R3 | Workers included by default in lazy batch |
| R4 | Stale badge floods today group (violates B-3) |
| R5 | Knowledge dual-write / Graph / L2 |
| R6 | Tests fail or pure helpers for quota/lazy untested |

## Must answer

1. B-1..B-4 met with file:line?  
2. Cost safety: default off + daily quota + idle filter?  
3. Proceed to Wave C?

Final line: `VERDICT: APPROVE` | `APPROVE_WITH_NITS` | `REJECT`
