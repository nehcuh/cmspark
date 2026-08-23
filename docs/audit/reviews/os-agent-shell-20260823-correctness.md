# OS Agent Shell — CORRECTNESS adversarial review (2026-08-23)

| Field | Value |
|-------|--------|
| Lane | CORRECTNESS (isolated; did not read other 20260823 reviews) |
| Scope | `feat/os-agent-shell` HEAD `659bbcebeca13dd136080c0ef47ed7da1ce3700b` + uncommitted working tree |
| Merge-base | `fc1872571d36e75d9ce137a2d5c6c323b7a70e0a` |
| Spec | brief `docs/decisions/os-agent-shell-brief-2026-08-22.md` §5 / §9 / §10 / §11 · journeys `docs/superpowers/specs/2026-08-23-os-agent-shell-user-journeys.md` · plan `docs/superpowers/plans/2026-08-22-os-agent-shell-p0-spike.md` |
| Evidence tags | `[executed]` ran · `[inspected]` read path · `[assumed]` not verified |

**VERDICT: REJECT**

Green-looking unit files do not make P0 journeys true. Overlay close does not release `composer.lease`. Overlay open does not claim it. `#` search never uses companion `thread.list`. Selecting a hit does not hydrate. `L2_CONDUCTOR_ELSEWHERE` is a documentation ghost. Hydrate cap is 40 against a locked 20. The continue CTA cannot light because adapter `chat.error` drops `error_code`. The suite that is supposed to guard Swift UI is source-grep theater, and two of those greps already fail on the uncommitted `Tray.swift`.

---

## Machine evidence

### Commands

```text
# 1) Exact user command (raw .ts under node --test)
cd companion && npx tsc -p tsconfig.test.json --pretty false   # TSC_EXIT=0  [executed]
node --test tests/summoner-*.test.ts tests/composer-lease.test.ts \
  tests/l1-actuator.test.ts tests/summoner-acl.test.ts \
  tests/voice-stt-handlers.test.ts tests/mcp-confirm-target.test.ts \
  tests/tool-forward-actuator.test.ts tests/classify-error-browser-unavailable.test.ts
# NODE_TEST_EXIT=1   ℹ tests 14  ℹ pass 0  ℹ fail 14
# Failures: ERR_MODULE_NOT_FOUND / ERR_UNSUPPORTED_DIR_IMPORT / __dirname in ESM
# This is the command as written. It is not how this repo runs tests.

# 2) Honest compiled path (what `npm test` actually executes)
node --test .test-dist/tests/summoner-*.test.js \
  .test-dist/tests/composer-lease.test.js \
  .test-dist/tests/l1-actuator.test.js \
  .test-dist/tests/voice-stt-handlers.test.js \
  .test-dist/tests/mcp-confirm-target.test.js \
  .test-dist/tests/tool-forward-actuator.test.js \
  .test-dist/tests/classify-error-browser-unavailable.test.js
# COMPILED_TEST_EXIT=1   ℹ tests 152  ℹ pass 150  ℹ fail 2  [executed]
# FAIL SummonerController renders plaintext transcript and new-thread control
#      expected /makePlainLine/ — gone from uncommitted Tray.swift
# FAIL SummonerController streams tokens without rebuilding the whole log
#      appendToken still calls refreshLog() on first token; test forbids /refreshLog()/

# 3) chrome-extension overlay-standby
cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false   # EXT_TSC=0
node --test .test-dist/tests/overlay-standby.test.js
# EXT_TEST=0   ℹ tests 18  ℹ pass 18  ℹ fail 0  [executed]
```

Node `v24.16.0`. Companion `tsc -p tsconfig.test.json` clean.

### SHA256 / Swift binary [executed]

| Item | Value |
|------|--------|
| HEAD `SWIFT_TRAY_SHA256` | `267e24b256459ad0386a2054f710f672fd65994d81b0441437094dbbe310f483` |
| Worktree `SWIFT_TRAY_SHA256` | `6d7de4ed3e673ee527fd9a7b4225c5d6841d351956434682d882dadd4d989838` |
| `shasum -a 256 companion/dist/cmspark-tray` | `6d7de4ed3e673ee527fd9a7b4225c5d6841d351956434682d882dadd4d989838` |
| `Tray.swift` mtime | 2026-08-23 17:53:56 |
| binary mtime | 2026-08-23 17:54:06 |

