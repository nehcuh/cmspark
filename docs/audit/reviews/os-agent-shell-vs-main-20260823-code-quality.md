# Code quality / maintainability — `feat/os-agent-shell` working tree vs `origin/main`

**Lane:** CODE QUALITY / MAINTAINABILITY (hostile to AI-slop, grep tests, god files, dual implementations)  
**Scope:** `git diff origin/main` + `git diff HEAD` + untracked `src/` / `tests/`  
**HEAD:** `659bbce` (`feat/os-agent-shell`, 1 commit ahead of `origin/feat/os-agent-shell`)  
**Date:** 2026-08-23  
**READ-ONLY.** No source edits.

Evidence tags: `[executed]` ran git/wc/shasum; `[inspected]` read the path.

---

## VERDICT: **REJECT**

Not because the overlay idea is wrong. Because this branch ships a **spike that calcified**. The TypeScript seams that *were* extracted are the right shape. The Swift UI, the stdin protocol, and the test suite are the opposite: one 2.7k-line god file, a typed codec that the only consumer ignores, dual tables for search/hotkey/hydrate, and a wall of `readFileSync` greps that treat string literals as law.

Merge as-is and every later overlay change is a 1100-line class plus a regex that forbids the word `确认`.

---

## 1. Scale of change vs capability delivered

| Bucket vs `origin/main` | Files | Δ | `[executed]` |
|---|---|---|---|
| `companion/src` + `chrome-extension/src` | 31 | **+4125 / −80** | numstat |
| tests | 26 | **+2539 / −7** | numstat |
| `docs/` | 19 | **+3944 / −1** | numstat |
| **total (committed range)** | **80** | **+10691 / −125** | `git diff --stat origin/main` |
| uncommitted WT | 27 | **+938 / −332** | `git diff --stat HEAD` |
| untracked src/tests | 5 | **+311** | `wc -l` |

Capability actually delivered vs main:

- macOS overlay as a third lazy window on the existing tray binary
- second WS (`surface: "summoner"`) + ACL
- `composer.lease` CAS so Side Panel goes standby
- L1 actuator pick so overlay chat does not `tool.execute` on the tray socket
- title-only `#` search, press-hold mic → local STT, idle/resume settings
- uncommitted: S23 companion-UI click denials + L2 conductor gate

That is one product surface. **~4k source lines, ~2.5k tests, ~4k docs** is not proportional. Docs and grep-locks are a large fraction of the 10k. Deletions vs main are essentially zero (`−80` src) — this is accretion, not judo.

The uncommitted slice (`companion-ui-rects.ts` 79, `l2-conductor.ts` 32, behavioral tests) is closer to the complexity the feature deserved. The committed overlay is the debt.

---

## 2. God objects

### 2.1 `Tray.swift` — confirmed 1229 on main, 2708 in WT

`[executed]` `git show origin/main:companion/src/tray/Tray.swift | wc -l` → **1229**.  
WT → **2708** (**+1479**). HEAD was 2670; WT added another 38.

Main already bundled tray menu + pairing + confirm + HUD in one file. That was the warning. This branch added a third window **in the same file** instead of splitting.

Section sizes in WT `[executed]`:

| Region | Lines | Role |
|---|---|---|
| `TrayDelegate` + stdin `handleCommand` | ~300 + ~160 | pre-existing multiplexer, now 14 extra `summoner.*` cases |
| `PairingController` | ~152 | pre-existing |
| `ConfirmController` | ~245 | pre-existing L2 chrome |
| `HudController` | ~295 | pre-existing confirm HUD |
| **`SummonerController`** | **1549–2708 = ~1160** | **new god class** |

`SummonerController` owns: window construction, tokens, hydrate, snapshot tokens, markdown transcript, `#` search UI, hit list, hotkey picker, settings panel, mic/WAV, MCP label, CTA chrome, lease-adjacent visibility, S23 rect emit, IME, layout math. One type, one file, three protocols.

