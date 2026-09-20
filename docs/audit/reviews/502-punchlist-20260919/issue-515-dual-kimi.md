鈥?I've read the spec and the diff. Now verifying the attack surfaces against the surrounding code: whether `user_message_count` is actually populated, whether `SET_FLEET_LIST_OPEN` exists, how `AtThreadPopover` renders titles and what `excludeId` is, and how batch select interacts with the hidden rows.

鈥?Batch select derives from `filtered` (post-hiding) 鈥?noted. A few last checks: the companion payload path for `user_message_count`, whether spawn brief persists as a user message, other `roleBadge` consumers, and the test-runner cwd assumption in the new source-grep test.

鈥?# Independent Implementation Review 鈥?#515 worker subtask identity

  **Reviewer: kimi** 路 Scope: uncommitted diff + `docs/superpowers/specs/2026-09-20-worker-subtask-identity.md` 路 No source edits made.

  ## Claims verification

  1. **Shared `filterConversationEnum`** 鈥?鉁?`ThreadList.tsx:399`, `WorkspaceFrame.tsx:50`, `AtThreadPopover.tsx:38` all route through it; the source-grep test asserts the same.
  2. **Hide condition** 鈥?鉁?`shouldHideInConversationEnum` (`thread-timeline.ts:436`) implements the spec predicate exactly: worker role, not searching, not active, `user_message_count 鈮?1` (missing 鈫?0 鈫?hide, matching `!(count > 1)`), parent id non-empty and present in `viewIds`.
  3. **Search shows workers with 褰掑睘 title** 鈥?鈿?partial. `ThreadList.tsx:980` uses `workerBelongTitle` 鈫?`瀛愪换鍔?路 灞炰簬銆岀埗銆峘. But `AtThreadPopover.tsx:147` still renders plain `displayThreadTitle`, and WorkspaceFrame recent likewise. Spec line 29 says search-style @ hits **蹇呴』甯﹀綊灞?* 鈥?the popover violates this MUST.
  4. **Parent chip** 鈥?鉁?`ThreadList.tsx:1044-1053`: `SET_ACTIVE_THREAD` + `thread.select` message, then `SET_FLEET_LIST_OPEN` (action exists, `agentStore.tsx:594/1811`). Order matches spec.
  5. **StatusRail breadcrumb** 鈥?鉁?`StatusRail.tsx:83-92, 245-264`: `鈫?涓讳换鍔 button (selects parent) + `瀛愪换鍔?路 {worker_role_label || title}`, only when the parent resolves in `state.threads`.
  6. **No NEVER items** 鈥?鉁?diff touches only the six listed files; no new Tab, no spawn/L2/arm/observatory changes. `roleBadge` label change (`worker`鈫抈瀛愪换鍔, `orch`鈫抈缂栨帓`) is display text; sole consumer is ThreadList.

  ## Attack results

  - **Orphan** 鈥?Handled. Parent absent from `viewIds` 鈫?row stays (`thread-timeline.ts:450`), test covers it; StatusRail shows no breadcrumb when parent unresolvable. One soft spot: in `AtThreadPopover` the pool pre-excludes `excludeId` (= `activeThreadId`, `App.tsx:865`), so when you @ from the parent thread the parent is missing from `viewIds` 鈫?its workers appear flat in the default pool 鈥?exactly the "鎽婃垚骞崇骇" the spec targets, surfacing in the most common invocation context. Nit.
  - **Batch select** 鈥?`selectableIds` derives from `filtered` (`ThreadList.tsx:523-530`), so hidden workers are silently excluded from select-all / batch trash. Defensible (they're managed via the Fleet portal) but a silent behavior change 鈥?nit. Also `childWorkerCount` counts trashed workers (matches the spec SoT formula literally) and the chip renders in trash view 鈥?nit.
  - **Count SoT** 鈥?鉁?`childWorkerCount` counts live store threads by `parent_thread_id` + role (`thread-timeline.ts:466`), no Glance snapshot; identical to the spec formula.
  - **Spawn brief = count 1** 鈥?鉁?Verified end-to-end: `persistWorkerBrief` (`expert-team.ts:370`) writes the brief as the first `role:"user"` message; `listWithPreviews` (`thread-manager.ts:841`) populates `user_message_count` via `inspectThreadMessages` on the thread.list path. Fresh worker = 1 鈫?hidden; first human follow-up = 2 鈫?stays visible. Correct direction.

  ## Blocker: `npm test` is red

  The new source-grep test uses `require("node:fs")` / `require("node:path")` (`tests/thread-timeline.test.ts:665-666`), but `tsconfig.test.json` sets `"types": ["chrome", "react", "react-dom"]` with no `node`:

  ```
  tests/thread-timeline.test.ts(665,28): error TS2591: Cannot find name 'require'.
  tests/thread-timeline.test.ts(666,20): error TS2591: Cannot find name 'require'.
  ```

  `tsc -p tsconfig.test.json` exits 2, the `&&` chain stops, and `node --test` never runs 鈥?the entire extension suite is broken by this change (confirmed: `npm test` 鈫?`exit=2`; my first piped run masked this behind `tail`'s exit code). The full-project gate `tsc --noEmit` is clean, so the source itself typechecks; only the added test fails to compile. Fix is small (static `import` of `node:fs`/`node:path` with node types available, or add `"node"` to `types`), but the review rules forbid me from applying it.

  ## VERDICT: REJECT

  Sole blocker: the change breaks `npm test` (TS2591 脳2 in the new test). Implementation logic, spec fidelity of the hide predicate, count SoT, chip, and breadcrumb are all sound 鈥?once the test compiles and the suite is green, this is APPROVE_WITH_NITS territory, with the top nit being the AtThreadPopover missing the spec-mandated 褰掑睘 title (claim 3 partial) and its default-pool leak of the current thread's workers.

