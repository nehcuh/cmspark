# 502 A 工具史折叠 — Kimi 对抗复审

> 日期：2026-09-18 · 评审人：Kimi（READ-ONLY，未改任何文件）
> 对象：worktree `/tmp/cmspark-502/a`，diff `1d8c35d6..413c7534`（6 commits：纯函数+测试 → ChatView 接线 → 验收/报告）
> 方法：两路独立对抗子代理（CORRECTNESS / SPEC-PRODUCT-UX，互不引用结论）+ 仲裁人亲证关键主张
> 总 verdict：**APPROVE-WITH-NITS**（两路一致；无 BLOCK；2 个 MAJOR 均非本 diff 引入，需 follow-up 票）
>
> **增量复审 2026-09-18（commit `8baa5749` hydrate follow-up）**：MAJOR-1 **已闭合**（详见文末附录）。更新后 verdict：**APPROVE-WITH-NITS**，残余 MAJOR 只剩文案一条（需修 spec）。

## brief 红线复核（仲裁人亲证）

| 红线 | 结论 | 亲证 |
|---|---|---|
| L2 确认是否被折叠 | **HELD** | 确认帧本就**没有** `tool_call_id` 字段（`security-confirmation.ts:312` 只发 `tool_name`）——plan 按 `tool_call_id` 相交的假设是错的，实现按 `tool_name` 相关（`ChatView.tsx:120,1079`）是唯一可行键。且有双保险：`server.ts:571-578` 在请求 L2 确认**之前**先发 `tool.start`，确认中工具在 store 里必是 `status:"running"`，规则 2 已将其钉为 `current` |
| 100 是否被误删 | **N/A** | 本切片不碰 companion |
| same-tool 是否被改成自动续 | **N/A** | 同上 |
| overlay 是否被碰 | **HELD** | diff `--stat` 中 overlay / run-progress 文件 0 命中；新增扫描测试钉「tool-history 只在 sidepanel」 |

## 两路独立结论

**CORRECTNESS（APPROVE-WITH-NITS）**：abort 路径 CLEAN——abort 时 companion 回填 INTERRUPTED 行并补发 `tool.result{success:false}`（`adapter.ts:1131-1140` → `tool-batch-heal.ts:144+`），extension 映射为 `error`，无 running 悬挂。`isLast` 语义安全：steer 行最后时规则 2 按 `status:"running"` 独立判 `live`，不依赖 `threadBusy`。分组按连续 `role:"tool"` 行（`tool-history-view.ts:128-147`），不跨回合合并。块 key `tools-${item.msgs[0]!.id}` 流式更新下稳定，芯片不会自发收起。FocusBand 的 `collectRunningTools` 数据路径未动。测试 **1352/1352 通过**（含 11 个新用例）。

**SPEC/PRODUCT-UX（APPROVE-WITH-NITS）**：spec §2.4 四条 NEVER 全 HELD。失败可视性合格（`failed>0` 时芯片换 warning 色调，文案恒带「K 失败」）。AC-A 活路径成立：≥4 工具回合空闲后 = 1 芯 + 答案，芯在答案之前，芯片是合规 `<button aria-expanded>`。折叠纯视图态（`useState`），无 `thread.collapsed`、无 schema 变化。

## MAJOR（均不阻塞本 T1 切片，但必须开票）

1. **hydrate/reload 路径 AC-A 失守（pre-existing，#295 血统，A-DONE 已披露）**：`groupToolTurnRows` 只折 `role:"tool"` 行；持久化的 assistant 行带 function 形 `tool_calls`（`adapter.ts:1178` redact 后形状），hydration 原样回灌（`useWebSocket.ts:224`），`MessageRow` 仍无条件 `msg.tool_calls?.map(<ToolCallCard/>)`（`ChatView.tsx:789`）——reload 后视口是「退化无名卡 + 芯」，不是「1 芯 + 答案」。非本 diff 回归，但 #502 关闭前必须单独立票，不能算 A 已达成。
2. **「N 步浏览器操作」文案对编程会话不诚实（spec 锁定，需修 spec 而非代码）**：`doneChipLabel`（`tool-history-view.ts:104-106`）硬编码「浏览器操作」，3× `shell_exec` 的回合也读作「3 步浏览器操作」。工具名在场（`HistoryTool.tool_name`），区分成本低；但 spec §2.2 字面锁定该文案且 plan 测试钉死——建议 follow-up 票修 spec（按主导工具类派生名词，混合用「操作」）。

## NIT（不阻塞）