The 1k-line bar is not a style nit here. **The PR takes an already-over-1k file and more than doubles it.** There is no structural reason this had to live next to pairing/HUD besides “same stdin pipe.” The pipe is a process boundary, not a file boundary.

### 2.2 `menu-bar-agent.ts` — 966 → 1454, newly over 1k

`[executed]` main **966**, WT **1454** (**+488**).

This file was the tray orchestrator (status, autostart, notifications). It now also owns the entire overlay session: second `CompanionClient`, hydrate, search, select, STT start/chunk/end/wav, MCP list, idle policy, lease claim/release. ~400 lines of `handleSummoner*` sit in the launcher.

`summoner/client.ts` (482) already exists as “pure helpers so tests don't boot menu-bar.” The remaining handlers should have moved there (or to `summoner/session.ts`). Instead the launcher grew a second personality.

### 2.3 `protocol.ts` (440) + `client.ts` (482) — ceremony without a consumer

28 `encodeSummoner*` functions `[executed]`. Almost all are identity wrappers:

```118:134:companion/src/summoner/protocol.ts
export function encodeSummonerOpen(p: SummonerOpenPayload): SummonerOpenCmd {
  return { cmd: "summoner.open", thread_id: p.thread_id }
}
// … 26 more of the same
export function encodeSummonerHydrate(p: SummonerHydratePayload): SummonerHydrateCmd {
  return {
    cmd: "summoner.hydrate",
    thread_id: p.thread_id,
    lines: p.lines,
    browser: p.browser,
    search_hint: p.search_hint,
  }
}
```

Decode then **re-encodes** via those wrappers. Swift never calls any of this. The header still claims a smaller dialect:

```1:12:companion/src/summoner/protocol.ts
/**
 * Summoner overlay stdin codecs (window / hotkey / hydrate only).
 * …
 * Plan: docs/superpowers/plans/2026-08-22-os-agent-shell-p0-spike.md Task 7
 */
```

That comment is false. The union now includes mic, settings, hits, mcp, tool, dictate, new_thread. Comments as laws that have already drifted.

### 2.4 Pre-existing giants, lightly touched

`message-router.ts` 3448 → 3481. `executor.ts` stays 1677 with S23 asserts spliced into the click/scroll/drag arms. Not new gods, but the overlay did not earn the right to keep growing them with one-off calls.

---

## 3. Hunt findings

### 3.1 TS protocol vs Swift dictionaries — dual implementations of the wire

TS: closed union + decode that returns `null` on confirm dialect / bad shape.  
Swift: `[String: Any]` + `as?` + default `""`.

```33:38:companion/src/tray/Tray.swift
func jsonLine(_ dict: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: dict),
     let str = String(data: data, encoding: .utf8) {
    print(str, terminator: "\n")
```

```563:565:companion/src/tray/Tray.swift
  case "summoner.hydrate":
    summonerController.applyHydrate(json)
```

`applyHydrate` / `applyHits` / `applySettings` take raw dictionaries. `search_hint` is required and exact-match in TS (`SUMMONER_SEARCH_HINT`); Swift never reads it. A hydrate missing `browser` becomes `"detached"` silently. The codec is a Node unit-test toy. The only runtime parser is untyped.

**Code judo:** one Codable (or a tiny generated schema) on both sides. Delete the 28 encoders. `JSON.stringify(cmd)` is the encoder.

### 3.2 Duplicated search / hydrate / hotkey / snapshot

