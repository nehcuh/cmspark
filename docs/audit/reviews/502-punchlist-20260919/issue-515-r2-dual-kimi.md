# Independent Implementation Re-Review (R2) — #515 worker subtask identity

**Reviewer: kimi** · Scope: uncommitted diff (6 files: thread-timeline.ts, ThreadList.tsx, WorkspaceFrame.tsx, AtThreadPopover.tsx, StatusRail.tsx, tests/thread-timeline.test.ts) + `docs/superpowers/specs/2026-09-20-worker-subtask-identity.md` · No source edits made. Companion board/collect_handback and ChatView.tsx changes excluded per prompt.

## Previous REJECT items — re-verified

- **B1 (require broke tsc) — CLOSED.** `tests/thread-timeline.test.ts:3-4` now uses static `import { readFileSync } from "node:fs"` / `import { join } from "node:path"`, matching repo convention. `[executed]` `npm test` in `chrome-extension/`: full chain runs (the `tsc -p tsconfig.test.json` gate passes, `node --test` executes) → **1450 pass, 0 fail**. Gate green.
- **B2 (excludeId pre-filter leaked idle workers) — CLOSED.** `AtThreadPopover.tsx:44-48` now filters only `!t.trashed_at` before calling `filterConversationEnum`, and `filterConversationEnum` (`thread-timeline.ts:455-470`) builds `viewIds` from that un-excluded list, applying `excludeId` purely as a result filter inside the same `filter` pass. @ from the parent: parent remains in `viewIds` → its idle workers stay hidden. Directly pinned by the new test `#515 filterConversationEnum excludeId does not leak parent workers`, including the counterfactual that dropping the parent from the input degrades to orphan-visible (documenting why excludeId must be a result filter).
- **B3 (@ search bare title) — CLOSED.** `AtThreadPopover.tsx:42-46` adds `enumTitle` = `workerBelongTitle` for workers (parent resolved from the full `threads` prop), used for scoring (`:63`), keyboard `onSelect` (`:100`), and row render (`:157`). Search hits now carry `子任务 · 属于「父」` per spec L29. Bonus: scoring also matches `worker_role_label` (score 1/2), so @ by role name works — closes claude's N2 searchability half.
- **N1 (trash-view chip activates soft-deleted parent) — CLOSED.** `ThreadList.tsx:1043` chip now has `disabled={trashView}`, a trash-specific `title`, and a `if (trashView) return` guard in `onClick`. Pinned by the source-grep test (`kidCount > 0 … disabled={trashView}`).

## Claims verification

1. **Shared `filterConversationEnum`** — ✅ ThreadList.tsx:399-403, WorkspaceFrame.tsx:56-59, AtThreadPopover.tsx:45-48 all route through it; source-grep test pins all three surfaces.
2. **Hide condition** — ✅ `shouldHideInConversationEnum` (thread-timeline.ts:435-452): worker role → not searching → not active → `user_message_count ≤ 1` (missing ⇒ 0, equivalent to spec's `!(count > 1)`) → parent id non-empty and in `viewIds`. Matches spec predicate exactly; unit tests cover each clause including the boundary count=2.
3. **Search shows workers with `子任务 · 属于「父」`** — ✅ ThreadList.tsx:983-986 (query non-empty + worker → `workerBelongTitle`), AtThreadPopover via `enumTitle`, WorkspaceFrame rows show belong title whenever a worker surfaces (title + row span, :79-81). All three enumeration surfaces now carry 归属 on workers.
4. **Parent chip → select parent then SET_FLEET_LIST_OPEN; disabled in trash** — ✅ ThreadList.tsx:1040-1059: `stopPropagation` → `SET_ACTIVE_THREAD` + `thread.select` → `SET_FLEET_LIST_OPEN(true)` (action exists, agentStore.tsx:594/1811). Order matches spec; trash view disabled.
5. **StatusRail breadcrumb `← 主任务`** — ✅ StatusRail.tsx:83-92, 245-264: only when active thread is a worker AND parent resolves in `state.threads`; back button dispatches `SET_ACTIVE_THREAD` + `thread.select` for the parent; label `子任务 · {worker_role_label || displayThreadTitle}`.
6. **@ from parent does not flatten idle workers** — ✅ see B2; `excludeId={state.activeThreadId}` (App.tsx:865) flows through as a result filter only. Test-pinned.
7. **No new Tab / no spawn/L2 change** — ✅ diff touches only the six listed UI/test files; no `tabs.create`, spawn, L2/arm, overlay, or stdout_tail changes. `roleBadge` text change (worker→子任务, orch→编排) is display-only; ThreadList remains the sole consumer, tests updated accordingly.

## Attack results

- **Orphan** — ✅ parent absent from `viewIds` → row stays (thread-timeline.ts:451, tested); `workerBelongTitle` falls back to `子任务 · {own}` without a parent; StatusRail shows plain title when parent unresolvable.
- **Batch select on hidden workers** — ✅ `selectableIds` derives from `filtered` (post-hiding), and the prune effect removes hidden ids from `selected` — no invisible row can be batch-trashed. Hidden running workers are managed via the Fleet portal (product intent, recorded).
- **Count SoT vs Glance** — ✅ `childWorkerCount` (thread-timeline.ts:473-481) is the spec formula verbatim over raw `threads` (role + parent_thread_id), no Glance snapshot. It counts trashed workers too — literal spec; the chip count may therefore exceed the live Fleet portal list. Accepted per spec's explicit SoT choice.
- **Spawn brief = user_message_count 1** — ✅ verified end-to-end in R1 (expert-team.ts persists brief as first `role:"user"`; `listWithPreviews` recomputes `user_message_count` per thread.list): fresh worker = 1 → hidden; human follow-up = 2 → resurfaces. Boundary covered by test.
- **excludeId viewIds** — ✅ covered above; the counterfactual test guards regression.
- **Trash chip** — ✅ disabled + guarded (N1 closed).

## Nits (non-blocking)

- **N-a** StatusRail `← 主任务` resolves the parent without a `trashed_at` check (StatusRail.tsx:84-86): if the active worker's parent has been soft-deleted, the breadcrumb still selects it, bypassing the trash guards ThreadList applies. Narrow edge (parent trashed while worker open); suggest skipping the breadcrumb when `parentThread.trashed_at` is set.
- **N-b** `workerBelongTitle` drops the worker's own label when a parent is present, so N workers of one parent render identical `子任务 · 属于「X」` rows in @/search results (role label is now searchable for scoring, just not displayed). Spec-literal; product polish candidate `子任务 · {own} · 属于「X」`.
- **N-c** WorkspaceFrame recent-nav search matches only `displayThreadTitle` + id substring (:56-59), not the belong title or role label — searching a parent's name won't surface its workers there (popover does). Displayed title is the belong title, so filter text and visible text can diverge. Minor.
- **N-d** `filterConversationEnum` callers pass `activeThreadId: excludeId` in the popover; harmless today (the active thread is result-excluded anyway) but the dual meaning of the argument is worth a one-line comment if touched again.

## VERDICT: APPROVE_WITH_NITS

All four R1 blockers/nit-fixes (B1, B2, B3, N1) are closed and test-pinned; `npm test` is green (1450/1450). All seven claims verified. Remaining items are cosmetic/edge nits (N-a trash-parent breadcrumb is the only one with behavioral teeth, and it's a narrow edge case) — none block the spec's product sentence.
