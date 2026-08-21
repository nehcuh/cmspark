# Eval gate card — web-act-loop-direction-20260821

**Blast tier**: T2 (direction lock, no code ship)  
**Date**: 2026-08-21

```text
Surface:      L1 browser CDP
L2-classes:   none new
Compose:      none
Autonomy:     single
Trust:        click-by-text stays L1 iff finder JSON.stringify; osascript/evaluate stay L2
Channel:      community
```

## Machine

- [x] Thread histogram re-executed (Claude): 81/54/26/3/1
- [x] Live citations inspected by adversaries + Claude (catalog, click catch, liar success, recoverable list, finder)

## Judges

- [x] Browser adversary APPROVE_WITH_NITS
- [x] Policy adversary APPROVE_WITH_NITS (rejected W3 scheme ban)
- [x] Surface adversary APPROVE_WITH_NITS
- [x] Fold absorbed falsifiers
- [x] Claude dual APPROVE_WITH_NITS
- [x] Kimi dual APPROVE_WITH_NITS

## Verdict

| Gate | Result |
|------|--------|
| MACHINE | PASS (trace + code inspect; no feature tests — direction only) |
| ADVERSARY | APPROVE_WITH_NITS (3/3 after fold; policy rejected pre-fold W3) |
| DUAL Claude | APPROVE_WITH_NITS |
| DUAL Kimi | APPROVE_WITH_NITS |
| IMPLEMENT | YES — wave-1 = W1 + W3′ + liar-success + absorbed nits; not this session unless user says go |