| Concept | TypeScript | Swift | Lock |
|---|---|---|---|
| `#` search? | `isSummonerSearchQuery` / `summonerSearchNeedle` | `isSearchQuery` / `searchNeedle` | grep `hasPrefix("#")` |
| Title filter | `filterThreadsByTitle` + `summonerHitsFromQuery` | `refreshHits` + `applyHits` (Node is SoT; Swift also filters empty needle locally) | overlay + talk greps |
| Hydrate cap 20 | `HYDRATE_CAP` in `hydrate.ts` | `capLines()` + `rawLines.suffix(20)` | overlay grep `suffix(20)` |
| Token snapshot | `overlayAssistantSnapshot` in `client.ts` | `appendToken` in `SummonerController` | overlay grep `助手: " \+ text` |
| Hotkey tables | `SUMMONER_HOTKEY_CANDIDATES` / `STOLEN` | `summonerHotKeyCandidates` / `summonerHotKeyStolen` | `summoner-hotkey.test.ts` greps Swift strings against TS |
| Idle minutes | `normalizeResumeIdleMinutes` | `isResumeIdleMinutes` in protocol + Swift `tag` | none; they can diverge |

`overlayAssistantSnapshot` is **not called from production** `[inspected]` — only from tests. Swift reimplemented it. That is a dual implementation plus a dead helper kept so the test file looks like it covers streaming.

Hydrate is the one place that *did* extract (`hydrate.ts` is 25 lines and honest). Swift then re-caps at 20 and re-prefixes `你:` / `助手:` for display. Fine if display-only; not fine that tests grep both copies.

### 3.3 Comments-as-laws

The branch encodes product law in comments and then greps the comments.

- File headers: “UI lock”, “S8 / UI lock”, “S11”, “S20”, “S21”, “S23”, “Task 7/8/9”, “P0 capture overlay”.
- `shouldStartNewSummonerThread` documents idle timeout, then **ignores `now` and `lastActivityAt`**:

```182:192:companion/src/summoner/client.ts
/** After idle timeout, the next overlay open starts a new thread. 0=always new, -1=always resume.
 *  Missing lastActivityAt (first install) resumes the latest thread — never auto-create.
 */
export function shouldStartNewSummonerThread(args: {
  now: number
  lastActivityAt?: number | null
  resumeIdleMinutes: number
}): boolean {
  if (args.resumeIdleMinutes === 0) return true
  return false
}
```

`menu-bar-agent.ts` still passes `now` / `lastActivityAt`. Settings UI still offers 10/30 minutes. The comment is the spec; the function is a stub; journeys tests lock the stub. That is comments-as-laws plus a test that protects the lie.

- Overlay tests forbid substrings **including Chinese UI words** (`允许|拒绝|Allow|Deny|确认`, `主界面`, `P0 `, `召唤器 · 实验`). You cannot write a comment in `SummonerController` that says “not a 确认 surface” without failing CI.
- `build-tray.sh` still prints: `Update SWIFT_TRAY_SHA256 in menu-bar-agent.ts` — the constant moved to `swift-tray-bridge.ts` on this branch. The comment is now a wrong law.

### 3.4 Dead chrome kept for greps

`[inspected]` `applyPhase()` **unconditionally**:

```2226:2239:companion/src/tray/Tray.swift
    ctaBox?.isHidden = true
    attachButton?.isHidden = true
    silentAttachButton?.isHidden = true
    …
    micButton?.isHidden = true
```

`applyMcp` always `mcpField?.isHidden = true`.  
`settingsClicked()` is **defined and never wired** to a button `[inspected]`. Overlay tests explicitly `doesNotMatch` `NSButton(title: "设置"`.

Yet `makeWindow()` still builds: warn CTA box, “后台使用 Chrome”, “激活 Google Chrome”, MCP line, 🎙 button + `SummonerMicCapture` + WAV encoder. Tests require the strings:

- `🎙`, `summoner.mic.start`, `summoner.dictate`
- `MCP · `
- `不能替你打开侧栏`, `ctaBox?.isHidden = true`
- `召唤器（实验）`

So the chrome cannot be deleted (greps fail) and cannot be shown (phase hides it / selector unwired). This is the slop signature: **keep the spike widgets, hide them, lock the source**.

Also dead: `patchStreamingLine(_:)` — defined, never called `[inspected]`. Parameter unused. Leftover from a bubble → plaintext rename.

