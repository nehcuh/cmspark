# Independent adversary — PR #219 C-thin HTML shell + overlay file.upload

> **Lane**: Outcome / Trajectory / Component (Trust + WS Origin + overlay DoD)
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub`
> **Commit**: `6a3ab8f` (`feat(summoner): C-thin HTML shell + overlay file.upload`)
> **Parent**: `af52205` (C-thin P0 occupied upload)
> **PR**: #219 (OPEN) — T2, no auto-merge
> **Spec**: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`

HEAD matches claimed commit: `.git/refs/heads/feat/steer-nextrun-overlay-hub` → `6a3ab8f7d0de7de5ee7c02a0940414d9750acfd7`. `[inspected]`

This reviewer had no shell in-tool; `git show` / `git diff` / `npm test` were **not** re-executed here. Production files and tests were read at HEAD. Implementer-claimed test counts are `[assumed]` unless noted.

---

## Capability declaration (ADR-020) — copied, then checked against production

```text
Surface:      L0 overlay (chat, attachments, steer/queue)
L2-classes:   none — overlay never Allow/Deny
Compose:      overlay-eligible pack.apply allowTrust=false (already)
Autonomy:     same tool-loop
Trust:        monotonic; file.upload bytes only; hostname ignored
Channel:      summoner WS via tray dispatch; HTML is loopback+token HTTP, NEVER companion WS
```

Axes fit `[inspected]`: this is a new **Surface** (loopback HTML L0), not a new runtime, not a new L2 confirm dialect, not a Pack-first Side Panel chrome. `pack.apply` stays composition-only with `allowTrust` forced false on summoner. Tool-loop is unchanged (`chat.create` / `file.upload` → `handleMessage`).

Trust monotonicity holds on the load-bearing gates (HTTP reconstructs payloads; companion stamps `__cmspark_surface` from handshake; overlay `allowTrust: !overlayApply`). WS Origin allowlist is **not** widened.

---

## MACHINE

| Check | Result | Evidence |
|-------|--------|----------|
| HEAD is `6a3ab8f` | yes | `.git/HEAD` / refs `[inspected]` |
| companion `npm test` 3422+20 / 0 fail | **not re-run** | implementer claim `[assumed]` |
| `summoner-web.test.ts` exists and encodes DoD 1–7 as HTTP + source locks | yes | file read `[inspected]` |
| Occupied `file.upload` test still asserts `run_active` | yes | `companion/tests/single/files.test.ts:403-408` `[inspected]` |
| `isAllowedWsOrigin("http://127.0.0.1:23403") === false` | yes in test source | `summoner-web.test.ts:312-315` `[inspected]` |

Do not treat the HTTP suite as a security proof: dispatch is mocked; lease / `run_active` / `allowTrust` are **not** exercised through HTML → summoner WS → router in that file.

---

## DoD vs production

| # | Observable | Verdict |
|---|------------|---------|
| 1 | Loopback HTML: token required, Host check, Origin check on POST (settings-web pattern) | **pass** `[inspected]` `summoner-web.ts:72-96,221-243` |
| 2 | HTML does not connect companion WS; `isAllowedWsOrigin` still rejects `http://127.0.0.1` | **pass** `[inspected]` HTML is `fetch` only; `lifecycle.ts:196-208`; test `:312-315` |
| 3 | systray2/readline 「召唤器（实验）…」 opens the shell (not silent / not 「开发中」) | **pass** `[inspected]` menu → `type:"summoner"` → `openSummonerWebShell` |
| 4 | `file.upload` on `SUMMONER_ALLOW`; HTML file input sends bytes; hostname stripped | **pass** `[inspected]` ACL `:33`; HTML FileReader; HTTP reconstructs without hostname |
| 5 | `pack.apply` from HTML forces `user_gesture` and strips `allowTrust` / `workspace_path` / `force_takeover` | **pass** `[inspected]` `summoner-web.ts:324-336` + router overlay force-false |
| 6 | Dispatch allowlist ⊆ summoner ACL; no `config.set` / `mcp.add` / confirm | **pass** `[inspected]` both Sets + HTTP has no generic dispatch |
| 7 | Overlay HTML has no Allow/Deny/确认 chrome | **pass** `[inspected]` composer is 发送/纠偏/排队/停止; badge is disclaimer |
| 8 | macOS Swift NSPanel not grown (no new AppKit this commit) | **pass** `[inspected]` no `WKWebView` in tray Swift; Swift menu opens NSPanel locally (`Tray.swift:374-376`) and does **not** emit `type:"summoner"` to Node. Empty Swift diff not independently hashed. |
| 9 | Occupied `file.upload` still `run_active` (P0) | **pass** `[inspected]` `message-router.ts:611-613` still before parse; test still asserts |

