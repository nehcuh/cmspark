# MissionBoard Stage 2 — Measurement harness

**Date**: 2026-07-27  
**Goal**: Before expanding Intent scheduling / more tools, measure whether structured board handback beats prose-only AppSec pack.

## Automated (always green before merge)

```bash
cd companion
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/board-*.test.js .test-dist/tests/orchestrator-*.test.js
```

Track:

| Metric | How |
|--------|-----|
| Schema parse rate | unit tests on `parseHandbackPayload` |
| Prose rejection | `HANDBACK_MISSING_STRUCTURE` tests |
| Claim exclusivity | `board-intent-claim.test.ts` |
| Complete gates | `board-complete.test.ts` |

## Manual sample (5–10 PRDs, product)

For each sample page/PRD:

1. Apply `appsec-prd-review` (board_mode on)
2. Run natural-language review once
3. Record:
   - [ ] Handback JSON parse success (Y/N)
   - [ ] `facts.length` after collect
   - [ ] Spurious “review complete” without `board_complete` L2 (Y/N = fail)
   - [ ] User needed Hint inject (Y/N)

**Pass bar (suggested)**: parse success ≥ 70% on N≥5; zero silent complete without L2.

## When to unlock Stage 3+ expansion

- Automated suite green
- Manual bar met or consciously waived with reason in ship note
