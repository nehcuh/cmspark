# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-06-09 (18:00)
- Chrome extension fixes (4 issues):
  - Button hover tooltips added
  - `thread.fork` handler added to background (create branch now works)
  - Thread deletion field mismatch fixed (`thread_id` vs `threadId`) + optimistic UI removal
  - Auto-scroll to bottom + collapsible long content (>3000 chars) in ChatView
- Windows companion fixes (2 issues):
  - systray2 `internalIdMap` stale after `update-menu` → fixed by kill+recreate on rebuild
  - Tray menu fully localized to Chinese with section headers
  - Settings open: `explorer` command instead of unreliable `start`
- Next: Runtime test of thread fork + delete + Windows tray menu
### 2026-06-09 (session-end)
- Simplified quick actions: replaced direct tool execution with delegation to Chrome extension via broadcast
- server.ts: added `broadcast` fn to session context for cross-client messaging
- message-router.ts: executeQuickAction now creates thread + broadcasts `quickAction.start` to all WS clients
- menu-bar-agent.ts: handleQuickAction now just opens side panel + sends request (removed ~60 lines of result display)
- background/index.ts: forwards `quickAction.start` to side panel
- useWebSocket.ts: handles `quickAction.start` — creates thread, adds user message, auto-sends `chat.send`
- Both builds pass. `quick-action-result.ts` is now dead code (not referenced)
- Next: Runtime end-to-end test; verify each quick action from tray creates thread + executes in side panel
<!-- handoff:end -->