No DoD item failed. Trust / WS Origin not weakened.

---

## Attack results (threats listed in the prompt)

### 1. Token in URL leaked via Referer / other sites?

**Not with this HTML.** Token lives in `/?token=` (`summoner-web.ts:140-141,449-450`). Page has **no** third-party scripts, fonts, images, or navigations. Messages/titles use `textContent`, not `innerHTML` (`:507-516`, `:464-471`). `[inspected]`

Residual: responses have **no** `Referrer-Policy` / CSP / `X-Frame-Options` (`:247-248`). Same omission as `settings-web.ts:309-311`. A later external resource would leak the 256-bit session token in Referer. Local process list also sees `open <url-with-token>` (`:144-156`). Matches settings-web; not a DoD fail.

### 2. DNS rebinding / Host bypass?

**No.** Server `listen(port, "127.0.0.1")` (`:181`). `hostOk` requires exact `127.0.0.1:port` / `localhost:port` / `[::1]:port` (`:83-86`). Missing Host → 403. POST Origin must match that port or be empty (`:88-96,240-243`). Empty Origin is the settings-web CSRF model (`settings-web.ts:270-277`): browsers send Origin on cross-site POST; token is the secret. Rebinding without the token gets 403. `[inspected]`

`originOk` allowing **empty** Origin is the same footgun as settings-web (curl/local process with stolen token). Not a web CSRF.

### 3. Dispatch forwarding unallowlisted types?

**No generic forward.** Each path reconstructs a fixed payload then `dispatchAllowed(type, payload)` which checks `SUMMONER_WEB_DISPATCH_ALLOW` (`:132-138,245-370`). `/api/config` → 404, dispatch length 0 (test `:283-297`). `[inspected]`

`dispatchSummonerWeb` (`menu-bar-agent.ts:1193-1210`) does **not** re-check the HTTP allowlist; it spreads leftover keys. Companion `assertSummonerAllowed` (`lifecycle.ts:1038-1044`) is the real SoT. HTTP ⊆ ACL today (`summoner-web.ts:14-29` vs `summoner-acl.ts:12-35`). `[inspected]`

Footgun: `activeDispatch({ type, ...payload })` (`:137`) lets `payload.type` clobber the allowlisted type **after** the Set check. Current handlers rebuild payloads so `type` is not user-controlled. If someone later does `dispatchAllowed("file.upload", body)`, a body `type` would change the WS method. ACL would still deny `config.set` / `mcp.add` / confirm. Not a current hole.

### 4. HTML connecting WS with spoofed Origin?

**Page cannot.** Inline script uses `fetch` only. No `WebSocket`, no `ws://` (test greps the HTML). Even if a console operator opened `ws://127.0.0.1:23401`, `isAllowedWsOrigin` rejects `http://127.0.0.1*` (`lifecycle.ts:196-208`; `ws-origin.test.ts:19` already rejects `:23401`; new test rejects `:23403`). Browser cannot spoof Origin to `cmspark-tray://local`. `[inspected]`

### 5. `file.upload` supersede regression?

**No.** Occupied gate is still synchronous at the top of the case, before parse / `chatCreate`:

```611:613:companion/src/message-router.ts
      if (abortControllers.has(thread_id)) {
        return { type: "error", error: "run_active", thread_id }
      }
```

Comment at `:833-834` still forbids abort-live-loop. Test `files.test.ts:403-408` still expects `run_active`. HTML also refuses files when `busy` (`summoner-web.ts:573-576`) — UI only; server is SoT. `[inspected]`

### 6. HTML `chat.create` skipping overlay lease?

**No on the companion gate.** `chat.create` still `gateChatCreateOnLease` before `run_active` (`message-router.ts:332-337`). Default holder is `panel` (`composer-lease.ts:40-42`). Summoner-stamped create without claim → `OVERLAY_STANDBY`. HTML `selectThread` POSTs `/api/lease` which `get` + `claim` holder `"overlay"` (`summoner-web.ts:339-358,524-527`). Surface mismatch on claim is rejected (`composer-lease.ts:169-177`). `[inspected]`

