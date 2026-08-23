# OS Agent Shell — Code Quality / Maintainability / AI-Slop Review

**Date:** 2026-08-23
**Branch:** `feat/os-agent-shell` (HEAD `659bbce`, 1 commit ahead of `origin/feat/os-agent-shell`)
**Scope:** `origin/main...HEAD` (79 files, +10082 / −122) + uncommitted (~356 lines, new `summoner-journeys.test.ts`, Swift transcript rewrite)
**Reviewer role:** adversarial code quality. Hostile to comment-narrated design, protocol soup, god files, grep tests, dead UI, duplicated types, Swift/TS drift.
**Source:** not modified. Evidence tagged `[inspected]` / `[executed]`.

---

## VERDICT: **REJECT**

This is a capture overlay that grew a second protocol, a second WebSocket, a second composer lease, a second hotkey table, a second search implementation, and a 2.6k-line Swift god file — then proved the overlay “correct” by grepping its own source. The uncommitted “plaintext rewrite” is the same pattern one more time: UI swapped, tests not updated, streaming path now **wipes attributed text**, SHA pin not rebuilt.

The owner’s suspicion is confirmed. Not every line is junk (lease / ACL / L1 actuator / hydrate are small and real). The *shape* of the feature is AI-slop: task-numbered comments as law, dual implementations, tests that snapshot incidental identifiers, dead chrome kept so greps still match.

---

## Scale of change vs actual user capability delivered

`[inspected]` `git diff --numstat origin/main...HEAD`:

| Bucket | Insertions | Share |
|---|---:|---:|
| docs (briefs, plans, prior reviews, HTML mockups) | +3940 | 39% |
| tests | +2275 | 23% |
| `Tray.swift` | +1441 | 14% |
| `companion/src/summoner/` | +1001 | 10% |
| companion other (lease, ACL, L1, config, MCP retarget) | +777 | 8% |
| `menu-bar-agent.ts` | +462 | 5% |
| chrome-extension | +103 | 1% |
| **TOTAL** | **+10082** | |

Uncommitted: 18 files, +356/−258, plus untracked `companion/tests/summoner-journeys.test.ts` (73 lines). Working-tree `Tray.swift` is **2594** lines (HEAD was **2670**; `origin/main` was **1229**). `menu-bar-agent.ts` 966 → **1427**.

**What a user actually gets (macOS only):** a floating NSPanel that types into last/new thread, optional Carbon hotkey, `#` title search, press-hold Whisper, Side Panel composer frozen while overlay holds a lease.

That is a spike. The branch treated it as a product:

- 22 commits of `feat(summoner): Task N` slices.
- A 410-line stdin codec Swift never calls.
- Dual WS (`surface: "summoner"`) + CAS composer lease + overlay standby copy.
- Settings/MCP/HUD leftover chrome still in the same binary.

Docs+tests are 62% of the diff. A large fraction of the tests do not execute the overlay; they `readFileSync` Swift/TS and `assert.match` string constants from the brief (`召唤器（实验）`, `我们不能替你打开侧栏`, `MCP · `, `makePlainLine`).

**Capability holes that the line count hides:**

1. Overlay `#` search filters `recentThreads` — the tray menu cache capped at **5** (`fetchRecentThreads(limit = 5)`). Node `handleSummonerSearch` walks the full list then **throws the result away**. `[inspected]`
2. Uncommitted overlay is **not in the pinned binary**. SHA256 matches HEAD `companion/dist/cmspark-tray`; working-tree Swift is a different UI. Running tray today still ships bubbles+markdown from HEAD.
3. Uncommitted tests already fail against uncommitted Swift (`[executed]`, 2 failures). The rewrite is not even internally consistent.

---

## God objects / coupling map

