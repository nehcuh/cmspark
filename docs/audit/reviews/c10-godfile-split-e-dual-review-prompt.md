# Dual external review — C10 Phase E (browser_download + MCP dispatch)

## Scope
Commits `53a38ac` + `69d43dc` on `fix/c10-godfile-split-a` (base after Phase D `17a5dd1`).

### E1
`browser_download` path sandbox → `tool/browser-download-admission.ts` (`runBrowserDownloadAdmission`)
- Uses prepareBrowserDownloadParams; auto_approve does NOT relax roots
- Worker path policy preserved

### E2  
MCP executeMcpTool / executeMcpMetaTool / enhanceMcpError / tryExpandAllowDir → `mcp/dispatch.ts`
- bindMcpDispatchRuntime for threadManager, securityConfirmations, broadcastToClients
- Cruise waive via isFullAutonomyCruise (no re-inline three-flag)
- DESTRUCTIVE_MCP_TOOL_PATTERN, critical caps, originWs on confirm preserved
- enhanceMcpError still re-exported from server.ts

### server.ts LOC
3334 → 2765 (−569)

## Verify
1. Zero intentional algebra change
2. MCP critical still forceConfirm unless full autonomy cruise
3. MCP confirm originWs bound
4. Meta tools force path separate from namespaced
5. Tests: security-gates 63, mcp-error-hints, browser-download-admission, mcp package tests

Final line:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS  
or VERDICT: REJECT
