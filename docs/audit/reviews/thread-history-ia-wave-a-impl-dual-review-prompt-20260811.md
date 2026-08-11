# Dual external review: Thread History IA — **Wave A implementation**

**Batch:** `thread-history-ia-wave-a-impl`  
**Stage:** Implementation review (code + tests)  
**Date:** 2026-08-11  
**Blast tier:** T1 (UI / L0 metadata only)

## Capability declaration

```text
Surface:      L0 chat UX / thread navigation metadata
L2-classes:   (none)
Compose:      none — digest extract reuses existing thread.extract_digest
Autonomy:     n/a; workers excluded from untagged batch (S2)
Trust:        unchanged
Channel:      community | enterprise unchanged
```

## Required reading

1. **Design SoT + pins**  
   - `docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md` (Wave A + GAP-11..17)  
   - `docs/audit/reviews/thread-history-ia-gap-opt-dual-synthesis-20260811.md` (S1–S10)

2. **Implementation (inspect with tools + diff)**  
   - `chrome-extension/src/sidepanel/components/ThreadList.tsx`  
   - `chrome-extension/src/sidepanel/utils/thread-timeline.ts` (`selectUntaggedForExtract`, etc.)  
   - `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` (`cmspark:digest_updated` event)  
   - `chrome-extension/tests/thread-timeline.test.ts`

3. **Machine check (already run by implementer — re-run if tools allow)**  
   - `npm --prefix chrome-extension test` → expect 0 fail

4. **ADR-020 checklist**  
   - `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Wave A acceptance (must verify)

| ID | Requirement |
|----|-------------|
| A-1 | `⋯` has 🏷 为未标注提取要点; ≤20; disabled when 0 targets |
| A-2 | Tags empty/high-untagged primary CTA; honest copy |
| A-3 | digest.tldr one-line ellipsis on rows |
| A-4 | Menu via portal to `document.body`, z > panel/backdrop |
| A-5 | Tag cloud max-height + 更多 collapse |
| A-6 | Multi-select 提取要点 still works |
| A-7 | Progress N/M from digest_updated; no fixed 60s clear of whole batch |

## Pins (blocking if violated)

| ID | Rule |
|----|------|
| S1 | empty-tags digests use force:true on untagged batch |
| S2 | default exclude `agent_role === "worker"` |
| S3 | skip busy; 0 targets → no empty batch send |
| S4 | portal menu (not only overflow:visible hack) |
| S5 | progress event-driven; batch-aware spinner clear |
| Scope | **No** Wave B/C, no companion protocol change, no Graph, no Knowledge dual-write |

## Your job

Independent senior **implementation** review. Inspect real diff/code. Do not rubber-stamp design approval.

### Must answer

1. Does implementation meet A-1..A-7 with file:line evidence?  
2. Are S1–S5 pins met?  
3. Any security/privacy regression (secrets in tldr UI, accidental full-library extract)?  
4. Tests adequate for pure helpers (selectUntagged, force, collapse, tldr)?  
5. Scope creep into B/C?  
6. Approve merge of Wave A / proceed to Wave B?

### Rejection gates

| # | Gate |
|---|------|
| R1 | Untagged batch missing force for empty-tags digests |
| R2 | Workers included by default in untagged batch |
| R3 | Empty batch still sent / CTA not disabled |
| R4 | Menu still clipped (no portal or equivalent) |
| R5 | Companion protocol / Graph / Knowledge dual-write shipped in this slice |
| R6 | Tests fail or pure-logic untested for S1–S3 |

## Output

1. Summary  
2. Spot-check A-1..A-7 + S1–S5 (file:line)  
3. Blocking / Nits  
4. Proceed to Wave B? yes/no  
5. Final line exactly:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
