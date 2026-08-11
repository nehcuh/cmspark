# Dual external re-review (r2): Thread History IA — Wave A implementation

**Batch:** `thread-history-ia-wave-a-impl-r2`  
**Stage:** Implementation re-review after Pi REJECT on A-5  
**Date:** 2026-08-11  
**Prior:** Claude APPROVE_WITH_NITS · Pi REJECT · both_ok=false  
**Prior reviews:**  
- `docs/audit/reviews/thread-history-ia-wave-a-impl-pi-20260811-111023.md` (A-5 blocking)  
- `docs/audit/reviews/thread-history-ia-wave-a-impl-claude-20260811-111023.md`

## Capability declaration

```text
Surface:      L0 chat UX / thread navigation metadata
L2-classes:   (none)
Compose:      none
Autonomy:     n/a; workers excluded from untagged batch
Trust:        unchanged
Channel:      community | enterprise unchanged
```

## What changed since r1 (must verify)

**Pi blocking A-5 fix:**
- Removed height-clip (`TAG_CLOUD_MAX_HEIGHT_PX` deleted).
- Count-fold only (`TAG_CLOUD_MAX_VISIBLE`).
- **「更多」/「收起」render OUTSIDE the pills flex row** (`tagCloudFoldRow` under `tagCloudSection`) so they cannot be clipped.

**Nits addressed:**
- Progress clear timer cancelled on new batch / shared ref.
- Progress mark-done only when fingerprint mark changes (no hasTags short-circuit).
- `handleExtractUntagged` uses `untaggedExtract.force`.
- Trash view → empty untagged selection (no extract on trashed).
- Primary CTA only when `ids.length > 0`.
- Simplified `selectUntaggedForExtract` force = ids non-empty.

## Required reading

1. Design SoT + pins: `docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md` Wave A + GAP-11..17  
2. Pi r1 blocking: `docs/audit/reviews/thread-history-ia-wave-a-impl-pi-20260811-111023.md` §3  
3. Code: `ThreadList.tsx` (tagCloudSection), `thread-timeline.ts`, tests  
4. Machine: `npm --prefix chrome-extension test` (expect 0 fail)

## Rejection gates (same + A-5)

| # | Gate |
|---|------|
| R1–R6 | Same as Wave A impl r1 prompt |
| **R7** | A-5 still clips 「更多」 or silently hides tags without affordance |

## Output

Spot-check A-5 fix with geometry reasoning. If only residual nits → APPROVE / APPROVE_WITH_NITS.  
**Proceed to Wave B?** yes/no  

Final line:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
