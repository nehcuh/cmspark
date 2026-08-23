# PRODUCT/UX adversarial review — OS overlay vs origin/main

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Reviewer | Independent PRODUCT/UX (Chinese macOS CMspark user) |
| Scope | Current worktree **including uncommitted `Tray.swift`** vs `origin/main` (main has **no** overlay) |
| Evidence | `[inspected]` source + chosen HTML + journeys spec. Swift window **not clicked**; hashed tray binary is not this uncommitted source. |
| Isolation | This file only. No source edits. |

**Baseline.** `origin/main` at `fc18725`: Chrome Side Panel is the only L0. Quit Chrome → product gone.

**Delta.** macOS menu-bar overlay that claims: Chrome can quit, same thread still talks; overlay is **not** 主界面.

**Persona.** 我日常用 Side Panel 投研/纪要。中文输入法。菜单栏 CMspark 我知道，但没有默认热键。我不会读 brief。我只看窗口上的字。

---

## Verdict

**REJECT**

Capability vs main is real and worth an **实验**. Current uncommitted polish is **not honest enough to ship** to that same user: the only empty-state sentence sells a mic that `applyPhase` permanently hides; the Chrome-quit path (the reason this overlay exists) hides 发送, hides attach, and writes English `BROWSER_UNAVAILABLE` into the log; first-open is a 310pt hotkey exam sitting on top of “先说话”. Fold the lies, then this is an APPROVE_WITH_NITS candidate — not before.

I would **open it once**. I would **not** make it a habit.

---

## Honesty audit vs claims

Claims from identity lock, chosen.html, journeys, ship note. Judged against **current** source (uncommitted Swift + TS).

| Claim | What the user actually gets | Honest? |
|-------|-----------------------------|---------|
| Chrome 退出仍能在**同一 thread** 说话 | Menu `召唤器（实验）…` → `summoner.ready` → `resolveSummonerOpenTarget` hydrates last or newest; empty submit uses newest then create. `[inspected]` `client.ts:198-211`, `menu-bar-agent.ts:653-674` | **True** (protocol). First paint still `open(threadId: "")` then hydrate — brief empty flash. |
| Overlay **不是**主界面；完整工作面在侧栏 | Title never 「主界面」. Card dropped 「召唤器 · 实验」 chip and header 「设置」. Still a titled+closable `NSPanel` named `CMspark 召唤器（实验）` with 新对话 + markdown assistant column + 新对话 control. Side note 「完整格式在侧栏」 only when attached + has transcript. | **Mostly true in copy, false in form.** Mini chat, not a capture card. |
| 「实验」只出现一次（窗口标题） | Title `CMspark 召唤器（实验）` **and** tray `召唤器（实验）…`. Card-internal chip removed. | **Mostly.** Two surfaces, one chip. Acceptable for an opt-in menu. |
| 空场先说话；`#` 才搜标题 | Placeholder / hint match chosen. `#` gate in Swift `hasPrefix("#")` and TS `isSummonerSearchQuery`. Hits from `thread.list`, not the 5-item tray cache. | **True.** |
| 历史是 `你:` / `助手:` **纯文本行，不是气泡** | Bubbles **removed** in uncommitted Swift (`makeBubble` gone). Settled lines run `AttributedString(markdown:)` with a `  \n` hard-break hack. Streaming lines are raw plaintext. | **Lie by form.** Spec says plaintext; code renders CommonMark after stream ends. |
| 无默认热键；占用键展示但不可选 | No default. Stolen rows are labels. Candidates are buttons. Menu opens without a hotkey. | **True.** |
| 未连接仍可 L0 发送；发送在 talk 态始终可见（含 detached） | Enter still submits. `footRow` **hidden** when detached (`Tray.swift:2229`). No 发送 button on the Chrome-quit path. | **Talk true; chrome false.** |
| CTA 写明不能打开侧栏；诚实 激活 Google Chrome | Uncommitted `applyPhase` forces `ctaBox?.isHidden = true` and both attach buttons hidden. Replaced by faint `summonerDetachedInfo`. Phrase 不能替你打开侧栏 **survives**. Buttons and chosen warn-wall **do not**. | **Half.** Honest sentence, missing act. |
| 打开前 badge「检测浏览器…」 | First badge string is `检测浏览器…` until hydrate. Not hardcoded 未连接. | **True.** `[inspected]` `Tray.swift:2287`, `client.ts:169-173` |
| Overlay 持 lease 时侧栏只读；文案「这边暂时打不了字，正在召唤器里说」 | Copy is that sentence. Textarea `disabled`. Placeholder **only shows if the field is empty**. Draft text stays; no banner. Close **does** `releaseOverlayLeaseCas` (uncommitted). | **Copy true; visibility weak.** |
| 按住说话 / 🎙 | Placeholder locked as `说点什么，或按住说话…`. `micButton?.isHidden = true` every `applyPhase`. Mic still in the view tree. | **Lie.** |
| Windows 仍用 Chrome 侧栏 | `installer.nsi:41` English Side Panel steps. **Does not** contain the locked sentence. Win tray `openSummoner` is no-op. | **Fail S15.** Silent omission, not a degrade disclosure. |
| 8+5 用户证伪 | Journeys + ship note: not run. This review also did not click the live hashed window. | **Not done.** Own go-live gate is red. |

