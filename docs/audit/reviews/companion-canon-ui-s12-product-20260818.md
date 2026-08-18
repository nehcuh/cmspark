# Companion-canon Side Panel UI S1+S2 — Product adversary

**Family**: PRODUCT (JTBD / empty copy / 装配 vs 确认 / C″ D″ honesty)  
**Batch**: `companion-canon-ui-s12`  
**Date**: 2026-08-18  
**Reviewer**: independent Product adversary — not the implementer  
**Tree**: working tree under `/Users/huchen/Projects/cmspark`  
**Evidence**: `[inspected]` code + DESIGN + PRODUCT.md · `[assumed]` prompt machine 714 / tsc 0 (this session did not re-run tests)

```text
Surface:      L0 Panel chrome（空态 / 顶栏 / 输入 / FocusBand）
L2-classes:   none new
Compose:      装配 entry chrome only
Autonomy:     Board stays /board only
Trust:        settings 可发现；急停不得埋
Channel:      unchanged
```

**Blast**: T2

---

## 1. C″ / D″ — do they actually hold?

### C″ One rail empty **and** in work — **HOLDS** `[inspected]`

Same StatusRail in empty and in work:

| Claim | Where |
|--------|--------|
| 设置 | Gear `StatusRail.tsx:200-213` + ⋯「设置」`:422-436` + ThreadList drawer「设置」`:1283-1296` |
| 新对话 | `IconNewChat` `:227-235` (`title`/`aria-label`「新增对话」) |
| 历史 | ThreadList trigger `ThreadList.tsx:1223-1235` `title`/`aria-label`「历史对话」 |
| Mode whisper | `ModeBadge whisper` `StatusRail.tsx:220-226` · icon-only 28px `ModeBadge.tsx:17, 56-57, 84` · title still names 层级 |
| Connection whisper | Connected: `role="status"` dot `StatusRail.tsx:253-267` · Disconnected: button `:269-289` |
| No `hasMessages` costume dump of the **whole rail** | `hasMessages` is computed `:60` and **only** greys three ⋯ items (提取技能 / 导出 / 摘要 `:318-382`). Brand hide is cruise/断连 `:214-218`, not message count. ComposerChips hide on empty stream (`App.tsx:1659-1660`) is capsule density, not a second rail. |

R2 leftover「L0 第一行总结当前打开的页面」is **gone** from L0 (`empty-state-copy.ts:33-40`). Empty L1 no longer hangs the webpage strip (`focus-band-priority.ts:45-50, 78, 124-137` + `FocusBand.tsx:111, 114`).

### D″ Agent-honest empty — **HOLDS** `[inspected]`

| Cut | Evidence |
|-----|----------|
| L0 must **not** say operate-the-tab | L0 title「要我帮你做什么？」hint「问问题、写文案，或描述任务。」rows 起草 + 装配 gloss — `empty-state-copy.ts:33-40`. Blob test forbids `当前打开的页面` / `操作当前标签` / `随便聊` — `empty-state-copy.test.ts:7-17`. |
| L1 **is** page task | Title「要对这页做什么？」hint「总结、提问，或让我操作当前标签。」fills 总结当前打开的页面 / 提取这页里我能执行的操作 — `empty-state-copy.ts:22-31`. |
| No「随便聊」 | String absent from empty copy + `App.tsx` + `DESIGN.md` `[inspected]` (only lives in tests as a forbid). |
| 装配 has human gloss | Empty invite「打开装配（技能、场景、知识）」`empty-state-copy.ts:18, 29, 38`. Capsule `title="装配 — 技能、场景、知识"` `App.tsx:1678`. Drawer subtitle「组合能力」`ComposeDrawer.tsx:91-94`. |
| L0 ≠ 看山闲聊 | Greeting is a **job** question, not 畅所欲问 / 接下来想做什么. Placeholder L0「描述任务，或粘贴截图…」`meta-slash.ts:333-334`. THESIS + DESIGN match shipped L0 (`App.tsx:1-4`, `DESIGN.md:149`). |

L2 empty points at 确认台 first, 装配 second (`empty-state-copy.ts:12-20`) — 装配 vs 确认 is not collapsed.

### 急停 / Trust / character

- **急停 not buried.** FocusBand sits **above** ChatView (`App.tsx:230-236`). Empty L1 → `primary: "empty"` → FocusBand returns `null` (`FocusBand.tsx:114`) — greeting cannot cover abort. Confirm still wins; `l2AbortRequired` still forces `secondaryAbort` (`focus-band-priority.ts:79-88`, test `focus-band-priority.test.ts:78-105`). L2 primary renders `SafetyStrip` (`FocusBand.tsx:147-149`).
- **`createBlankThread` not poison.** `config_override: {}` `ThreadList.tsx:52-61`. Same empty override on auto-create + quickAction (`useWebSocket.ts:1013, 1052`). Comment: do not stamp DeepSeek / empty trust.
- **Chinese chrome.** Rail / empty / legal / 急停 / 确认台 / 装配 are 中文. Board stays Autonomy (`ComposeDrawer.tsx:70-73, 122-124`; rail note `StatusRail.tsx:449-456`).
- **Original mark, not 看山 fox.** Filled `#171717` stamp + indigo spark `icons.tsx:196-216`. Not outline cat.

