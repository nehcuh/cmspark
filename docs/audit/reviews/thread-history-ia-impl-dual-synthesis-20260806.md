# Dual-review synthesis: Thread History IA **implementation**

**Date:** 2026-08-06 · **Batch:** `thread-history-ia-impl`  
**Reviewers:** Claude · Pi  
**Verdicts:** Claude **REJECT** · Pi **REJECT** · **both_ok=false**

## Artifacts

| Role | Path |
|------|------|
| Prompt | `docs/audit/reviews/thread-history-ia-impl-dual-review-prompt-20260806.md` |
| Claude | `docs/audit/reviews/thread-history-ia-impl-claude-20260806-134044.md` |
| Pi | `docs/audit/reviews/thread-history-ia-impl-pi-20260806-134044.md` |
| Verdict | `docs/audit/reviews/thread-history-ia-impl-verdict-20260806-134044.json` |

## What both agree holds

- Pins P2–P14 largely implemented (busy reject, withIndexLock, trust release on trash+hard, fingerprint, secret tags, @ fence, lazy purge, history.db retained)
- ADR-020 clean (L0 only)
- Core unit tests pass; typecheck clean
- `@` fallback-first + full mode blocked

## Blocking union (must fix)

| ID | Source | Issue | Fix |
|----|--------|-------|-----|
| **B1** | Claude | `thread.delete` default hard→soft broke `files.test.ts` + tray `thread.deleted` listener | Single delete default **hard**; UI passes `mode:"trash"` |
| **B2** | Pi | Trash view `thread.list` reuses handler → empty trash auto-creates thread; open trash deselects active chat | Echo list scope; skip auto-create/auto-select for trash-scoped list |
| **B3** | Pi | `@` popover Enter also sends (not gated like `/`) | Gate `handleSend` on `atVisible` |

## Shared nits (non-blocking)

- listWithPreviews double-reads message files (perf)
- on_at_ref unbounded concurrent LLM extracts
- single delete no server busy check
- chip/text desync for @ refs
- no router e2e for restore / context_refs / extract_digest
- parent cascade delete prompt still deferred

## Recommendation

**Not merge-ready** at review time. **Post-review hotfixes applied in same session:**

| ID | Fix |
|----|-----|
| B1 | `thread.delete` default restored to **hard**; UI passes `mode:"trash"`; busy reject on single delete |
| B2 | `thread.list` echoes `list_scope`; extension skips auto-create/auto-select for `trash`/`all`; `only_trashed` ignored for global store |
| B3 | `handleKeyDown` gates Enter on `atVisible` same as `slashVisible` |

Re-test: companion batch/cleanup 12/12; extension tsc. Optional: re-run dual for confirmation.

---
*Synthesis 2026-08-06 · hotfixes noted same day*