---

## Journey walk (as that user)

Evidence `[inspected]`. I did not press the live menu (uncommitted Swift ≠ `SWIFT_TRAY_SHA256` binary).

### J1 — Entry: 菜单栏 CMspark → 召唤器（实验）…（无默认热键）

**Pass** as an entry. **Fail** as chosen empty-state.

1. Tray item exists, `keyEquivalent: ""` — no stolen chord to even open it. `Tray.swift:268-271`
2. Click → `open(threadId: "")` then stdout `summoner.ready`. Node hydrates last/newest. `Tray.swift:374-376`, `menu-bar-agent.ts:653-674`
3. Window title: `CMspark 召唤器（实验）`. `Tray.swift:1435`
4. First badge: `检测浏览器…` until hydrate. **Pass** vs journeys; chosen empty tab still draws a warn-style badge labeled 检测浏览器….
5. If `summoner.hotkey` empty: stdin `summoner.hotkey.prompt` → 310pt indigo picker **on top of** the talk field. Hint: 「选完即关。菜单也可打开召唤器，不必等热键。」 `Tray.swift:2343-2347`
6. Header is badge + **快捷键** + **新对话**. Journeys J1.4: 顶栏只有检测/已连接/未连接 +「新对话」. Extra 快捷键 is a spec miss, but it is the only in-window way to dismiss/reopen the picker without Esc (Esc closes the overlay).

Would I find this without a hotkey? **Only if I already click the menu bar.** Chrome-only users who never notice 菜单栏 CMspark will never see overlay. That is acceptable for 实验, fatal if anyone claims “OS capture”.

### Hotkey: header「快捷键」+ tray「召唤器快捷键…」

**Pass** as opt-in discoverability. **Fail** as first-open talk-first.

- Tray `召唤器快捷键…` opens the overlay **and** `showHotkeyPicker()`. `Tray.swift:273-276, 377-379`
- Header button `快捷键` toggles the same picker. `Tray.swift:2314-2323, 1757-1758`
- Occupied copy: 「已占用（不可选）：⌘Space Spotlight · ⌥Space / Alt+Space Raycast/uTools · ⌃⇧Space 输入法」 `Tray.swift:1343-1344`
- Occupied rows are `NSTextField` labels, not buttons. Candidate click is the only `hotkey.chosen` path. Stolen combos are rejected again in `chooseHotkey`. **Pass S11.**

First-open tax: a user who only wanted to 说一句 must scroll past a 310pt exam, or discover that 「快捷键」toggles it closed. Chosen.html 空场 has **zero** picker. Journeys J1 **requires** the picker. Current code picked journeys over chosen — then **also** left the picker blocking the first viewport. That is not “先说话”.

### First open → same thread

**Pass.**

`shouldStartNewSummonerThread` uncommitted: `0` → always new; **everything else → false** (`client.ts:185-192`). Combined with `resolveSummonerOpenTarget`, missing `last_activity_at` hydrates newest, never auto-creates. First install with existing Side Panel threads → I see `继续 · {title}` and last 20 lines.

