# Pi re-review — PR #219 C-thin HTML shell + overlay file.upload

> **Lane**: eval-engineering-gate stage 2 (confirm or reject independent adversary)
> **Role**: Pi — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub`
> **Commit**: `6a3ab8f7d0de7de5ee7c02a0940414d9750acfd7` (`feat(summoner): C-thin HTML shell + overlay file.upload`)
> **Parent**: `af52205` (C-thin P0 occupied upload)
> **PR**: #219 (OPEN) — T2, no auto-merge
> **Adversary**: `docs/audit/reviews/pr219-c-thin-html-adversary-20260824.md` — **VERDICT: APPROVE_WITH_NITS** (read in full, not a summary)
> **Spec**: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`

HEAD matches claimed commit: `.git/HEAD` → `refs/heads/feat/steer-nextrun-overlay-hub` → `6a3ab8f7d0de7de5ee7c02a0940414d9750acfd7`. `.git/logs/HEAD` last line is `af52205d… 6a3ab8f7… feat(summoner): C-thin HTML shell + overlay file.upload`. `[inspected]`

This Pi session had **no shell tool**. `git diff af52205..6a3ab8f` and `companion npm test` were **not re-executed**. Production files + tests were read at HEAD. Implementer-claimed `3422+20 / 0 fail` remains `[assumed]`. Slice membership is inferred from COMMIT_EDITMSG + files that only exist as this HTML path (`summoner-web.ts`, `summoner-web.test.ts`) plus the ACL / tray / launcher sites the spec names.

---

## Confirmation-order status

1. MACHINE — implementer claimed green this session; Pi did not re-run.
2. Independent adversary — `APPROVE_WITH_NITS` (full report read).
3. Pi — confirm adversary on Trust / WS Origin / DoD; M1 kept as MAJOR residual, not a blocker.

**Blast**: T2 L0 overlay Surface. Channel is loopback HTML + token; companion WS Origin allowlist must stay `chrome-extension://` ∪ `cmspark-tray://local`. Overlay must not write Trust B.

---

## Capability declaration — checked against production

```text
Surface:      L0 overlay (chat, attachments, steer/queue)
L2-classes:   none — overlay never Allow/Deny
Compose:      overlay-eligible pack.apply allowTrust=false
Autonomy:     same tool-loop
Trust:        monotonic; file.upload bytes only
Channel:      HTML loopback+token; never companion WS from the page
```

Axes fit `[inspected]`: new **Surface** (loopback HTML L0), not a new runtime, not a new L2 confirm dialect. `pack.apply` stays composition-only with overlay `allowTrust: !overlayApply` (`message-router.ts:2796-2800`). Tool-loop is unchanged (`chat.create` / `file.upload` → `handleMessage`). HTML never upgrades `ws://127.0.0.1:23401` (no `WebSocket` / `ws://` in `summoner-web.ts`; inline script is `fetch` only `:457-458`).

Trust monotonicity holds on the load-bearing gates (HTTP reconstructs payloads; companion stamps `__cmspark_surface` from handshake `lifecycle.ts:990-991` + `stampCmsparkSurface` `composer-lease.ts:115-118`; overlay `allowTrust: !overlayApply`). WS Origin allowlist is **not** widened (`lifecycle.ts:196-208`).

---

## MACHINE

| Check | Result | Evidence |
|-------|--------|----------|
| HEAD is `6a3ab8f` | yes | `.git/refs/heads/feat/steer-nextrun-overlay-hub` `[inspected]` |
| parent is `af52205` | yes | `.git/logs/HEAD` `[inspected]` |
| companion `npm test` 3422+20 / 0 fail | **not re-run** | implementer claim `[assumed]` |
| `summoner-web.test.ts` encodes DoD 1–7 as HTTP + source locks | yes | file read `[inspected]` |
| Occupied `file.upload` still `run_active` | yes | `companion/tests/single/files.test.ts:403-408` `[inspected]` |
| `isAllowedWsOrigin("http://127.0.0.1:23403") === false` | yes | `summoner-web.test.ts:312-315`; same predicate re-exported from `lifecycle.ts` via `server.ts:89-103`; `ws-origin.test.ts:19` already rejects `:23401` `[inspected]` |