```
Tray.swift 2594  [one stdin JSON process]
├── PairingController     ~150
├── ConfirmController     ~240   (Allow/Deny — same file as "zero confirm chrome")
├── HudController         ~290   (P3a spike, still here)
├── SummonerHotKey*       ~90    (duplicate of hotkey.ts tables)
├── SummonerMicCapture    ~80
└── SummonerController   ~1084   ★ overlay god
    ├── hydrate / token / tool / mcp / error / settings
    ├── Carbon picker UI (stolen list ×3: table, copy string, row labels)
    ├── local # search over tray's 5 threads
    ├── AVAudioEngine mic → base64 wav on stdin
    ├── settingsBox (built, hidden, no toggle)
    ├── mcpField (written, always hidden)
    └── transcript: refreshLog + patchStreamingLine(tv.string=…)

menu-bar-agent.ts 1427
├── tray lifecycle / pairing / chrome / settings web
└── +~460 summoner: second CompanionClient, STT, hydrate, MCP list, inbound switch

protocol.ts 410     typed encode/decode  —  Swift uses [String: Any]
hotkey.ts 171       canonicalizer + stolen/candidate tables  —  Swift has its own
client.ts 430       search / talk / STT / chrome-attach / stream map
hydrate.ts 25       "你: / 助手:"  —  Swift writes the same prefixes again
composer-lease.ts   SoT (small, real)
summoner-acl.ts     SoT (small, real)
l1-actuator.ts      SoT (small, real)

Swift stdin  ──untyped──►  handleCommand(cmd, json)
TS protocol  ──typed──►    decodeSummonerInbound  (bridge only)
                           decodeSummonerOutbound  (tests only; Swift never decodes)
```

**`SummonerController` (L1511–2571) is the smoking god.** Window chrome, transcript, search, hotkey picker, settings, mic, MCP, CTA, layout math, markdown parse, and stdin emit in one NSObject. `makeWindow()` alone is ~390 lines of AppKit soup.

**`menu-bar-agent.ts` absorbed the overlay as a second personality.** `handleSummonerReady/Submit/Search/Mic/NewThread/Inbound` sit next to pairing, daemon start, and HUD spike. Cycle-breaking `require("./ws/lifecycle")` inside `summonerBrowserAttached()` (L595–602).

**Protocol is not shared.** TS has 20+ `encodeSummoner*` one-liners and a decoder Swift does not import. Swift `jsonLine(["type": …])` and `handleCommand` string-switch. Any field rename is a silent miss unless a grep test happens to mention the string.

**Hydrate / search / talk duplicated:**

| Behavior | TypeScript | Swift |
|---|---|---|
| `#` is search | `isSummonerSearchQuery` `client.ts:74` | `isSearchQuery` `Tray.swift:1720` |
| needle after `#` | `summonerSearchNeedle` | `searchNeedle` L1724 |
| title filter | `filterThreadsByTitle` (full `thread.list`) | `recentThreads.filter` (≤5) L1953 |
| badge copy | `summonerBrowserBadge` | `applyPhase` L2095 |
| hotkey candidates | `SUMMONER_HOTKEY_CANDIDATES` | `summonerHotKeyCandidates` L1285 |
| stolen chords | `SUMMONER_HOTKEY_STOLEN` | `summonerHotKeyStolen` + `summonerHotKeyStolenCopy` |
| line cap 40 | `HYDRATE_CAP` | `capLines` / `suffix(40)` |
| `你:` / `助手:` | `hydrate.ts:21` | `submitComposer` / `appendToken` |

`summoner-hotkey.test.ts` greps Swift to keep the tables in lock-step. That is an admission there is no shared schema.

---

## AI-slop findings

### BLOCK

**B1. `patchStreamingLine` assigns `tv.string` after attributed `refreshLog` — bug + leftover parameter.** `[inspected]`

```2003:2008:companion/src/tray/Tray.swift
  private func patchStreamingLine(_ body: String) {
    guard let tv = logView else { return }
    tv.string = lines.joined(separator: "\n")
    logBox?.isHidden = lines.isEmpty
    tv.scrollToEndOfDocument(nil)
  }
```

`refreshLog` (L1983) builds `NSMutableAttributedString` (markdown on assistant lines). Every subsequent token does `tv.string = …`, which **replaces the text storage and drops attributes**. `body` is unused. First token of a turn calls `refreshLog()`; the rest of the stream undoes it.

This is the uncommitted “plaintext rewrite.” It is not a cleanup; it is a half-migrated bubble path (`patchStreamingBubble` → `patchStreamingLine`) with the cheap `NSTextView.string` setter left in.

**B2. Overlay grep tests already fail on the working tree they were written to police.** `[executed]` `npx tsx --test tests/summoner-overlay.test.ts …` → **64 pass / 2 fail**:

- `SummonerController renders plaintext transcript and new-thread control` expects `/makePlainLine/` — **function does not exist**. Code has `plainAttrs` / `attributedLine`.
- `streams tokens without rebuilding the whole log` `doesNotMatch /refreshLog\(\)/` — `appendToken` **does** call `refreshLog()` on the first assistant token.

The test file was updated in the same uncommitted patch as the Swift rewrite and still greps ghosts (`makePlainLine|appendStreamingLine|makePlainLine`). Tests are a second prompt transcript, not a spec.