Settings UI still paints 「10分钟 / 30分钟 / 始终继续」 inside a `settingsBox` with **no header button** (「设置」removed). Those minutes do nothing. Config comment still says default 10-minute idle (`config.ts:345`). User-facing: 新对话 is the only way to not resume. Honest if you never find settings; dishonest if you do.

### `#` search

**Pass.**

- Talk unless trimmed text `hasPrefix("#")`. Hint flips to 「只搜标题，不搜正文」. `Tray.swift:1790-1792, 2216`
- Needle after `#` → `summoner.search` → companion `thread.list` title/alias filter → `summoner.hits`. Not tray’s 5 recents. `client.ts:84-87`
- Select hit: clears composer, hydrates that thread, focus back. `Tray.swift:1865-1874`
- `#` alone: local hits cleared; after 150ms debounce, empty needle returns **one** most-recent title. Discoverable enough.

I will not search files, apps, or message body. The hint is the rare sentence that tells the truth.

### Transcript: markdown + line breaks? streaming stuck?

**Fail vs 纯文本 lock. Line breaks: attempted, unverified in Swift. Streaming: probably not stuck, but it will jump.**

Hydrate `[inspected]` `hydrate.ts:1-24`: keep `\n`, cap 20, `你:` / `助手:`, no HTML wrap.

Swift `[inspected]` `Tray.swift:2061-2154`:

- `chat.token.content` treated as **snapshot**, replace last `助手:` line (`appendToken` `Tray.swift:1644-1661`). Matches adapter `assistantContent` cumulative send (`adapter.ts:922`). This is the correct anti-stuck rule.
- Stream paints `plainAttrs` (raw `\n` visible).
- `markDone` re-parses body as CommonMark after converting `\n` → `  \n` because “CommonMark collapses a single `\n` to a space.”
- History rows separated by `\n\n`.
- 120ms coalesced refresh. First token immediate.

What I would **see**:

1. Tokens as ugly raw markdown (`**粗体**`, `- 列表`).
2. On done, bold/lists appear; layout height jumps (`maybeGrowLogHeight` 180–360).
3. If Apple’s `AttributedString(markdown:)` ignores two-space hard breaks, settled text **collapses** the line breaks that streaming just showed. That is the “stuck / flattened” report users will file. **Not executed.**
4. Mid-loop `appendTool` clears `streamingAssistant`; next snapshot **appends** a new `助手:` block. Fine unless hydrate-during-stream races (`handleSummonerSubmit` re-hydrates after send) — then the log can rewind.

`patchStreamingLine` joins with `"\n"` and is **dead**. Leave it or it will one day flatten paragraphs.

Chosen / journeys / hydrate comment: 纯文本行. Uncommitted overlay test **locks markdown** (`summoner-overlay.test.ts:116-122`). The test suite now defends the spec violation.

### Detached: faint info, not warn wall

**Intentional. Right weight for “not 主界面”. Wrong remaining copy.**

`applyPhase` (`Tray.swift:2226-2238`):

```
ctaBox?.isHidden = true
attachButton?.isHidden = true
silentAttachButton?.isHidden = true
footRow?.isHidden = searching || !hasTranscript || detached
…
sideNote?.stringValue = summonerDetachedInfo  // 浏览器未连接 · 网页操作请点工具栏图标（不能替你打开侧栏）
micButton?.isHidden = true
```

Faint 11px `SummonerTokens.faint` footer. No amber wall. No 「激活 Google Chrome」. No 「后台使用 Chrome」.

Honesty of the **sentence**: still contains 不能替你打开侧栏. Good.

Honesty of the **mode**:

- L0 Enter-to-send still works. Hint says so.
- L1 failure appends `系统: BROWSER_UNAVAILABLE` into the transcript (`Tray.swift:1703-1707`) — English error code as a chat line. That is a developer leak, not a user sentence.
- Badge still goes amber 「浏览器未连接」. Two 未连接 signals + faint footer + English system line. Quiet wall became a messy one.
- Overlay cannot launch Chrome. Tray still has `🌐 打开 Chrome`. Badge will not flip until the next hydrate (open / select / submit). `summonerBrowserAttached` is only sampled then (`menu-bar-agent.ts:595-601, 635`).
- 「已连接，继续对话」 only if `hasTranscript && browserAttached && sawBrowserUnavailable`. After they hid attach, this button almost never appears.

