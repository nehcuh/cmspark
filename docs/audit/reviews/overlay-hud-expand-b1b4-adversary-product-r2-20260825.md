# Adversary review r2 (Product / UX) — Overlay HUD Expand B1–B4

**Batch**: `overlay-hud-expand-b1b4` (incremental after named REJECT fold)  
**Role**: independent Product / UX skeptic (did **not** implement; no production edits)  
**Prior**: `docs/audit/reviews/overlay-hud-expand-b1b4-adversary-product-20260825.md` → **REJECT**  
**Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`  
**Mockup**: `docs/design/overlay-hud-expand-mockup.html`  
**Dual prompt**: `docs/audit/reviews/overlay-hud-expand-b1b4-dual-review-prompt-20260825.md`  
**HEAD**: `2dee37ac` + dirty worktree (`companion/src/summoner-web.ts`, `menu-bar-agent.ts`, `SummonerOverlay.swift`)  
**Owner fold claim**:

1. C-thin HTML now has `data-sec` tabs 对话/场景/知识/技能/MCP and fetches `/api/packs` `/api/mcp` `/api/skills` `/api/knowledge`
2. `knowledge.import` now passes UTF-8 `content` (not `file.content` base64)

Verify those two by reading `summoner-web.ts` HTML and `menu-bar-agent` `handleSummonerKnowledgeImport`. Then rescore the rest of r1.

```text
Surface:      L0 overlay HUD workbench (Mac NSPanel) + C-thin HTML reads/toggles
L2-classes:   none on HUD; mcp.add stdio spawn uses existing tray L2
Compose:      threads + pack.apply + mcp.toggle + skill toggle
              + knowledge USE + knowledge import HITL
Autonomy:     n/a
Trust:        overlay-safe writes; mcp.add + knowledge.import denied on summoner WS;
              no overlay Allow/Deny; NSAlert 导入/添加/取消 (no 确认)
Channel:      community
```

Inspected `[inspected]`: `companion/src/summoner-web.ts` (`SUMMONER_HTML` + compose HTTP), `companion/src/menu-bar-agent.ts` (`handleSummonerKnowledgeImport` + rail push / pack apply), `SummonerOverlay.swift` import + list, `mcp/confirm-target.ts`, `summoner/client.ts` overlay copy, `tests/summoner-web.test.ts`, `tests/summoner-workbench-compose.test.ts`. Did not run the HUD.

---

## 0. Fold scorecard (claims to falsify)

A claim is **FALSIFIED** if the fold actually removed it for a user; **HOLDS** if r1 is still true; **PARTIAL** if the mechanical grep is green and the user path is not.

| # | Claim to falsify (r1) | Result | Why |
|---|----------------------|--------|-----|
| F1 | C-thin **cannot** list/toggle 场景 / MCP / 技能 / 知识 (r1 **P0**) | **PARTIAL** | Tabs + fetches exist. MCP toggle is real. Skills are **activate-only**. Knowledge `set_active` **replaces** the whole set with one id and **cannot detach**. Copy still 去侧栏; tests still lock it. |
| F2 | Import puts overlay bytes through `file.content` base64 so UTF-8 markdown is not imported as written (r1 **P6** slice) | **FALSIFIED** for UTF-8 `.md/.txt` | `handleSummonerKnowledgeImport` sends `{ content, title }` to tray `knowledge.import`. Router `loadKnowledgePayload` takes `rest.content` as text. |
| F2b | Non-UTF-8 / untyped files become a fake document (r1 **P6** remainder) | **HOLDS** (worse for binary) | Swift still `utf8 ?? data.base64EncodedString()` into `content`. That string is now **the body**, not decoded via `file` + `parseFile`. PDF/png from NSOpenPanel → a knowledge doc of base64 characters. No `pin_thread_id`. Still overlay NSAlert, not tray CONFIGURE. |

DoD 8 first half is no longer “endpoints exist, page zero calls”. It is now “page has five tabs and four list endpoints”. That is the only r1 P0 that actually moved.

---

## 1. Fold 1 — C-thin tabs (what the user actually gets)

`[inspected]` `companion/src/summoner-web.ts:446-555,651-664,867-947`

**Mechanical claim is true.**

```html
<button class="item mini active" data-sec="threads">对话</button>
<button class="item mini" data-sec="packs">场景</button>
<button class="item mini" data-sec="knowledge">知识</button>
<button class="item mini" data-sec="skills">技能</button>
<button class="item mini" data-sec="mcp">MCP</button>
```

`showSec` → `loadCompose` hits `GET /api/packs` `/api/mcp` `/api/skills` `/api/knowledge`. Server `jsonResponse` is the dispatch result (`{ type, packs|servers|skills|docs }`), so `d.packs` / `d.servers` / `d.skills` / `d.docs` line up with `message-router`. `mcp.add` / `knowledge.import` still absent from `SUMMONER_WEB_DISPATCH_ALLOW` and from the page — DoD 8 **back half still Pass**.

**Product claim is not true.** Five `mini` buttons share a 220px `.trow` with no wrap. That is a segmented control stuffed into the old mini-sidebar, not「一类列表」. The rest of the page is still the r1 anti-copy:

| User sees | Truth |
|-----------|--------|
| 顶栏「快捷提问 · **批准在侧栏**」 | Compose lists are local; **using** MCP still 侧栏 (`:654`, SSE `:991-992`) |
| hint「听写/知识配置/**批准去侧栏处理**」 | Fold **widened** the 去侧栏 sentence (`:673`, `:761-762`). r1 was 「知识配置去侧栏」. Tests `summoner-web.test.ts:121-124` still `assert.match(..., /去侧栏处理/)` — r1 must-fix #1 said delete this and change the test. Fold did the opposite. |
| 场景行 | overlay-eligible apply works; ineligible is muted + status「这个场景不能在召唤器套用」（better than Mac「去侧栏」）. Success is `setStatus((r&&r.error)||"已套到当前对话")` — any truthy `error` wins; empty error looks like success. No「已套」row state. |
| MCP 行 `●/○ name` | **enabled**, not connected. Toggle + reload is the one honest two-way control on this page. |
| 技能行 | click always `{ on: true }` (`:923`). HTTP can deactivate (`:476-483` `on !== false`). The page never sends `on: false`. 「已切换技能」after a second click is a lie — it re-activates. No `●` / 已挂. |
| 知识行 | click `{ ids: [id] }` (`:938`). Router **replaces** `active_knowledge_ids` (`message-router.ts:2648-2657`). One click **unhooks every other doc**. Same click again cannot detach. Mac HUD toggles (`menu-bar-agent.ts:979`). C-thin is a one-slot USE, advertised as a list. |

DoD 8 wording is *can list/toggle packs/mcp/skills/knowledge.set_active*. Packs apply and MCP toggle land. Skills **toggle** does not. `knowledge.set_active` is invoked, but the user cannot clear or accumulate.

C-thin still has 发送主按钮、暗色 `#12141c` / `#3d6df2`、标题窗. Spec 豁免的是「本文件不改成 HUD」，不是豁免「去侧栏自称」or one-way toggles.

