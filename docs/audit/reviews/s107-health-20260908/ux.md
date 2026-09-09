# Lane F — UX / DESIGN adversarial review

**Lane:** F (UX / DESIGN), independent of other lanes  
**HEAD:** `4a63de56` (`fix(workspace): 修复听写与代码任务归属，补齐对话分类 (#485)`)  
**Product:** 0.6.6 unreleased main (workspace #469/#470, summoner+settings nav #471/#472, thread mgmt #473/#475, brand #474, desktop workbench #479, workspace/voice ownership #481–#485)  
**Method:** source + docs + existing 481-483 screenshots. No live Side Panel / summoner window this turn.  
**Evidence:** `[inspected]` unless tagged `[executed]`. Screenshots: `docs/audit/reviews/481-483-20260908/screenshots/`.

---

## Verdict

**REJECT**

Primary conversation / settings chrome mostly matches root `DESIGN.md` and `docs/workspace-ui.md`. Two live paths still **lie about state or send the user to a settings category that no longer exists**:

1. Meeting Host **「收起」** ends an in-progress recording (`meeting.end` on unmount) while the label only means collapse.
2. Meeting + summoner recovery copy still says **「设置 → 听写」** after the eight-category rename to **「输入与语音」**.

Those are copy-honesty failures on primary voice/meeting recovery, not nits. Workspace IA, summoner-as-chat, eight-category settings nav, busy/thinking chips, SETTINGS_REQUIRED pointer, and knowledge off-state are otherwise honest.

---

## Surface inventory

| Surface | What ships at HEAD | Match vs SoT |
|---|---|---|
| Side Panel workspace | `WorkspaceFrame` 760px split: persistent 220px nav vs in-flow disclosure; `StatusRail` + `FocusBand` + `ChatView` + `ContextPanelHost` + composer in `main`. `[inspected]` `chrome-extension/src/sidepanel/App.tsx:217-250`, `WorkspaceFrame.tsx:10-40` | Matches root `DESIGN.md` IA (conversation-first, StatusRail single header, FocusBand priority). `docs/DESIGN.md` still describes 320px-only / indigo send — superseded. |
| Empty / ChatShell | Page: **要对这页做什么？** + 3 fill chips + **当前页：**; no page: **要我帮你做什么？**. `[inspected]` `chat-shell-copy.ts:26-48`, screenshot `empty-320.png` / `empty-1440.png` | Matches `docs/DESIGN.md` ChatShell copy and `docs/workspace-ui.md`. |
| Thread management | Rail **对话管理** + nav **管理对话** → same `ThreadList` (时间/标签/手动分组/AI). Disabled / auto-unmounts when pending confirm. `[inspected]` `ThreadList.tsx:1362-1419`, `WorkspaceFrame.tsx:53` | Matches `docs/workspace-ui.md` §对话管理. |
| Settings | Eight named pages, wide rail / narrow `<select>`, drafts stay mounted (`hidden=` not unmount). `[inspected]` `SettingsPage.tsx:5-14`, `SettingsSlideout.tsx:827-835` | Matches workspace-ui eight-category claim. IDs in `settings-sections.ts` are membership-only; presentation order is `SETTINGS_PAGES`. |
| Summoner HTML | Default `--app` **1040×760**, compact toggle **360×420**. Chat textarea + attach/mic/send; empty **要我帮你做什么？**. No mountain mark. Confirm CTA is **打开确认台**, not Allow/Deny. `[inspected]` `shell-open.ts:29`, `summoner-web.ts:1475-1573`, `summoner/protocol.ts:8`, screenshot `summoner-481-management.png` | Matches root DESIGN + workspace-ui visual. **Does not match** `docs/summoner-user-guide.md` §1 (still “360×420 Capture 卡”) or `docs/DESIGN.md` product-surface table. |
| Confirm / cruise | L0 composer always shows cruise chip; L2 composer chip **确认台**; pending → FocusBand `MinimalConfirm`; L2 auto-opens cockpit. Summoner cruise chip opens Operate, does not arm. `[inspected]` `ComposerCruisePicker.tsx:142-158`, `meta-slash.ts:307-326`, `App.tsx:209-215`, `summoner-web.ts:2525` | Phrase-gated arming is honest. L0 Confirm Center is slash/`装配`/`⋯` only — acceptable for L0, weak discoverability. |
| Voice | Capsule phases 预热/录音/转写; Hex PTT content-script; meeting panel. `[inspected]` `capsule-view.ts:35-84`, `contents/voice-ptt.ts` | Capsule honest. Hex PTT and meeting dual-收起 are not. |
| Knowledge | Smart-match off-state copy; 按堆选文 disabled when match off. `[inspected]` `KnowledgeSubPanel.tsx:583-594,896-938` | #288 honesty holds. |

---

## Density / IA notes

**Wide (≥760px).** Screenshot `empty-1440.png`: left nav 新对话 → 最近对话+管理对话 → 资料与工具 collapsed → 设置. Main is title + empty + 装配 + composer. Conversation-first. Matches root DESIGN and `WorkspaceFrame.tsx:52-69`. `[inspected]`

**Narrow (320–759px).** `empty-320.png` (481-483 evidence, not re-shot at `4a63de56`): 导航 · mode · mark · truncated title · + · popout · 对话管理 · connection. Composer still has attach / mic / **每次确认** / send. Primary send/stop/confirm remain on screen. Title collapses to a single CJK glyph (“发”) — identity of the thread is effectively gone. Current CSS hides `.cm-rail-brand` below 520px (`workspace-styles.ts:92`); the screenshot still shows the mark, so treat the shot as slightly stale, the truncation problem as live (`cm-task-title` ellipsis, `StatusRail.tsx:236`).

Narrow nav is `role="dialog"` `aria-modal="false"` in-flow (`WorkspaceFrame.tsx:34-38`). Spec: 36dvh, 28dvh only below 560px height (`DESIGN.md` Responsive). Code: **always 28dvh** at `max-width:759px` (`workspace-styles.ts:44`). Not a blocker; it does mean the disclosure is tighter than contracted.

**Summoner.** Screenshot `summoner-481-management.png`: this is a **chat workspace**, not a command palette. Left: 对话 / 新对话 / search / 查看方式 / thread 分类. Main: **要我帮你做什么？**, composer 问 CMspark…, 开始会议, 打开浏览器并打开侧栏. Header **每次确认** · **紧凑窗口** · **新对话**. Decorative 山 is gone (no mountain SVG in `summoner-web.ts` HTML). Compact 360×420 is a toggle (`summoner-web.ts:1708-1710,2544`), not the default.

**Settings IA.** `SETTINGS_PAGES` order = 模型与推理 / 输入与语音 / 文件与知识 / 连接与配对 / 安全与信任 / 本机与工具 / 密钥与环境 / 实验功能 (`SettingsPage.tsx:5-14`). `SETTINGS_SECTION_IDS` is a different order (`settings-sections.ts:7-16`) and is only the whitelist. Wide: `.cm-settings-nav`; narrow: `.cm-settings-mobile-category` select (`SettingsSlideout.tsx:828-833`, `workspace-styles.ts:74`). Deep link `OPEN_SETTINGS_SECTION` → `selectSettingsPage` (`SettingsSlideout.tsx:343-353`). Eight-category **claim is true in chrome**.

**Token hygiene.** `[executed]` `node scripts/check-sidepanel-raw-colors.mjs` → `scanned 4 files (PR-1 scope) … OK`. Scope is still App / ChatView / FocusBand / SceneStatusRow (`check-sidepanel-raw-colors.mjs:37-42`). WorkspaceFrame, StatusRail, Settings, VoiceStatusCapsule, summoner HTML are ungated. `tokens.ts` matches **root** DESIGN (charcoal `actionPrimary`, `radiusComposer: 20`, quiet `userBubbleBg: #f3f3f1`). `docs/DESIGN.md` still says white paper bubble, composer 16px, armed send = `tokens.accent` (`docs/DESIGN.md:156,175`) — that document has not been rewritten as a visual SoT.

---

## Findings

### BLOCK

**B1. Meeting Host「收起」ends recording. Copy says collapse. (#342 residual)**  
`[inspected]` `ContextPanelHost.tsx:285-293` generic **收起** / `aria-label="收起面板"` only calls `closePanel()`. `MeetingPanel.tsx:600-609` unmount effect: if `phase !== idle` and not finalized, **`meeting.end`**. The meeting-local button is honest: **结束并收起** (`MeetingPanel.tsx:1217-1239`). Two adjacent controls, one destructive with a collapse label. A user who folds the panel to keep chatting **kills the meeting**. That is copy lying about state on a primary meeting path.  
**Failure mode:** lost recording / minutes because the user trusted “收起”.  
**Fix direction:** while `phase !== idle`, Host close must say **结束并收起** (or confirm); or unmount must not `meeting.end` without an explicit end control.

**B2. Live recovery copy still points at「设置 → 听写」after the category rename.**  
Root DESIGN content voice: errors point at **「输入与语音」**, not stale **「设置 → 听写」** (`DESIGN.md:131-132`). Live chrome ignores that:

- `MeetingPanel.tsx:1271-1272` 「侧栏 ⋯ → 设置 → 听写 → 启用本机转写」
- `MeetingPanel.tsx:1303` 「设置 → 听写 → 下载组件/模型」
- `summoner-web.ts:1749` `STT_NEED_MODEL="侧栏 ⋯ → 设置 → 听写 → 下载组件/模型"`
- `meeting-diarize-copy.ts:24` 「设置 → 听写方式」

The eight categories have **no 听写 page**. Voice lives under **输入与语音** (`SettingsPage.tsx:7`). SETTINGS_REQUIRED for NetSec is the correct pattern (`companion/src/capability/settings-pointer.ts:40` 「设置 → 本机与工具 → 网络扫描（NetSec）」). Voice/meeting setup is a primary path; the instruction is undiscoverable. User guides still say the old path (`docs/meeting-and-dictation-user-guide.md:67-74`, `docs/summoner-user-guide.md` still 360×420).  
**Failure mode:** user opens 设置, cannot find 听写, concludes the product has no download UI.

### MAJOR

**M1. L1 composer chip still says `Tabs`.**  
`[inspected]` `meta-slash.ts:315` `{ id: "tabs", label: "Tabs" }`. Nav correctly says **浏览器标签页** (`ContextPanelHost.tsx:64`). Root DESIGN: name browser tabs 浏览器标签页 (`DESIGN.md:51`). Slash `/tabs` description is still 「打开标签面板」 (`meta-slash.ts:56`). Live chrome disagrees with the IA rename the workspace rewrite claimed.

**M2. Summoner / user-guide still sell a 360×420 Capture 卡; product default is 1040×760 chat.**  
`[inspected]` `OVERLAY_WINDOW_SIZE = { w: 1040, h: 760 }` (`shell-open.ts:29`); compact is opt-in (`summoner-web.ts:2544`). `docs/summoner-user-guide.md:18` 「召唤器是一张 **360×420** 的 HTML Capture 卡」. `docs/DESIGN.md:13` still lists Capture 卡片 360×420 as the surface. Root DESIGN + workspace-ui match the code. Shipping docs that describe a different product is honesty debt for anyone using the user-guide as SoT.

**M3. `docs/workspace-ui.md` attributes「用一句话调整设置」to the summoner.**  
`[inspected]` `docs/workspace-ui.md:16`. That control exists only in `SettingsSlideout.tsx:835`. Summoner `#settings{display:none}` (`summoner-web.ts:1383,1547-1548`). Users following workspace-ui will hunt a summoner settings assistant that is not there.

**M4. Gate-error copy still uses pre-rename settings paths.**  
`[inspected]` `gate-error-copy.ts:59-70` 「设置 → 能力档」「设置 → 网络扫描」; companion `user-gate-copy.ts:86-97` same. SETTINGS_REQUIRED card is correct (`settings-pointer.ts` + ChatView `ChatView.tsx:1388-1422`). Two recovery dialects; the older one wins for humanized bubbles and points at pages that are now **本机与工具** / **安全与信任**.

**M5. Hex PTT swallows keys with no in-page HUD; side panel may be closed.**  
`[inspected]` `contents/voice-ptt.ts:56-62` `preventDefault` + `stopPropagation` on every matching chord in an editable. Background `voice.ptt.page_chord` (`background/index.ts:1646-1656`) comments “side panel may be closed” and still `sendResponse({ ok: true })`. Visual state lives only in Side Panel capsule (`VoiceStatusCapsule.tsx`) + optional SFX + tray `hold_state`. If the panel is closed or unfocused, the page eats Ctrl+Shift+Space and nothing visible happens. User-guide still says panel must have keyboard focus (`meeting-and-dictation-user-guide.md:50`) — the content script does not enforce that.

**M6. Summoner「每次确认」chip is not the composer cruise picker.**  
`[inspected]` `summoner-web.ts:1525` title 「点此打开侧栏调整档位」; click = `$("operateOpen").click()` (`:2525`). Side Panel StatusRail cruise pill **left-click disarms** (`StatusRail.tsx:256-268`). Same words, opposite/adjacent actions. Tooltip is honest; the visual is not. Does not render L2 Allow/Deny (`summoner/protocol.ts:8`) — that part of the contract holds.

**M7. VoiceStatusCapsule uses leftover `#2563eb` blue, outside the hygiene gate.**  
`[inspected]` `VoiceStatusCapsule.tsx:17-19` `rgba(37, 99, 235, 0.14)` while `tokens.accent` is `#4f46e5` (`tokens.ts:26`). `docs/DESIGN.md:59` claimed no remaining `#2563eb` product accent. Capsule hint `fontSize: 10` (`VoiceStatusCapsule.tsx:61`) is below the chrome 11px floor. `[executed]` hygiene gate does not scan this file.

**M8. 320px StatusRail density: thread title is not a readable identity.**  
`[inspected]` `StatusRail.tsx:223-254` packs 导航+ModeBadge+brand+title+新对话+popout+对话管理. `cm-task-title` is nowrap ellipsis (`workspace-styles.ts:28`). At 320px the title is one character (`empty-320.png`). New/send/confirm still work; “what am I in” does not.

### NIT

**N1.** `docs/DESIGN.md` visual table lags tokens/root DESIGN: user bubble “white paper”, composer radius 16px, armed send indigo, empty attach-after-first-character. Live: `userBubbleBg #f3f3f1`, `radiusComposer 20`, send `actionPrimary` charcoal, attach visible on empty (`App.tsx:917-918`). Root DESIGN is the visual SoT; docs/DESIGN.md is not.

**N2.** Hygiene gate SCOPE still PR-1 four files (`check-sidepanel-raw-colors.mjs:37-42`). Workspace rewrite files (WorkspaceFrame, StatusRail, SettingsSlideout, summoner HTML) can ship raw hex forever. Summoner CSS already drifts (`#eaeae7` vs `navSelected #e9e9e6`, `#b91c1c` vs `danger #dc2626`, `summoner-web.ts:1386-1471`).

**N3.** Close glyphs are `×` / `✕` (`WorkspaceFrame.tsx:50`, `SettingsSlideout.tsx:819`, `ThreadList.tsx:1397`) plus toast `🤖` (`App.tsx:178`) and export `✓` (`StatusRail.tsx:173`). Quiet-professional chrome asked for SVG not emoji.

**N4.** Knowledge mode selected state uses raw `"#fff"` (`KnowledgeSubPanel.tsx:887`). Off-state copy itself is honest (`:591-594`).

**N5.** Busy/thinking/abort chips are honest: `truncationHonestyChip` distinguishes 已停止生成 / 思考用尽输出上限 / 输出被截断 and refuses to annotate thinking-then-tool (`chat-shell-copy.ts:7-23`); composer placeholders 回车纠偏 · 排队 (`thread-busy.ts:49-65`); stop vs 纠偏 vs 排队 (`App.tsx:944-980`). No BLOCK here.

**N6.** SETTINGS_REQUIRED pointer card + CTA 打开设置 deep-links `integrations` correctly (`settings-pointer.ts:12-59`, `ChatView.tsx:1388-1422`, `SettingsSlideout.tsx:343-353`). Keep this pattern; replace B2/M4 with it.

---

## Open questions

1. **360×420 compact summoner at 420px height** — CSS has `@media(max-height:560px)` and `@media(max-width:380px)` (`summoner-web.ts:1443,1461-1462`). Not verified live. Does brand + log + composer + 开始会议 + 打开浏览器 still fit without clipping send/stop?
2. **Hex PTT on a page with Side Panel closed** — is swallow-and-noop accepted, or should the content script no-op without `preventDefault` when the panel is gone?
3. **Confirm Center at L0** — is “only when L2 / pending FocusBand” enough, or does cruise sitting next to Send at 320px steal the mental model of “this chip is safety”? Phrase gate prevents accidental arm (`ComposerCruisePicker.tsx:118-125,130-135`); accidental **menu open** next to Send is still easy.
4. **Native macOS/Windows summoner / tray** — out of this batch (`docs/workspace-ui.md:14`). Not scored.
5. **Voice latency / cold start (#482)** — not measurable from source. Capsule copy is ready; hardware is not claimed.

---

## Scorecard (must-inspect)

| Item | Result |
|---|---|
| DESIGN.md vs tokens.ts vs hygiene gate | Root DESIGN ≈ tokens. docs/DESIGN.md lagged. Gate green on 4 files only. `[executed]` / `[inspected]` |
| App / WorkspaceFrame / FocusBand / ThreadList | Conversation-first IA ships. Coding session selector is thread-scoped (`agentStore.tsx:85-93`). |
| Settings eight-category nav | True in `SETTINGS_PAGES`. Recovery copy still uses 听写. |
| Summoner palette vs chat; mountains | Chat box. Mountains gone. Default is wide workspace. |
| Busy/abort/thinking; SETTINGS_REQUIRED; knowledge off | Honest, except stale settings paths in other copy. |
| Voice capsule / Hex PTT / meeting dual 收起 | Capsule OK. PTT silent swallow. Dual 收起 BLOCK. |
| 320 vs wide | Wide good. Narrow works but title identity dies. |
| Confirm Center vs accidental L2 | Phrase-gated. Summoner does not render L2. Cruise chip affordance mismatch is MAJOR not BLOCK. |
