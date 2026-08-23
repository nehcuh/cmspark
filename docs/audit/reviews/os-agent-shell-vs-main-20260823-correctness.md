# OS Agent Shell vs origin/main — CORRECTNESS (adversarial)

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Reviewer | independent CORRECTNESS pass (hostile to grep-theater) |
| Scope | HEAD `659bbce` + dirty tree vs `origin/main` `fc18725` |
| Branch | `feat/os-agent-shell` (ahead of origin/feat by 1; uncommitted + untracked) |
| Spec | Brief v2.1 §5 attach / §9 edges / §10 typed errors / §11 P0 · [journeys](../../superpowers/specs/2026-08-23-os-agent-shell-user-journeys.md) |
| Isolation | source untouched; this file only; prior `os-agent-shell-20260823-*` reviews not read |

**Routing override.** `vibe route` suggested a fallback-llm squad. Unsuitable: this task is a read-only vs-main hunt with a fixed write path and a machine-evidence command list. Executed the user brief instead.

---

## Machine evidence

Workspace: `/Users/huchen/Projects/cmspark`  
Node: `v24.16.0` (nvm). Commands run on dirty tree after `npx tsc -p tsconfig.test.json`.

| Step | Command | Exit |
|------|---------|------|
| companion tsc | `cd companion && npx tsc -p tsconfig.test.json --pretty false` | **0** `[executed]` |
| companion tests | `node --test .test-dist/tests/summoner-*.test.js .test-dist/tests/composer-lease.test.js .test-dist/tests/l1-actuator.test.js .test-dist/tests/l2-conductor.test.js .test-dist/tests/companion-ui-rects.test.js .test-dist/tests/computer-self-ui.test.js .test-dist/tests/classify-error-browser-unavailable.test.js` | **0** `[executed]` — 156 pass / 0 fail |
| chrome-extension tsc | `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false` | **0** `[executed]` |
| overlay-standby | `node --test .test-dist/tests/overlay-standby.test.js` | **0** `[executed]` — 18 pass / 0 fail |

SHA pin vs binary `[executed]`:

```
pin (dirty swift-tray-bridge.ts)  8b1d06196d7e8786fb27c360a74d320ab13f8e8a6f86ce8caabfa22cbcea73a9
shasum -a 256 companion/dist/cmspark-tray
                                 8b1d06196d7e8786fb27c360a74d320ab13f8e8a6f86ce8caabfa22cbcea73a9
HEAD pin                         267e24b256459ad0386a2054f710f672fd65994d81b0441437094dbbe310f483
origin/main pin                  ebd1ee4a6ba5d05840c23716368aec8b67a79905466e8a9fc4a26c8c38b589c7
binary mtime                     2026-08-23 19:37:58  size=352624
Tray.swift mtime                 2026-08-23 19:37:26
```

Worktree pin **matches** the on-disk binary. HEAD commit pin is stale relative to dirty `Tray.swift` (expected: SHA lives in the unstaged bridge diff). Comment still says “Updated 2026-08-22”.

Green tests are **not** a ship signal. A large fraction of the 156 are `readFileSync` + `assert.match` on `Tray.swift` / `menu-bar-agent.ts` (see Test-quality).

---

## Spec vs code matrix

Hunt items first, then brief §5 / §9 / §10 / §11.