Chosen 态4 and journeys M7 wanted the warn CTA **and** the honest phrase. Uncommitted tests now lock “faint info, not a warn CTA panel” (`summoner-overlay.test.ts:132-138`). I agree with killing the wall. I do not agree with replacing it by `BROWSER_UNAVAILABLE` in the log and no 发送.

### Dual composer standby copy

**Copy: pass. Surface: fail if I already typed.**

```
这边暂时打不了字，正在召唤器里说
这边暂时打不了字，正在侧栏里说
```

`agentStore.tsx:10-14`. Journeys J4 exact string.

Side Panel: textarea `disabled={… || !!overlayStandby}` (`App.tsx:1771-1776`). Placeholder becomes the sentence **only when value is empty** (`App.tsx:943-944`). Send `title` is the sentence (hover only). Capsule still looks armed (opacity 1 unless needsThread/connection). No strip, no 「关掉召唤器后这里继续」.

If I had a draft in the 320px panel and I summon: I see my draft, gray send, keys do nothing. I will think Chrome froze.

Close overlay: `summoner.closed` → `handleSummonerClosed` → `releaseOverlayLeaseCas` (`menu-bar-agent.ts:678-683, 1001-1002`). Panel gets `composer.lease` holder=panel and clears standby. **This uncommitted path is the dual-composer product actually working.** Lease is per-thread; other threads stay typed. Correct.

### J5 / 🎙

Protocol: summoner origin + `privacy_ack_v2` allowed; tray menus denied. `[inspected]`

UI: mic hidden every layout. Placeholder still 「或按住说话…」. Tooltip on a hidden button: 「点一下开始，再点结束；也可按住说话」 (`Tray.swift:2494`).

I cannot press-hold what I cannot see. The empty-state verb is a lie.

---

## What would make this user never open overlay again

1. **Cannot find it.** No default hotkey. First week I live in Chrome. Menu bar is a ghost. Overlay never happens. (Acquisition, not the card.)
2. **First viewport is a hotkey exam.** I wanted to 说一句. I get Spotlight/Raycast/输入法 不可选 plus six chords. I Esc. Overlay gone. I go back to Side Panel.
3. **「或按住说话」and there is no mic.** I lose trust in 实验 copy. I will not debug Whisper from a card that hid its own button.
4. **Chrome 已退, I ask「打开某网站」.** Log prints `系统: BROWSER_UNAVAILABLE`. Faint footer. No 发送. No 激活 Chrome. I open Chrome myself, Side Panel works, overlay is a downgrade. Habit dies here — this is the **falsification card 3**.
5. **Side Panel suddenly 打不了字**, no banner, draft still sitting there. I force-quit nothing; I blame CMspark.
6. **Transcript jumps** from raw `**` to formatted, or line breaks vanish after 流式结束. “这不像对话 / 找不到记录” — ship note’s own kill criterion.
7. **It is worse than Side Panel while Chrome is open** (locks composer, 20 lines, no Mermaid, no 附图, no Pack). I only need overlay when Chrome is quit. If that path is the weakest chrome, I never come back.

---

## vs origin/main — is the delta worth shipping?

Main: quit Chrome, product disappears. Overlay: quit Chrome, I can still talk to yesterday’s 投研纪要. **That sentence is worth an 实验.**

It is **not** worth shipping the uncommitted card **as-is**, because the card spends its first impression on a hotkey questionnaire and a mic it disabled, and spends its unique mode (detached) on an English error code.

Ship only after the BLOCK/MAJOR list below is folded. Do not wait for Electron. Do not rewrite GOAL.md. Keep 「实验」 in the title.

---

## Findings

### BLOCK

**B1 — Empty-state copy sells voice; `applyPhase` hides the mic every time.**

- Quote: `说点什么，或按住说话…` `Tray.swift:1436`
- Quote: `micButton?.isHidden = true` `Tray.swift:2239`
- Chosen + S7 + journeys lock that placeholder **with** press-hold. Uncommitted polish hid the control and left the sentence. A Chinese user reads the only invitation in the window. That is a user-facing lie, not a leftover.
- Fold: placeholder `说点什么…` (drop 或按住说话) **or** show 🎙. Not both. If Whisper weights missing, say so in the log **in Chinese**, do not keep a ghost mic.

