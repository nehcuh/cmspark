# PRODUCT / UX adversarial review — OS Agent Shell P0 overlay

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Reviewer | independent PRODUCT/UX (macOS · Chrome · 输入法 · Raycast user) |
| Tree | HEAD `659bbce` + uncommitted summoner/overlay/standby/lease files |
| Evidence | **[inspected]** source walk; **not executed** on hashed `cmspark-tray` |
| Locks | identity brief S2/S7/S11/S15 · journeys 2026-08-23 · chosen HTML `os-summoner-p0-chosen.html` · ship note 8+5 **NOT RUN** |
| Other 20260823 reviews | not read |

I do not care that `node --test` is green. Several of those tests are regex locks that *protect the deviations* (markdown parser disguised as plaintext, extra 「后台使用 Chrome」 button, idle-policy chrome with no 设置 button). That is spec-theater.

---

## User-facing honesty audit (claims vs UI)

| Claim the user is supposed to believe | What the UI / loop actually does | Honest? |
|---------------------------------------|----------------------------------|---------|
| 召唤器不是主界面；完整工作面仍是 Side Panel | Window title `CMspark 召唤器（实验）` is fine. Then the card grows a 220px log, 「发送」+「已连接，继续对话」, 「完整格式在侧栏」, 「新对话」, 🎙, and a markdown-parsed assistant column. It *is* a second ChatGPT, just uglier. | **Lie by form** |
| Chrome 缺席仍能对**同一 thread** 说话 | First `summoner.ready` with default idle 10 min and `last_activity_at == null` → `shouldStartNewSummonerThread` is **true** → `handleSummonerNewThread()` **creates a new thread**. The last Side Panel conversation is not hydrated. | **Identity lie** |
| 空场先说话：一条 16px 圆角输入，没有仪器盘 | `open()` always `showHotkeyPicker()` until a combo is persisted (~310px indigo block). After ready, empty new `thread_id` makes `hasTranscript` true (`!threadId.isEmpty`), so log / CTA / foot / 「完整格式在侧栏」 all paint on a blank thread. Chosen tab「1 空场」never happens after hydrate. | **Lie** |
| `#` 搜标题，选中后看到截断历史、回到说话 | Swift filters **tray cache of 5** (`fetchRecentThreads(limit=5)`), title field is `alias \|\| id` not thread title. Click/Enter `selectThread` **does not hydrate** and **does not notify Node**. History of the chosen thread is not shown. | **Lie** |
| 未连接仍可 L0 发送 | Return still submits; L0 `chat.create` is fire-and-forget. After the forced new-thread hydrate, 「发送」 is visible. This part is real. | **True, on the wrong thread** |
| CTA 写明「不能替你打开侧栏」 | `summonerCtaCopy` matches chosen HTML. Extra primary 「后台使用 Chrome」 is **not** in the chosen mix; ship-note tests **require** that extra string. | **Copy honest, chrome dishonest** |
| 「已连接，继续对话」= 新用户句，不重放 L1 | Server sends canned `CONTINUE_MESSAGE` = 「浏览器已连接。请等待我的下一条指令；不要重试刚才失败的网页操作。」 Overlay **does not** append a `你:` line. User clicked continue; the model is obeying a hidden instruction they never saw. | **Protocol true, UX lie** |
| Overlay 打开 ⇒ overlay 持 composer.lease；关掉 ⇒ Panel | Lease is claimed **only on submit**, not on open. `summoner.closed` is a **no-op** (no `composer.lease.release`). Panel learns standby only after *its own* `chat.create` returns `OVERLAY_STANDBY`. Close overlay → Panel stays locked. | **Law S20 broken in the product** |
| 「这边暂时打不了字，正在召唤器里说」 | Copy is good once it appears. No escape, no 「关掉召唤器就能打字」, no close-overlay hint. Switching thread accidentally clears it. | **Copy OK, trap** |
| 历史是纯文本 `你:` / `助手:`，不是气泡、不是 markdown 家 | `attributedLine` runs `AttributedString(markdown:)` on every non-streaming `助手:` line. Overlay unit test forbids `NSAttributedString(markdown` — different type name, so the lock is theater. Cap is **40** not brief/chosen **20**. | **Lie** |
| 「实验」只出现一次（窗口标题） | Title + tray item `召唤器（实验）…`. Overlay bar does **not** add 「召唤器 · 实验」 (anti-ref from options/wireframes). Acceptable duplication across surfaces; overlay itself is clean. | **Mostly true** |
| 打开前 badge「检测浏览器…」 | First paint uses that string; `browserKnown` starts false. After hydrate, binary 已连接/未连接. | **True** |
| 热键 opt-in；占用键可见不可选 | Stolen chords are `NSTextField` labels; `chooseHotkey` returns if combo is in `summonerHotKeyStolen`. No ⌘Space / ⌥Space / ⌃⇧Space in candidate table. | **True [inspected]** |
| P0 召唤器不做听写 | Brief §8. Ship note + journeys **amended** mic. Placeholder still sells 「按住说话」. Whisper missing → transcript line 「本机 Whisper 模型未就绪。请到 Side Panel → 设置下载 medium。」 Chrome 已退出时这条 CTA 是死路. | **Incoherent** |
| Windows 仍用 Chrome 侧栏 | NSIS finish page (English) tells users to load the extension and click the toolbar icon. **Does not** contain the locked sentence. Win/Linux tray **has no 召唤器 item** (`systray2-bridge` `openSummoner` no-op). No About page at all. | **Fail the lock; silent omission** |
| 8+5 证伪通过才叫 P0 产品 | Ship note itself: user falsification **NOT RUN**; 「Ship overlay as identity-2 product? **NO-GO**」. Shipping this as 「P0 done」 would be a second lie, on top of the UI. | **Cannot claim** |