HTTP `/api/chat` does **not** auto-claim (good). Tests mock dispatch and do **not** prove this stack. Router tests for lease on `file.upload` exist (`files.test.ts:424-444`).

### 7. `pack.apply` Trust write via HTTP?

**No.** HTTP sends only `{ pack_id, thread_id, user_gesture: true }` (`summoner-web.ts:332-336`). Router overlay path (`message-router.ts:2767-2801`):

- rejects `workspace_path` / `force_takeover` / `confirmation_phrase`
- `allowTrust: !overlayApply` → **false**
- `isOverlayEligiblePack` (manifest `trust` ⇒ ineligible: `overlay-eligible.ts:10`)
- refuses if `mission_pack_trust_snapshot` already present
- `pack-engine.ts:1494,1517,1644-1652` does not write Trust when `allowTrust` is false

Client greying `overlay_eligible!==true` is **not** SoT; server is. `[inspected]`

### 8. Swift overlay unchanged but systray2 still notifying instead of opening?

**No.** systray2 menu `push("召唤器（实验）…", { type: "summoner" })` (`systray2-bridge.ts:257`). `openSummoner` emits the same action (`:178-180`). readline prints the item and `emit("summoner")` (`readline-tray.ts:148,187`). `handleAction` `case "summoner"` → `openSummonerWebShell` (`menu-bar-agent.ts:1256-1258`). Grep finds no `跨平台召唤窗开发中` in production. Swift menu is **local** `summonerController.open` (`Tray.swift:374-376`) — does not take the HTML path. `[inspected]`

---

## Blockers

**None.** No DoD miss. WS Origin not widened. Overlay cannot write Trust B via HTTP. Occupied upload still `run_active`.

---

## Findings (non-blocking)

### MAJOR

**M1 — HTML never releases overlay lease on tab close.** `[inspected]`
Swift close → `handleSummonerClosed` → `releaseAllOverlayComposerLeases` (`menu-bar-agent.ts:750-756`). HTML `selectThread` claims overlay (`summoner-web.ts:339-358`) and has no `beforeunload` / `composer.lease.release` route (release is on the HTTP allowlist `:27` but unused). Closing the system browser leaves `holder: overlay`. Side panel composer stays `OVERLAY_STANDBY` until something else claims. Not Trust elevation; overlay contract incomplete. 30 min idle only `stopSummonerWebServer` (`:187-191`) — does not drop leases.

### Nits

**N1 — No `Referrer-Policy` / CSP / `X-Frame-Options` / `nosniff`.** `[inspected]` `summoner-web.ts:247-248`. Token-in-query is settings-web-shaped; headers should still say `no-referrer` so a future `<img>` cannot leak it.

**N2 — `dispatchSummonerWeb` is a passthrough.** `[inspected]` `menu-bar-agent.ts:1197-1210`. Relies on HTTP reconstruction + ACL. Does not drop unknown keys. `file.upload` is in the fire-and-forget `if` **and** the dead `timeout === "file.upload"` branch (`:1204` vs `:1209`).

**N3 — Fire-and-forget swallows companion errors.** `[inspected]` `chat.create` / `file.upload` / `steer` / `abort` return `{ type: "accepted" }` if the socket send succeeded. Occupied `run_active` never reaches the HTML. UI then paints 「已发送」 (`summoner-web.ts:582-588`). Server still refuses; overlay can lie. `pack.apply` correctly uses RPC.

**N4 — `{ type, ...payload }` clobber.** `[inspected]` `summoner-web.ts:137`. Not exploitable on current reconstructed payloads.

**N5 — `parseQuery` / `tokenOk` sit outside the `try`.** `[inspected]` `summoner-web.ts:221-227` vs `:245`. `decodeURIComponent('%')` throws; `void handleRequest` can hang the socket. Local only.

**N6 — Allowlist dead entries.** `[inspected]` `system.ping` and `composer.lease.release` are HTTP-allowlisted with no route.

**N7 — Tests are partly source-grep.** `[inspected]` systray/readline/menu-bar locks are regex over `.ts` (`summoner-web.test.ts:327-344`). HTTP suite mocks dispatch: it cannot see ACL, lease, or `run_active`. Occupied upload coverage lives in the parent `files.test.ts`, not this slice.

