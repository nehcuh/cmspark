# Independent adversarial review — PRODUCT-UX

**Lane**: PRODUCT-UX (L0 overlay capture, copy honesty, dual-surface composer)
**Date**: 2026-08-23
**Repo**: `/Users/huchen/Projects/cmspark`
**Branch**: `feat/os-agent-shell` (dirty, ahead 1 of origin)
**HEAD**: `659bbce` (`docs(memory): S77 session-end — overlay isolated, #213 on main`)
**Scope**: working tree overlay/summoner + hashed `cmspark-tray`. READ-ONLY. No other-lane reports read. No production edits.
**Constraint**: overlay is L0 capture, not a main UI.

This lane asks whether a human using the overlay + Side Panel will be *told the truth* and *not get stuck*. Architecture/correctness of leases is in-scope only where it becomes a user-visible lie.

---

## Machine `[executed]`

| Check | Result |
|--------|--------|
| `git rev-parse --short HEAD` | `659bbce` |
| `shasum -a 256 companion/dist/cmspark-tray` | `eae29dc748584d4de7e60c621c13da71ec633f2b33b2de1caee970196e7fb67b` |
| SHA vs `SWIFT_TRAY_SHA256` in `swift-tray-bridge.ts` | **match** (comment: “Updated 2026-08-23 after R3 applyHydrate no-reopen”) |
| `strings cmspark-tray \| rg "按住说话\|听写暂未开放\|回车发送\|说点什么"` | `听写暂未开放` · `回车发送到当前线程，输入 # 搜标题` present; **`按住说话` absent; `说点什么` absent** |
| Whole-file UTF-8 / UTF-16LE / UTF-16BE search for `说点什么` / `按住说话` | **neither phrase exists in the hashed binary** |
| Swift UI | not executed (no XCTest host). Control flow `[inspected]` from `Tray.swift` + Node |

`__cstring` dump of the hashed binary **does** contain: `听写暂未开放`, `回车发送到当前线程，输入 # 搜标题`, `我们不能替你打开侧栏…`, `浏览器未连接 · 网页操作请点工具栏图标（不能替你打开侧栏）`, `完整格式在侧栏`, `只搜标题，不搜正文`, `检测浏览器…`. It does **not** contain the talk placeholder.

---

## Hunt scorecard

A named hunt item **PASS** only if both (a) working-tree source and (b) the hashed binary/runtime path a user actually launches agree, unless noted as source-only.

| # | Hunt | Result | Evidence |
|---|------|--------|----------|
| 1 | Overlay is L0 capture, not main UI | **PASS with nits** | Zero Allow/Deny in `SummonerController` `[inspected]`. MCP field forced hidden. Loud CTA box forced hidden. Unwired `settingsClicked`. Residual: titled 420px window + markdown transcript + 新对话/快捷键. |
| 2 | Placeholder honesty (no `按住说话`) | **SOURCE PASS / BINARY FAIL** | Source `summonerTalkPlaceholder = "说点什么…"` `[inspected]`. Hashed binary has **neither** `说点什么` **nor** `按住说话` `[executed]`. |
| 3 | Send visible empty/detached | **PASS** (source) | `applyPhase`: `sendButton?.isHidden = false`; `footRow?.isHidden = searching` only `[inspected]`. Tests lock the old `!chatting \|\| detached` hide. |
| 4 | `applyHydrate` must not resurrect a closed window | **PASS** (source) | `guard isOpen else { return }`; focus only `if window?.isVisible == true`. Working-tree diff **removes** `open(threadId:)` from hydrate `[inspected]`. |
| 5 | Esc close sticks | **FAIL (race)** | Esc → `hide()` → `isOpen = false` → `summoner.closed`. Hydrate will not reopen. **`searchTimer` is not invalidated on hide** — delayed `#` search can re-claim the overlay lease after close. |
| 6 | `#` search 1-hit hydrates | **PASS, over-eager** | `handleSummonerSearch` hydrates when `hits.length === 1` `[inspected]`. Empty `#` is defined as 1 hit (newest thread) so `#` alone always hydrates. |
| 7 | Mic hidden | **PASS** (source) | `micButton?.isHidden = true` in `applyPhase`. Tooltip `听写暂未开放` is in source **and** binary `[executed]`. Composer still trailing-constrained to the hidden 28pt mic. |
| 8 | CTA not loud | **PASS** (source) | `ctaBox` / attach buttons forced `isHidden = true`. Detached copy is faint `sideNote`, not the warn panel. Loud CTA *strings* remain in the binary but are not shown if `applyPhase` from this source is what was compiled. |
| 9 | Side Panel `OVERLAY_STANDBY` vs overlay gone | **FAIL** | Happy path close → `release_overlay` → broadcast `composer.lease` holder=`panel` → `APPLY_COMPOSER_LEASE` clears. **Post-Esc 1-hit search calls `beginOverlaySession()` again and re-claims overlay while the window stays closed.** Panel then lies: “正在召唤器里说”. |