Worktree hash, `Tray.swift`, and `dist/cmspark-tray` are in lockstep **in this checkout**. HEAD is not: committed hash does not match the binary on disk. Anyone running committed HEAD against the current binary will trip the SHA gate and rebuild from whatever `Tray.swift` they have. Uncommitted Swift **is** rebuilt here; it is **not** on HEAD. Users of the last commit still run the previous overlay.

### What the 150 passing tests actually exercised

- Pure functions + fake WS + `fs.readFileSync` greps of Swift/TS source.
- **No** live summoner WS roundtrip, **no** overlay+panel dual-open, **no** Carbon/IME, **no** adapter tool-loop with a stub executor proving `recoverableFailureCounts` stays 0 (plan E3). That last claim is `[inspected]` only (see hunt 11).

---

## Spec vs code matrix (P0 DoD)

| P0 DoD item | Status | Evidence |
|-------------|--------|----------|
| S19 origin ⊥ actuator; no `tool.execute` on summoner/tray | **implemented** | `forwardL1OrUnavailable` in `server.ts:763`; `resolveL1ActuatorWs` tray→ext or `BROWSER_UNAVAILABLE`. Tests: `l1-actuator`, `tool-forward-actuator` `[executed]` |
| `BROWSER_UNAVAILABLE` typed, string has no `timeout`/`disconnected`/`not found` | **implemented** (result helper) | `l1-actuator.ts:13` exact `BROWSER_UNAVAILABLE: Chrome extension peer missing`. `classifyError` first branch on `error_code` `security.ts:923` `[inspected]` |
| `classifyError` explicit non-retryable; L1 must not auto-retry | **partial** | Code path `[inspected]` stops (`adapter.ts:1438-1459`). **No** stub-executor test that `recoverableFailureCounts` stays 0 (plan E3 missing). Adapter `chat.error` **drops** `error_code` so overlay cannot key the typed code |
| S21 summoner ACL (`pack.apply`/`config.set`/`unattended.arm`/`confirmation.response`/`mcp.add`) | **implemented** (plus extra allow) | `summoner-acl.ts` denies those. Allowlist **also** has `voice.stt.*` + `mcp.list` (journeys J5 / later ship note). `system.pong` from the plan is **missing** |
| S20 `{thread_id, holder, rev}` CAS | **partial / lying** | Registry CAS works in-process. Overlay **does not claim on open** and **does not release on close**. Panel never receives a lease broadcast. Dual-open DoD is false |
| `OVERLAY_STANDBY` produced, panel named + unwritable | **partial** | Gate exists (`composer-lease.ts:109-126`). Produced only if overlay already claimed (i.e. after overlay *send*). Panel textarea `disabled` (not `readOnly`) after `chat.error`. Close ≠ abort is true; close ≠ release is the hole |
| `L2_CONDUCTOR_ELSEWHERE` (brief §10 P0 最小集) | **missing** | Grep hits **only** brief + spike plan type export. Zero TS/Swift production. No test |
| Hydrate ≤20 plaintext lines | **lying** | `HYDRATE_CAP = 40` (`hydrate.ts:5`); Swift `suffix(40)` / `capLines` 40. Tests **lock 40** (`summoner-hydrate.test.ts:7-15`). Brief §7/§11 and ship note still say 20 |
| Empty-state talk: `thread.list` → latest or `thread.create`; fire-and-forget `chat.create` | **partial** | `submitSummonerTalk` `[inspected]` does this. Send **button** hidden with empty transcript (parent `footRow`). Search hit does not hydrate |
| `#` title search (Swift `hasPrefix` vs JS `isSummonerSearchQuery`) | **partial / lying** | Prefix predicates match (`trim` + `#`). Swift then filters **tray `recentThreads` cap 5**, mapped `alias \|\| id`. Companion `handleSummonerSearch` runs full `thread.list` then **discards** the result |
| Send visible when detached | **partial** | `sendButton?.isHidden = false` but `footRow?.isHidden = !hasTranscript`. Empty talk has no 发送. Detached **with** transcript shows it |
| Honest CTA, no `openSidePanel` on attach | **implemented** | `attachChromeOnly`; copy contains `我们不能替你打开侧栏`. Continue button itself is dead (see BLOCK-4) |
| Close overlay ≠ `chat.abort` | **implemented** | `summoner.closed` only. Tests grep this. **Does not** `composer.lease.release` |
| IME: `hasMarkedText` on Return; Carbon hotkey while composing | **implemented** (unexecuted) | Swift `[inspected]`. Tests only `assert.match(/hasMarkedText/)`. No XCTest / 5/5 smoke |
| Streaming tokens, plaintext not bubbles | **partial** | First token `refreshLog()`; subsequent `patchStreamingLine` does `tv.string = lines.joined` wiping attributes; `attributedLine` parses markdown on full refresh. Journeys: 纯文本行 |
| S23 self-ui window-rect | **missing** (plan: P1) | Basename `cmspark-tray` added. Rect reject not present. Acceptable only if called P1; brief S23 is still a law |
| SHA256 one binary | **worktree ok / HEAD stale** | See machine evidence |
| GOAL.md frozen | **implemented** | Not edited in this range `[inspected]` via diff stat |
| No overlay Allow/Deny | **implemented** | Source-lock still passes on this substring |
| Adapter retry cannot fire for `BROWSER_UNAVAILABLE` | **inspected yes / test no** | See hunt 11 |
| Journeys J4 dual composer | **missing in production** | Overlay open does not claim; close does not release |
| Journeys J3 select hit → talk + history | **missing** | `selectThread` clears composer only; **does not** request hydrate; **does not** clear `lines` |
| Plan E3 stub-executor retry | **missing** | `adapter-recovery.test.ts` uses a **local fake** `classifyError` and a Map in the test file. Does not import adapter |

