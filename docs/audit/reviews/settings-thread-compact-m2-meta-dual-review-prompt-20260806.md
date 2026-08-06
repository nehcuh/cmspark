# Pi re-review: settings-thread-compact M2 meta + defaults

**Batch:** `settings-thread-compact-m2-meta`  
**Stage:** Implementation (W0–W3 + M2 meta / defaults)  
**Date:** 2026-08-06  
**Prior design:** Pi APPROVE_WITH_NITS on design SoT (`settings-thread-compact-pi-20260806-221435`)

## Capability declaration

```text
Surface:      L0 chat UX + request-path context budget
L2-classes:   (none)
Compose:      none — runtime_context_budget ≠ Digest / Export / Pack
Autonomy:     n/a — per-thread meta only
Trust:        no elevation; M2 redacts before summary LLM
Channel:      community | enterprise unchanged
```

## What shipped (this delta)

1. **M2 default strategy**
   - `context_compaction_m2` default **true** (new installs)
   - `shouldRunM2`: pre_loop only; need ≥3 dropped msgs OR ≥500 tokens dropped; mid_loop M1-only
2. **Thread meta `runtime_context_budget`**
   - Sanitized on `threadManager.update`
   - Fields: mode, dropped_count, tokens_*, rolling_summary (capped), summary_sha256, phase
   - Distinct from ThreadDigest / export
3. **UI「查看摘要」**
   - ChatView banner + modal from event `rolling_summary` or thread meta after list/update
4. **context_window default → 128000**
   - companion config default, extension store, ThreadList new thread, settings-web fallback
   - Settings help text recommends 128k when value ≥200k
   - Existing on-disk configs with 1e6 **unchanged** (deepMerge)

## Required reading

1. Design SoT: `docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md`
2. Adversary synthesis: `docs/audit/reviews/settings-thread-compact-adversary-synthesis-20260806.md`
3. Code:
   - `companion/src/llm/context-budget.ts` · `context-budget-m2.ts` · `adapter.ts` (runContextBudgetPass)
   - `companion/src/threads/runtime-context-budget.ts` · `thread-manager.ts` update path
   - `companion/src/config.ts` defaults
   - `chrome-extension/.../ChatView.tsx` banner + modal
   - `SettingsSlideout.tsx` M2 + window help
4. Checklist: `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Product premise (must not weaken)

```text
1. Disk + UI history full; compact is request-path (+ meta for UI).
2. Digest ≠ export ≠ runtime budget (no smuggling).
3. M2 input redacted; audit stores hash/bytes not full summary text.
4. Dual-truth banner when compacted.
5. No Trust elevation.
6. Default 128k makes auto compact real; honesty copy if user sets huge window.
```

## Must answer

1. Are F-S4/F-S5/F-S8 still held with rolling_summary on thread index?
2. Is M2 default-on safe (cost/latency/privacy) given pre_loop-only gate?
3. Is 128k default correct without breaking existing 1e6 installs?
4. Can「查看摘要」leak secrets that redact missed?
5. Any REJECT-level hole vs design floors?

## Rejection gates

| # | Gate |
|---|------|
| R1 | rolling_summary auto-injected into other threads / digest / default export |
| R2 | M2 summary built from unredacted cookie/shell tool bodies |
| R3 | Disk messages mutated with omit/summary rows |
| R4 | Armed Trust buried again / capability elevation via compaction |
| R5 | Claims default 1e6 users auto-compress without honesty |

## Output

Blocking vs nits; end with exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
