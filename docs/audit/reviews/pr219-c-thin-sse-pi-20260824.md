# Pi re-review — PR #219 C-thin P2 thin SSE (B1 + Trust/WS Origin)

> **Lane**: eval-engineering-gate stage 2 (confirm or reject independent adversary)
> **Role**: Pi — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub`
> **HEAD**: `4e61b9fe54f98bb5fe77f842aafb2c83165a36e6` (`fix(summoner): map OVERLAY_STANDBY from error_code not English error`)
> **Range**: `947db02` (lease-release parent) → `d81444c` (SSE) → `4e61b9f` (B1 overlay label)
> **PR**: #219 (OPEN) — T2, no auto-merge
> **Adversary r1**: `docs/audit/reviews/pr219-c-thin-sse-adversary-20260824.md` — **VERDICT: REJECT** (B1)
> **Adversary r2**: `docs/audit/reviews/pr219-c-thin-sse-adversary-r2-20260824.md` — **VERDICT: APPROVE_WITH_NITS** (B1 closed)
> **Spec**: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md` P2

HEAD matches claimed commit: `.git/HEAD` → `refs/heads/feat/steer-nextrun-overlay-hub` → `4e61b9fe54f98bb5fe77f842aafb2c83165a36e6`. `.git/logs/HEAD` last two commits are `947db02 → d81444c` (SSE) then `d81444c → 4e61b9f` (B1 label). `.git/COMMIT_EDITMSG` is the B1 mapping commit. `[inspected]`

This Pi session had **no shell tool**. `git diff 947db02..4e61b9f` and `companion npm test` were **not re-executed**. Production files + tests were read at HEAD; r1/r2 reports were read in full. Implementer-claimed `3426+20` on `d81444c` and `summoner-web.test.js` 23 pass after `4e61b9f` remain `[assumed]`. Semantic slice for `4e61b9f` is reconstructed from COMMIT_EDITMSG + HEAD sources vs r1’s `d81444c` description, not a `git show` blob.

Must-falsify (from the gate prompt): **B1 still dead**, **SSE forwards confirm chrome**, **WS Origin widened**. Any one of those is REJECT. Remaining r1 nits that are still true are carried, not re-litigated as blockers.

---

## Confirmation-order status

1. MACHINE — implementer claimed green this session; Pi did not re-run.
2. Independent adversary — r1 **REJECT** (B1); r2 **APPROVE_WITH_NITS** (B1 closed). Both reports read in full.
3. Pi — independently walk the **real** `ChatCreateLeaseError` object through router → origin WS → tray fan-in → SSE → HTML `statusFromEvent`. Confirm SSE drop of `security.confirmation.request` still happens **before** `JSON.stringify`. Confirm `isAllowedWsOrigin` still two predicates + `return false`.

**Blast**: T2 L0 overlay Surface. New Channel is loopback EventSource. Overlay must not Allow/Deny. Companion WS Origin must stay `chrome-extension://` ∪ `cmspark-tray://local`.

---

## Capability declaration (ADR-020) — checked against production

```text
Surface:      L0 overlay HTML
L2-classes:   none — overlay never Allow/Deny; SSE must not forward confirm chrome
Compose:      unchanged
Autonomy:     same tool-loop
Trust:        monotonic
Channel:      HTML loopback+token; SSE /api/events; page never companion WS
```

Axes fit `[inspected]`: Channel add on the existing L0 HTML Surface (loopback EventSource). Not a new runtime, not a new L2 confirm dialect, not Pack-first Side Panel chrome. `4e61b9f` remaps overlay **status copy** only — it does not add SSE types, does not move `/confirm/i`, does not stringify earlier, does not touch `isAllowedWsOrigin`, does not add Allow/Deny DOM.

---

## MACHINE

