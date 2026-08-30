# 本轮步骤：流内收起 + 贴滚动列顶（Wave 2 Glance 默认 NO-GO）

> **日期**: 2026-08-30  
> **状态**: **r2 · 待 kimi+claude dual**（r1 DRAFT → 四路对抗 1 REJECT + 1 SHRINK + 1 PWC + Trust DENY Wave2 → 下列针已折）  
> **GitHub:** [#256](https://github.com/nehcuh/cmspark/issues/256)  
> **对抗合成:** [runprogress-256-adversary-synthesis-2026-08-30.md](../../audit/reviews/runprogress-256-adversary-synthesis-2026-08-30.md)  
> **线稿:** [.impeccable/mocks/runprogress-ia-wires.html](../../../.impeccable/mocks/runprogress-ia-wires.html)（00 现状 · 01/02 = Wave 1 · 03 = Wave 2 仅当开门 · 04 = C 反例）  
> **不推翻**: ADR-020 · ADR-016 Board ≠ 本轮步骤 · 切片 6 / #227 · #237 exact `tool` · #230 自动勾仍冻 · overlay 无勾 · `ComputerTaskBar` 不回 Panel  
> **本文件不写代码。** 实现另开 plan + PR，`Closes #256` 或 Wave 拆 PR 时 `Refs #256`。dual 未过不得写 plan。

```text
Surface:      L0 RunProgress display in ChatView scroller only
L2-classes:   none; Confirm / 急停 never buried
Compose:      existing thread.run_progress ; H1 open_todos seed-only ; no new writer
Autonomy:     n/a
Trust:        ticks = exact item.tool or Side Panel click ; overlay denied
Channel:      community
```

**Blast:** 本文件 = **T0 文档**。Wave 1 落地 = **T1**。Wave 2 = **默认 NO-GO**；开门后才是 **T2**。新 ingest / overlay 写 = **T3 另票**。L2 铬已破 08-11 的 40% 地板（既有债，**本票不修**）。

---

## r2 pins（折四路）

1. **产品句**是「压缩后留下的待办，滚消息也不丢」，不是「当轮活拆解」。禁「当前步」当执行光标。
2. **默开/默收**：`items.length ≤ 3` **默开**（常见残单）；`≥ 4` **默收**。1 条：不要两行芯片套一层，直接那一行+勾。
3. **Sticky 只贴收起头**（~44–52px）。展开：`max-height: 40%` 滚动列 + 内部 `overflow-y: auto`，**或**展开时取消 sticky。禁止 8×120 实心贴死整列。
4. **收起状态** = 组件实例 `useState` + `key={threadId}`。换线程/重挂 → 回到该线程的默开/默收。禁 module `Map`、agentStore、sessionStorage、thread 字段。
5. **`n/m`**：`n` = `done===true` 且 `source` 为 seed\|user；`m` = 可勾条数（seed\|user）。草稿不计 m，旁注「草稿」。这是计数，不是完成度。
6. **未勾第一条**（第一条 `done!==true` 且非草稿）只做收起第二行预览。禁 `aria-current="step"`（步骤轨方言）。用户反勾更早一行 → 预览跟着数组走，spec 承认这是清单序不是执行序。
7. **Compact 横幅 / 查看摘要**可滚走。不和清单抢 sticky。`sticky top` 相对滚动列内容盒（含 `container` padding 14px，不要假装贴齐 popout 缝）。
8. **Wave 2 默认 NO-GO。** 开门（全要）：Wave 1 已合；机核 fixture 证明「pin-bottom + compact + ≥3 条消息时，收起头不在滚动列视口」；live 密度账（StatusRail **48** / Scene **36** / popoutBar **36** / FB 80 / busy+worker 28）附在 PR；Glance 用 FocusBand **已有** 24px secondary，不新开带。过不了 → 本票只收 Wave 1。
9. **若 Wave 2 开门**：Glance **xor** 流内收起头（不同时画 `n/m · 预览`）；让位表必须含 `coding_session` / `fleet` / `thread_tools` 主槽（那些态 **不**占 Glance）；L0 idle **不**为残待办点亮 FocusBand；点 Glance = 同文档回调展开，**禁止** `scrollIntoView`（sticky 已可见时）、禁止 WS / store 持久 / 新 thread 字段。
10. **Overlay**：召唤器 HTML/JS 源码不得出现 `run_progress` / 「本轮步骤」勾选绘制，即使 SSE `thread.updated` 带着该字段。toggle 仍不在 `SUMMONER_ALLOW`。
11. **测试**：源码锁 + **纯函数**（默开/默收、`n/m`、未勾预览、草稿不计 m）+ 密度 fixture 钉 live 常数。Companion `run-progress.ts` **零 diff**。
12. **DESIGN.md** 改 **copy 合同表**（不只 Side Panel 一句）：默开≤3 / 默收≥4；sticky 收起头在滚动列；`n/m` ≠ 完成度；仍禁「进行中」；不进 overlay / StatusRail / FocusBand（除非 Wave 2 开门）。

---

## 0. 产品句

压缩之后留下的待办，在侧栏滚消息时也不要丢。条数少就摊开勾；条数多就收成一行预览，点开再勾。它不是任务板，不是确认台步骤轨，也不是当轮活计划。

H1 没留下 `open_todos` 就没有这张卡。多数行仍只能手点（`#230`）。本票不修自动勾、不改种子。

---

## 1. 选定的路

用户线稿选 **2 = 先 A 后 B**。r2 把 B 收成默认 NO-GO，避免把 FocusBand 做成第二份芯片。

| | 路 | 结论 |
|--|----|------|
| **A 采用 · Wave 1** | 流内收起 + 收起头 sticky | 顶栏不动。T1 |
| **B 默认 NO-GO · Wave 2** | FocusBand 24px Glance | 仅当 pin 8 的机核 fixture 证明 Wave 1 失败。T2 |
| **C 否** | StatusRail 下拉 | 五路 REJECT。线稿 04 反例 |

---

## 2. Wave 1（必须先做）

### 2.1 挂载

- 仍只挂 `ChatView` 滚动列（`styles.container` `overflowY: auto`），compact / 「查看摘要」之后、消息之前。
- 卡必须是 **scroller 的 sticky 子级**（不要挂在另有 overflow 的 `contentInner` 上若那会打断 sticky；以 sticky 生效为准）。
- **禁止**改 `App.tsx` 铬栈。
- 空：`items.length === 0` → 不挂。
- Overlay 不画、不转发 toggle。

### 2.2 收起 / 展开

- 默认：`≤ 3` 开；`≥ 4` 收。`key={activeThreadId}`。流式 **不**自动展开。
- 标题行 `button`：`aria-expanded`、`aria-controls`（稳定 `id`）。Enter / Space。Chevron 收 `▾` / 开 `▴`。
- **收起**：`本轮步骤` · `n/m` · chevron；第二行 = 未勾第一条 ellipsis。不出 checkbox。
- **展开**：勾选列表。草稿无控件，旁「草稿」。内部滚动若触达 max-height。
- `prefers-reduced-motion: reduce`：无高度动画、无 chevron 旋转（源码锁该媒体查询字符串）。

### 2.3 贴滚动列顶

- **仅收起头** `position: sticky; top: 0`（相对滚动列，不是视口）。实心底 `tokens.bgMuted`。贴顶加 `tokens.border` 底部分割。
- `z-index` 只压过同列消息。读历史（未 pin-bottom）时展开不得用整卡盖住正在读的气泡 → 这就是 max-height / 取消 sticky 的原因。
- `scroll-padding-top` on 滚动列 = 收起头高度，避免锚点藏到卡下。
- Wave 1 **禁止**新 `scrollIntoView`。
- Compact / 摘要 **不** sticky。

### 2.4 预览与计数

- 未勾第一条 = 第一条 `done !== true` 且 `source !== "model_draft"`。全勾完或只剩草稿：第二行 `草稿 · {首条}` 或只留 `n/n`，不留假执行条。
- `n/m` 见 pin 5。禁止 `%` / 进度条 / LIVE / 「进行中」。
- 展开高亮未勾第一条：字重 + 2px `tokens.accent` 左条（附加，不能只靠颜色）。**不用** `aria-current="step"`。

### 2.5 协议冻结

- SoT `thread.run_progress`。种子 H1 `open_todos`。后一轮 H1 不覆盖已有清单。
- Cap 8×120。`applyToolResult` exact `item.tool` + success；永不草稿；永不 `text.includes`。
- Toggle = Side Panel `thread.run_progress.toggle`。不进 `SUMMONER_ALLOW` / web dispatch。
- 不创建 user 行、不 ingest `model_draft`、不树形。
- **禁** thread 字段 `collapsed` / `current_item_id` / `glance_text`。Glance/预览只从现有 `items` 客户端推导。
- Companion 协议文件本票不应出现在 diff。`types.ts` 线程形状本票不增字段。

### 2.6 测试锁（Wave 1）

`chrome-extension/tests/run-progress-ui.test.ts` 源码锁 + 纯函数（可同文件或 `run-progress-view.ts`）：

- `本轮步骤`；`!/进行中/`；不 import `BoardPanel`；`App.tsx` 无 RunProgress。
- `defaultExpanded(n)`：n=0 不挂；1–3 true；4–8 false。
- `countNM(items)`：草稿不计 m；`done` 草稿不进 n。
- `previewText(items)`：未勾第一条；全勾无草稿 → 无预览句。
- 源码含 `position: "sticky"` 或 `position: 'sticky'`、`aria-expanded`、`key={` + threadId、`prefers-reduced-motion`。
- 密度 fixture：48 / 36 / 28 / 80 / 24 / popout 36 写成常量断言，防止再抄 44/28。
- Companion `run-progress.test.ts` 零改预期。
- 召唤器：`summoner-web` / overlay HTML **不得** match `本轮步骤` 勾选 UI（允许注释提及禁止）。

### 2.7 DESIGN.md（Wave 1 PR 同改）

Copy 合同表补：本轮步骤 = 聊天列 L0；≤3 摊开 / ≥4 默收；sticky **收起头**在滚动列；`n/m` 可勾计数；禁「进行中」；不进 StatusRail / overlay。FocusBand 语法本票 Wave 1 **不改**。

---

## 3. Wave 2（默认 NO-GO）

未满足 pin 8 → **不准改** `focus-band-priority.ts` / `FocusBand.tsx`。

若开门，才适用：

### 3.1 Glance

- 11px：`本轮步骤` · `n/m` · 未勾预览 ellipsis · chevron。禁「正在/进行中/当前步」。
- **xor** 流内收起头：Glance 在时流内卡只保留展开态或隐藏收起头，禁止两行同文案。
- 点 Glance = 同文档展开回调。禁止 `scrollIntoView`、禁止 WS、禁止 store 持久。
- 无 items / 全完成无草稿 → 不占槽。L0 idle **不**点亮 FocusBand。

### 3.2 让位（硬）

Confirm > 急停 secondary > `l2_safety` / `coding_session` / `fleet` / `thread_tools` 主槽 → **Glance 不出现**。仅当 primary 为 `l1_context` 或（Wave 2 开门后的）空闲且 **非** L0 leftover 点亮。急停永不被埋。

### 3.3 测试锁

`focus-band-priority.test.ts` 上表。Glance `!/进行中/`。FocusBand 不渲染全列表。密度重审附 PR。

---

## 4. NEVER

- StatusRail 任务抽屉 / 线稿 04
- 复活 Panel `ComputerTaskBar`
- 每轮模型改写计划、树形、用户从铬加步骤
- overlay 勾选 / toggle 进 `SUMMONER_ALLOW` / 召唤器画清单
- 收起写入 thread / Map / sessionStorage
- 「进行中」「任务清单」`%` / L0 LIVE / `aria-current="step"`
- 宣称 `#230` 已闭合
- Wave 2 未开门就改 FocusBand
- 用本票修 L2 40% 既有铬债
- 扩 outbound profile、overlay Allow/Deny、第二扩展

---

## 5. PR 切

| PR | 范围 | Blast |
|----|------|-------|
| **Wave 1** | `RunProgress.tsx` + ChatView `key`/sticky 包 + 纯函数 + DESIGN.md copy 表 + 扩展测 | T1 |
| **Wave 2** | 仅 pin 8 全绿后：FocusBand 一行 xor 流内头 + 测 + 密度重审 | T2 |

Companion 协议文件若出现在 diff = 范围漂了，停。

---

## 6. 自检

- r2 pins 无 TBD。Wave 2 NO-GO 路径写明。
- 默开≤3 / sticky 收起头 / n/m 不含草稿 / 禁步骤轨方言 / overlay 源码锁。
- 顶栏手风琴仍否决。
- 密度用 live 48/36/28/80/popout36。
