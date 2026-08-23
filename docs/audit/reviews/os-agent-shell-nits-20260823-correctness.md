# OS Agent Shell — independent CORRECTNESS review (nits round)

**Date**: 2026-08-23  
**Lane**: CORRECTNESS (adversarial, independent)  
**Branch**: `feat/os-agent-shell` (`659bbce` + dirty working tree)  
**Scope**: overlay session races (close vs hydrate vs submit vs new-thread), exclusive claim, abandoned claim vs `sendChatCreate`, `summonerThreadId` assignment, `overlaySessionIsLive` after close, `broadcastOverlayLeasesOnSocketClose`, Swift `SummonerController.applyHydrate` must not `open()`. Tests that actually fail if the bug returns vs grep-theater.  
**Not read**: other lane reports, merge-prep adversary/pi files.  
**Not modified**: production code.

Evidence tags: `[executed]` ran code / tests; `[inspected]` read the path; `[assumed]` not verified.

---

## Machine `[executed]`

Required commands, this session:

```
cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json --pretty false
# exit 0

node --test .test-dist/tests/overlay-session.test.js \
  .test-dist/tests/composer-lease.test.js \
  .test-dist/tests/summoner-talk.test.js \
  .test-dist/tests/summoner-overlay.test.js
# 84 pass / 0 fail

cd chrome-extension && node --test .test-dist/tests/overlay-standby.test.js
# 18 pass / 0 fail  (tsc -p tsconfig.test.json also exit 0; not in the required list)
```

Green is **not** proof the hunt items are closed. A throwaway driver against compiled `overlay-session.js` reproduces P1-1 while the suite stays green (below).

---

## Hunt results

| Invariant | Result | Evidence |
|-----------|--------|----------|
| Exclusive overlay claim (T2 demotes T1) | **PASS** at registry / CAS / `released_siblings` | `[executed]` `composer-lease.test.ts` exclusive + sibling broadcast payload; `[inspected]` `ComposerLeaseRegistry.claim` → `releaseAllOverlay(except)` |
| Abandoned claim must not `sendChatCreate` | **PASS** on the talk helper; **wiring is grep** | `[executed]` `submitSummonerTalk skips chat.create when claimLease returns false`; `[inspected]` `handleSummonerSubmit` feeds `claimOverlayIfLive` into that helper |
| `summonerThreadId` only on claimed | **PASS** on hydrate / new-thread; leftover id after close | `[inspected]` `hydrateSummonerThread` / `handleSummonerNewThread` assign only on claimed; `handleSummonerClosed` does **not** clear the id |
| `overlaySessionIsLive` after close is false | **PASS** | `[executed]` overlay-session tests; `[inspected]` `handleSummonerClosed` calls `invalidateOverlaySession()` first |
| `broadcastOverlayLeasesOnSocketClose` | **PASS** helper; **lifecycle call is grep** | `[executed]` helper emits `composer.lease` per hold, tray surface is a no-op; `[inspected]` `lifecycle.ts` close uses `closedAuth?.surface` after capturing auth |
| Swift `applyHydrate` must not `open()` | **PASS** (SummonerController) | `[inspected]` `guard isOpen else { return }`; no `open(`; `[executed]` source grep in `summoner-talk.test.ts` |
| close vs hydrate vs submit vs new-thread | **FAIL** | P1-1 overlapping generation + `releaseAll`; P1-2 session not live until after ready I/O |

---

## P1-1 — abandoned claim `releaseAll` clobbers a newer live overlay session

**Invariant broken:** overlay still open (newer generation `live === true`) but an abandoned older hydrate/submit drops **every** overlay hold, including the one the new generation just took or is about to take.

`hydrateOverlayIfLive` / `claimOverlayIfLive` always `releaseAll` when the **caller's** token is stale, without asking whether a **newer** session is live:

```42:57:companion/src/summoner/overlay-session.ts
  await args.claimLease(args.id)
  if (overlaySessionIsLive(args.token)) return "claimed"
  await args.releaseAllLeases()
  return "abandoned"
}

export async function claimOverlayIfLive(args: {
  token: number
  claim: () => Promise<void>
  releaseAll: () => Promise<void>
}): Promise<boolean> {
  if (!overlaySessionIsLive(args.token)) return false
  await args.claim()
  if (overlaySessionIsLive(args.token)) return true
  await args.releaseAll()
  return false
}
```

`hydrateSummonerThread` and `handleSummonerNewThread` call `beginOverlaySession()` on every invocation (`menu-bar-agent.ts:638`, `:973`). That is load-bearing: it makes the previous in-flight hydrate return `"abandoned"` so it will not write `summonerThreadId`. Combined with unconditional `releaseAll`, it is also how a still-open overlay loses the exclusive lease.

