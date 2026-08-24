# Independent adversary — PR #219 C-thin P2 thin SSE (honest send)

> **Lane**: Outcome / Trajectory / Component (Trust + SSE + overlay DoD)
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub`
> **Commit**: `d81444c` (`feat(summoner): SSE so HTML shell does not lie about send`)
> **Parent**: `947db02` (`fix(summoner): release overlay lease when HTML shell closes`)
> **PR**: #219 (OPEN) — T2, no auto-merge
> **Spec**: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md` P2

HEAD matches claimed commit: `.git/refs/heads/feat/steer-nextrun-overlay-hub` → `d81444cebe5b96506b5e4343d8a744966a3f01f7`. `[inspected]`

This subagent had no bash tool. `git show` / `git diff 947db02..d81444c` / `companion npm test` were **not** re-executed. Evidence: HEAD ref, `.git/COMMIT_EDITMSG`, reflog, production files + tests at HEAD. Implementer-claimed `3426 + 20 pass, 0 fail` is `[assumed]`.

Parent (reflog): overlay `pagehide` lease release. This commit is the SSE fan-out + honest send paint.

---

## Capability declaration (ADR-020) — copied, then checked against production

```text
Surface:      L0 overlay HTML
L2-classes:   none — overlay never Allow/Deny; SSE must not forward confirm chrome
Compose:      unchanged
Autonomy:     same tool-loop
Trust:        monotonic
Channel:      HTML loopback+token; SSE /api/events; page never companion WS
```

Axes fit `[inspected]`: new **Channel** on the existing L0 HTML Surface (loopback EventSource). Not a new runtime, not a new L2 confirm dialect, not Pack-first Side Panel chrome. `pack.apply` still composition-only. Tool-loop unchanged (`chat.create` fire-and-forget → companion `handleMessage` → origin-socket push → tray `onAppMessage` → `pushSummonerWebEvent`).

Trust monotonicity: overlay still cannot Allow/Deny. SSE type-allowlist + `/confirm/i` drop `security.confirmation.request` **before** `JSON.stringify`. WS Origin allowlist is **not** widened. Page still `fetch` + `EventSource` only; CSP `connect-src 'self'` additionally blocks `ws://127.0.0.1:23401`.

---

## MACHINE

| Check | Result | Evidence |
|-------|--------|----------|
| HEAD is `d81444c` | yes | `.git/HEAD` / refs `[inspected]` |
| Parent is `947db02` | yes | reflog `[inspected]` |
| companion `npm test` 3426+20 / 0 fail | **not re-run** | implementer claim `[assumed]` |
| `summoner-web.test.ts` encodes token/Host/SSE CT + confirm drop | yes | file read `[inspected]` |
| `isAllowedWsOrigin("http://127.0.0.1:23403") === false` | yes in test source | `summoner-web.test.ts:408-411` `[inspected]` |
| DoD 4 Chinese copy driven through failing claim / `chat.error` | **no** | source-grep only (`:124`) `[inspected]` |

Do not treat the HTTP/SSE suite as a security proof: dispatch is mocked; lease steal / `OVERLAY_STANDBY` / `run_active` are **not** exercised HTML → summoner WS → router → `onAppMessage` → EventSource. Confirm-drop is unit-tested on `pushSummonerWebEvent` with a live SSE socket.

---

## DoD vs production