**B2 — Chrome-quit path hides 发送 and attach; transcript speaks English telemetry.**

- `footRow?.isHidden = … || detached` `Tray.swift:2229` — violates journeys J2 “发送按钮在 talk 态始终可见（含 detached）”.
- CTA wall correctly killed; remaining user text is `系统: BROWSER_UNAVAILABLE` `Tray.swift:1707` plus 11px faint footer `Tray.swift:1439`.
- This is the **only** mode overlay has that Side Panel does not. Shipping it half-dressed makes the 实验 look broken on its own demo.

Fold: keep faint footer (good). Keep 发送 visible in talk (Enter is not enough for every CN user, and the 发送 button already exists). Replace `BROWSER_UNAVAILABLE` with one Chinese line: 「网页操作需要 Chrome。我们不能替你打开侧栏。」 Do not bring back the amber novel.

### MAJOR

**M1 — Dual-composer copy is good and often invisible.**

- 「这边暂时打不了字，正在召唤器里说」 `agentStore.tsx:13`
- Applied as placeholder + send `title` only (`App.tsx:943-944, 1818-1820`). Draft ≠ empty → no sentence.
- Fold: one standby strip above the capsule: 「正在召唤器里说 · 关掉召唤器后这里继续」. Dim/disable, don’t impersonate a live composer.

**M2 — First-open 310pt hotkey picker vs 先说话.**

- Journeys J1 wants the picker. Chosen 空场 does not. Current shows picker **and** talk, picker first, +110mm of window.
- Fold: picker behind header「快捷键」 / tray「召唤器快捷键…」 only. First `召唤器（实验）…` click = talk field + `检测浏览器…`. One line under hint: 「可在「快捷键」选一个，菜单随时能打开」. Occupied chords stay visible **inside** that drawer, not as the first story.

**M3 — Markdown vs 纯文本 lock; stream → settle jump; line breaks unverified.**

- `attributedLine` `Tray.swift:2136-2148`
- Hydrate comment: “Never wrap HTML or chat bubbles.” `hydrate.ts:1-2`
- Fold: plaintext with preserved `\n` for P0 (matches hydrate + chosen). Or explicitly amend journeys to “settled CommonMark, stream raw” and **execute** IME + 换行 on the hashed binary. Do not ship a jump.

**M4 — Dead settings still claim 10-minute idle.**

- `shouldStartNewSummonerThread` ignores 10/30 (`client.ts:190-192`).
- `settingsBox` still built (`Tray.swift:2379-2443`); header 设置 button removed.
- Fold: delete the box **or** wire it and make 10/30 real. Default “always resume” is the right product for “same thread”; the comment in `config.ts:345` must match.

**M5 — Windows installer never says the locked degrade sentence.**

- `scripts/installer.nsi:41` English Side Panel how-to. Missing 「Windows 仍用 Chrome 侧栏」 (brief S15).
- systray2 `openSummoner` no-op `systray2-bridge.ts:176-179` — correct capability; dishonest docs.

**M6 — Own 8+5 falsification not run; hashed binary ≠ this Swift.**

- `SWIFT_TRAY_SHA256` in `swift-tray-bridge.ts:59` gates what users actually see. Uncommitted 454-line Tray.swift diff is invisible until rebuild + hash lockstep.
- Shipping source-lock tests (`assert.match` on strings) as if they were the window is how this card got markdown + hidden mic at once.

### NIT

- 「实验」 on both menu and title. Keep both; don’t put a third chip back.
- Composer `fieldBox` height 40px (`Tray.swift:2452`) — 中文长句 clips; Enter sends. Fine for L0 if 发送 exists.
- `mcpField?.isHidden = true` always (`Tray.swift:1694`) but tests still `assert.match(/MCP · /)`. Dead composition chrome.
- `continue` click sends a hidden model instruction (`CONTINUE_MESSAGE` `client.ts:25-26`) with **no** local `你:` line — click can feel dead.
- Overlay always `center()` on open (`Tray.swift:1611`) — moves the card if I had placed it.
- Click-outside does not dismiss (`hidesOnDeactivate = false`). Esc does. Fine for chat; surprising for a “召唤器”.
- Header「快捷键」 is extra vs J1.4 — keep it **if** M2 folds the auto picker.