Agree with adversary: the HTTP suite is **not** a security proof. Dispatch is mocked; lease / `run_active` / `allowTrust` are not exercised HTML → summoner WS → router in that file. Occupied upload + overlay Trust still live in parent tests (`files.test.ts`, pack-engine / overlay-eligible).

---

## DoD vs production (confirm or refute)

| # | Observable | Adversary | Pi |
|---|------------|-----------|----|
| 1 | Loopback HTML: token required, Host check, Origin check on POST | pass | **confirm** `summoner-web.ts:72-96,181,221-243`. Bind `listen(port, "127.0.0.1")`. Missing Host → `hostOk` false → 403. POST Origin must match loopback port or be empty (settings-web CSRF model `settings-web.ts:270-277`). |
| 2 | HTML does not connect companion WS; `isAllowedWsOrigin` still rejects `http://127.0.0.1` | pass | **confirm**. Grep of `summoner-web.ts` finds no `WebSocket` / `ws://`. Predicate `lifecycle.ts:196-208` allows only `chrome-extension://[A-Za-z0-9_-]+` and exact `cmspark-tray://local`. Test `:312-315`. |
| 3 | systray2/readline 「召唤器（实验）…」 opens the shell | pass | **confirm**. `systray2-bridge.ts:178-180,257`; `readline-tray.ts:148,187`; `handleAction` `case "summoner"` → `openSummonerWebShell` `menu-bar-agent.ts:1213-1258`. No `跨平台召唤窗开发中` in production (only the test negative lock). Swift menu is **local** `summonerController.open` (`Tray.swift:374-376`) and does **not** emit `type:"summoner"` to Node — spec says Swift NSPanel stays. |
| 4 | `file.upload` on `SUMMONER_ALLOW`; HTML file input sends bytes; hostname stripped | pass | **confirm with a precision note**. ACL `:33`. HTML FileReader emits `{name,type,content}` (`summoner-web.ts:549-561`). HTTP reconstructs `{thread_id, files, message?}` — top-level `hostname`/`url` dropped (test `:211-234`). `body.files` is copied **verbatim** (not a `{name,type,content}` pick). Extra per-file keys are unused by `partitionUploadFiles` (`split-upload-files.ts:48-51`). Chat hostname is `rest.hostname` (`message-router.ts:431-432,967`) — not a trust gate. |
| 5 | `pack.apply` from HTML forces `user_gesture` and strips `allowTrust` / `workspace_path` / `force_takeover` | pass | **confirm** `summoner-web.ts:332-336` + router overlay path `:2767-2801` (`allowTrust: !overlayApply` → false; `isOverlayEligiblePack`; cookie present → `pack_trust_cookie_present`). `pack-engine.ts:1494,1517,1644-1652` does not write Trust when `allowTrust` is false. |
| 6 | Dispatch allowlist ⊆ summoner ACL; no `config.set` / `mcp.add` / confirm | pass | **confirm**. HTTP Set `summoner-web.ts:14-29` vs ACL `summoner-acl.ts:12-35`. Test `:318-324` asserts every HTTP-allowlisted type is ACL-ok. `/api/config` → 404, dispatch length 0 (test `:283-297`). No generic dispatch route. |
| 7 | Overlay HTML has no Allow/Deny/确认 chrome | pass | **confirm**. Composer is 发送/纠偏/排队/停止 (`:438-441`). Badge is 「本页不代替侧栏批准」 (`:419`) — disclaimer, not a confirm control. Test `:114` greps `允许\|拒绝\|Allow\|Deny\|确认` out of the HTML. ACL denies `security.confirmation.response` (`summoner-acl.test.ts:24-36`). |
| 8 | macOS Swift NSPanel not grown | pass | **confirm at HEAD, not independently hashed**. No `WKWebView` / `23403` / `summoner-web` under `companion/src/tray/*.swift`. `Tray.swift:268-271,374-376` still opens NSPanel locally. Empty Swift diff not `git show`'d this session. |
| 9 | Occupied `file.upload` still `run_active` (P0) | pass | **confirm** `message-router.ts:611-613` still synchronous at top of case, after lease/conductor, before parse. Comment `:833-834` still forbids abort-live-loop. Test `files.test.ts:403-408` (`occupiedUpload.error === "run_active"`). HTML busy-file refuse `:573-576` is UI only. |

