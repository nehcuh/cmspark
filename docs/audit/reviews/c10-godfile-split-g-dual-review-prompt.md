# Dual external review — C10 Phase G (extension tool-forward)

## Scope
Commit `39a83da` on `fix/c10-godfile-split-a`.

### Extract → `ws/tool-forward.ts`
- pendingToolCalls + rejectPending* / hasPendingForTab
- handleToolResult (SEC-E origin mismatch)
- dispatchToExtension (image-fetch inject)
- forwardToolToExtension (default createToolExecutor path + tab cache / lease side effects)
- TOOL_EXECUTION_TIMEOUT_MS / resolveToolDispatchTimeoutMs

### Bind
bindToolForwardRuntime({ getTabUrlCache, refreshTabUrlCache, getThreadManager })
tabUrlCache remains in server.ts for L2 getCachedTabUrl

### server.ts
2635 → 2434 (−201)
createToolExecutor terminal is thin forwardToolToExtension call

## Verify
1. Zero intentional algebra change
2. SEC-E: wrong peer cannot resolve tool.result
3. timeout still per-tool via resolveToolDispatchTimeoutMs
4. list_tabs / navigate / create_tab / close_tab post-effects preserved
5. image-fetch still uses dispatchToExtension
6. Tests: ws-tool-forward, security-gates 63, image-fetch, pregate

Final line:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