---

## Findings

### BLOCK B1 — Esc during `#` search can leave Side Panel in `OVERLAY_STANDBY` with the overlay gone

**This is the named hunt item “OVERLAY_STANDBY vs overlay gone”, and it still holds.** `[inspected]`

Repro (no Swift runner here; control flow is linear):

1. Overlay open. Type `#` (hint invites this).
2. Hit Esc within 150ms of the last keystroke.
3. `textView(_:doCommandBy:)` → `hide()` → `emitClosedIfOpen()` → `isOpen = false` + `summoner.closed`.
4. Node `handleSummonerClosed` → `invalidateOverlaySession()` + `releaseAllOverlayComposerLeases()`. Panel would recover **if nothing else happened**.
5. `searchTimer` is **not** cleared in `hide()` / `emitClosedIfOpen`. 150ms later `emitSearch()` still fires.
6. `handleSummonerSearch` → empty needle → `filterThreadsByTitle` returns **exactly one** hit (newest thread) → `hydrateSummonerThread(id)`.
7. `hydrateSummonerThread` **always** `beginOverlaySession()` (sets `live = true` on a *new* generation). That undoes the close invalidation.
8. Swift `applyHydrate` correctly no-ops (`guard isOpen`). Window stays gone. **Lease is still claimed as overlay.**
9. Side Panel `composer.lease` holder=`overlay` → `APPLY_COMPOSER_LEASE` → textarea disabled, placeholder **「这边暂时打不了字，正在召唤器里说」**.

User-visible lie: the summoner is not on screen. Composer on the Side Panel is dead. Recovery is not documented (re-open overlay, Esc without `#`, or switch threads then send and get another standby).

Why the overlay-session tests stay green: they cover *in-flight hydrate with the same token*. Search after close starts a **new** session. `handleSummonerSubmit` uses `currentOverlaySession()` + `claimOverlayIfLive` (good). Search does not.

```1619:1640:companion/src/tray/Tray.swift
  func hide() {
    window?.orderOut(nil)
    emitCompanionUiRect("overlay", window: nil)
    emitClosedIfOpen()
  }

  func applyHydrate(_ json: [String: Any]) {
    guard isOpen else { return }
    // ... mutates state, does not open()
  }
```

```1806:1810:companion/src/tray/Tray.swift
    if isSearchQuery(composerText) {
      refreshHits()
      searchTimer?.invalidate()
      searchTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: false) { [weak self] _ in
        self?.emitSearch()
      }
```

```635:638:companion/src/menu-bar-agent.ts
async function hydrateSummonerThread(id: string): Promise<boolean> {
  const client = summonerClient
  if (!client) return false
  const token = beginOverlaySession()
```

```771:778:companion/src/menu-bar-agent.ts
export async function handleSummonerSearch(query: string) {
  const threads = (await summonerClient?.listThreads()) ?? []
  const cmd = summonerHitsFromQuery(threads, query)
  trayInstance?.sendSummoner?.(cmd)
  if (cmd.hits.length === 1) {
    const claimed = await hydrateSummonerThread(cmd.hits[0].id)
```

Fix that actually closes the hunt (do not implement in this lane):

1. `hide()` / `emitClosedIfOpen`: `searchTimer?.invalidate(); searchTimer = nil`.
2. `handleSummonerSearch` must **not** call `beginOverlaySession()`. Pass `currentOverlaySession()` into `hydrateOverlayIfLive`. After close that token is dead → no claim.
3. Do not treat empty `#` as a 1-hit (see N2). Then a lone `#` + Esc cannot uniquely hydrate.

Until (1)+(2) land, this nits fold does not satisfy hunt #5/#9.