### 3.5 SHA pin process

`[executed]`

| Pin | Value |
|---|---|
| `origin/main` | `ebd1ee4a…` |
| HEAD | `267e24b2…` |
| WT | `8b1d0619…` |
| `companion/dist/cmspark-tray` | **`8b1d0619…` (matches WT)** |

Mtimes for `Tray.swift`, `swift-tray-bridge.ts`, and the binary are all `23 Aug 19:37`. This snapshot *did* rebuild and paste. That is the good news.

The process is still:

1. Edit Swift.
2. Run `build-tray.sh`.
3. Manually paste SHA into a **different file than the script names**.
4. Hope the comment `// Updated 2026-08-22 after summoner v2 talk + press-hold mic` gets updated (it did not; today is 2026-08-23 and the hash is for S23 rects).

No test asserts `getExpectedHash()` equals `shasum` of the artifact. Integrity check refuses mismatch (good, TOCTOU story is real) but the **developer loop is comment-driven**. One missed paste and local tray is a hard fail that looks like a compromise.

`build-tray.sh` pointing at `menu-bar-agent.ts` is a process bug, not a nit.

### 3.6 Uncommitted identity / S23 / markdown vs original spike slop

**Keep this direction.** The uncommitted files are the first modules that look like they belong in this repo:

- `companion-ui-rects.ts` (79): typed rect map, hide, hit-test, `ComputerError`. Tests call the functions, they do not grep `executor.ts`.
- `l2-conductor.ts` (32): one gate, one error code. The extra test that greps `message-router.ts` for `gateChatCreateOnConductor` is the only regression to the spike style.
- `summoner-journeys.test.ts` (98): actually invokes `submitSummonerTalk` / `filterThreadsByTitle` / ACL. This is what `summoner-overlay.test.ts` should have been.

`docs/superpowers/specs/2026-08-23-os-agent-shell-user-journeys.md` is tighter than the 732-line P0 spike plan and the HTML option dump. It still treats “Tray source-lock” as verification, which freezes the grep culture.

S23 wiring into `executor.ts` is three copy-pasted `assertClickClearsCompanionUi` calls in click/scroll/drag arms — spaghetti growth in an already-busy dispatcher. A single “pointer action → screen point” helper would delete the repetition.

Identity of the overlay (`com.cmspark.agent`, `emitCompanionUiRect` Quartz-top-left) is commented against `host.swift kCGWindowBounds`. That comment is load-bearing and fine. The failure is stuffing the emitter into the same 2708-line file.

---

## 4. Grep tests (the maintainability kill shot)

`readFileSync` on production source `[executed]`:

| File | `readFileSync` count |
|---|---|
| `companion/tests/summoner-overlay.test.ts` | 11 |
| `companion/tests/summoner-talk.test.ts` | 8 |
| `chrome-extension/tests/overlay-standby.test.ts` | 4 |
| `companion/tests/summoner-client.test.ts` | 3 |
| `companion/tests/summoner-acl.test.ts` | 2 |
| `companion/tests/composer-lease.test.ts` | 2 |
| `companion/tests/summoner-hotkey.test.ts` | 1 |
| `companion/tests/l2-conductor.test.ts` | 1 |

`summoner-overlay.test.ts` slices `Tray.swift` from `private let summonerWindowTitle` to `let summonerController = SummonerController()` and regex-matches copy, class names, and *absence* of other copy. Rename `applyPhase`, extract a file, or write a comment containing `确认`, and CI goes red with no user-visible change.

`overlay-standby.test.ts` slices `useWebSocket.ts` `case "chat.error"` and asserts dispatch *order* by string index (`SET_OVERLAY_STANDBY` before `ADD_MESSAGE`). That is not a React test. It is a formatter-hostile source lock.