| # | Observable | Verdict |
|---|------------|---------|
| 1 | GET `/api/events` requires token+Host; `Content-Type` `text/event-stream` | **pass** `[inspected]` `summoner-web.ts:268-284,320-337`; test `:345-363` |
| 2 | `pushSummonerWebEvent` allowlist: `run_active`/`error`/`chat.*` forward; `security.confirmation.request` does **not** | **pass** `[inspected]` allowlist `:32-48` + `/confirm/i` `:170`; test `:350-400` |
| 3 | HTML EventSource; send paints **已提交** not **已发送** on `accepted`; **已发送** only after `chat.user` (or equivalent stream) | **pass** `[inspected]` `:685-688,754-757`; test greps `已提交` and forbids the old HTTP `mode==="enqueue"?"已排队"` lie |
| 4 | Lease claim failure surfaces **侧栏占用了输入** | **FAIL** `[inspected]` — see B1. String exists in source; lookup never keys it. Tests only grep the HTML. |
| 5 | Malformed `?token=%` → 403 not hang | **pass** `[inspected]` parseQuery inside try `:268-279`; test `:131-134` |
| 6 | `isAllowedWsOrigin` still rejects `http://127.0.0.1` | **pass** `[inspected]` `lifecycle.ts:196-208`; test `:408-411` |
| 7 | No Allow/Deny/确认 chrome in HTML | **pass** `[inspected]` test `:126`; composer is 发送/纠偏/排队/停止; badge is 「本页不代替侧栏批准」 (disclaimer, not chrome) |
| 8 | `menu-bar` `onAppMessage` calls `pushSummonerWebEvent` | **pass** `[inspected]` `menu-bar-agent.ts:1418-1421`; test `:440` |

No Trust / WS-Origin / confirm-chrome DoD miss. **DoD 4 is an honesty-slice miss**, not a confirm leak.

---

## Hunt results (threats listed in the prompt)

### 1. SSE leak of confirm / Trust chrome?

**Not with this allowlist.** `[inspected]`

`pushSummonerWebEvent` (`summoner-web.ts:166-179`):

1. Rejects non-objects / arrays.
2. Exact `SUMMONER_WEB_EVENT_ALLOW.has(type)` — `security.confirmation.request` is **not** a member (test `:352`).
3. Extra `/confirm/i` drop unless `type === "mcp.confirm.pending"`.
4. **Then** `JSON.stringify`. Confirm frames are not serialized onto the SSE wire.

Outbound MCP L8 fans `security.confirmation.request` (with `code_preview` / `full_preview` / `preview_image`) to **every** authenticated WS, including summoner (`l2-admission.ts:1241-1252`). Tray `onAppMessage` will see it. SSE still drops it. CU `computer.task.event` JPEGs ride `broadcastToClients` onto the same summoner WS (`lifecycle.ts:353-364`) — also **not** in the allowlist, so HTML does not get desktop previews.

`mcp.confirm.pending` **is** forwarded. Payload from `mcp/dispatch.ts:72-75` is `{ type, message: overlayNotice }`. Notice text is `MCP_OVERLAY_CONFIRM_NOTICE` (“需在 Chrome 侧栏批准…召唤器不能代替侧栏点批准”). HTML paints `setStatus` only (`:763-765`). No Allow/Deny buttons, no `confirmation_id`, no preview. This is the S21 overlay notice, not confirm chrome. Spec parenthetical for P2 is `security.confirmation.request never forwarded`.

`tool.start` is extra vs DoD 2’s “`run_active`/`error`/`chat.*`”. Payload is `summarizeToolParams` (keys, `tabId`/`url`, `code_length` — **not** evaluate source) (`server.ts:290-300,553-558`). Not Allow/Deny. Residual: type-only allowlist, no field strip (N3).

### 2. Token in EventSource URL?

**Yes, inherent.** `[inspected]` `new EventSource(url("/api/events"))` (`:745`) appends `?token=`. EventSource cannot set headers.

Not a new secret: the page URL already has `/?token=` (`:163-164,547-548`). Mitigations vs P1 N1: HTML + SSE both send `Referrer-Policy: no-referrer`; HTML CSP `connect-src 'self'` (`:303-310,325-330`). A later third-party `<img>` would no longer Referer-leak the 256-bit token. Process list still sees `open <url-with-token>` (settings-web shaped).

### 3. Unbounded SSE clients?

**Capped.** `[inspected]` `MAX_SSE_CLIENTS = 4` (`:50`). Fifth GET → 429 (`:321-323`). `req.on("close")` deletes (`:334-336`). `stopSummonerWebServer` `closeSseClients` (`:182-191,251`). **Untested** (no 5th-client assertion). Token is still required before the slot is taken — unauthenticated flood gets 403, not a seat.

### 4. Origin not checked on GET `/api/events`?

**True, and not a browser-JS leak.** `[inspected]`

Origin is enforced only for POST (`:296-298`). EventSource is GET. DoD 1 does not require Origin on GET.