1. `tool-history-view.ts:64-71`：`current` 取最后一个 live 工具；非末尾的确认钉扎工具在有更晚 live 工具时会进 `completed`（今天不可达——confirm 阻塞循环无并发，但纯函数未强制 plan 规则 6）。
2. `ChatView.tsx:119-127`：`pendingConfirmToolNames` 全局（跨线程）；worker 的确认名撞上当前线程已 settle 的同名工具会让旧块保持 `live` 至确认解决（保守方向，瞬态）。
3. `tests/message-quiet-pr6.test.ts`：`/展开审计/` 断言被 `ChatView.tsx:1054` 的**注释**满足——字符串扫描证明不了渲染接线（有真实纯函数测试兜底）。
4. 分组窄边：回合以零尾随 assistant 行结束（仅史前 companion 可能）时两回合工具行连续，会并成超级芯，违 §2.3。
5. 芯片展开区无 `id`，`aria-controls` 无的放矢（项目惯例见 `msg-more-${msg.id}`）。
6. 失败芯片 border 未换 `tokens.warningBorder`，琥珀-on-琥珀 11px 对比度边缘（文案「K 失败」兜底）。
7. 继承自现状（非本 diff）：看别的线程时 `tool.result` 被 `shouldApplyStreamEvent` 丢弃，缓存行留 `running` 直到下次 hydrate——折叠继承了旧卡一样的卡死表现。
8. `A-DONE.md` 提交在仓根；按惯例应归 `docs/audit/reviews/` 或移出合并。tool 行经 MessageRow 的 per-row action bar（copy/fork/export）丢失——A-DONE 已自报。
9. `isLast` 语义偏移：最后渲染项为工具块时前一条 assistant 行失去常驻 action bar（A-DONE 已自报）。

## 测试证据

CORRECTNESS 路独立运行仓内 runner（hygiene gate + `tsc -p tsconfig.test.json` + `node --test`）：**1352/1352 pass**。SPEC 路独立运行：**29/29 pass**（同管线）。

---

## 附录：增量复审 — `8baa5749` fold hydrated assistant tool_calls

> 对象：单 commit `8baa5749`（4 文件，+192/-13）。一路 CORRECTNESS 对抗子代理 + 仲裁人亲读全 diff。
> verdict：**APPROVE-WITH-NITS**；MAJOR-1（reload 后退化空白卡 + 芯并存）**RESOLVED**。测试 **1357/1357 pass**。

**修复机制（仲裁人亲证 diff）**：双管齐下——

1. **Inline 抑制**：`shouldRenderInlineToolCards`（`tool-history-view.ts:122-138`）对 role=tool 行与任何 function 形/无 `tool_name` 的 call 返回 false；`ChatView.tsx:794` 把原先无条件的 `msg.tool_calls.map` 挂上该闸（闸在 map 前，有测试钉顺序）。hydrated assistant 行不再渲染无名空白卡。
2. **史前转换**：`groupToolTurnRows`（`tool-history-view.ts:165-209`）把「下一行不是 tool 行」的纯 function 形 assistant 转成 tools 块，`function.name` → `tool_name` 归一化，文本/推理保留为块前普通行。reload 后 = 正文行 → 一颗审计芯 → 答案行。

**红线复核**：L2 确认钉扎不变（`pendingConfirmToolNames` 相关逻辑未动；转换后的工具保留 persisted `id` 并获得 `tool_name`，两种形状下确认中工具仍被 `isLiveTool` 钉为 `current`，不可入芯）。live 路径零回归（live current 卡走 role=tool 行，分组/视图逻辑未动；`isUncoveredFunctionAssistant` 要求全部 call 为 function 形，吞不掉 flat live 行）。overlay / run_progress 零 diff。

**诚实性**：hydrated 工具无 `status`/`result` → idle reload 必落 `done`（rule 3 需 threadBusy），展开卡渲染 `status:"unknown"`（glyph `–`，aria-label "unknown"）——无假 running、无空白卡。

**新增 NIT（不阻塞）**：

1. 「covered」判定只看相邻下一行（`tool-history-view.ts:212-226`）；heal 在 EOF 追加的孤儿 tool 行与 assistant 不相邻时，会出现 assistant 转换芯 + 孤儿芯并存（`tool-batch-heal.ts:215-217` 自认此情形）。罕见，可用 id 相关收敛。
2. 按名确认相关对历史块可假阳性：live confirm 的工具名撞上每个 hydrated 同名块，会把 done 历史块翻成 live 视图（现代形状既有此设计，`ChatView.tsx:1080-1082` 已注）。
3. covered assistant 空 content 行在卡被抑制后仍渲染空 `agentBubble` div（ cosmetic，行前已存在）。
4. 混合形状 assistant（部分 function 形部分 flat）两头不占：inline 被抑制又不满足转换条件，该行工具不进任何芯——无已知生产者造此形状。
