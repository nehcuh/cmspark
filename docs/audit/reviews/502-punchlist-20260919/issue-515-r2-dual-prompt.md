Independent implementation re-review of #515 worker subtask identity after folding the previous REJECT.

Identify as kimi or claude. No source edits. Write the review to:
- kimi → docs/audit/reviews/502-punchlist-20260919/issue-515-r2-dual-kimi.md
- claude → docs/audit/reviews/502-punchlist-20260919/issue-515-r2-dual-claude.md

Read:
- docs/superpowers/specs/2026-09-20-worker-subtask-identity.md
- git diff HEAD -- chrome-extension/src/sidepanel/utils/thread-timeline.ts chrome-extension/src/sidepanel/components/ThreadList.tsx chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/components/AtThreadPopover.tsx chrome-extension/src/sidepanel/components/StatusRail.tsx chrome-extension/tests/thread-timeline.test.ts
- Previous REJECT: docs/audit/reviews/502-punchlist-20260919/issue-515-dual-kimi.md and issue-515-dual-claude-review.md

Scope is those six files plus spec. Ignore companion board/collect_handback and ChatView.tsx (separate patch).

Previous REJECT (must re-verify closed or still open):
- B1: require("node:fs") broke tsc -p tsconfig.test.json. Now static import { readFileSync } from "node:fs".
- B2: AtThreadPopover pre-filtered excludeId so viewIds lost the parent; @ from parent leaked idle workers as peers. Now filterConversationEnum takes excludeId as a result filter; viewIds built from the un-excluded live list.
- B3: @ search used bare displayThreadTitle. Now enumTitle uses workerBelongTitle.
- N1: trash-view "N 子任务" chip could activate a soft-deleted parent. Now disabled={trashView}.

Claims to verify:
1. Shared filterConversationEnum on ThreadList, WorkspaceFrame recent, AtThreadPopover
2. Hide worker only if parent in same view, not active, user_message_count<=1
3. Search shows workers with 子任务 · 属于「父」
4. Parent chip N 子任务 selects parent then SET_FLEET_LIST_OPEN; disabled in trash view
5. StatusRail breadcrumb ← 主任务
6. @ from parent (excludeId=parent) does NOT flatten that parent's idle workers
7. No new Tab / no spawn/L2 change

Attack: orphan, batch select on hidden workers, count SoT vs Glance, spawn brief = user_message_count 1, excludeId viewIds, trash chip.

VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
If REJECT, name the remaining blocker with file:line.
