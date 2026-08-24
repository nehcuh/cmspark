# 四路增量复验合成 — post-#219 kimi nits folds (r2)

| Field | Value |
|-------|--------|
| Date | 2026-08-25 |
| HEAD | `c5b4242` |
| Method | Same 4 independent lanes as r1; replay original attacks + attack the fix |
| r1 | A/C/D REJECT, B AWN |
| r2 | **A AWN · B APPROVE · C AWN · D AWN** — no BLOCK |

Reports: `post219-kimi-nits-lane-{a,b,c,d}-r2-20260825.md`

## Prior BLOCK/High vs r2

| ID | r1 | r2 |
|----|----|----|
| A-BLOCK provider mock | REJECT 0/13 | **GONE** 13/13; probe providerHit=1 |
| A-High leftover dropSteer | wipe successor | **GONE** warn-only |
| A-High filler global match | wrong-row | **GONE** assistant-scoped |
| B-High file.uploaded replace | High | **GONE** sendToExtension + keep ack; overlay success drain **executed** |
| C-High reclaim steal | REJECT | **GONE** token gate; bind/clear funnel |
| D-High keys/extras/≤200 | REJECT | **GONE** 14/14 + probe |

## Residuals (non-blocking)

- leftover→nextRun drops `clientMessageId`
- `passwd` / generic `value` keys still persist on non-cookie tools
- `setSummonerThreadId` test hook binds with `currentOverlaySession()` (zero production callers)
- M3 pack.apply router tests still out of slice
- N1 chat.done idle flash / N9 length budget / R2-N2 over-cap

## Eval gate

- MACHINE: PASS (r2 lanes re-ran suites)
- ADVERSARY r2: all APPROVE*
- PI_REREVIEW: **APPROVE_WITH_NITS** (`post219-kimi-nits-r2-pi-20260825.md`; `--no-tools` + attached live files — Windows `pi -p` aborts at first bash tool call)
- KIMI: skipped (403 quota)
- MERGE: **YES on a branch** — not onto `main` directly