**B3. Swift binary SHA pin was not rebuilt after Swift edits.** `[inspected]`

- Pin `companion/src/tray/swift-tray-bridge.ts:58` `SWIFT_TRAY_SHA256 = "6d7de4ed…838"`
- Binary `companion/dist/cmspark-tray` **matches** that pin (HEAD bubbles UI).
- Working-tree `Tray.swift` is −306/+… vs HEAD. Hash check will refuse a rebuild until the pin is edited by hand.
- `build-tray.sh:74` still says *“Update SWIFT_TRAY_SHA256 in **menu-bar-agent.ts**”* — the constant has not lived there for this feature. Comment/process drift.

Ship HEAD and the uncommitted overlay never runs. Ship the Swift file without rebuild and the integrity check kills the tray.

**B4. `#` search is a dead round-trip; the live path only sees 5 tray titles.** `[inspected]`

Swift `refreshHits` (L1944–1954) filters `recentThreads` (menu cache). `emitSearch` sends `summoner.search`. Node:

```730:738:companion/src/menu-bar-agent.ts
export async function handleSummonerSearch(query: string) {
  const needle = isSummonerSearchQuery(query) ? summonerSearchNeedle(query) : query
  const threads = (await summonerClient?.listThreads()) ?? []
  const result = filterThreadsByTitle(threads, needle)
  if (result.matches.length === 1) {
    summonerThreadId = result.matches[0].id
  }
  return result
}
```

Inbound: `void handleSummonerSearch(evt.query)` — return value discarded. No `summoner.hits` command exists. Journeys test (`summoner-journeys.test.ts:50`) asserts TS `filterThreadsByTitle` “only searches titles,” which is true of a function the overlay UI does not use.

**B5. God file + confirm chrome in the same binary as “zero Allow/Deny.”** `[inspected]`

`Tray.swift` still contains `ConfirmController` Allow/Deny (L742+) and HUD confirm (L511). Overlay tests grep a *slice* from `summonerWindowTitle` to `let summonerController` and `doesNotMatch /允许|拒绝|Allow|Deny|确认/`. That is how you pass a UI lock without removing the confirm surface. The lock is a comment (`L530`, `protocol.ts:7-9`) plus a grep window.

---

### MAJOR

**M1. Hidden MCP field kept so greps stay green.** `[inspected]` `[executed]`

```1631:1638:companion/src/tray/Tray.swift
  func applyMcp(_ names: [String]) {
    …
    mcpField?.stringValue = "MCP · " + names.joined(separator: "、")
    mcpField?.isHidden = true
    relayout()
  }
```

- `mcpField` constructed with copy, always `isHidden = true` (L2416–2420).
- Overlay test L67: `assert.match(body, /MCP · /)` — **passes**.
- Protocol still has `summoner.mcp`; `handleSummonerReady` still `void pushSummonerMcp()`.
- ACL comment: overlay may `mcp.list` “so the overlay can show connected servers.” It does not show them.

This is the textbook slop move: hide the widget, keep the string.

**M2. Settings box violates thin overlay — toggle removed, panel remains.** `[inspected]`

Uncommitted header drop of `NSButton(title: "设置")` (overlay test now `doesNotMatch` that exact constructor). Still in `SummonerController`:

- `settingsBox` / `settingsIdleButtons` / `settingsChromeButtons` fields
- `settingsClicked` L1886 (nothing in the header calls it)
- full idle + Chrome policy UI built in `makeWindow` L2266–2330
- `relayout` still adds 118px if shown (L2145)
- protocol `summoner.settings` / `summoner.settings.set` still round-tripped

Idle policy still applies from config (`handleSummonerReady` → `pushSummonerSettings`). The overlay is not thin; the settings chrome is just unreachable. That is dead UI, not discipline.

**M3. Comment-narrated design / “S20 as law.”** `[inspected]`

Comments restating the spike brief instead of invariants the type system could hold:

- `protocol.ts:1-12` “UI lock: two-phase capture… Plan: … Task 7”
- `client.ts:7` “Plan: … Task 8”; L25 “Must include this phrase (S8 / UI lock)”
- `hotkey.ts:2` “Summoner hotkey picker (S11)”
- `composer-lease.ts:1` “S20 composer.lease”
- `summoner-acl.ts:1` “keyed off handshake surface (S21)”
- `lifecycle.ts:1045` “S20: overwrite always after ACL. Never trust a client-supplied field.”
- `agentStore.tsx:7,181` “S20: overlay holds composer.lease”
- `Tray.swift:1378` “Look: two-phase capture + 看山 white tokens.”