| Check | Result | Evidence |
|-------|--------|----------|
| HEAD is `4e61b9f` | yes | `.git/refs/heads/feat/steer-nextrun-overlay-hub` `[inspected]` |
| Parent of HEAD is `d81444c`; grandparent `947db02` | yes | `.git/logs/HEAD` `[inspected]` |
| companion tests re-run | **not re-run** | `[assumed]` implementer |
| Test drives real router `chat.error` shape | **yes** | `summoner-web.test.ts:411-419` vs `composer-lease.ts:30-35,128-145` `[inspected]` |
| HTML `statusFromEvent` keys `data.error_code` | **yes** | `summoner-web.ts:766-788` `[inspected]` |
| SSE allowlist / confirm drop / WS Origin changed in `4e61b9f` | **no** | `pushSummonerWebEvent` `:195-209`; Set `:32-48`; `lifecycle.ts:196-208` `[inspected]` |
| New Trust / confirm-chrome hole | **no** | status-text only `[inspected]` |

Agree with both adversaries: the HTTP/SSE suite is **not** a security proof of the full HTML → summoner WS → router → `onAppMessage` → EventSource loop. Confirm-drop **is** a live SSE socket test (`summoner-web.test.ts:353-404`). B1 mapping is a direct call of the extracted helper plus a hand-walk of the HTML twin — not a DOM assertion.

---

## Must-falsify 1 — B1 (DoD 4 copy still dead?)

r1 B1 `[inspected]`, and Pi agrees it was real on `d81444c`: HTML keyed `labels[d.error || d.error_code]`. Router `error` is the English gate sentence, not `"OVERLAY_STANDBY"`. User would see `OVERLAY_STANDBY: composer is on the other surface`. Tests grepped the Chinese literal in HTML source. `labels.OVERLAY_STANDBY` was unreachable.

### Real router object (not the fantasy `error: "OVERLAY_STANDBY"`)

`ChatCreateLeaseError` (`composer-lease.ts:30-35,128-145`):

```
{
  type: "chat.error",
  thread_id,
  error: "OVERLAY_STANDBY: composer is on the other surface",
  data: { error_code: "OVERLAY_STANDBY", holder }
}
```

`assertComposerLease` sets `error` to that exact sentence (`:108`) and `error_code` to the const `OVERLAY_STANDBY` (`:107`). `gateChatCreateOnLease` puts `error_code` **only** under `data` (`:140-141`). Grep of production still finds **zero** `error: "OVERLAY_STANDBY"` exact — r1 was right about the shape; the fix must not pretend otherwise.

Router returns that object **unwrapped**: `message-router.ts:333-334` (`chat.create`), `:582-583` (`chat.steer`), `:606-607` (`file.upload`), `:1218-1219`. Not remapped, not folded into `type: "error"`.

`composer-lease.test.ts:67-76` locks the same object: `type === "chat.error"`, English `error`, `data.error_code === OVERLAY_STANDBY`.

### Does that object reach overlay SSE?

**Yes, on the fire-and-forget path.** `[inspected]`

1. Overlay POST `/api/chat` reconstructs `{ thread_id, message }` and `dispatchAllowed("chat.create", …)` (`summoner-web.ts:399-419`).
2. Tray `dispatchSummonerWeb` fire-and-forgets `chat.create` / `chat.steer` / `chat.abort` / `file.upload` (`menu-bar-agent.ts:1200-1207`) → HTTP `{ type: "accepted" }`. HTML paints **已提交** (DoD 3). Occupancy cannot ride that HTTP body.
3. `CompanionClient.sendAppMessage` sends `{ type, ...params }` **with no `id`** (`companion-client.ts:440-447`).
4. Companion `handleMessage` returns `leaseErr`. Origin-socket `ws.send(JSON.stringify({ ...response, id: msg?.id }))` (`lifecycle.ts:1277-1280,1329-1334`). No `id` on the inbound → `JSON.stringify` omits `id`. Payload on the wire **is** `ChatCreateLeaseError`.
5. Tray `handleMessage`: no `msg.id` in `pendingRequests` → falls through to `appMessageCbs` (`companion-client.ts:528-538,575-579`). `summonerClient.onAppMessage` → `pushSummonerWebEvent(msg)` (`menu-bar-agent.ts:1418-1421`).
6. `chat.error` is in `SUMMONER_WEB_EVENT_ALLOW` (`summoner-web.ts:35`). `/confirm/i` does not match `chat.error`. Full object is `JSON.stringify`’d onto SSE **after** the allowlist/regex (`:195-200`).