**Plausible interleaving (same overlay, user action):**

1. Select / 1-hit search hydrates T1. `selectMessages` done, `claimOverlayComposerLease(T1)` in flight.
2. User clicks another hit or **新对话**. Second call `beginOverlaySession()` (gen N+1, live).
3. T1 claim RPC completes. Token N is dead → `releaseAllOverlayComposerLeases()`.
4. T2 / new-thread claim RPC completes (or already completed). Server then processes `release_overlay` → holder `panel` on the thread the user is looking at.

Single-threaded JS does **not** save this: both hydrates are concurrent `async` functions; both `CompanionClient.sendRequest` pipelines are in flight. Last WS mutation wins. `release_overlay` is the nuclear mutation.

**`[executed]` driver** (compiled helper, not in the suite):

```
hydrate-abandon-after-newer-begin: { result:"abandoned", releaseAll:1, firstLive:false, currentLive:true }
claim-abandon-after-newer-begin:   { ok:false, releaseAll:1, newerLive:true }
```

A newer session is live and the abandoned path still released. If this were a test, it would **fail today**. Existing overlay-session tests do not cover it:

- `"close during claim releases"` — invalidates (`live=false`), so `releaseAll` is correct.
- `"second beginOverlaySession invalidates the first in-flight hydrate"` — **name theater**: only asserts tokens, never runs `hydrateOverlayIfLive`.

**Blast:** Side Panel `OVERLAY_STANDBY` clears (broadcast `holder=panel`) while the summoner window is still up; overlay `chat.create` is then denied `OVERLAY_STANDBY` / `holder=panel`. User cannot type on either surface until something claims again.

**Fix shape (do not implement here):**

```ts
await args.claimLease(args.id)
if (overlaySessionIsLive(args.token)) return "claimed"
if (!overlaySessionIsLive(currentOverlaySession())) {
  await args.releaseAllLeases()
}
return "abandoned"
```

Same for `claimOverlayIfLive`. Close path (`invalidate` → `live=false`) still releases. Newer `beginOverlaySession` does not.

`handleSummonerClosed` (`:698-703`) is a weaker cousin: `invalidate` then `await releaseAll` with no generation check. Esc-then-hotkey on one socket usually sends `release_overlay` *before* the new claim (closed handler starts first), so that path is less likely than P1-1. Still unserialized.

---

## P1-2 — overlay visible, session not live: first submit is a silent no-op

**Invariant broken:** Swift overlay is open and can send `summoner.submit` before Node has a live overlay generation, so `claimOverlayIfLive` returns false and `submitSummonerTalk` never `sendChatCreate`.

- `beginOverlaySession()` is **not** called from `handleSummonerReady`. Ready awaits `listThreads()` first (`:682`), then `hydrateSummonerThread` / `handleSummonerNewThread` begin the generation.
- `handleSummonerSubmit` captures `currentOverlaySession()` at entry (`:727`) and requires `overlaySessionIsLive(token)`.
- After close, `invalidateOverlaySession()` leaves `live=false`. The next open has the same gap until ready's I/O finishes.
- Cold start: `generation=0`, `live=false`. Same.

Swift `open()` already `makeFirstResponder(composer)` and emits `summoner.ready` (`Tray.swift:1608-1615`). Empty-overlay talk is the v2 journey. The message is dropped with no `summoner.error`.

Even if ready began a token at entry, `hydrateSummonerThread` **always** `beginOverlaySession()` again, which would kill a submit that captured the ready token. Ready-begin without reusing a live token is not sufficient.

`[inspected]` only — no behavioral test of `handleSummonerReady` + `handleSummonerSubmit`. The submit live-check test is grep (`summoner-overlay.test.ts` `currentOverlaySession` + `claimOverlayIfLive`).

---

## What actually holds

### Exclusive claim — PASS `[executed]` + `[inspected]`

`ComposerLeaseRegistry.claim` writes the new overlay hold then `releaseAllOverlay(exceptThreadId)`. Tests that **would fail** if exclusivity were a caller courtesy:

- `overlay claim is exclusive: claiming T2 demotes T1 overlay hold`
- `claimOverlayLeaseCas exclusive claim demotes prior overlay thread`
- `composer.lease.claim overlay response includes released_siblings`
- `panel chat.create is OVERLAY_STANDBY on old thread until exclusive switch`

`message-router.ts` broadcasts the new hold and each sibling as `composer.lease`. That loop is **grep-only** (`released_siblings` / `release_overlay`). Would not fail if broadcast dropped siblings.

### Abandoned claim vs `sendChatCreate` — PASS on helper `[executed]`

