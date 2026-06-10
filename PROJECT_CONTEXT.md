# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-06-10 (16:30)
- Windows tray stability — fixed 3 root causes:
  - systray2 icon: pass file path (not raw base64) because resolveIcon() checks fs.pathExists()
  - tray rebuild dedup: updateStatus/updateAutostart/setQuickActions/setRecentThreads now skip rebuild when value unchanged (was killing tray every 3s poll)
  - onExit recovery: tray process exit no longer kills Node — retries after 3s
- Global crash logger: uncaughtException/unhandledRejection write to ~/.cmspark-agent/logs/crash.log
- Cross-platform build: replaced `chmod` with Node.js one-liner in package.json
- NSIS installer: shortcuts now use cmspark.ico (generated from app icon)
- File attachment research: saved to project memory (officeparser/markitdown/Docling, phased plan)
- **Unpushed**: `e05bce5` — git push failed (SSL error), needs manual push
- Next: Push remaining commit → Windows rebuild → verify tray stays stable

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