`S20`/`S11`/`Task 9` are planner IDs. They do not enforce anything. The code is littered with them the way a model recites the prompt.

**M4. Protocol soup: 410 lines of encode/decode that Swift does not run.** `[inspected]`

`protocol.ts` is a closed loop: `encodeX` → `JSON.stringify` → `decodeX` → `encodeX` again. `summoner-protocol.test.ts` (334 lines) round-trips TS objects to themselves and asserts blobs do not contain the substring `"confirm"`. Swift `applyHydrate(_ json: [String: Any])` does not call `decodeSummonerOutbound`. Hydrate `search_hint` must equal the exact constant `只搜标题，不搜正文` or TS decode returns null — Swift ignores the field.

Adding a cmd means: TS type + encode + decode case + Swift `handleCommand` case + grep in overlay test + maybe a journeys helper. That is four representations of one string.

**M5. Naming drift 你　 / 你: / 你：** `[inspected]`

HEAD Swift **wrote** ideographic-space prefixes (`助手　`, `你　`) and **parsed** three forms:

```
你: | 你： | 你　
助手: | 助手： | 助手　
```

TS hydrate has always emitted `你:` / `助手:` (`hydrate.ts:21`). Streaming `hasPrefix("助手")` was fuzzy on purpose because the write path did not match hydrate.

Uncommitted unifies writes to `你:` / `助手:` (good) but:

- drops the multi-prefix parser
- `attributedLine` only special-cases `"助手: "` (L2041)
- `系统:` / `[工具]` get no structure
- overlay tests now grep `你: ` as if that had always been the contract

Three glyph variants in one afternoon is not a design; it is prompt oscillation.

**M6. Fire-and-forget without backpressure; swallowed errors.** `[inspected]`

- `SwiftTrayAdapter.send` L640–651: `stdin.write(...)` return value ignored. Token storms can fill the pipe; no `drain`.
- `sendChatCreate` is documented fire-and-forget. Overlay already appended `你: …` locally. WS fail → ghost user line, no error.
- `claimOverlayComposerLease` L345–347: `catch { // chat.create may still return OVERLAY_STANDBY; caller continues }`
- `handleSummonerMic` chunk path L840: `void (async () => { … })()` — overlapping chunks can start overlapping STT sessions (`summonerMicSessionId` is not queued).
- `companionClient.connect().catch(() => {})` / `summonerClient.connect().catch(() => {})` L1208, 1230.
- `stampCmsparkSurface(msg: any, …)` / `handleComposerLeaseFamily(… rest: any): any` — mutate-in-place on untyped WS payloads.
- `listThreads` / `createThread` / `selectThreadMessages`: empty catch → `[]` / `null`.

**M7. Test theater encoded as “Swift overlay contracts (source-level).”** `[inspected]` `[executed]`

`summoner-overlay.test.ts` header: *“Task 9 — Swift overlay contracts (source-level).”* It never instantiates a panel. It slices `Tray.swift` by source-position of constants.

Deliberate loophole:

```89:91:companion/tests/summoner-overlay.test.ts
  assert.match(body, /makePlainLine/)
  assert.doesNotMatch(body, /makeBubble/)
  assert.doesNotMatch(body, /NSAttributedString\(markdown/)
```

Working tree still has `AttributedString(markdown:` at L2050 (`try?` swallow). The negative grep is `NSAttributedString(markdown` — a different type name. Markdown is still parsed; the test was written to not see it.

`summoner-talk.test.ts` L132–211: six tests that `readFileSync` Swift/menu-bar and match `/summoner\.mic/`, `/privacy_ack_v2/`, `/mcp\.list/`. `summoner-client.test.ts` L310–338 greps `surface: "summoner"` and that `sendChatCreate` contains `sendAppMessage`. `summoner-acl.test.ts` L99–103 greps `lifecycle.ts` for `surface: wsAuth.get(ws)?.surface`.

These tests cannot fail for a wrong layout, a missed token, a hung stdin, or a stolen hotkey that Carbon actually registers. They fail when a symbol is renamed — which is how `makePlainLine` just failed.

**M8. Journeys test is a TS stand-in for a Swift UI that was not run.** `[inspected]` `[executed]`

```1:3:companion/tests/summoner-journeys.test.ts
/**
 * User-journey protocol tests for the OS summoner overlay (no Swift UI runner).
 */
```