---

## 2. S1+S2 DoD (verify or bust)

| ID | Claim | Verdict | Where `[inspected]` |
|----|--------|---------|---------------------|
| S1.1 | Empty L1 does **not** hang FocusBand webpage strip; confirm / 急停 still win | **PASS** | `focus-band-priority.ts:45-50, 78, 82, 124-137` · wired `FocusBand.tsx:111` · test `focus-band-priority.test.ts:78-105` |
| S1.2 | Empty capsule = 装配 + field + send; attach/听写 after first char | **PASS** | 装配 always in capsule `App.tsx:1673-1682` · attach gated `:1683-1698` · 听写 gated `:1720-1738` · send `:1755-1777` · chips hidden on empty `:1659-1660` · test `companion-canon-s12.test.ts:8-14` |
| S1.3 | ⋯「设置」and thread-drawer 设置 match gear (disconnected → connection) | **PASS** | Gear `StatusRail.tsx:205-209` · ⋯ `428-431` · drawer `ThreadList.tsx:1289-1291` — all `connection` / `model` |
| S1.4 | ComposeDrawer has no ⋯「编排」; Board = `/board` | **PASS** | No 编排 menu item in drawer. Footnote「任务板不在装配内 — 使用 /board」`ComposeDrawer.tsx:122-124`. `handleSection` rejects `board` `:70-73`. `COMPOSE_SECTIONS` has no board (`meta-slash.ts:198-247`). WorkerScopeBar「返回编排」is Autonomy worker chrome (`WorkerScopeBar.tsx:62-64`), **not** 装配 ⋯. |
| S2.1 | `createBlankThread` `config_override: {}`; EmptyState consumes `emptyStateCopy` | **PASS** | `ThreadList.tsx:61` · `ChatView.tsx:1550-1556` · tests `empty-state-copy.test.ts:32-41` |
| S2.2 | DESIGN.md / App THESIS no「畅所欲问」 | **PASS** | `App.tsx:1-4` FIRST VIEWPORT =「要我帮你做什么？」· `DESIGN.md:149` placeholder = 描述任务 / 问这页 |
| S2.3 | Dead rail styles + `IconPlus` gone | **PASS** | No `IconPlus` export (`icons.tsx`; test `companion-canon-s12.test.ts:38`). StatusRail has no `brandMark` / `threadIdBadge` / `spacer` / `iconBtn` orphans. |
| S2.4 | Legal `tokens.textMuted` ≥11px | **PASS** | `App.tsx:2180-2185` `fontSize: 11` + `tokens.textMuted` · rendered `:1953-1955` |
| S2.5 | Connected conn is `role="status"`; disconnected is a button | **PASS** | `StatusRail.tsx:253-289` |
| S2.6 | InvitationRows hover + focus-visible | **PASS** | `ChatView.tsx:1490-1498, 1510` |
| S2.7 | Send is circular up-arrow | **PASS** | `IconSend` `M12 19V6` `icons.tsx:218-224` · `sendBtn` 32×32 `radiusPill` (999) `App.tsx:2152-2165` · `tokens.ts:84` |
| S2.8 | CompanionMark filled stamp, not outline cat, not 看山 fox | **PASS** | `icons.tsx:196-216` filled ellipse/circle/ears + `#4f46e5` spark |
| Cruise | Rail chip 值守/巡航; full label on title/aria; click still 解除 | **PASS** | Short `trustStatusChipShort` `autopilot-tier.ts:89-96` · full `trustStatusChip` on `title`/`aria-label` `StatusRail.tsx:175-176, 238-251` · `onClick={disarmCruise}` `:243` |

No claimed S1/S2 item is missing from code. No new L2 tools in this chrome.

---

## 3. Findings (file:line)

No P0. No P1 that falsifies C″/D″, buries 急停, or poisons Trust.

### P2-1 — L0 empty does not teach the product’s primary job

`empty-state-copy.ts:33-40` · `ModeBadge.tsx:17, 84`

After the R2 cut, L0 is honest **and** thin: one fill「帮我起草一段说明」+ 装配. PRODUCT.md one-sentence job is a **local browser agent** (Talk & act on pages). D″ forbids claiming tab-operate at L0 — that cut is met. Residual JTBD: a first-time user who lands in 聊 never sees that 网页 unlocks page work. Mode is a 28px whisper icon; title-on-hover is the only gloss. Do **not** put「总结当前打开的页面」back on L0. If we teach L1, do it as a mode hint (「切到网页，才能操作标签」), not an operate-the-tab invite.

