# P1 Deep Diagnosis Batch Closeout — 2026-08-11

**Branch:** `fix/p1-deep-diagnosis-batch`  
**Source:** `docs/audit/deep-diagnosis-fanout-report-2026-08-11.md` P1 action plan  
**Main base:** `a6eb5a3`

## Status of P1 items

| # | Item | Status | Implementation |
|---|------|--------|----------------|
| 1 | L2 originWs default bind | **Done** | `l2-admission.ts` always `{ originWs: ws }` except outbound MCP L8 |
| 2 | Confirm single-flight (Panel) | **Done** | MinimalConfirm no optimistic remove; responding set; wait companion resolved |
| 3 | thread.messages + tool.start gate | **Done** | useWebSocket: hist gate; tool.start fail-closed without thread_id |
| 3b | Disconnect sticky busy | **Done** | agentStore SET_CONNECTION disconnected clears busy |
| 3c | Force reconnect banner | **Done** | `ws.forceReconnect` + DisconnectedBanner |
| 4 | Shell argv template + cwd workspace | **Done** | `commandMatchesAllowlistEntry`; `assertShellCwdInWorkspace` in dispatch |
| 5 | eTLD wildcards + loadConfig filter | **Done** | Expanded PUBLIC_SUFFIXES; `sanitizeDomainPatternsOnLoad` |
| 6 | Pack whitelist constrains MCP | **Done** | isToolAllowed requires mcp__*/server*/exact |
| 7 | Daemon lock across init | **Partial** | No longer releaseLock before initDataDir; startServer still re-acquires |
| 7b | crash.log DATA_DIR | **Done** | crash-handlers uses CMSPARK_DATA_DIR |
| 8 | Whisper DATA_DIR search | **Done** | stt-session-service passes dataDir to allWhisperSearchRoots |
| 8b | Meeting recording reconcile | **Done** | reconcileStaleRecordings on initDataDir |
| 9 | fill_form Meta+A | **Done** | Dual Meta+A and Ctrl+A |
| 9b | download waiter tab scope | **Done** | tabId without hint → first post-register only |
| Graph | Stale snapshot / same-id wipe | **Done** | URL `?t=` bump; focus pin in cap; same-id no-op |

## Tests

- Extension: **622 pass**
- Companion: **2701 pass** (+4 new P1 unit tests); **14 fail** all in `computer-executor` / `computer-uia-watch` — **pre-existing on main** (fail without this branch's L2 change; platform/UIA mocks)
- New: `companion/tests/p1-deep-diagnosis-batch.test.ts`

## Residual / follow-up

- P0 items intentionally **not** in this batch (user asked P1 only)
- Cockpit ConfirmElevated optimistic path not fully unified (Panel fixed; companion still no-ops second respond)
- Daemon lock full single-ownership model still imperfect if startServer always re-acquires
- Packs that relied on D8 implicit MCP pass need `mcp__*` in tool_whitelist after this change