---

## 2. Fold 2 — UTF-8 `content` (happy path vs door)

`[inspected]` `menu-bar-agent.ts:996-1017` · `SummonerOverlay.swift:697-720` · `message-router.ts:366-415,2665-2683`

```ts
const resp = await companionClient.sendAppRequest("knowledge.import", {
  content,
  title: name.replace(/\.[^.]+$/, "") || name,
})
```

Comment is honest: overlay sends UTF-8 text; router `file.content` is base64; passing `content` keeps markdown as written. Tests lock `doesNotMatch(/file:\s*\{/)` (`summoner-workbench-compose.test.ts:124-126`). Tray client, not summoner WS. **UTF-8 `.md` import as body: Pass.**

What the user still hits after 「导入」:

1. **NSOpenPanel 不限类型** (`canChooseFiles = true`, no `allowedContentTypes`). `mimeTypeForAttach` already knows pdf/png/jpg.
2. **Non-UTF-8** → Swift `:719` `String(data:encoding:.utf8) ?? data.base64EncodedString()`. That base64 string is now `rest.content` **plain text**. Previously a `file` wrapper at least ran `parseFile` after decode. Binary import from overlay is now a document whose body is alphabet soup.
3. **No `pin_thread_id`**. Router will attach if asked (`:2674-2680`). Overlay never asks. 导入 ≠ 挂到当前对话. List refresh is `pushSummonerRail` (Mac only); C-thin has no import.
4. **门仍是 overlay `NSAlert` 导入/取消**, not spec §2.5 托盘 CONFIGURE. Dialect of the buttons is still clean (no 确认). The preview the user was sold (将写入哪、多大、是否挂上本对话) is still missing.

Fold 2 closes the UTF-8 corruption. It does not close P6 as a product story.

---

## 3. Findings (r2) — user sees vs truth

IDs keep r1 numbers when the defect is the same object. New fold residuals are **P12 / P13**.

