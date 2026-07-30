# Spike: browser_download transport (Windows MV3)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-30 |
| **Chrome version** | n/a (no live Windows Chrome in this environment) |
| **Extension build** | design-time / code_read |
| **Decision** | **PRIMARY=`chrome.downloads`** (plan default when S1/S2 unproven) |

## Exit criteria (S1–S6)

| # | Check | Result | Evidence |
|---|--------|--------|----------|
| **S1** | Tab session `Browser.setDownloadBehavior` success | **not_run** | Code path exists historically as private `download()` stub (`browser-bridge.ts` only set behavior, no wait). Tab debugger attaches with `Page.enable` only; Browser-domain success on MV3 tab target is **unproven**. Treat as **optional path hint**. |
| **S2** | Reachable download **complete** signal via Browser-domain + `chrome.debugger.onEvent` | **not_run** / **code_read fail** | No `chrome.debugger.onEvent` listener in extension today. Without event registration, CDP download progress cannot complete the tool loop. |
| **S3** | `chrome.downloads.onCreated` / `onChanged` state=`complete` sufficient | **code_read pass (assumed API)** | Chrome Extensions API is mature; DownloadItem.filename is absolute after complete; used by many MV3 extensions. Implementation: `download-waiter.ts` + tests with mock API. |
| **S4** | `downloads` permission impact (MV3 side panel + background) | **code_read** | Add `"downloads"` to `chrome-extension/package.json` `manifest.permissions`. Background service worker receives events; side panel does not need separate permission. User sees Chrome permission grant on update. |
| **S5** | Restore download behavior after tool | **design lock** | D14: `try/finally` calls `Browser.setDownloadBehavior({behavior:"default"})` **only if** setDownloadBehavior was successfully applied; never leave agent path sticky. |
| **S6** | Chrome major for CI | **code_read** | Align with existing Plasmo/MV3 extension tests; no CDP event dependency in CI — unit tests mock `chrome.downloads`. |

## Locked transport string

```
PRIMARY=chrome.downloads (onCreated/onChanged complete); CDP Browser.setDownloadBehavior optional path hint only; do not require CDP download events
```

## Rationale

Plan D15 / Alt F: when S1+S2 are unproven, implement **only** `chrome.downloads` primary. CDP setDownloadBehavior may still be attempted for path hints; failure must not block. Forbidden as sole path: blind click + sleep.

## Follow-ups

- When a live Windows Chrome is available: re-run S1/S2 and append PASS/FAIL with Chrome version.
- P1b multi-root / Content-Disposition navigate wait remain out of P1.0 scope.