---

### MAJOR M1 — Hashed `cmspark-tray` is not a faithful build of current `Tray.swift` copy

`[executed]` SHA lock matches **this** binary. The binary does not contain `说点什么` (required honest placeholder) and does not contain `按住说话` (good). Working-tree source:

```1435:1438:companion/src/tray/Tray.swift
private let summonerWindowTitle = "CMspark 召唤器（实验）"
private let summonerTalkPlaceholder = "说点什么…"
private let summonerTalkHint = "回车发送到当前线程，输入 # 搜标题"
```

HEAD still has `说点什么，或按住说话…`. Working tree dropped the lie. The hashed binary has **neither** sentence. A user of the SHA-locked tray therefore does not see the honest placeholder this nits fold claims to ship. Hint `回车发送…` is present, so the field is usable but unlabeled.

`听写暂未开放` **is** in the binary, so *some* of this nits copy landed. Placeholder did not. That is a lock-step failure, not a `strings` encoding miss: UTF-8 / UTF-16LE of `说` as a CJK letter are absent from the 353k Mach-O; the one `8b f4` hit is ARM immediate bytes, not a string.

**Ship gate**: rebuild via `companion/src/tray/build-tray.sh` from *this* `Tray.swift`, write the new SHA into `SWIFT_TRAY_SHA256`, re-run the same `strings`/`python` needles. Do not merge the copy nits until the hashed binary contains `说点什么` and still lacks `按住说话`.

---

### MAJOR M2 — Empty `#` is defined as a 1-hit, so “1-hit hydrates” fires on the first character

`[inspected]` `filterThreadsByTitle("", threads)` returns `sorted.slice(0, 1)` — newest thread only, not a recents list.

Combined with `handleSummonerSearch` auto-hydrate on `hits.length === 1`:

- Typing `#` (no needle) **always** hydrates + claims the latest thread after 150ms, if any thread exists.
- User cannot browse titles with `#` alone. They only get a list when the needle matches **2+** titles.
- This is also the fuel for B1: `#` + Esc is sufficient; no unique title required.

