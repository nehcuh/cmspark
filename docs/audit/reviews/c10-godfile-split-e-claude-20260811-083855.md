## Independent Review — C10 Phase E (commits `53a38ac` + `69d43dc`)

I read the real files, diffed against base `17a5dd1`, ran the test suites, and applied the ADR-020 checklist.

### E1 — `tool/browser-download-admission.ts`
- Lines compared block-by-block against the original `if (toolName === "browser_download")` in `server.ts:createToolExecutor`. The worker-role lookup, `prepareBrowserDownloadParams` call, `PATH_ESCAPE` / `WORKER_PATH_DENIED` / `rejected` warn triage, `error_code` propagation, `logToolFinish` early-return, and `browser_download.start` info log are all preserved verbatim.
- `auto_approve_dangerous` is still NOT in the path — `prepareBrowserDownloadParams` is the same single source of truth. ✓
- Call site at `server.ts:934-943` substitutes `bdOutcome.finalParams` exactly as before.
- Test `tests/browser-download-admission.test.ts` covers pass-through / `PATH_ESCAPE` / `WORKER_PATH_DENIED` / default Downloads / `SELECTOR_OR_TEXT_REQUIRED` — 5/5 pass.

### E2 — `mcp/dispatch.ts`
Trust algebra preserved character-for-character:
- `DESTRUCTIVE_MCP_TOOL_PATTERN` regex identical.
- `mergeCapabilities(classifyMcpCall(...), declaredCaps)` + `forceMcpConfirm` union logic identical.
- `needsConfirm || forceMcpConfirm` waived only under `isFullAutonomyCruise(getConfig().security)` — the three-flag AND is **not** re-inlined (prompt invariant honored). I verified `isFullAutonomyCruise` at `tool/l2-admission.ts:65-75` does the exact AND.
- Critical calls never cached (`if (trustLevel === "first-use" && !forceMcpConfirm) cache.approve(...)`).
- `executeMcpMetaTool` — `CRITICAL_MCP_META_TOOLS` gate identical; `forceMetaConfirm` waive identical.
- `enhanceMcpError` re-exported from `server.ts` (test compat); body byte-for-byte same including Pi-nit-5 `writeLike` regex.
- `safeJsonStringify` / `extractMcpError` / `tryExpandFilesystemAllowDirOnDenial` all moved faithfully.
- Dynamic import path correctly adjusted: `"./mcp/allow-dir-expand"` → `"./allow-dir-expand"` (dispatch.ts is now inside `mcp/`).
- `originWs` preserved on **all three** confirm paths: `executeMcpTool` (dispatch.ts:198), `executeMcpMetaTool` (dispatch.ts:532), `tryExpandFilesystemAllowDirOnDenial` (dispatch.ts:360). P1-2 satisfied.

### Runtime binding
`bindMcpDispatchFromServerLocals()` at `server.ts:1683-1689` wires `() => threadManager` (deferred getter — safe even when module-level `threadManager` is uninitialized at eager-bind time, same pattern as Phase B companion dispatch), the singleton `securityConfirmations`, and `broadcastToClients`. Re-bound in `initServices` and `seedThreadManagerForTests`. ✓ Eager bind at `server.ts:1719` is placed after the `function broadcastToClients` declaration (also hoist-safe).

### Routing
`createToolExecutor` at `server.ts:1099-1125` still dispatches meta → `executeMcpMetaTool` and `isMcpNamespaced` → `executeMcpTool` with identical try/catch wrapping. ✓

### Tests (executed)
- `tests/integration/security-gates.test.js`: **63/63 pass** ✓ (matches prompt)
- `tests/mcp-error-hints.test.js`: **11/11 pass** ✓
- `tests/browser-download-admission.test.js`: **5/5 pass** ✓
- `tests/integration/mcp-capability-gate.test.js` + `mcp-meta-tool-gate.test.js` + `tests/mcp-manager.test.js`: **77/77 pass** ✓
- Full suite: 2662 pass / 14 fail. The 14 failures are entirely in `computer-uia-watch.test.js` and CU executor tests. `git diff 17a5dd1 HEAD --stat` shows **zero changes** to `companion/src/computer/` or those test files — these failures pre-exist on base and are unrelated to Phase E.

### ADR-020 capability checklist
- **Axes**: MCP stays on the Composition axis (mcp-server) — no "middle agent" claim. ✓
- **Pack-first / new confirm dialect / new runtime**: none introduced. ✓
- **Trust monotonicity**: critical MCP caps still force-confirm unless 3-flag cruise; `DESTRUCTIVE_MCP_TOOL_PATTERN` still forces manual; browser_download roots still unaffected by `auto_approve`. ✓
- **originWs**: see above — all three confirm paths. ✓
- **Capability declaration**: The prompt does not carry an explicit Surface/Compose/Autonomy/Trust/Channel block. Since this is a pure refactor (no new tools/gates/UI), the checklist downgrades this to a **nit**, not blocking.

### Non-blocking nits
1. **Capability declaration absent from the prompt** — pure refactor, so nit per checklist. Inline "zero intentional algebra change / originWs preserved / auto_approve does NOT relax roots" statements cover Trust intent, but a one-line Surface/Compose/Autonomy/Trust/Channel block would be cleaner for future phases that do touch gates.
2. **Minor graceful-shift in thread lookup** — `executeMcpTool` now uses `getThreadManager()?.get(actingTid)` instead of bare `threadManager.get(actingTid)`. The try/catch around the block made the original throw equivalent to the new `undefined` path (both fall through to `mode === "auto"`). Behaviorally identical; flagging only for completeness.
3. **14 pre-existing CU test failures** — flagged for awareness, not introduced here.

### Verdict

VERDICT: APPROVE_WITH_NITS
