# P1 transport spike checklist — `browser_download` lock

| Field | Value |
|-------|-------|
| **Date** | 2026-07-30 |
| **Plan** | [`docs/superpowers/plans/2026-07-29-windows-download-platform-tools.md`](../../superpowers/plans/2026-07-29-windows-download-platform-tools.md) §1.0 |
| **Decision note** | [`docs/decisions/2026-07-30-browser-download-transport-spike.md`](../../decisions/2026-07-30-browser-download-transport-spike.md) |
| **Method** | **code_read** of `browser-bridge` + related modules; Chrome MV3 docs knowledge. **No live Windows Chrome run** in this environment. |
| **Product status** | Checklist / transport lock only — **no new product work in this review**. |

Status vocabulary: `pass` | `fail` | `not_run` | `code_read`.

---

## Evidence base (code_read)

### `browser-bridge.ts` — debugger surface

| Fact | Location / observation |
|------|------------------------|
| Tab attach uses CDP protocol **1.3** | `ensureAttached` → `chrome.debugger.attach({ tabId }, "1.3")` |
| On attach, only **`Page.enable`** is sent | No `Browser.enable` / no domain-wide event subscription |
| Listeners registered | **`chrome.debugger.onDetach` only** — **no `chrome.debugger.onEvent`** |
| Private legacy `download()` | Solely `Browser.setDownloadBehavior({ behavior: "allow", downloadPath })` then `{ success: true }` — **no wait for completion**, no restore |
| `sendCdp` | Always goes through tab-scoped `chrome.debugger.sendCommand` |

### Related modules (already present for P1.0 design path)

| Module | Role vs spike |
|--------|----------------|
| `download-waiter.ts` | Primary completion via `chrome.downloads.onCreated` / `onChanged` |
| `browser-download-handler.ts` | Optional path-hint `setDownloadBehavior`; `try/finally` restore when `behaviorSet`; completion via waiter |
| `chrome-extension/package.json` | `"downloads"` already listed under `manifest.permissions` |

### Chrome MV3 / CDP knowledge (not live-verified)

- **`chrome.downloads`** is the stable extension API for download lifecycle (`onCreated`, `onChanged` with `state: complete|interrupted`, `DownloadItem.filename` absolute after complete).
- Tab-target debugger sessions often **do not** surface full **Browser-domain** events the same way a browser-level target would; even when `Browser.setDownloadBehavior` accepts the command, **`Browser.downloadWillBegin` / `Browser.downloadProgress` may never reach an extension that never registered `onEvent`**.
- Adding `"downloads"` is a **background/service-worker** capability; Side Panel UI does not need a second permission grant.

---

## S1–S6 checklist