1-hit hydrate on a **unique needle** is the right product (hunt #6). 1-hit hydrate on **empty needle** is not search — it is a silent thread switch. Overlay stays in search phase (`applyPhase` `searching` while composer still holds `#…`), so the user sees title-search chrome on top of someone else’s transcript.

`selectThread` on Enter still emits `summoner.select` and hydrates again — redundant but OK. The bug is hydrating *while the user is still typing `#`*.

---

### NIT N1 — Hidden mic still owns 28pt of the composer

`[inspected]` `applyPhase` sets `micButton?.isHidden = true`. Constraints still pin `scroll.trailing` to `mic.leading` with a 28×28 control. AppKit hidden views still occupy those constraints (unlike `NSStackView.detachesHiddenViews`). Empty-state composer has a dead pad on the right where a 🎙 used to be — a visual “something was here” after you hid the control *because* dictation is not an L0 promise.

Tooltip `听写暂未开放` is honest **if shown**. Hiding the control is the right nits move (hunt #7). Collapse the constraint when hidden, or don’t add the button until STT is a product surface.

Journeys J5/M8 still teach press-hold 🎙 on the overlay. That is now unreachable. Either the spec or the button must win; right now source hides, spec advertises, tooltip says closed. Pick one.

---

### NIT N2 — Journeys spec still teaches the dishonest placeholder

`[inspected]` `docs/superpowers/specs/2026-08-23-os-agent-shell-user-journeys.md` J1.4:

> placeholder `说点什么，或按住说话…`

Working-tree overlay no longer says that. Spec, HTML chosen, and binary/source are three different products. This lane does not fail the *code* on a stale spec, but anyone dogfooding from the spec will file a ghost bug.

---

### NIT N3 — Overlay still renders markdown and a 360px log; L0 is composer-first

`[inspected]` Philosophy: plaintext `你:` / `助手:` lines, not a second ChatGPT. Implementation parses CommonMark into `AttributedString` and grows the log to 360px. Tests **lock** markdown rendering. That is not bubbles and not a confirm chrome — so not a BLOCK — but it is how a capture strip becomes a mini main UI.

Also present and L0-acceptable if kept quiet: 新对话, 快捷键 picker (opt-in, required), `继续 · {title}`. Unwired `settingsClicked` + hidden idle/chrome `settingsBox` is dead chrome in the binary (`再打开 · 超时后新对话` is in `__cstring`). Don’t ship a second settings surface by wiring that button later without a product decision.

---

### NIT N4 — Returning to the overlay-held thread clears Side Panel standby

`[inspected]` `SET_ACTIVE_THREAD` to a *different* id always sets `overlayStandby: null`. `composer.lease` apply is also gated on `shouldApplyStreamEvent(leaseTid, activeThreadId)` (same-thread only).

Sequence: overlay holds thread A, panel on A (standby, correct) → user clicks B (standby cleared, correct) → user clicks A again (standby stays **null**). Panel composer is writable on the overlay-held thread until the next `chat.create` comes back `OVERLAY_STANDBY`. Dual-draft window. After B1, the same switch-away/switch-back also “fixes” a leaked overlay lease *visually* until the first send fails — then the lie returns.

Not the B1 race; still a dual-composer honesty gap.

---

### NIT N5 — 0-hit Enter sends `#query` as a chat turn

`[inspected]` Swift newline while searching: if `hits.isEmpty` → `submitComposer()`. A title miss becomes a user message that starts with `#`. Hint does not say that. Prefer no-op / “无标题命中” over talking to the model in search dialect.

---

## What this nits fold *did* get right

Calibrated, because several hunts pass and should not be re-litigated:

- **Hydrate no-reopen (source).** HEAD `applyHydrate` reopened via `open(threadId:)` when `isVisible != true`. Working tree deleted that. Hunt #4 is fixed in Swift source.
- **Send stays in empty/detached talk.** `sendButton?.isHidden = false`; foot row only hides for `#` search. L0 “Chrome quit, still talk” is honored in layout.
- **CTA quiet.** Warn panel + “激活 Google Chrome” / “后台使用 Chrome” are forced hidden. Detached state is one faint line that still contains `不能替你打开侧栏` (no `openSidePanel` lie). Recoverability moved to the tray menu `🌐 打开 Chrome` — acceptable if we admit overlay will not attach Chrome itself.
- **Mic not advertised as press-to-talk.** Source hides it; binary tooltip is `听写暂未开放`; `按住说话` is gone from source placeholder and from the binary.
- **Close ≠ abort.** `summoner.closed` only; tests lock no `chat.abort`.
- **Happy-path lease release.** `handleSummonerClosed` → `releaseAllOverlayComposerLeases` → router maps `composer.lease.released` siblings to `composer.lease` holder=`panel`. Side Panel `APPLY_COMPOSER_LEASE` panel clears standby. **This works when no delayed search re-claims.**
- **Standby copy** is human, not a raw `OVERLAY_STANDBY` bubble (`这边暂时打不了字，正在召唤器里说`). `chat.error` standby path `break`s before `ADD_MESSAGE`.
- **IME Return** is not a button `keyEquivalent`. Out of this lane’s kill list, but not regressed in the nits fold.
- **Zero Allow/Deny** on the overlay controller. HUD/确认台 is a different window. Overlay title is `CMspark 召唤器（实验）` once.

---

## Open questions this lane will not resolve

- Whether the hashed binary’s `applyPhase` actually hides CTA/mic (copy in `__cstring` cannot prove control flow). Source says yes; binary date is 2 minutes after `Tray.swift`, SHA comment claims R3 no-reopen. Placeholder absence means “rebuilt from this file” is still false. Treat M1 as mandatory before any UX sign-off on the artifact users launch.
- Swift UI / IME 5/5 (journeys M5) was not run. Not a PRODUCT-UX reject by itself; CN no-go if M5 fails remains a host checklist item.

---

## Verdict rationale

Named nits (honest placeholder, visible send, no hydrate-reopen, hidden mic, quiet CTA) are **in source**. The hashed tray does not ship the placeholder. The dual-surface lie the whole lease system exists to prevent — **panel standby while overlay is gone** — is still one `#` + Esc away.

That is not an APPROVE. It is not “nits remaining on an otherwise closed fold” either, because hunt #9 is an acceptance item of *this* prompt.

Fix B1 (timer + don’t `beginOverlaySession` from search) and rebuild the tray for M1, then this lane can move to APPROVE_WITH_NITS (N1–N5) or APPROVE.

VERDICT: REJECT