This is worse than missing tests. **Behavioral tests exist** (`hydratePlaintext`, lease CAS, journeys, rects) and they are drowned by grep volume. Future authors will keep the greps green and the UI hidden, because that is the cheaper path.

---

## 5. Other structural smells (not the headline, still real)

- **`composer-lease.ts` (294):** registry is clean. `claimOverlayLeaseCas` and `releaseOverlayLeaseCas` are copy-paste retry loops. `stampCmsparkSurface(msg: any)` mutates in place — the comment says “never trust client-supplied `__cmspark_surface`” while the type is `any`.
- **`handleSummonerMic`:** four event types, two transports (PCM stream vs one-shot WAV), session id in module globals on the launcher. Should be a small state machine in `summoner/`, not a 90-line switch in `menu-bar-agent.ts`.
- **`client.ts` mix:** title search, talk/submit, STT WAV framing, Chrome attach copy, idle policy. Four modules pretending to be one “client.”
- **HUD `applyHydrate` dual_track no-op** (pre-existing, still in the same file you now have to edit for overlay): `_ = dual["conclusions"]` — dead chrome from the HUD spike, same pattern the overlay copied.
- **Test:src ratio** looks healthy until you subtract greps. Real new logic tests: hydrate, protocol round-trip, lease CAS, rects, journeys, l1-actuator. Keep those.

---

## 6. BLOCK / MAJOR / NIT

### BLOCK

1. **`Tray.swift` 1229 → 2708; `SummonerController` ~1160 lines.** Split before merge. Same-process windows are not a license for one compilation unit. This is the 1k-line rule with no waiver.
2. **Grep/source-lock suite as the overlay CI.** `summoner-overlay.test.ts`, `summoner-talk.test.ts` (Swift/menu-bar slices), `overlay-standby.test.ts` source-order asserts, hotkey table greps. Replace with function tests + (if you must) a Swift package test. Do not merge a UI whose invariants are `doesNotMatch(/确认/)`.
3. **Typed TS protocol unused by Swift.** Either Codable on the Swift side that shares the union, or stop pretending `protocol.ts` is the wire. Dual parsers will drift (already: `search_hint` required in TS, ignored in Swift).
4. **Dead chrome kept to satisfy greps** (CTA/attach/mic always hidden, `settingsClicked` unwired, MCP field force-hidden, `patchStreamingLine` unused). Delete or ship. Hidden-and-locked is not a product.

### MAJOR

5. **`menu-bar-agent.ts` crossed 1k** by absorbing overlay session. Move `handleSummoner*` out.
6. **Duplicated search / hydrate cap / hotkey tables / token snapshot.** One table, one needle function, one snapshot. Swift should apply payloads, not re-specify policy. Delete unused `overlayAssistantSnapshot` or actually call it (from a shared snapshot applied in Node before stdin — even better).
7. **SHA pin is a paste ritual.** Fix `build-tray.sh` path (`swift-tray-bridge.ts`, not `menu-bar-agent.ts`). Generate or verify the constant in CI. Stale “Updated 2026-08-22…” comment is the same class of bug.
8. **`shouldStartNewSummonerThread` is a stub whose comment and settings UI claim 10/30-minute idle.** Either implement or delete the parameters and the 10/30 buttons. Tests that lock `return false` are protecting unfinished work.
9. **S23 asserts copy-pasted into three `executor.ts` arms.** One helper at the pointer boundary.

### NIT

10. Protocol file header still says “hydrate only.”
11. 28 encode wrappers — `as const` objects are enough.
12. `stampCmsparkSurface(msg: any)`.
13. `l2-conductor.test.ts` grepping `message-router.ts` — one-line source lock on an otherwise good module.
14. Journeys spec listing “Tray source-lock” as the verify step — stop documenting the anti-pattern.
15. `composer-lease` CAS retry duplication.

---

## 7. What to keep vs rewrite

### Keep (do not churn)