```149:151:companion/src/summoner/client.ts
  const claimed = await deps.claimLease(id)
  if (claimed === false) return { ok: false, threadId: null }
  const ok = deps.sendChatCreate({ thread_id: id, message })
```

`handleSummonerSubmit` returns `claimOverlayIfLive`'s boolean as `claimed`. Close before/during claim → no `sendChatCreate`. After `claimOverlayIfLive` returns true, `sendChatCreate` is synchronous; close cannot sneak in on the same turn. That TOCTOU is not a real hole on this event loop.

Gap: `CompanionClient.claimOverlayComposerLease` is `Promise<void>` and swallows CAS failure (`companion-client.ts:345-351`). Void is not `false`, so a failed lease still sends. Overlay then gets `OVERLAY_STANDBY`. P2, not the abandoned-close case.

### `summonerThreadId` only on claimed — mostly PASS `[inspected]`

| Path | Assigns only if claimed? |
|------|--------------------------|
| `hydrateSummonerThread` | yes (`result !== "claimed"` → return) |
| `handleSummonerNewThread` | yes |
| `handleSummonerSearch` 1-hit | yes (via hydrate); grep forbids `summonerThreadId = cmd.hits[0].id` — **would fail if silent swap returned** |
| `handleSummonerSubmit` | sets on `result.ok && result.threadId` (helper nulls id when claim is false) |
| `handleSummonerClosed` | **does not clear**; Continue (`:719-721`) does not check `overlaySessionIsLive` |

Leftover identity after close is a P2. Continue on a closed overlay is denied by the lease gate once `releaseAll` lands; during reopen hydrate it can still `chat.create` at the stale id.

### `overlaySessionIsLive` after close — PASS `[executed]`

`invalidateOverlaySession` bumps generation and sets `live=false`. `overlaySessionIsLive(currentOverlaySession())` is then false. Tests:

- `after close, currentOverlaySession token is not live`
- `submit-style claimOverlayIfLive no-ops after close`
- `close during thread.select does not claim overlay lease`

`handleSummonerClosed` invalidates **before** the release RPC `[inspected]`. The grep test only asserts the identifier appears in the function body — swapping order would stay green and reopen the original close-during-hydrate leak.

### `broadcastOverlayLeasesOnSocketClose` — PASS helper `[executed]`

Releases only when `surface === "summoner"`, emits one `composer.lease` per hold (`holder=panel`), tray close is a no-op. Lifecycle:

```1348:1353:companion/src/ws/lifecycle.ts
      const closedAuth = wsAuth.get(ws)
      if (closedAuth) {
        clearTimeout(closedAuth.timer)
        wsAuth.delete(ws)
      }
      broadcastOverlayLeasesOnSocketClose(closedAuth?.surface, (msg) => broadcastToClients(msg))
```

Surface is captured before `wsAuth.delete`. Summoner client handshake is `surface: "summoner"` (`menu-bar-agent.ts:1274-1280`, `companion-client.ts:561`). Lifecycle **wiring** test is a file-level `/broadcastOverlayLeasesOnSocketClose/` match — would pass if invoked with a hardcoded `"tray"` or after losing `closedAuth`.

### Swift `applyHydrate` must not `open()` — PASS `[inspected]` + grep that would fail

`SummonerController.applyHydrate` (`Tray.swift:1625-1641`): first line `guard isOpen else { return }`. No `open(`, no `makeKeyAndOrderFront`. Closed overlay + late `summoner.hydrate` stdin is a no-op (does not emit `summoner.ready`).

HUD `applyHydrate` (`:1058`) also does not `open()`; HUD reopen is `showConfirm` (`:1114-1116`), different window. The test correctly targets the **second** `applyHydrate` in the file. `assert.doesNotMatch(/open\(threadId/)` **would fail** if SummonerController grew `open(threadId:)`. Fragile if a third `applyHydrate` is inserted ahead of Summoner (test would audit HUD). Acceptable for Swift-in-node.

---

## Test theater matrix (required files)