| # | Check (plan §1.0) | Status | Detail |
|---|-------------------|--------|--------|
| **S1** | Tab session 上 `Browser.setDownloadBehavior` 是否成功 | **not_run** (optional **code_read** path exists) | Call path exists: legacy `download()` and optional path-hint in `browser-download-handler`. Live success on **Windows + Chrome MV3 + tab debugger** is **unproven**. Treat as **optional path hint only** — failure must not block the tool. |
| **S2** | 是否存在可达的 download **完成**信号（Browser-domain event / 其他） | **code_read → fail** (live: **not_run**) | **No** `chrome.debugger.onEvent` in `browser-bridge`. Without event registration, CDP `Browser.download*` cannot close the tool loop. Even if events existed at the protocol level, current bridge cannot observe them. **Hard evidence against CDP-as-primary.** |
| **S3** | 若无 event：仅靠 `chrome.downloads.onCreated/onChanged` 是否足够完成闭环 | **code_read → pass** (assumed API; live **not_run**) | Mature MV3 API; absolute `filename` after complete; `download-waiter.ts` models created→complete / cancel / timeout; unit tests mock the API. Sufficient as **sole** completion transport. |
| **S4** | `downloads` permission 对 MV3 side panel + background 的影响 | **code_read** | See [Permission impact](#permission-impact-s4). |
| **S5** | restore download behavior 后用户手动下载是否恢复默认 | **code_read** + **design lock** (live restore **not_run**) | See [Restore behavior plan](#restore-behavior-plan-s5). |
| **S6** | 建议的 Chrome 大版本（与 CI 扩展测试一致） | **code_read** | See [Chrome version / CI note](#chrome-version--ci-note-s6). |

---

## Permission impact (S4)

| Topic | Conclusion |
|-------|------------|
| Manifest | `"downloads"` under `manifest.permissions` (already in `chrome-extension/package.json`). |
| Where events fire | **Service worker / background** (`chrome.downloads.onCreated` / `onChanged`). Side Panel does **not** need a separate permission or listener. |
| User-visible impact | Extension install/update may show an additional **Downloads** permission. No host-permission change required for the downloads API itself. |
| Privacy / blast radius | Listener can observe **all** download lifecycle events for the profile while the SW is alive. Mitigation: **register listeners only for the duration of `browser_download`** (waiter `dispose()` removes listeners); do not leave a permanent global sniffer. |
| Interaction with `debugger` | Orthogonal. `downloads` does **not** replace or require tab debugger for completion; debugger remains for click/CDP path-hint only. |
| If permission missing | `chrome.downloads` APIs throw / are undefined → tool must fail closed with a clear error (not hang). |

**Spike lock:** Adding/keeping `"downloads"` is **required** for primary transport. No reason to avoid it for Side Panel UX.

---

## Restore behavior plan (S5)

Plan **D14**: tool end (success / timeout / failure) **must** restore download behavior so user browsing is not stuck on an agent path.

| Rule | Spec |
|------|------|
| When to set | Only if caller supplied a non-empty `downloadPath` **and** optional path-hint is desired. |
| How to set | Best-effort: `Browser.setDownloadBehavior({ behavior: "allow", downloadPath, eventsEnabled?: true })` on the **same tab** session. Catch failures → log + continue (primary is still `chrome.downloads`). |
| Track | Boolean `behaviorSet = true` **only** if the set command succeeded. |
| Restore | In **`finally`**: if `behaviorSet`, call `Browser.setDownloadBehavior({ behavior: "default" })` (or equivalent “clear agent path”). Best-effort; swallow restore errors so they do not mask the real tool result. |
| If set never succeeded | **Do not** call restore (no sticky state to undo). |
| Legacy private `download()` | Historical stub does **not** restore — any product path must **not** ship that stub as the completion API. |
| Live verification (deferred) | On Windows Chrome: set custom path → complete one agent download → confirm user-initiated download returns to default Downloads folder. Status today: **not_run**. |

Reference design already matches this in `browser-download-handler.ts` (`behaviorSet` + `finally` restore). This checklist **locks** that plan; it does not re-implement product.

---

## Chrome version / CI note (S6)

| Topic | Recommendation |
|-------|----------------|
| **Runtime target** | Chrome **stable MV3** (≥ last 2 major stables shipped by Chromium). No dependency on bleeding-edge Browser-domain download events. |
| **CI extension tests** | Keep **unit tests with mocked `chrome.downloads`** (`download-waiter` created→complete / cancel / timeout). **Do not** require a real Chrome instance or CDP download events for green CI. |
| **Protocol version** | Existing attach uses **`"1.3"`** — keep; path-hint is best-effort on that session. |
| **Live re-validation** | When Windows Chrome is available: record actual major version + PASS/FAIL for S1/S2 on that build; append to decision note. Until then, **S1/S2 unproven does not block** primary lock. |
| **Forbidden CI assumption** | Do not gate CI or product on `Browser.downloadProgress` / `downloadWillBegin` via tab debugger. |

---

## Transport decision (S6 outcome)

```
PRIMARY = chrome.downloads
  - onCreated / onChanged until state = complete (or interrupted → DOWNLOAD_CANCELED / fail)
  - optional filenameHint filter
  - absolute path from DownloadItem.filename after complete

SECONDARY / optional = CDP Browser.setDownloadBehavior
  - path hint only when downloadPath provided
  - must not block if command fails
  - must restore (behavior: default) if set succeeded

FORBIDDEN as sole path = blind click + sleep
FORBIDDEN as primary = CDP Browser.download* events
  (S2 code_read fail: no onEvent; tab-session Browser-domain completion unproven)
```

### Recommendation (mandatory)

| Field | Value |
|-------|-------|
| **Recommendation** | **`proceed_with_downloads_primary`** |
| **Confidence** | High for primary choice; live S1/S2 still open |
| **Hard evidence against CDP primary** | No `chrome.debugger.onEvent` in bridge; private `download()` never waits; plan default Alt F when S1+S2 not fully green |
| **Hard evidence against downloads primary** | **None** found in this review |
| **Product in this PR/review** | **None** — transport lock document only |

---

## Mapping to plan exit criteria

| Plan rule | Satisfied? |
|-----------|------------|
| Default assume `chrome.downloads` primary until spike proves otherwise | **Yes** — locked |
| If S1/S2 fail or unproven → only chrome.downloads primary | **Yes** (S2 code_read fail; S1 not_run) |
| CDP setDownloadBehavior optional path hint | **Yes** |
| Register onEvent only if CDP events used | N/A — not using CDP events as primary |
| Spike note with S1–S6 | **This file** + decisions note |

---

## Follow-ups (out of scope here)

1. Live Windows Chrome: re-run S1/S2; append PASS/FAIL + exact Chrome version.
2. Product implementation / merge of `browser_download` remains under plan PR-4 / apply script — **not** this checklist.
3. P1b multi-root / Content-Disposition navigate wait remain out of P1.0.

---

## Verdict line

```
SPIKE_LOCK: proceed_with_downloads_primary
PRIMARY=chrome.downloads (onCreated/onChanged complete)
CDP setDownloadBehavior=optional path hint only; restore if set
S1=not_run S2=code_read_fail S3=code_read_pass S4=code_read S5=design_lock S6=code_read
done=true
```
