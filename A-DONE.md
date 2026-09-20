# 502 切片 A — 完成报告（Claude lane）

分支 `feat/502-a-tool-history`（worktree `/tmp/cmspark-502/a`）。未触碰主 checkout / companion / overlay。

## Commits

| hash | 内容 |
|---|---|
| `ce36c81a` | test(ext): tool history view grouping — 纯函数 `viewToolHistory`/`liveChipLabel`/`doneChipLabel` + 8 个规则测试（TDD：先红 TS2307 后绿） |
| `f4882bfd` | feat(sidepanel): collapse completed tool cards into audit chip — ChatView 接线 + `groupToolTurnRows` 分组 + 分组测试 + pr6 源码契约测试 |
| `8baa5749` | fix(sidepanel): fold hydrated assistant tool_calls — Kimi MAJOR-1 hydrate 修复（见下「hydrate 已修」） |

## hydrate 已修（2026-09-18 追加）

Kimi MAJOR-1 亲证：reload 后持久化 assistant 行带 OpenAI function 形 `tool_calls`（有 `function.name`、无扁平 `tool_name`），MessageRow 仍无条件 `map` 出无名卡——视口变成「无名卡 + 芯」。修复（`8baa5749`，TDD 三轮红绿）：

1. **`shouldRenderInlineToolCards(msg)`**（`tool-history-view.ts`）：role=tool → false（块已画）；function 形（任一 tc 带 `function` 信封或缺 `tool_name`）→ false；仅扁平 `tool_name` 形 → true。MessageRow 的 inline map 挂在该门后（`ChatView.tsx`）。
2. **史前形状兜底**：只有 assistant.tool_calls、无后续 role=tool 行的 hydrate 线程，`groupToolTurnRows` 把该 assistant 转成 tools 块（`function.name` 归一化为扁平 `tool_name`，ToolCallCard 可读名）；带正文时正文行保留在块前。被 role=tool 行覆盖（紧随其后）的标记行仍是普通行，不重复出块。
3. 测试：truth table 4 断言 + 分组 3 用例（未覆盖转块 / 已覆盖保持行+块 / 带正文行保留）+ pr6 源码契约（门在 map 之前）。全量 1353/1353 pass、`tsc --noEmit` 绿、plasmo build 绿，产物 chunk 含新符号 [executed]。

## 测了什么

- **单测（node:test，全量 1352/1352 pass）** [executed]
  - `tests/tool-history-view.test.ts`（11 用例）：empty / live（completed+current+failed）/ L2 pending 恒为 current 不折 / busy 末步无 result 仍 live / done 出芯 / 单步也折 / `error` 字段隐式失败计数 / copy helpers / 分组合并连续 tool 行 / assistant 文本行分块 / 无 tool_calls 的 tool 行退化为普通行。
  - `tests/message-quiet-pr6.test.ts`：原有 ToolCallCard / data-testid / RunProgress 断言全部保留通过；新增 #502 源码契约（ChatView 含 `viewToolHistory` / `groupToolTurnRows` / `展开审计` / `aria-expanded`；`tool-history` 引用仅限 sidepanel 两文件 = overlay 零改动）。pr6 有一处 regex 随接线更新（见偏差 3）。
  - `tests/running-tools.test.ts` 未动、通过（`collectRunningTools` 逐消息扫 `tool_calls`，与分组渲染兼容）。
- **构建** [executed]：`npm run build`（plasmo chrome-mv3）绿；产物 `sidepanel.b7741352.js`（17:32）含 `viewToolHistory`/`groupToolTurnRows` 及芯片文案（bundle 对非 ASCII 做 `\u` 转义，按转义形式验证）。`tsc --noEmit` 绿；hygiene gate（raw colors / tiny fonts）绿。
- **NEVER 核查** [executed]：`git diff 1d8c35d6..HEAD` 仅 4 个文件（ChatView.tsx / tool-history-view.ts / 两个测试）；`run_progress`、RunProgress.tsx、persist、companion、overlay 零改动；无 `thread.collapsed` 字段写入（折叠是组件局部 state）。

## 与计划的三处偏差（均已在实现中固化并测试）

1. **分组层从 MessageRow 移到 render loop**。计划假设一条消息携带整回合 `tool_calls`；实际 store（live `tool.start` 与 hydrate 持久化）是 **每工具一条 `role:"tool"` 行**。若按计划字面在 MessageRow 内接 `viewToolHistory`，一轮会出 N 颗芯，违反 spec §2.3「同一 assistant 回合 = 一颗芯」。实现改为 `groupToolTurnRows` 把连续 `role:"tool"` 行合成一个 `ToolHistoryBlock`（纯函数 + 测试在 `tool-history-view.ts`），芯/卡语义与计划一致，纯函数 API 未变。回合中穿插的 assistant 文本行会分块（spec：不得跨回合合并超级芯）。
2. **L2 关联用 tool_name 而非 tool_call_id**。计划的 `pendingSecurityConfirmations[].tool_call_id` 字段在扩展类型（`types.ts` SecurityConfirmationRequest）与 companion 下行帧（`security-confirmation.ts`）里均不存在——wire 上只有 `tool_name`。实现按 tool_name 相交生成 `pendingConfirmIds`（保守方向：宁可多 pin），且确认中的工具通常本就是 `status:"running"`，规则 2 已保证其为 current。
3. **pr6 `isLast` regex 更新**。渲染循环从逐消息改为逐 item（`isLast={itemIsLast}`），原断言 `/isLast=\{i === messages.length - 1\}/` 更新为 `/isLast=\{itemIsLast\}/`；断言意图（调用点传 isLast + memo 比较器含 isLast）不变，`ToolCallCard`/`data-testid` 断言原样保留。

## 已知缺口

- **未做浏览器端 e2e**：芯默认收起、点击展开、running/L2 卡可见等交互逻辑为单测+源码级验证，未在加载扩展的 Chrome 里实跑一轮工具回合（需要 companion + 真实 LLM 回合）。后续可在 #502 合并前人工过一遍线稿 01/02 两屏。
- **tool 行的逐行操作条（复制/分支/导出）随折叠消失**：role=tool 行不再走 MessageRow，收起时（以及展开时）没有原 per-row action bar；卡片自身的「详情」控件保留。若需保留导出能力，可在展开态补（另票）。
- ~~assistant 标记行的无名卡是既有行为~~ → 已修（`8baa5749`，见「hydrate 已修」）：function 形 inline 卡被门禁，史前线程转块出芯。
- **isLast 语义微调**：回合进行中最后一个 item 是工具块时，其前的 assistant/user 行不享 persistent action bar（注意力集中在当前步）；回合结束后的末条 assistant 消息行为不变。
- `SUMMONER_ALLOW` 在本 worktree 不存在（属主 checkout 的 summoner 工作），overlay 零改动以 diff + 引用扫描测试为准。

## 不在本 PR

归档 stub（B）、Goal（D 除 G1）、舰队（E）、终端（C）——按 spec §1 各自切片。
