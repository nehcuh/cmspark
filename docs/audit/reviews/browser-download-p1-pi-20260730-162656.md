I've completed the independent review. Here's my assessment.

---

## Re-check: browser_download P1.0 R5 — ADR-020 declaration fix

### 1. ADR-020 declaration gate (the prior Pi REJECT blocker)

Read from `docs/audit/reviews/browser-download-p1-batch-report.md`:

```
Surface:      L1 (browser_download — interactive tab download to user Downloads)
L2-classes:   (none)  — default Downloads path is not L2-gated
Compose:      none
Autonomy:     single
Trust:        Downloads-only path sandbox; TAB_LEASE_TOOLS; worker path deny/strip
Channel:      community
```

Checklist walkthrough:
| Check | Result |
|-------|--------|
| Axes fit: Surface L1 (not Compose/Autonomy) | ✅ |
| Pack-first: no new Side Panel chrome, no bare composition | ✅ |
| Confirm dialects: no new confirm family; explicitly "No new confirm family / dialect" | ✅ |
| Trust monotonicity: auto_approve_dangerous does NOT relax path sandbox | ✅ |
| originWs: no new `securityConfirmations.request` — browser_download has no L2 confirm | ✅ |
| No new runtime: uses existing tool framework + TabQueue | ✅ |
| Experimental layers: n/a | ✅ |

**Gate satisfied.** Declaration is present, complete, and matches the diff.

### 2. Code re-inspection — no new blocking issues

- **Alias path sandbox**: `server.ts:484-485` renames `download` → `browser_download` before the line-686 sandbox gate. Confirmed by `browser-download-schema.test.ts` cases. ✅
- **D13 busy-before-TabQueue**: `download-busy-entry.ts:42-58` acquires busy, enters TabQueue only on success. Unit test proves concurrent same-tab → DOWNLOAD_BUSY (not serialize). ✅
- **R4 timeoutMs deadline**: `resolveToolDispatchTimeoutMs` at `server.ts:83-91` returns dynamic timeout (`Math.max(15000, t+5000)`) and surfaces it in the error string. Waiter uses injectable `setTimer` with `opts.timeoutMs`. Tests assert `scheduledMs === timeoutMs`. ✅
- **Worker path deny**: `path-sandbox.ts` `prepareBrowserDownloadParams` returns WORKER_PATH_DENIED for non-default paths. ✅
- **Waiter onCreated-only**: only tracked ids pass `onChanged` gate. ✅
- **Catalog + inject**: 47 tools in JSON, `ensureBrowserDownloadTool` injects the 48th; `isValidToolDefinition` guards at load. ✅
- **TAB_LEASE_TOOLS**: `browser_download` added. ✅
- **Extension `downloads` permission**: added to manifest. ✅

### 3. Residual nits (from prior Claude + Pi reviews, all non-blocking)

| # | Source | Nit | File:Line |
|---|--------|-----|-----------|
| 1 | Claude | `apply-browser-download-p10.mjs` wired into npm test/prebuild — build-time coupling debt | `package.json` |
| 2 | Claude | `dispatchToExtension` at line 2307 hardcodes TOOL_EXECUTION_TIMEOUT_MS (15s). Only `analyze_image` uses this path currently, so no regression — a comment would prevent future footgun. | `server.ts:2307` |
| 3 | Pi | `as any` cast for thread role check bypasses type safety | `server.ts:691` |
| 4 | Pi | `downloadBusyTabs: Set<number>` is public mutable — external mutation could break busy invariants | `browser-bridge.ts:34` |
| 5 | Pi | Duplicate UNC check in handler + sandbox (defense-in-depth, but a comment noting intentional redundancy would help) | `browser-download-handler.ts:55` / `path-sandbox.ts` |
| 6 | Pi | `void promise.catch(() => {})` in download-waiter — suppresses genuine rejection bugs | `download-waiter.ts:109,122` |

---

**VERDICT: APPROVE_WITH_NITS**