Does **not** falsify D″.

### P2-2 — 听写 is undiscoverable on a truly empty capsule

`App.tsx:1720-1738`

S1.2 is implemented as specified: mic stays hidden until `text.trim()` (or live overlay / already-listening). Speak-first users cannot start 听写 without typing a character first. PRODUCT.md first viewport is type-to-start, so this is spec-compliant friction, not a DoD miss. Next slice: empty-capsule 听写 in ⋯ or a single overflow, without bringing attach back onto the quiet capsule.

### P2-3 — Invitation rows read as static sentences until hover

`ChatView.tsx:1490-1511, 1700-1715`

Hover/focus-visible exist (S2.6). Affordances are weak: `tokens.text`, 14px, weight 400, no underline, no chevron. Canon wanted sentence rows — fine. First tap target still looks like body copy. Cheap fix: keep sentences, add a persistent muted affordance (trailing › or underline-on-idle at 0.4).

### P2-4 — 装配 drawer still speaks Surface-axis jargon

`meta-slash.ts:265-267` · `ComposeDrawer.tsx:91-94, 107-109`

Empty chrome glosses 装配 as「技能、场景、知识」. Inside the sheet, every row repeats「挂到当前线程 · Surface L0 聊」and a chip「Surface L0 聊」. 装配 vs 确认 is **structurally** honest (Board excluded; footnote `/board`). The attach line is Composition-correct and human-hostile. Group label「连接与任务」(`meta-slash.ts:194`) also leans on「任务」, which is the 确认台/Board word. Prefer「挂到本对话 · 网页」and rename the group to「连接」.

### P2-5 — L2 empty assumes there is already something to 跟进

`empty-state-copy.ts:14-16`

「从这里跟进，确认在确认台」is honest about **where** confirm lives (装配 ≠ 确认). On a freshly switched empty L2 thread with no CU task,「跟进」implies a running job. Hint「此处可排队跟进」softens it. Not a D″ break. Tighter:「确认在确认台。这里只排队跟进。」

### P2-6 — Same craft glyph for 装配 and 提取技能

`App.tsx:1673-1681` (`IconCraft` + aria「装配」) · `StatusRail.tsx:328-329` (`IconCraft` +「提取技能」)

Empty invite uses `IconList` for 装配 (`ChatView.tsx:1545`). Capsule uses craft. ⋯ uses craft for a **different** job. Mild 装配 vs 技能-craft collision. Swap capsule to `IconList` / a compose mark.

### P2-7 — Trust legal line is treated as decorative meta

`App.tsx:1953-1955, 2180-2185`

S2.4 asked for `tokens.textMuted` ≥11px and got it. Product reading:「确认后才会执行危险操作」is Trust copy, not a timestamp. DESIGN contrast policy reserves `textMuted` for non-essential meta (`DESIGN.md:39`). Not 急停-buried, not a REJECT. If legal stays, `textSecondary` is the honest token.

None of P2-1…P2-7 restore 随便聊, re-poison `config_override`, or hang L1 strip over 急停.

---

## 4. Trajectory

Claimed scope = Side Panel chrome + tests + DESIGN. Working tree matches that:

- Empty copy extracted to `empty-state-copy.ts` (S0 leftover + S2.1)
- FocusBand `hasThreadMessages` (S1.1)
- Capsule quiet / settings route / Board `/board` (S1.2–S1.4)
- THESIS + DESIGN strings aligned (S2.2)
- Dead `IconPlus` / rail orphans gone (S2.3)
- Legal / conn role / invite hover / circular send / filled mark (S2.4–S2.8)
- Cruise short chip (Cruise)

`useWebSocket.ts` `config_override: {}` is the same Trust contract as `createBlankThread`, not a drive-by feature. `WorkerScopeBar`「返回编排」is pre-existing Autonomy breadcrumb, not a new 装配→Board leak.

No new L2 tools. Cockpit night world not in this slice (correct).

---

## 5. Cuts (re-state)

| Lock | Holds? |
|------|--------|
| **C″** one rail empty and in work | **YES** |
| **D″** agent-honest empty (L0 ≠ tab-operate; L1 = page task; no 随便聊; 装配 glossed) | **YES** |
| 急停 / 确认 never buried | **YES** |
| `createBlankThread` not Trust-poison | **YES** |
| Chinese chrome; original mark; no new L2 | **YES** |
| Every claimed S1/S2 item in code | **YES** |

REJECT gates are not tripped. Residual findings are JTBD polish, not cut failures. I will not APPROVE clean: P2-1 (L0 does not teach the agent job) and P2-2 (听写 chicken-egg) are real first-viewport friction.

VERDICT: APPROVE_WITH_NITS
