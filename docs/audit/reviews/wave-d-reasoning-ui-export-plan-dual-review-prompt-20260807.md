# Dual review: Wave D Reasoning UI + export — **plan**

**Batch:** `wave-d-reasoning-ui-export-plan`  

## Required reading

1. `docs/superpowers/plans/2026-08-07-wave-d-reasoning-ui-export.md`
2. `ChatView.tsx` ReasoningBlock (~712+)
3. `markdown-export.ts` ExportMessage (no reasoning field today)
4. Parent analysis §4.2 T1–T4

## Rejection gates

| # | Gate |
|---|------|
| R1 | Default export includes full reasoning without opt-in |
| R2 | Trust elevation or L2 |
| R3 | Forces rebuildMessagesFromHistory to re-inject reasoning |
| R4 | Stores preference only server-side forcing multi-device secret leak of UI prefs |

Final:
```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
