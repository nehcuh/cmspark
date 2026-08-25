# Independent adversary — post-#220 residual nits fold

**Date**: 2026-08-25
**Base**: `1d16b0e` (PR #220 on main)
**Head**: `9deff00` (`fix/post220-residual-nits`)
**Frozen patch**: `docs/audit/reviews/post220-nits-diff-20260825-092457.patch`
**SHA256**: `2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51`
**Diff**: `git diff 1d16b0e..9deff00 -- companion` (14 files, +477/−56)

## Why this round

Post-merge four-lane adversary of #220 was **APPROVE_WITH_NITS**. Implementer folded the listed residuals on a **new branch**. This round re-verifies the folds. Do **not** rubber-stamp the implementer session. Default: REFUTED.

Prior (context only): `docs/audit/reviews/post220-merged-adversary-synthesis-20260825.md`

## Capability declaration (implementer claim — challenge it)

```text
Surface:      L0
L2-classes:   none
Compose:      none
Autonomy:     steer / nextRun queue plumbing
Trust:        persistence redaction tighter (passwd, non-string secret keys)
Channel:      overlay bind/reclaim live-gate
```

Blast: **T2**. Escalate to T3 only if overlay becomes Allow/Deny, confirm skip, or claimed secrets still persist.

## Claimed folds (must-falsify)

| ID | Claim |
|----|--------|
| S-A1 | `nextRun` stores `{text, clientMessageId?}`; leftover + occupied enqueue keep first id; drain follow-up `chat.create` echoes it |
| S-A2 | `persistHealedToolRows` skip is scoped to the in-flight assistant contiguous tool block (reused `call_*` on a newer unpaired assistant still heals) |
| S-A3 | leftover conversion via `convertLeftoverSteerToNextRun` does **not** wipe the steer queue; adapter does not call `dropSteer` |
| S-B1 | `drainNextRun` pre-checks pause/trash **before** `takeNextRun`; paused finishing run keeps the queue + pushes `thread_paused` |
| S-B2 | regen overlay-gate and conductor drain keep the queue (tests exist and pin) |
| S-B3 | upload drain always keeps `file.uploaded` (push any drain frame; never `return drainedAfterUpload`) |
| S-C1 | `setSummonerThreadId` is gone |
| S-C2 | submit-ok bind gated on `overlaySessionIsLive(token)`; reclaim uses `claimOverlayIfLive` (post-await generation check + unwind) |
| S-D1 | `passwd` in key regex; cookie extra sensitive keys scanned; generic `value` **not** globally redacted |
| S-D2 | array / numeric sensitive keys redacted (not only `typeof === "string"`) |
| S-D3 | `history/store.ts` regex + leaf logic lock-step with thread-JSON redactor |

## Intentionally out of slice (do not REJECT solely for these)

- Blanket redact of generic `value` keys
- M3 overlay `pack.apply` router tests
- N1 `chat.done` idle flash / N9 length output budget

## Rules

1. Independent adversary. `[executed]` / `[inspected]` / `[assumed]`. Never invent file:line.
2. Mutation-kill at least one claimed pin in your lane.
3. Do not edit production source. Private `/tmp` copies OK; delete after.
4. Score outcome / trajectory / component.
5. Final line exactly one of:
   `VERDICT: APPROVE`
   `VERDICT: APPROVE_WITH_NITS`
   `VERDICT: REJECT`