---

## Journey scores

Evidence tags: **[inspected]** unless noted. Swift UI / IME / 8+5 = **not executed**.

### J1 First open from tray, no hotkey — **FAIL**

Walk:

1. Menu `召唤器（实验）…` (`Tray.swift:248`, `menuAction` `:349-351`) calls `open(threadId: "")`.
2. First frame: badge `"检测浏览器…"` (`makeWindow` `:2182`, `applyPhase` `:2095-2096`). **Not** hard-coded `"未连接"`. This bit matches the journey.
3. `if !hotkeyConfigured { showHotkeyPicker() }` (`:1570`). ~310px indigo 「选一个召唤热键」 lands **on the first talk frame**. Chosen empty state has no picker.
4. `jsonLine(summoner.ready)` → Node `handleSummonerReady` (`menu-bar-agent.ts:653-668`): default `resumeIdleMinutes = 10`, `last_activity_at` null → **new thread**, hydrate empty lines + real `thread_id`.
5. `applyHydrate` sets `browserKnown = true`. `hasTranscript = !lines.isEmpty \|\| !threadId.isEmpty` (`:2092`) is **true**. Empty chosen state (no log, no foot, no CTA, no 「完整格式在侧栏」) is gone.
6. Header is badge + 「新对话」 (`:2202-2211`). No 「召唤器 · 实验」 chip. Window title already has 实验. Tray item also has 实验.

Jordan (first-timer): this does **not** read as 「捕获壳」. It reads as a untitled new chat plus a homework sheet about hotkeys.

「实验」duplicated: title + tray (ship-note copy lock allows both). Overlay bar does not add a third. **Not** the J1 failure.

J1 failure is: **first frame is the picker + then a blank chat, not the chosen 空场.**

### J2 Empty-state send, Chrome quit — **FAIL** (can type; wrong thread)

- Composer is enabled while detached. Return → `submitComposer` (`:1805-1814`) emits `summoner.submit` even if `browserAttached == false`. 「发送」 is `isHidden = false` once `hasTranscript` (`:2132-2133`). **Can send.** [inspected]
- Node `submitSummonerTalk` with empty `requestedId` picks **newest** thread (`client.ts:89-96`, journey test locks this). After J1 already **created** a new thread, newest is that empty one — **not** the Side Panel thread they were living in.
- No copy says 「这就是你在侧栏里的那条对话」. `继续 · {title}` uses `recentThreads` (`:2060-2068`), which is alias-or-id of the last **5** tray threads, and after new-thread hydrate `threadId` is the new blank, so the caption is the new thread’s empty alias (often `id`).
- Same-thread identity: **broken**.

Riley, Chrome quit: they can talk. They are talking to a **new** ghost thread. When they later open Chrome, Side Panel is on a different conversation unless they notice.

### J3 `#` title search — **FAIL**

What works:

- Talk vs search is `hasPrefix("#")` (`:1720-1721`). Hint swaps to `"只搜标题，不搜正文"` (`:2119`). Matches chosen + journeys.