Cross-origin browser EventSource:

- OPTIONS (if any) is **after** token+Host, and ACAO is fixed `http://127.0.0.1:${port}` — does **not** reflect attacker Origin (`:286-292`).
- SSE response itself has **no** `Access-Control-Allow-Origin` (`:325-330`).

Foreign-origin JS cannot read the stream even with a stolen token. Non-browser (`curl`) with the token can; the token is the secret. Empty-Origin still allowed on POST (`originOk` `:110-117`) — settings-web CSRF model, not a web CSRF.

Defense-in-depth nit: checking Origin on GET (reject non-loopback, allow empty) would still fail `evil.com` EventSource at the app layer.

### 5. WS Origin widened?

**No.** `[inspected]` `isAllowedWsOrigin` still: `chrome-extension://[A-Za-z0-9_-]+` or exact `cmspark-tray://local`; everything else false (`lifecycle.ts:196-208`). Test still rejects `http://127.0.0.1:23403` / `http://localhost:23403`. HTML has no `WebSocket` / `ws://` (test `:127`). CSP `connect-src 'self'` would block companion `:23401` even if a later script added one.

---

## Blockers

### B1 — DoD 4 copy is dead code; tests grep the string, never the mapping `[inspected]`

Commit message: *“run_active and OVERLAY_STANDBY wait for the stream.”* Spec P2: *Lease claim failure surfaces 「侧栏占用了输入」.*

Production:

1. Overlay **claim does not fail because the panel holds**. `ComposerLeaseRegistry.claim` is CAS on `rev` only; matching rev **steals** holder (`composer-lease.ts:44-57`). Comment: “Overlay-visible ⇒ overlay holds”. `OVERLAY_STANDBY` is a **chat.create** gate (`gateChatCreateOnLease` → `type: "chat.error"`, `error: "OVERLAY_STANDBY: composer is on the other surface"`, `data.error_code: "OVERLAY_STANDBY"` — **not** top-level `error_code`, and **not** `error: "OVERLAY_STANDBY"`). Grep finds **zero** `error: "OVERLAY_STANDBY"` exact.

2. Fire-and-forget `chat.create` returns HTTP `{ type: "accepted" }` (`menu-bar-agent.ts:1200-1207`). HTML paints **已提交** (DoD 3 — good). The lease miss arrives on SSE as `chat.error`.

3. SSE handler (`summoner-web.ts:737-752`):

```js
var labels={ ..., OVERLAY_STANDBY:"侧栏占用了输入" };
var code=d&&(d.error||d.error_code);
if(t==="error"||t==="chat.error"){
  setStatus(labels[code]||d.error||d.message||"出错了");
```

`code` is `"OVERLAY_STANDBY: composer is on the other surface"`. `labels[code]` is undefined. User sees the English gate string, **not** 「侧栏占用了输入」. `labels.OVERLAY_STANDBY` is unreachable. `run_active` works because that error **is** the exact key (`{ type: "error", error: "run_active" }`).

4. `selectThread` claim path (`:625-629`): `setStatus(d.error || "侧栏占用了输入")`. Claim failure is `{ type: "composer.lease.error", error: "LEASE_REV_MISMATCH" }`. `d.error` is truthy → status **LEASE_REV_MISMATCH**. The Chinese fallback is dead. Claim does not return `OVERLAY_STANDBY` anyway.

5. Test theater: `assert.match(r.body, /侧栏占用了输入/)` (`summoner-web.test.ts:124`). No HTTP failing claim, no SSE `chat.error` with `data.error_code`, no assertion that the EventSource client would paint the Chinese string.

This is the honesty slice. `run_active` is mapped; `OVERLAY_STANDBY` is not. Source-grep green is not the observable.

Fix (sketch, not implemented here): key `labels` with `d.error_code || (d.data && d.data.error_code) || d.error`, and on claim failure prefer `labels[d.error_code] || "侧栏占用了输入"`. Add a test that `pushSummonerWebEvent({ type: "chat.error", error: "OVERLAY_STANDBY: …", data: { error_code: "OVERLAY_STANDBY" } })` is not enough — assert the **HTML mapping**, or extract the label function.