| ID | Sev | Where | User sees vs truth | r1 |
|----|-----|-------|-------------------|----|
| **P0** | **closed as “no UI”** | `summoner-web.ts:658-663,881-943` | Tabs exist; four lists fetch. **Not** closed as “Win/Linux 组合面完成”. | folded, partial |
| **P12** | **P1** | `summoner-web.ts:923,938` | 技能/知识看起来能开关。技能只能开。知识点一下清掉其余、再点也卸不掉。 | **new in fold** |
| **P13** | **P1** | `summoner-web.ts:654,673,761-762` · `tests/summoner-web.test.ts:121-124` | 知识配置已经在本页，hint 仍撵人去侧栏，而且把「批准」写进去。回归测试锁死反模式。 | worsened |
| **P1** | **P0** | `mcp/confirm-target.ts:6-28` · `client.ts:359-364` · HTML SSE `:991-992` | Spec / mockup：「批准沿用**托盘**原生窗」。Overlay 起源的 MCP 工具确认仍 **改送到 Chrome 侧栏**；侧栏没开则「请打开 Chrome 侧栏」。B2 只覆盖开关。 | holds |
| **P2** | **P1** | `menu-bar-agent.ts:790` · `SummonerOverlay.swift:369,562-615,1727-1746` | 一类列表仍不可滚动（`listCol`/`threadListStack` 无 `NSScrollView`）。线程 push **8**；各轨 `prefix(12)`。第 9 个线程在 overlay 里不存在。 | holds |
| **P3** | **P1** | `SummonerOverlay.swift:539-626` | 行仍无次要信息。选中靛蓝浅底只给当前对话行。 | holds |
| **P4** | **P1** | `menu-bar-agent.ts:894-896` | 套场景成功仍 `encodeSummonerError` → 主列「系统: 已套到当前对话（技能/提示）」。仍不 `pushSummonerRail`。 | holds |
| **P5** | **P1** | `summoner/client.ts:331-332` | 运行时仍「要**去侧栏**确认 / **去侧栏**换场景」。 | holds |
| **P6** | **P1** | Swift `:697-720` · menu-bar `:996-1017` | UTF-8 正文路径修好。CONFIGURE / 类型门 / 自动 USE / 非 UTF-8 仍在。 | partial |
| **P7** | **P1** | `SummonerOverlay.swift:1319,1262-1266` | 展开后打 `#` 仍卸掉工作台。`applyPhase` 藏 `lastThreadField`，`updateLastThreadLabel` 马上又亮「继续 ·」。 | holds |
| **P8** | **P2** | Swift `:570-586,330-332` · menu-bar `:815-818` | MCP 行仍画 `enabled`。`applyMcp(connected names)` 仍空操作。 | holds |
| **P9** | **P2** | Swift `:658-681` | MCP 添加表单仍两行。 | holds |
| **P10** | **P2** | Swift `:507-524` | 切轨主列仍是对话摘录，没有一两句说明。 | holds |
| **P11** | **P2** | Swift `:1810,1792-1808` | 仍构造「完整格式在侧栏」、发送大按钮、继续 CTA。 | holds |

---

## 4. Rails (Mac HUD) — unchanged from r1

`[inspected]` `SummonerOverlay.swift:1696-1751,501-626`

**Hold (do not regress)** — same as r1: 52pt 轨、一类列表、底栏输入、看山 tokens、无 overlay Allow/Deny、NSAlert 重命名/移到回收站/添加/导入/取消。

**Still not a workbench** — r1 §2 items 1–5 all still true (裁切、无次要行、不可套仍可点、无对象句、知识 USE 无「再点取消」on the row — Mac at least *does* toggle in code).

---

## 5. NSAlert copy — dialect still holds; HITL shape still does not

Same table as r1. Overlay Swift 仍无「确认 / 允许 / 拒绝 / Allow / Deny」。不要把托盘确认台的允许/拒绝算进 HUD。

知识导入：用户点完系统文件框再点「导入」，UTF-8 会进库（fold 2）。仍然没有托盘 CONFIGURE 预览，仍然不挂当前对话，任意类型仍可进。

---

## 6. DoD as the user would score it (r2)

