Independent implementation review of #515 worker subtask identity (uncommitted + spec).

Read:
- docs/superpowers/specs/2026-09-20-worker-subtask-identity.md
- git diff HEAD -- chrome-extension/src/sidepanel/utils/thread-timeline.ts chrome-extension/src/sidepanel/components/ThreadList.tsx chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/components/AtThreadPopover.tsx chrome-extension/src/sidepanel/components/StatusRail.tsx chrome-extension/tests/thread-timeline.test.ts

Claims:
1. Shared filterConversationEnum on ThreadList, WorkspaceFrame recent, AtThreadPopover
2. Hide worker only if parent in same view, not active, user_message_count<=1
3. Search (non-empty query) shows workers with 子任务 · 属于「父」
4. Parent chip N 子任务 selects parent then SET_FLEET_LIST_OPEN
5. StatusRail breadcrumb ← 主任务
6. No new Tab / no spawn/L2 change

Attack: orphan, batch select, count SoT, spawn brief counting as user_message_count=1.

Identify as claude or kimi. No source edits.

VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
