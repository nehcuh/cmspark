# CODE-QUALITY — os-agent-shell nits (adversarial)

| Field | Value |
|---|---|
| Lane | CODE-QUALITY (independent). Did not read other lane reports. |
| Branch | `feat/os-agent-shell` (dirty working tree vs `HEAD`) |
| Date | 2026-08-23 |
| Production code | not modified |
| Surface / L2 / compose | Overlay is L0 capture (not an L2 confirm dialect). Diff also touches L2 CU (S23 companion-ui rects, `L2_CONDUCTOR_ELSEWHERE`). Compose: none. |

## MUST checks (executed)

```
git diff --stat          34 files, +1521 / −379  (plus untracked overlay-session / l2-conductor / companion-ui-rects + tests)
shasum -a 256 companion/dist/cmspark-tray
  eae29dc748584d4de7e60c621c13da71ec633f2b33b2de1caee970196e7fb67b
SWIFT_TRAY_SHA256 in companion/src/tray/swift-tray-bridge.ts
  eae29dc748584d4de7e60c621c13da71ec633f2b33b2de1caee970196e7fb67b
```

**Pin == current binary.** [executed]  
Binary is gitignored (`companion/dist/` in `.gitignore`). Lockstep is a local artifact + a source constant, not a committed pair.

Timestamps: `Tray.swift` 22:33, `companion/dist/cmspark-tray` 22:35 — binary is newer than source on this machine. [executed]

---

## 1. Tray.swift remains a god-file — SummonerController is now the biggest room in the house

[inspected] `companion/src/tray/Tray.swift` is **2707 lines**, compiled as a **single** `swiftc` input (`companion/src/tray/build-tray.sh` only passes `Tray.swift`). Layout:

| Block | Lines | Loc |
|---|---|---|
| `buildMenu` | 157–318 | 162 |
| `handleCommand` (status + HUD + summoner kitchen sink) | 456–622 | 167 |
| `PairingController` | 623–774 | 152 |
| `ConfirmController` | 775–1019 | 245 |
| `HudController` | 1020–1314 | 295 |
| `SummonerController` | 1549–2707 | **1159** |

`SummonerController` alone is larger than most TypeScript modules in this tree. It owns: window chrome, hydrate/token/markdown log, `#` title search, hotkey picker, press-hold mic + AVFoundation capture (`SummonerMicCapture` is nested in the same file), MCP footer, settings toggles, companion-ui rect emit, IME Return handling.

This diff did **not** split it. It added `emitCompanionUiRect`, `guard isOpen` on `applyHydrate`, stolen-hotkey tables, and more protocol cases into the same file. `handleCommand` is still a 20-way string switch with pairing/HUD/summoner/quit in one function.

**Why this is a quality defect, not just aesthetics**

- Swift has **zero executable tests**. Every overlay contract is a source grep of this file (see §2). A 1159-line class is untestable in the current `swiftc Tray.swift` packaging; splitting is a prerequisite for XCTest / a protocol-only overlay target.
- Review of “did hydrate reopen a closed window?” requires finding the **second** `func applyHydrate` (HUD has the first). `summoner-talk.test.ts` even encodes that accident:

```173:182:companion/tests/summoner-talk.test.ts
test("SummonerController applyHydrate does not reopen a closed overlay", () => {
  const src = fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8")
  const start = src.indexOf("  func applyHydrate(_ json: [String: Any]) {")
  // SummonerController's applyHydrate is the second (HUD has one first)
  const summoner = src.indexOf("  func applyHydrate(_ json: [String: Any]) {", start + 10)
```

That comment is a god-file smell written into the test suite.

**Nit (non-blocking if SHA stays pinned):** extract `SummonerController` (+ hotkey Carbon helpers + `SummonerMicCapture`) to `SummonerOverlay.swift` and pass both files to `swiftc`. Update `build-tray.sh`. Do **not** do this in the same commit as a protocol change without re-pinning SHA.

---

## 2. Grep tests vs behavioral tests — the new session token is grepped, not driven, at the glue layer

Two layers of tests exist. They are not equivalent.

### Behavioral (good)

[inspected] `companion/tests/overlay-session.test.ts` (untracked, 128 lines) actually runs `hydrateOverlayIfLive` / `claimOverlayIfLive`:

- close during `selectMessages` → no hydrate, no claim
- close during claim → claim then `releaseAll`
- live hydrate claims once
- second `beginOverlaySession` invalidates the first token
- submit-style claim no-ops after close

`companion/tests/summoner-journeys.test.ts` exercises `submitSummonerTalk` / open-target / STT origin with fake deps — protocol, not overlay-session, not Swift.

`companion/tests/composer-lease.test.ts` (+229) is a real registry test.

### Grep (the overlay *integration* story)

