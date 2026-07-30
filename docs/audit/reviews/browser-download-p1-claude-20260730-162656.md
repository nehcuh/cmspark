## Independent verification — browser_download P1.0 R5

**Patch freshness**: `HEAD = fd2d4a1` matches the diff header. `git status` shows the same 10 modified + new files. Catalog JSON has 47 entries; injected browser_download brings total to 48. Not stale.

### ADR-020 declaration gate (R5 fix for Pi blocker)

Verified at `docs/audit/reviews/browser-download-p1-batch-report.md:13-20` — all six required axes present:
- Surface=L1 (browser tool), L2-classes=(none), Compose=none, Autonomy=single, Trust=Downloads-only path sandbox + TAB_LEASE_TOOLS + worker path deny/strip, Channel=community
- Adjacent note "auto_approve_dangerous does **not** relax path sandbox (`prepareBrowserDownloadParams` roots stay Downloads-only; gate runs before any L2)" addresses checklist item 4 (trust monotonicity).
- No new confirm family/dialect (checklist item 3 ✓). No new runtime/composition axis (items 1, 6 ✓).

Pi's R4 REJECT blocker is satisfied.

### 7-point verification matrix

| # | Criterion | Result |
|---|---|---|
| 1 | Path sandbox Downloads-only; UNC/`..`/junction realpath escape | **pass** — `path-sandbox.ts:55-124` + 8+ cases in `path-sandbox.test.ts` |
| 2 | Alias `download`→`browser_download` before sandbox | **pass** — `server.ts:484` rewrites before sandbox gate (line 686) and `resolveToolDispatchTimeoutMs` (line 2221); createToolExecutor tests prove PATH_ESCAPE with zero `tool.execute` |
| 3 | DOWNLOAD_BUSY before TabQueue | **pass** — `download-busy-entry.ts:42-58` acquires before `tabQueueRun`, releases in finally; `__downloadBusyPreAcquired` flag prevents double-add; control test proves TabQueue alone would serialize |
| 4 | Waiter onCreated-only | **pass** — `download-waiter.ts:79,133` tracked-set + onChanged early-return; startTime check at line 108-114 |
| 5 | R4 timeoutMs deadline asserted | **pass** — `download-waiter.test.ts:103,158,240` assert `scheduledMs === timeoutMs`; wall-clock test (line 252-273) asserts `elapsed >= 25` for `timeoutMs=40` |
| 6 | Tool catalog inject | **pass** — `tool-definitions.ts:108` `ensureBrowserDownloadTool(buildAllToolDefinitions())`; idempotent; `isValidToolDefinition` still runs |
| 7 | Dispatch timeout does not undercut extension | **pass** — `resolveToolDispatchTimeoutMs` returns `min(125000, max(15000, t+5000))`; tests assert default 65s, 120s+5 cap |

No new blocking code issues introduced in R5.

### Nits (non-blocking, carried from R4)

1. `companion/src/server.ts:691` — `threadManager.get(actingThreadId) as any` bypasses type safety for `agent_role` access (try/catch guards runtime, but an optional `ThreadInfo.agent_role` field would be cleaner).
2. `chrome-extension/src/background/browser-bridge.ts:34` — public mutable `downloadBusyTabs: Set<number>`; consider private + read-only accessor to enforce invariant externally.
3. Duplicate UNC regex at `browser-download-handler.ts:51` and `path-sandbox.ts` (`isUncOrDevicePath`); defense-in-depth is fine but a comment noting intentional redundancy would help readers.
4. `download-waiter.ts:101,216` — `void promise.catch(() => {})` swallows unhandled rejections in `finishErr`/`dispose`; reasonable for race protection but masks real promise-chain bugs.
5. `apply-browser-download-p10.mjs` is wired into `npm test` + `prebuild` of both packages; idempotent but is process debt — delete + bare source commit once the spike lands.
6. `companion/src/server.ts:2303-2307` `dispatchToExtension` still hardcodes `TOOL_EXECUTION_TIMEOUT_MS` (only `analyze_image` uses it today; a one-line guard comment prevents a future browser_download footgun).

VERDICT: APPROVE_WITH_NITS