| # | Requirement | Code | Evidence | Result |
|---|-------------|------|----------|--------|
| H1a | Same-thread first open; idle/missing `last_activity` must **not** auto-create | `resolveSummonerOpenTarget` hydrates last or newest; create only if `forceNew` or empty list. `shouldStartNewSummonerThread` returns true **only** when `resumeIdleMinutes === 0`; `now` / `lastActivityAt` ignored | `[inspected]` `companion/src/summoner/client.ts:185-212` · journeys test “missing last_activity does not create” | **PASS** for first-open resume. **MAJOR** for idle policy (below) |
| H1b | Overlay claim / release / **broadcast** | Claim on hydrate + new-thread; release on close of `summonerThreadId` only; `shouldBroadcastLease` fans successful claim/release to all authenticated WS | `[inspected]` `hydrateSummonerThread` claims; `handleSummonerClosed` releases current id only; `message-router.ts:1042` broadcasts | **BLOCK** — thread switch leaks leases |
| H2 | `#` search = `thread.list` hits; select hydrates | `handleSummonerSearch` → `summonerHitsFromQuery(listThreads())` (uncapped). Swift `selectThread` emits `summoner.select` → `hydrateSummonerThread` | `[inspected]` `menu-bar-agent.ts:744-758` · `Tray.swift:1865-1873` | **PASS** path, **BLOCK** side-effect: 1-hit search mutates `summonerThreadId` without hydrate/claim/release |
| H3 | `chat.token` is snapshot, not delta | Adapter sends `content: assistantContent` (full). Swift `appendToken` replaces last `助手:` while `streamingAssistant` | `[inspected]` `adapter.ts:922` · `Tray.swift:1644-1660` | **PASS** in Swift. TS `overlayAssistantSnapshot` is **dead** and disagrees on first token after an assistant tail |
| H4 | Markdown hard-breaks; stream throttle | CommonMark `\n` → `  \n`; first token paints, later tokens 120ms timer | `[inspected]` `Tray.swift:1670-1676, 2136-2142` | **PASS** (Swift-only; grep-tested) |
| H5 | `L2_CONDUCTOR_ELSEWHERE` produced | `gateChatCreateOnConductor` on summoner `chat.create` when `computerTaskAbort.size > 0`; returned as `chat.error` with `data.error_code` | `[inspected]` `l2-conductor.ts` · `message-router.ts:307-308` · lifecycle always `ws.send`s handleMessage return even without `id` | **PASS** for host_computer LIVE. **NIT**: HUD confirm without a computer task is not LIVE |
| H6 | `error_code` on `chat.error` | `toolChatErrorPayload` top-level; lease/conductor in `data`; `mapChatMessageToSummonerCmd` reads both | `[executed]` classify-error + summoner-client tests · `[inspected]` `adapter.ts:1458` | **PASS** for P0 codes. Panel `overlayStandbyFromError` ignores top-level `error_code` (lease uses `data`, so OK) |
| H7 | Hydrate cap 20 | `hydratePlaintext` `slice(-20)`; Swift `suffix(20)` + `capLines` | `[executed]` hydrate test 50→20 · `[inspected]` `hydrate.ts:24` · `Tray.swift:1630,1780` | **PASS** |
| H8 | Tests theater vs load-bearing | See Test-quality | `[inspected]` | **MAJOR** |
| H9 | Swift SHA pin lockstep with binary | Dirty pin == `dist/cmspark-tray` | `[executed]` shasum | **PASS** in this worktree |
| §5.1 | P0 binary attached/detached; CTA cannot claim to open Side Panel | Badge + `ATTACH_*_COPY` contain `我们不能替你打开侧栏` | `[inspected]` | **PASS** copy. Five-state UI not present (correct P0) |
| §5.3 / 9.10 | No auto-replay of failed L1 | Continue is a new user line `CONTINUE_MESSAGE` | `[inspected]` | **PASS** |
| §5.3 / S19 | No peer → `BROWSER_UNAVAILABLE`, non-retryable | `forwardL1OrUnavailable` skips `forward`; `classifyError` explicit branch | `[executed]` | **PASS** |
| J4 / S20 | Overlay visible ⇒ overlay holds; close ⇒ panel; one writable composer | Per-thread map is correct **until** thread switch | `[inspected]` | **BLOCK** |
| J3 | Select hit clears `#…`, hydrates, focus composer | Swift does; companion also claims new id without releasing old | `[inspected]` | **BLOCK** (lease) |
| §9.13 / N6 | L2 LIVE: overlay must not conduct | Computer-task map only | `[inspected]` | **NIT** vs full N6 |
| §10 | P0 min set: `BROWSER_UNAVAILABLE` + `OVERLAY_STANDBY` + `L2_CONDUCTOR_ELSEWHERE`; strings must not contain `timeout` / `disconnected` / `not found` | All three produced; strings clean | `[inspected]` + `[executed]` | **PASS** |
| §11 | 8+5 user 证伪; IME 5/5; dual-open one writer | Dual-open broken after switch (H1b). 8+5 / IME XCTest not run (journeys §3/§4) | `[assumed]` env | **BLOCK** (dual-open) + residual (human gate) |

---

## BLOCK

### B1 — Composer lease leak on every overlay thread switch (S20 / J3 / J4 / §9.11)

**Spec.** Overlay visible ⇒ overlay holds **the current thread**. Close overlay ⇒ holder=`panel`. Dual-open: exactly one writable composer. Select `#` hit hydrates that thread (J3). Close ≠ abort, but **must** return the lease (J4).

**Bug.** Lease is per-`thread_id`, but the overlay only remembers **one** `summonerThreadId`. Claim is issued on every hydrate / new-thread; release is issued only for the **latest** id.

```627:639:companion/src/menu-bar-agent.ts
async function hydrateSummonerThread(id: string): Promise<void> {
  // ...
  await client.claimOverlayComposerLease(id)
}
```

```678:683:companion/src/menu-bar-agent.ts
export async function handleSummonerClosed(): Promise<void> {
  const client = summonerClient
  const id = summonerThreadId
  if (!client || !id) return
  await client.releaseOverlayComposerLease(id)
}
```

