## Verdict: APPROVE_WITH_NITS

Independent gate review of #477 (UI-only slice of #476).

### Scope verification
- No ACL expansion: `SUMMONER_WEB_DISPATCH_ALLOW` unchanged for MCP/management; MCP remains read-only (`/api/mcp/toggle` returns 404; `pack.list`, `skill.list`, `knowledge.list` only). Confirmed.
- New `/api/browser-status` goes through the same `tokenOk` + `hostOk` gate above the route table. Confirmed.
- Visible Stop (`#stopGo`) calls the same `$("stop").click()` → `/api/abort` → `chat.abort` in the allowlist. Confirmed.
- No full management/terminal/native hosting. Confirmed.

### Defects

**P1 — `api/browser-status` response leaks Host-bypass information via timing/status? — none found.** `tokenOk` uses `timingSafeEqual` with a length check first. `hostOk` checked before dispatch. Good.

**P2 — `overlayCookieToken` regex doesn't anchor end** (`src/summoner-web.ts:167`). Token extraction `/cmspark_overlay=([0-9a-fA-F]{64})/` will match a 64-hex prefix of a longer cookie value. But `tokenOk` then rejects `provided.length !== expected.length`. No bypass. Info only.

**P2 — `/api/browser-status` under SSE path: `activeHasExtensionPeer?.() === true`** — fine.

**P3 — `statusFromEvent` in HTML and `summonerWebEventStatus` in TS duplicate label mapping but differ**. HTML version lacks a `BROWSER_UNAVAILABLE` code check first — it checks `labels[code]` directly, and when raw contains `BROWSER_UNAVAILABLE` substring the `labels[code]` lookup works only if raw === exact "BROWSER_UNAVAILABLE"; it has a secondary `String(raw).indexOf` branch, so OK. Drift is a maintainability nit.

**P3 — SSE `run_status` handler: `syncBusyUi()` called before `busy` is assigned?** Lines: `busy=d.status==="llm"; syncBusyUi();`. Assignment occurs first. OK.

**P3 — `#stopGo` hidden-toggle:** visible stop uses `syncBusyUi()`, which sets `$("stopGo").hidden=!busy`. But `syncBusyUi()` only runs on `chat.user`/`chat.steered`/`chat.enqueued`, `run_status`, `chat.done`, `chat.aborted`, and `selectThread`. The SSE `chat.create` response path (`send()` → `/api/chat`) does not set `busy` locally; it sets `busy` only inside SSE handlers. The send() `.then()` callback just checks `d.error`. If `chat.user` SSE arrives, busy set. Covered. If SSE fails but poll succeeds, covered. OK.

**P3 — `windowMode` compact toggle:** `placeWindow(compact)` sets 360×420; `send`/`stopGo` widths tested at 320/360 narrow. OK.

**P3 — `@media(max-width:759px)` hides `.list` via `display:none`, but `.hud.history .list` re-shows at width 320 with `max-height:28vh`. Escape closes. OK.

**P3 — Focus management:** `Escape` calls `$("historyOpen").focus()`. `historyClose` closes but doesn't return focus. Minor a11y nit — focus stays on a hidden button.

**P3 — `showSec("threads")` calls `refresh()` every nav return; this could race with in-flight renderThreads. Self-correcting, no crash.

**P3 — `renderThreads` uses `style.display` on `#threads`/`#composeList` rather than `hidden`; harmless.

**P4 — Hardcoded label in `loadCompose("browser")`: "桌面配置编辑将在工作台管理功能中提供"** — references unshipped full #476 management. UI-slice-only copy nit.

**P4 — `loadCompose("mcp")` appends note text with double quotes inside no interpolation problem. OK.**

### Security summary
- Cookie/header tokens: secure comparison, length check, HttpOnly SameSite=Strict.
- Host/Origin gates correct for loopback; no DNS rebinding allowance beyond expected ports.
- SSE allowlist excludes Confirm/Trust/Config frames; `mcp.confirm.pending` allowed (copies-only).
- `overlay.cruise` derived string only.
- No ACL expansion; MCP read-only maintained.

### Final
Passes concrete security/correctness/async/focus/layout tests. Approved for the UI slice; not approving full #476.