It tests `summonerBrowserBadge`, `submitSummonerTalk`, `filterThreadsByTitle`, `acceptedSummonerHotkey`. Those helpers exist so the journeys can pass without AppKit. The file is 73 lines of “we imagined the user journey in Node.” Untracked, written alongside the Swift rewrite.

**M9. `applyPhase` rebuilds the whole log on every phase change.** `[inspected]`

L2127: `refreshLog()` inside `applyPhase()`, which runs on hydrate, error, search, badge, CTA. Combined with B1, streaming and layout both fight the text view.

---

### NIT

**N1.** `summoner-client.test.ts:67-68` asserts `r.searchHint === SUMMONER_SEARCH_HINT` twice.

**N2.** `hydrate.ts` test “no mermaid/html wrapping” asserts a `string[]` mapper does not emit `<div class="chat-bubble">`. The function could not. Snapshot of a fear, not a behavior.

**N3.** `protocol.ts` `encodeSummonerOpen` etc. are `{ cmd, … }` wrappers. A discriminated union + one `JSON.stringify` would do. 25 functions exist to give Task 7 a file-shaped deliverable.

**N4.** `global as any` tray signal bind (`menu-bar-agent.ts:1269`) — pre-existing, still the module’s escape hatch.

**N5.** Overlay `logView = logScroll.documentView as! NSTextView` — force-cast. Fine if AppKit contract holds; no fallback.

**N6.** Stolen-hotkey copy is tripled: `SUMMONER_HOTKEY_STOLEN`, Swift `summonerHotKeyStolen`, and `summonerHotKeyStolenCopy` one-liner, plus per-row labels. Uncommitted added the rows *and* kept the wrapping label.

**N7.** `handleSummonerSearch` still strips `#` if present, but Swift already sent the needle. Harmless and confused.

**N8.** `composer-lease.ts` `msg: any` stamp/strip — small, but it is the S20 “never trust the client” path and it is untyped.

---

## Test theater vs load-bearing tests

| File | Kind | Load-bearing? |
|---|---|---|
| `summoner-overlay.test.ts` | `readFileSync(Tray.swift)` + regex | **No.** 2/17 fail on WT. Rest are copy locks. |
| `summoner-talk.test.ts` (second half) | grep Swift + menu-bar | **No.** |
| `summoner-client.test.ts` (last 3) | grep menu-bar / companion-client | **No.** |
| `summoner-hotkey.test.ts` Swift table grep | lock-step dual tables | Weak. Useful only because tables are duplicated. |
| `summoner-acl.test.ts` lifecycle grep | source position of `surface:` | **No.** Allow/deny table tests above it **are** real. |
| `summoner-journeys.test.ts` | TS helpers, “no Swift UI runner” | Partial. Tests the wrong process. |
| `summoner-protocol.test.ts` | encode/decode round-trip | Real for TS codec; **does not bind Swift**. |
| `summoner-hydrate.test.ts` | `hydratePlaintext` | **Yes** for the Node mapper. |
| `summoner-client.test.ts` (map/filter/idle/attach) | pure functions | **Yes.** |
| `composer-lease.test.ts` | CAS / gate | **Yes.** |
| `l1-actuator.test.ts` / `tool-forward-actuator.test.ts` | actuator must not be tray | **Yes.** |
| `overlay-standby.test.ts` | reducer + error parse | **Yes** (Side Panel). |
| `mcp-confirm-target.test.ts` | retarget confirm | **Yes.** |

Theater ratio on summoner tests is roughly **half the new test lines**. They exist to close Task checkboxes (“zero Allow/Deny chrome”, “never 主界面”, “sendChatCreate is fire-and-forget”) without a UI runner, stdin fixture, or compiled Swift.

`[executed]` overlay+journeys+hydrate+protocol+talk: 66 tests, 2 fail, 64 pass — the passing 64 include every grep that still matches leftover strings (`MCP · `, `检测浏览器…`, `召唤器（实验）`).

---

## What should be rewritten vs kept

### Keep (small, real, test-backed)

- `composer-lease.ts` + Side Panel standby reducer — actual dual-surface invariant.
- `summoner-acl.ts` allowlist + handshake `surface` (drop the S21 sermon).
- `l1-actuator.ts` / `forwardL1OrUnavailable` — tray must not receive `tool.execute`.
- `hydrate.ts` (25 lines) as the **single** line format. Swift should display `lines[]`, not re-prefix.
- `hotkey.ts` canonicalize + stolen set — **if** Swift stops owning a second table (generate Swift from TS, or one JSON).
- `mcp/confirm-target.ts` retarget to extension WS.
- `overlay-standby.test.ts`, lease tests, L1 tests, hydrate unit tests.

