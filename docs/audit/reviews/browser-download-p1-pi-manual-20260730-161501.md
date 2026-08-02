All criteria and the R4 fix are verified. Here is my review.

---

# Dual review — browser_download P1.0 (round 4)

## R4 fix — BD-TIMEOUT-DEADLINE-UNASSERTED  ✓

The deadline is now asserted at both layers:

**Waiter** (`chrome-extension/tests/download-waiter.test.ts`):
- 3× `assert.equal(scheduledMs, N, "setTimer must schedule with timeoutMs")` (10ms / 50ms×2)
- Wall-clock test: `timeoutMs: 40`, no injected `setTimer` → real `setTimeout`, asserts `elapsed ≥ 25ms && < 2000ms` and `message includes /40ms/`. Proves the default wiring honors the deadline, not just the injected hook.

**Handler** (`chrome-extension/tests/browser-download-handler.test.ts`):
- `scheduledMs === 60_000` and `=== 5_000` — proves the handler forwards `timeoutMs` verbatim to the waiter's `setTimer` rather than a derived value.

The handler's separate `setTimeout(r, 40)` settle delay is the unrelated wall-clock click settle (correctly skipped when `__downloadsApi` is injected); it is not the deadline. Confirmed not conflated.

## Verification matrix

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Path sandbox Downloads-only; UNC/escape | **pass** | `isUncOrDevicePath` (\\, //srv, \\?\, post-resolve) + `assertDownloadPathAllowed` (resolve→roots→realpath container; junction/TOCTOU) + `isWithinRoot` (exact OR root+sep, case-fold). Tests: `..`, UNC, junction-realpath, sibling-prefix, different-drive, case-fold all → PATH_ESCAPE. |
| 2 | Alias download→browser_download before sandbox | **pass** | `server.ts:484` renames at executor entry, **before** cookie gates and the sandbox block at `:686`. Tests: alias+evil path → PATH_ESCAPE with **zero** `tool.execute`; alias renames `tool_name` on success; direct `browser_download` also sandboxes (no alias-only hole). |
| 3 | DOWNLOAD_BUSY before TabQueue | **pass** | `download-busy-entry.ts` `runWithDownloadBusyBeforeQueue` acquires busy → `tabQueueRun` → releases in `finally`. `browser-bridge.execute` (`:56`) wires it with the shared `downloadBusyTabs` set; control test "TabQueue alone would serialize" proves the busy set is the rejector. `__downloadBusyPreAcquired` prevents double add/delete. |
| 4 | Waiter onCreated-only | **pass** | `tracked` set populated solely by `onCreated`; `onChanged` early-returns `if (!tracked.has(id))`; `startTime`-before-registration guard. Pre-existing/foreign completes ignored. |
| 5 | text\|selector; no new L2 dialect | **pass** | zod `.refine(selector||text)`; `browser_download` **not** in `L2_GATE_TOOLS` (only evaluate/osascript_eval/host_*/shell_exec/netsec_port_scan/spawn_worker/ask_user/board_complete). |
| 6 | tool catalog inject ok if all tools still load | **pass** | Catalog = 47 tools (none named `browser_download`); `ensureBrowserDownloadTool` idempotent (`some→return`); `buildAllToolDefinitions` validates every entry via `isValidToolDefinition` (throws on invalid). `getAllToolDefinitions` test loads cleanly. |
| 7 | ADR-020 declaration | **pass** | Plan declares: Surface L1 · L2-classes (none) · Compose none · Autonomy single · Trust path-allowlist(Downloads)+tab-lease(ADR-015) · Channel community. Matches ADR-020 §6 template. |

## Tests run (independently — NOT full suite)

```
companion: path-sandbox + browser-download-schema → 35 pass, 0 fail
extension: download-waiter + browser-download-handler + download-busy-entry + find-element-by-text → 32 pass, 0 fail
```
Both match the implementer's claims. Extension compiled via `tsconfig.test.json` cleanly.

## Transport

PRIMARY=`chrome.downloads` (onCreated/onChanged→complete) ✓; CDP `Browser.setDownloadBehavior` = optional path hint only with `try/finally` `behaviorSet` restore (D14) ✓; **no** CDP `downloadWillBegin`/`downloadProgress`/`onEvent` dependency ✓; `downloads` permission present in manifest ✓. Spike dual-approved; design matches locked transport string.

## Notable observations (non-blocking)

- **Defense-in-depth, not slop:** the handler keeps its own UNC check + its own busy check even though the production path pre-acquires busy and the companion already sandboxes. This is correct belt-and-suspenders for the direct-call/test path — not redundant cruft to clean.
- **BrowserBridge thin shell:** full class still outside `tsconfig.test.json` (chrome API surface); the production busy *logic* is extracted into `download-busy-entry.ts` and unit-tested, `execute` is a one-call passthrough. Acceptable given the chrome-API constraint.
- **Deferred (documented, non-blocking per spike):** S1/S2 live Windows Chrome = not_run; G3 manual Windows = not_run. These are explicit spike follow-ups, not P1.0 gates.

No blocking issues, no new L2 dialect, no sandbox bypass, deadline correctly asserted.

VERDICT: APPROVE
