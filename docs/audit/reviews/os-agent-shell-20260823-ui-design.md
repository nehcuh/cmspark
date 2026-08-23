# Assessment A — macOS Summoner overlay (visual + interaction)

Method: dual-agent Assessment A only (B is separate). Isolated from detector. Operate mode: all 10 Nielsen heuristics scored.

Evidence: `[inspected]` `docs/design/os-summoner-p0-chosen.html` (locked mix), `os-summoner-p0-wireframes.html` + PNG, `os-summoner-p0-options.html` (A/C fusion), uncommitted `git diff HEAD -- companion/src/tray/Tray.swift docs/design/os-summoner-p0-chosen.html`, `SummonerTokens` through `SummonerController` in `companion/src/tray/Tray.swift`, Side Panel standby in `chrome-extension/src/sidepanel/store/agentStore.tsx` + `App.tsx` composer capsule. `[inspected visually]` wireframes PNG. **Not `[executed]`**: live NSPanel was not launched; this is source + spec, not a pixel screenshot of the running tray.

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Badge exists, but empty uses gray「检测浏览器…」not the locked warn pill; stream patch dumps unstyled text; picking a `#` hit opens an empty 180px log well until hydrate; mic is color-only red. |
| 2 | Match System / Real World | 2 | Talk-first copy is human. Then `系统: BROWSER_UNAVAILABLE`, `[工具]`, 🎙, and `#` as a secret search operator leak engineer-world into a 投研 capture card. |
| 3 | User Control and Freedom | 3 | Esc / close ≠ `chat.abort` is the one grown-up move. IME Return is guarded. First-open hotkey wall still sits in front of talking; New Thread wipes local lines with no undo. |
| 4 | Consistency and Standards | 1 | Chosen four-state contract vs Swift is a different product. Indigo is not send-only. Titled NSPanel vs 16px paper card. Side Panel 看山 composer vs overlay Spotlight+emoji. Markdown still parsed. |
| 5 | Error Prevention | 2 | IME + stolen-hotkey block are real. `#` with 0 hits **sends the query to the model**. Dual Chrome CTAs invite the wrong click. New conversation is one unguarded tap. |
| 6 | Recognition Rather Than Recall | 2 | Hint names `#`. Hits drop time/alias. Mic is hold-and-click in a tooltip. 0 results leave a blank. Continue-button appears only after an error the user must remember. |
| 7 | Flexibility and Efficiency | 3 | Hotkey, Esc, ↑↓ in search, Return-to-send, talk-first L0 — Alex can move. First-open picker and 28pt 🎙 tax that speed. No keyboard for 新对话. |
| 8 | Aesthetic and Minimalist Design | 1 | Capture shell stuffed with picker, 新对话, emoji mic, last-thread caption, dual attach, send+continue, tool lines, markdown, dead settings/MCP views. Generic indigo-on-white AI chrome. Does not earn 看山. |
| 9 | Error Recovery | 2 | CTA sentence is honest and good. Then two buttons invert the hierarchy, log prints the error code, Side Panel standby is a disabled form with no way back. |
| 10 | Help and Documentation | 2 | One human hint, search-mode hint swap, 「完整格式在侧栏」. Hotkey picker duplicates stolen-key copy. Zero VoiceOver names. Mic only in tooltip. |
| **Total** | | **20/40** | **Acceptable (floor of the band) — significant work before this is a capture card, not a second chat window** |

Rating band (Operate, all 10 apply): 20–27 Acceptable. This is 20, not 27. A 4 was not earned anywhere. Heuristic 3 is the only score that would survive a design director's desk.

---

## Design Specificity Verdict

**Category-interchangeable. Not authored for CMspark 看山. Closer to a Raycast field glued onto a leftover ChatGPT window.**

The locked mix was specific: two-phase capture × 看山 (white paper, **indigo send only**, 16px composer radius, SF/PingFang). Empty talks first. `#` searches titles. History is plaintext `你:` / `助手:` lines, not bubbles. 「实验」 once (window title). Not a second ChatGPT. Not a launcher.

What shipped in Swift, even after the uncommitted diff that killed bubbles and hid MCP:

- **Tokens were copied, composition was not.** `#ffffff` / `#f4f4f5` / `#4f46e5` / 16px field radius / 11–15 type — that is the 看山 swatch, not 看山 discipline. Indigo lands on 「新对话」, hotkey-picker wash (`indigoSoft`), 「后台使用 Chrome」, and 「已连接，继续对话」. The locked rule was indigo **send only**. This is generic AI accent soup.
- **Structure is still a mini product.** Titled, closable `NSPanel` named `CMspark 召唤器（实验）`, plus tray menu `召唤器（实验）…`, plus 新对话, plus 🎙, plus last-thread caption, plus a 310px first-open hotkey exam. A capture card from the menu bar does not need a document chrome, a new-chat control, or a settings closet.
- **Option C (companion continuation / bubbles) was rejected and then half-reimported.** `attributedLine` still markdown-parses `助手:` bodies. `[工具]` lines. Log well grows to 320pt. That is ChatGPT overlay residue, not 「纯文本行」.
- **Option A (spotlight two-phase) was accepted as IA and then over-chromed.** `#` search is the right idea. Hits without time, no ⌕, emoji mic instead of a search glyph, empty-search Enter → submit — that is a broken launcher, not a quiet filter.
- A stranger could drop this panel on any indigo SaaS agent and nobody would know it belonged to 看山, 投研纪要, or a Side Panel that still holds the workspace.

Chosen HTML is more specific than the Swift. Wireframes are more honest than both about what P0 is allowed to draw. The implementation is the generic one.

---

## Overall Impression

The thesis survived in the type-in-one-field logic: talk goes to the current thread; `#` flips to title search; Esc lets go without aborting. That is the product.

The picture did not. First open is a hotkey questionnaire. Empty is not empty — it wears 新对话 and a microphone emoji. Detached is a control panel (silent Chrome, foreground Chrome, Send). Chat is a markdown log in a gray well with a footer the spec only allowed in one state. Side Panel standby is a grayed 看山 composer that still looks armed.

Biggest opportunity: **delete until the four chosen states can be photographed.** Empty = badge + 16px field + one hint. Search = `#` + title rows with time. Chat = plaintext lines + 发送 / 已连接. Detached = one honest CTA. Everything else is a second window.

---

## What's Working

1. **Talk-first L0 in a single field, with `#` as the only search gate.** `[inspected]` `isSearchQuery` / `searchNeedle` / hint swap to「只搜标题，不搜正文」. This is the locked IA. It is the one thing that could not be a generic ChatGPT floater. Keep it; do not let 0-hit Enter punch a hole in it.

2. **Close is not abort; IME Return is not send.** `[inspected]` `emitClosedIfOpen` comment and `hasMarkedText()` on newline. For a 投研 user composing 宁德时代 in Pinyin, this is the difference between a capture shell and a landmine. Esc-to-dismiss is the native overlay contract.

3. **Transcript direction is finally plaintext, and the CTA sentence is honest.** `[inspected]` uncommitted diff replaces bubbles with `你:` / `助手:` lines; `summonerCtaCopy` matches chosen HTML word-for-word including「我们不能替你打开侧栏」. Those two decisions are 看山-adjacent. They are currently wearing the wrong clothes.

---

## Priority Issues

### [P0] First open is a hotkey wall, not「空场先说话」

- **What:** `open()` → `showHotkeyPicker()` when `!hotkeyConfigured`. Picker is an indigo-soft 12px slab: title, hint, **duplicated** stolen-combo paragraph, three stolen rows, then every candidate as a full-width rounded button. Relayout adds **310pt**. Chosen empty state is: warn-ish badge「检测浏览器…」, 16px field, placeholder「说点什么，或按住说话…」, one hint. No picker. No 新对话.
- **Why it matters:** Peak-end / first-open is the brand moment. The user summoned a capture card and got a preferences exam. Alex skips and resents it. Jordan thinks the overlay *is* a shortcut settings app. Cognitive load: single-focus fail, chunking fail (stolen copy **plus** stolen rows **plus** candidate list), >4 visible options.
- **Fix:** Talk first. Pick a default hotkey (or tray-only until chosen). If a picker is mandatory, it is a **one-time sheet after first successful send**, or a single line under the hint — not a 310pt indigo billboard. Stolen combos belong in a footnote, once.
- **Suggested command:** `/impeccable distill` (then `/impeccable onboard` only if a first-run beat is still required)

### [P0] Detached state ships two Chrome CTAs, inverted indigo, and a Send footer

