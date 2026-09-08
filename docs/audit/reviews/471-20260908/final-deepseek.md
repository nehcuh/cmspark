# Final Independent Closure Review #471 — READ ONLY

## VERDICT: **APPROVE_WITH_NITS** (design and implementation; no P0/P1/MAJOR outstanding)

No edits made. No commands run. Evidence tags: `[inspected]` static/delta reading (including this packet's machine logs and test source), `[executed by author]` observations from supplied log tails, `[assumed]` reasoning.

---

## Design closures

All prior design findings close:

1. **Grok r2 split live-region/buttons — closed.** `role="status"`/`aria-live` moved to a `.cm-sr-only` span; the visible, actionable pairing/trust controls are sibling native buttons outside the live region. Status updates cannot steal focus. `:has()` gate collapses padding when no button exists; relies on Chromium ≥105 — fine for MV3 side panel `[inspected]`.
2. **Grok r2 license modal — closed.** Modal named "实验层许可证与免责声明"; content wrapper spreads `inert: ""` only while the door is open; shared `useModalDialog` traps Tab/Shift+Tab (its Escape `stopPropagation` prevents the nested settings-Modal Escape from co-firing); Escape closes only the license, sends no `accepted:true`. Deep-link effect now skips (without clearing `settingsFocusSection`) while the door is open and re-applies on close — the promised queueing. The custom `lastSettingsFocus` rAF restore is the correct fix for a real gap: inert blur moves focus to `body` before the inner modal's effect captures `prevFocus`, so the shared hook's restore alone would land on body. Interplay is sound: restore runs only when no pending deep link `[inspected]`.
3. **Grok r2 save scope — closed.** Footer relocated inside `cm-settings-content` (license makes it inert; before, Save stayed clickable under the license). Label "保存并关闭"; permanent scope copy "保存配置草稿；独立表单与授权需分别提交。"; `handleSave` strips `native_vision_detected` and closes. Independent forms (UserEnv/NetSec/arm phrases/license/downloads) unchanged `[inspected]`.
4. **Hide unused selector from AT — closed.** ≥760 nav displayed / `.cm-settings-mobile-category` `display:none`; <760 inverse; `display:none` excludes from a11y tree. Machine test asserts exactly one visible page per width `[executed by author: settings-final2 PASS]`.
5. **Active/hover/focus recipe — closed.** `aria-current=page`, `navSelected`/`bgHover`, 2px accent focus-visible on buttons/select/summary/h3, h3 `tabIndex=-1` focus on manual nav, select retains own focus `[inspected]`.
6. **Autonomy stays security — closed** (integrations holds only the pointer copy). **Pointer text** and **session-index comment** updated `[inspected]`. **DeepSeek autonomy condition** clarified in 收口澄清 `[inspected]`.
7. **Remaining acknowledged NITs** (status action visible on its own page; redundant select aria-label; shared h3 hierarchy) are deliberate, low-risk — accepted.

## Implementation closures

- **Prior Grok P1 composer duplicate — closed.** Legacy `newThreadBar`/`chev`/`settings` now sit in a `<div hidden>` outside composer; machine asserts `.composer-actions button:visible` == `['attachFile','mic','sendGo']` and exactly one visible 新对话 at 320/390/1000, including post-reset empty state `[executed by author]`.
- **M1/M2/M3 — closed**: summary min-height 36, "笔记导出" heading with relocated reasoning checkbox (single copy — add/remove delta verified), blanket 36px button minimum `[inspected]`.
- **Process correction accepted.** r1's premature Companion claim is not inherited; latest run 4996 pass / 0 fail / 23 skipped (5019) plus settings-cli 20/20 is now gate evidence `[actual logs]`.

## New-delta review (below P-level)

`SettingsAssistant`/`HotkeyCaptureField` `active` gates: generation counter aborts on collapse, late `result/error/end` callbacks no-op, explicit-stop path preserved (same-generation `onend` still commits), capture cancels on page switch/license. Machine: collapse→`aborted===true`, late `end()` no-op, explicit stop commits `continuous`, no implicit `config.set`/`license_response` writes `[executed by author]`.

## Findings (NIT only)

1. **Duplicate `.cm-settings-panel` blocks** — legacy `min(780px…)` rule then a second `min(980px…)`+height rule; cascade works, consolidate.
2. **Blanket 36px minimum inflates compact controls** — preset chips and intent-bar 执行/语音 buttons inside the panel inherit it; spec-compliant but visually denser than their inline paddings suggest.
3. **Focus falls to body** when the license door is already open at settings mount and no prior content focus/deep-link existed (`lastSettingsFocus` null). Suggest fallback to the first nav button or page h3.
4. **Context-window help text placed above its select**, inconsistent with the file's help-below-control pattern.
5. **"正在检测连接" can persist indefinitely** if the pairing reply never arrives (mechanism pre-dates this PR, but the status is now more prominent).
6. **Stale header in `settings-sections.ts`** still cites spec "settings-thread-compact" `[inspected]`.

## Assumptions / limits

- **React `inert`**: the omission pattern (never renders `inert={false}`) relies on prop-diff attribute removal; machine focus-restore assertion corroborates. Keep this pattern rather than boolean false `[assumed, machine-corroborated]`.
- **Summoner script handler wiring** for the relocated hidden targets not re-read; covered by page-error and visibility assertions in exercised flows. Residual: none observed.
- **23 skipped Companion tests** assumed platform-gated `[assumed]`. Native/Swift surfaces not certified (out of scope).

**FINAL: APPROVE_WITH_NITS.** All 7 design follow-ups and both implementation P1s closed; machine evidence green on both halves. NITs 1–6 are cosmetic/documentation, safe as follow-up commits.