---

## Bugs

### BLOCK-1 — Overlay close does not release lease; overlay open does not claim it

Journeys J4 / brief S20: overlay visible ⇒ holder `overlay`; close ⇒ `composer.lease.release` ⇒ holder `panel`; close ≠ `chat.abort`.

**Open path** `[inspected]`: `handleSummonerReady` hydrates or creates a thread. It never calls `claimOverlayComposerLease`. Claim happens only inside `submitSummonerTalk` (`client.ts:132` → `menu-bar-agent.ts:696`). Until the user **sends**, holder stays default `panel`. Overlay and Side Panel are both writable. Dual drafts.

**Close path** `[inspected]`:

```976:978:companion/src/menu-bar-agent.ts
    case "summoner.closed":
    case "summoner.composing":
      return
```

Swift `emitClosedIfOpen` (`Tray.swift:1703-1707`) emits `summoner.closed` and explicitly does not abort. There is **no** `composer.lease.release` anywhere in the summoner inbound handler, companion-client, or Swift.

**User-visible failure:**

1. Open overlay, send one line → overlay claims thread T.
2. Close overlay (S9: task continues — good).
3. Type in Side Panel on T → `OVERLAY_STANDBY` forever, until companion process restart (in-memory `Map`).
4. Restart companion while overlay still visible → map empty, holder `panel` again → **both** surfaces writable.

`claimOverlayComposerLease` swallows all errors (`companion-client.ts:345-347`) and `submitSummonerTalk` still `sendChatCreate`s. CAS steal retry (`claimOverlayLeaseCas`) is real, then the production caller throws the result away.

Lease RPC is returned only to the summoner socket. `handleComposerLeaseFamily` does not `broadcastToClients`. Panel `useWebSocket.ts:475` `composer.lease` handler is a dead push path unless something else fans out — nothing does `[inspected]`. Standby UI is a side effect of a failed panel `chat.create`, not of overlay visibility.

### BLOCK-2 — `#` title search does not search titles of threads

Journeys J1/J3 / brief §11 task 1: find a **specified old thread by title**, see truncated history.

Swift `refreshHits` (`Tray.swift:1953`): `recentThreads.filter { $0.title.contains(q) }`.