- **What:** Chosen / wireframe 04: one amber note, **one** filled button「激活 Google Chrome」. Foot hidden. Swift `applyPhase`: `ctaBox` + `attachButton` + `silentAttachButton` when `detached && hasTranscript`; `footRow` still visible; indigo is on「后台使用 Chrome」, plain on「激活 Google Chrome」. Relayout budgets 140pt CTA + 48pt foot.
- **Why it matters:** The locked copy exists to tell the truth: we cannot open the Side Panel. The UI then offers a silent path, a loud path, and Send — three interpretations of the same failure. Indigo-on-silent is the opposite of 看山「indigo send only」and the opposite of the wireframe fill. Peak-end on error is confusion, not honesty.
- **Fix:** Detached = CTA copy + **one** button「激活 Google Chrome」(indigo, full width). Hide foot. Hide「后台使用 Chrome」from this card (policy belongs in tray Settings, which already exists as `⚙️ 设置`). Do not print `BROWSER_UNAVAILABLE` in the log; the CTA is the diagnosis.
- **Suggested command:** `/impeccable quieter` + `/impeccable clarify`

### [P0] `#` with zero hits sends the search string to the model

- **What:** `[inspected]` `textView(_:doCommandBy:)` search branch: empty `hits` → `submitComposer()`. Spec / wireframe: Enter selects a thread, does not send to the model; 0 results keep the hint, no empty illustration.
- **Why it matters:** Error prevention. Jordan types `#投研`, misses, hits Return, and has just asked the LLM for a hashtag. The two-phase contract collapses into chat. This is how a capture shell becomes ChatGPT.
- **Fix:** 0 hits + Return = no-op (or keep focus in the list). Optional one-line「没有这个标题」in the hint slot — not a postcard empty state.
- **Suggested command:** `/impeccable harden`

### [P1] Instrument chrome and leftover ChatGPT in a capture shell

- **What (every visual contract break vs chosen four states):**

  | Contract (chosen HTML / lock) | Swift now |
  |---|---|
  | Overlay is a 420× floating **card**, 16px outer radius, no document chrome | `NSPanel` `.titled + .closable`, system title bar, traffic lights, `title = "CMspark 召唤器（实验）"` |
  | 「实验」**once** | Window title **and** tray `召唤器（实验）…` (card-internal「召唤器 · 实验」was correctly removed) |
  | Header = status badge only; empty exp span | Extra indigo text button「新对话」 |
  | Composer: ⌕ + 16px radius + 3px accent-soft focus ring | No ⌕; 🎙 emoji 28×28; custom indigo 0.45 border; **no** `focusRingType` so system ring likely doubles |
  | Empty badge class = warn pill「检测浏览器…」 | Gray muted pill (`SummonerTokens.muted`) until `browserKnown` |
  | Hits: title **+ time**; indigo-soft selected row | Title only; 32pt rows; no alias/time |
  | Transcript: plaintext `你` / `助手` (lock: `你:` / `助手:`), ≤20 lines, 196px well, **no markdown, no bubbles** | `你:` / `助手:` prefixes good; `capLines` **40**; well **180–320**; `AttributedString(markdown:)` on assistant; `[工具]`; `系统: BROWSER_UNAVAILABLE` |
  | Chat foot: 发送 (plain) + 已连接，继续对话 (indigo) | Foot whenever transcript; Continue **only** if `browserAttached && sawBrowserUnavailable`; Send always |
  | Detached: no foot | Foot remains |
  | No MCP line | Field still built, copy still written, **forced `isHidden = true`** — a landmine |
  | No settings on the card | `settingsBox` still in the tree (idle 0/10/30/-1 + Chrome 后台/前台); header button removed so it is **dead chrome** |
  | Hint empty:「回车发送到当前线程，输入 # 搜标题」 | Matches `[inspected]` — keep |
  | CTA copy | Matches — keep the sentence, kill the second button |
  | `appearance = .aqua` / white paper | Correct 看山 lock; do not add dark-mode flavour |

- **Why it matters:** Consistency 1/4. 看山 is a subtraction aesthetic. Every extra control teaches the user this is home. Markdown is a ChatGPT bubble in typography. 新对话 in indigo is a second primary. Last-thread「继续 · {title}」is a third.
- **Fix:** Header = badge. Field = 16px, SF 15, focus = `tokens.shadowFocus` equivalent (3px `#eef2ff`), optional quiet ⌕, **no emoji**. Log = unstyled plaintext, cap **20**, max ~196. Continue button only in connected-chat as spec, or drop it if Send+Return already continue. Delete settingsBox/mcpField from `makeWindow`. Use a borderless / HUD-style panel with 16px corners if AppKit will allow it; if not, hide the title text and accept traffic lights as the one native tax — do not also paint 新对话.
- **Suggested command:** `/impeccable quieter` then `/impeccable typeset`

### [P1] Side Panel standby is a broken 看山 form, not the same product