Until that observable is true, DoD 4 is not met.

---

## Findings (non-blocking if B1 is fixed)

### MAJOR

**M1 — `SUMMONER_WEB_EVENT_ALLOW` is not frozen; tests only probe two memberships.** `[inspected]` `summoner-web.test.ts:351-352`. Production set also includes `tool.start`, `mcp.confirm.pending`, `composer.lease`, `file.*`, `run_status` (no producer of `type: "run_status"` exists — dead). A later one-line add of `computer.task.event` or `config.updated` would dump CU JPEGs / config onto loopback HTML. Snapshot the exact set; assert `computer.task.event` / `config.updated` / `security.confirmation.*` / `hud.spike.show_confirm` are absent.

**M2 — Type-only forward, full payload.** `[inspected]` `data: ${JSON.stringify(msg)}`. Safe today because confirm types never reach stringify. `error` / `tool.start` / `composer.lease` / `chat.token` go through whole. Not Trust elevation on loopback+token; do not grow payloads.

### Nits

**N1 — GET `/api/events` does not check Origin.** Hunt item. CORS already blocks foreign JS. Still cheaper to reject non-loopback Origin on GET (allow empty).

**N2 — EventSource token in query.** Inherent. Headers already `no-referrer`. Do not add third-party subresources.

**N3 — `MAX_SSE_CLIENTS = 4` untested.** Stolen-token availability: occupy 4 seats, real overlay EventSource 429, send stuck on 已提交 (better than 已发送, still dishonest-idle).

**N4 — `/confirm/i` exception for `mcp.confirm.pending` is a footgun.** Today payload is a notice string. Do not later attach `confirmation_id` / preview / actions to that type.

**N5 — SSE client does not filter `thread_id` on `chat.user`.** Overlay `sendToExtension` is origin-socket scoped (`lifecycle.ts:1277-1280`), so panel-originated `chat.user` should not land here. If anything later broadcasts `chat.user`, overlay would clear the composer and paint 已发送. Cheap: `if (d.thread_id && d.thread_id !== threadId) return`.

**N6 — 30 min idle timer ignores a live SSE.** `lastAccessTime` updates on new HTTP, not on SSE writes (`:222-224`). Idle overlay: server stops, EventSource dies, UI frozen on 已提交. Tick lastAccess on `pushSummonerWebEvent` or SSE ping.

**N7 — `run_status` allowlist entry has no producer.** HTML handles `t==="run_status"` (`:767-770`). Busy SoT is still 1.2s `/api/thread` poll (`:639-649`) plus `chat.done`/`chat.aborted`. Dead path.

**N8 — Dispatch `{ ...payload, type }` (type last) fixes P1 N4 clobber.** `[inspected]` `:159`. Good. Keep reconstructing HTTP bodies; do not `dispatchAllowed(type, body)`.

**N9 — Tests are still partly source-grep.** Tray `pushSummonerWebEvent` lock is regex over `menu-bar-agent.ts` (`:435-440`). Cannot see ACL, lease steal, or confirm fan-out.

---

## Trajectory

Slice matches the spec’s P2 sentence: loopback SSE, confirm request dropped, `accepted` ≠ 已发送.

Fixes P1 nits this adversary called:

| P1 | This commit |
|----|-------------|
| N3 fire-and-forget paints 已发送 | **fixed** — 已提交 until `chat.user` / `chat.steered` / `chat.enqueued` |
| N5 `decodeURIComponent('%')` hang | **fixed** — try/catch → 403 |
| N1 no Referrer-Policy/CSP | **fixed** on HTML (+ SSE `no-referrer`) |
| M1 no lease release | **parent `947db02`** — `pagehide` + `/api/lease/release` still present |
| N4 `{ type, ...payload }` clobber | **fixed** — type last |
| N8 claim failure ignored | **attempted** — branch exists; mapping is B1 |

Not drive-by: `isAllowedWsOrigin` / occupied `file.upload` / overlay `allowTrust` force-false look untouched. Extra allowlist types (`tool.start`, `mcp.confirm.pending`) are UX on the same channel, not a new L2 dialect.