`recentThreads` is the tray menu cache from `fetchRecentThreads(limit = 5)` (`companion-client.ts:227-239`), mapped `title: t.alias || t.id` — not `thread.title`, and **capped at 5**.

Companion **does** have a full `listThreads()` + `filterThreadsByTitle` in `handleSummonerSearch` (`menu-bar-agent.ts:730-737`). Inbound handler:

```945:947:companion/src/menu-bar-agent.ts
    case "summoner.search":
      void handleSummonerSearch(evt.query)
      return
```

The promise is discarded. No stdin command pushes hits to Swift. The tested `filterThreadsByTitle` never reaches the glass.

`selectThread` (`Tray.swift:1795-1803`) sets local `threadId`, clears the `#…` composer, and **does not**:

- emit any companion event
- clear `lines` (old transcript stays on screen)
- request hydrate

P0 task 1 (“看到截断历史”) is false after a hit. User can then submit into the **new** id while staring at the **old** thread’s lines.

JS `isSummonerSearchQuery` / Swift `hasPrefix("#")` after trim **do** match. The hunt item about predicate mismatch is **not** the bug. The hunt item about search being theater **is**.

### BLOCK-3 — `L2_CONDUCTOR_ELSEWHERE` is not produced

Brief §10: P0 实现最小集 = `BROWSER_UNAVAILABLE` + `OVERLAY_STANDBY` + `L2_CONDUCTOR_ELSEWHERE`. Error strings must not contain `timeout` / `disconnected` / `not found`. Brief 9.2.13: L2 LIVE → overlay input queued or disabled; conductor in HUD.

Repo grep of production `*.ts`/`*.swift`: **no symbol**. Plan lists the const; it was never wired into `gateChatCreateOnLease` or overlay submit. Overlay can `chat.create` during `host_computer` LIVE. N6 is not enforced on this surface.

### BLOCK-4 — Continue CTA cannot light; `error_code` never reaches Swift

Spec §5.3: after attach, 「已连接，继续对话」 = **new** user message; server must not replay L1.

Swift `applyError` (`Tray.swift:1644-1648`) sets `sawBrowserUnavailable` **only** if `errorCode == "BROWSER_UNAVAILABLE"`. Continue visibility (`Tray.swift:2134`): `hasTranscript && browserAttached && sawBrowserUnavailable`.

Adapter on non-recoverable (`adapter.ts:1452-1458`) sends:

```ts
{ type: "chat.error", thread_id, error: formatChatErrorLine(...), error_level }
```

No `error_code`. No `data.error_code`. `formatChatErrorLine` wraps as `无法继续：BROWSER_UNAVAILABLE: Chrome extension peer missing`. Mapper can read a top-level `error_code` (`summoner-client.test.ts` locks this) that production never sets.

`handleSummonerAttach` only calls `openChrome()`. It does not re-probe `pickAuthenticatedClientWs` or hydrate. `browserAttached` stays false until the next hydrate. Even a correctly coded `error_code` would not show Continue until a later hydrate flipped attached.

User-visible: after L1 degrade + attach, the specified Continue button does not appear. Detached CTA box **does** show (honest copy is present). Continue is specified, painted, and dead.

### BLOCK-5 — Hydrate cap 40 vs locked 20; tests freeze the lie

Brief §7 / §11 / plan Task 6 / ship note §2: **上限 20**.

```5:11:companion/src/summoner/hydrate.ts
const HYDRATE_CAP = 40
const HYDRATE_CHARS = 4000
export function hydratePlaintext(..., cap = HYDRATE_CAP): string[] {
```

Swift `applyHydrate` `suffix(40)`, `capLines()` 40. Test name: `"50 user messages truncate to last 40 lines"` — would **fail** if the DoD were implemented. This is a spec lie with a load-bearing test in the wrong direction.

### MAJOR-1 — `patchStreamingLine` wipes attributes; first token rebuilds the log

```1604:1615:companion/src/tray/Tray.swift
  func appendToken(_ text: String) {
    ...
      patchStreamingLine(lines.last ?? "")
      return
    }
    lines.append("助手: " + text)
    ...
    refreshLog()
  }
```

```2003:2006:companion/src/tray/Tray.swift
  private func patchStreamingLine(_ body: String) {
    guard let tv = logView else { return }
    tv.string = lines.joined(separator: "\n")
```