---

## Journey scorecard

| Journey | Result | Why |
|---------|--------|-----|
| Menu entry, no default hotkey | **PASS** | `召唤器（实验）…` `keyEquivalent: ""` |
| First open same thread | **PASS** | hydrate last/newest; no auto-create |
| First-open chrome = chosen 空场 | **FAIL** | 310pt picker + header 快捷键 |
| `#` title search | **PASS** | prefix gate, hint, companion hits, select hydrates |
| Transcript plaintext + 换行 | **FAIL / unverified** | markdown settle; `\n` hack not executed in AppKit |
| Streaming not stuck | **LIKELY PASS** | snapshot replace; jump ≠ stuck |
| Detached faint, not warn wall | **PASS (intent)** | ctaBox forced hidden |
| Detached still L0-usable | **FAIL chrome / PASS Enter** | 发送 hidden; hint still 回车发送 |
| Dual composer copy | **PASS string / FAIL visibility** | exact journeys sentence, placeholder-only |
| Close overlay unlocks panel | **PASS** `[inspected]` | `summoner.closed` → release CAS |
| STT press-hold | **FAIL UI** | hidden mic, live placeholder |
| Windows honest degrade | **FAIL** | no locked sentence |

Manual M5 IME 5/5: **not executed**. Ship note: fail → CN no-go. I will not rubber-stamp IME.

---

## Copy ledger (quote the window, not the brief)

| Surface | Copy | File:line |
|---------|------|-----------|
| Tray menu | `召唤器（实验）…` | `Tray.swift:268` |
| Tray menu | `召唤器快捷键…` | `Tray.swift:273` |
| Window title | `CMspark 召唤器（实验）` | `Tray.swift:1435` |
| Placeholder | `说点什么，或按住说话…` | `Tray.swift:1436` |
| Hint (talk) | `回车发送到当前线程，输入 # 搜标题` | `Tray.swift:1437` |
| Hint (`#`) | `只搜标题，不搜正文` | `Tray.swift:2216` |
| CTA string (hidden) | `我们不能替你打开侧栏。可激活 Google Chrome，然后点工具栏 CMspark（没有就拼图 🧩 钉上）。` | `Tray.swift:1438` |
| Detached footer | `浏览器未连接 · 网页操作请点工具栏图标（不能替你打开侧栏）` | `Tray.swift:1439` |
| Badge probing | `检测浏览器…` | `Tray.swift:2193, 2287` |
| Picker title | `选一个召唤热键` | `Tray.swift:2343` |
| Picker hint | `选完即关。菜单也可打开召唤器，不必等热键。` | `Tray.swift:2347` |
| Occupied | `已占用（不可选）：⌘Space Spotlight · ⌥Space / Alt+Space Raycast/uTools · ⌃⇧Space 输入法` | `Tray.swift:1343-1344` |
| Side note attached | `完整格式在侧栏` | `Tray.swift:2236` |
| Header | `快捷键` / `新对话` | `Tray.swift:2307, 2314` |
| Continue | `已连接，继续对话` | `Tray.swift:2632` |
| Panel standby | `这边暂时打不了字，正在召唤器里说` | `agentStore.tsx:13` |
| Error line | `系统: BROWSER_UNAVAILABLE` | `Tray.swift:1707` |

Never 「主界面」. Good. Never tell me you hid the mic.

---

## Fold-to-APPROVE_WITH_NITS (minimum)

1. Placeholder matches chrome: no 按住说话 without 🎙.
2. Detached talk: 发送 stays; `BROWSER_UNAVAILABLE` becomes one Chinese line; keep faint footer; do not restore the warn novel.
3. First `召唤器（实验）…` = talk, not a hotkey exam. Picker lives under「快捷键」.
4. Standby strip on Side Panel, not a zombie capsule.
5. Transcript: plaintext `\n` **or** executed markdown hard-breaks — pick one, test on hashed `cmspark-tray`.
6. Rebuild Swift and lockstep `SWIFT_TRAY_SHA256` before any human sees this.

Then run journeys M5 (IME 5/5) and the Chrome-quit card 3. Not a string test.

---

**VERDICT: REJECT**
