# Adversary review (Product / UX) — Overlay HUD Expand B0.5 thread manage

**Batch**: `overlay-hud-expand-b05`  
**Role**: independent Product/UX skeptic (did **not** implement)  
**Lane**: user said continue standard process **and** support conversation management independently of the Chrome extension  
**Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md` §2 item 1 / 实现波次 B0.5  
**Hi-fi**: `docs/design/overlay-hud-expand-hifi.html`  
**Evidence**: `[inspected]` overlay/ACL/web/menu-bar source. `[executed]` `summoner-thread-manage` + overlay + summoner-web: **75 pass / 0 fail**. No live AppKit click-through this session.  
**Blast**: T2 L0 Surface (thread rename + trash). Not T3.

```text
Surface:      L0 overlay HUD workbench thread management (Mac NSPanel + C-thin HTML)
L2-classes:   (none)
Compose:      thread rename + trash; Companion-owned; no Chrome Side Panel required
Autonomy:     n/a
Trust:        confirm stays native NSAlert / HTML confirm(); no overlay Allow/Deny
Channel:      community
```

---

## Claim under test

“A user can rename and trash conversations from the Mac HUD and from C-thin HTML without opening Chrome Side Panel; trashing the current thread lands on the most recent remaining (else a new one); overlay stays collapse-HUD + expand-workbench with composer at the bottom.”

**Mostly true.** Both surfaces expose rename + trash as first-class Companion actions. The Chrome-independence DoD holds. Recency handover is correct on Mac and **lazy on HTML**. Copy still points at 侧栏 for *other* jobs, not for this one.

---

## Must-answer questions

### 1. Can the user rename / trash from Mac HUD without Side Panel?

**Yes.** `[inspected]`

- Row affordance: `SummonerOverlay.swift:355-399` — title button + `⋯` (`toolTip`「对话管理」).
- Right-click: `:450-457` left-click selects, `rightMouseDown` opens the same menu.
- Menu: `:406-418` 「重命名」「移到回收站」. Not Allow/Deny.
- Rename: `:420-436` `NSAlert` + accessory field → `summoner.thread.rename`. Empty alias is a silent no-op.
- Trash: `:438-448` `NSAlert` 「移到回收站」/「取消」 → `summoner.thread.trash`. No `mode:"hard"`.
- Agent: `menu-bar-agent.ts:1172-1228` maps those stdin events to `thread.update { alias }` and `thread.delete { mode:"trash" }`, then `pushSummonerRail()`. Failures go back as overlay errors (`无法重命名` / `无法移到回收站` / busy).
- Protocol: `protocol.ts:510-516` — no `summoner.thread.delete` inbound; trash-only event.

User path: expand ⌄ → 对话 list → ⋯ or right-click → native sheet → Companion. Chrome is not in the loop.

### 2. Same on C-thin HTML (Win/Linux)?

**Yes, as a workbench page, not a HUD.** Spec explicitly does not restyle HTML into HUD this slice. `[inspected]` `[executed]` PATCH/DELETE tests.

- Page buttons: `summoner-web.ts:650-677` per-row 「重命名」(`window.prompt`) and 「移到回收站」(`window.confirm`).
- Server: `:418-437` PATCH → `thread.update` alias-only; DELETE **always** `{ mode: "trash" }`. `[executed]` `DELETE /api/thread always trashes and ignores hard`.
- Policy: `:161-169` `applySummonerPayloadPolicy("summoner", …)` on the same loopback dispatch.

User on Win/Linux can manage threads in the summoner window. They do **not** need the extension for this job.

### 3. Trash current → most recent remaining, else new?

**Mac: yes. HTML: “first remaining in index”, not activity-recency.**

- Mac: `menu-bar-agent.ts:1222-1228` — if `summonerThreadId === threadId`, `listThreads()` then `hitsFromTitleSearch(remaining)[0]` else `handleSummonerNewThread()`. `client.ts:50-81` sorts `updated_at || created_at` descending. Select hydrates transcript (`:933-937`). `[inspected]`
- `thread.list` defaults `include_trashed: false` (`message-router.ts:1853-1869`), so the just-trashed row cannot be the handover target.
- HTML: `summoner-web.ts:668-675` — `refresh()` then `threads[0]` or `$("newThread").click()`. `threadManager.list` is **index order** (`thread-manager.ts:656-660`); create `unshift`s (`:570`) but **does not re-sort on update**. Daily-used old thread loses to a newer empty stub.

Empty list → new thread: both paths. DoD item 6 is **fully true on Mac, half-true on C-thin**.

### 4. Copy: 去侧栏 for *this* feature? 确认/允许/拒绝 in overlay source?

**This feature is not labeled 去侧栏. Forbidden dialect is absent from HUD source.**

- Swift overlay: no `去侧栏` / `确认` / `允许` / `拒绝` / `Allow` / `Deny`. Tests lock it (`summoner-overlay.test.ts:110-114`, `summoner-thread-manage.test.ts:141-148`). Alert verbs are 「重命名」「移到回收站」「取消」. `[executed]`
- Dead leftover: `SummonerOverlay.swift:1597` 「完整格式在侧栏」 — `applyPhase` overwrites/hides `sideNote` when expanded (`:1120-1125`). Not user-visible on the manage surface.
- C-thin **does** still say 去侧栏 — for 听写 / 知识配置 / 批准, not rename/trash (`summoner-web.ts:599, :610, :698-699, :844-846`). Tests **require** that hint (`summoner-web.test.ts:121-124`). Adjacent copy, not this feature.

### 5. Still a collapse HUD + expand workbench, composer at bottom? Not B1/B2/knowledge admin?

**Yes.** `[inspected]`

- `applyPhase` `:1106-1134`: workbench hidden unless expanded; composer field stays in the bar; send/foot/cta stay hidden.
- Layout: workbench stacked **above** `fieldBox` (`:1295-1443`). Chevron ⌄/⌃ on the field (`:1385-1403`). `canBecomeKey` still true.
- Rail empty panes: `:482-496` 「这一类下一刀开放」. `applyPacks` is a no-op (`:506-508`). No `makeRail`. No knowledge UI. No overlay confirm dialect.
- ACL did not grow `knowledge.*` / `mcp.add` / `thread.restore` / `thread.batch_delete` (`summoner-acl.ts:14-39`). `[executed]`

### 6. Outcome DoD — would a user without Chrome still be stuck?

**No.** Idle conversations can be renamed and moved to trash from HUD / C-thin. That is the product REJECT bar (prompt R5). They would still complain about: HTML landing on the wrong “recent” thread; Mac only offering ⋯ on the 8 most-recent rows; C-thin chrome that still yells 去侧栏 for everything *around* this job.

---

## Findings

### BLOCK

None for B0.5 product. Chrome is no longer required to rename or trash.

### NIT

1. **HTML handover is create-index, not recency.** `summoner-web.ts:668-675` vs Mac `menu-bar-agent.ts:1226` + `client.ts:50-81`. Same DoD sentence, two behaviors. Win/Linux user who trashes the current chat may land on a newer empty stub instead of the thread they actually used. Fix: reuse `hitsFromTitleSearch` / `sortRecentFirst` (or sort `thread.list` once).

2. **C-thin still markets 侧栏 as the place work happens.** `summoner-web.ts:599` badge「批准在侧栏」; `:610/:698-699`「听写/知识配置/批准去侧栏处理」; `:844-846`「MCP 工具需在 Chrome 侧栏批准」. Not a lie for *this* slice (dictation / knowledge / confirm are not B0.5), but it trains the user that Companion-owned composition still lives in Chrome. B0.5 buttons sit 200px away from a hint that says go to 侧栏. Tests freeze the hint. Strip or split the hint so conversation management is not visually bundled with “go to Chrome”.

3. **Mac manage surface is the 8-row rail, not “all conversations”.** `menu-bar-agent.ts:787` `slice(0, 8)`. `#` hits (`SummonerOverlay.swift:890-926`) select only — no ⋯ / no trash. An older thread found by search cannot be renamed or trashed unless it already ranks in the eight. Spec promised 列表 **and** 搜索 as the manage loop. Search does not complete it.