```942:959:companion/src/menu-bar-agent.ts
export async function handleSummonerNewThread(): Promise<boolean> {
  // createThread → hydrate empty → claimOverlayComposerLease(created.id)
  // does not release the previous overlay lease
}
```

```744:751:companion/src/menu-bar-agent.ts
export async function handleSummonerSearch(query: string) {
  const cmd = summonerHitsFromQuery(threads, query)
  trayInstance?.sendSummoner?.(cmd)
  if (cmd.hits.length === 1) {
    summonerThreadId = cmd.hits[0].id   // no hydrate, no claim, no release of A
  }
```

**User-visible failure (P0 dual-open, deterministic):**

1. Overlay opens thread A → claim A → Side Panel A `OVERLAY_STANDBY` (correct).
2. User `#` search, select B **or** click 新对话 → claim B. A stays `holder=overlay`.
3. Close overlay → release **B** only.
4. Side Panel on A remains “这边暂时打不了字，正在召唤器里说” with overlay gone.

J1 explicitly has 新对话. J3 is title search + select. Both are P0 journeys, not corners.

**1-hit search is worse:** `summonerThreadId` jumps to B while Swift `threadId` / on-screen transcript stay on A. Close then releases B (no-op, default panel) and **never** releases A. Continue CTA (`handleSummonerContinue`) also fires `chat.create` at B without an overlay claim → overlay is denied `OVERLAY_STANDBY` holder=`panel` while the user is staring at A.

Broadcast (`shouldBroadcastLease` → `session.broadcast`) is wired `[inspected]` and the panel reducer applies same-thread `composer.lease` `[executed]` overlay-standby tests. The leak is **not** “broadcast missing”; it is “old thread never released”.

No test covers: claim A, claim B, close, `get(A).holder === "panel"`. The CAS tests are single-thread.

**Fix shape (do not implement here):** release-then-claim on thread switch; never retarget `summonerThreadId` on search hits; close must release every overlay-held id, or keep a single “overlay session” id.

---

## MAJOR

### M1 — `resume_idle_minutes` 5/10/30 is a lying control; tests were rewritten to match the stub

```185:192:companion/src/summoner/client.ts
export function shouldStartNewSummonerThread(args: {
  now: number
  lastActivityAt?: number | null
  resumeIdleMinutes: number
}): boolean {
  if (args.resumeIdleMinutes === 0) return true
  return false
}
```

Swift still paints 5/10/30 idle buttons (`resumePolicyClicked`, `encodeSummonerSettings`). Protocol accepts those values. The unit test named “10min idle” asserts **both** `now = 10min` and `now = 10min+1` return `false` (`summoner-client.test.ts:288-297`). That is the first-open “idle not create” lock **plus** a dead product setting, with the test suite now documenting the stub.

First-open same-thread is correct (H1a). Shipping a settings row that cannot fire is a correctness defect vs the UI the binary actually draws.

### M2 — Swift overlay correctness is grep-theater; `overlayAssistantSnapshot` is not on the production path

`companion/tests/summoner-overlay.test.ts` (all 20) and large slices of `summoner-talk.test.ts` / `summoner-client.test.ts` / `composer-lease.test.ts` / `l2-conductor.test.ts` / `chrome-extension/tests/overlay-standby.test.ts` (last 3) only `readFileSync` + regex.

That is how H3/H4/H7 “Swift” coverage is claimed. A rename of `appendToken` or a `+=` sneak would fail the regex; a logic inversion that still contains `助手: " + text` would not.

Worse: `overlayAssistantSnapshot` (named in the hunt) is **unused** by `menu-bar-agent`. Production is Swift `appendToken` with a `streamingAssistant` flag. The TS helper replaces **any** trailing `助手:` line, so the first token after a hydrate that ends on an assistant message would **eat history**. The unit test locks that wrong behavior (`summoner-client.test.ts:102-108`). If Node ever maps tokens through the helper, J2 hydrate+stream regresses.

Load-bearing (keep): lease CAS, `hydratePlaintext` cap, `filterThreadsByTitle` / `summonerHitsFromQuery`, `submitSummonerTalk` order, `classifyError` + `toolChatErrorPayload`, L2 gate function, protocol codecs, overlay-standby **reducer** tests.

### M3 — Ready/close race can claim after hide

`summoner.open` → Swift `jsonLine(summoner.ready)` → async `handleSummonerReady` (list + hydrate + claim). Immediate close: `handleSummonerClosed` no-ops if `summonerThreadId` is still null, then ready claims. Overlay gone, panel standby. Timing-dependent vs B1 (B1 does not need a race).

### M4 — “继续 · {title}” reads the tray 5-cap cache, which drops `title`

`CompanionClient.fetchRecentThreads` maps `title: t.alias || t.id` and `slice(0, 5)`. Overlay `lastThreadCaption` uses that array. `#` search correctly uses uncapped `listThreads()` + real `title`. J1 caption can show a UUID while search shows the human title.