- **What:** `[inspected]` `overlayStandbyLabel` →「这边暂时打不了字，正在召唤器里说」. Capsule: textarea `disabled`, attach disabled, send gray 32×32. **Capsule opacity/background still the armed 看山 invitation** (opacity 0.85 only for no-thread / no-connection). `ComposerChips` still render. No banner, no lease explanation, no control to reclaim the composer.
- **Why it matters:** Dual-open is the actual product topology (overlay holds the lease). The Side Panel is where 看山 lives. Putting a disabled, fully chromed composer under the user's nose says the product is broken, not that speech moved. Jordan will mash Send. Sam hears a disabled text area with no live region.
- **Fix:** One standby strip (secondary type, not a gray fake field):「正在召唤器里说 · 关掉召唤器后这里继续」. Hide chips, hide attach, hide armed send. Same paper, same type, no zombie capsule.
- **Suggested command:** `/impeccable adapt`

---

## Cognitive load checklist (8)

| Item | Pass? | Note |
|------|-------|------|
| Single focus | **Fail** | First-open picker + 新对话 + 🎙 + field + last-thread. Detached: two Chromes + Send. |
| Chunking (≤4 / group) | **Fail** | Stolen paragraph + 3 occupied rows + N hotkey buttons. Idle settings 4 + Chrome 2 still in the view tree. |
| Grouping | Partial | Badge/field/hint are grouped. CTA groups two competing actions. Hits are a stack of untitled buttons. |
| Visual hierarchy | **Fail** | Indigo on 新对话, picker, silent Chrome, Continue. No one primary on empty. Spec wanted one invitation field. |
| One thing at a time | **Fail** | Hotkey decision before talking. Search vs send on the same Return. |
| Minimal choices (≤4) | **Fail** | Detached ≥3 actions. Picker ≫4. |
| Working memory | Partial | User must remember `#` (hint helps), remember Continue only appears after reattach, remember tray Settings for policies. |
| Progressive disclosure | **Fail** | First frame dumps picker. MCP/settings exist but are hidden rather than designed away. Search time/alias — the useful disclosure — is missing. |

**Failed: 6 / 8 → high cognitive load (critical).** 0–1 would be a capture card.

---

## Emotional journey

- **First-open:** Spec peak is the empty field speaking. Actual valley: indigo exam, stolen-key warning in warn-fg, then maybe you may talk. Patronizing for Alex, alarming for Jordan.
- **Happy path:** Typing + Return + plaintext reply can feel like a quiet desk note. Undercut by 新对话 watching from the header and a log well that grows like a chat app.
- **Search:** `#` is a small delight if you already know it. Missing dates on 投研纪要 rows kill the scan. 0 hits + Return is a betrayal.
- **Error (peak-end):** The sentence「我们不能替你打开侧栏」is the right emotional register — adult, specific, not Allow-dialog. Two buttons and `BROWSER_UNAVAILABLE` spend that trust.
- **Side Panel:** Walking back to 看山 and finding a disabled composer is an embarrassment, not a handoff.
- **Dismiss:** Esc / close without abort is the only reassuring end-state. Protect it.

---

## Persona red flags

### Alex (power user)

- First-open hotkey picker cannot be skipped except by picking. Forced onboarding on a summon.
- No accelerator for 新对话; it is a tiny indigo label.
- 0-hit `#` Return sending to the model is a trap he will hit at speed.
- Dual Chrome CTAs: he will click silent, then wonder why the Side Panel still is not in front.
- Esc-to-dismiss and IME guard are the reasons he might stay. Do not tax them with a 310pt preamble.

### Jordan (first-timer)

- Overlay looks like Spotlight / Raycast (field + hits) **and** like ChatGPT (log + Send + 新对话). No idea this is not the workspace.
- `#` is jargon even with a hint. Empty placeholder talks about speaking, not about `#`.
- 🎙 with hold-and-click in a tooltip: they tap, nothing obvious, they tap again, they have recorded a blip (`held < 0.35` early-return still running).
- Title bar says 实验. Tray says 实验. They think the whole product is unfinished, not a scoped overlay.
- Detached: three things to press. They will press Send again.

### Sam (accessibility)

- **No `accessibilityLabel` / `setAccessibility` anywhere in `Tray.swift`.** `[inspected]` grep empty.
- Mic is 🎙, 28×28 (spec/HIG 44×44). Footer buttons 36pt. Hit rows 32pt. 「新对话」inline, unlabeled beyond title.
- Placeholder is a **separate `NSTextField` overlaying** the `NSTextView` — VoiceOver can announce a static label and an empty text view as two objects.
- Badge state is color (green/amber/gray) plus text; text saves it, but no `NSAccessibility.Announcement` / live region when it flips.
- System focus ring likely stacked on the custom border (`focusRingType` never set).
- Forced `.aqua` is fine for 看山 paper; Dynamic Type is ignored (fixed 11/13/15).
- Side Panel standby: disabled textarea, send `title` is the only explanation, no `aria-live`.