What the user actually gets:

- Hits are **local** `recentThreads.filter { $0.title.contains(q) }` (`:1953`), and `recentThreads` is the tray cache: **5 items**, `title: t.alias \|\| t.id` (`companion-client.ts:227-244`). Node `handleSummonerSearch` uses full `thread.list` + alias (`menu-bar-agent.ts:730-737`) **but never pushes hits to Swift**.
- No relative time (chosen: 「昨天」 / 「3 天前」). Just a title button.
- `selectThread` (`:1795-1803`): clears composer, focuses, **does not** `hydrate`, **does not** emit a select event, **does not** clear leftover `lines` from the previous (new) thread. User is 「back to talk」 on a thread whose history they cannot see.
- Empty `#` → `hits = []` (`:1950-1951`). Hint sits there with no list. Discoverability of `#` is an 11px faint line under a 40px field, drowned by the first-run picker.

Alex (power user): `#` is slower and dumber than opening the Side Panel thread list. Raycast muscle memory (type to search everything) is punished: without `#` they **send** to the LLM. With `#` they search 5 aliases.

Falsification task 1 (「用标题找到指定旧线程，看到截断历史」) **cannot pass** on this UI.

### J4 Dual composer — **FAIL**

Copy when it finally appears: `"这边暂时打不了字，正在召唤器里说"` (`agentStore.tsx:10-14`). Textarea `disabled={… \|\| !!overlayStandby}` (`App.tsx:1771-1776`). Placeholder becomes that sentence (`:943-944`). **Copy quality: pass.** Escape: **none**.

Product holes:

1. Overlay **open does not claim** lease. Claim is inside `submitSummonerTalk` (`client.ts:132`, `menu-bar-agent.ts:696`). Until the overlay’s first send, **both composers type**. Dual drafts exist. S20 「overlay 可见 ⇒ overlay 持有」 is not the product.
2. Panel standby is **not proactive**. `composer.lease.claim` RPC returns only to the summoner socket (`message-router.ts:1033-1038`). Panel `case "composer.lease"` (`useWebSocket.ts:475-481`) never sees a fan-out. User types a long Side Panel draft, hits send, *then* gets `OVERLAY_STANDBY`, textarea freezes with their unsent text inside.
3. Overlay **close does not release**. `handleSummonerInbound` `summoner.closed` is `return` (`menu-bar-agent.ts:976-978`). Comment even boasts 「Close is summoner.closed only — never chat.abort」 — they implemented the abort half of S9 and forgot S20. Panel stays on 「正在召唤器里说」 after the overlay is gone.
4. Accidental escape: `SET_ACTIVE_THREAD` different id clears standby (`agentStore.tsx:801`). Switching thread looks like a bugfix; staying on the thread looks like the product is broken.

Riley: this is the journey that makes a user force-quit.

### J5 STT press-hold — **FAIL** (incoherent; failure is a chat line)

Brief §8: 「召唤器不做听写；不要灰色麦克风图标」. Ship note / journeys later stuffed 🎙 in. The overlay now invites voice as a **primary** empty-state verb (`说点什么，或按住说话…`).

- Tooltip: 「点一下开始，再点结束；也可按住说话」 (`Tray.swift:2381`). Placeholder says 按住. Hold `< 0.35s` **stays recording** (`:1845-1848`). First-timers tap → red mic, no copy that it is still listening.
- Whisper missing: `emitSummonerSttError("model_missing")` (`menu-bar-agent.ts:843-845`, `client.ts:320`). Overlay `applyError` appends `"系统: 本机 Whisper 模型未就绪。请到 Side Panel → 设置下载 medium。"` into the **transcript**. That is a settings error wearing a chat costume.
- Download path is Side Panel. Journey premise is Chrome **fully quit**. The mic CTA is a door into a room that is locked.
- `privacy_ack_v2` on press is a lawyer’s gesture, not a user’s. No overlay copy about 本机 Whisper / 音频不上云.

Coherence: a thin L0 capture shell that cannot install its own STT should **not** lead with 🎙.

### J6 Browser-unavailable CTA — **PARTIAL / FAIL on continue UX**

Honest bits:

