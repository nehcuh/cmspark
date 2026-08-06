# Dual-review synthesis R2: Thread History IA implementation

**Date:** 2026-08-06 · **Batch:** `thread-history-ia-impl-r2`  
**Reviewers:** Claude · Pi  
**Verdicts:** Claude **APPROVE_WITH_NITS** · Pi **APPROVE_WITH_NITS** · **both_ok=true**

## Artifacts

| Role | Path |
|------|------|
| Prompt | `docs/audit/reviews/thread-history-ia-impl-r2-dual-review-prompt-20260806.md` |
| Claude | `docs/audit/reviews/thread-history-ia-impl-r2-claude-20260806-135746.md` |
| Pi | `docs/audit/reviews/thread-history-ia-impl-r2-pi-20260806-135746.md` |
| Verdict | `docs/audit/reviews/thread-history-ia-impl-r2-verdict-20260806-135746.json` |

## R1 → R2 gate

| ID | R1 | R2 both |
|----|-----|---------|
| **B1** single delete default hard | REJECT | **FIXED** |
| **B2** trash list corrupts UI | REJECT | **FIXED** |
| **B3** @ Enter double-send | REJECT | **FIXED** |
| Perf: list single-pass | nit | **LANDED** |
| Perf: digest queue max 2 + dedupe | nit | **LANDED** |
| Perf: purge batch saveIndex | nit | **LANDED** |
| **Blocking** | 3 | **None** |

## Evidence summary (both lanes)

- B1: `mode === "trash" ? trash : hard`; UI/background pass mode; tray listens `thread.trashed`/`restored`; legacy `files.test` green
- B2: `list_scope` echoed; trash → no SET_THREADS; all → no auto-create/select; ThreadList uses `include_trashed:true`
- B3: `slashVisible \|\| atVisible` gates Enter
- Tests: extension 448/448; companion thread suite 22/22; full companion fail set pre-existing on base (computer/UI, unrelated)

## Residual nits (non-blocking union)

1. No automated regression tests specifically for B2 list_scope / B3 atVisible gate
2. `thread.delete` server validator does not whitelist `mode` (batch does)
3. Background default mode string vs router hard default asymmetry if caller omits mode
4. No `trashed_at` guard on `chat.create` / `thread.select`
5. @ chip vs text desync
6. `thread.restore` broadcasts `thread.updated` (response type is `thread.restored`) — works, asymmetric

## Merge recommendation

**YES — merge-ready as Thread History IA P0–P1.5** with residual nits as follow-up.  
R1 REJECT is cleared; dual **both_ok=true**.

---
*Generated 2026-08-06*