- `summoner/hydrate.ts` — small, correct layer.
- `ws/l1-actuator.ts`, `ws/summoner-acl.ts`, uncommitted `l2-conductor.ts`, `computer/companion-ui-rects.ts`.
- `ComposerLeaseRegistry` + CAS *idea* (collapse the two retry functions).
- Behavioral tests: hydrate, protocol round-trip of *decode*, lease claim/retry, journeys, rects, l1-actuator, `attachChromeOnly`.
- Uncommitted S23 coordinate space comment + `emitCompanionUiRect` (move with the overlay module).
- Product constraints themselves (no overlay confirm dialect, no default Spotlight chord, overlay ≠ `openSidePanel`). Encode them in types and runtime gates, not in `doesNotMatch`.

### Rewrite before merge

- **`SummonerController` out of `Tray.swift`.** Minimum: `Summoner.swift` (window + stdin cmds). Better: window / transcript / search / mic as separate types. `handleCommand` stays a switch that forwards.
- **Swift Codable (or shared JSON schema) for summoner cmds/evts.** Delete encode* boilerplate.
- **Grep tests → delete.** If Swift is untested in CI, say so in the journeys spec (it already does) instead of fake-locking source.
- **Dead overlay chrome → delete.** Mic either visible or the capture class goes with it. CTA/attach either shown on detached or handlers die.
- **`menu-bar-agent` summoner session → `summoner/`.** Launcher wires tray callbacks only.
- **Hotkey tables:** TS owns combos; Swift loads from stdin `summoner.hotkey.catalog` *or* a generated `.swift` snippet. Stop grepping both.

### Code judo (the simpler product)

The overlay is a **plaintext composer + hydrate lines + a second WS**. It does not need: hidden CTA stack, hidden MCP row, unused settings selector, 28 encoders, snapshot helper that Swift ignores, or a 1160-line class.

A file layout that would have made this an APPROVE:

```
companion/src/tray/Tray.swift          # menu + stdin dispatch only (aim ≤ main's 1229, preferably less)
companion/src/tray/Summoner.swift      # overlay window
companion/src/summoner/protocol.ts     # types + parse, no encode circus
companion/src/summoner/session.ts      # what menu-bar-agent grew
companion/src/summoner/hydrate.ts      # keep
companion/src/ws/{lease,acl,l1,l2}     # keep as now
```

That is a split, not a rewrite of behavior.

---

## 8. Approval bar (this skill)

| Bar | Status |
|---|---|
| No structural regression | **Fail** — Tray.swift 2.2×, menu-bar newly >1k |
| No obvious judo left on the table | **Fail** — extract overlay; delete greps; one protocol |
| No unjustified file-size explosion | **Fail** |
| No spaghetti / special-case growth | **Fail** — executor S23 copies; always-hidden phase flags |
| No hacky/magical abstraction | **Fail** — codec unused by the UI; comments/greps as law |
| No dual helpers / wrong layer | **Fail** — search, hotkey, hydrate cap, snapshot |

Uncommitted S23/L2 modules would pass this bar **in isolation**. They do not rescue the committed overlay.

---

## 9. Summary

`origin/main` `Tray.swift` is **1229 lines** `[executed]`. Working tree is **2708**, of which **`SummonerController` is ~1160**. `menu-bar-agent.ts` **966 → 1454**. Against main: **+4.1k src / +2.5k tests / +3.9k docs** for one macOS capture overlay.

The TS side grew several honest small modules. The Swift side absorbed a spike. Tests froze the spike’s strings, including chrome that `applyPhase()` now hides. The protocol is typed in Node and a dictionary in Swift. SHA pin matches this snapshot `[executed]` but the update loop is still a stale comment in the wrong file.

**REJECT.** Split the overlay out of `Tray.swift`, kill grep tests, one wire format, delete dead chrome. Then this is a maintainable feature instead of a second HUD spike in the same binary.

---

*Independent CODE QUALITY review. Did not read `docs/audit/reviews/os-agent-shell-20260823-*.md`.*