No DoD item failed. Trust / WS Origin not weakened.

---

## Attack results (same threat list)

### 1. Token in URL leaked via Referer / other sites?

**Confirm adversary.** Token lives in `/?token=` (`:140-141,449-450`). Page has no third-party scripts, fonts, images, or navigations. User-controlled strings use `textContent` (`:469,482,494,514`), not `innerHTML` (only `innerHTML=""` clears and one static chip string `:478`). Residual: responses have no `Referrer-Policy` / CSP / `X-Frame-Options` / `nosniff` (`:247-248`). Same omission as `settings-web.ts:309-311`. Local process list sees `open <url-with-token>` (`:144-156`). Not a DoD fail.

### 2. DNS rebinding / Host bypass?

**Confirm.** `listen(port, "127.0.0.1")` (`:181`). `hostOk` exact `127.0.0.1:port` / `localhost:port` / `[::1]:port` (`:83-86`). Missing Host → 403. POST Origin must match or be empty (`:88-96,240-243`). Empty Origin is the settings-web CSRF model: browsers send Origin on cross-site POST; token is the secret. Rebinding without the token gets 403. `hostOk` allowing `[::1]` while the socket is IPv4-only is harmless (settings-web same).

### 3. Dispatch forwarding unallowlisted types?

**Confirm: no generic forward.** Each path reconstructs then `dispatchAllowed` (`:132-138,245-370`). `dispatchSummonerWeb` (`menu-bar-agent.ts:1193-1210`) does **not** re-check the HTTP allowlist; companion `assertSummonerAllowed` (`lifecycle.ts:1038-1044`) is SoT.

Footgun `{ type, ...payload }` (`summoner-web.ts:137`) is real and **after** the Set check. Current handlers rebuild payloads so `type` is not user-controlled. A later `dispatchAllowed("file.upload", body)` would let `body.type` change the WS method. ACL would still deny `config.set` / `mcp.add` / confirm, but ACL **allows** `voice.stt.*` / `companion.ui.rect` / `history.query` / `composer.lease.release_overlay` — so the clobber is not “ACL saves every type”, only the dangerous ones. **Not a current hole.** N4 stands.

### 4. HTML connecting WS with spoofed Origin?

**Confirm: page cannot.** Inline script is `fetch` only. Browser cannot set Origin to `cmspark-tray://local`. Even a console `new WebSocket("ws://127.0.0.1:23401")` is Origin `http://127.0.0.1:23403` → `isAllowedWsOrigin` false (`lifecycle.ts:711` `verifyClient`). HMAC still sits behind that filter for local-process spoof.

### 5. `file.upload` supersede regression?

**Confirm.** Occupied gate still first after lease/conductor (`:611-613`). Test still expects `run_active`. HTML busy refuse is UI only.

### 6. HTML `chat.create` skipping overlay lease?

**Confirm on the companion gate.** `gateChatCreateOnLease` before the loop (`message-router.ts:332-337`). Default holder is `panel` (`ws/composer-lease.ts:40-42` — adversary omitted the `ws/` path; line numbers match that file). Summoner-stamped create without claim → `OVERLAY_STANDBY`. HTML `selectThread` POSTs `/api/lease` which `get` + `claim` holder `"overlay"` (`summoner-web.ts:339-358,524-527`). Surface mismatch on claim is rejected (`ws/composer-lease.ts:169-177`). HTTP `/api/chat` does **not** auto-claim (good).

### 7. `pack.apply` Trust write via HTTP?

**Confirm: no.** HTTP sends only `{ pack_id, thread_id, user_gesture: true }`. Router overlay path rejects `workspace_path` / `force_takeover` / `confirmation_phrase`, forces `allowTrust: false`, `isOverlayEligiblePack` (manifest `trust` ⇒ ineligible: `overlay-eligible.ts:10`), refuses if `mission_pack_trust_snapshot` present. `pack.saved_user` `allowTrust: true` (`message-router.ts:2919`) is a **different type**, not HTTP-dispatched. Client greying `overlay_eligible!==true` is not SoT.