TDD: token `%`, SSE `Content-Type`, confirm-drop + `run_active` forward are real sockets. DoD 4 and 5th SSE client are **not**. HTML paint of 已提交/已发送 is source-lock, not a DOM test.

Dead path: `labels.OVERLAY_STANDBY` and `run_status` event type.

---

## Component (file:line)

| Gate | Location |
|------|----------|
| Token (all routes, incl. SSE) | `companion/src/summoner-web.ts:94-103,268-279` |
| Host | `companion/src/summoner-web.ts:105-108,281-284` |
| POST Origin only | `companion/src/summoner-web.ts:110-117,296-298` |
| SSE CT + cap | `companion/src/summoner-web.ts:50-51,320-337` |
| Event allowlist | `companion/src/summoner-web.ts:32-48,166-170` |
| Confirm regex backup | `companion/src/summoner-web.ts:170` |
| `JSON.stringify` after drop | `companion/src/summoner-web.ts:171` |
| HTML EventSource + 已提交/已发送 | `companion/src/summoner-web.ts:685-688,744-757` |
| Dead OVERLAY_STANDBY label | `companion/src/summoner-web.ts:737-752,625-629` |
| CSP `connect-src 'self'` | `companion/src/summoner-web.ts:308-309` |
| `onAppMessage` fan-in | `companion/src/menu-bar-agent.ts:1418-1421` |
| Fire-and-forget `accepted` | `companion/src/menu-bar-agent.ts:1200-1207` |
| WS Origin | `companion/src/ws/lifecycle.ts:196-208` |
| Origin-socket `sendToExtension` | `companion/src/ws/lifecycle.ts:1277-1280` |
| Broadcast (CU JPEG / config) | `companion/src/ws/lifecycle.ts:353-364` |
| Claim steals on matching rev | `companion/src/ws/composer-lease.ts:44-57` |
| OVERLAY_STANDBY gate shape | `companion/src/ws/composer-lease.ts:100-145` |
| Outbound MCP confirm fan-out | `companion/src/tool/l2-admission.ts:1241-1263` |
| MCP overlay notice (not chrome) | `companion/src/mcp/confirm-target.ts:6-27` |

---

## ADR-020 / P1 watchlist

| ID | This commit |
|----|-------------|
| P1-1 god-mode / `config.set` | **not reachable** from HTML (404 + ACL deny); `config.updated` not in SSE allowlist |
| P1-2 `originWs` | **not touched** — no new `securityConfirmations.request`. Overlay-originated non-MCP L2 still binds summoner `ws`; SSE drop means HTML does not show it (spec: overlay never Allow/Deny). MCP inbound still retargets panel + notice. |
| P1-3 evaluate | **not touched** |
| P1-4 shell | **not touched** |
| Confirm dialects | none in HTML. `mcp.confirm.pending` is a status notice. |
| Trust monotonicity | overlay cannot respond to L2; SSE does not forward request chrome |

---

## Capability vs production (short)

| Axis | Declared | Production |
|------|----------|------------|
| Surface | L0 overlay HTML | same composer + SSE status `[inspected]` |
| L2-classes | none; SSE must not forward confirm chrome | `security.confirmation.request` dropped before stringify; no Allow/Deny DOM `[inspected]` |
| Compose | unchanged | HTTP pack strip + router `allowTrust` force-false untouched |
| Autonomy | same tool-loop | `sendAppMessage` → `handleMessage` → origin push |
| Trust | monotonic | overlay cannot confirm; notice only |
| Channel | HTML loopback+token; SSE; never companion WS | EventSource + fetch; CSP `connect-src 'self'`; `isAllowedWsOrigin` unchanged |

---

## Attack results (short)

| Threat | Result |
|--------|--------|
| Confirm/Trust on SSE | **blocked** (allowlist + regex, stringify after) |
| Token in EventSource URL | **yes, inherent**; Referrer-Policy + CSP |
| Unbounded SSE | **capped at 4**, untested |
| GET events Origin | **not checked**; CORS ACAO absent / non-reflecting |
| WS Origin widened | **no** |
| `?token=%` hang | **403** |
| DoD 4 Chinese copy | **not user-visible**; test greps source |

---

VERDICT: REJECT