| Test | Kind | Fails if bug returns? |
|------|------|------------------------|
| overlay-session: close during select / close during claim / live hydrate / after close not live / submit no-op after close | behavioral | **Yes** — H1 close-during-select/claim |
| overlay-session: "second begin invalidates in-flight hydrate" | token only | **No** — does not run hydrate; P1-1 stays green |
| overlay-session: abandon + newer `begin` must not `releaseAll` | **missing** | would fail **now** `[executed]` |
| composer-lease exclusive / siblings / `release_overlay` / socket-close helper / CAS retry | behavioral | **Yes** |
| composer-lease `message-router` / `lifecycle` stamp | grep | **No** — siblings could stop broadcasting |
| `submitSummonerTalk` claim false ⇒ no chat.create | behavioral | **Yes** for the helper |
| summoner-talk / overlay: `handleSummonerSubmit` live check | grep | **No** — does not run submit vs ready/close; does not lock `summonerThreadId` |
| summoner-overlay: close `releaseAll` + no early `!id` return | grep | **Yes** for the stale-id early-return; **No** for invalidate-before-release order |
| summoner-overlay: 1-hit hydrates, not `summonerThreadId = hits[0]` | grep | **Yes** for that exact regression |
| summoner-overlay: lifecycle `broadcastOverlayLeasesOnSocketClose` | grep | **No** for wrong surface / lost auth |
| summoner-talk: Summoner `applyHydrate` guard + no `open(threadId` | grep | **Yes** for `open(threadId` resurrection |
| overlay-standby: `overlayStandbyFromError` + reducer SET/CLEAR/ADD_MESSAGE | behavioral | **Yes** |
| overlay-standby: `APPLY_COMPOSER_LEASE` | reducer only | **Partial** — reducer **ignores `threadId`**; thread gate lives in `useWebSocket` (`shouldApplyStreamEvent`) and is **not asserted** in the composer.lease grep |
| overlay-standby: `chat.error` / `composer.lease` / InputArea | grep | **No** if thread gate is removed from the lease case |

`handleSummonerReady` + `handleSummonerSubmit` have **zero** behavioral coverage. Journeys (`summoner-journeys.test.ts`) exercise `submitSummonerTalk` with a claim that always succeeds — they do not instantiate overlay-session tokens.

---

## P2 / nits (non-blocking for this lane's hunt, still real)

1. **`claimOverlayComposerLease` swallows CAS and returns void** — live session + failed claim still `sendChatCreate`. `[inspected]`
2. **`summonerThreadId` survives close**; `handleSummonerContinue` does not check `overlaySessionIsLive`. `[inspected]`
3. **`APPLY_COMPOSER_LEASE` reducer ignores `threadId`**. Hook filters; a misfired dispatch standbys the wrong thread. `[inspected]`
4. **`handleSummonerClosed` invalidate order is not locked** by tests (see theater). Production order is currently correct.
5. Out of hunt but adjacent: `shouldStartNewSummonerThread` ignores `now` / `lastActivityAt` except `resumeIdleMinutes === 0` (`client.ts:186-193`). `summoner-client.test.ts` expects the 10min+1 case to be `false` — tests encode the stub, so idle-new never fails the suite. `[inspected]` (not in the required run list)

---

## Tests that must exist before this lane can approve

These are the tests that would have gone red on this tree:

```ts
// overlay-session.test.ts — P1-1
test("abandoned hydrate must not releaseAll if a newer session is live", async () => {
  invalidateOverlaySession()
  const first = beginOverlaySession()
  let released = 0
  const result = await hydrateOverlayIfLive({
    id: "t1",
    token: first,
    selectMessages: async () => [{ role: "user", content: "hi" }],
    applyHydrate: () => {},
    claimLease: async () => { beginOverlaySession() },
    releaseAllLeases: async () => { released += 1 },
  })
  assert.equal(result, "abandoned")
  assert.equal(released, 0) // today: 1
  assert.equal(overlaySessionIsLive(currentOverlaySession()), true)
})

test("abandoned claimOverlayIfLive must not releaseAll if a newer session is live", async () => {
  invalidateOverlaySession()
  const token = beginOverlaySession()
  let released = 0
  const ok = await claimOverlayIfLive({
    token,
    claim: async () => { beginOverlaySession() },
    releaseAll: async () => { released += 1 },
  })
  assert.equal(ok, false)
  assert.equal(released, 0) // today: 1
})
```

Also needed (not executed here, would currently fail on the agent if extracted):

- `handleSummonerSubmit` during `handleSummonerReady`'s `listThreads` await does not `sendChatCreate`; after a live begin, it does.
- `handleSummonerClosed` body starts with `invalidateOverlaySession()` **before** any `await` (order, not identifier presence).
- `hydrateSummonerThread` does not assign `summonerThreadId` when result is `"abandoned"` (behavioral, not grep).

---

## Verdict rationale

Exclusive SoT, close-during-select, close-during-claim, `sendChatCreate` gated on `claimLease === false`, Swift `applyHydrate` not reopening, and summoner-socket lease broadcast **helpers** are in good shape and have tests that would fail if those specific bugs returned.

That is not enough. The generation token was added to cancel in-flight hydrate/claim, but the abandon path still `releaseAll`s while a newer overlay session is live — **proven `[executed]`**, untested, and hit by normal select / new-thread overlap. Ready also leaves the window open with `live=false`, so empty-overlay talk can vanish. Required suites are green because those paths are grep or missing.

Do not treat 84+18 pass as closeout.

VERDICT: REJECT