### 8. Swift overlay unchanged but systray2 still notifying instead of opening?

**Confirm: no.** Menu item + `openSummoner` emit `type:"summoner"` → HTML shell. Swift stays NSPanel-local.

---

## M1 — blocker or nit?

Adversary **M1**: HTML never releases overlay lease on tab close. `[inspected]` and **confirmed**.

- Swift close → `handleSummonerClosed` → `releaseAllOverlayComposerLeases` (`menu-bar-agent.ts:750-756`).
- HTML `selectThread` claims overlay (`summoner-web.ts:339-358`) and has no `beforeunload` / `pagehide` / `composer.lease.release` route.
- `composer.lease.release` is on the HTTP allowlist (`:28`) with **no handler** — close path was sketched and skipped.
- 30 min idle only `stopSummonerWebServer` (`:187-191,196-207`) — nulls token/dispatch, **does not** drop leases.
- Summoner WS stays up (tray `summonerClient`); `broadcastOverlayLeasesOnSocketClose` (`lifecycle.ts:1353`, `ws/composer-lease.ts:305-312`) therefore does **not** run on tab close.

**Recovery path — adversary slightly imprecise.** Side Panel does **not** claim `holder: "panel"`. Chrome extension only *receives* `composer.lease` and paints standby (`useWebSocket.ts:475-481`, `APPLY_COMPOSER_LEASE` `agentStore.tsx:808-814`). “Until something else claims” overstates it. Recovery is: overlay release, overlay claim of a *sibling* thread (releases others, `ws/composer-lease.ts:55-56`), summoner WS death, or companion restart (in-memory registry). Until then, **that thread’s** Side Panel composer stays `OVERLAY_STANDBY`. Other threads default `panel` and remain usable. Reopening HTML re-claims overlay — user can still talk on the overlay surface.

**Not Trust elevation. Not WS Origin. Not a listed DoD miss** (spec P1 / adversary DoD 1–9 do not require HTML close → panel). Overlay S20 contract (“close overlay ⇒ panel”) is **incomplete on the Win/Linux path this slice ships**. That is real product debt, appropriate as **MAJOR residual**, not a T2 merge blocker. Next slice (OS webview host) can hook close; until then `beforeunload` + `/api/lease/release` (or `release_overlay`) + `stopSummonerWebServer` should also drop holds.

**Pi decision: keep APPROVE_WITH_NITS. Do not upgrade M1 to REJECT.**

---

## Findings — confirm / adjust

### MAJOR

**M1** — confirmed. Keep MAJOR. See above. Do not treat as nit; do not treat as blocker.

### Nits — all confirmed, none upgraded

| ID | Adversary | Pi |
|----|-----------|----|
| N1 | No `Referrer-Policy` / CSP / `X-Frame-Options` / `nosniff` | **confirm** `:247-248`. Token-in-query is settings-web-shaped; still add `no-referrer` so a future `<img>` cannot leak it. |
| N2 | `dispatchSummonerWeb` passthrough; dead `timeout === "file.upload"` | **confirm** `menu-bar-agent.ts:1197-1210`. Relies on HTTP reconstruction + ACL. `file.upload` is in the fire-and-forget `if` **and** the unreachable timeout ternary. |
| N3 | Fire-and-forget swallows companion errors | **confirm**. `chat.create` / `file.upload` / `steer` / `abort` return `{ type: "accepted" }` if the socket send succeeded. Occupied `run_active` never reaches the HTML; UI paints 「已发送」 (`:582-588`). Server still refuses. `pack.apply` correctly uses RPC. Overlay can **lie**, cannot **bypass**. |
| N4 | `{ type, ...payload }` clobber | **confirm** `:137`. Not exploitable on current reconstructed payloads. If later generic-forwarded, ACL does not cover every summoner-legal type (STT / rect). |
| N5 | `parseQuery` / `tokenOk` outside `try` | **confirm** `:221-227` vs `:245`. `decodeURIComponent('%')` throws; `void handleRequest` can hang the socket. Same family: `timingSafeEqual` throws if string length matches but `Buffer.from` byte length differs (non-hex 64-char token). Local only; not a token bypass. |
| N6 | Allowlist dead entries `system.ping` / `composer.lease.release` | **confirm**. Release dead entry is the M1 smoking gun. |
| N7 | Tests partly source-grep; HTTP mocks dispatch | **confirm** `:327-344`. Occupied upload coverage lives in parent `files.test.ts`, not this slice. |
| N8 | `/api/lease` claim failure ignored | **confirm** `selectThread` `:527-528` `.then(function(){ return api("/api/thread?...")})`. Failed claim still renders; send then fails at companion (`OVERLAY_STANDBY`). |
| N9 | `chat.abort` not lease-gated | **confirm** `message-router.ts:1117-1143`. Pre-existing on summoner ACL. HTML Stop can abort any `thread_id` the page can name (and `rejectForWorker`). Not new confirm chrome. DoD 7 still holds. **Keep as nit, not this-slice regression.** |
| N10 | FILE body 15MB vs WS frame budget | **confirm** `FILE_BODY_MAX = 15 * 1024 * 1024` (`:31`) vs `MAX_WS_MESSAGE_SIZE = 10MB` (`lifecycle.ts:70-73`). HTML does not pre-check. 1009 is availability, not Trust. |