**N8 — HTML `/api/lease` ignores claim failure.** `[inspected]` `selectThread` `.then(function(){ return api("/api/thread?...")})` (`:527-528`). Failed claim still renders the thread; send then fails at companion.

**N9 — `chat.abort` is not lease-gated.** `[inspected]` `message-router.ts:1117-1118`. Pre-existing on summoner ACL. HTML Stop can abort any `thread_id` the page can name. Not new confirm chrome (DoD 7 still holds). Also trips `securityConfirmations.rejectForWorker` — pre-existing abort side-effect, not HTML Allow/Deny.

**N10 — FILE body 15MB vs WS frame budget.** `[inspected]` `FILE_BODY_MAX = 15 * 1024 * 1024` (`:31`). A huge overlay upload can 1009 the summoner WS. Side panel already had a frame budget; HTML does not pre-check.

---

## Trajectory

Slice matches the spec: new loopback HTML, tray menu opens it, `file.upload` ACL, hostname stripped, Swift NSPanel not replaced by WKWebView.

Not drive-by beyond the slice. `message-router` occupied path looks untouched (still the P0 `run_active` return).

TDD: HTTP token/Host/Origin/pack-strip tests are real (bind 127.0.0.1, issue requests). Tray “opens shell” is **not** executed — source lock only. Lease-skip and occupied upload are **not** tested through the new HTTP dispatcher.

Dead path: `composer.lease.release` on the HTTP allowlist with no handler — the close/release path was skipped (see M1).

---

## Component (file:line)

| Gate | Location |
|------|----------|
| Token | `companion/src/summoner-web.ts:72-81,221-223` |
| Host | `companion/src/summoner-web.ts:83-86,225-227` |
| POST Origin | `companion/src/summoner-web.ts:88-96,240-243` |
| Bind loopback | `companion/src/summoner-web.ts:181` |
| Dispatch allowlist | `companion/src/summoner-web.ts:14-29,132-138` |
| pack.apply strip | `companion/src/summoner-web.ts:332-336` |
| file.upload strip | `companion/src/summoner-web.ts:311-321` |
| HTML no WS | `companion/src/summoner-web.ts:447-634` (`fetch` only) |
| Tray open HTML | `companion/src/menu-bar-agent.ts:1213-1258` |
| systray2 menu | `companion/src/tray/systray2-bridge.ts:178-180,257` |
| readline menu | `companion/src/tray/readline-tray.ts:96-98,148,187` |
| Summoner ACL `file.upload` | `companion/src/ws/summoner-acl.ts:33,41-42` |
| ACL enforcement | `companion/src/ws/lifecycle.ts:1038-1046` |
| WS Origin | `companion/src/ws/lifecycle.ts:196-208` |
| Occupied upload | `companion/src/message-router.ts:611-613` |
| Overlay pack Trust | `companion/src/message-router.ts:2767-2801` |
| Swift still NSPanel | `companion/src/tray/Tray.swift:268-271,374-376` |

---

## ADR-020 / P1 watchlist

| ID | This commit |
|----|-------------|
| P1-1 god-mode / `config.set` | **not reachable** from HTML (404 + ACL deny) |
| P1-2 `originWs` | **not touched** — no new `securityConfirmations.request` |
| P1-3 evaluate | **not touched** |
| P1-4 shell | **not touched** |
| Confirm dialects | none — no Allow/Deny/确认 in HTML |
| Trust monotonicity | overlay `allowTrust` forced false; hostname not a trust gate (`message-router.ts:431`) |

---

## Capability vs production (short)

| Axis | Declared | Production |
|------|----------|------------|
| Surface | L0 overlay | HTML composer + files + steer/queue + L0 packs `[inspected]` |
| L2-classes | none | no confirm chrome; ACL denies `security.confirmation.response` |
| Compose | overlay-eligible, `allowTrust=false` | HTTP strip + router force-false + `isOverlayEligiblePack` |
| Autonomy | same tool-loop | `sendAppMessage` into existing `handleMessage` |
| Trust | monotonic; bytes only; hostname ignored | HTML drops hostname; upload bytes `name/type/content`; Trust B not written |
| Channel | summoner WS via tray; HTML never companion WS | `summonerClient` `surface:"summoner"` + HMAC; page is HTTP+token |

---

VERDICT: APPROVE_WITH_NITS