| # | Claim | Product r2 |
|---|--------|------------|
| 1 | 场景列表；点 overlay-eligible → apply | Mac：**能点**。成功仍画成系统错误；不可套仍可点。C-thin：能点；不可套有本页句。 |
| 2 | MCP 列表/开关；＋ 添加 → stdin → tray `mcp.add` | Mac：能开关、能出表单。列表撒谎。**用**时批准仍去侧栏（P1）。C-thin：能开关；无添加（DoD 8 后半句）。 |
| 3 | 技能列表；点 toggle 当前对话 | Mac：能点双向。C-thin：**只能开**（P12）。 |
| 4 | 知识列表；点 set_active；＋ 导入 NSOpenPanel + NSAlert → tray import | Mac：能 toggle；导入 UTF-8 正文对。无 CONFIGURE；不自动 USE。C-thin：能 set_active，语义是「只留这一个」；无导入。 |
| 5 | set_active 剥多余 key | 用户不可见。不评分。 |
| 6 | 无 HUD Allow/Deny / `summoner.confirm.*` | **Pass**（方言）。MCP **用**时仍把人送侧栏。 |
| 7 | Pin lockstep | 不在本角色。 |
| 8 | C-thin 能 list/toggle；不能 add/import | **Partial / Pass**. 能 list。MCP 能 toggle。技能不能关。知识不能卸。不能 add/import。 |

Product equivalent gates:

- **PR1** 用户完成组合面必须打开 Side Panel → **still triggered** (Mac MCP 工具确认 + C-thin/Mac「去侧栏」句 + 听写). List/toggle of packs/mcp **no longer** requires the panel. That is the fold. **Using** MCP still does.
- **PR2** HUD 出现 Allow/Deny 方言 → not triggered
- **PR3** 展开仍是 200pt 标签堆 / 发送大按钮 / 去侧栏自称 → **still triggered on C-thin** (titled dark 220px + 发送 + 去侧栏 locked in tests). Mac skeleton still not.

---

## 7. Must-fix vs next knife (r2)

r1 must-fix #1 (C-thin 真实列表) is **half-done**. The rest of r1 must-fix is untouched. Fold residuals join the gate.

**Must-fix before calling B1–B4 落地**

1. **C-thin 技能/知识要双向**：技能点第二次 deactivate；知识与 Mac 一样 toggle ids（有则剥、无则加）。行上画出已挂/已开。不要 `{ on:true }` / `{ ids:[id] }` 当「开关」。
2. **删掉并改测试**「去侧栏 / 批准在侧栏 / 知识配置去侧栏」。MCP 待批改为「看托盘确认窗」。侧栏未开不要叫人去开扩展。fold 把批准写进 hint 是在教反模式。
3. **MCP 确认目标**：overlay 起源走 **托盘** 确认台（spec 原文），或诚实写「开关在这，批工具仍要 Chrome」。现在仍是第三种。
4. **Mac 列表**：`NSScrollView`；线程不要静默 8 条；次要行用已有 `when` / 已挂 / 未启用 / 不可套原因。选中浅底。
5. **运行时 copy**：`client.ts` 去掉「去侧栏」。
6. **成功不是错误**：pack apply 不要 `encodeSummonerError`；apply 后 `pushSummonerRail`。
7. **展开 + `#`**：搜索过滤左列，不要拆工作台。藏死「继续 ·」在 expand 态。
8. **导入**：NSOpenPanel 限文本；非 UTF-8 拒绝并说「只要文本」——不要把 base64 当正文；可选 `pin_thread_id`。

**Next knife（不挡方言，挡「工作台」自称）** — r1 list still applies (主列说明、MCP connected、CONFIGURE 名分、轨浅底、死控件、空字段 Alert)。

---

## 8. What already matches (keep)

Same as r1, plus the two fold mechanics:

- 同一扇窗变高；图标轨 + 一类列表 + 底栏输入（Mac）。
- NSAlert 重命名 / 移到回收站 / 添加 / 导入 / 取消。
- Overlay 无 Allow/Deny、无 `getUserMedia`、无 HTML 麦。
- `mcp.add` / `knowledge.import` 不走 summoner WS。
- C-thin **现在真的请求**四条 compose GET，并有 MCP POST toggle / pack apply / skill activate / knowledge set_active。
- UTF-8 知识正文走 `content`，不再经 `file.content` base64。

These two are why r1 P0 “页面零调用” is dead. They are not why B1–B4 is a workbench.

---

## VERDICT: REJECT

Fold 1 puts five tabs and four fetches on C-thin — r1’s “组合面 UI 不存在” is gone. Fold 2 lets UTF-8 markdown import as written. Neither closes the product gate.

C-thin still *teaches* Side Panel (hint + tests + 批准在侧栏), still paints the rejected titled dark mini-sidebar, and the new skill/knowledge clicks are one-way. Mac HUD is the same clipped rail as r1: silent 8/12 cut, success-as-error, `#` rips the workbench off, and overlay-origin MCP **use** still ships Allow/Deny to Chrome. 「对话 / 场景 / MCP / 技能 / 知识，全部不经 Side Panel」 still does not close on either end.