Hunt item 7 confirmed. `refreshLog` / `attributedLine` then parse markdown (`AttributedString(markdown:)`). Journeys: 历史是纯文本行，不是 markdown 气泡. Streaming is plaintext wipe + post-hoc markdown. The overlay test that forbade `refreshLog()` in `appendToken` is now **failing** on this uncommitted file — the test was locking a helper name, and the helper name came back.

### MAJOR-2 — Empty-state 发送 is not visible

J2: “发送按钮在 talk 态始终可见（含 detached）.”

`sendButton` lives **inside** `footRow` (`Tray.swift:2510-2526`). `applyPhase`: `footRow?.isHidden = !hasTranscript` then `sendButton?.isHidden = false`. Empty overlay (`lines` empty and `threadId` empty) hides the whole foot row. Return-to-send still works via `NSTextViewDelegate`. The button the journey names is gone.

### MAJOR-3 — `新对话` vs in-flight empty `thread_id`

`newThreadClicked` sets `threadId = ""` then async `summoner.new_thread`. If the user hits Return before `handleSummonerNewThread` hydrates, Swift submits `thread_id: ""`. `submitSummonerTalk` treats empty as **newest existing thread** (`client.ts:125-129`), not the thread being created. Message lands on the previous conversation; then hydrate of the new empty thread can wipe the overlay. Empty `thread_id` is a first-class hole (hunt item 2).

`handleComposerLeaseFamily` does `String(rest.thread_id)` with no empty-id reject. A claim on `""` is a different map key from every real thread.

### MAJOR-4 — Panel standby is optimistic-clear theater

`ADD_MESSAGE` with a panel temp user id **clears** `overlayStandby` (`agentStore.tsx:824-826`). Tests **lock** that (`overlay-standby.test.ts:79`). Combined with BLOCK-1: panel send optimistic-unlocks the textarea, then `chat.error OVERLAY_STANDBY` re-locks it, and the optimistic bubble may remain. Standby is not the lease SoT.

`SET_ACTIVE_THREAD` to another id also clears standby. Switching back to the overlay-held thread does not re-apply it until the next failed send.

Textarea uses `disabled` (`App.tsx:1771-1776`), not `readOnly`. Functionally blocks typing; copy is the journey string in the uncommitted store (`这边暂时打不了字，正在召唤器里说`). That copy is fine. The **lifetime** of the flag is not.

### MAJOR-5 — Adapter retry proof is `[inspected]`, not `[executed]`

`classifyError` (`security.ts:923`):

```ts
if (context?.error_code === "BROWSER_UNAVAILABLE") return "non_recoverable"
```

before any `timeout` / `disconnected` / `not found` substring list. `adapter.ts:1438` passes `toolResult.error_code`. `non_recoverable` sets `shouldStop` and `break` **before** `recoverableFailureCounts` increment (`1459` vs `1463`).

**Proof the retry loop cannot fire:** if and only if `error_code` is present on the tool result. `browserUnavailableResult()` sets it at top-level. `forwardL1OrUnavailable` returns that object. That is a closed path `[inspected]`.

What would re-enter recoverable: a missing-peer error **without** the code (old 15s `Tool execution timeout`). The S19 helper exists to stop that. There is **no** adapter-level test with a stub `executeTool` returning `browserUnavailableResult()` asserting `recoverableFailureCounts.get("navigate") === undefined` and a single round. `adapter-recovery.test.ts:169-196` reimplements a Map in the test. `adapter-recovery.test.ts:230` inlines a **different** `classifyError` that **does not** know `error_code`. That file would still pass if the production first-branch were deleted.

`failCode` later (`adapter.ts:1344-1347`) reads `toolResult.data?.error_code` or a `^CODE:` regex on the error string. Top-level `error_code` is ignored there; the regex **would** parse `BROWSER_UNAVAILABLE:` for CDP freeze. Harmless extra. Classification itself uses the top-level field.

### MAJOR-6 — Uncommitted overlay tests fail; journeys file freezes helpers not journeys

Uncommitted `companion/tests/summoner-journeys.test.ts`:

- Badge probing — unit of `summonerBrowserBadge`.
- Empty send — **mocked** `claimLease` as `calls.push`; no CAS, no WS.
- `#投研` — JS `isSummonerSearchQuery` only; never Swift, never the 5-cap cache.
- Hotkey occupied — `acceptedSummonerHotkey` on TS tables.
- STT origin — `isVoiceSttOriginAllowed` + ACL.

It does not open overlay, does not dual-compose, does not search `thread.list`, does not prove Continue, does not prove close-release. Name says journeys. Body is incidental string/API lock.

`summoner-overlay.test.ts` greps Swift for `makePlainLine` (removed in the uncommitted rewrite) and forbids `refreshLog()` in `appendToken` (present again). Two failures `[executed]`. A test that passes when UX is broken (Allow button with a different title, search over 5 aliases, 40-line hydrate, lease never released) is theater. A test that fails because a helper was renamed is also theater — just the other way.

### NIT-1 — Worktree SHA is consistent; HEAD is not the binary users will run after this edit

See machine evidence. Not a logic bug in the uncommitted tree. Process: `Tray.swift` + `SWIFT_TRAY_SHA256` + `dist/cmspark-tray` must commit together. HEAD hash is already stale relative to the rebuilt binary.

### NIT-2 — `system.pong` on the plan allowlist, absent in `SUMMONER_ALLOW`

Unlikely client-to-server. Not user-visible.

### NIT-3 — `NSApp.activate(ignoringOtherApps: true)` on overlay open vs `.nonactivatingPanel`

`Tray.swift:1572`. May steal IME from another app. Overlay composing Return is guarded; global IME is not. Brief 9.4.22 is overlay composing, which is handled. Flag as CN residual, not a P0 string mismatch.

### NIT-4 — Chat.create `"Thread not found"` contains `not found`

`message-router.ts:283`. This is a **chat.error**, not a tool result, so it does not re-enter `classifyError` recoverable. Overlay will print it as `系统: Thread not found`. Ghost `thread_id` from `resolveSubmitThread({ requestedId: "ghost" })` (talk test **locks** unknown ids through) can produce it. Typed-error discipline is sloppy, not a retry loop.

### NIT-5 — S23 window-rect

Plan: P0 basename only. `self-ui.ts` has `cmspark-tray`. Rect reject is P1. Do not treat as P0 ship-blocker unless brief S23 is re-elevated.

---

## Hunt checklist (explicit)

| Hunt | Result |
|------|--------|
| 1. Typed errors actually produced? Strings with timeout/disconnected/not found re-enter recoverable? | `BROWSER_UNAVAILABLE` produced on missing peer `[inspected]`. `OVERLAY_STANDBY` produced only after overlay claim. `L2_CONDUCTOR_ELSEWHERE` **never**. Helper string is clean. Adapter `chat.error` **strips** the code. `"Thread not found"` is a chat.error, not a tool retry |
| 2. Lease CAS steal; overlay close without release; in-memory map; empty `thread_id`; panel `chat.create` while overlay visible | Close without release **BLOCK-1**. Open without claim **BLOCK-1**. Restart resets map **MAJOR**. Empty id **MAJOR-3**. Overlay steal-on-send is intended S20 **if** overlay is visible; CAS retry exists and is tested; production swallows failure |
| 3. Hydrate 20 vs 40 | **40**. Tests lock 40. **BLOCK-5** |
| 4. Empty-state talk | Resolve/create/send implemented. Send button hidden empty. Fire-and-forget `sendChatCreate` true `[inspected]` |
| 5. Search only if `#`; Swift vs JS | Predicates match. Search corpus is tray top-5 alias/id. Companion full list discarded. **BLOCK-2** |
| 6. IME `hasMarkedText` on return; Carbon during composing | Both present `[inspected]`. Tests grep only |
| 7. Streaming / `tv.string = lines.joined` | Confirmed **MAJOR-1**. Uncommitted test FAIL is this |
| 8. Tests snapshot/source-lock; mock away race; missing L2 / S23 / WS roundtrip | Yes. See test-quality |
| 9. Uncommitted `summoner-journeys.test.ts` | Helper freeze, not journeys |
| 10. Side Panel standby copy / textarea / close ≠ abort | Copy updated uncommitted. Textarea `disabled`. Close ≠ abort true. Close ≠ release **BLOCK-1** |
| 11. classifyError non-retryable — prove retry cannot fire | `[inspected]` closed if `error_code` present. `[executed]` only on `classifyError()` unit, not adapter loop |
| 12. Swift binary vs SHA | Worktree match `[executed]`. HEAD hash stale. Uncommitted Swift **was** rebuilt in this tree |

