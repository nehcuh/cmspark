# Dual review: Wave D Reasoning UI + export — **implementation**

**Batch:** `wave-d-reasoning-ui-export-impl`

## Spot-check

1. ChatView ReasoningBlock mode + copy
2. Settings show_reasoning + export include
3. markdown-export strip/include + tests
4. message-router include_reasoning

## Rejection gates

| # | Gate |
|---|------|
| R1 | Default export includes reasoning without opt-in |
| R2 | Trust elevation |
| R3 | rebuild injects reasoning |

## Machine

markdown-export tests 30/30 pass

Final:
```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
