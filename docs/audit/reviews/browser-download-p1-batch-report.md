# browser_download P1.0 — batch report

| Field | Value |
|-------|-------|
| **Date** | 2026-07-30 |
| **Branch** | `feat/browser-download-p1` |
| **Status** | Round 4: timeoutMs deadline asserted; dual-review R4 Claude APPROVE_WITH_NITS / Pi ADR-020 declaration fix |
| **Transport** | PRIMARY=`chrome.downloads` (onCreated/onChanged complete); CDP `Browser.setDownloadBehavior` optional path hint only |
| **Spike** | `docs/decisions/2026-07-30-browser-download-transport-spike.md` + `docs/audit/reviews/win-dl-p1-spike-checklist.md` (S1 not_run / S2 code_read fail → downloads-primary locked) |

## Capability declaration (ADR-020) — formal block

```text
Surface:      L1 (browser_download — interactive tab download to user Downloads)
L2-classes:   (none)  — default Downloads path is not L2-gated
Compose:      none
Autonomy:     single
Trust:        Downloads-only path sandbox; TAB_LEASE_TOOLS; worker path deny/strip
Channel:      community
```

No new confirm family / dialect. `auto_approve_dangerous` does **not** relax path sandbox (`prepareBrowserDownloadParams` roots stay Downloads-only; gate runs before any L2).

## Round 3 blockers fixed

| ID | Fix |
|----|-----|
| **BD-D13-BUSY-ENTRY-UNTESTED** | Extracted production busy-before-TabQueue into `download-busy-entry.ts` (`runWithDownloadBusyBeforeQueue`). `BrowserBridge.execute` is a thin call into that helper. Unit tests prove concurrent same-tab → `DOWNLOAD_BUSY` (not TabQueue serialize); control test shows TabQueue alone would dual-succeed; download alias also acquires busy; different tabs parallel; `__downloadBusyPreAcquired` set for handler. |
| **BD-ALIAS-SANDBOX-UNTESTED** | `createToolExecutor` tests: tool name `download` + evil path → `PATH_ESCAPE` with **zero** `tool.execute`; alias renames to `browser_download` on successful dispatch with sandboxed Downloads path; direct `browser_download` still path-sandboxes. |

## Round 2 (still held)

| ID | Fix |
|----|-----|
| **BD-ALIAS-PATH-SANDBOX-BYPASS** | `createToolExecutor` normalizes `download` → `browser_download` at entry |
| **BD-WAITER-UNRELATED-COMPLETE** | Waiter only tracks ids from `onCreated` after registration |
| **BD-D13-BUSY-DEAD** | Busy acquired **before** TabQueue (now via extracted helper) |

## Acceptance matrix

| # | Criterion | Result |
|---|-----------|--------|
| 1 | default Downloads ok; `..` / UNC / junction realpath → PATH_ESCAPE; case-fold ok | **pass** (path-sandbox.test) |
| 2 | malicious downloadPath never in tool.execute params after prepare | **pass** + createToolExecutor alias PATH_ESCAPE |
| 3 | worker + non-default downloadPath → WORKER_PATH_DENIED | **pass** |
| 4 | multi-agent missing tabId → TAB_ID_REQUIRED via TAB_LEASE_TOOLS | **pass** (∈ set; schema requires tabId) |
| 5 | schema rejects empty selector and text | **pass** |
| 6 | mock chrome.downloads created→complete → path/bytes | **pass** |
| 7 | timeout → DOWNLOAD_TIMEOUT; concurrent same tab → DOWNLOAD_BUSY at **production entry** | **pass** (download-busy-entry + handler) |
| 8 | text multi-match → ELEMENT_AMBIGUOUS; zero → ELEMENT_NOT_FOUND | **pass** |
| 9 | no L2 for default Downloads; auto_approve does not relax path sandbox | **pass** [inspected] |
| 10 | G3 manual: visible 下载 → Downloads without osascript/shell curl | **manual / not_run** |

## Tests run (round 3)

```
companion: path-sandbox + browser-download-schema → 35 pass
  (includes 3 new createToolExecutor alias/sandbox cases)
chrome-extension targeted:
  download-busy-entry + browser-download-handler + download-waiter + find-element-by-text → 31 pass
  (6 new production-entry busy cases)
```

## Risks / follow-ups

- Apply script must run once after pull (also auto via npm test/prebuild); round 3 prefers `runWithDownloadBusyBeforeQueue` wire
- CDP path hint may fail — non-blocking by design
- Companion+extension version-coupled for tool name
- Residual agent-download-malware-to-Downloads accepted without auto-exec (NG7)
- Live Windows Chrome: re-run S1/S2; document G3 manual path
- Full `BrowserBridge` class still not in `tsconfig.test.json` (chrome API surface); production busy **logic** is extracted and unit-tested; execute is a thin passthrough

## Out of scope (unchanged)

Pure navigate Content-Disposition wait; shell download path; new L2 dialect; P1b multi-root; full Playwright `:has-text` engine.