4. **Hi-fi does not show the manage affordance.** `overlay-hud-expand-hifi.html:292-294` rows are title + `small` only. AppKit invented `⋯` + right-click (`SummonerOverlay.swift:385-418`). Discoverable enough (tooltip 「对话管理」), but the visual contract the implementer was told to match never taught the gesture. ⋯ hit target is 28×44 (`:394-395`) against the 44px rhythm.

5. **Busy thread cannot be trashed; Mac HUD has no abort.** Router `thread_busy` (`message-router.ts:1610-1616`); overlay copy 「这条对话还在跑」 (`menu-bar-agent.ts:1207-1211`). HTML has 停止 (`summoner-web.ts:616-618, :772-775`). HUD close is explicitly **not** abort (`SummonerOverlay.swift:10, :596`). User must wait the run out (or open Chrome) to trash the live current thread. Acceptable safety; dishonest if we claim full manage parity with Side Panel.

6. **Empty alias is a silent swallow.** Swift `:434-435`; HTML prompt `:656`. No 「名字不能为空」. Cheap honesty miss.

7. **C-thin row chrome is cramped and always-on.** Two 11px mini buttons (「重命名」「移到回收站」) in a 220px dark rail (`:574-576, :650-680`) vs Mac overflow. Spec allowed 页面按钮. Title truncates. Not a blocker; it is the Win/Linux discoverability tax.

8. **Machine suite is source-lock for handover, not a journey.** `summoner-thread-manage.test.ts:120-139` greps `handleSummonerThreadTrash` / `pushSummonerRail`. It would still pass if HTML `threads[0]` pointed at the oldest row. Do not treat 131/75 green as recency-proven.

---

## Layers

- **Outcome**: User without Chrome can rename and trash from Mac HUD and from C-thin HTML. They are not sent to Side Panel for *this* job. Pass. Residual: HTML may switch to the wrong remaining thread; Mac cannot manage beyond the eight-row rail via search.
- **Trajectory**: Correct B0.5 move after B0 skeleton — put alias + trash on the overlay-owned list, keep confirm native, keep hard-delete off summoner. Did not sneak B1 pack apply / B2 MCP admin / knowledge CONFIGURE into the HUD. Leftover 去侧栏 on C-thin is inertia from the superseded “知识配置去侧栏” line, locked in by tests.
- **Component**: Swift `makeThreadRow` / `promptRename` / `promptTrash` + stdin `summoner.thread.*` + ACL payload gate is the product. HTML PATCH/DELETE is the same product on the thin path. Composer remains the bottom bar. Hi-fi lagged the ⋯. Handover helper was not shared across Mac/HTML.

VERDICT: APPROVE_WITH_NITS
