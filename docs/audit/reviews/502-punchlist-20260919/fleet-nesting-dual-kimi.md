鈥?Review as **kimi** 鈥?design review only, no code edits.

  ## 3r2frm grounding check

  The incident is real in code, not just anecdote: `renderThreadRow` (ThreadList.tsx:965) treats every thread identically 鈥?`roleBadge` (thread-timeline.ts:420) only appends an English `worker`/`orch` chip, and `groupThreadsByCalendar` sorts purely by recency, so three workers spawned minutes apart land as three peer rows above/below the parent. The parent asked for a conclusion while the list visually asserted "four unrelated chats". The brief's diagnosis is accurate.

  Also confirmed: the codebase already half-believes the product sentence 鈥?cleanup scan runs `include_workers: false`, and digest selection defaults `excludeWorkers: true` (thread-timeline.ts:536, 577, 685). 鏂规 A is completing an existing product judgment, not inventing one.

  ## Attacks on the brief

  **A1. The `3 瀛愪换鍔 annotation has an unproven data dependency.** `TimelineThread` (thread-timeline.ts:11-34) declares no `parent_thread_id` / `orchestrator_run_id`; FleetWorkerList reads those fields off thread objects, but that data comes from the live fleet snapshot. For the annotation and the `3 瀛愪换鍔?路 宸插畬鎴恅 end-state to survive fleet teardown, the companion's **persisted thread list enrichment** must carry parent linkage. The brief asserts the UI but never names this requirement. If the list payload lacks it, 鏂规 A degrades to silently hiding workers with no parent badge 鈥?worse than today. This must be an explicit landing precondition, not discovered mid-implementation.

  **A2. Orphan workers are the real BLOCK-adjacent case.** "榛樿涓嶅垪鍑?worker" is only safe when the parent is resolvable in the current list. Parent archived, deleted by cleanup, or filtered out by search 鈫?the worker becomes unreachable except by knowing to search for it. Rule must be: **hide worker rows only when their parent row is present in the same view; otherwise render them flat** (with the `瀛愪换鍔?路 灞炰簬銆屸€︺€峘 treatment). The brief doesn't state this fallback.

  **A3. Batch operations bypass the hide.** `threadIdsInMonth` / `threadIdsInDay` (thread-timeline.ts:249-256) feed group-header select-all, and nothing there excludes workers. User selects a whole day for delete/export while workers are invisible 鈫?silent action on hidden threads. Extract already defaults `excludeWorkers`; delete / export / 鐭ヨ瘑 paths must get the same exclusion, or the hide creates a worse hazard than the clutter it fixes.

  **A4. Count semantics undefined.** "娲荤潃鍙敤鐐? vs `3 瀛愪换鍔?路 宸插畬鎴恅 鈥?what about 1 running / 2 failed? `FleetWorkerView.status` already distinguishes paused/holding/idle and abort exists per-row; the badge needs a defined worst-state rule (suggest: running count while any alive, else `N 瀛愪换鍔?路 宸插畬鎴?閮ㄥ垎/澶辫触` mirroring `acpOutcomeChip`), otherwise two reviewers will implement two different badges.

  **A5. Active-thread inconsistency.** After 杩涘叆瀛愪换鍔?the active thread is a worker that doesn't appear in its own history popover. The breadcrumb (`鈫?涓讳换鍔 + `瀛愪换鍔?路 鏍囬`) mostly covers this, but consider rendering the *active* worker row while it's active 鈥?one line, kills the "where did my conversation go" moment. Acceptable to defer; not a blocker.

  ## Answers to the four adjudication questions

  1. **鏂规 A 姝ｇ‘銆?* Hiding worker rows by default matches the mechanism (ADR-015 threads) without pretending they don't exist 鈥?the parent row badge + existing Fleet portal preserves reachability. Conditional on A1 (parent linkage in list payload) and A2 (orphan fallback) being written into the landing Issue.
  2. **杩涘叆瀛愪换鍔?淇濈暀銆?* Inspect is deliberately view-only (WorkerInspectPanel: no stdout_tail, no thread switch); pause/resume/stop/鍋滄璇ュ瓙浠诲姟 and the worker-scoped composer all live on the switched thread. Removing the switch strands those controls and blocks deep debugging. The breadcrumb downgrade framing is the right cost signal.
  3. **瀹屾垚鐨?worker 鍏佽浠庢悳绱㈣繘鍏ャ€?* Title: `瀛愪换鍔?路 灞炰簬銆寋parent title}銆峘, fallback `瀛愪换鍔?路 #id` when the parent is gone. Never bare alias 鈥?that's exactly how 3r2frm looked like peer chats. Note search runs over `filterThreadsByQuery`, which today has no parent context; this needs the same linkage data as A1.
  4. **BLOCKs:** 璇棌 orchestrator 鈥?no, orchestrator rows stay visible and the parent conversation is role `normal`. #497 瀹藉睆鍐茬獊 鈥?no, this is scoped to the 320px panel; wide surfaces may show the full tree. Real risks are A2 (orphan hide) and A3 (batch ops on hidden workers) 鈥?both must be acceptance criteria in the Issue.

  Nits: replace English `worker`/`orch` chips with Chinese while touching this surface; the badge dot for "alive" should reuse `statusColor` semantics from FleetWorkerList rather than inventing a third color vocabulary.

  VERDICT: APPROVE_WITH_NITS