---

## Test-quality verdict

**Mostly theater, with a few load-bearing islands.**

Load-bearing (would fail if the code path were ripped out):

- `classify-error-browser-unavailable.test.ts` — real `classifyError` + `browserUnavailableResult`.
- `l1-actuator.test.ts` / `tool-forward-actuator.test.ts` — fake sockets, identity of actuator vs origin. The production `createToolExecutor` lock is still a **source grep** of `server.ts`.
- `summoner-acl.test.ts` — real allow/deny function.
- `composer-lease.test.ts` registry CAS + `claimOverlayLeaseCas` retry — **in-memory**, not WS. The “message-router uses gate” test is a grep.
- chrome-extension `overlay-standby.test.ts` — real reducer. 18/18 `[executed]`. Locks a standby **clear** on panel optimistic send (that is load-bearing for a **bad** behavior).

Theater / anti-tests:

- `summoner-overlay.test.ts` greps Swift for incidental identifiers (`makePlainLine`, absence of `refreshLog`). Currently **fails** on uncommitted Swift for that reason, while **passing** on: no lease release, 40-line cap, 5-thread search, dead Continue, markdown `AttributedString`.
- `summoner-hydrate.test.ts` **requires 40**, contradicting DoD 20.
- `summoner-journeys.test.ts` mocks `claimLease` as `push`, never talks to `ComposerLeaseRegistry`.
- `adapter-recovery.test.ts` local fake classifier — would stay green if S19 were reverted.
- No test for `L2_CONDUCTOR_ELSEWHERE`.
- No test that `summoner.closed` calls `composer.lease.release`.
- No test that `handleSummonerSearch` result is encoded to Swift (because it isn’t).
- No summoner WS roundtrip in `tests/integration/ws-roundtrip.test.ts` beyond a 2-line churn in the branch stat.

A green 150/152 under `.test-dist` is compatible with every BLOCK above.

---

## VERDICT: REJECT

Not APPROVE_WITH_NITS. Dual-composer, title search, hydrate cap, Continue CTA, and a P0 typed error are user-facing P0 DoD, not polish. The machine suite is green enough to ship a broken overlay.

**Required before re-review (BLOCK only):**

1. Overlay open (hydrate/ready) claims `composer.lease` for the resolved `thread_id`; overlay close **releases** it; broadcast or equivalent so Panel standby tracks visibility without waiting for a failed send. Empty `thread_id` must not be a lease key.
2. `#` search must use companion `thread.list` (title/alias, not top-5 tray cache); selecting a hit must hydrate plaintext of **that** thread and drop the previous `lines`.
3. Produce `L2_CONDUCTOR_ELSEWHERE` on overlay `chat.create` when host CU is LIVE/pending, or explicitly amend brief §10 / journeys and stop calling it P0 最小集.
4. Put `error_code: "BROWSER_UNAVAILABLE"` on the `chat.error` frame the summoner mapper sees; flip overlay attached from a real peer probe after attach so Continue can exist; Continue must remain a **new** user line (no L1 replay).
5. Hydrate cap 20 **or** change brief/ship note/plan and the test name together. Do not leave 20 in DoD and 40 in the only test.
6. Tests that fail for `makePlainLine` / `refreshLog` must be rewritten to assert user-visible behavior (lease release, search corpus, error_code on the wire), not helper names. Add one adapter-loop test: stub `executeTool` → `browserUnavailableResult()`, assert one round and `recoverableFailureCounts` never incremented.

NIT/MAJOR items can wait a follow-up **after** those six.

---

*Lane: CORRECTNESS. Isolation: did not read other 20260823 reviews. Did not modify production source.*