- `summonerCtaCopy` = 「我们不能替你打开侧栏。可激活 Google Chrome，然后点工具栏 CMspark（没有就拼图 🧩 钉上）。」 (`:1401`) — contains the locked phrase.
- Attach is UI RPC, not an LLM tool (`handleSummonerAttach` → `attachChromeOnly` → `openChrome` / silent).
- Continue is `sendChatCreate(buildContinueChatCreate)` (`:684-688`), not a tool replay. [inspected]

Dishonest / extra:

- Chosen HTML: one button 「激活 Google Chrome」. Implementation: indigo **「后台使用 Chrome」** + secondary 「激活 Google Chrome」 (`:2493-2500`). Overlay unit test **asserts** `/后台使用 Chrome/` (`summoner-overlay.test.ts:61`). Tests guarding the anti-chosen mix.
- CTA only if `detached && hasTranscript` (`:2129`). Thanks to J1’s new thread, it shows early; a true empty composer (if idle policy were 「始终继续」 and lines empty) would hide the honesty until they send.
- L1 failure paints `"系统: BROWSER_UNAVAILABLE"` (`:1648`) — wireframe 04 has this English code. Chosen CTA state does not. Users do not know what to do with an English enum in a Chinese shell.
- 「已连接，继续对话」 hidden until `hasTranscript && browserAttached && sawBrowserUnavailable` (`:2134`). After attach, continue sends a **hidden** user message (`CONTINUE_MESSAGE`, `client.ts:22-23`). Overlay does not show `你: 浏览器已连接…`. The assistant starts talking at the user. Feels like auto-retry, which is exactly the lie S19 exists to prevent — even though the server did the legally correct thing.

### J7 Hotkey first-run — **PASS** (with nits)

- Occupied: `⌘Space Spotlight · ⌥Space Raycast/uTools · ⌃⇧Space 输入法` as wrapping labels (`:2239-2249`), not buttons. `chooseHotkey` hard-returns on stolen (`:1691-1693`).
- Candidates: ⌃⌥Space / ⌃⌥⌘Space / ⌃⌥C / ⌃⌥K / ⌃⌥S / ⌃⌥⌘. (`:1285-1292`). No stolen defaults.
- Menu opens overlay without a hotkey (`:349-351`). Picker hint: 「选完即关。菜单也可打开召唤器，不必等热键。」
- Nit: picker is a **modal slab** on first talk, not a one-line chooser. Nit: ⌃⌥Space is still a plausible IME/a11y collision, just not in the stolen table. Nit: `NSApp.activate(ignoringOtherApps: true)` (`:1572`) on a `.nonactivatingPanel` — steals from Raycast/微信; IME state may jump. **[not executed]**

### J8 Settings / MCP / tool chrome — **FAIL** (thin capture violated)

S8 / chosen thesis: overlay 常驻控件 ≤ composer + 检索 + 缺浏览器徽章. 「无 instrument chrome」.

In the window anyway:

| Chrome | Where | User-visible? |
|--------|--------|----------------|
| 「新对话」 | header | always |
| 🎙 | composer | always |
| Hotkey picker | 310px | first run |
| Settings box 「再打开 · 超时后新对话」 + 「需要 Chrome 时」 后台静默/前台激活 | `settingsBox` `:2266-2330` | **no button** (`settingsClicked` exists, tests lock `doesNotMatch /NSButton\(title: "设置"/`). Policy **still runs** on ready. Silent identity control. |
| MCP line 「MCP 未连接 · 去侧栏配置后这里可直接调用」 | `:2416-2420` | `applyMcp` always `isHidden = true` (`:1637`). Dead, but the copy 「这里可直接调用」 would be a lie vs ACL + confirm retarget. |
| Dual attach buttons | CTA | yes when detached |
| 「完整格式在侧栏」 | footer | as soon as `thread_id` exists |
| Tool lines `[工具] {name}` | transcript | on `summoner.tool` |

This is Approach B (native chat app) wearing Approach A’s title.

### J9 Transcript: plaintext 你:/助手: — **FAIL**

Chosen lock / journeys: plaintext lines, NOT bubbles, NOT markdown home.

```
attributedLine (_:2034-2057 Tray.swift)
  prefix 助手:  then AttributedString(markdown: body, interpretedSyntax: .inlineOnlyPreservingWhitespace)
```

Streaming tokens are plain (`plainAttrs` / `patchStreamingLine`); `markDone` → `refreshLog` → markdown. Bold, lists, code spans appear. It will feel like a clipped ChatGPT, not a capture log.

Also:

- Cap 40 in Swift (`:1710-1713`) and `hydrate.ts HYDRATE_CAP = 40`. Brief S7 / options lock / wireframe anno: **20**.
- `系统: BROWSER_UNAVAILABLE` and `系统: {whisper error}` live in the same stream as 你/助手.
- No `你` / `助手` grey who-label as in chosen HTML (`.who`); prefix is inline `你: ` which is fine, until markdown blows the assistant side.

Source-lock test (`summoner-overlay.test.ts:79-92`) `doesNotMatch /NSAttributedString\(markdown/` **passes while the parser ships**. That is the textbook of spec-theater.

### J10 Close overlay while streaming — **UNKNOWN / lean FAIL on reopen**

- Close ≠ `chat.abort`: `emitClosedIfOpen` only `summoner.closed` (`:1703-1707`). Node inbound does not abort. **S9 half-held.** [inspected]
- Tokens can still hit `appendToken` on a hidden window. Reopen: `handleSummonerReady` again. If 10 min idle (default) elapsed, **another new thread**. If inside the window, hydrates `last_thread_id` and `applyHydrate` sets `streamingAssistant = false` (`:1595`) — live stream display can snap/lose the in-flight line until `chat.done`.
- Because close does not release lease, Side Panel is still frozen while the task continues. User thinks they dismissed the toy; their real composer is dead.

### J11 Windows / Linux honesty — **FAIL**

- `systray2-bridge.ts:176-179` / `readline-tray.ts`: `openSummoner` no-op. Win tray menu **has no 召唤器 item** (`:252-255` logs/Chrome/配对/设置 only).
- `scripts/installer.nsi:40-41` finish page: English 「load the Chrome extension… click the CMspark icon in the Chrome toolbar to open the Side Panel.」 Does **not** say 「Windows 仍用 Chrome 侧栏」 (brief S15, ship note §8). No About window in tray (grep 关于/About: none).
- A Windows user is not lied to with a fake overlay. They are also not told that macOS grew a second door. The lock was a **sentence**, not a vibe. Fail.

### J12 8+5 falsification not run — **FAIL as 「P0 done」**

Ship note status line: **user falsification (8+5) not run**. Go/no-go: identity-2 product **NO-GO** until §11 cards.

On this tree, the cards would fail even if you ran them:

| Card (Chrome fully quit) | Why it dies |
|--------------------------|-------------|
| 1. 热键/菜单找到旧线程并看到截断历史 | First open new-threads; `#` doesn’t hydrate; search is 5 aliases |
| 2. 同一 thread 追问并引用历史 | They never saw the history |
| 3. 「打开某网站」 typed degrade | CTA phrase is present; continue UX still feels like auto-retry; English `BROWSER_UNAVAILABLE` in-stream |
| IME 5/5 组字中回车不发送 | Code checks `hasMarkedText` (`:1766, :1778, :1808`) and `keyEquivalent = ""`. **Plausible pass, not executed.** If it fails, ship note: overlay **不得对中国用户作为 P0 发货** |
| Dual composer 只有一块能打字 | False until first overlay send; then Panel trapped after close |

Calling this 「P0 done」 is a documentation lie. Spike code can exist. Product identity 2 cannot.

---

## BLOCK / MAJOR / NIT

### BLOCK

1. **Same-thread identity is false on first open.** Default idle policy + null `last_activity_at` creates a new thread (`shouldStartNewSummonerThread` + `handleSummonerNewThread`). Brief identity lock is the entire reason this overlay exists.
2. **`summoner.closed` does not `composer.lease.release`.** Side Panel can be left permanently 「正在召唤器里说」. This is the dual-composer product; a lock that traps the real workspace is not a spike leftover, it is a ship blocker.
3. **`#` select does not hydrate.** Falsification task 1 is unpassable. Overlay is not a continuation surface.
4. **8+5 not run, and the tree cannot pass it.** Do not ship as P0 / identity-2. Ship note already said NO-GO; the implementation made it worse.

### MAJOR