### Rewrite / cut

1. **Split `Tray.swift`.** Overlay is a third product in a pairing+confirm+HUD binary. Minimum: `Summoner.swift` compiled in the same `swiftc` line. Better: overlay process later. 1084-line `SummonerController` is not shippable as-is.
2. **One wire schema.** Either Swift decodes the TS codec, or delete `protocol.ts` encode/decode theater and document stdin as untyped JSON with a **single** golden fixture both sides load. No 25 encode functions.
3. **Delete duplicate search/talk/badge/hotkey tables from one side.** Swift search must use Node `thread.list` (or receive hits). Today’s `#` UX is a lie for any thread not in the last five menu items.
4. **Delete dead overlay chrome:** `settingsBox` + `settingsClicked`, `mcpField` + `summoner.mcp` (or un-hide it and mean it). Stop grepping `MCP · `.
5. **Fix streaming:** patch the last `NSTextStorage` range; never `tv.string = joined lines`. Drop unused `body`. Drop `try? AttributedString(markdown:)` if the contract is plaintext (comment and journeys say it is).
6. **Replace overlay grep tests** with: (a) stdin JSON fixtures → `decode` + a Swift unit if you bother to extract parse; (b) one compiled-binary smoke that sends `summoner.hydrate` and reads `summoner.ready`. Source greps are not contracts.
7. **SHA process:** `build-tray.sh` must print the file that actually holds the pin (`swift-tray-bridge.ts`), and a Swift edit without hash bump must fail CI — which it will, but only after someone rebuilds. Today the uncommitted UI cannot run.
8. **Stop commenting S-numbers.** If an invariant matters, put it in a type or a test that executes the path.

### Do not keep expanding

`menu-bar-agent.ts` must not grow another 400 lines of overlay. Extract `summoner/agent.ts` (the inbound switch already wants to be a module). HUD spike (`CMSPARK_HUD_SPIKE`) still sitting in the same file is prior debt; do not add a fourth window’s worth of comments there.

---

## Coupling / risk notes (for the next pass)

- Confirm + overlay share one stdin reader (`startStdinReader` → `handleCommand`). A hung overlay JSON line blocks pairing/confirm. No framing beyond `readline`.
- Close emits `summoner.closed` and **does not** `composer.lease.release` in the inbound handler (`handleSummonerInbound` L976–978 is a no-op). Lease sticky → Side Panel stays `OVERLAY_STANDBY` after overlay hide unless something else claims panel. Worth a product/correctness look; quality impact is “state machine lives in comments.”
- Mic PCM converter allocates `AVAudioConverter` per tap buffer (L1487). Audio-thread alloc in a 2.6k-line file nobody profiled.

---

## Evidence index

| Claim | Where |
|---|---|
| Diff scale | `origin/main...HEAD` 79 files +10082; uncommitted 18 files +356/−258 |
| Tray.swift size | WT 2594; HEAD 2670; main 1229. `SummonerController` L1511–2571 |
| menu-bar +462 | `git diff --numstat` `menu-bar-agent.ts` |
| SHA match HEAD binary, not WT Swift | pin L58 `swift-tray-bridge.ts`; `companion/dist/cmspark-tray` hash match; WT Swift dirty |
| `patchStreamingLine` | `Tray.swift:2003` |
| markdown still parsed | `Tray.swift:2047-2054` `AttributedString(markdown:)` |
| MCP hidden | `Tray.swift:1637`, `2416-2420`; overlay test L67 |
| settings dead | `Tray.swift:1886`, `2266-2330`; header has no 设置 button |
| search discarded | `menu-bar-agent.ts:730-738,945-946`; Swift `recentThreads` L1953; `fetchRecentThreads` limit 5 |
| overlay tests fail | `[executed]` tsx: fail `makePlainLine`, fail `refreshLog` in `appendToken` |
| 你　 vs 你: | HEAD write `你　`; WT write `你:`; hydrate always `你:` |
| build-tray wrong pin file | `build-tray.sh:74` |

---

**REJECT.** Do not merge HEAD or the uncommitted patch as a quality bar. Keep lease/ACL/L1/hydrate. Split the Swift god, pick one protocol, delete grep theater and dead MCP/settings chrome, fix `tv.string` streaming, rebuild+re-pin the binary, and put `#` search on a hits payload that actually returns.
)