This is the DoD 4 send-occupancy observable. Overlay claim itself is CAS-on-rev and **steals** on matching rev (`composer-lease.ts:44-57`); panel-held overlay send is the `OVERLAY_STANDBY` gate, not a failed claim. Claim mismatch is a separate HTTP path (`composer.lease.error` / `LEASE_REV_MISMATCH`) — see below.

### Does the test drive that object?

**Yes.** `[inspected]` `summoner-web.test.ts:411-419`:

```
summonerWebEventStatus({
  type: "chat.error",
  error: "OVERLAY_STANDBY: composer is on the other surface",
  data: { error_code: "OVERLAY_STANDBY", holder: "panel" },
}) === "侧栏占用了输入"
```

That is `ChatCreateLeaseError` plus `holder: "panel"` (the overlay-send-while-panel-holds case). Not source-grep theater on this object.

Claim mismatch is also driven (`:421-426`) as `{ type: "composer.lease.error", error: "LEASE_REV_MISMATCH", error_code: "LEASE_REV_MISMATCH" }`, which matches `handleComposerLeaseFamily` (`composer-lease.ts:185-190`) minus `thread_id`/`holder`/`rev` (irrelevant to the mapper). `run_active` exact-key still maps (`:428-431`) — r1 already worked; not regressed.

### Would production HTML paint that shape?

**Yes.** `[inspected]` Live paint is the inline twin `statusFromEvent` (`summoner-web.ts:766-788`), called from the EventSource `error` / `chat.error` branch (`:787-788`) and from `selectThread` claim HTTP (`:656-657`).

Hand-walk of the required object through the **HTML** function (the one the browser runs; HTML cannot import the Node export):

| Field | Value | HTML |
|-------|--------|------|
| `d.error_code` | missing | skip |
| `d.data` | plain object | kept |
| `data.error_code` | `"OVERLAY_STANDBY"` | `raw = "OVERLAY_STANDBY"` |
| `indexOf("OVERLAY_STANDBY")` | hit | `code = "OVERLAY_STANDBY"` |
| `labels[code]` | `"侧栏占用了输入"` | **this is what `setStatus` gets** |

`data.error_code` first is sufficient for the real router shape. The `indexOf`/`includes` fold is belt-and-suspenders for a payload that only had the English `error` sentence. r1’s dead lookup (`code = d.error || d.error_code` → full English sentence as key) is gone from both copies.

Claim HTTP: `selectThread` now `setStatus(statusFromEvent(d))` when `d.error` / `error_code` / `composer.lease.error` (`:656-657`). `LEASE_REV_MISMATCH` is both top-level `error_code` and exact `error` key → 「侧栏占用了输入」, not the identifier. `composer.lease.error` is **not** in the SSE allowlist — claim stays request/response (`dispatchSummonerWeb` does not fire-and-forget lease). Correct channel.

### Is the tested function the paint function?

**No — twin.** `[inspected]` Same finding as r2. `summonerWebEventStatus` is exported and unit-tested. HTML does **not** call it. Live paint is grepped (`summoner-web.test.ts:125-127`: `/侧栏占用了输入/`, `/data\.error_code/`, `/statusFromEvent/`).

r1’s allowed fix was: assert the HTML mapping, **or** extract the label function. They extracted **and** rewrote HTML. For the required object the two implementations agree (hand-walked). That **closes B1**. The twin is a nit (N10), not a leftover blocker: a later HTML-only edit can re-kill DoD 4 while the TS test stays green.

Small twins, not behavioral for this shape:

- TS rejects array `data`; HTML treats arrays as objects (`typeof [] === "object"`). Router `data` is a plain object.
- TS `includes` vs HTML `indexOf`.
- TS does not substring-fold `LEASE_HOLDER_SURFACE_MISMATCH`; both have an exact label key. Production claim mismatch uses exact `error` + `error_code` (`composer-lease.ts:172-176`).

`send()` HTTP still `setStatus(d.error)` (`:715`) and does **not** use `statusFromEvent`. Overlay create/steer/abort/upload HTTP is `{ type: "accepted" }` (`menu-bar-agent.ts:1200-1207`), so `OVERLAY_STANDBY` does not ride that branch. Residual honesty if fire-and-forget is later turned into `sendAppRequest` (r2 N11) — not a hole in this commit.

Tray-process order also makes the bad race (SSE occupancy then HTTP `已提交` overwriting it) implausible: `sendAppMessage` then `jsonResponse({ type: "accepted" })` happen **before** companion `handleMessage` can return `leaseErr`. Occupancy SSE is generated after that HTTP write. Desired sequence is `已提交` then 「侧栏占用了输入」.

### B1 verdict

**Closed.** DoD 4 copy is reachable for the real `chat.error` gate. The test is the router literal, not `error: "OVERLAY_STANDBY"`. HTML paint for that object is 「侧栏占用了输入」, not the English sentence. Spec P2 sentence *Lease claim failure surfaces 「侧栏占用了输入」* is met on both the send-occupancy SSE path and the claim-mismatch HTTP path.

---

## Must-falsify 2 — SSE still forwarding confirm chrome?

**No.** `[inspected]`

`pushSummonerWebEvent` (`summoner-web.ts:195-209`):

1. Rejects non-objects / arrays.
2. Exact `SUMMONER_WEB_EVENT_ALLOW.has(type)` — `security.confirmation.request` is **not** a member (Set `:32-48`; test `:355`).
3. Extra `/confirm/i` drop unless `type === "mcp.confirm.pending"`.
4. **Then** `JSON.stringify`. Confirm frames are not serialized onto the SSE wire.

Live SSE socket test (`summoner-web.test.ts:353-404`): GET `/api/events?token=` → `Content-Type` `text/event-stream`; `pushSummonerWebEvent({ type: "security.confirmation.request", toolName: "evaluate", summary: "Allow this?" })` returns `false`; subsequent `run_active` `error` is in the buffer; buffer `doesNotMatch` `/security.confirmation.request/` and `/Allow this/`.

Outbound MCP L2 still fans `security.confirmation.request` to every authenticated WS, including summoner (`l2-admission` path as r1 cited). Tray `onAppMessage` will see it. SSE still drops it. CU `computer.task.event` JPEGs ride `broadcastToClients` (`lifecycle.ts:353-364`) — also **not** in the allowlist. `hud.spike.show_confirm` is absent from the Set; even a later add would hit `/confirm/i` (substring `confirm`).

`mcp.confirm.pending` **is** forwarded. Producer (`mcp/dispatch.ts:72-75`) is `{ type, message: overlayNotice }` with `MCP_OVERLAY_CONFIRM_NOTICE` (“需在 Chrome 侧栏批准…召唤器不能代替侧栏点批准”) (`confirm-target.ts:6-7,26`). HTML paints `setStatus` only (`summoner-web.ts:800-802`). No Allow/Deny buttons, no `confirmation_id`, no preview. This is the S21 overlay notice, not confirm chrome. Spec parenthetical for P2 is `security.confirmation.request never forwarded`.

HTML composer is 发送/纠偏/排队/停止 (`:565-568`). Badge is 「本页不代替侧栏批准」 (`:546`) — disclaimer, not a control. Test `doesNotMatch` `/允许|拒绝|Allow|Deny|确认/` on the HTML body (`summoner-web.test.ts:129`). No `WebSocket` / `ws://` (`:130`).