No adversary nit was too harsh. None were blockers in disguise.

---

## Missed-hole hunt (Pi, independent of adversary list)

| Threat | Result |
|--------|--------|
| WS Origin weakened for `:23403` | **no** — `lifecycle.ts:196-208`; tests `:312-315` and `ws-origin.test.ts:19` |
| Trust write via leftover HTTP keys | **no** — handlers reconstruct; `allowTrust` not copied; router forces false |
| Confirm chrome / `security.confirmation.response` | **no** — HTML + ACL |
| Dispatch type clobber → `config.set` | **no currently**; ACL would still deny. Clobber → `voice.stt.*` would pass ACL — latent, N4 |
| Token CSRF (cross-site POST) | **no** — Origin checked on POST; token unguessable. Empty Origin + stolen token = local process (settings-web) |
| GET CSRF / missing Origin on GET | **not state-changing**. `thread.select` is a read (`message-router.ts:1823-1846`). State-changing routes are POST. |
| XSS via thread/pack/MCP names | **no** — `textContent` |
| HTML `innerHTML` with user data | **no** |
| `files[]` extra keys / hostname-on-file | unused by partitioner; chat hostname is message-level and stripped |
| Panel claim-as-recovery | **does not exist** — strengthens M1 residual, not a new Trust hole |
| `openLoopbackPage` Windows `shell: true` | token is 64 hex; no metachar injection |
| `pack.saved_user` allowTrust true reachable from HTML | **no** — not in HTTP allowlist / no route |
| HMAC / handshake surface spoof from the page | page cannot present `cmspark-tray://local` |

No DoD miss. No Trust / WS Origin weakening the adversary missed.

---

## Trajectory / Component

Slice matches spec: new loopback HTML, tray menu opens it on systray2/readline, `file.upload` ACL, hostname stripped at reconstruct, Swift NSPanel not replaced by WKWebView.

Not drive-by beyond the slice at HEAD: `message-router` occupied path still the P0 `run_active` return; `isAllowedWsOrigin` body unchanged.

TDD: HTTP token/Host/Origin/pack-strip tests are real (bind 127.0.0.1, issue requests). Tray “opens shell” is source-lock only. Lease-skip and occupied upload are **not** tested through the new HTTP dispatcher.

Dead path: `composer.lease.release` HTTP-allowlisted with no handler (M1).

Path correction vs adversary: `composer-lease.ts` citations are `companion/src/ws/composer-lease.ts` (missing `ws/` in the report; line numbers match).

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

## Pi vs adversary

Adversary was **not too loose** on Trust / WS Origin / occupied upload / pack strip / Origin allowlist. **Not too harsh** on nits. One precision miss: M1 recovery is overlay **release** (or sibling overlay claim / WS death / restart), not Side Panel claim. That does not change the verdict.

MACHINE tests not re-run this session — same class of gap as the adversary. Implementer numbers stay `[assumed]`. If those numbers were fabricated, that is outside this file review.

---

VERDICT: APPROVE_WITH_NITS