### 投研 / 知识工作者 (CMspark-specific)

- Hits are title-only. Wireframe/chosen rows were「投研纪要 · 宁德时代 / 昨天」. Without time, yesterday's 年报对比 and last quarter's are the same shape. This user scans dates first.
- Overlay markdown and `[工具]` lines compete with the actual workspace (Side Panel mermaid, citations, export). They will start treating the card as the notebook. It is not; 「完整格式在侧栏」is the truth and should stay visually quieter than the log.
- `BROWSER_UNAVAILABLE` is an API. They needed「浏览器没连上」.
- Standby on the Side Panel during a call with the overlay open means they cannot paste a 公告 excerpt into 看山. Lease is correct; the UI must look like a pause, not a crash.

---

## Minor observations

- `patchStreamingLine` sets `tv.string = lines.joined` (loses attributes) then `markDone` → `refreshLog` re-applies markdown. Stream looks like a different typeface/weight mid-flight. `[inspected]`
- `lastThreadCaption` 「继续 · {title}」is a useful recognition aid **and** extra chrome on empty. If kept, it replaces 新对话, it does not sit beside it.
- Mic tooltip admits two gestures (click toggle **or** hold). Pick one. Hold-to-talk matches the placeholder; click-to-toggle matches every other 32px button. Dual is how accidental recordings happen.
- `makeIndigoButton` uses `bezelColor` (11+) — native, good — but then indigo is spent on the wrong buttons.
- `cornerRadius = 999` on the badge is a CSS-ism; AppKit wants `height/2`. Usually works; sometimes clips the 11px label.
- Relayout height math (`108 + 310 + 118 + 18 + …`) will fight Auto Layout as soon as Dynamic Type or wrapping CTA copy appears. Chosen card is 420 wide; keep it, but do not grow like an accordion product.
- Tray menu still uses emoji (🔑 🌐 ⚙️) as structure. Out of overlay scope, but the same 看山 / pro-rules violation sitting next to「召唤器（实验）…」.
- Chosen HTML empty still uses warn `.badge` (amber) for「检测浏览器…」. That is a remaining spec smell: detecting is not a warning. Swift's gray is more honest **and** still a contract break because the lock file paints amber. Resolve in the spec, then match — do not freelance a third color.
- Settings policies (resume idle 0/10/30/-1, Chrome foreground) are real product. They do not belong **inside** the capture card. Tray Settings already exists.

---

## Questions

- If the overlay cannot be a 16px rounded borderless card on macOS without fighting NSPanel, **which native tax is the one you will pay** — traffic lights, or a menu-bar popover — so we stop pretending it is the HTML mock?
- Is「已连接，继续对话」a **chat-state primary** (chosen HTML) or a **post-reattach recovery** (Swift `sawBrowserUnavailable`)? It cannot be both; the current split is why footer chrome never matches a photograph.
- Is hold-to-talk P0 for 投研, or a Side Panel feature leaking into a capture field? If P0, it needs a 44pt control and a visible recording state, not 🎙.
- Should `#` be a visible chip / prefix affordance, or remain a hidden operator with a 11px hint? 投研 users will not discover operators; they will rediscover Cmd-F.
- When overlay holds the lease, is the Side Panel a **spectator** (read the thread, cannot type) or a **paused instrument** (hide the composer)? Spectator needs a live transcript; paused needs a strip. Today it is a disabled form.

---

## Architectural / visual STATUS and VERDICT

**STATUS:** Uncommitted Swift moved toward the lock (bubbles out, MCP hidden, 「召唤器 · 实验」off the card, talk-first hint, `#` gate, IME/Esc). The four states still cannot be photographed. First-open, detached, search-submit, indigo placement, titled panel, markdown, and Side Panel standby are not 看山 capture. They are a generic indigo overlay with ChatGPT leftovers.

**VERDICT: REJECT**

Not APPROVE_WITH_NITS: nits are radius/focus-ring/time-on-rows. This is still the wrong object (mini chat + launcher + prefs) wearing the right hex values. Do not ship the overlay as a second window. Distill to the four chosen frames, then re-critique.

---

*Assessment A only. Detector / Assessment B not run (per brief).*