`4e61b9f` does not add types, does not move the regex, does not stringify earlier. No new L2 dialect.

---

## Must-falsify 3 — WS Origin widened?

**No.** `[inspected]`

`isAllowedWsOrigin` (`lifecycle.ts:196-208`) is still: `chrome-extension://[A-Za-z0-9_-]+` **or** exact `cmspark-tray://local`; everything else `false`. No `http://127.0.0.1` / `localhost` / overlay port.

Tests still reject loopback HTML as a WS origin: `summoner-web.test.ts:434-437` (`http://127.0.0.1:23403`, `http://localhost:23403`); `ws-origin.test.ts:16-29` already rejects `http://127.0.0.1:23401`. HTML CSP `connect-src 'self'` (`summoner-web.ts:338`) would block companion `:23401` even if a later script added a `WebSocket`.

`4e61b9f` COMMIT_EDITMSG + HEAD sources: mapper + HTML twin + mapper test. `lifecycle.ts` predicate is the long-standing two-origin gate (comment still P0-2 / audit C1). Page still `fetch` + `EventSource` only.

---

## DoD vs production (Pi)

| # | Observable | r1 | r2 | Pi |
|---|------------|----|----|----|
| 1 | GET `/api/events` requires token+Host; CT `text/event-stream` | pass | not re-opened | **confirm** `:302-313,349-366`; test `:348-366` |
| 2 | allowlist forwards `run_active`/`error`/`chat.*`; drops `security.confirmation.request` | pass | same | **confirm** Set `:32-48` + regex `:199` + stringify after; live socket test `:353-404` |
| 3 | `accepted` paints **已提交**; **已发送** only after `chat.user` (or steer/enqueue) | pass | same | **confirm** HTTP `:715-716`; SSE `:791-794`; test forbids old `mode==="enqueue"?"已排队"` lie `:128` |
| 4 | Occupancy / lease miss surfaces **侧栏占用了输入** | **FAIL** | **pass** | **confirm** — real `chat.error` + `data.error_code` on SSE; claim HTTP `statusFromEvent` |
| 5 | Malformed `?token=%` → 403 not hang | pass | same | **confirm** parseQuery inside try `:297-308`; test `:134-137` |
| 6 | `isAllowedWsOrigin` still rejects `http://127.0.0.1` | pass | same | **confirm** `lifecycle.ts:196-208`; tests `:434-437` + `ws-origin.test.ts` |
| 7 | No Allow/Deny/确认 chrome in HTML | pass | same | **confirm** composer + badge; test `:129`; `mcp.confirm.pending` is notice-only |
| 8 | `menu-bar` `onAppMessage` calls `pushSummonerWebEvent` | pass | same | **confirm** `menu-bar-agent.ts:1418-1421`; test grep `:466` |

No Trust / WS-Origin / confirm-chrome DoD miss. B1 is not dead.

---

## Attack results

| Threat | Pi |
|--------|----|
| Confirm/Trust on SSE | **blocked** (allowlist + `/confirm/i`, stringify after). Live socket test drops `security.confirmation.request` / `Allow this`. |
| New confirm type / chrome from `4e61b9f` | **no** — status-text remap only |
| WS Origin widened | **no** — still chrome-extension ∪ `cmspark-tray://local` |
| Overlay Allow/Deny DOM | **absent** |
| Token in EventSource URL | **yes, inherent**; `Referrer-Policy: no-referrer` on HTML + SSE; CSP `connect-src 'self'` |
| GET `/api/events` Origin | **not checked**; SSE has no ACAO; OPTIONS ACAO is fixed loopback, non-reflecting |
| DoD 4 Chinese copy | **user-visible** for `{ type:"chat.error", error:"OVERLAY_STANDBY: …", data:{ error_code:"OVERLAY_STANDBY" } }` `[inspected]` |
| Mapper test vs HTML twin | test hits TS; HTML hand-walked equivalent; grep-only for the page |

---

## Carried findings (still true; not blockers)