[inspected] `companion/tests/summoner-overlay.test.ts` is almost entirely `readFileSync` + `assert.match`. The **new** overlay-session wiring in `menu-bar-agent.ts` is asserted like this:

```197:227:companion/tests/summoner-overlay.test.ts
test("hydrateSummonerThread claims overlay after hydrate (exclusive via lease SoT)", () => {
  // ...
  assert.match(body, /claimOverlayComposerLease|hydrateOverlayIfLive/)
  assert.match(body, /beginOverlaySession|overlaySessionIsLive/)
})
// ...
test("handleSummonerSubmit claims only if overlay session is still live", () => {
  // ...
  assert.match(body, /currentOverlaySession/)
  assert.match(body, /claimOverlayIfLive/)
})
```

OR-regexes (`beginOverlaySession|overlaySessionIsLive`, `claimOverlayComposerLease|hydrateOverlayIfLive`) pass if **either** identifier appears anywhere in a sliced function. They do not:

- call `handleSummonerReady` / `handleSummonerClosed` / `handleSummonerSubmit`
- race ready vs closed
- prove `beginOverlaySession` is **not** minted after close
- prove `hydrateSummonerThread` return `false` skips `touchSummonerActivity`

The same file greps Tray.swift for copy (`说点什么`, `不能替你打开侧栏`, `MCP · `) and for stdin cmd strings. That is a copy lock, not a behavior lock. `summoner-talk.test.ts`, `summoner-hotkey.test.ts`, `summoner-client.test.ts`, `l2-conductor.test.ts` (`assert.match(src, /gateChatCreateOnConductor/)`) continue the pattern.

**Consequence:** the only executable coverage of the new generation token is the 58-line helper in isolation. The 1491-line `menu-bar-agent.ts` orchestrator — the place the token can be minted at the wrong time — is grepped.

**Required follow-up (nit, but the cheapest high-value test in this lane):** export `hydrateSummonerThread`’s collaborators as they already are (`selectThreadMessages`, `claimOverlayComposerLease`) and drive `handleSummonerReady` + `handleSummonerClosed` with a fake client + fake `trayInstance`. One test for “closed during `listThreads` does not `beginOverlaySession` afterwards” would beat twenty regexes.

---

## 3. Discarded booleans — hotkey arming and inbound fire-and-forget

### 3a. `@discardableResult registerSummonerHotKey` — fail is persisted as success

[inspected]

```1384:1400:companion/src/tray/Tray.swift
/// Best-effort Carbon registration. False = combo persisted but not armed.
@discardableResult
func registerSummonerHotKey(combo: String) -> Bool {
  // ...
  return status == noErr
}
```

Call sites throw the Bool away:

```584:587:companion/src/tray/Tray.swift
  case "summoner.hotkey.set":
    let combo = (json["combo"] as? String) ?? ""
    _ = registerSummonerHotKey(combo: combo)
    summonerController.noteHotkeyConfigured()
```

```1760:1765:companion/src/tray/Tray.swift
  private func chooseHotkey(_ combo: String) {
    guard summonerHotKeyCandidates.contains(where: { $0.combo == combo }) else { return }
    if summonerHotKeyStolen.contains(where: { $0.combo == combo }) { return }
    _ = registerSummonerHotKey(combo: combo)
    jsonLine(["type": "summoner.hotkey.chosen", "combo": combo])
    noteHotkeyConfigured()
  }
```

Comment says False = persisted but not armed. `chooseHotkey` still emits `summoner.hotkey.chosen`. Node then **discards** the persist result too:

```1026:1028:companion/src/menu-bar-agent.ts
    case "summoner.hotkey.chosen":
      persistSummonerHotkeyChosen(evt.combo)
      return
```

`persistSummonerHotkeyChosen` returns `string | null`. Caller ignores it, then `saveConfig` + `encodeSummonerHotkeySet` round-trip a combo that may never have `RegisterEventHotKey`’d. User sees picker close (`noteHotkeyConfigured`) with no failure path.

### 3b. Inbound handler discards every interesting Bool

[inspected] `handleSummonerInbound`:

| Call | Return | Discarded how |
|---|---|---|
| `handleSummonerSubmit` | `Promise<boolean>` | `void` |
| `handleSummonerSearch` | hits cmd | `void` |
| `handleSummonerContinue` | `boolean` | bare call, no `void`, no check |
| `persistSummonerHotkeyChosen` | `string \| null` | ignored |
| `handleSummonerNewThread` | `Promise<boolean>` | `void` |
| `handleSummonerReady` / `Closed` | `Promise<void>` | `void` (no serialization) |

Swift `submitComposer` already appended `你: …` before `summoner.submit`. A `false` from `claimOverlayIfLive` is invisible to the overlay. That is a discarded boolean with a user-visible desync, not a lint curiosity.

