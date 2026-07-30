I have enough evidence to render a verdict. Let me record findings.

## Findings

**Spike scope verified** — The spike claim ("1 file, ~159 lines, only `docs/audit/reviews/win-dl-p1-spike-checklist.md`, code_read only, product not implemented") matches what's on disk: the checklist file is 159 lines of transport-lock documentation. The companion `docs/decisions/2026-07-30-browser-download-transport-spike.md` is aligned.

**S2 `code_read → fail` is accurate** — `chrome-extension/src/background/browser-bridge.ts:32` registers only `chrome.debugger.onDetach.addListener(...)`; there is **no** `chrome.debugger.onEvent` listener anywhere in the bridge. Without it, CDP `Browser.downloadWillBegin` / `downloadProgress` cannot close the tool loop. The S2 "hard evidence against CDP-as-primary" claim is correct.

**Legacy private `download()` stub verified** — `browser-bridge.ts:105-106` (`case "download": return await this.download(params)`) and `:1129+` show the historical stub that only calls `Browser.setDownloadBehavior` with no wait and no restore. The checklist correctly flags this as "must not ship as the completion API".

**P1.0 scope is clear and present in the working tree** (the 5 reviewer criteria):
- **sandbox** — `companion/src/path-sandbox.ts` (228 lines): `assertDownloadPathAllowed`, UNC/device rejection, realpath container check, `prepareBrowserDownloadParams` with `WORKER_PATH_DENIED`.
- **text** — `chrome-extension/src/background/find-element-by-text.ts` (98 lines) + `ELEMENT_AMBIGUOUS` / `ELEMENT_NOT_FOUND` classification.
- **TAB_LEASE** — `companion/src/orchestrator/constants.ts:63` adds `"browser_download"` to `TAB_LEASE_TOOLS`.
- **busy** — `browser-download-handler.ts:54-60` rejects concurrent same-tab via `downloadBusyTabs` (`DOWNLOAD_BUSY`).
- **restore** — `browser-download-handler.ts:211-221` `finally` restores `Browser.setDownloadBehavior({behavior:"default"})` only if `behaviorSet`.

**ADR-020 capability check** — Declaration in prompt: *Surface L1; L2-classes none; Compose none; Autonomy single; Trust path-allowlist + tab-lease; Channel community*. Axes correctly hang on Surface (browser interaction tool), no Pack-first violation (extends existing tab-lease tool family, no new scenario needing Pack alternative), no new confirmation dialect (reuses Downloads allowlist + ADR-015 tab-lease), no `securityConfirmations.request` touched (originWs N/A). Trust monotonicity: design explicitly states `auto_approve_dangerous` must NOT relax the sandbox; default Downloads stays L1 with no L2 (verifiable at product-review time).

**Not over-claiming CDP** — The checklist explicitly locks `proceed_with_downloads_primary` and forbids CDP events as primary; this is the opposite of a "claims CDP complete without evidence" REJECT trigger.

## Non-blocking nits

1. **Status vocabulary drift** (checklist §S1–S6 vs line 11). The doc declares vocabulary `pass | fail | not_run | code_read`, but S4 and S6 use only `code_read` without a `pass`/`fail` qualifier, while S1/S2/S3 use composite forms like `code_read → fail`. Harmonizing to `code_read:pass` / `code_read:fail` would make the table machine-readable.
2. **Captured patch scope >> spike scope** — `win-dl-p1-spike-diff-20260730-143802.patch` snapshots the entire working tree (7 modified + ~17 untracked files, including the full P1.0 product code), even though the spike's contribution is just the 1 checklist file. This is standard practice for the dual-review snapshot but is worth noting that reviewers comparing "spike claim" to "patch file" will see an apparent mismatch (claim: 1 file; patch: 24 files). Not blocking; just call out in the verdict file.
3. **Code_read leans on untracked files** (checklist §"Related modules" and line 85) — the spike cites `download-waiter.ts` / `browser-download-handler.ts` as already-matching reference design, but those files are untracked in the working tree at spike time. The code_read observation itself is correct (I verified the `behaviorSet` + `finally` restore matches), but a future reader should be aware the spike's "Reference design already matches" claim is against in-flight, not-yet-merged code.

VERDICT: APPROVE_WITH_NITS