Same IDs as r1/r2 unless noted. Pi does not promote any of these to REJECT: B1 is closed and Trust/WS Origin are not weakened.

### MAJOR (unchanged)

**M1 — `SUMMONER_WEB_EVENT_ALLOW` is not frozen; tests only probe two memberships.** Still `summoner-web.test.ts:354-355`. Set still includes `tool.start` / `mcp.confirm.pending` / `run_status`. Snapshot + explicit absences (`computer.task.event` / `config.updated` / `security.confirmation.*` / `hud.spike.show_confirm`) still missing. A later one-line add of `computer.task.event` would dump CU JPEGs onto loopback HTML (`broadcastToClients` already fans them to the summoner WS).

**M2 — Type-only forward, full payload.** `data: ${JSON.stringify(msg)}` unchanged. Safe while confirm types never reach stringify. Do not grow payloads.

### Nits

**N1 — GET `/api/events` does not check Origin.** POST-only (`:325-327`). CORS still non-reflecting / SSE has no ACAO. Foreign-origin JS cannot read the stream even with a stolen token.

**N2 — EventSource token in query.** Inherent (`EventSource` cannot set headers). `no-referrer` still on HTML + SSE.

**N3 — `MAX_SSE_CLIENTS = 4` untested.** Fifth GET → 429 (`:350-352`) in source; no assertion.

**N4 — `/confirm/i` exception for `mcp.confirm.pending` is a footgun.** Today payload is a notice string (`dispatch.ts:72-75`). Do not later attach `confirmation_id` / preview / actions to that type.

**N5 — SSE client does not filter `thread_id` on `chat.user`.** Unchanged (`:791-798`). Overlay `sendToExtension` is origin-socket scoped, so panel-originated `chat.user` should not land here. Cheap: skip foreign `thread_id`.

**N6 — 30 min idle timer ignores a live SSE.** `lastAccessTime` still on new HTTP (`:252`), not `pushSummonerWebEvent`.

**N7 — `run_status` allowlist entry has no producer.** HTML handles it (`:804-808`). Busy SoT is still 1.2s `/api/thread` poll plus `chat.done`/`chat.aborted`.

**N8 — Dispatch `{ ...payload, type }` (type last).** Unchanged (`:159`), still good. Keep reconstructing HTTP bodies.

**N9 — Tests are still partly source-grep.** Improved: B1 now has a real mapper unit test against the router literal. Still grep: HTML `statusFromEvent`, tray `pushSummonerWebEvent` lock (`:461-466`), Allow/Deny absence. Cannot see ACL / lease steal / confirm fan-out end-to-end.

**N10 — HTML `statusFromEvent` is a hand-copied twin of `summonerWebEventStatus`.** From `4e61b9f`. DoD 4 live path is the twin. Keep them lock-step or generate the page helper from the exported function. Prefer exact `error_code` over substring `includes`/`indexOf` (copy-collision if some other companion `chat.error` English `error` contains the token). Overlay still cannot Allow/Deny; that collision is copy, not Trust.

**N11 — `send()` HTTP errors still paint raw `d.error`.** Residual, not this commit’s regression. Overlay send is accepted+SSE today.

Pi does **not** add a new blocker. One precision note r2 did not spell out: native Swift `mapChatMessageToSummonerCmd` for `type === "chat.error"` still surfaces the English `m.error` as `message` while taking `error_code` from `data` (`summoner/client.ts:321-335`; test `:148-159`). C-thin P2 surface is the **HTML** shell; Swift NSPanel is spec-non-goal this slice. Out of B1 scope.

---

## Trajectory

Slice matches spec P2: loopback SSE, confirm request dropped, `accepted` ≠ 已发送, occupancy copy now keys the **actual** gate object.

`4e61b9f` is mapping-only. It does not reopen DoD 1–3, 5–8. It does not widen WS Origin. It does not forward confirm chrome.