### 3c. Smaller discards

- `applyCompanionUiRectEvent` returns `boolean`; `swift-tray-bridge.ts` calls it in try/catch and ignores the Bool. The function does not throw on parse failure — the catch is dead. [inspected]
- HUD `applyHydrate` still does `_ = dual["conclusions"]` / `_ = dual["steps"]` as a crash-avoidance no-op. Pre-existing, still noise.

---

## 4. overlay-session vs menu-bar-agent coupling

Extracting `companion/src/summoner/overlay-session.ts` (58 lines, process-global `generation` + `live`) is the right move. The glue in `menu-bar-agent.ts` undoes half of it.

### 4a. Token is minted at hydrate/new-thread, not at overlay-open

[inspected] `beginOverlaySession()` is called from:

- `hydrateSummonerThread` (every hydrate, including 1-hit search and select)
- `handleSummonerNewThread`

It is **not** called when Swift emits `summoner.ready`. `handleSummonerReady` awaits `listThreads()` **before** either helper mints a token:

```671:703:companion/src/menu-bar-agent.ts
export async function handleSummonerReady(): Promise<void> {
  // ...
  const threads = (await client?.listThreads()) ?? []
  const target = resolveSummonerOpenTarget({ ... })
  if (target.action === "create") {
    await handleSummonerNewThread()
  } else {
    await hydrateSummonerThread(target.threadId)
  }
  if (overlaySessionIsLive(currentOverlaySession()) && summonerThreadId) {
    touchSummonerActivity(summonerThreadId)
  }
}

export async function handleSummonerClosed(): Promise<void> {
  invalidateOverlaySession()
  // ...
}
```

Inbound is fire-and-forget (`void handleSummonerReady()` / `void handleSummonerClosed()`). Race:

1. `summoner.ready` starts, awaits `listThreads`
2. `summoner.closed` invalidates (live=false)
3. ready resumes, `hydrateSummonerThread` → `beginOverlaySession()` → **live again**, hydrate + claim against a closed panel

`hydrateOverlayIfLive` cannot save this: the token was minted **after** close. The helper tests never see this because they never run `handleSummonerReady`.

The same mint-on-hydrate conflates two generations:

- overlay-open lifetime (should follow Swift `ready`/`closed`)
- in-flight hydrate invalidation (should bump when switching threads **while open**)

One process-global counter does both. Search/select while a submit is in flight changes `currentOverlaySession()` under `handleSummonerSubmit`’s captured token — that part is intended. Resurrecting live after close is not.

### 4b. Singleton module state

[inspected] `let generation = 0; let live = false` is process-wide, like `composerLeases` in `composer-lease.ts` (“Process-wide SoT”). Tests in `overlay-session.test.ts` reset via `invalidateOverlaySession()` at the start of each case — they share the production singleton. Fine under `node:test` sequential default; hostile to parallel or to any future second overlay.

`menu-bar-agent.ts` is itself a 1491-line god-module (`trayInstance`, `summonerClient`, `summonerThreadId` as file-level mutables). overlay-session is a small island imported into that sea. Coupling is “helper is pure-ish; orchestrator is not injectable,” which is why glue is grepped.

**Fix shape (nit, structural):** mint once in `handleSummonerReady` (or on first inbound after open), pass that token into hydrate/new-thread, invalidate only in `handleSummonerClosed`. Hydrate-while-open can bump a *child* seq without flipping `live`. Serialize inbound overlay RPCs (a one-promise chain) instead of `void` races.

---

## 5. Drive-by diffs — in-epic, still a mixed blob

[inspected] Dirty tree is one epic, not random whitespace, but it is several reviews’ worth of blast radius in one uncommitted set:

| Cluster | Files | Why it is (or isn’t) drive-by |
|---|---|---|
| Overlay session | `overlay-session.ts`, `menu-bar-agent.ts`, `summoner/*`, tests | In scope |
| Composer lease | `composer-lease.ts` +229, `validate.ts`, `summoner-acl.ts`, `lifecycle.ts` | In scope (close releases overlay) |
| S23 companion-ui rects | `Tray.swift` emit, `companion-ui-rects.ts`, `swift-tray-bridge.ts`, `executor.ts`, `self-ui.ts`, `config.ts` strip `cmspark-tray` | Related (overlay must not silent-continue CU) but a **second** security semantic |
| L2 conductor | `l2-conductor.ts`, `message-router.ts`, grep test | Related (overlay must not conduct while CU LIVE) — third semantic |
| Overlay copy | `agentStore.tsx` label rewrite + `overlay-standby.test.ts` | Copy-only lockstep; tests updated. Fine, but not session-token work |
| `toolChatErrorPayload` | `l1-actuator.ts`, `llm/adapter.ts`, classify-error test | Overlay CTA needs top-level `error_code` — related, slightly sneaky in adapter |
| Design HTML | `docs/design/os-summoner-p0-chosen.html` | Docs in a code nits round |