---

## NIT

- **N1** SHA comment date (“2026-08-22”) vs 2026-08-23 rebuild. Pin/binary match; commit-before-rebuild would refuse the tray (existing integrity policy).
- **N2** `overlayStandbyFromError` only reads `data.error_code`, not top-level. Lease/conductor use `data`; adapter BROWSER path is top-level and is for overlay stdin, not this helper.
- **N3** L2 LIVE detector is `getComputerTaskAbortRegistry().size > 0` (deleted in `companion-dispatch` finally). HUD/Cockpit confirm without `host_computer` does not produce `L2_CONDUCTOR_ELSEWHERE` (§9.13 / N6 residual).
- **N4** `patchStreamingLine` in `Tray.swift` is dead; stream path is `scheduleStreamRender` → `refreshLog`.
- **N5** `shouldStartNewSummonerThread` still takes `now` / `lastActivityAt` it ignores (API lie).
- **N6** Removing process-level `cmspark-tray` from `self-ui.ts` (dirty) in favor of window-rect is the S23 P1 path. If `companion.ui.rect` is late, CU can click the overlay until the rect lands. Brief called full hit-test P1; acceptable as residual, not a P0 dual-composer fail.
- **N7** Journeys §4: 8+5 证伪 and IME 5/5 not executed here. Do not treat green `node --test` as §11 pass.

---

## vs origin/main regressions

`origin/main` has no summoner overlay, no `composer.lease`, no `L2_CONDUCTOR_ELSEWHERE`. This is feature-additive, not a silent behavior change of Side Panel chat — except:

| Area | Risk vs main | Notes |
|------|----------------|-------|
| `classifyError` | low | New explicit `BROWSER_UNAVAILABLE` → `non_recoverable`. Other codes unchanged `[inspected]` |
| `chat.error` shape | low | `toolChatErrorPayload` adds optional top-level `error_code` / `error_level`. Panel still uses `msg.error` for bubbles |
| `agentStore` overlay standby | contained | New state; dual-open standby copy; ADD_MESSAGE panel-origin clears. Tests cover reducer. **Broken by B1**, not by the reducer |
| `self-ui` cmspark-tray basename | CU only | Dirty **removes** process-level tray match; window-rect must work or overlay is a clickable target |
| SHA pin | operational | origin/main `ebd1ee4a…` → HEAD `267e24b2…` → dirty `8b1d0619…` matching rebuilt binary |

No main-path “chat.token became a delta” regression: adapter already sent cumulative `assistantContent` on main.

---

## Test-quality verdict

**Hostile: FAIL as a correctness net for Swift + lease lifecycle.**

| Bucket | Examples | Load-bearing? |
|--------|----------|----------------|
| Real | `ComposerLeaseRegistry` CAS; `claimOverlayLeaseCas` retry; `hydratePlaintext` 50→20 + newlines; `submitSummonerTalk` claim-then-create order; `filterThreadsByTitle` / hits; `classifyError`; `toolChatErrorPayload`; `gateChatCreateOnConductor` with injected map; overlay-standby **reducer** | Yes |
| Theater | Entire `summoner-overlay.test.ts`; `assert.match(src, /gateChatCreateOnLease/)` / `gateChatCreateOnConductor`; `useWebSocket.ts` case-body greps; Swift `replacingOccurrences` / `suffix(20)` / `appendToken` string presence; idle test that asserts the stub | No |
| Missing | Multi-thread claim/release; close after `#` select; 1-hit search must not move `summonerThreadId`; first token after assistant-tail hydrate; `resume_idle_minutes=10` elapsed; broadcast received by a fake panel WS | — |

Green 156+18 means “the strings we grepped are still in the files,” not “J4 holds.”

---

## VERDICT: REJECT

P0 dual-open (brief §11 last bullet, journeys J4) is **false** after 新对话 or `#` select. That is a spec-vs-code BLOCK, not a nit, and the test suite cannot see it because it greps `handleSummonerClosed` instead of running claim A → claim B → close → `get(A)`.

Do not APPROVE_WITH_NITS while Side Panel thread A can be left read-only after the overlay has moved on or closed.

**Re-review bar (minimum):**

1. Thread switch releases the previous overlay lease (or single-session lease) — **unit, not grep**.
2. `#` 1-hit must not assign `summonerThreadId` without select/hydrate.
3. Close after ready race does not leave a claim.
4. SHA pin remains lockstep with the rebuilt binary (`[executed]` shasum).

H2/H3/H4/H5/H6/H7/H9 are in good enough shape that a lease fix should not reopen attach/token/error_code. H8 stays MAJOR until Swift snapshot/throttle/hard-break have a non-grep proof (even a tiny Swift snippet test or a Node replica that **is** what stdin calls).