TDD: mapper test is a direct call with the router literal. It is not an EventSource DOM assertion and not an HTML-eval of `statusFromEvent`. Good enough to close B1 given the twin was rewritten in the same commit and hand-walks the same object. Not good enough to prevent a future HTML-only drift (N10).

Dead path from r1: `labels.OVERLAY_STANDBY` is **live** in both copies. `run_status` event type is still dead.

---

## Component (file:line)

| Gate | Location |
|------|----------|
| Node mapper (tested) | `companion/src/summoner-web.ts:166-193` |
| HTML mapper (live SSE / claim) | `companion/src/summoner-web.ts:656-657,766-788` |
| Mapper test (router shape) | `companion/tests/summoner-web.test.ts:411-432` |
| Event allowlist / confirm drop / stringify after | `companion/src/summoner-web.ts:32-48,195-200` |
| SSE CT + cap + token/Host | `companion/src/summoner-web.ts:50-51,302-313,349-366` |
| POST Origin only | `companion/src/summoner-web.ts:110-117,325-327` |
| CSP `connect-src 'self'` | `companion/src/summoner-web.ts:338` |
| Fire-and-forget `accepted` | `companion/src/menu-bar-agent.ts:1200-1207` |
| `onAppMessage` fan-in | `companion/src/menu-bar-agent.ts:1418-1421` |
| `sendAppMessage` has no `id` | `companion/src/tray/companion-client.ts:440-447` |
| Unmatched WS → `appMessageCbs` | `companion/src/tray/companion-client.ts:528-538,575-579` |
| Origin-socket return of `leaseErr` | `companion/src/ws/lifecycle.ts:1277-1280,1329-1334` |
| WS Origin | `companion/src/ws/lifecycle.ts:196-208` (untouched) |
| Broadcast (CU JPEG / config) | `companion/src/ws/lifecycle.ts:353-364` |
| OVERLAY_STANDBY gate shape | `companion/src/ws/composer-lease.ts:30-35,100-145` |
| Claim mismatch shape | `companion/src/ws/composer-lease.ts:185-190` |
| Router returns `leaseErr` unwrapped | `companion/src/message-router.ts:333-334,582-583,606-607` |
| MCP overlay notice (not chrome) | `companion/src/mcp/dispatch.ts:72-75`; `confirm-target.ts:6-27` |

---

## ADR-020 / P1 watchlist (this slice)

| ID | At `4e61b9f` |
|----|----------------|
| P1-1 god-mode / `config.set` | **not reachable** from HTML (404 + ACL deny); `config.updated` not in SSE allowlist |
| P1-2 `originWs` | **not touched** — no new `securityConfirmations.request`. Overlay-originated non-MCP L2 still binds summoner `ws`; SSE drop means HTML does not show it. MCP inbound still retargets panel + notice. |
| P1-3 evaluate | **not touched** |
| P1-4 shell | **not touched** |
| Confirm dialects | none in HTML. `mcp.confirm.pending` is a status notice. |
| Trust monotonicity | overlay cannot confirm; notice only |
| WS Origin | not widened |

---

## Verdict rationale

r1 REJECT was correct on `d81444c`: DoD 4 copy was dead. r2 APPROVE_WITH_NITS is correct on `4e61b9f`: the mapper keys `data.error_code` of the **real** `ChatCreateLeaseError`, the test uses that object, and the HTML twin hand-walks to 「侧栏占用了输入」.

Pi did not rubber-stamp r2. Independent walk: type definition → `gateChatCreateOnLease` → unwrapped router return → no-`id` fire-and-forget → origin `ws.send` → `appMessageCbs` (because no pending id) → allowlisted `pushSummonerWebEvent` → HTML `statusFromEvent` field order. Confirm chrome still dies before stringify. `isAllowedWsOrigin` is still two predicates + false.

REJECT conditions from the gate prompt are **not** met. Residual nits (unfrozen allowlist, type-only payload, HTML twin, GET Origin, cap untested) stay nits.

VERDICT: APPROVE_WITH_NITS