5. **Markdown-parsed assistant lines.** Chosen/journeys plaintext lock. Feels like ChatGPT. Tests are written to miss `AttributedString(markdown:)`.
6. **Thin-shell violation.** 新对话, 🎙, dual Chrome buttons, idle policy (invisible but live), MCP stubs, 「完整格式在侧栏」 on empty threads. Approach B in an Approach A window.
7. **Continue button sends an invisible canned user message.** Legal vs L1 replay; dishonest vs the person who clicked 「继续对话」.
8. **Search corpus is tray’s 5 `alias\|\|id`.** Node has a real title search and does not feed the UI.
9. **Lease not claimed on overlay open.** Dual-draft window until first send; Panel only finds out by failing.
10. **Mic leads empty-state while Whisper lives in Side Panel.** Chrome-quit users are invited to fail; failure is a `系统:` chat line.
11. **Windows installer missing S15 sentence; no About.** English Side Panel instructions are not the locked honesty.
12. **Hydrate cap 40 vs locked 20.** Small number, same lie class as markdown: 「we truncated it」 is not what the window does.

### NIT

13. 「实验」 on both window title and tray item (journeys wanted title-only; ship note allowed both).
14. Hotkey picker is a 310px first-run tax on the empty state.
15. `NSApp.activate(ignoringOtherApps: true)` vs `.nonactivatingPanel`.
16. Composer is a 40px-tall `NSTextView` — Riley long-paste / 长句 will scroll inside a pill, not grow.
17. Search hits have no time column.
18. `系统: BROWSER_UNAVAILABLE` English enum in an otherwise Chinese UI (wireframe 04 sketched it; still hostile).
19. ⌃⌥Space as a 「safe」 candidate.
20. Dead `settingsClicked` / hidden MCP row — leftover Approach B organs.

---

## Personas

**Jordan (first-timer, just found 召唤器（实验）…)**  
Will not know this isn’t the main app. The window is titled like a product, creates a new chat, asks them to pick a hotkey, shows 「完整格式在侧栏」 as if the real work is elsewhere *and* still looks like the work. They will either (a) treat it as ChatGPT and get mad when `#` / 麦 / 继续 不按直觉工作, or (b) go back to the Side Panel and never click the menu again.

**Alex (Raycast / 热键 power user)**  
Summon is **not** faster than Side Panel until a hotkey is chosen; first open is a settings ritual. After that, `#` is a worse thread switcher than Raycast clipboard or the Side Panel list (5 aliases, no hydrate). Mic is a trap if Whisper isn’t downloaded. They will keep using Raycast.

**Riley (empty / long text / IME / Chrome quit mid-tool)**  
- Empty send: works, **wrong thread**.  
- Long text: 40px pill.  
- IME Return: code path looks right (`hasMarkedText`); **not executed** — if this fails, CN no-go per ship note.  
- Chrome quit mid-tool: English `BROWSER_UNAVAILABLE` + two Chrome buttons + continue that talks without them. Then they close the overlay and the Side Panel composer is still dead.

**中文 IME user**  
First-run picker + `NSApp.activate` can yank 输入法 from 微信. Composer Return is guarded; hotkey during overlay composing is ignored (`:1366-1370`). The **untested** 5/5 IME gate is still the CN ship door. Mic 「按住说话」 vs click-to-toggle will burn a first dictation.

---

## What would make a user never open this again

1. They summoned to finish the **same** 投研纪要. The overlay started a **blank** chat. They typed. Now they have two threads and don’t know which is real.
2. They `#` the title they remember. Nothing, or an id. They select something. Still no history. They feel gaslit.
3. They 🎙. The log says go to Side Panel 设置 to download Whisper. Chrome is quit. They did what the placeholder asked.
4. They closed the toy and went back to the Side Panel — **cannot type**, 「正在召唤器里说」, overlay is gone. Force-quit / thread-switch cargo cult.
5. 「继续对话」 after attaching Chrome makes the assistant lecture them in a voice they didn’t write.

Any one of these is enough. This tree offers several on the **first session**.

---

## VERDICT: **REJECT**

Not APPROVE_WITH_NITS. The identity lock is the product. This overlay does not continue the same thread, does not show the history it claims to search, does not release the real composer, and still has not faced 8+5 users. Tests are green because they lock strings and type-names, not the feeling of summoning.

Allowed leftover: macOS spike **code** may stay behind a menu named 实验, with the ship note’s NO-GO intact. Not allowed: calling this P0 done, rewriting GOAL/ADR-020, or telling anyone 「关 Chrome 也能续同一条对话」 until J1–J4 are true in the window, not in `*.test.ts`.

---

*Adversarial PRODUCT/UX. No source modified. Evidence [inspected] on HEAD + uncommitted tree 2026-08-23.*