Not a “fix a typo in unrelated production code” drive-by. It **is** a merge-hygiene problem: S23 deny-list + conductor gate + session token + SHA pin + copy can fail independently. A pin mismatch would block tray start while a copy string would not.

`config.ts` now **mutates** `cfg.security.companion_ui_exe_basenames` in place inside `stripCompanionUiProcessContinueDeny` (load + save). Side-effecting sanitizer is a quality smell even if S23 is right.

---

## 6. Lockstep SHA pin vs binary — match today, process is still manual and mis-documented

[executed] Pin and `companion/dist/cmspark-tray` are identical (`eae29dc7…`). Comment in `swift-tray-bridge.ts`: `Updated 2026-08-23 after R3 applyHydrate no-reopen`.

What is **not** lockstep:

1. **Binary is not in git.** `.gitignore` → `companion/dist/`. CI/clone without a rebuild has no binary; `SwiftTrayAdapter.start()` refuses on hash mismatch and will **not** auto-rebuild (by design, TOCTOU). A stale dist from a previous branch vs a new pin = tray dead.

2. **No unit test hashes the real binary.** `companion/tests/swift-tray-integrity.test.ts` writes dummy files and **asserts `ok: false`**. Comment: “We can't fake the production SWIFT_TRAY_SHA256 in a unit test, so the success-path (ok:true) is exercised by the integration build path.” There is no integration test in this diff that `checkIntegrity(getSwiftTrayPath()).ok === true`.

3. **`build-tray.sh` points at the wrong file:**

```71:74:companion/src/tray/build-tray.sh
BINARY_HASH=$(shasum -a 256 "${OUTPUT_BIN}" | awk '{print $1}')
echo "[build-tray]         SHA256: ${BINARY_HASH}"
echo "[build-tray]         Update SWIFT_TRAY_SHA256 in menu-bar-agent.ts with this hash"
```

The constant lives in `swift-tray-bridge.ts`, not `menu-bar-agent.ts`. A conscientious rebuild following the script’s last line updates a file that does not contain the pin.

4. **`scripts/build-swift-tray.js` writes the hash to `~/.cmspark-agent/.swift-tray.sha256`** and never patches `SWIFT_TRAY_SHA256`. npm-install rebuilds the binary, leaves the source pin stale, and tray start then refuses the binary it just built. [inspected]

5. Pin was updated in this dirty tree (`267e24b2…` → `eae29dc7…`) together with Tray.swift — **this machine is consistent**. The next Tray.swift edit without a pin edit is a silent trap the grep tests will not catch (`summoner-overlay.test.ts` does not hash anything).

**Nit:** one test, darwin-only, skip if binary missing:

```ts
assert.equal(checkIntegrity(getSwiftTrayPath()).ok, true)
```

And fix the `build-tray.sh` echo to `swift-tray-bridge.ts`. Optionally print a `sed` snippet. Do not auto-edit the pin from npm-install (integrity policy forbids auto-rebuild on mismatch; auto-pin would be the same class of footgun).

---

## What is actually good (so the nits stay nits)

- `overlay-session.ts` is small, typed (`"claimed" | "abandoned"`), and the helper tests are real. That is the opposite of a god-file.
- `applyHydrate` `guard isOpen else { return }` + removal of `open(threadId:)` reopen is the right Swift contract; SHA comment names it.
- Composer lease `releaseAllOverlay` / `release_overlay` + lifecycle broadcast is structured SoT, not another ad-hoc flag on `summonerThreadId`.
- S23 “tray is not a process-level self-UI continue” is consistent across `self-ui.ts`, `config` strip, executor click/scroll/drag.

Those do not cancel §1–§6.

---

## Nits list (non-blocking, should still be done)

1. Split `SummonerController` (+ mic + Carbon hotkey) out of `Tray.swift`; keep SHA pin in the same change set as the rebuild.
2. Replace menu-bar-agent overlay grep tests with one fake-client race: ready vs closed vs submit.
3. Do not discard `registerSummonerHotKey` — emit `summoner.hotkey.error` (or skip `chosen`) on `false`; check `persistSummonerHotkeyChosen` return.
4. Mint overlay-session on ready, invalidate on closed; do not `beginOverlaySession` inside hydrate after an await that can interleave close.
5. Serialize `handleSummonerInbound` overlay cases (single chain) instead of `void` races.
6. Fix `build-tray.sh` pin path; add darwin `checkIntegrity(realBin).ok === true`.
7. Keep S23 / conductor / copy in named commits if this becomes a PR, not one 34-file blob.

---

Lane: CODE-QUALITY. Independent. Production untouched.

VERDICT: APPROVE_WITH_NITS
